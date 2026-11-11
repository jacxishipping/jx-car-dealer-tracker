// JX Car Dealer Tracker — app shell.
// HashRouter is used deliberately: the built app is served as static files,
// so deep links must work without server-side SPA fallback.
import { HashRouter, Route, Routes } from 'react-router-dom'
import { JXThemeProvider } from '@jacxishippingorg/jx-ui-react'
import { StoreProvider } from './store/store'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import VehicleDetail from './pages/VehicleDetail'
import Purchases from './pages/Purchases'
import Transportation from './pages/Transportation'
import Expenses from './pages/Expenses'
import Reconditioning from './pages/Reconditioning'
import Sales from './pages/Sales'
import CRM from './pages/CRM'
import Parts from './pages/Parts'
import Finance from './pages/Finance'
import Analytics from './pages/Analytics'
import Reports from './pages/Reports'
import Documents from './pages/Documents'
import Team from './pages/Team'
import Settings from './pages/Settings'
import AiAssistant from './pages/AiAssistant'
import Mcp from './pages/Mcp'
import { PageHeader } from './components/ui'
import LoginScreen from './components/LoginScreen'
import { API_MODE, getToken } from './lib/api'

function NotFound() {
  return <PageHeader title="Page not found" subtitle="This route does not exist in the tracker." />
}

export default function App() {
  // API mode (VITE_API_URL is set): no token, no app shell — sign in first.
  // Demo mode (VITE_API_URL unset): behaviour is unchanged, no login ever.
  if (API_MODE && !getToken()) {
    return (
      <JXThemeProvider defaultMode="light">
        <LoginScreen />
      </JXThemeProvider>
    )
  }
  return (
    <JXThemeProvider defaultMode="light">
      <StoreProvider>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="inventory/:id" element={<VehicleDetail />} />
              <Route path="purchases" element={<Purchases />} />
              <Route path="transportation" element={<Transportation />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="reconditioning" element={<Reconditioning />} />
              <Route path="sales" element={<Sales />} />
              <Route path="crm" element={<CRM />} />
              <Route path="parts" element={<Parts />} />
              <Route path="finance" element={<Finance />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="reports" element={<Reports />} />
              <Route path="documents" element={<Documents />} />
              <Route path="team" element={<Team />} />
              <Route path="settings" element={<Settings />} />
              <Route path="ai-assistant" element={<AiAssistant />} />
              <Route path="mcp" element={<Mcp />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </HashRouter>
      </StoreProvider>
    </JXThemeProvider>
  )
}
