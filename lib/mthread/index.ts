import { ExecRequest } from "../messages/exec";
import { Worker2MainMsg } from "../messages/messages";
import { Command } from "../types";
import { uuid } from "../utils";
import { EventEmitter } from "events";
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

const ErrorMessages = {
  timeout: "timeout",
};

type Events = {
  "exec-complete": [
    {
      id: string;
    }
  ];
};

export class WorkerManager<CMD extends Command> {
  private maxWorkload = Infinity;
  private autoScale = false;

  private workerOptions?: WorkerOptions;
  private workerFactory: (options?: WorkerOptions) => Worker;

  private queue: {
    id: string;
    command: keyof CMD;
    args: any[];
  }[] = [];
  private workers: {
    id: string;
    wk: Worker;
    workload: string[];
  }[] = [];
  private eventEmitter = new EventEmitter<Events>();

  constructor(options: WorkerManagerConstructor) {
    const { initialTimeout, maxWorkload } = options;
    this.workerOptions = options.options;
    this.maxWorkload = maxWorkload ?? this.maxWorkload;
    this.autoScale = options.autoScale ?? this.autoScale;
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
    this.addWorker(this.workerFactory(options.options), {
      timeout: initialTimeout,
    })
      .then(() => {
        console.info("Initialized worker");
      })
      .catch((err: Error | ErrorEvent) => {
        if (err.message === ErrorMessages.timeout) {
          console.warn("Timeout!");
        } else {
          // "Hết cứu"
          throw err;
        }
      });
  }

  public async addWorker(worker: Worker, options?: { timeout?: number }) {
    return new Promise<(typeof this.workers)[number]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("timeout"));
      }, options?.timeout ?? 60 * 1000);

      const eventListener = (msg: MessageEvent<MessageEvent>) => {
        if (msg.data.type === "ping") {
          clearTimeout(timeout);
          worker.removeEventListener("message", eventListener);
          const id = uuid();
          const result = {
            id,
            wk: worker,
            workload: [],
          };
          this.workers.push(result);
          const pongMsg: PongMsg = {
            type: "pong",
            payload: {
              id,
              majorWorker: true,
            },
          };
          worker.postMessage(pongMsg);
          resolve(result);
        }
      };
      const errorListener = (error: ErrorEvent) => {
        worker.removeEventListener("error", errorListener);
        reject(error);
      };
      worker.addEventListener("message", eventListener);
      worker.addEventListener("error", errorListener);
    });
  }
  public async excec<Key extends keyof CMD>(
    cmd: Key,
    ...args: Parameters<CMD[Key]>
  ) {
    const requestId = uuid();
    this.queue.push({
      id: requestId,
      args,
      command: cmd,
    });
    // this.eventEmitter.emit("add", requestId);
  }

  private async excecCommandFromQueue<Key extends keyof CMD>(
    id: string,
    cmd: Key,
    ...args: any[]
  ) {
    let worker = this.workers.find(({ workload }) => {
      return workload.length < this.maxWorkload;
    });
    if (!worker && this.autoScale) {
      worker = await this.addWorker(this.workerFactory(this.workerOptions));
    } else {
      return;
    }
    const msg: ExecRequest = {
      id,
      type: "excec-request",
      payload: {
        cmd: cmd as string,
        args,
      },
    };
    const execListener = (msg: MessageEvent<Worker2MainMsg>) => {
      if (msg.data.type === "excec-response") {
        if (msg.data.id === id) {
          worker.wk.removeEventListener("message", execListener);

          // this.eventEmitter.on("exec-complete", ({ id }) => {});
        }
      }
    };
    worker.wk.addEventListener("message", () => {});
    worker.wk.postMessage(msg);
  }
}
