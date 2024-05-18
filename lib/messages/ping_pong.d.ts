// Messages which is sent when initilized worker

interface PingMsg {
  type: "ping";
}
interface PongMsg {
  type: "pong";
  /**
   * worker id
   */
  payload: {
    id: string;
    majorWorker: boolean;
  };
}
