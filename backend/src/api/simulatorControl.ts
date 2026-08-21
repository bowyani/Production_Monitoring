import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { logAudit } from "../audit";
import { getSimulatorParams, publishSimulatorControl } from "../mqtt/subscriber";

export const simulatorControlRouter = Router();

// Mirrors simulator/src/index.ts's Tuning type — every field optional since
// the dashboard only sends the ones the user actually changed.
const tuningPatchSchema = z
  .object({
    tickMs: z.number().min(200).max(10000),
    silentProbability: z.number().min(0).max(1),
    alarmProbability: z.number().min(0).max(1),
    rejectProbability: z.number().min(0).max(1),
    cycleTimeMinSec: z.number().min(1).max(120),
    cycleTimeMaxSec: z.number().min(1).max(120),
    pressureMinBar: z.number().min(0).max(3000),
    pressureMaxBar: z.number().min(0).max(3000),
    temperatureMinC: z.number().min(0).max(500),
    temperatureMaxC: z.number().min(0).max(500),
  })
  .partial();

type SimulatedMachineCheck =
  | { ok: true }
  | { ok: false; status: number; body: { error: string } };

async function requireSimulatedMachine(machineId: string): Promise<SimulatedMachineCheck> {
  const machine = await prisma.machine.findUnique({ where: { machineId } });
  if (!machine) return { ok: false, status: 404, body: { error: "machine not found" } };
  if (machine.dataSource !== "MQTT") {
    return { ok: false, status: 400, body: { error: "only MQTT/simulator-backed machines have tunable params" } };
  }
  return { ok: true };
}

simulatorControlRouter.get("/admin/machines/:id/simulator/params", async (req, res) => {
  const check = await requireSimulatedMachine(req.params.id);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }
  const cached = getSimulatorParams(req.params.id);
  res.json({ machineId: req.params.id, tuning: cached?.tuning ?? null });
});

simulatorControlRouter.patch("/admin/machines/:id/simulator/params", async (req, res) => {
  const parsed = tuningPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "no fields to update" });
    return;
  }
  const check = await requireSimulatedMachine(req.params.id);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }

  const published = publishSimulatorControl(req.params.id, parsed.data);
  if (!published) {
    res.status(503).json({ error: "mqtt broker not connected" });
    return;
  }
  await logAudit("admin-ui", "SIMULATOR_PARAMS_UPDATED", "machine", req.params.id, parsed.data);
  res.json({ ok: true, applied: parsed.data });
});
