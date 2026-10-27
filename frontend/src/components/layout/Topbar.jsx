import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, Sun, Moon, LogOut, User, ChevronDown, RefreshCw, AlertTriangle, PhoneCall } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { useNotificationStore } from '../../store/notificationStore'
import { useLeadsStore } from '../../store/leadsStore'
import NotificationBell from '../notifications/NotificationBell'
import NotificationDropdown from '../notifications/NotificationDropdown'
import DelayAlertPanel from './DelayAlertPanel'
import { getLeadAgeMinutes } from '../../utils/leadSla'
import { connectWebSocket, disconnectWebSocket } from '../../services/websocket'
import { authAPI, leadsAPI } from '../../services/api'
import BrandLogo from '../brand/BrandLogo'
import DirectDialerModal from '../dialer/DirectDialerModal'

const AVATAR_STYLE_CLASS = {
  brand: 'from-brand-500 to-accent-500',
  ocean: 'from-cyan-500 to-blue-500',
  sunset: 'from-orange-500 to-rose-500',
  forest: 'from-emerald-500 to-teal-500',
  steel: 'from-slate-500 to-slate-700',
}

const sourceLabelToEnum = (source) => {
  const value = String(source || '').trim().toLowerCase()
  if (value === 'facebook') return 'FACEBOOK'
  if (value === 'instagram') return 'INSTAGRAM'
  if (value === 'linkedin') return 'LINKEDIN'
  if (value === 'website') return 'WEBSITE'
  if (value === 'whatsapp') return 'WHATSAPP'
  if (value === 'google ads') return 'GOOGLE_ADS'
  if (value === 'meta ads') return 'META_ADS'
  if (value === 'referral' || value.startsWith('referral:')) return 'REFERRAL'
  if (value === 'email') return 'EMAIL'
  return 'OTHER'
}

const sourceCustomLabel = (lead) => {
  const source = String(lead?.source || '').trim()
  const sourceLabel = String(lead?.sourceLabel || '').trim()
  const sourceEnum = sourceLabelToEnum(source)
  if (sourceEnum !== 'OTHER' && sourceEnum !== 'REFERRAL') return undefined
  const custom = sourceLabel || (sourceEnum === 'REFERRAL' ? source.replace(/^referral:\s*/i, '').trim() : source)
  const blockedLabel = sourceEnum === 'REFERRAL' ? 'referral' : 'other'
  return custom && custom.toLowerCase() !== blockedLabel ? custom : undefined
}

export default function Topbar({ onMenuClick, onRefresh }) {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useThemeStore()
  const isDark = theme === 'dark'
  const { unreadCount, addNotification, fetchNotifications } = useNotificationStore()
  const { leads, patchLeadLocal } = useLeadsStore()
  const [showNotifications, setShowNotifications] = useState(false)
  const [showDelayAlerts, setShowDelayAlerts] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showDialer, setShowDialer] = useState(false)
  const [dialerNumber, setDialerNumber] = useState('')
  const [dialerLead, setDialerLead] = useState(null)
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [timeTick, setTimeTick] = useState(Date.now())
  const notifRef = useRef(null)
  const delayRef = useRef(null)
  const userRef = useRef(null)
  const avatarStyle = AVATAR_STYLE_CLASS[user?.avatarStyle] ?? AVATAR_STYLE_CLASS.brand

  const SLA_MINUTES = 60

  const delayedLeads = useMemo(() => {
    const nowMs = timeTick
    return (leads ?? []).filter((lead) => {
      const isUnactioned = String(lead?.status ?? '').toLowerCase() === 'new'
      if (!isUnactioned) return false

      const leadSlaMinutes = Number(lead?.followUpSlaMinutes) > 0 ? Number(lead.followUpSlaMinutes) : SLA_MINUTES
      const ageMinutes = getLeadAgeMinutes(lead, nowMs)
      if (ageMinutes === null) return false
      return ageMinutes > leadSlaMinutes
    })
  }, [leads, timeTick])

  const totalDelayAlerts = delayedLeads.length

  useEffect(() => {
    function handleClickOutside(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifications(false)
      if (delayRef.current && !delayRef.current.contains(e.target)) setShowDelayAlerts(false)
      if (userRef.current && !userRef.current.contains(e.target)) setShowUserMenu(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    window.addEventListener('open-dialer', (e) => {
      if (e.detail?.number) setDialerNumber(e.detail.number)
      if (e.detail?.lead) setDialerLead(e.detail.lead)
      setShowDialer(true)
    })
    const id = window.setInterval(() => setTimeTick(Date.now()), 60 * 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    setAvatarBroken(false)
  }, [user?.avatarUrl])

  useEffect(() => {
      try {
        connectWebSocket((incoming) => {
          const type = String(incoming?.type ?? 'lead').toLowerCase()
          const title = incoming?.title ?? 'Notification'
          const message = incoming?.message ?? 'You have a new update'
          addNotification({
            type,
            direction: incoming?.direction,
            title,
            message,
            actionUrl: incoming?.actionUrl || incoming?.action_url || null,
            createdAt: incoming?.createdAt,
          })
          toast.success(`${title}: ${message}`.slice(0, 120))
        })
      } catch {
        // WebSocket unavailable — real-time notifications disabled
    }

    return () => {
      try { disconnectWebSocket() } catch { /* ignore */ }
    }
  }, [addNotification])

  useEffect(() => {
    fetchNotifications().catch(() => {
      // Notification panel still works with live websocket updates.
    })
  }, [fetchNotifications])

  useEffect(() => {
    const nowIso = new Date(timeTick).toISOString()

    for (const lead of leads ?? []) {
      const isUnactioned = String(lead?.status ?? '').toLowerCase() === 'new'
      if (!isUnactioned) continue

      const ageMinutes = getLeadAgeMinutes(lead, timeTick)
      if (ageMinutes === null) continue

      const nextPatch = {}
      const reminders = []

      if (ageMinutes >= 15 && !lead.reminder15SentAt) {
        nextPatch.reminder15SentAt = nowIso
        reminders.push({
          type: 'task',
          title: 'Lead Reminder (15 min)',
          message: `${lead.name} has no response for 15+ minutes. Please follow up now.`,
        })
      }

      if (ageMinutes >= 45 && !lead.reminder45SentAt) {
        nextPatch.reminder45SentAt = nowIso
        reminders.push({
          type: 'task',
          title: 'Lead Reminder (45 min)',
          message: `${lead.name} is still unattended for 45+ minutes.`,
        })
      }

      if (ageMinutes >= 60 && !lead.reminder60SentAt) {
        nextPatch.reminder60SentAt = nowIso
        reminders.push({
          type: 'task',
          title: 'Lead Reminder (60 min)',
          message: `${lead.name} crossed 60 minutes with no action. Immediate response required.`,
        })
      }

      if (ageMinutes >= 60 && !lead.escalatedAt) {
        nextPatch.escalatedAt = nowIso
        reminders.push({
          type: 'task',
          title: 'Lead Escalated to Admin',
          message: `${lead.name} breached SLA. ${lead.assignedTo || 'Unassigned'} needs immediate review.`,
        })
      }

      if (ageMinutes >= 60 && !lead.reassignedAt) {
        nextPatch.reassignedAt = nowIso
        reminders.push({
          type: 'lead',
          title: 'Lead Needs Reassignment',
          message: `${lead.name} breached SLA and needs manual reassignment. Current owner: ${lead.assignedTo || 'Unassigned'}.`,
        })
      }

      if (Object.keys(nextPatch).length > 0) {
        patchLeadLocal(lead.id, (prev) => ({ ...prev, ...nextPatch }))
        reminders.forEach((notification) => addNotification(notification))
        leadsAPI.update(lead.id, {
          name: lead.name, email: lead.email,
          phone: lead.phone || undefined,
          source: sourceLabelToEnum(lead.source),
          sourceLabel: sourceCustomLabel(lead),
          ...nextPatch,
        }).catch(() => {})
      }
    }
  }, [timeTick, leads, addNotification, patchLeadLocal])

  const handleLogout = async () => {
    try {
      await authAPI.logout()
    } catch {
      // Ignore API logout failure and clear local state anyway.
    }
    logout()
    navigate('/login')
  }

  const handleRefresh = () => {
    if (typeof onRefresh === 'function') {
      onRefresh()
      return
    }
    navigate(0)
  }

  return (
    <header className="sticky top-0 z-40 min-h-16 flex flex-wrap sm:flex-nowrap items-center px-3 sm:px-5 py-2 sm:py-0 gap-2 sm:gap-4
                       border-b border-slate-200 dark:border-slate-800"
      style={{
        background: isDark ? '#0f172a' : '#ffffff',
        boxShadow: 'none',
      }}>
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        aria-label="Open navigation menu"
        className="md:hidden p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="min-w-0 flex-1">
        <BrandLogo variant="wordmark" size="sm" className="max-w-[190px] sm:max-w-[230px]" />
      </div>
      <div className="order-2 ml-auto flex items-center gap-1">
        <button
          onClick={handleRefresh}
          className="hidden sm:inline-flex p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
          title="Refresh"
          aria-label="Refresh page"
        >
          <RefreshCw className="w-5 h-5" />
        </button>

        {/* Direct Phone Dialer */}
        <button
          onClick={() => { setDialerNumber(''); setDialerLead(null); setShowDialer(true); }}
          className="p-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 transition-colors flex items-center gap-1.5"
          title="Direct Phone Dialer (Call Anyone)"
          aria-label="Direct Phone Dialer"
        >
          <PhoneCall className="w-5 h-5" />
          <span className="hidden md:inline text-xs font-semibold">Dialer</span>
        </button>

        <div className="relative" ref={delayRef}>
          <button
            onClick={() => { setShowDelayAlerts((v) => !v); setShowNotifications(false); setShowUserMenu(false) }}
            className="relative p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 dark:text-red-400 transition-colors"
            title="Lead delay alert"
            aria-label="Lead delay alert"
          >
            <AlertTriangle className="w-5 h-5" />
            {totalDelayAlerts > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {totalDelayAlerts > 9 ? '9+' : totalDelayAlerts}
              </span>
            )}
          </button>
          <AnimatePresence>
            {showDelayAlerts && (
              <DelayAlertPanel
                delayedLeads={delayedLeads}
                onOpenPipeline={() => navigate('/pipeline')}
                slaMinutes={SLA_MINUTES}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <NotificationBell
            unreadCount={unreadCount}
            active={showNotifications}
            onClick={() => { setShowNotifications((v) => !v); setShowDelayAlerts(false); setShowUserMenu(false) }}
          />
          <AnimatePresence>
            {showNotifications && (
              <NotificationDropdown onClose={() => setShowNotifications(false)} />
            )}
          </AnimatePresence>
        </div>

        {/* User menu */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => { setShowUserMenu((v) => !v); setShowNotifications(false); setShowDelayAlerts(false) }}
            aria-label="Open user menu"
            aria-expanded={showUserMenu}
            className="flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="relative">
              <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarStyle} flex items-center justify-center text-white text-xs font-bold overflow-hidden`}>
                {user?.avatarUrl && !avatarBroken ? (
                  <img
                    src={user.avatarUrl}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                    onError={() => setAvatarBroken(true)}
                  />
                ) : (
                  user?.name?.charAt(0) ?? 'U'
                )}
              </div>
              {/* Online status badge */}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-[1.5px] border-white dark:border-slate-900 shadow-sm" />
            </div>
            <span className="hidden sm:block text-sm font-medium text-slate-700 dark:text-slate-300">
              {user?.name?.split(' ')[0]}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>

          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-2 w-52 glass-card py-1 overflow-hidden z-50"
              >
                <div className="px-4 py-3 border-b border-slate-200/60 dark:border-slate-700/40">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{user?.name}</p>
                  <p className="text-xs text-slate-500">{user?.email}</p>
                  {user?.tenantName && (
                    <p className="text-[10px] text-brand-500 dark:text-brand-400 font-medium mt-0.5">{user.tenantName}</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowUserMenu(false)
                    navigate('/settings?tab=profile')
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <User className="w-4 h-4" />
                  My Profile
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <DirectDialerModal
        isOpen={showDialer}
        onClose={() => setShowDialer(false)}
        initialNumber={dialerNumber}
        initialLead={dialerLead}
      />
    </header>
  )
}
