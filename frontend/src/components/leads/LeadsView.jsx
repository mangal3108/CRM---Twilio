import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import {
  Plus, Search, Download, Upload, Trash2,
  Edit, ChevronUp, ChevronDown, Flame, Thermometer,
  Snowflake, ExternalLink, X, History,
  PhoneCall, Mail, MessageSquare, UserCheck,
  FileText, DollarSign, AlertCircle, Building2,
  Tag, Calendar, User, Phone, AtSign, TrendingUp, ClipboardList, MessageCircle, BadgeCheck, Brain, Clock, Trophy
} from 'lucide-react'
import toast from 'react-hot-toast'
import LeadActivitiesModal from '../../components/LeadActivitiesModal'
import { sendWhatsApp } from '../../utils/whatsapp'
import {
  KRISCEL_WHATSAPP_FOLLOW_UP_MESSAGE,
  KRISCEL_WHATSAPP_PROPOSAL_MESSAGE,
  KRISCEL_WHATSAPP_THANK_YOU_MESSAGE,
  KRISCEL_WHATSAPP_WELCOME_MESSAGE,
} from '../../utils/whatsappTemplates'
import { useLeadsStore } from '../../store/leadsStore'
import { useAuthStore } from '../../store/authStore'
import { getLeadAgingMeta, getLeadAgeMinutes } from '../../utils/leadSla'
import { callsAPI, leadsAPI, teamAPI } from '../../services/api'
import { PERMISSIONS, hasPermission } from '../../utils/permissions'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import ScreenModalPortal from '../ui/ScreenModalPortal'
import CallLeadModal from './CallLeadModal'
import CopyableContact from '../ui/CopyableContact'
import PhoneInputWithCountry from '../ui/PhoneInputWithCountry'
import DateRangeFilter from '../ui/DateRangeFilter'
import { emptyDateRange, hasDateRangeFilter, isWithinDateRange } from '../../utils/dateRangeFilter'

const SCORE_BADGE = {
  hot:  { label: 'Hot',  icon: Flame,       cls: 'badge-hot' },
  warm: { label: 'Warm', icon: Thermometer, cls: 'badge-warm' },
  cold: { label: 'Cold', icon: Snowflake,   cls: 'badge-cold' },
}

const STATUS_BADGE = {
  new:          { label: 'New',          cls: 'badge-new' },
  contacted:    { label: 'Contacted',    cls: 'badge bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  qualified:    { label: 'Qualified',    cls: 'badge bg-brand-100 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300' },
  proposal:     { label: 'Proposal',     cls: 'badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  negotiation:  { label: 'Negotiation',  cls: 'badge bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  won:          { label: 'Won',          cls: 'badge-won' },
  lost:         { label: 'Lost',         cls: 'badge-lost' },
}

const STAGE_ICON_DEFS = [
  { icon: Phone,  label: 'Welcome Call',      bg: 'bg-red-500',     ring: 'ring-red-400/40' },
  { icon: Clock,  label: 'Follow-up Meeting', bg: 'bg-blue-500',    ring: 'ring-blue-400/40' },
  { icon: Trophy, label: 'Meeting Outcome',   bg: 'bg-emerald-500', ring: 'ring-emerald-400/40' },
]

const LEAD_SOURCES = [
  'Facebook', 'Instagram', 'LinkedIn', 'Website', 'WhatsApp',
  'Google Ads', 'Meta Ads', 'Referral', 'Email', 'Other',
]

const sourceNeedsLabel = (source) => source === 'Other' || source === 'Referral'

const referralNameFromDisplay = (source) => String(source || '').replace(/^referral:\s*/i, '').trim()

const standardSourceValue = (source) => {
  const value = String(source || '').trim()
  if (/^referral:/i.test(value)) return 'Referral'
  return LEAD_SOURCES.includes(value) ? value : 'Other'
}

const customSourceValue = (source, sourceLabel) => {
  const label = String(sourceLabel || '').trim()
  if (label) return label
  const value = String(source || '').trim()
  if (/^referral:/i.test(value)) return referralNameFromDisplay(value)
  return value && !LEAD_SOURCES.includes(value) && value.toLowerCase() !== 'other' ? value : ''
}

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

function AddLeadModal({ onClose, onAdd, teamMembers }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '', service: '', specialization: '',
    source: 'Website', sourceLabel: '', score: 'warm', status: 'new',
    assignedToId: '', value: '', tags: '', lostReason: '', expectedCloseTimeline: ''
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

  const handleSubmit = (e) => {
    e.preventDefault()
    const now = new Date()
    onAdd({
      ...form,
      id: Date.now(),
      createdAt: now.toISOString().split('T')[0],
      createdAtTs: now.toISOString(),
      followUpSlaMinutes: 60,
      value: Number(form.value) || 0,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add lead">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative glass-card w-full max-w-lg p-6 z-10 max-h-[90vh] overflow-y-auto custom-scrollbar"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Add New Lead</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Phone (with Country Code)</label>
              <PhoneInputWithCountry
                value={form.phone}
                onChange={(val) => setForm(prev => ({ ...prev, phone: val }))}
                placeholder="98765 43210"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Service</label>
              <input name="service" value={form.service} onChange={handleChange} className="input" placeholder="CRM Setup" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Specialization</label>
              <input name="specialization" value={form.specialization} onChange={handleChange} className="input" placeholder="Lead Automation" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Source</label>
              <select name="source" value={form.source} onChange={handleChange} className="input">
                {LEAD_SOURCES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
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
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Deal Value (₹)</label>
              <input name="value" type="number" value={form.value} onChange={handleChange} className="input" placeholder="100000" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Expected Close Timeline</label>
              <select name="expectedCloseTimeline" value={form.expectedCloseTimeline} onChange={handleChange} className="input">
                <option value="">Select timeline</option>
                <option value="DAYS_1_3">1-3 Days (Hot)</option>
                <option value="DAYS_7_10">7-10 Days (Warm)</option>
                <option value="DAYS_10_15_PLUS">10-15+ Days (Cold)</option>
              </select>
            </div>
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
                {['new','contacted','qualified','proposal','negotiation','won','lost'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {form.status === 'lost' && (
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Lost Reason *</label>
                <textarea
                  name="lostReason"
                  value={form.lostReason}
                  onChange={handleChange}
                  required
                  rows={3}
                  className="input resize-none"
                  placeholder="Budget, timing, competitor, or other reason"
                />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Assigned To</label>
            <select name="assignedToId" value={form.assignedToId} onChange={handleChange} className="input">
              <option value="">Unassigned</option>
              {(teamMembers || []).map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Tags (comma separated)</label>
            <input name="tags" value={form.tags} onChange={handleChange} className="input" placeholder="enterprise, priority" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1">Add Lead</button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

/* ── Edit Lead Modal ─────────────────────────────────────────────── */
function EditLeadModal({ lead, onClose, onSave, teamMembers }) {
  const [form, setForm] = useState({
    ...lead,
    source: standardSourceValue(lead?.source),
    sourceLabel: customSourceValue(lead?.source, lead?.sourceLabel),
    assignedToId: lead?.assignedToId || '',
    expectedCloseTimeline: lead?.expectedCloseTimeline || '',
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

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({ ...form, value: Number(form.value) || 0 })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Edit lead">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative glass-card w-full max-w-lg p-6 z-10 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Edit Lead</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Full Name *</label>
              <input name="name" value={form.name} onChange={handleChange} required className="input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Company</label>
              <input name="company" value={form.company} onChange={handleChange} className="input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Email *</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required className="input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Phone (with Country Code)</label>
              <PhoneInputWithCountry
                value={form.phone || ''}
                onChange={(val) => setForm(prev => ({ ...prev, phone: val }))}
                placeholder="98765 43210"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Service</label>
              <input name="service" value={form.service || ''} onChange={handleChange} className="input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Specialization</label>
              <input name="specialization" value={form.specialization || ''} onChange={handleChange} className="input" />
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
                  value={form.sourceLabel || ''}
                  onChange={handleChange}
                  className="input"
                  placeholder={form.source === 'Referral' ? 'Person name' : 'Fire exhibition'}
                />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Deal Value (₹)</label>
              <input name="value" type="number" value={form.value} onChange={handleChange} className="input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Expected Close Timeline</label>
              <select name="expectedCloseTimeline" value={form.expectedCloseTimeline} onChange={handleChange} className="input">
                <option value="">Select timeline</option>
                <option value="DAYS_1_3">1-3 Days (Hot)</option>
                <option value="DAYS_7_10">7-10 Days (Warm)</option>
                <option value="DAYS_10_15_PLUS">10-15+ Days (Cold)</option>
              </select>
            </div>
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
                {['new','contacted','qualified','proposal','negotiation','won','lost'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            {form.status === 'lost' && (
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Lost Reason *</label>
                <textarea
                  name="lostReason"
                  value={form.lostReason || ''}
                  onChange={handleChange}
                  required
                  rows={3}
                  className="input resize-none"
                  placeholder="Budget, timing, competitor, or other reason"
                />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Assigned To</label>
            <select name="assignedToId" value={form.assignedToId || ''} onChange={handleChange} className="input">
              <option value="">Unassigned</option>
              {(teamMembers || []).map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1 gap-2"><Edit className="w-3.5 h-3.5" /> Save Changes</button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

/* ── Lead Detail Card — flat, no-scroll, bg-matched ────────────── */
function LeadDetailModal({ lead, onClose, onEdit, onDelete, canEdit, canDelete, onCall, onWhatsApp, onHistory, canCall, callingLeadId, lastCallOutcome, aging, ageMin }) {
  const scoreCfg  = SCORE_BADGE[lead.score]
  const statusCfg = STATUS_BADGE[lead.status] ?? { label: lead.status, cls: 'badge' }
  const ScoreIcon = scoreCfg?.icon
  const created = formatLeadCreatedDateTime(lead)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Lead details">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto z-10 rounded-2xl border border-slate-200/70 dark:border-slate-700/50 bg-white dark:bg-slate-900 shadow-2xl">

        {/* Header — uses page background, not brand gradient */}
        <div className="px-5 py-4 border-b border-slate-200/70 dark:border-slate-700/40 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">{lead.name}</h2>
              <span className={`${scoreCfg?.cls} text-[11px] flex-shrink-0`}>{ScoreIcon && <ScoreIcon className="w-3 h-3" />} {scoreCfg?.label}</span>
              <span className={`${statusCfg.cls} text-[11px] flex-shrink-0`}>{statusCfg.label}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
              {lead.company && <span>{lead.company}</span>}
              {aging && <span className={`badge ${aging.badge} text-[10px]`}>{aging.label}</span>}
              {lastCallOutcome && (
                <span className={`badge ${getCallOutcomeBadgeClass(lastCallOutcome)} text-[10px]`}>
                  Last Call: {lastCallOutcome}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* All content — single flat view, no scroll */}
        <div className="px-5 py-4 space-y-4">

          {/* Details — compact 5-column grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-2.5">
            {[
              { icon: AtSign,     label: 'Email',    value: lead.email },
              { icon: Phone,      label: 'Phone',    value: lead.phone || '—' },
              { icon: Building2,  label: 'Company',  value: lead.company || '—' },
              { icon: Tag,        label: 'Service',  value: lead.service || '—' },
              { icon: Tag,        label: 'Spec',     value: lead.specialization || '—' },
              { icon: Tag,        label: 'Source',   value: lead.source },
              { icon: DollarSign, label: 'Value',    value: lead.value ? `₹${(lead.value/1000).toFixed(0)}k` : '—' },
              { icon: User,       label: 'Owner',    value: lead.assignedTo || 'Unassigned' },
              { icon: TrendingUp, label: 'Score',    value: scoreCfg?.label },
              { icon: Calendar,   label: 'Added',    value: created.time ? `${created.date} · ${created.time}` : created.date },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-2 min-w-0">
                <Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none">{label}</p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate mt-0.5">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Tags + Activity timer inline */}
          {(lead.tags || (ageMin !== null && ageMin !== undefined)) && (
            <div className="flex items-center gap-4 flex-wrap">
              {ageMin !== null && ageMin !== undefined && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <History className="w-3 h-3 text-slate-400" />
                  <span>{ageMin} min since activity</span>
                </div>
              )}
              {lead.tags && String(lead.tags).split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-400 text-[11px] font-medium">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Quick actions — inline row */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {canCall && (
              <button
                onClick={() => onCall?.(lead)}
                disabled={callingLeadId === lead.id || !lead.phone}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PhoneCall className={`w-3.5 h-3.5 ${callingLeadId === lead.id ? 'animate-pulse' : ''}`} />
                {callingLeadId === lead.id ? 'Calling…' : 'Call'}
              </button>
            )}
            <button onClick={() => onWhatsApp?.(lead)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-950/50 transition-colors">
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </button>
            <button onClick={() => onHistory?.(lead)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-950/50 transition-colors">
              <History className="w-3.5 h-3.5" /> History
            </button>

            {/* Edit / Delete pushed to the right */}
            <div className="flex-1" />
            {canEdit && (
              <button onClick={() => { onClose(); onEdit(lead) }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <Edit className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {canDelete && (
              <button onClick={() => { onDelete([lead.id]); onClose() }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40 text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

const HISTORY_STYLE = {
  activity: { icon: ClipboardList, color: 'text-brand-500 bg-brand-100 dark:bg-brand-950/40' },
  call: { icon: PhoneCall, color: 'text-blue-500 bg-blue-100 dark:bg-blue-950/40' },
  email: { icon: Mail, color: 'text-brand-500 bg-brand-100 dark:bg-brand-950/40' },
  message: { icon: MessageSquare, color: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-950/40' },
  status: { icon: UserCheck, color: 'text-amber-500 bg-amber-100 dark:bg-amber-950/40' },
  note: { icon: FileText, color: 'text-slate-500 bg-slate-100 dark:bg-slate-800' },
  deal: { icon: DollarSign, color: 'text-green-500 bg-green-100 dark:bg-green-950/40' },
  alert: { icon: AlertCircle, color: 'text-red-500 bg-red-100 dark:bg-red-950/40' },
}

const ACTIVITY_STYLE_BY_INDEX = {
  0: { type: 'call', icon: PhoneCall, color: 'text-blue-500 bg-blue-100 dark:bg-blue-950/40' },
  1: { type: 'email', icon: Mail, color: 'text-brand-500 bg-brand-100 dark:bg-brand-950/40' },
  2: { type: 'meeting', icon: UserCheck, color: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-950/40' },
  3: { type: 'outcome', icon: TrendingUp, color: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-950/40' },
}

const CALL_OUTCOME_BADGE = {
  connected: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'non connected': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'no answer': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  busy: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  'callback requested': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  'wrong number': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'not interested': 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

const getCallOutcomeBadgeClass = (outcome) => {
  const key = String(outcome || '').trim().toLowerCase()
  return CALL_OUTCOME_BADGE[key] || 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
}

const normalizeCallOutcome = (value) => String(value || '').trim().toLowerCase()

const buildLeadActivityPatch = (lead, savedRow) => {
  const touchedAt = savedRow?.savedAt || savedRow?.createdAt || new Date().toISOString()
  const idx = Number(savedRow?.activityIndex)
  const values = savedRow?.values || {}
  const statusText = normalizeCallOutcome(
    values.status || values.connectionStatus || values.callOutcome || values.outcome || values.remarkStatus
  )
  const interestText = normalizeCallOutcome(values.interestStatus || values.interest)
  const isConnected = statusText === 'connected'
  let status = lead?.status === 'new' ? 'contacted' : lead?.status

  if (idx === 0 && isConnected && interestText.includes('not interested')) status = 'lost'
  else if (idx === 1 && (statusText.includes('meeting') || statusText.includes('allowed person'))) status = 'qualified'
  else if (idx === 2 && (statusText.includes('won') || statusText.includes('win'))) status = 'won'
  else if (idx === 2 && statusText.includes('lost')) status = 'lost'
  else if (idx === 2 && statusText.includes('negoti')) status = 'negotiation'

  return {
    status,
    lastActivityAtTs: touchedAt,
    lastContactedAtTs: touchedAt,
  }
}

function LeadHistoryPanel({ lead, onClose, onLogActivity, historyEvents = [] }) {
  const [callIntel, setCallIntel] = useState(null)
  const [intelLoading, setIntelLoading] = useState(false)
  const [intelError, setIntelError] = useState('')
  const events = historyEvents
  const calls = events.filter(e => String(e.type || '').toLowerCase().includes('call')).length
  const emails = events.filter(e => String(e.type || '').toLowerCase().includes('email')).length

  useEffect(() => {
    let alive = true
    if (!lead?.id) {
      setCallIntel(null)
      setIntelError('')
      setIntelLoading(false)
      return undefined
    }

    setIntelLoading(true)
    setIntelError('')

    callsAPI.getIntelligence(lead.id)
      .then((response) => {
        if (!alive) return
        setCallIntel(response || null)
      })
      .catch((err) => {
        if (!alive) return
        setCallIntel(null)
        setIntelError(err?.message || 'Failed to load call intelligence')
      })
      .finally(() => {
        if (alive) setIntelLoading(false)
      })

    return () => {
      alive = false
    }
  }, [lead?.id])

  const analysis = callIntel?.analysis || {}
  const verdict = String(analysis.leadVerdict || '').toUpperCase()
  const verdictMeta = {
    GENUINE: { label: 'Genuine lead', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
    NOT_GENUINE: { label: 'Not genuine', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
    UNCERTAIN: { label: 'Uncertain', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  }[verdict] || { label: 'Pending', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' }
  const currentStatus = String(callIntel?.lead?.status || lead?.status || '').toUpperCase()
  const suggestedStatus = String(analysis.suggestedLeadStatus || '').toUpperCase()
  const confidence = Number(analysis.confidence || 0)
  const remoteCalls = Array.isArray(callIntel?.calls) ? callIntel.calls : []
  const totalCalls = remoteCalls.length || calls

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Lead history and call intelligence">
      {/* Backdrop */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Centered panel */}
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-950/40 flex items-center justify-center flex-shrink-0">
              <History className="w-4 h-4 text-brand-600" />
            </div>
            <div>
              <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{lead.name}</p>
              <p className="text-xs text-slate-400">{lead.company} · Call Intelligence & Activity History</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-scroll custom-scrollbar pr-2"
          style={{ scrollbarGutter: 'stable' }}
        >
          {/* AI intelligence */}
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-950/40 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-brand-600 dark:text-brand-300" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Call Intelligence</p>
                  <p className="text-[11px] text-slate-500">Bolna transcript + conversation history analysis</p>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${verdictMeta.cls}`}>
                {intelLoading ? 'Analyzing…' : verdictMeta.label}
              </span>
            </div>

            {intelError && (
              <div className="mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs">
                {intelError}
              </div>
            )}

            {!intelError && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Current Status</p>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1">{currentStatus || '—'}</p>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">AI Suggested</p>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1">{suggestedStatus || '—'}</p>
                  </div>
                </div>

                <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Confidence</p>
                    <span className="text-xs font-bold text-brand-600 dark:text-brand-300">{confidence}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500" style={{ width: `${Math.min(100, confidence)}%` }} />
                  </div>
                </div>

                {analysis.summary && (
                  <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">AI Summary</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{analysis.summary}</p>
                  </div>
                )}

                {analysis.nextBestAction && (
                  <div className="rounded-xl bg-brand-50 dark:bg-brand-950/20 border border-brand-200 dark:border-brand-800 p-3">
                    <p className="text-[10px] font-semibold text-brand-700 dark:text-brand-300 uppercase tracking-wide mb-1">Next Best Action</p>
                    <p className="text-xs text-brand-800 dark:text-brand-200 leading-relaxed">{analysis.nextBestAction}</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 p-3">
                    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-2">Positive Signals</p>
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      {(analysis.positiveSignals || []).slice(0, 4).map((signal, index) => (
                        <li key={index} className="flex gap-2">
                          <BadgeCheck className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                          <span>{signal}</span>
                        </li>
                      ))}
                      {(!analysis.positiveSignals || analysis.positiveSignals.length === 0) && (
                        <li className="text-slate-400">No positive signals extracted yet.</li>
                      )}
                    </ul>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 p-3">
                    <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide mb-2">Risk Signals</p>
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      {(analysis.riskSignals || []).slice(0, 4).map((signal, index) => (
                        <li key={index} className="flex gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                          <span>{signal}</span>
                        </li>
                      ))}
                      {(!analysis.riskSignals || analysis.riskSignals.length === 0) && (
                        <li className="text-slate-400">No risk signals extracted yet.</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-px bg-slate-200 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-700">
            {[
              { label: 'Activities', value: events.length },
              { label: 'Calls',      value: totalCalls },
              { label: 'Emails',     value: emails },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white dark:bg-slate-900 px-4 py-3 text-center">
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
                <p className="text-xs text-slate-400">{label}</p>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div className="px-5 py-4 space-y-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Timeline</p>
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700" />

            <div className="space-y-4">
              {events.length === 0 && (
                <p className="text-xs text-slate-400">No saved activities yet.</p>
              )}
              {events.map((event, i) => {
                const keyType = String(event.type || '').toLowerCase()
                const style = HISTORY_STYLE[keyType] || HISTORY_STYLE.note
                const Icon = event.icon || style.icon
                return (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex gap-4 relative">
                    {/* Icon dot */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10 ${event.color || style.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    {/* Content */}
                    <div className="flex-1 pb-1">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{event.label}</p>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{event.time}</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{event.note}</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>

            {remoteCalls.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Call Records</p>
              {remoteCalls.map((call, index) => (
                <details key={call.id || index} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                  <summary className="cursor-pointer list-none px-4 py-3 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        Call #{index + 1} · {call.status || 'Unknown'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {call.createdAt ? new Date(call.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No timestamp'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {call.outcome && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          {call.outcome}
                        </span>
                      )}
                      {call.recordingUrl && (
                        <span className="text-[10px] text-brand-600 dark:text-brand-300">Recording attached</span>
                      )}
                    </div>
                  </summary>
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-200 dark:border-slate-700">
                    {call.summary && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Summary</p>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{call.summary}</p>
                      </div>
                    )}
                    {call.transcript && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Transcript</p>
                        <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-scroll p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 custom-scrollbar">
                          {call.transcript}
                        </pre>
                      </div>
                    )}
                    {call.recordingUrl && (
                      <a href={call.recordingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
                        Open recording <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {call.rawPayload && (
                      <details className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3">
                        <summary className="cursor-pointer text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                          Raw call payload
                        </summary>
                        <pre className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap overflow-y-scroll max-h-48 custom-scrollbar">
                          {call.rawPayload}
                        </pre>
                      </details>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={() => {
              onClose()
              onLogActivity?.(lead)
            }}
            className="btn-primary w-full justify-center gap-2 text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> Log Activity
          </button>
        </div>
      </motion.div>
    </div>
  )
}

const WA_TEMPLATES = [
  { label: '👋 Welcome', text: KRISCEL_WHATSAPP_WELCOME_MESSAGE },
  { label: '📞 Follow Up', text: KRISCEL_WHATSAPP_FOLLOW_UP_MESSAGE },
  { label: '💼 Proposal', text: KRISCEL_WHATSAPP_PROPOSAL_MESSAGE },
  { label: '🎉 Thank You', text: KRISCEL_WHATSAPP_THANK_YOU_MESSAGE },
]

function WhatsAppModal({ lead, onClose }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const applyTemplate = (tpl) => {
    setMessage(tpl.text.replace('{name}', lead.name?.split(' ')[0] || 'there'))
  }

  const handleSend = async () => {
    if (!message.trim()) { toast.error('Please enter a message'); return }
    const phone = lead.phone || ''
    if (!phone) { toast.error('No phone number for this lead'); return }
    setSending(true)
    try {
      await sendWhatsApp(phone, message)
      setSent(true)
      toast.success(`WhatsApp sent to ${lead.name}!`)
      setTimeout(onClose, 1500)
    } catch (err) {
      toast.error(err.message || 'Failed to send WhatsApp message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Send WhatsApp message">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-green-500 to-emerald-600">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold text-sm">{lead.name}</p>
            <p className="text-green-100 text-xs">{lead.phone || 'No phone on file'}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Quick Templates */}
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Quick Templates</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {WA_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  onClick={() => applyTemplate(tpl)}
                  className="text-left px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all text-xs text-slate-700 dark:text-slate-300 font-medium"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Message</p>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your WhatsApp message here..."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
            />
            <p className="text-right text-[10px] text-slate-400 mt-1">{message.length} chars</p>
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={sending || sent || !lead.phone}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${
              sent
                ? 'bg-green-500 text-white cursor-default'
                : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {sending ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Sending…
              </>
            ) : sent ? (
              <>✓ Sent!</>
            ) : (
              <>
                <MessageCircle className="w-4 h-4" />
                Send WhatsApp
              </>
            )}
          </button>

          {!lead.phone && (
            <p className="text-center text-xs text-amber-500 dark:text-amber-400">
              ⚠️ This lead has no phone number saved. Add a phone number first.
            </p>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function CallOutcomeModal({ lead, user, onClose, onSave }) {
  const [outcome, setOutcome] = useState('Connected')
  const [note, setNote] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [saving, setSaving] = useState(false)

  const assignee = user?.name || user?.email || 'Sales Team'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!outcome) {
      toast.error('Please choose call outcome.')
      return
    }
    setSaving(true)
    try {
      await onSave({
        lead,
        outcome,
        note: note.trim(),
        callbackAt: callbackAt || null,
        assignedTo: assignee,
      })
      toast.success('Call outcome saved')
      onClose()
    } catch (err) {
      toast.error(err?.message || 'Failed to save call outcome')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Call outcome">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative glass-card w-full max-w-lg p-6 z-10"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Call Outcome</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {lead?.name} · {lead?.phone || 'No number'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Outcome *</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="input"
            >
              <option value="Connected">Connected</option>
              <option value="No Answer">No Answer</option>
              <option value="Busy">Busy</option>
              <option value="Callback Requested">Callback Requested</option>
              <option value="Wrong Number">Wrong Number</option>
              <option value="Not Interested">Not Interested</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Callback Time (optional)</label>
            <input
              type="datetime-local"
              value={callbackAt}
              onChange={(e) => setCallbackAt(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Notes</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened on this call?"
              className="input resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 block mb-1">Assigned To</label>
            <input value={assignee} readOnly className="input bg-slate-50 dark:bg-slate-800/60" />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Skip</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 gap-2 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Outcome'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

export default function LeadsPage() {
  const PAGE_SIZE = 10
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const {
    leads,
    pagination,
    fetchLeads,
    createLead,
    updateLead,
    deleteLead,
    bulkDelete,
    patchLeadLocal,
  } = useLeadsStore()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [scoreFilter, setScoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [lastCallFilter, setLastCallFilter] = useState('all')
  const [dateRange, setDateRange] = useState(emptyDateRange)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [sortField, setSortField] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selected, setSelected]         = useState([])
  const [historyLead, setHistoryLead]       = useState(null)
  const [editLead, setEditLead]             = useState(null)
  const [detailLead, setDetailLead]         = useState(null)
  const [activitiesLead, setActivitiesLead] = useState(null)
  const [waLead, setWaLead]                 = useState(null)
  const [callOutcomeLead, setCallOutcomeLead] = useState(null)
  const [teamMembers, setTeamMembers]       = useState([])
  const [leadActivitiesByLeadId, setLeadActivitiesByLeadId] = useState({})
  const [callOutcomeByLeadId, setCallOutcomeByLeadId] = useState({})
  const [activityTabByLeadId, setActivityTabByLeadId] = useState({})
  const [callingLeadId, setCallingLeadId] = useState(null)
  const [callingLeadModal, setCallingLeadModal] = useState(null)
  const [leadStages, setLeadStages] = useState({})
  const [timeTick, setTimeTick]             = useState(Date.now())
  const importRef                           = useRef(null)
  const selectAllRef                        = useRef(null)
  const activityRequestsRef                 = useRef(new Map())
  const canCreate = hasPermission(user, PERMISSIONS.LEADS_CREATE)
  const canUpdate = hasPermission(user, PERMISSIONS.LEADS_UPDATE)
  const canDelete = hasPermission(user, PERMISSIONS.LEADS_DELETE)
  const canImport = hasPermission(user, PERMISSIONS.LEADS_IMPORT)
  const canExport = hasPermission(user, PERMISSIONS.LEADS_EXPORT)
  const canViewTeam = hasPermission(user, PERMISSIONS.TEAM_VIEW)
  const canCall = hasPermission(user, PERMISSIONS.COMMUNICATIONS_SEND)
  const routeSearch = searchParams.get('search') ?? ''

  useEffect(() => {
    const id = window.setInterval(() => setTimeTick(Date.now()), 60 * 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    setSearch(routeSearch)
  }, [routeSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [debouncedSearch, scoreFilter, statusFilter, lastCallFilter, dateRange])

  useEffect(() => {
    fetchLeads({
      search: debouncedSearch || undefined,
      score: scoreFilter === 'all' ? undefined : scoreFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      page: 0,
      size: hasDateRangeFilter(dateRange) ? 500 : PAGE_SIZE,
    }).catch((err) => {
      toast.error(err?.message || 'Failed to load leads')
    })
  }, [fetchLeads, debouncedSearch, scoreFilter, statusFilter, dateRange])

  useEffect(() => {
    setSelected([])
  }, [debouncedSearch, scoreFilter, statusFilter, lastCallFilter, dateRange])

  useEffect(() => {
    const stagesFromLeadRows = {}
    const missingIds = []

    leads.forEach((lead) => {
      if (!lead?.id) return
      if (lead.activityStageIndex != null) {
        stagesFromLeadRows[lead.id] = lead.activityStageIndex
      } else {
        missingIds.push(lead.id)
      }
    })

    if (Object.keys(stagesFromLeadRows).length) {
      setLeadStages((prev) => ({ ...prev, ...stagesFromLeadRows }))
    }
    if (!missingIds.length) return

    leadsAPI.getActivityStages(missingIds).then((data) => {
      if (data && typeof data === 'object') setLeadStages((prev) => ({ ...prev, ...data }))
    }).catch(() => {})
  }, [leads])

  const reloadCurrentPage = async () => {
    return fetchLeads({
      search: debouncedSearch || undefined,
      score: scoreFilter === 'all' ? undefined : scoreFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      page: 0,
      size: Math.max(visibleCount, hasDateRangeFilter(dateRange) ? 500 : PAGE_SIZE),
    })
  }

  useEffect(() => {
    if (!canViewTeam) {
      setTeamMembers([])
      return
    }
    teamAPI.getAll()
      .then((rows) => {
        const members = (rows || [])
          .filter((row) => row && row.id && row.name && row.isActive !== false)
          .map((row) => ({ id: row.id, name: row.name }))
        setTeamMembers(members)
      })
      .catch(() => {
        setTeamMembers([])
      })
  }, [canViewTeam])


  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const filtered = leads
    .filter((lead) => isWithinDateRange(lead.createdAtTs || lead.createdAt || lead.updatedAt, dateRange))
    .filter((lead) => {
      if (lastCallFilter === 'all') return true
      const outcome = normalizeCallOutcome(callOutcomeByLeadId[lead.id])
      if (lastCallFilter === 'not_logged') return !outcome
      return outcome === lastCallFilter
    })
    .sort((a, b) => {
      let va
      let vb
      if (sortField === 'activity' || sortField === 'aging') {
        va = getLeadAgeMinutes(a, timeTick) ?? -1
        vb = getLeadAgeMinutes(b, timeTick) ?? -1
      } else {
        va = a[sortField]
        vb = b[sortField]
      }
      if (typeof va === 'string') va = va.toLowerCase(), vb = vb.toLowerCase()
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const totalCount = Number(pagination?.total ?? leads.length)
  const visible = filtered.slice(0, visibleCount)
  const visibleIds = visible.map((lead) => lead.id).filter(Boolean)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const someVisibleSelected = visibleIds.some((id) => selected.includes(id))
  const hasMore = visibleCount < filtered.length || leads.length < totalCount

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected
    }
  }, [allVisibleSelected, someVisibleSelected])

  const loadMoreLeads = async () => {
    const nextCount = visibleCount + PAGE_SIZE
    try {
      await fetchLeads({
        search: debouncedSearch || undefined,
        score: scoreFilter === 'all' ? undefined : scoreFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        page: 0,
        size: Math.max(nextCount, hasDateRangeFilter(dateRange) ? 500 : PAGE_SIZE),
      })
      setVisibleCount(nextCount)
    } catch (err) {
      toast.error(err?.message || 'Failed to load more leads')
    }
  }

  const SortIcon = ({ field }) =>
    sortField === field ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null

  const toggleSelect = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  const toggleAll = () => setSelected((current) => {
    if (!visibleIds.length) return []

    const visibleIdSet = new Set(visibleIds)
    const nextShouldSelect = !visibleIds.every((id) => current.includes(id))
    if (!nextShouldSelect) {
      return current.filter((id) => !visibleIdSet.has(id))
    }

    return Array.from(new Set([...current, ...visibleIds]))
  })

  const handleAdd = async (lead) => {
    if (!canCreate) {
      toast.error('You do not have permission to add leads.')
      return
    }
    try {
      await createLead(lead)
      toast.success('Lead added successfully!')
    } catch (err) {
      toast.error(err?.message || 'Failed to add lead')
    }
  }

  const handleSave = async (updated) => {
    if (!canUpdate) {
      toast.error('You do not have permission to edit leads.')
      return
    }
    try {
      await updateLead(updated.id, updated)
      toast.success('Lead updated successfully!')
    } catch (err) {
      toast.error(err?.message || 'Failed to update lead')
    }
  }

  const handleDelete = async (ids) => {
    if (!canDelete) {
      toast.error('You do not have permission to delete leads.')
      return
    }
    try {
      if (ids.length === 1) {
        await deleteLead(ids[0])
      } else {
        await bulkDelete(ids)
      }
      setSelected([])
      toast.success(`${ids.length} lead(s) deleted`)
    } catch (err) {
      toast.error(err?.message || 'Failed to delete lead(s)')
    }
  }

  const handleExport = async (format = 'csv') => {
    if (!canExport) {
      toast.error('You do not have permission to export leads.')
      return
    }
    try {
      const filename = `leads-${new Date().toISOString().slice(0, 10)}`
      if (format === 'xlsx') {
        const params = { format: 'xlsx' }
        if (statusFilter !== 'all') params.status = statusFilter.toUpperCase()
        const blob = await leadsAPI.export(params)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${filename}.xlsx`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 500)
        toast.success('Leads exported successfully.')
        return
      }

      const headers = ['Name','Email','Phone','Company','Service','Specialization','Source','Score','Status','Value','Assigned To','Created At','Updated At','Notes','Tags']
      const rows = filtered.map((l) => [
        l.name || '', l.email || '', l.phone || '', l.company || '',
        l.service || '', l.specialization || '', l.source || '',
        l.score || '', l.status || '',
        l.dealValue ?? 0, l.assignedToName || l.assignedTo?.name || l.assignedTo || '',
        l.createdAt ? new Date(l.createdAt).toLocaleString() : '',
        l.updatedAt ? new Date(l.updatedAt).toLocaleString() : '',
        l.notes || '', l.tags || '',
      ])

      if (format === 'pdf') {
        const doc = new jsPDF({ orientation: 'landscape' })
        doc.setFontSize(14)
        doc.text(`Leads Export — ${new Date().toLocaleDateString()}`, 14, 15)
        autoTable(doc, {
          head: [['Name','Email','Phone','Company','Score','Status','Value','Source']],
          body: rows.map((r) => [r[0],r[1],r[2],r[3],r[7],r[8],r[9],r[6]]),
          startY: 22,
          styles: { fontSize: 7 },
        })
        doc.save(`${filename}.pdf`)
      } else {
        const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${filename}.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 500)
      }
      toast.success('Leads exported successfully.')
    } catch (err) {
      toast.error(err?.message || 'Failed to export leads')
    }
  }

  const handleImport = async (e) => {
    if (!canImport) {
      toast.error('You do not have permission to import leads.')
      e.target.value = ''
      return
    }
    const file = e.target.files?.[0]; if (!file) return
    try {
      await leadsAPI.import(file)
      await reloadCurrentPage()
      toast.success('Leads imported.')
    } catch (err) {
      toast.error(err?.message || 'Failed to import leads')
    }
    e.target.value = ''
  }

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

  const handleSaveCallOutcome = async ({ lead, outcome, note, callbackAt, assignedTo }) => {
    if (!canUpdate) {
      throw new Error('You do not have permission to save lead activities.')
    }
    const summary = [
      `Call outcome: ${outcome}`,
      note ? `Note: ${note}` : null,
      callbackAt ? `Callback: ${callbackAt}` : null,
    ].filter(Boolean).join(' | ')

    const payload = {
      activityIndex: 0,
      activityId: 'act01',
      activityLabel: 'Activity 01',
      activityTitle: 'Call Outcome',
      assignedTo,
      values: {
        assignedTo,
        callOutcome: outcome,
        note: note || '',
        callbackAt: callbackAt || '',
        channel: 'voice_call_agent',
        phone: lead?.phone || '',
      },
      summary,
    }

    const savedRow = await leadsAPI.addActivity(lead.id, payload)
    const event = mapLeadActivityToHistoryEvent(savedRow)
    setLeadActivitiesByLeadId((prev) => {
      const existing = prev[lead.id] || []
      return { ...prev, [lead.id]: [event, ...existing] }
    })

    patchLeadLocal(lead.id, buildLeadActivityPatch(lead, savedRow))
  }

  const formatActivityTime = (value) => {
    if (!value) return 'Just now'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  }

  const mapLeadActivityToHistoryEvent = (row) => {
    const idx = Number(row?.activityIndex ?? -1)
    const style = ACTIVITY_STYLE_BY_INDEX[idx] || HISTORY_STYLE.activity
    return {
      id: row?.id || `${idx}-${row?.savedAt || row?.createdAt || Date.now()}`,
      type: style.type || 'activity',
      icon: style.icon || HISTORY_STYLE.activity.icon,
      color: style.color || HISTORY_STYLE.activity.color,
      label: row?.activityLabel || row?.activityTitle || `Activity ${idx + 1}`,
      note: row?.summary || row?.activityTitle || 'Saved activity',
      time: formatActivityTime(row?.savedAt || row?.createdAt),
      raw: row,
    }
  }

  const extractCallOutcome = (row) => {
    const values = row?.values || {}
    const raw = values?.callOutcome || values?.connectionStatus || values?.status || ''
    const outcome = String(raw || '').trim()
    if (!outcome) return null
    const idx = Number(row?.activityIndex ?? -1)
    if (idx !== 0) return null
    return outcome
  }

  const loadLeadActivities = async (leadId, { force = false } = {}) => {
    if (!leadId) return []
    if (!force && leadActivitiesByLeadId[leadId]) return leadActivitiesByLeadId[leadId]

    const existingRequest = activityRequestsRef.current.get(leadId)
    if (existingRequest) return existingRequest

    const request = leadsAPI.getActivities(leadId)
      .then((rows) => {
      const events = (rows || []).map(mapLeadActivityToHistoryEvent)
      setLeadActivitiesByLeadId((prev) => ({ ...prev, [leadId]: events }))
      const latestCallRow = (rows || []).find((row) => extractCallOutcome(row))
      if (latestCallRow) {
        setCallOutcomeByLeadId((prev) => ({ ...prev, [leadId]: extractCallOutcome(latestCallRow) }))
      }
      return events
      })
      .catch((err) => {
        toast.error(err?.message || 'Failed to load lead activities')
        return []
      })
      .finally(() => {
        activityRequestsRef.current.delete(leadId)
      })

    activityRequestsRef.current.set(leadId, request)
    return request
  }

  const openHistoryLead = (lead) => {
    setHistoryLead(lead)
    loadLeadActivities(lead?.id)
  }

  const openActivitiesLead = async (lead) => {
    await loadLeadActivities(lead?.id)
    setActivitiesLead(lead)
  }

  const handleActivityTabChange = (leadId, tabIndex) => {
    if (!leadId && leadId !== 0) return
    setActivityTabByLeadId((prev) => {
      if (prev[leadId] === tabIndex) return prev
      return { ...prev, [leadId]: tabIndex }
    })
  }

  const getActivityModalState = (leadId) => {
    const events = leadActivitiesByLeadId[leadId] || []
    const data = [{}, {}, {}, {}]
    const saved = [false, false, false, false]
    const seen = new Set()

    for (const ev of events) {
      const row = ev?.raw || {}
      const idx = Number(row?.activityIndex)
      if (!(idx >= 0 && idx < 4) || seen.has(idx)) continue
      seen.add(idx)
      data[idx] = {
        ...(row?.values || {}),
        assignedTo: row?.assignedTo || row?.values?.assignedTo || '',
      }
      saved[idx] = true
    }

    return { data, saved }
  }

  const handlePersistActivity = async ({ lead, activityIndex, activity, values }) => {
    if (!canUpdate) {
      throw new Error('You do not have permission to edit leads.')
    }
    const normalizedOutcome = normalizeCallOutcome(values?.callOutcome || values?.connectionStatus || values?.status)
    const summary = activityIndex === 0
      ? [
          normalizedOutcome ? `Status: ${normalizedOutcome}` : null,
          lead?.source ? `Source: ${lead.source}` : null,
          lead?.service ? `Service: ${lead.service}` : lead?.specialization ? `Service: ${lead.specialization}` : null,
          lead?.createdAt ? `Planned: ${lead.createdAt}` : null,
          `Actual: ${new Date().toISOString()}`,
          values?.nextFollowUpDate || values?.followUpDate ? `Next follow-up: ${values.nextFollowUpDate || values.followUpDate}` : null,
          values?.remark || values?.remarks || values?.note ? `Remarks: ${values.remark || values.remarks || values.note}` : null,
        ].filter(Boolean).join(' | ') || 'Lead activity recorded'
      : Object.entries(values || {})
          .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
          .map(([key, value]) => `${key}: ${value}`)
          .join(' | ') || 'No extra details'
    const payload = {
      activityIndex,
      activityId: activity?.id || null,
      activityLabel: activity?.label || `Activity ${Number(activityIndex) + 1}`,
      activityTitle: activity?.title || '',
      assignedTo: values?.assignedTo || lead?.assignedToName || lead?.assignedTo?.name || lead?.assignedTo || null,
      values: values || {},
      summary,
    }
    const savedRow = await leadsAPI.addActivity(lead.id, payload)
    const event = mapLeadActivityToHistoryEvent(savedRow)
    setLeadActivitiesByLeadId((prev) => {
      const existing = prev[lead.id] || []
      return { ...prev, [lead.id]: [event, ...existing] }
    })
    const persistedOutcome = normalizeCallOutcome(values?.callOutcome || values?.connectionStatus || values?.status)
    if (persistedOutcome) {
      setCallOutcomeByLeadId((prev) => ({ ...prev, [lead.id]: persistedOutcome }))
    }

    const touchedAt = savedRow?.savedAt || savedRow?.createdAt || new Date().toISOString()
    patchLeadLocal(lead.id, {
      ...buildLeadActivityPatch(lead, savedRow),
      lastActivityAtTs: touchedAt,
      lastContactedAtTs: touchedAt,
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Leads</h1>
          <p className="text-sm text-slate-500 mt-0.5">{totalCount} leads total · {visible.filter((l) => l.score === 'hot').length} hot</p>
        </div>
        <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2">
          {selected.length > 0 && canDelete && (
            <button onClick={() => handleDelete(selected)} className="btn-danger text-xs gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> Delete ({selected.length})
            </button>
          )}
          {canImport && (
            <>
              <input ref={importRef} type="file" accept=".csv,.xlsx" onChange={handleImport} className="hidden" />
              <button onClick={() => importRef.current?.click()} className="btn-secondary text-xs gap-1.5">
                <Upload className="w-3.5 h-3.5" /> Import
              </button>
            </>
          )}
          {canExport && (
            <>
              <button onClick={() => handleExport('pdf')} className="btn-secondary text-xs gap-1.5">
                <FileText className="w-3.5 h-3.5" /> PDF
              </button>
              <button onClick={() => handleExport('xlsx')} className="btn-secondary text-xs gap-1.5">
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
            </>
          )}
          {canCreate && (
            <button onClick={() => setShowAddModal(true)} className="btn-primary text-xs gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Lead
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/60 rounded-xl px-3 py-2 w-full sm:flex-1 sm:min-w-[12rem]">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, company, or email..."
            className="bg-transparent text-sm text-slate-700 dark:text-slate-300 outline-none flex-1"
          />
        </div>
        <select
          value={scoreFilter} onChange={(e) => setScoreFilter(e.target.value)}
          className="input w-full sm:w-auto text-xs"
        >
          <option value="all">All Scores</option>
          <option value="hot">🔥 Hot</option>
          <option value="warm">🌡️ Warm</option>
          <option value="cold">❄️ Cold</option>
        </select>
        <select
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="input w-full sm:w-auto text-xs"
        >
          <option value="all">All Status</option>
          {['new','contacted','qualified','proposal','negotiation','won','lost'].map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select
          value={lastCallFilter}
          onChange={(e) => setLastCallFilter(e.target.value)}
          className="input w-full sm:w-auto text-xs"
        >
          <option value="all">Last Call: Any</option>
          <option value="connected">Last Call: Connected</option>
          <option value="non connected">Last Call: Non Connected</option>
          <option value="no answer">Last Call: No Answer</option>
          <option value="busy">Last Call: Busy</option>
          <option value="callback requested">Last Call: Callback Requested</option>
          <option value="wrong number">Last Call: Wrong Number</option>
          <option value="not interested">Last Call: Not Interested</option>
          <option value="not_logged">Last Call: Not Logged</option>
        </select>
        <DateRangeFilter value={dateRange} onChange={setDateRange} compact className="w-full sm:w-auto" />
      </div>

      {/* Mobile cards – minimal: tap to open detail */}
      <div className="sm:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="glass-card py-12 text-center text-slate-400">
            <p className="text-lg">No leads found</p>
            <p className="text-sm mt-1">Try adjusting your filters or add a new lead</p>
          </div>
        ) : (
          visible.map((lead) => {
            const scoreCfg = SCORE_BADGE[lead.score]
            const statusCfg = STATUS_BADGE[lead.status] ?? { label: lead.status, cls: 'badge' }
            const ScoreIcon = scoreCfg?.icon
            return (
              <div
                key={lead.id}
                onClick={() => setDetailLead(lead)}
                className="glass-card px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/25 transition-colors active:scale-[0.99]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(lead.id)}
                  onChange={(e) => { e.stopPropagation(); toggleSelect(lead.id) }}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded border-slate-300 text-brand-600 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{lead.name}</p>
                  <p className="text-xs text-slate-500 truncate">{lead.company || lead.email}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`${scoreCfg?.cls} !px-1.5 !py-0.5 text-[10px]`}>
                    {ScoreIcon && <ScoreIcon className="w-2.5 h-2.5" />}
                  </span>
                  <span className={`${statusCfg.cls} !px-1.5 !py-0.5 text-[10px]`}>{statusCfg.label}</span>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-300 flex-shrink-0 -rotate-90" />
              </div>
            )
          })
        )}
      </div>

      {hasMore && (
        <div className="sm:hidden flex justify-center glass-card px-3 py-2">
          <button
            onClick={loadMoreLeads}
            className="px-4 h-8 rounded-lg text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30 transition-colors"
          >
            Load More
          </button>
        </div>
      )}

      {/* Table – minimal: Name, Score, Status, Source, Date, Action */}
      <div className="hidden sm:block glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200/70 dark:border-slate-700/40 bg-white/50 dark:bg-slate-900/20">
                <th className="py-3 px-4 text-left w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={!visibleIds.length}
                    onChange={toggleAll}
                    aria-label="Select all visible leads"
                    className="rounded border-slate-300 text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </th>
                <th className="py-2.5 px-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 w-10">Stage</th>
                {[
                  { key: 'name',      label: 'Name' },
                  { key: 'score',     label: 'Score' },
                  { key: 'status',    label: 'Status' },
                  { key: 'source',    label: 'Source' },
                  { key: 'createdAt', label: 'Created' },
                ].map(({ key, label }) => (
                  <th key={key} className="py-2.5 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer hover:text-slate-800 dark:hover:text-slate-200"
                    onClick={() => handleSort(key)}>
                    <span className="flex items-center gap-1">{label} <SortIcon field={key} /></span>
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right text-xs font-semibold text-slate-600 dark:text-slate-400 w-[70px]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80 dark:divide-slate-800/30">
              <AnimatePresence>
                {visible.map((lead) => {
                  const scoreCfg = SCORE_BADGE[lead.score]
                  const statusCfg = STATUS_BADGE[lead.status] ?? { label: lead.status, cls: 'badge' }
                  const ScoreIcon = scoreCfg?.icon
                  const created = formatLeadCreatedDateTime(lead)
                  return (
                    <motion.tr
                      key={lead.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setHistoryLead(lead)}
                      className={`cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/25 transition-colors
                        ${selected.includes(lead.id) ? 'bg-brand-50/40 dark:bg-brand-950/10' : ''}`}
                    >
                      <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleSelect(lead.id)}
                          className="rounded border-slate-300 text-brand-600" />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {(() => {
                          const stageIdx = leadStages[lead.id] != null ? Math.min(Math.max(leadStages[lead.id], 0), 2) : -1
                          const sDef = stageIdx >= 0 ? STAGE_ICON_DEFS[stageIdx] : null
                          if (!sDef) return <span className="text-slate-300 dark:text-slate-600">—</span>
                          const SIcon = sDef.icon
                          return (
                            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${sDef.bg} text-white ring-1 ${sDef.ring}`} title={sDef.label}>
                              <SIcon className="w-3 h-3" />
                            </span>
                          )
                        })()}
                      </td>
                      <td className="py-2.5 px-3">
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[250px]">{lead.name}</p>
                          {lead.email && (
                            <CopyableContact
                              value={lead.email}
                              label="Email"
                              className="max-w-[250px] text-xs text-slate-500"
                            />
                          )}
                          {lead.phone && (
                            <CopyableContact
                              value={lead.phone}
                              label="Phone"
                              icon={Phone}
                              className="max-w-[250px] text-xs text-slate-400"
                            />
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={scoreCfg?.cls}>
                          {ScoreIcon && <ScoreIcon className="w-3 h-3" />} {scoreCfg?.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={statusCfg.cls}>{statusCfg.label}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-xs">{lead.source || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-500 text-xs whitespace-nowrap">
                        <div className="font-medium text-slate-600 dark:text-slate-300">{created.date}</div>
                        {created.time && <div className="text-[11px] text-slate-400">{created.time}</div>}
                      </td>
                      <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canCall && (
                            <button
                              onClick={() => handleCallLead(lead)}
                              disabled={callingLeadId === lead.id || !lead.phone}
                              className="p-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/20 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={!lead.phone ? 'No phone number' : (callingLeadId === lead.id ? 'Calling…' : 'Call now')}
                            >
                              <PhoneCall className={`w-4 h-4 ${callingLeadId === lead.id ? 'animate-pulse' : ''}`} />
                            </button>
                          )}
                          <button
                            onClick={() => setDetailLead(lead)}
                            className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
                            title="View details"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  )
                })}
              </AnimatePresence>
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-16 text-center text-slate-400">
              <p className="text-lg">No leads found</p>
              <p className="text-sm mt-1">Try adjusting your filters or add a new lead</p>
            </div>
          )}
        </div>

        {/* Load More */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-slate-200/60 dark:border-slate-700/40">
          <p className="text-xs text-slate-500">
            Showing {visible.length} of {totalCount} leads
          </p>
          {hasMore && (
            <button
              onClick={loadMoreLeads}
              className="px-4 h-8 rounded-lg text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30 transition-colors"
            >
              Load More
            </button>
          )}
        </div>
      </div>

      {/* Add Lead Modal */}
      <AnimatePresence>
        {showAddModal && (
          <ScreenModalPortal>
            <AddLeadModal
              onClose={() => setShowAddModal(false)}
              onAdd={handleAdd}
              teamMembers={teamMembers}
            />
          </ScreenModalPortal>
        )}
      </AnimatePresence>

      {/* Edit Lead Modal */}
      <AnimatePresence>
        {editLead && (
          <ScreenModalPortal>
            <EditLeadModal
              lead={editLead}
              onClose={() => setEditLead(null)}
              onSave={handleSave}
              teamMembers={teamMembers}
            />
          </ScreenModalPortal>
        )}
      </AnimatePresence>

      {/* Lead Detail Card */}
      <AnimatePresence>
        {detailLead && (
          <ScreenModalPortal>
            <LeadDetailModal
              lead={detailLead}
              onClose={() => setDetailLead(null)}
              onEdit={(l) => setEditLead(l)}
              onDelete={handleDelete}
              canEdit={canUpdate}
              canDelete={canDelete}
              onCall={handleCallLead}
              onWhatsApp={(l) => { setDetailLead(null); setWaLead(l) }}
              onHistory={(l) => { setDetailLead(null); openHistoryLead(l) }}
              canCall={canCall}
              callingLeadId={callingLeadId}
              lastCallOutcome={callOutcomeByLeadId[detailLead.id]}
              aging={getLeadAgingMeta(detailLead, timeTick)}
              ageMin={getLeadAgeMinutes(detailLead, timeTick)}
            />
          </ScreenModalPortal>
        )}
      </AnimatePresence>

      {/* Lead History Drawer */}
      <AnimatePresence>
        {historyLead && (
          <ScreenModalPortal>
            <LeadHistoryPanel
              lead={historyLead}
              onClose={() => setHistoryLead(null)}
              onLogActivity={openActivitiesLead}
              historyEvents={leadActivitiesByLeadId[historyLead.id] || []}
            />
          </ScreenModalPortal>
        )}
      </AnimatePresence>

      {/* Lead Activities Modal */}
      <AnimatePresence>
        {activitiesLead && (
          <LeadActivitiesModal
            lead={activitiesLead}
            onClose={() => setActivitiesLead(null)}
            onPersist={handlePersistActivity}
            initialData={getActivityModalState(activitiesLead.id).data}
            initialSaved={getActivityModalState(activitiesLead.id).saved}
            initialActiveTab={activityTabByLeadId[activitiesLead.id] ?? (() => { const s = getActivityModalState(activitiesLead.id).saved; let m = 0; s.forEach((v, i) => { if (v) m = i }); return m })()}
            onActiveTabChange={handleActivityTabChange}
          />
        )}
      </AnimatePresence>

      {/* WhatsApp Modal */}
      <AnimatePresence>
        {waLead && (
          <ScreenModalPortal>
            <WhatsAppModal lead={waLead} onClose={() => setWaLead(null)} />
          </ScreenModalPortal>
        )}
      </AnimatePresence>

      {/* Choose Call Setup & Phone Number Modal */}
      <AnimatePresence>
        {callingLeadModal && (
          <ScreenModalPortal>
            <CallLeadModal
              lead={callingLeadModal}
              onClose={() => setCallingLeadModal(null)}
              onCallSuccess={(res) => {
                const targetLead = callingLeadModal
                const nowIso = new Date().toISOString()
                patchLeadLocal(targetLead.id, {
                  lastContactedAtTs: nowIso,
                  lastActivityAtTs: nowIso,
                })
                setCallingLeadModal(null)
                setCallOutcomeLead(targetLead)
              }}
            />
          </ScreenModalPortal>
        )}
      </AnimatePresence>

      {/* Call Outcome Modal */}
      <AnimatePresence>
        {callOutcomeLead && (
          <ScreenModalPortal>
            <CallOutcomeModal
              lead={callOutcomeLead}
              user={user}
              onSave={handleSaveCallOutcome}
              onClose={() => setCallOutcomeLead(null)}
            />
          </ScreenModalPortal>
        )}
      </AnimatePresence>
    </div>
  )
}
