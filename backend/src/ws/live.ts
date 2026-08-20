import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

let wss: WebSocketServer | undefined;

export function attachLiveSocket(server: HttpServer) {
  wss = new WebSocketServer({ server, path: "/live" });
}

export function broadcast(event: string, data: unknown) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
