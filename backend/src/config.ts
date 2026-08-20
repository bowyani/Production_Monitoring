export const config = {
  port: Number(process.env.BACKEND_PORT ?? 3000),
  mqttBrokerUrl: process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883",
  watchdogOfflineThresholdSec: Number(
    process.env.BACKEND_WATCHDOG_OFFLINE_THRESHOLD_SEC ?? 15
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
