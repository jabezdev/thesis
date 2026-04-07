import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AdminGuard } from "./components/AdminGuard";
import { Layout } from "./components/Layout";

// Pages
import Overview from "./pages/Overview";
import Nodes from "./pages/Nodes";
import Calibration from "./pages/Calibration";
import UserAccess from "./pages/UserAccess";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <AdminGuard>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Overview />} />
            <Route path="/nodes" element={<Nodes />} />
            <Route path="/calibration" element={<Calibration />} />
            <Route path="/users" element={<UserAccess />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AdminGuard>
    </BrowserRouter>
  );
}

export default App;
