import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { logAudit } from "../audit";

export const importRouter = Router();

// CSV/manual-entry fallback for machines that can't connect at all — this is
// what GAP_ANALYSIS §1.4 calls out as required for real deployments ("โรงงาน
// จริงมีเครื่องเก่าที่เชื่อมไม่ได้ปนอยู่ — ต้องมี manual data entry fallback").
// It bypasses MQTT entirely: rows go straight into production_jobs, exactly
// what an operator would otherwise still be writing on paper/Excel.
const importSchema = z.object({
  machineId: z.string().min(1),
  csvText: z.string().min(1),
});

const REQUIRED_COLUMNS = [
  "jobNumber",
  "productCode",
  "startTime",
  "goodQty",
  "rejectQty",
] as const;
const OPTIONAL_COLUMNS = ["moldId", "recipeId", "endTime", "startupScrapQty", "status"] as const;

// Deliberately not using a CSV library: the expected input is simple,
// comma-separated, unquoted (no embedded commas/newlines in fields). Good
// enough for the manual-entry use case this serves; a quoted-field parser
// would be the first thing to add if this outgrows that assumption.
function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  return { header, rows };
}

importRouter.post("/admin/import/jobs", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { machineId, csvText } = parsed.data;

  const machine = await prisma.machine.findUnique({ where: { machineId } });
  if (!machine) {
    res.status(404).json({ error: `machine ${machineId} is not registered — add it in Admin first` });
    return;
  }

  const { header, rows } = parseCsv(csvText);
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) {
    res.status(400).json({
      error: `missing required column(s): ${missingColumns.join(", ")}`,
      expectedColumns: [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS],
    });
    return;
  }

  let created = 0;
  let updated = 0;
  const failed: { row: number; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length !== header.length) {
      failed.push({ row: i + 2, error: `expected ${header.length} columns, got ${cells.length}` });
      continue;
    }
    const record = Object.fromEntries(header.map((h, idx) => [h, cells[idx]]));
    try {
      const startTime = new Date(record.startTime);
      if (isNaN(startTime.getTime())) throw new Error(`invalid startTime "${record.startTime}"`);
      const endTime = record.endTime ? new Date(record.endTime) : null;
      if (endTime && isNaN(endTime.getTime())) throw new Error(`invalid endTime "${record.endTime}"`);

      const data = {
        machineId,
        productCode: record.productCode,
        moldId: record.moldId || null,
        recipeId: record.recipeId || null,
        startTime,
        endTime,
        goodQty: Number(record.goodQty) || 0,
        rejectQty: Number(record.rejectQty) || 0,
        startupScrapQty: Number(record.startupScrapQty) || 0,
        status: record.status || (endTime ? "DONE" : "RUNNING"),
      };

      const existing = await prisma.productionJob.findUnique({ where: { jobNumber: record.jobNumber } });
      await prisma.productionJob.upsert({
        where: { jobNumber: record.jobNumber },
        create: { jobNumber: record.jobNumber, ...data },
        update: data,
      });
      if (existing) updated++;
      else created++;
    } catch (err) {
      failed.push({ row: i + 2, error: (err as Error).message });
    }
  }

  await logAudit("admin-ui", "JOBS_IMPORTED", "machine", machineId, {
    created,
    updated,
    failedCount: failed.length,
  });

  res.json({ created, updated, failed, totalRows: rows.length });
});
