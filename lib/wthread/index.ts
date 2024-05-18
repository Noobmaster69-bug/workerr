import { Main2WorkerMsg } from "../messages/messages";

declare var self: DedicatedWorkerGlobalScope;
export class Workerr {
  public id: string | null = null;
  public majorWorker: boolean = false;
  constructor() {
    let interval = setInterval(() => {
      self.postMessage({ type: "ping" });
    }, 1000);
    const eventListener = (msg: MessageEvent<Main2WorkerMsg>) => {
      if (msg.data.type === "pong") {
        self.removeEventListener("message", eventListener);
        clearInterval(interval);
        this.id = msg.data.payload.id;
        this.majorWorker = msg.data.payload.majorWorker;
        console.log(
          `Hi, i'm ${this.majorWorker ? "major" : "minor"} worker ${this.id}`
        );
      }
    };
    self.addEventListener("message", eventListener);
  }
}
