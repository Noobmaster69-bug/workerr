import { ExecRequest, ExecResponse } from "./exec";

export type Main2WorkerMsg = PongMsg | ExecRequest;
export type Worker2MainMsg = PingMsg | ExecResponse;
