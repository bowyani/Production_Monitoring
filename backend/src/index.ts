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
app.use(cors(config.corsOrigin ? { origin: config.corsOrigin } : undefined));
app.use(express.json());
app.get("/health", (_req, res) => res.send("ok"));

// Read-only facade for the public demo. Preflight (OPTIONS) and every safe
// method pass through; anything that could write is turned away with a machine-
// readable code the dashboard turns into a "clone & run it locally" dialog.
if (config.demoReadOnly) {
  const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
  app.use("/api/v1", (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    res.status(403).json({
      error: "READ_ONLY_DEMO",
      message:
        "This is a public read-only demo. Clone the repository and run it locally to use features that write data.",
      repo: config.repoUrl,
    });
  });
}

app.use("/api/v1", apiV1Router);

const server = createServer(app);
attachLiveSocket(server);

server.listen(config.port, () => {
  console.log(`[backend] listening on :${config.port}`);
});

startMqttSubscriber();
startWatchdog();
