import { useEffect, useMemo, useState } from "react";
import { api, SIMULATOR_DEFAULT_TUNING, type Machine, type SimulatorTuning } from "../lib/api";
import { useLiveSocket } from "../lib/useLiveSocket";

type FieldKey = keyof SimulatorTuning;

type FieldDef = {
  key: FieldKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  toDisplay?: (v: number) => string;
};

const RELIABILITY_FIELDS: FieldDef[] = [
  {
    key: "silentProbability",
    label: "Go-silent chance per tick",
    hint: "Publishes nothing for a few ticks without disconnecting — what the OFFLINE watchdog is meant to catch.",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "%",
    toDisplay: (v) => (v * 100).toFixed(0),
  },
  {
    key: "alarmProbability",
    label: "Alarm chance per tick (while RUN)",
    hint: "Raises a random fault code (over-temp, pressure, hydraulic, etc.) and holds it for a few ticks.",
    min: 0,
    max: 0.2,
    step: 0.001,
    unit: "%",
    toDisplay: (v) => (v * 100).toFixed(1),
  },
  {
    key: "rejectProbability",
    label: "Reject rate per shot",
    hint: "Share of shots (after startup scrap) that come out as reject instead of good.",
    min: 0,
    max: 0.3,
    step: 0.005,
    unit: "%",
    toDisplay: (v) => (v * 100).toFixed(1),
  },
  {
    key: "startupScrapQty",
    label: "Startup scrap",
    hint: "Shots after a mold/job change counted as purge scrap rather than reject (GAP_ANALYSIS §1.2).",
    min: 0,
    max: 20,
    step: 1,
    unit: " shots",
  },
];

const RANGE_FIELDS: { pair: [FieldDef, FieldDef]; title: string }[] = [
  {
    title: "Cycle time (sec)",
    pair: [
      { key: "cycleTimeMinSec", label: "Min", hint: "", min: 1, max: 60, step: 0.5, unit: "s" },
      { key: "cycleTimeMaxSec", label: "Max", hint: "", min: 1, max: 60, step: 0.5, unit: "s" },
    ],
  },
  {
    title: "Injection pressure (bar)",
    pair: [
      { key: "pressureMinBar", label: "Min", hint: "", min: 0, max: 1500, step: 10, unit: "bar" },
      { key: "pressureMaxBar", label: "Max", hint: "", min: 0, max: 1500, step: 10, unit: "bar" },
    ],
  },
  {
    title: "Barrel temperature (°C)",
    pair: [
      { key: "temperatureMinC", label: "Min", hint: "", min: 0, max: 350, step: 1, unit: "°C" },
      { key: "temperatureMaxC", label: "Max", hint: "", min: 0, max: 350, step: 1, unit: "°C" },
    ],
  },
];

const TICK_FIELD: FieldDef = {
  key: "tickMs",
  label: "Tick interval",
  hint: "How often the simulator publishes a telemetry/job update. Lower = faster-moving demo.",
  min: 500,
  max: 8000,
  step: 100,
  unit: "ms",
};

function Slider({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{field.label}</span>
        <strong>
          {field.toDisplay ? field.toDisplay(value) : value}
          {field.unit}
        </strong>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      {field.hint && (
        <div style={{ fontSize: 12, color: "#57606a" }}>{field.hint}</div>
      )}
    </div>
  );
}

export default function SimulatorTuningView() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [live, setLive] = useState<SimulatorTuning | null>(null);
  const [draft, setDraft] = useState<SimulatorTuning | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminListMachines()
      .then((all) => {
        const simulated = all.filter((m) => m.dataSource === "MQTT");
        setMachines(simulated);
        if (simulated.length > 0) setMachineId((prev) => prev || simulated[0].machineId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function load(id: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    api
      .getSimulatorParams(id)
      .then((res) => {
        setLive(res.tuning);
        setDraft(res.tuning ?? { ...SIMULATOR_DEFAULT_TUNING });
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        // Still let the operator stage changes against defaults even if the
        // initial fetch failed (e.g. backend not yet updated, MQTT down) —
        // Apply will surface its own error if the PATCH also fails.
        setLive(null);
        setDraft({ ...SIMULATOR_DEFAULT_TUNING });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (machineId) load(machineId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  // The simulator echoes its tuning back retained over MQTT the moment it
  // applies a patch (see simulator/src/index.ts publishTuningState), so a
  // successful save reflects here without polling.
  useLiveSocket((msg) => {
    if (msg.event !== "simulatorParams") return;
    if (msg.data.machineId !== machineId) return;
    setLive(msg.data.tuning as SimulatorTuning);
  });

  const dirty = useMemo(() => {
    if (!draft || !live) return draft != null;
    return (Object.keys(draft) as FieldKey[]).some((k) => draft[k] !== live[k]);
  }, [draft, live]);

  function setField(key: FieldKey, value: number) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.patchSimulatorParams(machineId, draft);
      setNotice(`Applied — ${machineId}'s simulator picks this up on its next tick.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    setDraft({ ...SIMULATOR_DEFAULT_TUNING });
  }

  return (
    <div className="app-shell">
      <div className="page-title">
        <h1>Simulator Tuning</h1>
        <div className="page-subtitle">
          Live-adjust the probabilities and process ranges a simulated machine uses to generate telemetry —
          no container restart needed. Values are pushed over MQTT (retained on <code>factory/&lt;id&gt;/control</code>)
          and only affect MQTT/simulator-backed machines; MANUAL machines have no simulator to tune.
        </div>
      </div>

      <section>
        <h2>Machine</h2>
        <div className="toolbar">
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} style={{ minWidth: 260 }}>
            {machines.length === 0 && <option value="">No simulator-backed machines</option>}
            {machines.map((m) => (
              <option key={m.machineId} value={m.machineId}>
                {m.machineId} — {m.machineName}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => machineId && load(machineId)} disabled={!machineId || loading}>
            Refresh
          </button>
          {live == null && !loading && machineId && !error && (
            <span style={{ fontSize: 12, color: "#9a6700" }}>
              No tuning state seen yet from this simulator — showing defaults. It publishes its current values
              as soon as it connects to MQTT.
            </span>
          )}
        </div>
      </section>

      {draft && (
        <>
          <section>
            <h2>Reliability &amp; faults</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
              {RELIABILITY_FIELDS.map((f) => (
                <Slider key={f.key} field={f} value={draft[f.key]} onChange={(v) => setField(f.key, v)} />
              ))}
            </div>
          </section>

          <section>
            <h2>Process ranges</h2>
            <p style={{ fontSize: 12, color: "#57606a" }}>
              Telemetry random-walks within these bounds each tick. Min is clamped to never exceed max.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
              {RANGE_FIELDS.map(({ title, pair }) => (
                <div key={title} className="card" style={{ display: "grid", gap: 12 }}>
                  <h3>{title}</h3>
                  {pair.map((f) => (
                    <Slider key={f.key} field={f} value={draft[f.key]} onChange={(v) => setField(f.key, v)} />
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>Timing</h2>
            <div style={{ maxWidth: 420 }}>
              <Slider field={TICK_FIELD} value={draft.tickMs} onChange={(v) => setField(TICK_FIELD.key, v)} />
            </div>
          </section>

          <section>
            <div className="toolbar">
              <button type="button" onClick={save} disabled={saving || !dirty}>
                {saving ? "Applying…" : "Apply changes"}
              </button>
              <button type="button" onClick={resetToDefaults} disabled={saving}>
                Reset to defaults
              </button>
              {!dirty && live != null && (
                <span style={{ fontSize: 12, color: "#57606a" }}>Matches the simulator's current values.</span>
              )}
            </div>
            {notice && <div className="notice notice-success">{notice}</div>}
            {error && <div className="notice notice-error">{error}</div>}
          </section>
        </>
      )}
    </div>
  );
}
