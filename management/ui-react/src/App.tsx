import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import UsersPage from "./pages/Users";
import AliasesPage from "./pages/Aliases";
import SecurityPage from "./pages/Security";
import DnsPage from "./pages/Dns";
import Placeholder from "./pages/Placeholder";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/users" element={<RequireAuth><UsersPage /></RequireAuth>} />
      <Route path="/aliases" element={<RequireAuth><AliasesPage /></RequireAuth>} />
      <Route path="/security" element={<RequireAuth><SecurityPage /></RequireAuth>} />
      <Route path="/dns" element={<RequireAuth><DnsPage /></RequireAuth>} />
      <Route
        path="/tls"
        element={<RequireAuth><Placeholder title="TLS Certificates" note="Certificate status and provisioning are coming to the new panel. Use the classic panel at /admin-old for now." /></RequireAuth>}
      />
      <Route
        path="/web"
        element={<RequireAuth><Placeholder title="Web" note="Static website hosting settings are coming to the new panel. Use the classic panel at /admin-old for now." /></RequireAuth>}
      />
      <Route
        path="/backups"
        element={<RequireAuth><Placeholder title="Backups" note="Backup status and configuration are coming to the new panel. Use the classic panel at /admin-old for now." /></RequireAuth>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
