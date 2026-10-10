import { renewForSocket, socketUrl } from "./session";
import { WebSocketManager } from "./websocket";

/** Module-level WebSocket singleton: connect once, survive component mount/unmount cycles.
 * Retries without limit: a server restart can outlast any fixed number of attempts, and an
 * open page has to rejoin it to see progress and model changes. */
export const ws = new WebSocketManager(() => socketUrl("/sdapi/v2/ws"), {
  maxReconnectAttempts: Infinity,
  onRefused: renewForSocket,
});

let wsConnected = false;
let wsStarted = false;

export function isWsConnected() {
  return wsConnected;
}

export function ensureWs() {
  if (wsStarted) return;
  wsStarted = true;
  ws.on("open", () => {
    wsConnected = true;
  });
  ws.on("close", () => {
    wsConnected = false;
  });
  ws.connect();
}
