import { api } from "./client";
import { WebSocketManager } from "./websocket";

/** Module-level WebSocket singleton: connect once, survive component mount/unmount cycles.
 * Retries without limit: a server restart can outlast any fixed number of attempts, and an
 * open page has to rejoin it to see progress and model changes. */
export const ws = new WebSocketManager(
  api.getWebSocketUrl("/sdapi/v2/ws"),
  () => api.getWsTicket(),
  { maxReconnectAttempts: Infinity },
);

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
