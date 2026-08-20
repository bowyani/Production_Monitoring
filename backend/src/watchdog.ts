import { prisma } from "./db/client";
import { broadcast } from "./ws/live";
import { config } from "./config";

// Catches machines that stopped publishing entirely (as opposed to a clean
// disconnect an MQTT Last Will could catch) — see DESIGN_RATIONALE.md §5.
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
      console.warn(`[watchdog] marked ${machine.machineId} OFFLINE`);
    }
  }, 5000);
}
