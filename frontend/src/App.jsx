import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect, Component, Suspense, lazy } from 'react'
import MainLayout from './components/layout/MainLayout'
import AuthLayout from './components/layout/AuthLayout'
import { useAuthStore } from './store/authStore'
import { useThemeStore } from './store/themeStore'
import { authAPI } from './services/api'
import { PERMISSIONS, hasPermission } from './utils/permissions'
import LoadingState from './components/ui/LoadingState'

const pageImports = {
  '/landing': () => import('./pages/LandingPage'),
  '/login': () => import('./pages/LoginPage'),
  '/register': () => import('./pages/RegisterPage'),
  '/dashboard': () => import('./pages/DashboardPage'),
  '/leads': () => import('./pages/LeadsPage'),
  '/pipeline': () => import('./pages/KanbanPage'),
  '/task-followup': () => import('./pages/TaskPage'),
  '/customers': () => import('./pages/CustomersPage'),
  '/dialer': () => import('./pages/DialerPage'),
  '/whatsapp': () => import('./pages/WhatsAppPage'),
  '/communication': () => import('./pages/CommunicationPage'),
  '/ai-engine': () => import('./pages/AIEnginePage'),
  '/automation': () => import('./pages/AutomationPage'),
  '/analytics': () => import('./pages/AnalyticsPage'),
  '/lead-activity-report': () => import('./pages/LeadActivityReportPage'),
  '/team': () => import('./pages/TeamPage'),
  '/settings': () => import('./pages/SettingsPage'),
  // These pages are now tabs inside Settings — kept for lazy imports by SettingsView
  '/admin/saas': () => import('./pages/SaaSAdminPage'),
  '/platform/login': () => import('./pages/PlatformLoginPage'),
  '/terms': () => import('./pages/TermsPage'),
  '/privacy': () => import('./pages/PrivacyPage'),
}

export const prefetchPage = (path) => {
  const loader = pageImports[path]
  if (loader) loader()
}

const LandingPage = lazy(pageImports['/landing'])
const LoginPage = lazy(pageImports['/login'])
const RegisterPage = lazy(pageImports['/register'])
const DashboardPage = lazy(pageImports['/dashboard'])
const LeadsPage = lazy(pageImports['/leads'])
const KanbanPage = lazy(pageImports['/pipeline'])
const TaskFollowUpPage = lazy(pageImports['/task-followup'])
const CustomersPage = lazy(pageImports['/customers'])
const DialerPage = lazy(pageImports['/dialer'])
const WhatsAppPage = lazy(pageImports['/whatsapp'])
const CommunicationPage = lazy(pageImports['/communication'])
const AIEnginePage = lazy(pageImports['/ai-engine'])
const AutomationPage = lazy(pageImports['/automation'])
const AnalyticsPage = lazy(pageImports['/analytics'])
const LeadActivityReportPage = lazy(pageImports['/lead-activity-report'])
const TeamPage = lazy(pageImports['/team'])
const SettingsPage = lazy(pageImports['/settings'])
const SaaSAdminPage = lazy(pageImports['/admin/saas'])
const PlatformLoginPage = lazy(pageImports['/platform/login'])
const TermsPage = lazy(pageImports['/terms'])
const PrivacyPage = lazy(pageImports['/privacy'])

function RouteFallback() {
  return <div className="min-h-screen grid place-items-center"><LoadingState /></div>
}

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      const showDebug = import.meta.env.DEV
      return (
        <div style={{ padding: 32, fontFamily: 'monospace' }}>
          <h2 style={{ color: '#ef4444' }}>Something went wrong</h2>
          <pre style={{ background: '#f1f5f9', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
            {showDebug ? `${this.state.error?.message}\n\n${this.state.error?.stack}` : 'An unexpected UI error occurred. Please reload and try again.'}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function PrivateRoute({ children }) {
  const { isAuthenticated, authBootstrapped } = useAuthStore()
  if (!authBootstrapped) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Checking session...</div>
  }
  return isAuthenticated ? children : <Navigate to="/" replace />
}

function PermissionRoute({ permission, children }) {
  const { user, authBootstrapped } = useAuthStore()
  if (!authBootstrapped) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Checking session...</div>
  }
  // Platform Admin should not access company-level pages — redirect to their dashboard
  if (user?.role === 'PLATFORM_ADMIN') return <Navigate to="/admin/saas" replace />
  if (hasPermission(user, permission)) return children

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">Access denied</p>
        <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">You do not have access to this section</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Your account is signed in, but this workspace role cannot open the requested module.
        </p>
        <button
          type="button"
          onClick={() => window.location.assign('/dashboard')}
          className="btn-primary mt-5 w-full justify-center"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  )
}

function RoleRoute({ role, children }) {
  const { user, authBootstrapped } = useAuthStore()
  if (!authBootstrapped) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Checking session...</div>
  }
  if (user?.role === role) return children

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">Access denied</p>
        <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">Platform Admin access required</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          This section is reserved for platform operators.
        </p>
        <button
          type="button"
          onClick={() => window.location.assign('/dashboard')}
          className="btn-primary mt-5 w-full justify-center"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  )
}

function PlatformAdminRedirect() {
  const { user } = useAuthStore()
  return <Navigate to={user?.role === 'PLATFORM_ADMIN' ? '/admin/saas' : '/dashboard'} replace />
}

const COLOR_HOVER_CARD_SELECTOR = [
  '.dashboard-color-card',
  '.glass-card',
  '.kpi-card',
  '.deal-card',
  'div[class~="border"][class*="rounded-"][class*="bg-"]',
  'section[class~="border"][class*="rounded-"][class*="bg-"]',
  'article[class~="border"][class*="rounded-"][class*="bg-"]',
  'li[class~="border"][class*="rounded-"][class*="bg-"]',
  'button[class~="border"][class*="rounded-"][class*="bg-"]',
].join(',')
const COLOR_ACCENT_SELECTORS = [
  '[style*="--dashboard-card-rgb"]',
  '[class*="from-"]',
  '[class*="to-"]',
  '[class*="bg-"]',
  '[class*="border-"]',
  '[class*="text-"]',
].join(',')

const ACCENT_RGB_BY_TONE = [
  ['emerald', '16, 185, 129'],
  ['green', '34, 197, 94'],
  ['teal', '20, 184, 166'],
  ['cyan', '6, 182, 212'],
  ['sky', '14, 165, 233'],
  ['brand', '14, 165, 233'],
  ['blue', '59, 130, 246'],
  ['indigo', '99, 102, 241'],
  ['violet', '124, 58, 237'],
  ['purple', '147, 51, 234'],
  ['pink', '236, 72, 153'],
  ['rose', '244, 63, 94'],
  ['red', '239, 68, 68'],
  ['orange', '249, 115, 22'],
  ['amber', '245, 158, 11'],
  ['yellow', '234, 179, 8'],
]

const getColorHoverCards = (target) => {
  const cards = []
  let node = target instanceof Element ? target : null

  while (node && node !== document.body) {
    if (node.matches?.(COLOR_HOVER_CARD_SELECTOR)) cards.push(node)
    node = node.parentElement
  }

  return cards
}

const getClassValue = (element) =>
  typeof element?.className === 'string' ? element.className : element?.getAttribute?.('class') || ''

const pickAccentRgb = (card) => {
  const assignedRgb = card.style.getPropertyValue('--dashboard-card-rgb')
  if (assignedRgb) return assignedRgb

  const candidates = [card, ...Array.from(card.querySelectorAll(COLOR_ACCENT_SELECTORS)).slice(0, 80)]
  const classValues = candidates.map(getClassValue)
  const preferredPrefixes = ['from-', 'to-', 'bg-', 'border-', 'text-']

  for (const prefix of preferredPrefixes) {
    const classValue = classValues.find((value) =>
      ACCENT_RGB_BY_TONE.some(([tone]) => value.includes(`${prefix}${tone}`))
    )
    const match = ACCENT_RGB_BY_TONE.find(([tone]) => classValue?.includes(`${prefix}${tone}`))
    if (match) return match[1]
  }

  return ''
}

const updateColorHoverPointer = (event) => {
  const cards = getColorHoverCards(event.target)
  if (!cards.length) return

  cards.forEach((card) => {
    const accentRgb = pickAccentRgb(card)
    const rect = card.getBoundingClientRect()

    if (accentRgb) card.style.setProperty('--dashboard-card-rgb', accentRgb)
    card.style.setProperty('--dashboard-hover-x', `${event.clientX - rect.left}px`)
    card.style.setProperty('--dashboard-hover-y', `${event.clientY - rect.top}px`)
  })
}

const resetColorHoverPointer = (event) => {
  const cards = getColorHoverCards(event.target)
  if (!cards.length) return

  cards.forEach((card) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget?.nodeType && card.contains(relatedTarget)) return
    card.style.removeProperty('--dashboard-hover-x')
    card.style.removeProperty('--dashboard-hover-y')
  })
}

export default function App() {
  const { theme } = useThemeStore()
  const { authBootstrapped, setSessionFromUser, markAuthBootstrapped } = useAuthStore()
  const isDark = theme === 'dark'

  useEffect(() => {
    const supportedThemes = new Set(['light', 'dark', 'corporate'])
    if (!supportedThemes.has(theme)) {
      useThemeStore.getState().setTheme('corporate')
    }
  }, [theme])

  useEffect(() => {
    document.addEventListener('pointermove', updateColorHoverPointer)
    document.addEventListener('pointerout', resetColorHoverPointer)

    return () => {
      document.removeEventListener('pointermove', updateColorHoverPointer)
      document.removeEventListener('pointerout', resetColorHoverPointer)
    }
  }, [])

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme, isDark])

  // Only call /auth/me when persisted auth needs server validation.
  useEffect(() => {
    if (authBootstrapped) return
    let alive = true
    // Check persisted state after hydration
    const s = useAuthStore.getState()
    // Valid-looking in-memory session: trust it, skip /auth/me.
    if (s.isAuthenticated && s.token && s.user) {
      markAuthBootstrapped()
      return
    }
    // Not authenticated at all: just mark bootstrapped so guards redirect to login
    if (!s.isAuthenticated) {
      markAuthBootstrapped()
      return
    }
    // Cookie-backed session: validate server-side.
    void (async () => {
      try {
        const me = await authAPI.me()
        if (alive) setSessionFromUser(me)
      } catch (err) {
        if (!alive) return
        const isNetworkError =
          err?.code === 'ERR_NETWORK' ||
          err?.code === 'ECONNABORTED' ||
          (typeof err?.message === 'string' && err.message.toLowerCase().includes('network'))
        if (isNetworkError && useAuthStore.getState().isAuthenticated) {
          markAuthBootstrapped()
        } else {
          setSessionFromUser(null)
        }
      }
    })()
    return () => { alive = false }
  }, [authBootstrapped, markAuthBootstrapped, setSessionFromUser])

  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: isDark ? '#1e293b' : '#fff',
              color: isDark ? '#f1f5f9' : '#0f172a',
              border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: 500,
            },
          }}
        />
        <Routes>
          {/* Public landing page — default route */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/landing" element={<LandingPage />} />

          {/* Auth routes */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          {/* Platform Admin login — separate full-page layout */}
          <Route path="/platform/login" element={<PlatformLoginPage />} />
          {/* Legal pages */}
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />

          {/* App routes */}
          <Route
            element={
              <PrivateRoute>
                <MainLayout />
              </PrivateRoute>
            }
          >
            <Route path="/dashboard" element={<PermissionRoute permission={PERMISSIONS.DASHBOARD_VIEW}><DashboardPage /></PermissionRoute>} />
            <Route path="/leads" element={<PermissionRoute permission={PERMISSIONS.LEADS_READ}><LeadsPage /></PermissionRoute>} />
            <Route path="/pipeline" element={<PermissionRoute permission={PERMISSIONS.LEADS_READ}><KanbanPage /></PermissionRoute>} />
            <Route path="/customers" element={<PermissionRoute permission={PERMISSIONS.CUSTOMERS_READ}><CustomersPage /></PermissionRoute>} />
            <Route path="/dialer" element={<PermissionRoute permission={PERMISSIONS.COMMUNICATIONS_READ}><DialerPage /></PermissionRoute>} />
            <Route path="/whatsapp" element={<PermissionRoute permission={PERMISSIONS.COMMUNICATIONS_READ}><WhatsAppPage /></PermissionRoute>} />
            <Route path="/communication" element={<PermissionRoute permission={PERMISSIONS.COMMUNICATIONS_READ}><CommunicationPage /></PermissionRoute>} />
            <Route path="/ai-engine" element={<PermissionRoute permission={PERMISSIONS.AI_USE}><AIEnginePage /></PermissionRoute>} />
            <Route path="/automation" element={<PermissionRoute permission={PERMISSIONS.AUTOMATION_READ}><AutomationPage /></PermissionRoute>} />
            <Route path="/analytics" element={<PermissionRoute permission={PERMISSIONS.REPORTS_READ}><AnalyticsPage /></PermissionRoute>} />
            <Route path="/lead-activity-report" element={<PermissionRoute permission={PERMISSIONS.REPORTS_READ}><LeadActivityReportPage /></PermissionRoute>} />
            <Route path="/task-followup" element={<PermissionRoute permission={PERMISSIONS.TASKS_READ}><TaskFollowUpPage /></PermissionRoute>} />
            <Route path="/notifications" element={<Navigate to="/settings?tab=alerts" replace />} />
            <Route path="/tickets" element={<Navigate to="/settings?tab=tickets" replace />} />
            <Route path="/subscription" element={<Navigate to="/settings?tab=subscription" replace />} />
            <Route path="/team" element={<PermissionRoute permission={PERMISSIONS.TEAM_READ}><TeamPage /></PermissionRoute>} />
            <Route path="/profile" element={<Navigate to="/settings?tab=profile" replace />} />
            <Route path="/integrations" element={<Navigate to="/settings?tab=integrations" replace />} />
            <Route path="/settings" element={<PermissionRoute permission={PERMISSIONS.SETTINGS_VIEW}><SettingsPage /></PermissionRoute>} />
            <Route path="/admin/saas" element={<RoleRoute role="PLATFORM_ADMIN"><SaaSAdminPage /></RoleRoute>} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
