import mqtt, { type MqttClient } from "mqtt";
import { prisma } from "../db/client";
import { broadcast } from "../ws/live";
import { config } from "../config";
import { telemetrySchema, jobSchema, alarmSchema } from "./schemas";

const TOPIC_TELEMETRY = /^factory\/([^/]+)\/telemetry$/;
const TOPIC_JOB = /^factory\/([^/]+)\/job$/;
const TOPIC_ALARM = /^factory\/([^/]+)\/alarm$/;
const TOPIC_CONTROL_STATE = /^factory\/([^/]+)\/control\/state$/;

// The simulator publishes its current tuning params retained on
// factory/<machineId>/control/state (see simulator/src/index.ts). Caching
// the latest one per machine here is what lets the Simulator Tuning page's
// GET return real values instead of only ever seeing writes.
export type SimulatorParamsState = { machineId: string; tuning: Record<string, number> };
const simulatorParamsCache = new Map<string, SimulatorParamsState>();

let mqttClient: MqttClient | undefined;

export function getMqttClient() {
  return mqttClient;
}

export function getSimulatorParams(machineId: string) {
  return simulatorParamsCache.get(machineId);
}

// Fire-and-forget: publishes retained so a simulator that reconnects (or
// hasn't started yet) still picks up the desired tuning without a resend.
//
// MQTT retain keeps only the single most recent publish per topic — so a
// bare partial patch published here would BECOME the entire retained
// message, and a simulator that restarts afterward would apply just that
// patch onto its own DEFAULT_TUNING, silently losing every other
// previously-configured field. Merging onto the last-known full state
// (cached from the simulator's own retained control/state echo) before
// publishing keeps the retained message a complete snapshot regardless of
// how small the incoming patch is.
export function publishSimulatorControl(machineId: string, patch: Record<string, unknown>) {
  if (!mqttClient) return false;
  const cached = simulatorParamsCache.get(machineId);
  const merged = { ...(cached?.tuning ?? {}), ...patch };
  mqttClient.publish(`factory/${machineId}/control`, JSON.stringify(merged), { retain: true });
  return true;
}

export function startMqttSubscriber() {
  const client = mqtt.connect(config.mqttBrokerUrl);
  mqttClient = client;

  client.on("connect", () => {
    client.subscribe(["factory/+/telemetry", "factory/+/job", "factory/+/alarm", "factory/+/control/state"]);
    console.log(`[mqtt] connected to ${config.mqttBrokerUrl}`);
  });

  client.on("error", (err) => {
    console.error("[mqtt] connection error", err);
  });

  client.on("message", async (topic, payload) => {
    try {
      const raw = JSON.parse(payload.toString());

      if (TOPIC_TELEMETRY.test(topic)) {
        await handleTelemetry(telemetrySchema.parse(raw));
      } else if (TOPIC_JOB.test(topic)) {
        await handleJob(jobSchema.parse(raw));
      } else if (TOPIC_ALARM.test(topic)) {
        await handleAlarm(alarmSchema.parse(raw));
      } else if (TOPIC_CONTROL_STATE.test(topic)) {
        const machineId = TOPIC_CONTROL_STATE.exec(topic)![1];
        simulatorParamsCache.set(machineId, raw);
        broadcast("simulatorParams", raw);
      }
    } catch (err) {
      console.error(`[mqtt] rejected message on ${topic}`, err);
    }
  });

  return client;
}

async function isRegisteredMachine(machineId: string) {
  const machine = await prisma.machine.findUnique({ where: { machineId } });
  if (!machine) {
    console.warn(`[mqtt] dropping message for unregistered machineId=${machineId}`);
    return null;
  }
  if (!machine.isActive) {
    console.warn(`[mqtt] dropping message for deactivated machineId=${machineId}`);
    return null;
  }
  return machine;
}

async function handleTelemetry(payload: ReturnType<typeof telemetrySchema.parse>) {
  const machine = await isRegisteredMachine(payload.machineId);
  if (!machine) return;

  const timestamp = new Date(payload.timestamp);
  const newStatus = payload.machineData.status;

  await prisma.machineTelemetry.create({
    data: {
      machineId: payload.machineId,
      timestamp,
      status: newStatus,
      cycleTimeSec: payload.processData.cycleTimeSec,
      shotCount: payload.processData.shotCount,
      injectionPressureBar: payload.processData.injectionPressureBar,
      barrelTemperatureC: payload.processData.barrelTemperatureC,
    },
  });

  if (machine.status !== newStatus) {
    await prisma.machineStatusEvent.create({
      data: {
        machineId: payload.machineId,
        fromStatus: machine.status,
        toStatus: newStatus,
        changedAt: timestamp,
      },
    });
  }

  await prisma.machine.update({
    where: { machineId: payload.machineId },
    data: { status: newStatus, lastSeenAt: timestamp },
  });

  broadcast("telemetry", { machineId: payload.machineId, timestamp, status: newStatus, ...payload.processData });
}

async function handleJob(payload: ReturnType<typeof jobSchema.parse>) {
  const machine = await isRegisteredMachine(payload.machineId);
  if (!machine) return;

  const { jobData } = payload;
  const timestamp = new Date(payload.timestamp);

  if (jobData.event === "START") {
    await prisma.productionJob.upsert({
      where: { jobNumber: jobData.jobNumber },
      create: {
        jobNumber: jobData.jobNumber,
        machineId: payload.machineId,
        productCode: jobData.productCode ?? "UNKNOWN",
        moldId: jobData.moldId,
        recipeId: jobData.recipeId,
        startTime: timestamp,
        status: "RUNNING",
      },
      update: { status: "RUNNING" },
    });

    // Auto-seed the mock "order obtained from ERP" (see schema.prisma
    // ErpJobOrder) from whatever the simulator just decided to produce, so
    // Job Orders in ERP stays populated without anyone hand-keying it.
    // Skipped entirely without a productCode — every real simulator START
    // always sends one, so a START missing it is a malformed/foreign
    // publisher; seeding a permanent "UNKNOWN" row would pollute the SKU
    // dimension in Executive KPI's charts with no way to tell it apart from
    // a real product later. quantityOrdered falling back to 0 is fine on its
    // own (a legitimate "unknown quantity", not junk).
    if (jobData.productCode) {
      await prisma.erpJobOrder.upsert({
        where: { jobNumber: jobData.jobNumber },
        create: {
          jobNumber: jobData.jobNumber,
          productCode: jobData.productCode,
          quantityOrdered: jobData.plannedQty ?? 0,
        },
        update: {},
      });
    }
  } else if (jobData.event === "UPDATE") {
    await prisma.productionJob.update({
      where: { jobNumber: jobData.jobNumber },
      data: {
        goodQty: jobData.goodQty,
        rejectQty: jobData.rejectQty,
        startupScrapQty: jobData.startupScrapQty,
      },
    });
  } else if (jobData.event === "END") {
    await prisma.productionJob.update({
      where: { jobNumber: jobData.jobNumber },
      data: {
        endTime: timestamp,
        status: "DONE",
        goodQty: jobData.goodQty,
        rejectQty: jobData.rejectQty,
        startupScrapQty: jobData.startupScrapQty,
      },
    });
  }

  broadcast("job", { machineId: payload.machineId, ...jobData });
}

async function handleAlarm(payload: ReturnType<typeof alarmSchema.parse>) {
  const machine = await isRegisteredMachine(payload.machineId);
  if (!machine) return;

  const { alarmData } = payload;
  const timestamp = new Date(payload.timestamp);

  if (alarmData.event === "RAISE") {
    await prisma.alarm.create({
      data: {
        machineId: payload.machineId,
        jobNumber: alarmData.jobNumber,
        alarmCode: alarmData.alarmCode,
        alarmMessage: alarmData.alarmMessage ?? "",
        alarmTimestamp: timestamp,
      },
    });
  } else if (alarmData.event === "CLEAR") {
    const active = await prisma.alarm.findFirst({
      where: {
        machineId: payload.machineId,
        alarmCode: alarmData.alarmCode,
        clearedTimestamp: null,
      },
      orderBy: { alarmTimestamp: "desc" },
    });
    if (active) {
      await prisma.alarm.update({
        where: { id: active.id },
        data: { clearedTimestamp: timestamp },
      });
    }
  }

  broadcast("alarm", { machineId: payload.machineId, ...alarmData });
}
