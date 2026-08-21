import Docker from "dockerode";
import { config } from "../config";

// Talks to the Docker Engine API over the socket mounted into this container
// (docker-compose.yml: /var/run/docker.sock) to launch/stop a simulator
// container per machine — this is what removes the need to manually run
// `docker compose run -d --rm --name simulator-IMM-04 ...` from Admin.
//
// This only works because every "machine" in this prototype IS a Docker
// container we control. A real PLC obviously isn't — this module is a
// prototype-only convenience layer, not something that survives contact
// with a real factory floor. See README "IT / System Health" page.
const docker = config.dockerEnabled ? new Docker() : null;

function containerName(machineId: string) {
  return `simulator-${machineId}`;
}

// Looked up by the production-monitoring.machineId label, not by container
// name — a machine's simulator isn't necessarily one we created ourselves.
// docker-compose.yml's hardcoded simulator-01/02/03 services carry this same
// label (see docker-compose.yml), so ensure/stop below see and control those
// too instead of creating a second, colliding container for the same
// machineId. A name-based lookup missed those entirely, which is what let a
// backend-managed container get created alongside a compose one publishing
// the same MACHINE_ID — duplicate telemetry for one machine.
async function findContainer(machineId: string) {
  if (!docker) return null;
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`production-monitoring.machineId=${machineId}`] },
  });
  return containers[0] ?? null;
}

export async function ensureSimulatorContainer(machineId: string, machineName: string) {
  if (!docker) return { ok: false, reason: "docker management disabled" };
  try {
    const existing = await findContainer(machineId);
    if (existing) {
      if (existing.State !== "running") {
        await docker.getContainer(existing.Id).start();
      }
      return { ok: true, reused: true };
    }

    const container = await docker.createContainer({
      name: containerName(machineId),
      Image: config.simulatorImage,
      Env: [
        `MACHINE_ID=${machineId}`,
        `MACHINE_NAME=${machineName}`,
        `MQTT_BROKER_URL=${config.simulatorMqttBrokerUrl}`,
        `BACKEND_API_URL=${config.simulatorBackendApiUrl}`,
      ],
      HostConfig: {
        NetworkMode: config.dockerNetwork,
        RestartPolicy: { Name: "no" },
      },
      Labels: { "production-monitoring.role": "simulator", "production-monitoring.machineId": machineId },
    });
    await container.start();
    return { ok: true, reused: false };
  } catch (err) {
    console.warn(`[docker] could not start simulator for ${machineId}: ${(err as Error).message}`);
    return { ok: false, reason: (err as Error).message };
  }
}

export async function stopSimulatorContainer(machineId: string) {
  if (!docker) return { ok: false, reason: "docker management disabled" };
  try {
    const existing = await findContainer(machineId);
    if (!existing) return { ok: true, reason: "no managed container for this machine" };
    if (existing.State === "running") {
      await docker.getContainer(existing.Id).stop({ t: 3 });
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[docker] could not stop simulator for ${machineId}: ${(err as Error).message}`);
    return { ok: false, reason: (err as Error).message };
  }
}
