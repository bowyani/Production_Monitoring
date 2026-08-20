import { z } from "zod";

// Payload groups follow DESIGN_RATIONALE.md §3 (machineData/processData) and
// the EUROMAP 77-inspired grouping noted in GAP_ANALYSIS.md §1.7
// (machineData/jobData/processData/alarmData).

export const telemetrySchema = z.object({
  schemaVersion: z.string(),
  machineId: z.string(),
  timestamp: z.string().datetime(),
  machineData: z.object({
    status: z.string(),
  }),
  processData: z.object({
    cycleTimeSec: z.number().optional(),
    shotCount: z.number().int().optional(),
    injectionPressureBar: z.number().optional(),
    barrelTemperatureC: z.number().optional(),
  }),
});
export type TelemetryPayload = z.infer<typeof telemetrySchema>;

export const jobSchema = z.object({
  schemaVersion: z.string(),
  machineId: z.string(),
  timestamp: z.string().datetime(),
  jobData: z.object({
    jobNumber: z.string(),
    event: z.enum(["START", "UPDATE", "END"]),
    productCode: z.string().optional(),
    moldId: z.string().optional(),
    recipeId: z.string().optional(),
    goodQty: z.number().int().optional(),
    rejectQty: z.number().int().optional(),
    startupScrapQty: z.number().int().optional(),
  }),
});
export type JobPayload = z.infer<typeof jobSchema>;

export const alarmSchema = z.object({
  schemaVersion: z.string(),
  machineId: z.string(),
  timestamp: z.string().datetime(),
  alarmData: z.object({
    event: z.enum(["RAISE", "CLEAR"]),
    alarmCode: z.string(),
    alarmMessage: z.string().optional(),
    jobNumber: z.string().optional(),
  }),
});
export type AlarmPayload = z.infer<typeof alarmSchema>;
