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
export type DonutSlice = { key: string; label: string; value: number; color: string };
// `group` clusters bars tightly together (e.g. every product a model makes)
// with a wider gap between groups, so the chart reads as "one cluster per
// model" instead of a flat row of evenly-spaced bars.
export type GroupedStackedDatum = { group: string; label: string; segments: StackedSegment[]; tooltip: string };

// Dependency-free SVG donut (conic-gradient via stroke-dasharray on stacked
// circles) — same "no charting library" convention as the bar charts above.
export function DonutChart({
  data,
  size = 140,
  thickness = 22,
  formatValue = (v: number) => String(v),
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  formatValue?: (v: number) => string;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f6f8fa" strokeWidth={thickness} />
        {total > 0 &&
          data
            .filter((d) => d.value > 0)
            .map((d) => {
              // Percentage is always relative to this donut's own total, not
              // to any other dataset — that's the whole point of drawing a
              // separate donut per model rather than one shared chart.
              const fraction = d.value / total;
              const dash = fraction * circumference;
              const el = (
                <circle
                  key={d.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                >
                  <title>{`${d.label}: ${formatValue(d.value)} (${(fraction * 100).toFixed(0)}%)`}</title>
                </circle>
              );
              offset += dash;
              return el;
            })}
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 16, fontWeight: 700 }}>
          {formatValue(total)}
        </text>
      </svg>
      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
        {data.map((d) => (
          <span key={d.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, background: d.color, borderRadius: 2, display: "inline-block", flexShrink: 0 }} />
            {d.label}: <strong>{formatValue(d.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// Grouped/stacked bars for comparing categories that split a whole (e.g.
// downtime hours split into intentional vs error vs offline, or production
// quantity split into good/reject/startup scrap). `formatValue` controls
// both the per-segment tooltip and the trailing total — defaults to the
// original "12.3h" downtime formatting so existing callers are unaffected.
export function StackedBarChart({
  data,
  formatValue = (v: number) => `${v.toFixed(1)}h`,
}: {
  data: StackedDatum[];
  formatValue?: (v: number) => string;
}) {
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
                  <div key={s.key} style={{ width: `${(s.value / (total || 1)) * 100}%`, background: s.color }} title={`${s.label}: ${formatValue(s.value)}`} />
                ) : null
              )}
            </div>
            <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", minWidth: 60, textAlign: "right" }}>
              {formatValue(total)}
            </div>
          </div>
        );
      })}
      {data.length === 0 && <div style={{ fontSize: 13, color: "#57606a" }}>No data.</div>}
    </div>
  );
}

// Vertical stacked columns, tightly clustered by `group` (wide gap between
// groups, narrow gap within one) — e.g. every product a model makes, so the
// chart reads as "one cluster per model" at a glance. Bars carry no on-bar
// text (labels get cramped fast); the full breakdown is a native hover
// tooltip via `tooltip` instead.
export function VerticalGroupedStackedBarChart({ data, height = 200 }: { data: GroupedStackedDatum[]; height?: number }) {
  const max = Math.max(1e-9, ...data.map((d) => d.segments.reduce((a, s) => a + s.value, 0)));
  const groups = new Map<string, GroupedStackedDatum[]>();
  for (const d of data) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(d);
  }
  const legend = data[0]?.segments ?? [];
  const barAreaHeight = height - 24;

  return (
    <div style={{ display: "grid", gap: 12 }}>
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
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, overflowX: "auto", paddingBottom: 4 }}>
        {[...groups.entries()].map(([groupName, items]) => (
          <div key={groupName} style={{ display: "grid", gap: 6, justifyItems: "center" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: barAreaHeight }}>
              {items.map((d) => {
                const total = d.segments.reduce((a, s) => a + s.value, 0);
                const barPx = Math.max(2, (total / max) * barAreaHeight);
                return (
                  <div
                    key={d.label}
                    title={d.tooltip}
                    style={{
                      width: 26,
                      height: barPx,
                      display: "flex",
                      flexDirection: "column-reverse",
                      borderRadius: "3px 3px 0 0",
                      overflow: "hidden",
                      background: "#f6f8fa",
                    }}
                  >
                    {d.segments.map((s) =>
                      s.value > 0 ? (
                        <div key={s.key} style={{ height: `${(s.value / (total || 1)) * 100}%`, background: s.color }} />
                      ) : null
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "#57606a", maxWidth: items.length * 29, textAlign: "center", overflowWrap: "break-word" }}>
              {groupName}
            </div>
          </div>
        ))}
      </div>
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
