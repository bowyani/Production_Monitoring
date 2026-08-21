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

function parseNonNegativeInt(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

type ValidRow = {
  jobNumber: string;
  data: {
    machineId: string;
    productCode: string;
    moldId: string | null;
    recipeId: string | null;
    startTime: Date;
    endTime: Date | null;
    goodQty: number;
    rejectQty: number;
    startupScrapQty: number;
    status: string;
  };
};

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

  // Validate every row before writing anything — a bad row anywhere in the
  // file rejects the whole import. Partial imports would leave an operator
  // unsure which of their rows actually landed, which defeats the point of
  // a fallback meant to replace an error-prone paper process.
  const validRows: ValidRow[] = [];
  const failed: { row: number; error: string }[] = [];
  const seenJobNumbers = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // header is row 1, so first data row is row 2
    const cells = rows[i];
    if (cells.length !== header.length) {
      failed.push({ row: rowNum, error: `expected ${header.length} columns, got ${cells.length}` });
      continue;
    }
    const record = Object.fromEntries(header.map((h, idx) => [h, cells[idx]]));
    const rowErrors: string[] = [];

    if (!record.jobNumber) {
      rowErrors.push("jobNumber is required");
    } else if (seenJobNumbers.has(record.jobNumber)) {
      rowErrors.push(`duplicate jobNumber "${record.jobNumber}" (already used earlier in this file)`);
    } else {
      seenJobNumbers.add(record.jobNumber);
    }

    if (!record.productCode) rowErrors.push("productCode is required");

    const startTime = record.startTime ? new Date(record.startTime) : null;
    if (!startTime || isNaN(startTime.getTime())) {
      rowErrors.push(`invalid startTime "${record.startTime}" (expected ISO 8601, e.g. 2026-08-19T08:00:00Z)`);
    }

    let endTime: Date | null = null;
    if (record.endTime) {
      endTime = new Date(record.endTime);
      if (isNaN(endTime.getTime())) {
        rowErrors.push(`invalid endTime "${record.endTime}" (expected ISO 8601, e.g. 2026-08-19T16:00:00Z)`);
      }
    }

    const goodQty = parseNonNegativeInt(record.goodQty ?? "");
    if (goodQty === null) rowErrors.push(`invalid goodQty "${record.goodQty}" (must be a whole number ≥ 0)`);

    const rejectQty = parseNonNegativeInt(record.rejectQty ?? "");
    if (rejectQty === null) rowErrors.push(`invalid rejectQty "${record.rejectQty}" (must be a whole number ≥ 0)`);

    let startupScrapQty = 0;
    if (record.startupScrapQty) {
      const v = parseNonNegativeInt(record.startupScrapQty);
      if (v === null) {
        rowErrors.push(`invalid startupScrapQty "${record.startupScrapQty}" (must be a whole number ≥ 0)`);
      } else {
        startupScrapQty = v;
      }
    }

    if (rowErrors.length > 0) {
      failed.push({ row: rowNum, error: rowErrors.join("; ") });
      continue;
    }

    validRows.push({
      jobNumber: record.jobNumber,
      data: {
        machineId,
        productCode: record.productCode,
        moldId: record.moldId || null,
        recipeId: record.recipeId || null,
        startTime: startTime as Date,
        endTime,
        goodQty: goodQty as number,
        rejectQty: rejectQty as number,
        startupScrapQty,
        status: record.status || (endTime ? "DONE" : "RUNNING"),
      },
    });
  }

  if (failed.length > 0) {
    res.json({ created: 0, updated: 0, failed, totalRows: rows.length });
    return;
  }

  let created = 0;
  let updated = 0;
  for (const row of validRows) {
    const existing = await prisma.productionJob.findUnique({ where: { jobNumber: row.jobNumber } });
    await prisma.productionJob.upsert({
      where: { jobNumber: row.jobNumber },
      create: { jobNumber: row.jobNumber, ...row.data },
      update: row.data,
    });
    if (existing) updated++;
    else created++;
  }

  await logAudit("admin-ui", "JOBS_IMPORTED", "machine", machineId, {
    created,
    updated,
    totalRows: rows.length,
  });

  res.json({ created, updated, failed: [], totalRows: rows.length });
});
