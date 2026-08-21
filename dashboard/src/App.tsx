import { useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router-dom";
import OperatorView from "./pages/OperatorView";
import AdminView from "./pages/AdminView";
import KpiView from "./pages/KpiView";
import ErpView from "./pages/ErpView";
import ChiefOperatorView from "./pages/ChiefOperatorView";
import ProductionView from "./pages/ProductionView";
import PerformanceView from "./pages/PerformanceView";
import ImportView from "./pages/ImportView";
import SimulatorTuningView from "./pages/SimulatorTuningView";

const NAV_GROUPS: {
  label: string;
  links: { to: string; label: string; end?: boolean }[];
}[] = [
  {
    label: "Dashboard",
    links: [
      { to: "/", label: "Operation", end: true },
      { to: "/production", label: "Production" },
      { to: "/performance", label: "Performance" },
      { to: "/kpi", label: "Executive" },
    ],
  },
  {
    label: "Management",
    links: [
      { to: "/chief-operator", label: "Machine Management" },
      { to: "/import", label: "Manual Import" },
      { to: "/simulator-tuning", label: "Simulator Tuning" },
    ],
  },
  {
    label: "System Settings",
    links: [{ to: "/admin", label: "Admin" }],
  },
  {
    label: "Master Data (Mock)",
    links: [{ to: "/erp", label: "ERP" }],
  },
];

// React Router doesn't reset scroll on navigation — without this, clicking a
// nav link while scrolled down on a long page (Performance, Admin, ERP...)
// lands on the new page already scrolled past its own top, which makes the
// sticky header look broken/missing until the user manually scrolls back up.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
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
                      className={({ isActive }) =>
                        "nav-link" + (isActive ? " active" : "")
                      }
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
        <Route path="/production" element={<ProductionView />} />
        <Route path="/performance" element={<PerformanceView />} />
        <Route path="/kpi" element={<KpiView />} />
        <Route path="/erp" element={<ErpView />} />
        <Route path="/chief-operator" element={<ChiefOperatorView />} />
        <Route path="/admin" element={<AdminView />} />
        <Route path="/import" element={<ImportView />} />
        <Route path="/simulator-tuning" element={<SimulatorTuningView />} />
      </Routes>
    </BrowserRouter>
  );
}
