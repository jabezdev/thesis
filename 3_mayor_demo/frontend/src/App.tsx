import { Routes, Route } from 'react-router-dom';
import PublicView from './pages/PublicView';
import DashboardView from './pages/DashboardView';

function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicView />} />
      <Route path="/dashboard" element={<DashboardView />} />
    </Routes>
  );
}

export default App;
