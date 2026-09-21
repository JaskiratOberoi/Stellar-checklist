import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell';
import { LoginPage } from './features/auth/LoginPage';
import { TodayPage } from './features/today/TodayPage';
import { AlertsPage } from './features/today/AlertsPage';
import { MorePage } from './features/today/MorePage';
import { CountPage } from './features/count/CountPage';
import { CountsPage } from './features/count/CountsPage';
import { StockPage } from './features/stock/StockPage';
import { ReceivePage } from './features/stock/ReceivePage';
import { MovePage } from './features/stock/MovePage';
import { MovementsPage } from './features/stock/MovementsPage';
import { InstrumentsPage } from './features/instruments/InstrumentsPage';
import { BuItemsPage } from './features/items/BuItemsPage';
import { SnapshotsPage } from './features/snapshots/SnapshotsPage';
import { CataloguePage } from './features/catalogue/CataloguePage';
import { BusPage } from './features/admin/BusPage';
import { UsersPage } from './features/admin/UsersPage';
import { ApiKeysPage } from './features/admin/ApiKeysPage';
import { AuditPage } from './features/admin/AuditPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { useAuth } from './auth/AuthProvider';

function Guard({ cap, children }: { cap: string; children: JSX.Element }) {
  const { can } = useAuth();
  return can(cap) ? children : <Navigate to="/today" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/counts" element={<CountsPage />} />
          <Route path="/count/:countId" element={<CountPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/stock/receive" element={<ReceivePage />} />
          <Route path="/stock/move" element={<MovePage />} />
          <Route path="/stock/movements" element={<MovementsPage />} />
          <Route path="/instruments" element={<Guard cap="bu.instruments"><InstrumentsPage /></Guard>} />
          <Route path="/items" element={<Guard cap="bu.items"><BuItemsPage /></Guard>} />
          <Route path="/snapshots" element={<SnapshotsPage />} />
          <Route path="/catalogue/*" element={<Guard cap="catalogue"><CataloguePage /></Guard>} />
          <Route path="/admin/bus" element={<Guard cap="bus"><BusPage /></Guard>} />
          <Route path="/admin/users" element={<Guard cap="users"><UsersPage /></Guard>} />
          <Route path="/admin/keys" element={<Guard cap="api_keys"><ApiKeysPage /></Guard>} />
          <Route path="/admin/audit" element={<Guard cap="audit"><AuditPage /></Guard>} />
          <Route path="/reports/*" element={<Guard cap="reports"><ReportsPage /></Guard>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
