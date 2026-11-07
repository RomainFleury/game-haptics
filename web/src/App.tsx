import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { GamesPage } from "./pages/GamesPage";
import { IntegrationPage } from "./pages/IntegrationPage";
import { DebugPage } from "./pages/DebugPage";
import { MiniGamesPage } from "./pages/MiniGamesPage";
import { GamePage } from "./pages/GamePage";
import { VestsPage } from "./pages/VestsPage";
import { RecoilPage } from "./pages/RecoilPage";
import { RecoilLinkPage } from "./pages/RecoilLinkPage";
import { RecoilFlashPage } from "./pages/RecoilFlashPage";
import { DaemonSettingsPage } from "./pages/DaemonSettingsPage";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/games" replace />} />
          <Route path="games" element={<GamesPage />} />
          <Route path="games/:gameId/*" element={<IntegrationPage />} />
          <Route path="debug" element={<DebugPage />} />
          <Route path="recoil" element={<RecoilPage />} />
          <Route path="recoil-link" element={<RecoilLinkPage />} />
          <Route path="recoil-link/flash" element={<RecoilFlashPage />} />
          <Route path="recoil/flash" element={<Navigate to="/recoil-link/flash" replace />} />
          <Route path="daemon-settings" element={<DaemonSettingsPage />} />
          <Route path="relay" element={<Navigate to="/recoil" replace />} />
          <Route path="vests" element={<VestsPage />} />
          <Route path="mini-games" element={<MiniGamesPage />} />
          <Route path="mini-games/:gameId" element={<GamePage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
