import { ExecRequest } from "../messages/exec";
import { Worker2MainMsg } from "../messages/messages";
import type { Command } from "../utils";
import { EventEmitter } from "events";

function uuid() {
  var temp_url = URL.createObjectURL(new Blob());
  var uuid = temp_url.toString();
  URL.revokeObjectURL(temp_url);
  return uuid.substr(uuid.lastIndexOf("/") + 1); // remove prefix (e.g. blob:null/, blob:www.test.com/, ...)
}

interface WorkerManagerConstructorBase {
  /**
   * The second parameter of Worker constructor.
   */
  options?: WorkerOptions;
  /**
   * timeout of initial process in microsecond
   */
  initialTimeout?: number;

  maxWorkload?: number;

  autoScale?: boolean;

  maxWorker?: number;
}

interface WorkerManagerConstructorWithWorkerFactory
  extends WorkerManagerConstructorBase {
  /**
   * Worker url
   */
  url?: never;

  /**
   * a function which use to create Worker instance, ignore if url is not nil
   * @returns Worker
   */
  workerFactory: (options?: WorkerOptions) => Worker;
}
interface WorkerManagerConstructorWithUrl extends WorkerManagerConstructorBase {
  /**
   * Worker url
   */
  url: string;
  /**
   * a function which use to create Worker instance, ignore if url is not nil
   * @returns Worker
   */
  workerFactory?: never;
}
type WorkerManagerConstructor =
  | WorkerManagerConstructorWithWorkerFactory
  | WorkerManagerConstructorWithUrl;

type Events = {
  "todoQueue.push": [{ requestId: string }];
  "exec-complete": [
    {
      id: string;
      payload: any;
    }
  ];
  "exec-error": [
    {
      id: string;
      payload: any;
    }
  ]
};

export interface QueueItem<CMD> {
  id: string;
  command: keyof CMD;
  body: any;
  signal?: AbortSignal;
}
interface WorkerArrayItem {
  id: string;
  wk: Promise<Worker>;
  workload: string[];
}
export class WorkerManager<CMD extends Command> {
  private maxWorkload = Infinity;
  private autoScale = false;
  private maxWorker = Infinity;

  private workerOptions?: WorkerOptions;
  private workerFactory: (options?: WorkerOptions) => Worker;

  private todoQueue: QueueItem<CMD>[] = [];
  private pendingQueue: QueueItem<CMD>[] = [];

  private workers: WorkerArrayItem[] = [];
  private eventEmitter = new EventEmitter<Events>();

  constructor(options: WorkerManagerConstructor) {
    const { maxWorkload } = options;
    this.workerOptions = options.options;
    this.maxWorkload = maxWorkload ?? this.maxWorkload;
    this.autoScale = options.autoScale ?? this.autoScale;
    this.maxWorker = options.maxWorker ?? this.maxWorker;
    /**
     * init worker factory
     */
    if ((options as WorkerManagerConstructorWithUrl).url) {
      const { url, options: workerOptions } =
        options as WorkerManagerConstructorWithUrl;
      this.workerFactory = () => {
        return new Worker(url, workerOptions);
      };
    } else {
      const { workerFactory } =
        options as WorkerManagerConstructorWithWorkerFactory;
      this.workerFactory = workerFactory;
    }

    this.eventEmitter.addListener("todoQueue.push", async ({ requestId }) => {
      let worker: WorkerArrayItem | undefined;
      for (let wk of this.workers) {
        await wk.wk;
        if (wk.workload.length < this.maxWorkload) {
          worker = wk;
        }
      }
      const request = this.todoQueue.find(({ id }) => id === requestId);
      // Scale up if max workload reached
      if (!worker && this.autoScale && this.workers.length < this.maxWorker) {
        worker = await this.addWorker(this.workerFactory(this.workerOptions));
        await worker.wk;
      }
      // If worker avaible excec request
      if (worker && request) {
        worker.workload.push(requestId);
        this.pendingQueue.push(request);
        this.todoQueue = this.todoQueue.filter(({ id }) => {
          return id !== requestId;
        });
        try {
          await this.excecCommand(
            worker,
            requestId,
            request.command,
            {
              body: request.body,
              signal: request.signal
            }
          );
          this.pendingQueue = this.pendingQueue.filter(({ id }) => {
            return id !== requestId;
          });
          worker.workload = worker.workload.filter((id) => {
            return id !== requestId;
          });
          if (this.todoQueue.length > 0) {
            this.eventEmitter.emit("todoQueue.push", {
              requestId: this.todoQueue[0].id,
            });
          }
        } catch (err) {

        }

      }
    });
  }
  /**
   * starting to init worker
   */
  public async boostrap(params?: { timeout?: number }) {
    await this.addWorker(this.workerFactory(this.workerOptions), {
      timeout: params?.timeout,
    });

    return this;
  }
  public async excec<Key extends keyof CMD>(
    cmd: Key,
    { body, signal }: Parameters<CMD[Key]>[0]
  ) {



    return new Promise<ReturnType<CMD[Key]>>((resolve, reject) => {

      const completeListenter = ({
        id,
        payload,
      }: Events["exec-complete"][0]) => {
        if (id === requestId) {
          this.eventEmitter.removeListener("exec-complete", completeListenter);
          this.eventEmitter.removeListener("exec-error", errorListener);
          resolve(payload);
        }
      };
      const errorListener = ({
        id,
        payload,
      }: Events["exec-error"][0]) => {
        if (id === requestId) {
          this.eventEmitter.removeListener("exec-complete", completeListenter);
          this.eventEmitter.removeListener("exec-error", errorListener);
          reject(payload)
        }
      }
      this.eventEmitter.addListener("exec-complete", completeListenter);

      this.eventEmitter.addListener("exec-error", errorListener);

      const requestId = uuid();
      this.todoQueue.push({
        id: requestId,
        body,
        command: cmd,
      });
      this.eventEmitter.emit("todoQueue.push", { requestId });

      if (signal) {

        signal.onabort = () => {
          this.eventEmitter.removeListener("exec-complete", completeListenter);
          this.eventEmitter.removeListener("exec-error", errorListener);
          //Remove from todo
          //If while exec command, the command will throw Error
          this.todoQueue = this.todoQueue.filter((todo) => {
            return requestId !== todo.id
          })
          reject(signal.reason)
        }
      }
    });
  }

  private async addWorker(worker: Worker, options?: { timeout?: number }) {
    let id: string | undefined;
    const promise = new Promise<Worker>((resolve, reject) => {
      /**
       * Terminate
       */
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("timeout"));
      }, options?.timeout ?? 60 * 1000);
      /**
       *
       * waiting for ping message
       */
      const eventListener = (msg: MessageEvent<MessageEvent>) => {
        if (msg.data.type === "ping") {
          clearTimeout(timeout);
          worker.removeEventListener("message", eventListener);
          id = uuid();

          const pongMsg: PongMsg = {
            type: "pong",
            payload: {
              id,
              majorWorker: true,
            },
          };
          worker.postMessage(pongMsg);
          resolve(worker);
        }
      };
      const errorListener = (error: ErrorEvent) => {
        worker.removeEventListener("error", errorListener);
        reject(error);
      };
      worker.addEventListener("message", eventListener);
      worker.addEventListener("error", errorListener);
    });

    const result = {
      id: id!,
      wk: promise,
      workload: [] as string[],
    };
    this.workers.push(result);
    return result;
  }

  private async excecCommand<Key extends keyof CMD>(
    worker: (typeof this.workers)[number],
    id: string,
    cmd: Key,

    { body, signal }: { body: any, signal?: AbortSignal }
  ) {
    const result = await new Promise(async (resolve) => {
      const msg: ExecRequest = {
        id,
        type: "exec-request",
        payload: {
          cmd: cmd as string,
          body,
          signal: signal
        },
      };
      const wk = (await worker.wk)
      const execListener = async (msg: MessageEvent<Worker2MainMsg>) => {
        if (msg.data.type === "exec-response") {
          if (msg.data.id === id) {
            wk.removeEventListener("message", execListener);
            resolve(msg.data.payload);
            this.eventEmitter.emit("exec-complete", {
              id: msg.data.id,
              payload: msg.data.payload,
            });
          }
        } else if (msg.data.type === "exec-error") {
          if (msg.data.id === id) {
            wk.removeEventListener("message", execListener);
            this.eventEmitter.emit("exec-error", {
              id: msg.data.id,
              payload: msg.data.payload,
            });
          }
        }
      };
      wk.addEventListener("message", execListener);
      wk.postMessage(msg);
    });

    return result;
  }
}
