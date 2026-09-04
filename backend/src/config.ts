export const config = {
  port: Number(process.env.BACKEND_PORT ?? 3000),
  mqttBrokerUrl: process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883",
  // Public "facade" demo: serve every GET normally (the dashboard stays fully
  // live off real telemetry) but reject any write with 403 READ_ONLY_DEMO so a
  // stranger on the internet can't mutate ERP data, register machines, or retune
  // simulators. Off by default — local dev and `docker compose up` behave as before.
  demoReadOnly: process.env.DEMO_READ_ONLY === "true",
  // Shown in the 403 body so the dashboard modal can point people at the repo.
  repoUrl: process.env.REPO_URL ?? "https://github.com/your-username/production-monitoring",
  // Comma-separated allow-list for CORS. Unset = reflect any origin (dev default).
  corsOrigin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean),
  watchdogOfflineThresholdSec: Number(
    process.env.BACKEND_WATCHDOG_OFFLINE_THRESHOLD_SEC ?? 15
  ),
  // A gateway heartbeats less often than a machine publishes telemetry, so it
  // gets its own, looser staleness window before the watchdog marks it OFFLINE.
  gatewayOfflineThresholdSec: Number(
    process.env.BACKEND_GATEWAY_OFFLINE_THRESHOLD_SEC ?? 30
  ),
  // Best-effort container control for the simulator fleet — lets Admin
  // add/activate/deactivate a machine without a manual `docker compose run`.
  // Only meaningful when the backend itself runs in Docker with the host
  // socket mounted in; disabled automatically otherwise (see docker/simulatorManager.ts).
  dockerEnabled: process.env.DOCKER_MANAGEMENT_ENABLED !== "false",
  dockerNetwork: process.env.DOCKER_NETWORK ?? "production_monitoring_default",
  simulatorImage: process.env.SIMULATOR_IMAGE ?? "production-monitoring-simulator:latest",
  simulatorMqttBrokerUrl: process.env.SIMULATOR_MQTT_BROKER_URL ?? "mqtt://mosquitto:1883",
  simulatorBackendApiUrl: process.env.SIMULATOR_BACKEND_API_URL ?? "http://backend:3000/api/v1",
};
