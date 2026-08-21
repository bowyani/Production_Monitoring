import { Router } from "express";
import { prisma } from "../db/client";
import type { Machine, ErpMachineAsset } from "@prisma/client";

export const kpiRouter = Router();

// Executive KPI summary — answers README.md ("Gap Analysis" §1.6) (OEE%, Cost per Hour,
// Reject rate, Energy). QC hold rate is NOT computed: there is no "QC hold"
// concept in the current data model, so it's omitted rather than faked.
kpiRouter.get("/kpi/summary", async (req, res) => {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 24 * 60 * 60 * 1000);

  // MANUAL machines have no status-event history (no telemetry to derive it
  // from), so Availability would come out as a misleading 0% rather than
  // "unknown". Excluding them entirely — surfaced explicitly in the
  // dashboard's blind-spot banner — is more honest than a fake number.
  const machines = await prisma.machine.findMany({
    where: { isActive: true, dataSource: "MQTT" },
    include: { asset: true },
  });
  const results = await Promise.all(machines.map((m) => computeMachineKpi(m, from, to)));

  const windowHours = (to.getTime() - from.getTime()) / 3_600_000;
  const totalGood = sum(results.map((r) => r.goodQty));
  const totalReject = sum(results.map((r) => r.rejectQty));
  const totalScrap = sum(results.map((r) => r.startupScrapQty));
  const totalQty = totalGood + totalReject + totalScrap;
  const performances = results.map((r) => r.performance).filter((v): v is number => v != null);

  const fleet = {
    availability:
      windowHours > 0 && results.length > 0
        ? avg(results.map((r) => r.availability).filter((v): v is number => v != null))
        : null,
    performance: performances.length > 0 ? avg(performances) : null,
    quality: totalQty > 0 ? totalGood / totalQty : null,
    rejectRate: totalQty > 0 ? totalReject / totalQty : null,
    goodQty: totalGood,
    rejectQty: totalReject,
    startupScrapQty: totalScrap,
    estimatedEnergyKwh: sumNullable(results.map((r) => r.estimatedEnergyKwh)),
    estimatedLaborCost: sumNullable(results.map((r) => r.estimatedLaborCost)),
  };

  res.json({ from, to, machines: results, fleet });
});

async function computeMachineKpi(machine: Machine & { asset: ErpMachineAsset }, from: Date, to: Date) {
  const windowMs = to.getTime() - from.getTime();

  const priorEvent = await prisma.machineStatusEvent.findFirst({
    where: { machineId: machine.machineId, changedAt: { lte: from } },
    orderBy: { changedAt: "desc" },
  });
  const eventsInWindow = await prisma.machineStatusEvent.findMany({
    where: { machineId: machine.machineId, changedAt: { gt: from, lte: to } },
    orderBy: { changedAt: "asc" },
  });

  let cursor = from;
  let cursorStatus = priorEvent?.toStatus ?? eventsInWindow[0]?.fromStatus ?? machine.status;
  let runMs = 0;
  for (const event of eventsInWindow) {
    const duration = event.changedAt.getTime() - cursor.getTime();
    if (cursorStatus === "RUN") runMs += duration;
    cursor = event.changedAt;
    cursorStatus = event.toStatus;
  }
  runMs += cursorStatus === "RUN" ? to.getTime() - cursor.getTime() : 0;
  const availability = windowMs > 0 ? Math.min(1, Math.max(0, runMs / windowMs)) : null;

  const telemetryAgg = await prisma.machineTelemetry.aggregate({
    where: { machineId: machine.machineId, timestamp: { gte: from, lte: to }, status: "RUN" },
    _avg: { cycleTimeSec: true },
  });
  const avgCycleTimeSec = telemetryAgg._avg.cycleTimeSec ? Number(telemetryAgg._avg.cycleTimeSec) : null;
  const targetCycleTimeSec = machine.asset.targetCycleTimeSec ? Number(machine.asset.targetCycleTimeSec) : null;
  const performance =
    targetCycleTimeSec && avgCycleTimeSec ? Math.min(1, targetCycleTimeSec / avgCycleTimeSec) : null;

  const jobsAgg = await prisma.productionJob.aggregate({
    where: { machineId: machine.machineId, startTime: { gte: from, lte: to } },
    _sum: { goodQty: true, rejectQty: true, startupScrapQty: true },
  });
  const goodQty = jobsAgg._sum.goodQty ?? 0;
  const rejectQty = jobsAgg._sum.rejectQty ?? 0;
  const startupScrapQty = jobsAgg._sum.startupScrapQty ?? 0;
  const totalQty = goodQty + rejectQty + startupScrapQty;
  const quality = totalQty > 0 ? goodQty / totalQty : null;
  const rejectRate = totalQty > 0 ? rejectQty / totalQty : null;

  const oee =
    availability != null && performance != null && quality != null
      ? availability * performance * quality
      : null;

  const runtimeHours = runMs / 3_600_000;
  const ratedPowerKw = machine.asset.ratedPowerKw ? Number(machine.asset.ratedPowerKw) : null;
  const estimatedEnergyKwh = ratedPowerKw != null ? ratedPowerKw * runtimeHours : null;
  const laborCostPerHour = machine.asset.laborCostPerHour ? Number(machine.asset.laborCostPerHour) : null;
  const estimatedLaborCost = laborCostPerHour != null ? laborCostPerHour * runtimeHours : null;

  return {
    machineId: machine.machineId,
    machineName: machine.asset.machineName,
    availability,
    performance,
    quality,
    oee,
    rejectRate,
    runtimeHours,
    avgCycleTimeSec,
    targetCycleTimeSec,
    ratedPowerKw,
    estimatedEnergyKwh,
    laborCostPerHour,
    estimatedLaborCost,
    goodQty,
    rejectQty,
    startupScrapQty,
  };
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}
function sumNullable(values: (number | null)[]) {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0 ? sum(present) : null;
}
function avg(values: number[]) {
  return values.length > 0 ? sum(values) / values.length : null;
}
