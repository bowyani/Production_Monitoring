import { prisma } from "./db/client";
import { broadcast } from "./ws/live";
import { config } from "./config";
import { logAudit } from "./audit";

// Catches machines that stopped publishing entirely (as opposed to a clean
// disconnect an MQTT Last Will could catch) — see README.md ("Design Rationale" section).
export function startWatchdog() {
  setInterval(async () => {
    const thresholdMs = config.watchdogOfflineThresholdSec * 1000;
    const cutoff = new Date(Date.now() - thresholdMs);

    const stale = await prisma.machine.findMany({
      where: {
        isActive: true,
        status: { not: "OFFLINE" },
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
      },
    });

    for (const machine of stale) {
      await prisma.machineStatusEvent.create({
        data: {
          machineId: machine.machineId,
          fromStatus: machine.status,
          toStatus: "OFFLINE",
          changedAt: new Date(),
        },
      });
      await prisma.machine.update({
        where: { machineId: machine.machineId },
        data: { status: "OFFLINE" },
      });
      broadcast("status", { machineId: machine.machineId, status: "OFFLINE" });
      // actor "watchdog" (not "admin-ui"/"erp-ui") marks this as a
      // system-triggered action, not a human click — see AuditLogView styling.
      await logAudit("watchdog", "MACHINE_OFFLINE_DETECTED", "machine", machine.machineId, {
        previousStatus: machine.status,
        lastSeenAt: machine.lastSeenAt,
      });
      console.warn(`[watchdog] marked ${machine.machineId} OFFLINE`);
    }
  }, 5000);
}
