export interface ExecRequest {
  id: string;
  type: "exec-request";
  payload: {
    cmd: string;
    body: any;
    signal?: AbortSignal;
  };
}
export interface ExecResponse {
  id: string;
  type: "exec-response";
  payload: any;
}

export interface ExecError {
  id: string;
  type: 'exec-error'
  payload: any
}