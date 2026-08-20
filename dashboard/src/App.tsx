import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import OperatorView from "./pages/OperatorView";
import AdminView from "./pages/AdminView";
import HistoryView from "./pages/HistoryView";
import KpiView from "./pages/KpiView";

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ display: "flex", gap: 16, padding: 12, borderBottom: "1px solid #d0d7de", fontFamily: "sans-serif" }}>
        <Link to="/">Operator</Link>
        <Link to="/history">History</Link>
        <Link to="/kpi">Executive KPI</Link>
        <Link to="/admin">Admin</Link>
      </nav>
      <Routes>
        <Route path="/" element={<OperatorView />} />
        <Route path="/history" element={<HistoryView />} />
        <Route path="/kpi" element={<KpiView />} />
        <Route path="/admin" element={<AdminView />} />
      </Routes>
    </BrowserRouter>
  );
}
