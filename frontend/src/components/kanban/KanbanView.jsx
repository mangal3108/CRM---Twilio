import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, pointerWithin, rectIntersection,
  useDroppable,
  KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, Filter, Search, IndianRupee, Calendar,
  User, Flame, Thermometer, Snowflake, MoreHorizontal, Trash2, X,
  ChevronLeft, ChevronRight, RefreshCw, Download,
  Phone, AtSign, Tag, PhoneCall, MessageCircle, ClipboardList, Clock, Trophy
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { useLeadsStore } from '../../store/leadsStore'
import { useAuthStore } from '../../store/authStore'
import { getLeadAgingMeta } from '../../utils/leadSla'
import { leadsAPI, teamAPI } from '../../services/api'
import PageHeading from '../ui/PageHeading'
import { PERMISSIONS, hasPermission } from '../../utils/permissions'
import LeadActivitiesModal from '../LeadActivitiesModal'
import PaginatedSelect from '../ui/PaginatedSelect'
import ScreenModalPortal from '../ui/ScreenModalPortal'
import CallLeadModal from '../leads/CallLeadModal'
import CopyableContact from '../ui/CopyableContact'
import DateRangeFilter from '../ui/DateRangeFilter'
import { anyFieldMatchesSearch } from '../../utils/search'
import { emptyDateRange, isWithinDateRange } from '../../utils/dateRangeFilter'

/* ── Pipeline stages — exact activity workflow ──────────────── */
const STAGES = [
  { key: 'new', label: 'New', group: 'Lead', color: 'bg-slate-400' },
  { key: 'welcome_not_connected', label: 'Not Connected', group: 'Welcome Call', color: 'bg-cyan-500' },
  { key: 'welcome_connected', label: 'Connected', group: 'Welcome Call', color: 'bg-sky-400' },
  { key: 'welcome_connected_not_interested', label: 'Not Interested', group: 'Welcome Call', color: 'bg-red-400' },
  { key: 'welcome_connected_interested', label: 'Interested', group: 'Welcome Call', color: 'bg-emerald-400' },
  { key: 'followup_follow_up', label: 'Follow Up', group: 'Follow Up', color: 'bg-blue-400' },
  { key: 'followup_meeting', label: 'Meeting', group: 'Follow Up', color: 'bg-brand-400' },
  { key: 'outcome_won', label: 'Won', group: 'Outcome', color: 'bg-emerald-500' },
  { key: 'outcome_negotiation', label: 'Negotiation', group: 'Outcome', color: 'bg-orange-400' },
  { key: 'outcome_lost', label: 'Lost', group: 'Outcome', color: 'bg-red-500' },
]

const PIPELINE_PAGE_SIZE = 50
const PIPELINE_EXPORT_PAGE_SIZE = 200

const ACTIVITY_BY_WORKFLOW_STAGE = {
  welcome_not_connected: {
    activityIndex: 0,
    activityId: 'act01',
    activityLabel: 'Activity 01',
    activityTitle: 'Welcome Call',
    values: { status: 'Not Connected', connectionStatus: 'Not Connected', callOutcome: 'Not Connected' },
  },
  welcome_connected: {
    activityIndex: 0,
    activityId: 'act01',
    activityLabel: 'Activity 01',
    activityTitle: 'Welcome Call',
    values: { status: 'Connected', connectionStatus: 'Connected', callOutcome: 'Connected' },
  },
  welcome_connected_not_interested: {
    activityIndex: 0,
    activityId: 'act01',
    activityLabel: 'Activity 01',
    activityTitle: 'Welcome Call',
    values: { status: 'Connected', connectionStatus: 'Connected', callOutcome: 'Connected', interestStatus: 'Not Interested' },
  },
  welcome_connected_interested: {
    activityIndex: 0,
    activityId: 'act01',
    activityLabel: 'Activity 01',
    activityTitle: 'Welcome Call',
    values: { status: 'Connected', connectionStatus: 'Connected', callOutcome: 'Connected', interestStatus: 'Interested' },
  },
  followup_follow_up: {
    activityIndex: 1,
    activityId: 'act02',
    activityLabel: 'Activity 02',
    activityTitle: 'Follow Up for Meeting',
    values: { status: 'Follow Up' },
  },
  followup_meeting: {
    activityIndex: 1,
    activityId: 'act02',
    activityLabel: 'Activity 02',
    activityTitle: 'Follow Up for Meeting',
    values: { status: 'Meeting' },
  },
  outcome_negotiation: {
    activityIndex: 2,
    activityId: 'act03',
    activityLabel: 'Activity 03',
    activityTitle: 'Meeting Outcome',
    values: { status: 'Negotiation' },
  },
  outcome_lost: {
    activityIndex: 2,
    activityId: 'act03',
    activityLabel: 'Activity 03',
    activityTitle: 'Meeting Outcome',
    values: { status: 'Lost' },
  },
  outcome_won: {
    activityIndex: 2,
    activityId: 'act03',
    activityLabel: 'Activity 03',
    activityTitle: 'Meeting Outcome',
    values: { status: 'Won' },
  },
}

const SCORE_CONFIG = {
  hot:  { icon: Flame,        color: 'text-red-500',   label: 'Hot',  cls: 'badge-hot' },
  warm: { icon: Thermometer,  color: 'text-amber-500', label: 'Warm', cls: 'badge-warm' },
  cold: { icon: Snowflake,    color: 'text-sky-500',   label: 'Cold', cls: 'badge-cold' },
}

const STAGE_ICON_DEFS = [
  { icon: Phone,  bg: 'bg-red-500',     ring: 'ring-red-400/40' },
  { icon: Clock,  bg: 'bg-blue-500',    ring: 'ring-blue-400/40' },
  { icon: Trophy, bg: 'bg-emerald-500', ring: 'ring-emerald-400/40' },
]
function getLeadCurrentStage(activityState) {
  if (!activityState?.saved) return -1
  let max = -1
  activityState.saved.forEach((s, i) => { if (s) max = i })
  return max
}

const LEAD_SOURCES = [
  'Facebook', 'Instagram', 'LinkedIn', 'Website', 'WhatsApp',
  'Google Ads', 'Meta Ads', 'Referral', 'Email', 'Other',
]

const sourceNeedsLabel = (source) => source === 'Other' || source === 'Referral'

const STAGE_DROP_PREFIX = 'stage:'

const STAGE_KEYS = new Set(STAGES.map((s) => s.key))

const formatLeadCreatedDateTime = (lead) => {
  const raw = lead?.createdAtTs || lead?.createdAt
  if (!raw) return { date: '—', time: '' }
  const normalized = typeof raw === 'string' && raw.includes('T') && !raw.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(raw)
    ? `${raw}Z`
    : raw
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return { date: lead?.createdAt || '—', time: '' }

  return {
    date: date.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
  }
}

const formatExportDateTime = (value) => {
  if (!value) return '-'
  const normalized = typeof value === 'string' && value.includes('T') && !value.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(value)
    ? `${value}Z`
    : value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return String(value)

  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const sourceEnumToLabel = (source, sourceLabel) => {
  const custom = String(sourceLabel || '').trim()
  const s = String(source || '').toUpperCase()
  if (s === 'REFERRAL' && custom) return `Referral: ${custom}`
  if (s === 'OTHER' && custom) return custom
  if (s === 'GOOGLE_ADS') return 'Google Ads'
  if (s === 'META_ADS') return 'Meta Ads'
  return s ? `${s.charAt(0)}${s.slice(1).toLowerCase().replace('_', ' ')}` : 'Other'
}

const referralNameFromDisplay = (source) => String(source || '').replace(/^referral:\s*/i, '').trim()

const sourceLabelToEnum = (source) => {
  const s = String(source || '').trim().toLowerCase()
  if (s === 'facebook') return 'FACEBOOK'
  if (s === 'instagram') return 'INSTAGRAM'
  if (s === 'linkedin') return 'LINKEDIN'
  if (s === 'website') return 'WEBSITE'
  if (s === 'whatsapp') return 'WHATSAPP'
  if (s === 'google ads') return 'GOOGLE_ADS'
  if (s === 'meta ads') return 'META_ADS'
  if (s === 'referral' || s.startsWith('referral:')) return 'REFERRAL'
  if (s === 'email') return 'EMAIL'
  return 'OTHER'
}

const customSourceLabel = (lead) => {
  const source = String(lead?.source || '').trim()
  const sourceLabel = String(lead?.sourceLabel || '').trim()
  const sourceEnum = sourceLabelToEnum(source)
  if (sourceEnum !== 'OTHER' && sourceEnum !== 'REFERRAL') return null
  const custom = sourceLabel || (sourceEnum === 'REFERRAL' ? referralNameFromDisplay(source) : source)
  const blockedLabel = sourceEnum === 'REFERRAL' ? 'referral' : 'other'
  return custom && custom.toLowerCase() !== blockedLabel ? custom : null
}

const toPipelineExportLead = (lead, index = 0) => ({
  id: lead?.id,
  name: lead?.name || '',
  email: lead?.email || '',
  phone: lead?.phone || '',
  company: lead?.company || '',
  service: lead?.service || '',
  specialization: lead?.specialization || lead?.subService || '',
  source: sourceEnumToLabel(lead?.source, lead?.sourceLabel),
  sourceLabel: lead?.sourceLabel || '',
  score: String(lead?.score || 'COLD').toLowerCase(),
  status: String(lead?.status || 'NEW').toLowerCase(),
  assignedTo: lead?.assignedToName || lead?.assignedTo || '',
  tags: Array.isArray(lead?.tags) ? lead.tags.join(', ') : (lead?.tags || ''),
  notes: lead?.notes || '',
  createdAt: lead?.createdAt,
  createdAtTs: lead?.createdAtTs || lead?.createdAt || new Date(Date.now() - index * 1000).toISOString(),
  updatedAt: lead?.updatedAt,
  followUpDate: lead?.followUpDate,
  activityLogs: Array.isArray(lead?.activityLogs) ? lead.activityLogs : [],
})

const emptyActivityState = () => ({ data: [{}, {}, {}], saved: [false, false, false], latestStage: null })

const unwrapActivityRows = (payload) => {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.content)) return payload.content
  return []
}

const buildActivityModalState = (rows = []) => {
  const data = [{}, {}, {}]
  const saved = [false, false, false]
  const seen = new Set()
  let latestStage = null

  const sortedRows = [...(rows || [])].sort((a, b) => {
    const aTime = new Date(a?.savedAt || a?.createdAt || 0).getTime() || 0
    const bTime = new Date(b?.savedAt || b?.createdAt || 0).getTime() || 0
    return bTime - aTime
  })

  for (const row of sortedRows) {
    const idx = Number(row?.activityIndex)
    if (!latestStage) latestStage = getWorkflowStageFromActivityRow(row)
    if (!(idx >= 0 && idx < 3) || seen.has(idx)) continue
    seen.add(idx)
    data[idx] = {
      ...(row?.values || {}),
      assignedTo: row?.assignedTo || row?.values?.assignedTo || '',
    }
    saved[idx] = true
  }

  return { data, saved, latestStage }
}

const buildActivitySummary = ({ activityIndex, lead, values }) => {
  if (activityIndex === 0) {
    return [
      values?.connectionStatus || values?.callOutcome || values?.status ? `Status: ${values.connectionStatus || values.callOutcome || values.status}` : null,
      lead?.source ? `Source: ${lead.source}` : null,
      lead?.service ? `Service: ${lead.service}` : lead?.specialization ? `Service: ${lead.specialization}` : null,
      values?.nextFollowUpDate || values?.followUpDate ? `Next follow-up: ${values.nextFollowUpDate || values.followUpDate}${values?.nextFollowUpTime ? ' ' + values.nextFollowUpTime : ''}` : null,
      values?.remark || values?.remarks || values?.note ? `Remarks: ${values.remark || values.remarks || values.note}` : null,
    ].filter(Boolean).join(' | ') || 'Lead activity recorded'
  }

  return Object.entries(values || {})
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join(' | ') || 'Lead activity recorded'
}

const normalizeWorkflowStatus = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[-_]+/g, ' ')
  .replace(/\s+/g, ' ')

const getWorkflowStageFromActivityRow = (row) => {
  const idx = Number(row?.activityIndex)
  const values = row?.values || {}
  const status = normalizeWorkflowStatus(
    values.status ||
    values.outcome ||
    values.remarkStatus ||
    values.connectionStatus ||
    values.callOutcome
  )
  const interest = normalizeWorkflowStatus(values.interestStatus || values.interest || '')

  if (idx === 2) {
    if (status.includes('won') || status.includes('win')) return 'outcome_won'
    if (status.includes('lost')) return 'outcome_lost'
    if (status.includes('negoti')) return 'outcome_negotiation'
    return 'outcome_negotiation'
  }

  if (idx === 1) {
    if (status.includes('allowed person') || status.includes('meeting')) return 'followup_meeting'
    if (status.includes('follow')) return 'followup_follow_up'
    return 'followup_follow_up'
  }

  if (idx === 0) {
    if (status.includes('not connected') || status.includes('non connected') || status.includes('no answer') || status.includes('callback')) {
      return 'welcome_not_connected'
    }
    if (status.includes('connect')) {
      if (interest.includes('not interested')) return 'welcome_connected_not_interested'
      if (interest.includes('interested')) return 'welcome_connected_interested'
      return 'welcome_connected'
    }
    return 'welcome_not_connected'
  }

  return null
}

const getWorkflowStageFromActivityState = (state) => {
  if (state?.latestStage) return state.latestStage

  const data = state?.data || []
  const saved = state?.saved || []

  if (saved[2]) {
    const status = normalizeWorkflowStatus(data[2]?.status || data[2]?.outcome)
    if (status.includes('won') || status.includes('win')) return 'outcome_won'
    if (status.includes('lost')) return 'outcome_lost'
    if (status.includes('negoti')) return 'outcome_negotiation'
    return 'outcome_negotiation'
  }

  if (saved[1]) {
    const status = normalizeWorkflowStatus(data[1]?.status || data[1]?.remarkStatus)
    if (status.includes('allowed person') || status.includes('meeting')) return 'followup_meeting'
    if (status.includes('follow')) return 'followup_follow_up'
    return 'followup_follow_up'
  }

  if (saved[0]) {
    const status = normalizeWorkflowStatus(data[0]?.connectionStatus || data[0]?.callOutcome || data[0]?.status)
    const interest = normalizeWorkflowStatus(data[0]?.interestStatus || data[0]?.interest || '')
    if (status.includes('not connected') || status.includes('non connected') || status.includes('no answer') || status.includes('callback')) {
      return 'welcome_not_connected'
    }
    if (status.includes('connect')) {
      if (interest.includes('not interested')) return 'welcome_connected_not_interested'
      if (interest.includes('interested')) return 'welcome_connected_interested'
      return 'welcome_connected'
    }
    return 'welcome_not_connected'
  }

  return 'new'
}

const getWorkflowStageForLead = (lead, activityState) => {
  const activityStage = getWorkflowStageFromActivityState(activityState)
  if (activityStage !== 'new') return activityStage
  if (lead?.status === 'won') return 'outcome_won'
  if (lead?.status === 'lost') return 'outcome_lost'
  if (lead?.status === 'negotiation') return 'outcome_negotiation'
  return 'new'
}

const STATUS_BY_WORKFLOW_STAGE = {
  new: 'new',
  welcome_not_connected: 'contacted',
  welcome_connected: 'contacted',
  welcome_connected_not_interested: 'lost',
  welcome_connected_interested: 'contacted',
  followup_follow_up: 'contacted',
  followup_meeting: 'qualified',
  outcome_won: 'won',
  outcome_negotiation: 'negotiation',
  outcome_lost: 'lost',
}

const mergeActivityIntoState = (previousState, row) => {
  const base = previousState || emptyActivityState()
  const data = [...(base.data || [{}, {}, {}])]
  const saved = [...(base.saved || [false, false, false])]
  const idx = Number(row?.activityIndex)

  if (idx >= 0 && idx < 3) {
    data[idx] = {
      ...(row?.values || {}),
      assignedTo: row?.assignedTo || row?.values?.assignedTo || '',
    }
    saved[idx] = true
  }

  return {
    data,
    saved,
    latestStage: getWorkflowStageFromActivityRow(row) || base.latestStage || null,
  }
}

const buildLocalLeadPatchForActivity = (lead, activityRow) => {
  const touchedAt = activityRow?.savedAt || activityRow?.createdAt || new Date().toISOString()
  const stageKey = getWorkflowStageFromActivityRow(activityRow)
  const values = activityRow?.values || {}
  const logEntry = `${touchedAt} | ${activityRow?.activityTitle || activityRow?.activityLabel || 'Activity'} | ${activityRow?.summary || 'Activity recorded'}`

  return {
    status: STATUS_BY_WORKFLOW_STAGE[stageKey] || lead?.status || 'contacted',
    lastActivityAtTs: touchedAt,
    lastContactedAtTs: touchedAt,
    activityLogs: [logEntry, ...(lead?.activityLogs || [])].slice(0, 25),
    ...(() => {
      const d = values.nextFollowUpDate || values.followUpDate || values.callbackAt
      if (!d) return {}
      const t = values.nextFollowUpTime || ''
      return { followUpDate: t ? `${d}T${t}:00` : d }
    })(),
  }
}

const buildStageActivityPayload = (stageKey, lead) => {
  const meta = ACTIVITY_BY_WORKFLOW_STAGE[stageKey]
  if (!meta) return null

  const values = {
    ...(meta.values || {}),
    assignedTo: lead?.assignedToName || lead?.assignedTo?.name || lead?.assignedTo || '',
  }

  return {
    activityIndex: meta.activityIndex,
    activityId: meta.activityId,
    activityLabel: meta.activityLabel,
    activityTitle: meta.activityTitle,
    assignedTo: values.assignedTo || null,
    values,
    summary: buildActivitySummary({ activityIndex: meta.activityIndex, lead, values }),
  }
}

const buildBackendLeadPayload = (lead, status) => ({
  name: lead?.name || '',
  email: lead?.email || '',
  phone: lead?.phone || '',
  company: lead?.company || '',
  service: lead?.service || '',
  specialization: lead?.specialization || '',
  source: sourceLabelToEnum(lead?.source),
  sourceLabel: customSourceLabel(lead),
  score: String(lead?.score || 'cold').toUpperCase(),
  status,
  dealValue: Number(lead?.value || 0),
  assignedToId: lead?.assignedToId || null,
  tags: String(lead?.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
  expectedCloseTimeline: lead?.expectedCloseTimeline || null,
})

/* Custom collision detection: prefer stage column droppables (pointerWithin)
   so empty columns work, then fall back to rectIntersection for card-level drops */
function kanbanCollision(args) {
  // First check if pointer is within any droppable (works for empty columns)
  const pointerHits = pointerWithin(args)
  // Prefer stage-level droppables (stage:xxx) over card-level sortables
  const stageHit = pointerHits.find((h) => String(h.id).startsWith(STAGE_DROP_PREFIX))
  if (stageHit) return [stageHit]
  // Check SortableContext container droppables (bare stage keys like "followup_meeting")
  const contextHit = pointerHits.find((h) => STAGE_KEYS.has(String(h.id)))
  if (contextHit) return [contextHit]
  // If pointer is over a card, use that
  if (pointerHits.length > 0) return pointerHits
  // Fallback: rectIntersection for edge cases
  return rectIntersection(args)
}

/* ── Lead card (shown in Kanban column) ────────────────────── */
function LeadCard({
  lead,
  stage,
  isDragging,
  isMenuOpen,
  onToggleMenu,
  onMoveLead,
  onDeleteLead,
  agingMeta,
  canMoveLead,
  canDeleteLead,
  onCall,
  onWhatsApp,
  onActivities,
  onHistory,
  callingLeadId,
  activityState,
}) {
  const scoreCfg = SCORE_CONFIG[lead.score] || SCORE_CONFIG.warm
  const ScoreIcon = scoreCfg.icon
  const created = formatLeadCreatedDateTime(lead)
  const latestActivity = Array.isArray(lead.activityLogs) && lead.activityLogs.length > 0
    ? String(lead.activityLogs[0]).split(' | ').slice(1).join(' · ')
    : ''
  const currentStage = getLeadCurrentStage(activityState)
  const stageDef = currentStage >= 0 ? STAGE_ICON_DEFS[Math.min(currentStage, 2)] : null

  return (
    <div
      className={`deal-card select-none relative cursor-pointer ${isDragging ? 'opacity-50 rotate-2 shadow-2xl' : ''}`}
      onClick={() => onHistory?.(lead)}
    >
      {/* Name + menu + stage icon */}
      <div className="flex items-start justify-between mb-1.5">
        <div className="min-w-0 flex-1 pr-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-tight line-clamp-1">
            {lead.name}
          </p>
          {lead.company && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{lead.company}</p>
          )}
        </div>
        {(canMoveLead || canDeleteLead) && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleMenu(lead.id) }}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0"
            data-lead-menu
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.12 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-8 z-40 w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden"
            data-lead-menu
          >
            {canMoveLead && STAGES.filter((s) => s.key !== stage).map((s) => (
              <button
                key={s.key}
                onClick={() => onMoveLead(lead.id, s.key)}
                className="w-full px-3 py-2 text-left text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Move to {s.label}
              </button>
            ))}
            {canMoveLead && canDeleteLead && <div className="h-px bg-slate-200 dark:bg-slate-700" />}
            {canDeleteLead && (
              <button
                onClick={() => onDeleteLead(lead.id)}
                className="w-full px-3 py-2 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Lead
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Score badge + stage icon + aging */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {stageDef && (() => {
          const StIcon = stageDef.icon
          return (
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${stageDef.bg} text-white ring-1 ${stageDef.ring}`}>
              <StIcon className="w-2.5 h-2.5" />
            </span>
          )
        })()}
        <span className={`${scoreCfg.cls} text-[10px]`}>
          <ScoreIcon className="w-3 h-3" /> {scoreCfg.label}
        </span>
        {agingMeta && (
          <span className={`badge ${agingMeta.badge} text-[10px]`}>{agingMeta.label}</span>
        )}
      </div>

      {/* Value + source */}
      <div className="flex items-center justify-between text-xs mb-2">
        {lead.value > 0 ? (
          <span className="flex items-center gap-0.5 font-bold text-slate-700 dark:text-slate-300">
            <IndianRupee className="w-3 h-3" />
            {(lead.value / 1000).toFixed(0)}k
          </span>
        ) : (
          <span className="text-slate-400 text-[11px]">No value</span>
        )}
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{lead.source}</span>
      </div>

      {/* Contact info */}
      <div className="space-y-1 mb-2">
        {lead.email && (
          <CopyableContact
            value={lead.email}
            label="Email"
            icon={AtSign}
            className="text-[11px] text-slate-500"
          />
        )}
        {lead.phone && (
          <CopyableContact
            value={lead.phone}
            label="Phone"
            icon={Phone}
            className="text-[11px] text-slate-500"
          />
        )}
      </div>

      {/* Owner + date */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/40">
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <User className="w-3 h-3" /> {lead.assignedTo || 'Unassigned'}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-500 text-right">
          <Calendar className="w-3 h-3 flex-shrink-0" />
          <span className="leading-tight">
            <span className="block">{created.date}</span>
            {created.time && <span className="block text-[9px] text-slate-400">{created.time}</span>}
          </span>
        </div>
      </div>

      {latestActivity && (
        <div className="mt-2 rounded-lg bg-brand-50/70 dark:bg-brand-950/20 border border-brand-100/80 dark:border-brand-900/50 px-2 py-1.5 text-[10px] text-brand-700 dark:text-brand-300 line-clamp-2">
          {latestActivity}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/40">
        {canMoveLead && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onActivities?.(lead) }}
            className="p-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/30 text-slate-400 hover:text-violet-600 transition-colors"
            title="Open activities"
          >
            <ClipboardList className="w-3.5 h-3.5" />
          </button>
        )}
        {lead.phone && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onCall?.(lead) }}
            disabled={callingLeadId === lead.id}
            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50"
            title={callingLeadId === lead.id ? 'Calling…' : 'Call'}
          >
            <PhoneCall className={`w-3.5 h-3.5 ${callingLeadId === lead.id ? 'animate-pulse' : ''}`} />
          </button>
        )}
        {lead.phone && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onWhatsApp?.(lead) }}
            className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-950/30 text-slate-400 hover:text-green-600 transition-colors"
            title="WhatsApp"
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
        )}
        {lead.service && (
          <span className="ml-auto text-[10px] text-slate-400 truncate max-w-[80px]" title={lead.service}>
            <Tag className="w-3 h-3 inline mr-0.5" />{lead.service}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Sortable wrapper for lead cards ───────────────────────── */
function SortableLeadCard({
  lead, stage, isMenuOpen, onToggleMenu, onMoveLead, onDeleteLead,
  agingMeta, canMoveLead, canDeleteLead, onCall, onWhatsApp, onActivities, onHistory, callingLeadId, activityState,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(lead.id),
    disabled: !canMoveLead,
    data: { stage },
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: 'none',
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isMenuOpen ? 'relative z-30' : 'relative'}
      {...attributes}
      {...listeners}
    >
      <LeadCard
        lead={lead}
        stage={stage}
        isDragging={isDragging}
        isMenuOpen={isMenuOpen}
        onToggleMenu={onToggleMenu}
        onMoveLead={onMoveLead}
        onDeleteLead={onDeleteLead}
        agingMeta={agingMeta}
        canMoveLead={canMoveLead}
        canDeleteLead={canDeleteLead}
        onCall={onCall}
        onWhatsApp={onWhatsApp}
        onActivities={onActivities}
        onHistory={onHistory}
        callingLeadId={callingLeadId}
        activityState={activityState}
      />
    </div>
  )
}

/* ── Kanban column ─────────────────────────────────────────── */
function KanbanColumn({
  stage, leads: columnLeads, onAddLead, openMenuId, onToggleMenu,
  onMoveLead, onDeleteLead, canCreateLead, canMoveLead, canDeleteLead,
  onCall, onWhatsApp, onActivities, onHistory, callingLeadId, activityStateByLeadId,
}) {
  const totalValue = columnLeads.reduce((s, l) => s + (l.value || 0), 0)
  const dropId = `${STAGE_DROP_PREFIX}${stage.key}`
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { stage: stage.key, type: 'stage' },
  })

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column transition-colors ${isOver ? 'ring-2 ring-brand-300 dark:ring-brand-500/60' : ''}`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
          <span className="min-w-0">
            {stage.group && <span className="block text-[9px] uppercase tracking-wide text-slate-400 leading-none">{stage.group}</span>}
            <span className="block text-sm font-semibold text-slate-700 dark:text-slate-300 leading-tight">{stage.label}</span>
          </span>
          <span className="badge bg-white/80 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400">
            {columnLeads.length}
          </span>
        </div>
        {canCreateLead && (
          <button
            onClick={() => onAddLead(stage.key)}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Column value */}
      {totalValue > 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400 px-1 mb-2">
          ₹{(totalValue / 100000).toFixed(1)}L total
        </div>
      )}

      {/* Lead cards */}
      <SortableContext id={stage.key} items={columnLeads.map((l) => String(l.id))} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 flex-1 min-h-[120px]">
          {columnLeads.map((lead) => (
            <SortableLeadCard
              key={lead.id}
              lead={lead}
              stage={stage.key}
              isMenuOpen={openMenuId === lead.id}
              onToggleMenu={onToggleMenu}
              onMoveLead={onMoveLead}
              onDeleteLead={onDeleteLead}
              agingMeta={getLeadAgingMeta(lead)}
              canMoveLead={canMoveLead}
              canDeleteLead={canDeleteLead}
              onCall={onCall}
              onWhatsApp={onWhatsApp}
              onActivities={onActivities}
              onHistory={onHistory}
              callingLeadId={callingLeadId}
              activityState={activityStateByLeadId?.[lead.id]}
            />
          ))}
          {columnLeads.length === 0 && (
            <div className="flex-1 flex items-center justify-center min-h-[200px]">
              <p className="text-xs text-slate-400 text-center py-8">Drop leads here</p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/* ── Add Lead Modal (compact, for pipeline) ────────────────── */
function AddLeadModal({ onClose, onAdd, teamMembers, initialStage }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '', service: '', specialization: '',
    source: 'Website', sourceLabel: '', score: 'warm', status: initialStage || 'new',
    assignedToId: '', value: '', tags: '', expectedCloseTimeline: ''
  })
  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'expectedCloseTimeline' && value) {
      const scoreMap = { DAYS_1_3: 'hot', DAYS_7_10: 'warm', DAYS_10_15_PLUS: 'cold' }
      setForm((prev) => ({ ...prev, [name]: value, score: scoreMap[value] || prev.score }))
    } else if (name === 'source') {
      setForm((prev) => ({ ...prev, source: value, sourceLabel: sourceNeedsLabel(value) ? prev.sourceLabel : '' }))
    } else {
      setForm((prev) => ({ ...prev, [name]: value }))
    }
  }
  const assigneeOptions = useMemo(() => [
    { value: '', label: 'Unassigned' },
    ...(teamMembers || []).map((member) => ({
      value: member.id,
      label: member.name,
      meta: member.role || '',
    })),
  ], [teamMembers])

  const handleSubmit = (e) => {
    e.preventDefault()
    onAdd({
      ...form,
      id: Date.now(),
      createdAt: new Date().toISOString().split('T')[0],
      createdAtTs: new Date().toISOString(),
      followUpSlaMinutes: 60,
      value: Number(form.value) || 0,
    })
    onClose()
  }

  return (
    <ScreenModalPortal>
      <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-900/50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Add lead"
      onClick={onClose}
    >
      <motion.form
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto custom-scrollbar"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Add Lead</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Full Name *</label>
            <input name="name" value={form.name} onChange={handleChange} required className="input" placeholder="Ramesh Patel" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Company</label>
            <input name="company" value={form.company} onChange={handleChange} className="input" placeholder="Tech Corp" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Email *</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} required className="input" placeholder="ramesh@techcorp.in" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Phone</label>
            <input name="phone" value={form.phone} onChange={handleChange} className="input" placeholder="+91-98765-43210" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Service</label>
            <input name="service" value={form.service} onChange={handleChange} className="input" placeholder="CRM Setup" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Deal Value (₹)</label>
            <input name="value" type="number" value={form.value} onChange={handleChange} className="input" placeholder="100000" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Source</label>
            <select name="source" value={form.source} onChange={handleChange} className="input">
              {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          {sourceNeedsLabel(form.source) && (
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                {form.source === 'Referral' ? 'Referral by' : 'Custom source'}
              </label>
              <input
                name="sourceLabel"
                value={form.sourceLabel}
                onChange={handleChange}
                className="input"
                placeholder={form.source === 'Referral' ? 'Person name' : 'Fire exhibition'}
              />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">AI Score</label>
            <select name="score" value={form.score} onChange={handleChange} className="input">
              <option value="hot">🔥 Hot</option>
              <option value="warm">🌡️ Warm</option>
              <option value="cold">❄️ Cold</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Status</label>
            <select name="status" value={form.status} onChange={handleChange} className="input">
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Expected Close</label>
            <select name="expectedCloseTimeline" value={form.expectedCloseTimeline} onChange={handleChange} className="input">
              <option value="">Select timeline</option>
              <option value="DAYS_1_3">1-3 Days (Hot)</option>
              <option value="DAYS_7_10">7-10 Days (Warm)</option>
              <option value="DAYS_10_15_PLUS">10-15+ Days (Cold)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Assigned To</label>
          <PaginatedSelect
            value={form.assignedToId}
            onChange={(nextValue) => setForm((prev) => ({ ...prev, assignedToId: nextValue }))}
            options={assigneeOptions}
            placeholder="Unassigned"
            searchPlaceholder="Search employees..."
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button type="submit" className="btn-primary text-xs">Create Lead</button>
        </div>
      </motion.form>
      </motion.div>
    </ScreenModalPortal>
  )
}

/* ── Main Pipeline Page ────────────────────────────────────── */
export default function KanbanPage() {
  const { user } = useAuthStore()
  const {
    leads,
    fetchPipelineBoard,
    createLead,
    deleteLead,
    patchLeadLocal,
  } = useLeadsStore()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [openMenuId, setOpenMenuId] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addStage, setAddStage] = useState('new')
  const [filterScore, setFilterScore] = useState('all')
  const [filterSource, setFilterSource] = useState('all')
  const [filterOwner, setFilterOwner] = useState('all')
  const [dateRange, setDateRange] = useState(emptyDateRange)
  const [teamMembers, setTeamMembers] = useState([])
  const [callingLeadId, setCallingLeadId] = useState(null)
  const [callingLeadModal, setCallingLeadModal] = useState(null)
  const [activitiesLead, setActivitiesLead] = useState(null)
  const [activityStateByLeadId, setActivityStateByLeadId] = useState({})
  const [activityTabByLeadId, setActivityTabByLeadId] = useState({})
  const [boardPage, setBoardPage] = useState(0)
  const [boardTotal, setBoardTotal] = useState(0)
  const [boardHasMore, setBoardHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  const canCreateLead = hasPermission(user, PERMISSIONS.LEADS_CREATE)
  const canUpdateLead = hasPermission(user, PERMISSIONS.LEADS_UPDATE)
  const canDeleteLead = hasPermission(user, PERMISSIONS.LEADS_DELETE)
  const canExportLeads = hasPermission(user, PERMISSIONS.LEADS_EXPORT)
  const canCall = hasPermission(user, PERMISSIONS.COMMUNICATIONS_SEND)
  const canViewTeam = hasPermission(user, PERMISSIONS.TEAM_VIEW)

  const filterRef = useRef(null)
  const boardScrollRef = useRef(null)
  const routeSearch = searchParams.get('search') ?? ''

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => { setSearch(routeSearch) }, [routeSearch])

  /* Load pipeline leads in chunks so opening the board does not fan out every page. */
  const loadLeads = useCallback(async ({ page = 0, append = false } = {}) => {
    try {
      const board = await fetchPipelineBoard({ page, size: PIPELINE_PAGE_SIZE, append })
      const activityStates = {}
      const rows = board?.leads || []
      const activitiesByLeadId = board?.activities || {}
      const leadIds = Array.from(new Set(rows.map((lead) => lead?.id).filter(Boolean)))
      leadIds.forEach((leadId) => { activityStates[leadId] = emptyActivityState() })

      leadIds.forEach((leadId) => {
        activityStates[leadId] = buildActivityModalState(unwrapActivityRows(activitiesByLeadId[leadId]))
      })

      setActivityStateByLeadId((prev) => append ? { ...prev, ...activityStates } : activityStates)
      setBoardPage(board?.pageInfo?.page ?? page)
      setBoardTotal(board?.pageInfo?.total ?? rows.length)
      setBoardHasMore(Boolean(board?.hasMore))
    } catch (err) {
      toast.error(err?.message || 'Failed to load leads')
    }
  }, [fetchPipelineBoard])

  const loadMoreLeads = useCallback(async () => {
    if (loadingMore || !boardHasMore) return
    setLoadingMore(true)
    try {
      await loadLeads({ page: boardPage + 1, append: true })
    } finally {
      setLoadingMore(false)
    }
  }, [boardHasMore, boardPage, loadLeads, loadingMore])

  const loadAllPipelineForExport = useCallback(async () => {
    const rawLeads = []
    const activities = {}
    let page = 0
    let pagesFetched = 0

    while (pagesFetched < 100) {
      const board = await leadsAPI.getPipelineBoard({ page, size: PIPELINE_EXPORT_PAGE_SIZE })
      const pageRows = Array.isArray(board?.content) ? board.content : []
      rawLeads.push(...pageRows)
      Object.assign(activities, board?.activities || {})

      pagesFetched += 1
      const totalPages = Number(board?.totalPages || 0)
      const isLastPage = board?.last === true || pageRows.length === 0 || (totalPages > 0 && page + 1 >= totalPages)
      if (isLastPage) break
      page += 1
    }

    return {
      leads: rawLeads.map((lead, index) => toPipelineExportLead(lead, index)),
      activities,
    }
  }, [])

  const handleDownloadPdf = useCallback(async () => {
    if (!canExportLeads) {
      toast.error('You do not have permission to export leads.')
      return
    }
    if (exportingPdf) return

    setExportingPdf(true)
    try {
      const { leads: exportLeads, activities } = await loadAllPipelineForExport()
      if (!exportLeads.length) {
        toast.error('No pipeline leads available to download.')
        return
      }

      const stageBuckets = Object.fromEntries(STAGES.map((stage) => [stage.key, []]))
      exportLeads.forEach((lead) => {
        const activityState = buildActivityModalState(unwrapActivityRows(activities[lead.id]))
        const stageKey = getWorkflowStageForLead(lead, activityState)
        const stage = STAGES.find((item) => item.key === stageKey) || STAGES[0]
        stageBuckets[stage.key].push([
          lead.name || '-',
          lead.company || '-',
          lead.phone || '-',
          lead.email || '-',
          lead.source || '-',
          lead.score ? lead.score.toUpperCase() : '-',
          lead.assignedTo || 'Unassigned',
          formatExportDateTime(lead.createdAtTs || lead.createdAt),
        ])
      })

      const doc = new jsPDF({ orientation: 'landscape' })
      const today = new Date()
      const generatedAt = today.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const activeStages = STAGES.filter((stage) => stageBuckets[stage.key].length > 0)
      const busiestStage = STAGES.reduce((best, stage) => (
        stageBuckets[stage.key].length > stageBuckets[best.key].length ? stage : best
      ), STAGES[0])
      const untouchedLeads = stageBuckets.new?.length || 0
      const stageNote = (stage, count) => {
        if (!count) return 'No leads parked here right now.'
        if (stage.key === 'new') return 'Fresh intake - assign, call, and qualify quickly.'
        if (stage.key.includes('lost')) return 'Review reasons and recycle useful learnings.'
        if (stage.key.includes('won')) return 'Won pipeline - close handoff and customer onboarding.'
        if (stage.key.includes('meeting')) return 'Meeting-ready leads - protect next actions and dates.'
        if (stage.key.includes('interested')) return 'Interested leads - push to follow-up before interest cools.'
        return 'Active working queue - keep ownership and next step clear.'
      }
      const drawFooter = (data) => {
        doc.setFontSize(7)
        doc.setTextColor(100, 116, 139)
        doc.text('NexaCRM pipeline export', data.settings.margin.left, pageHeight - 8)
        doc.text(`Page ${doc.internal.getNumberOfPages()}`, pageWidth - 28, pageHeight - 8)
      }
      const ensureRoom = (minHeight = 42) => {
        const nextY = (doc.lastAutoTable?.finalY || 0) + 10
        if (nextY + minHeight > pageHeight - 18) {
          doc.addPage()
          return 18
        }
        return nextY
      }

      doc.setProperties({ title: 'NexaCRM Pipeline Report' })
      doc.setFillColor(15, 23, 42)
      doc.rect(0, 0, pageWidth, 38, 'F')
      doc.setFillColor(14, 165, 233)
      doc.roundedRect(14, 10, 42, 8, 2, 2, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(7)
      doc.text('LIVE PIPELINE', 19, 15.5)
      doc.setFontSize(19)
      doc.text('NexaCRM Pipeline Playbook', 14, 27)
      doc.setFontSize(9)
      doc.text(`Every lead, organized stage by stage - generated ${generatedAt}`, 14, 34)
      doc.setFillColor(34, 197, 94)
      doc.circle(pageWidth - 25, 18, 9, 'F')
      doc.setFontSize(14)
      doc.text(String(exportLeads.length), pageWidth - 30, 20)
      doc.setFontSize(7)
      doc.text('LEADS', pageWidth - 34, 28)
      doc.setTextColor(15, 23, 42)

      autoTable(doc, {
        startY: 48,
        head: [['Highlight', 'What it means']],
        body: [
          ['Total leads', `${exportLeads.length.toLocaleString('en-IN')} leads across the full pipeline.`],
          ['Active stages', `${activeStages.length.toLocaleString('en-IN')} of ${STAGES.length.toLocaleString('en-IN')} stages currently have leads.`],
          ['Busiest stage', `${busiestStage.group} - ${busiestStage.label} has ${stageBuckets[busiestStage.key].length.toLocaleString('en-IN')} lead(s).`],
          ['Fresh intake', `${untouchedLeads.toLocaleString('en-IN')} lead(s) are still in New and need first action.`],
        ],
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [14, 165, 233] },
        columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' }, 1: { cellWidth: 220 } },
        theme: 'striped',
        didDrawPage: drawFooter,
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 8,
        head: [['Pipeline Stage', 'Leads', 'Focus Note']],
        body: STAGES.map((stage) => [
          `${stage.group} - ${stage.label}`,
          stageBuckets[stage.key].length.toLocaleString('en-IN'),
          stageNote(stage, stageBuckets[stage.key].length),
        ]),
        styles: { fontSize: 8, cellPadding: 2.4 },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 165 } },
        theme: 'striped',
        didDrawPage: drawFooter,
      })

      STAGES.forEach((stage, index) => {
        const rows = stageBuckets[stage.key]
        const startY = ensureRoom(rows.length ? 48 : 34)
        if (index > 0 && startY === 18) {
          doc.setFillColor(241, 245, 249)
          doc.rect(0, 0, pageWidth, 9, 'F')
        }

        doc.setFontSize(12)
        doc.setTextColor(15, 23, 42)
        doc.text(`${stage.group} - ${stage.label}`, 14, startY)
        doc.setFontSize(8)
        doc.setTextColor(71, 85, 105)
        doc.text(`${rows.length.toLocaleString('en-IN')} lead(s). ${stageNote(stage, rows.length)}`, 14, startY + 6)

        autoTable(doc, {
          startY: startY + 10,
          head: [['Lead', 'Company', 'Phone', 'Email', 'Source', 'Score', 'Owner', 'Created']],
          body: rows.length ? rows : [['No leads in this pipeline stage', '-', '-', '-', '-', '-', '-', '-']],
          styles: { fontSize: 6.8, cellPadding: 1.8, overflow: 'linebreak' },
          headStyles: { fillColor: rows.length ? [34, 197, 94] : [148, 163, 184] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: {
            0: { cellWidth: 34, fontStyle: 'bold' },
            1: { cellWidth: 32 },
            2: { cellWidth: 25 },
            3: { cellWidth: 44 },
            4: { cellWidth: 22 },
            5: { cellWidth: 16, halign: 'center' },
            6: { cellWidth: 28 },
            7: { cellWidth: 30 },
          },
          theme: 'grid',
          didDrawPage: drawFooter,
        })
      })

      doc.save(`nexacrm-pipeline-${today.toISOString().slice(0, 10)}.pdf`)
      toast.success('Pipeline PDF downloaded.')
    } catch (err) {
      toast.error(err?.message || 'Failed to download pipeline PDF')
    } finally {
      setExportingPdf(false)
    }
  }, [canExportLeads, exportingPdf, loadAllPipelineForExport])

  useEffect(() => {
    setLoading(true)
    loadLeads().finally(() => setLoading(false))
  }, [loadLeads])

  /* Load team members */
  useEffect(() => {
    if (!canViewTeam) { setTeamMembers([]); return }
    teamAPI.getAll()
      .then((rows) => {
        setTeamMembers((rows || [])
          .filter((r) => r && r.id && r.name && r.isActive !== false)
          .map((r) => ({ id: r.id, name: r.name })))
      })
      .catch(() => setTeamMembers([]))
  }, [canViewTeam])

  /* Close menus on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false)
      if (!e.target.closest('[data-lead-menu]')) setOpenMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* Unique owners for filter */
  const owners = useMemo(() => {
    const all = leads.map((l) => l.assignedTo).filter(Boolean)
    return [...new Set(all)]
  }, [leads])
  const ownerOptions = useMemo(() => [
    { value: 'all', label: 'All owners' },
    ...owners.map((owner) => ({ value: owner, label: owner })),
  ], [owners])

  /* Group leads by exact saved activity/status into pipeline columns */
  const leadsByStage = useMemo(() => {
    const q = search.toLowerCase()
    const map = {}
    for (const stage of STAGES) map[stage.key] = []

    for (const lead of leads) {
      const stageKey = getWorkflowStageForLead(lead, activityStateByLeadId[lead.id])
      if (!map[stageKey]) continue // skip unknown statuses

      // Apply filters
      const matchesSearch = anyFieldMatchesSearch(q, [lead.name, lead.phone, lead.company, lead.email])
      const matchesScore = filterScore === 'all' || lead.score === filterScore
      const matchesSource = filterSource === 'all' || lead.source === filterSource
      const matchesOwner = filterOwner === 'all' || lead.assignedTo === filterOwner
      const matchesDate = isWithinDateRange(lead.createdAtTs || lead.createdAt || lead.updatedAt, dateRange)
      if (matchesSearch && matchesScore && matchesSource && matchesOwner && matchesDate) {
        map[stageKey].push(lead)
      }
    }
    return map
  }, [leads, activityStateByLeadId, search, filterScore, filterSource, filterOwner, dateRange])

  const totalLeads = Object.values(leadsByStage).reduce((s, arr) => s + arr.length, 0)
  const totalValue = Object.values(leadsByStage).flat().reduce((s, l) => s + (l.value || 0), 0)

  /* Find a lead and its stage */
  const findLeadAndStage = useCallback((id) => {
    for (const stage of Object.keys(leadsByStage)) {
      const lead = leadsByStage[stage].find((l) => String(l.id) === String(id))
      if (lead) return { lead, stage }
    }
    return null
  }, [leadsByStage])

  /* ── Move lead status (shared by drag-drop and context menu) ── */
  const moveLeadStatus = useCallback(async (leadId, targetStage) => {
    if (!canUpdateLead) { toast.error('No permission to move leads.'); return }

    const source = findLeadAndStage(leadId)
    if (!source || source.stage === targetStage) return

    const stageLabel = STAGES.find((s) => s.key === targetStage)?.label || targetStage
    const previousActivityState = activityStateByLeadId[source.lead.id]
    const previousLead = source.lead

    try {
      if (targetStage === 'new') {
        const hasSavedActivity = (activityStateByLeadId[source.lead.id]?.saved || []).some(Boolean)
        if (hasSavedActivity) {
          toast.error('New is only for leads before activity starts.')
          return
        }
        patchLeadLocal(source.lead.id, { status: 'new' })
        const updated = await leadsAPI.update(source.lead.id, buildBackendLeadPayload(source.lead, 'NEW'))
        patchLeadLocal(source.lead.id, updated)
      } else {
        const activityPayload = buildStageActivityPayload(targetStage, source.lead)
        if (!activityPayload) {
          toast.error('This pipeline stage is not linked to an activity.')
          return
        }
        const touchedAt = new Date().toISOString()
        const optimisticActivity = {
          ...activityPayload,
          id: `pending-${source.lead.id}-${Date.now()}`,
          leadId: source.lead.id,
          savedAt: touchedAt,
          createdAt: touchedAt,
        }

        setActivityStateByLeadId((prev) => ({
          ...prev,
          [source.lead.id]: mergeActivityIntoState(prev[source.lead.id], optimisticActivity),
        }))
        patchLeadLocal(source.lead.id, buildLocalLeadPatchForActivity(source.lead, optimisticActivity))

        const savedActivity = await leadsAPI.addActivity(source.lead.id, activityPayload)
        const activityRow = savedActivity || optimisticActivity
        setActivityStateByLeadId((prev) => ({
          ...prev,
          [source.lead.id]: mergeActivityIntoState(prev[source.lead.id], activityRow),
        }))
        patchLeadLocal(source.lead.id, buildLocalLeadPatchForActivity(source.lead, activityRow))
      }
      toast.success(`${source.lead.name} → ${stageLabel}`)
    } catch (err) {
      setActivityStateByLeadId((prev) => ({ ...prev, [source.lead.id]: previousActivityState || emptyActivityState() }))
      patchLeadLocal(source.lead.id, previousLead)
      toast.error(err?.message || 'Failed to move lead')
    }
  }, [activityStateByLeadId, canUpdateLead, findLeadAndStage, patchLeadLocal])

  /* ── Drag & drop handlers ────────────────────────────────── */
  const handleDragStart = ({ active }) => setActiveId(active.id)

  const handleDragEnd = async ({ active, over }) => {
    setActiveId(null)
    if (!canUpdateLead || !over || active.id === over.id) return

    const source = findLeadAndStage(active.id)
    if (!source) return

    const overId = over?.id
    const stageFromDropId =
      typeof overId === 'string' && overId.startsWith(STAGE_DROP_PREFIX)
        ? overId.slice(STAGE_DROP_PREFIX.length)
        : null
    const stageFromItem = over?.data?.current?.stage
    const stageFromSortable = over?.data?.current?.sortable?.containerId
    const targetStage = (
      stageFromDropId ||
      stageFromItem ||
      (typeof stageFromSortable === 'string' && leadsByStage[stageFromSortable] ? stageFromSortable : null) ||
      // Bare stage key from SortableContext container (e.g. "followup_meeting")
      (typeof overId === 'string' && STAGE_KEYS.has(overId) ? overId : null) ||
      Object.keys(leadsByStage).find((s) => leadsByStage[s].some((l) => String(l.id) === String(overId)))
    )
    if (!targetStage || targetStage === source.stage) return

    moveLeadStatus(source.lead.id, targetStage)
  }

  const activeLead = activeId ? findLeadAndStage(activeId)?.lead : null

  /* ── Move via context menu ───────────────────────────────── */
  const moveLead = async (leadId, targetStage) => {
    setOpenMenuId(null)
    moveLeadStatus(leadId, targetStage)
  }

  /* ── Delete ──────────────────────────────────────────────── */
  const handleDeleteLead = async (leadId) => {
    if (!canDeleteLead) { toast.error('No permission to delete leads.'); return }
    try {
      await deleteLead(leadId)
      setOpenMenuId(null)
      toast.success('Lead deleted')
    } catch (err) {
      toast.error(err?.message || 'Failed to delete lead')
    }
  }

  /* ── Add lead ────────────────────────────────────────────── */
  const openAddModal = (stage = 'new') => {
    if (!canCreateLead) { toast.error('No permission to create leads.'); return }
    setAddStage(stage)
    setShowAddModal(true)
  }

  const handleAddLead = async (leadData) => {
    if (!canCreateLead) { toast.error('No permission to create leads.'); return }
    try {
      const workflowStage = leadData?.status || 'new'
      const created = await createLead({ ...leadData, status: 'new' })
      if (workflowStage !== 'new' && canUpdateLead) {
        const activityPayload = buildStageActivityPayload(workflowStage, created)
        if (activityPayload) {
          const savedActivity = await leadsAPI.addActivity(created.id, activityPayload)
          setActivityStateByLeadId((prev) => ({
            ...prev,
            [created.id]: mergeActivityIntoState(prev[created.id], savedActivity || { ...activityPayload, leadId: created.id }),
          }))
          patchLeadLocal(created.id, buildLocalLeadPatchForActivity(created, savedActivity || { ...activityPayload, leadId: created.id }))
        }
      }
      toast.success('Lead added to pipeline!')
    } catch (err) {
      toast.error(err?.message || 'Failed to add lead')
    }
  }

  /* ── Call ─────────────────────────────────────────────────── */
  const handleCallLead = (lead) => {
    if (!canCall) {
      toast.error('You do not have permission to place calls.')
      return
    }
    if (!lead?.phone) {
      toast.error('This lead has no phone number.')
      return
    }
    setCallingLeadModal(lead)
  }

  const handleWhatsApp = (lead) => {
    if (!lead?.phone) { toast.error('No phone number'); return }
    const phone = lead.phone.replace(/[^0-9+]/g, '')
    window.open(`https://wa.me/${phone.replace('+', '')}`, '_blank')
  }

  /* ── Activity workflow ───────────────────────────────────── */
  const loadLeadActivityState = useCallback(async (leadId) => {
    if (!leadId) return emptyActivityState()
    const rows = await leadsAPI.getActivities(leadId)
    const state = buildActivityModalState(rows || [])
    setActivityStateByLeadId((prev) => ({ ...prev, [leadId]: state }))
    return state
  }, [])

  const openActivitiesLead = async (lead) => {
    if (!lead?.id) return
    if (!canUpdateLead) { toast.error('No permission to update lead activities.'); return }
    try {
      await loadLeadActivityState(lead.id)
      setActivitiesLead(lead)
    } catch (err) {
      toast.error(err?.message || 'Failed to load activities')
    }
  }

  const handleActivityTabChange = (leadId, tabIndex) => {
    if (!leadId && leadId !== 0) return
    setActivityTabByLeadId((prev) => ({ ...prev, [leadId]: tabIndex }))
  }

  const getActivityState = (leadId) => activityStateByLeadId[leadId] || emptyActivityState()

  const handlePersistActivity = async ({ lead, activityIndex, activity, values }) => {
    if (!canUpdateLead) {
      throw new Error('You do not have permission to update lead activities.')
    }

    const payload = {
      activityIndex,
      activityId: activity?.id || null,
      activityLabel: activity?.label || `Activity ${Number(activityIndex) + 1}`,
      activityTitle: activity?.title || '',
      assignedTo: values?.assignedTo || lead?.assignedToName || lead?.assignedTo?.name || lead?.assignedTo || null,
      values: values || {},
      summary: buildActivitySummary({ activityIndex, lead, values }),
    }

    const previousActivityState = activityStateByLeadId[lead.id]
    const previousLead = lead
    const touchedAt = new Date().toISOString()
    const optimisticActivity = {
      ...payload,
      id: `pending-${lead.id}-${Date.now()}`,
      leadId: lead.id,
      savedAt: touchedAt,
      createdAt: touchedAt,
    }

    setActivityStateByLeadId((prev) => ({
      ...prev,
      [lead.id]: mergeActivityIntoState(prev[lead.id], optimisticActivity),
    }))
    patchLeadLocal(lead.id, buildLocalLeadPatchForActivity(lead, optimisticActivity))
    setActivitiesLead((prev) => (prev?.id === lead.id ? { ...prev, ...buildLocalLeadPatchForActivity(lead, optimisticActivity) } : prev))

    try {
      const savedActivity = await leadsAPI.addActivity(lead.id, payload)
      const activityRow = savedActivity || optimisticActivity
      const leadPatch = buildLocalLeadPatchForActivity(lead, activityRow)
      setActivityStateByLeadId((prev) => ({
        ...prev,
        [lead.id]: mergeActivityIntoState(prev[lead.id], activityRow),
      }))
      patchLeadLocal(lead.id, leadPatch)
      setActivitiesLead((prev) => (prev?.id === lead.id ? { ...prev, ...leadPatch } : prev))
    } catch (err) {
      setActivityStateByLeadId((prev) => ({ ...prev, [lead.id]: previousActivityState || emptyActivityState() }))
      patchLeadLocal(lead.id, previousLead)
      setActivitiesLead((prev) => (prev?.id === lead.id ? previousLead : prev))
      throw err
    }
  }

  /* ── Board scroll ────────────────────────────────────────── */
  const scrollBoard = (dir) => {
    boardScrollRef.current?.scrollBy({ left: dir === 'left' ? -420 : 420, behavior: 'smooth' })
  }

  return (
    <div className="space-y-4" onClick={() => setOpenMenuId(null)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeading
          title="Leads Pipeline"
          subtitle={loading
            ? 'Loading leads...'
            : `${totalLeads} leads · ₹${(totalValue / 100000).toFixed(1)}L pipeline value`}
        />
        <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={exportingPdf}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
            title="Download pipeline PDF"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingPdf ? 'Preparing...' : 'PDF'}
          </button>
          <button
            type="button"
            onClick={() => { setLoading(true); loadLeads({ page: 0, append: false }).finally(() => setLoading(false)) }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
            title="Refresh pipeline"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 w-full sm:w-auto">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, company, or email..."
              className="bg-transparent text-sm text-slate-700 dark:text-slate-300 outline-none w-full sm:w-40"
            />
          </div>

          <div className="relative" ref={filterRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowFilters((p) => !p) }}
              className="btn-secondary gap-1.5 text-xs"
            >
              <Filter className="w-3.5 h-3.5" /> Filter
            </button>
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -6 }}
                  transition={{ duration: 0.12 }}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-10 z-30 w-56 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 space-y-2"
                >
                  <select value={filterScore} onChange={(e) => setFilterScore(e.target.value)} className="input text-xs py-2">
                    <option value="all">All scores</option>
                    <option value="hot">🔥 Hot</option>
                    <option value="warm">🌡️ Warm</option>
                    <option value="cold">❄️ Cold</option>
                  </select>
                  <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="input text-xs py-2">
                    <option value="all">All sources</option>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <PaginatedSelect
                    value={filterOwner}
                    onChange={setFilterOwner}
                    options={ownerOptions}
                    placeholder="All owners"
                    searchPlaceholder="Search owners..."
                    pageSize={6}
                  />
                  <DateRangeFilter value={dateRange} onChange={setDateRange} compact />
                  <button
                    onClick={() => { setFilterScore('all'); setFilterSource('all'); setFilterOwner('all'); setDateRange(emptyDateRange()) }}
                    className="w-full text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 py-1"
                  >
                    Clear Filters
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {canCreateLead && (
            <button onClick={() => openAddModal('new')} className="btn-primary gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5" /> Add Lead
            </button>
          )}
        </div>
      </div>

      {/* Kanban board */}
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="mb-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => scrollBoard('left')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            aria-label="Scroll board left"
          >
            <ChevronLeft className="w-4 h-4" /> Left
          </button>
          <button
            type="button"
            onClick={() => scrollBoard('right')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            aria-label="Scroll board right"
          >
            Right <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div ref={boardScrollRef} className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar scroll-smooth">
          {STAGES.map((stage) => (
            <KanbanColumn
              key={stage.key}
              stage={stage}
              leads={leadsByStage[stage.key] || []}
              onAddLead={openAddModal}
              openMenuId={openMenuId}
              onToggleMenu={(id) => setOpenMenuId((prev) => (prev === id ? null : id))}
              onMoveLead={canUpdateLead ? moveLead : () => {}}
              onDeleteLead={canDeleteLead ? handleDeleteLead : () => {}}
              canCreateLead={canCreateLead}
              canMoveLead={canUpdateLead}
              canDeleteLead={canDeleteLead}
              onCall={canCall ? handleCallLead : null}
              onWhatsApp={handleWhatsApp}
              onActivities={openActivitiesLead}
              onHistory={(lead) => setActivitiesLead(lead)}
              callingLeadId={callingLeadId}
              activityStateByLeadId={activityStateByLeadId}
            />
          ))}
        </div>

        <DragOverlay>
          {activeLead ? (
            <LeadCard
              lead={activeLead}
              stage={findLeadAndStage(activeId)?.stage ?? 'new'}
              isDragging={false}
              isMenuOpen={false}
              onToggleMenu={() => {}}
              onMoveLead={() => {}}
              onDeleteLead={() => {}}
              agingMeta={getLeadAgingMeta(activeLead)}
              canMoveLead={false}
              canDeleteLead={false}
              onCall={() => {}}
              onWhatsApp={() => {}}
              onActivities={() => {}}
              onHistory={() => {}}
              callingLeadId={null}
              activityState={activeLead ? activityStateByLeadId[activeLead.id] : null}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {boardHasMore && (
        <div className="flex items-center justify-center gap-3">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Showing {leads.length} of {boardTotal} leads
          </span>
          <button
            type="button"
            onClick={loadMoreLeads}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMore ? 'animate-spin' : ''}`} />
            Load more
          </button>
        </div>
      )}

      {/* Add Lead Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddLeadModal
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddLead}
            teamMembers={teamMembers}
            initialStage={addStage}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activitiesLead && (
          <LeadActivitiesModal
            lead={activitiesLead}
            onClose={() => {
              const id = activitiesLead?.id
              setActivitiesLead(null)
              if (id) loadLeadActivityState(id).catch(() => {})
            }}
            onPersist={handlePersistActivity}
            initialData={getActivityState(activitiesLead.id).data}
            initialSaved={getActivityState(activitiesLead.id).saved}
            initialActiveTab={activityTabByLeadId[activitiesLead.id] ?? Math.max(0, getLeadCurrentStage(getActivityState(activitiesLead.id)))}
            onActiveTabChange={handleActivityTabChange}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {callingLeadModal && (
          <ScreenModalPortal>
            <CallLeadModal
              lead={callingLeadModal}
              onClose={() => setCallingLeadModal(null)}
              onCallSuccess={() => {
                const targetLead = callingLeadModal
                const nowIso = new Date().toISOString()
                patchLeadLocal(targetLead.id, {
                  lastContactedAtTs: nowIso,
                  lastActivityAtTs: nowIso,
                })
                setCallingLeadModal(null)
              }}
            />
          </ScreenModalPortal>
        )}
      </AnimatePresence>
    </div>
  )
}
