import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import OperatorView from "./pages/OperatorView";
import AdminView from "./pages/AdminView";
import HistoryView from "./pages/HistoryView";
import KpiView from "./pages/KpiView";
import ErpView from "./pages/ErpView";
import ChiefOperatorView from "./pages/ChiefOperatorView";
import AuditLogView from "./pages/AuditLogView";
import ImportView from "./pages/ImportView";

const NAV_GROUPS: { label: string; links: { to: string; label: string; end?: boolean }[] }[] = [
  {
    label: "Floor",
    links: [
      { to: "/", label: "Operator", end: true },
      { to: "/history", label: "History" },
    ],
  },
  {
    label: "Performance",
    links: [
      { to: "/kpi", label: "Executive KPI" },
      { to: "/chief-operator", label: "Chief Operator" },
    ],
  },
  {
    label: "Master Data",
    links: [
      { to: "/erp", label: "ERP" },
      { to: "/import", label: "Import" },
    ],
  },
  {
    label: "System",
    links: [
      { to: "/admin", label: "Admin" },
      { to: "/audit-log", label: "Audit Log" },
    ],
  },
];

export default function App() {
  return (
    <BrowserRouter>
      <header className="app-nav">
        <div className="app-nav-inner">
          <span className="app-nav-brand">Production Monitoring</span>
          <nav className="app-nav-groups">
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                <div className="nav-group-links">
                  {group.links.map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      end={link.end}
                      className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<OperatorView />} />
        <Route path="/history" element={<HistoryView />} />
        <Route path="/kpi" element={<KpiView />} />
        <Route path="/erp" element={<ErpView />} />
        <Route path="/chief-operator" element={<ChiefOperatorView />} />
        <Route path="/admin" element={<AdminView />} />
        <Route path="/import" element={<ImportView />} />
        <Route path="/audit-log" element={<AuditLogView />} />
      </Routes>
    </BrowserRouter>
  );
}
