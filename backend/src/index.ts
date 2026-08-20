import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config } from "./config";
import { apiV1Router } from "./api";
import { attachLiveSocket } from "./ws/live";
import { startMqttSubscriber } from "./mqtt/subscriber";
import { startWatchdog } from "./watchdog";

// Prisma returns BigInt for autoincrement ids; JSON.stringify can't handle
// BigInt natively, so give it a toJSON.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/v1", apiV1Router);

const server = createServer(app);
attachLiveSocket(server);

server.listen(config.port, () => {
  console.log(`[backend] listening on :${config.port}`);
});

startMqttSubscriber();
startWatchdog();
