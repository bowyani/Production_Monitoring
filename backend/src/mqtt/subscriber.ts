import mqtt from "mqtt";
import { prisma } from "../db/client";
import { broadcast } from "../ws/live";
import { config } from "../config";
import { telemetrySchema, jobSchema, alarmSchema } from "./schemas";

const TOPIC_TELEMETRY = /^factory\/([^/]+)\/telemetry$/;
const TOPIC_JOB = /^factory\/([^/]+)\/job$/;
const TOPIC_ALARM = /^factory\/([^/]+)\/alarm$/;

export function startMqttSubscriber() {
  const client = mqtt.connect(config.mqttBrokerUrl);

  client.on("connect", () => {
    client.subscribe(["factory/+/telemetry", "factory/+/job", "factory/+/alarm"]);
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
