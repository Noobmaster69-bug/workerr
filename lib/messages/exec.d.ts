export interface ExecRequest {
  id: string;
  type: "excec-request";
  payload: {
    cmd: string;
    args: any[];
    signal?: AbortSignal;
  };
}
export interface ExecResponse {
  id: string;
  type: "excec-response";
  payload: any;
}
