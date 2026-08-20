import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import OperatorView from "./pages/OperatorView";
import AdminView from "./pages/AdminView";

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ display: "flex", gap: 16, padding: 12, borderBottom: "1px solid #d0d7de", fontFamily: "sans-serif" }}>
        <Link to="/">Operator</Link>
        <Link to="/admin">Admin</Link>
      </nav>
      <Routes>
        <Route path="/" element={<OperatorView />} />
        <Route path="/admin" element={<AdminView />} />
      </Routes>
    </BrowserRouter>
  );
}
