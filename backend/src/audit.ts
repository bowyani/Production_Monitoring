import { prisma } from "./db/client";

export async function logAudit(
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  detail?: unknown
) {
  await prisma.auditLog.create({
    data: {
      actor,
      action,
      targetType,
      targetId,
      detail: detail !== undefined ? JSON.stringify(detail) : undefined,
    },
  });
}
