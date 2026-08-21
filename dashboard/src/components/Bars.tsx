// Minimal dependency-free bar charts (div-based, not a charting library) to
// keep with this dashboard's plain in-house styling rather than pulling in
// a new dependency for a handful of bars.
// `value` sizes the bar (use 0 for "no data" rather than omitting the row).
// `display`, when set, overrides the formatted text — use it to show "—"
// for a bar that's drawn at 0 only because the underlying value is missing,
// so a real zero and "no data" never look the same.
export type BarDatum = { label: string; value: number; sublabel?: string; display?: string };
export type StackedSegment = { key: string; value: number; color: string; label: string };
export type StackedDatum = { label: string; segments: StackedSegment[] };

// Grouped/stacked bars for comparing categories that split a whole (e.g.
// downtime hours split into intentional vs error vs offline).
export function StackedBarChart({ data }: { data: StackedDatum[] }) {
  const max = Math.max(1e-9, ...data.map((d) => d.segments.reduce((a, s) => a + s.value, 0)));
  const legend = data[0]?.segments ?? [];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {legend.length > 0 && (
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#57606a" }}>
          {legend.map((s) => (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {data.map((d) => {
        const total = d.segments.reduce((a, s) => a + s.value, 0);
        return (
          <div key={d.label} style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>
              {d.label}
            </div>
            <div style={{ display: "flex", height: 16, background: "#f6f8fa", borderRadius: 4, overflow: "hidden", width: `${Math.max(2, (total / max) * 100)}%` }}>
              {d.segments.map((s) =>
                s.value > 0 ? (
                  <div key={s.key} style={{ width: `${(s.value / (total || 1)) * 100}%`, background: s.color }} title={`${s.label}: ${s.value.toFixed(1)}h`} />
                ) : null
              )}
            </div>
            <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", minWidth: 60, textAlign: "right" }}>
              {total.toFixed(1)}h
            </div>
          </div>
        );
      })}
      {data.length === 0 && <div style={{ fontSize: 13, color: "#57606a" }}>No data.</div>}
    </div>
  );
}

export function HBarChart({
  data,
  color = "#0969da",
  formatValue = (v: number) => v.toFixed(1),
}: {
  data: BarDatum[];
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1e-9, ...data.map((d) => Math.abs(d.value)));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>
            {d.label}
            {d.sublabel && <div style={{ fontSize: 11, color: "#57606a" }}>{d.sublabel}</div>}
          </div>
          <div style={{ background: "#f6f8fa", borderRadius: 4, overflow: "hidden", height: 16 }}>
            <div
              style={{
                width: `${Math.max(2, (Math.abs(d.value) / max) * 100)}%`,
                background: color,
                height: "100%",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", minWidth: 70, textAlign: "right" }}>
            {d.display ?? formatValue(d.value)}
          </div>
        </div>
      ))}
      {data.length === 0 && <div style={{ fontSize: 13, color: "#57606a" }}>No data.</div>}
    </div>
  );
}

// Diverging bars around a zero baseline — for values that can be negative,
// e.g. margin (a bottleneck SKU can lose money, not just make less of it).
export function DivergingBarChart({
  data,
  positiveColor = "#1a7f37",
  negativeColor = "#cf222e",
  formatValue = (v: number) => v.toFixed(1),
}: {
  data: BarDatum[];
  positiveColor?: string;
  negativeColor?: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(1e-9, ...data.map((d) => Math.abs(d.value)));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {data.map((d) => {
        const pct = (Math.abs(d.value) / max) * 50;
        const isNeg = d.value < 0;
        return (
          <div key={d.label} style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>
              {d.label}
              {d.sublabel && <div style={{ fontSize: 11, color: "#57606a" }}>{d.sublabel}</div>}
            </div>
            <div style={{ position: "relative", height: 16, background: "#f6f8fa", borderRadius: 4 }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#d0d7de" }} />
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  height: "100%",
                  width: `${Math.max(1, pct)}%`,
                  background: isNeg ? negativeColor : positiveColor,
                  borderRadius: 3,
                  left: isNeg ? `${50 - Math.max(1, pct)}%` : "50%",
                }}
              />
            </div>
            <div
              style={{
                fontSize: 13,
                fontVariantNumeric: "tabular-nums",
                minWidth: 90,
                textAlign: "right",
                color: isNeg ? negativeColor : "inherit",
              }}
            >
              {d.display ?? formatValue(d.value)}
            </div>
          </div>
        );
      })}
      {data.length === 0 && <div style={{ fontSize: 13, color: "#57606a" }}>No data.</div>}
    </div>
  );
}
