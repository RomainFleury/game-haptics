import { useParams, Navigate, Routes, Route } from "react-router-dom";
import { 
  CS2IntegrationPage, 
  AlyxIntegrationPage,
  L4D2IntegrationPage,
  PistolWhipIntegrationPage,
  BattleSisterIntegrationPage,
  GunmanContractsIntegrationPage,
  ScreenHealthIntegrationPage,
  ScreenHealthBuilderPage,
  ScreenHealthSettingsPage,
  ScreenHealthPreviewPage,
} from "./integrations";

/**
 * Map of game IDs to their integration page components
 */
const INTEGRATION_PAGES: Record<string, React.ComponentType> = {
  cs2: CS2IntegrationPage,
  alyx: AlyxIntegrationPage,
  l4d2: L4D2IntegrationPage,
  pistolwhip: PistolWhipIntegrationPage,
  battlesister: BattleSisterIntegrationPage,
  gunmancontracts: GunmanContractsIntegrationPage,
  screen_health: ScreenHealthIntegrationPage,
};

const INTEGRATION_SUBPAGES: Record<string, { 
  calibration?: React.ComponentType;
  settings?: React.ComponentType;
  builder?: React.ComponentType;
  preview?: React.ComponentType;
}> = {
  screen_health: { 
    calibration: ScreenHealthBuilderPage,
    settings: ScreenHealthSettingsPage,
    builder: ScreenHealthBuilderPage,
    preview: ScreenHealthPreviewPage,
  },
};

/**
 * Router component for individual game integration pages
 */
export function IntegrationPage() {
  const { gameId } = useParams<{ gameId: string }>();
  
  if (!gameId) {
    return <Navigate to="/games" replace />;
  }

  const PageComponent = INTEGRATION_PAGES[gameId];
  const sub = INTEGRATION_SUBPAGES[gameId] || {};
  
  if (!PageComponent) {
    // Game not found or not yet implemented
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="rounded-2xl bg-slate-800/80 p-8 text-center">
          <span className="text-6xl mb-4 block">🚧</span>
          <h1 className="text-2xl font-bold text-white mb-2">Coming Soon</h1>
          <p className="text-slate-400 mb-6">
            The integration page for this game is not yet available.
          </p>
          <a
            href="#/games"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600/80 px-4 py-2 font-medium text-white transition hover:bg-blue-600"
          >
            ← Back to Games
          </a>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route index element={<PageComponent />} />
      {sub.calibration && <Route path="calibration" element={<sub.calibration />} />}
      {sub.settings && <Route path="settings" element={<sub.settings />} />}
      {sub.builder && <Route path="builder" element={<sub.builder />} />}
      {sub.preview && <Route path="preview/:id" element={<sub.preview />} />}
      <Route path="*" element={<Navigate to={`/games/${gameId}`} replace />} />
    </Routes>
  );
}
