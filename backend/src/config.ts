export const config = {
  port: Number(process.env.BACKEND_PORT ?? 3000),
  mqttBrokerUrl: process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883",
  watchdogOfflineThresholdSec: Number(
    process.env.BACKEND_WATCHDOG_OFFLINE_THRESHOLD_SEC ?? 15
  ),
};
