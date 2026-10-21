import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import {
  UserCircle, Phone, Mail, Plus, X, Building2,
  TrendingUp, Calendar, Search, Star,
  ChevronLeft, ChevronRight, Globe, Users, IndianRupee,
  Briefcase, Tag, FileText, Facebook, ChevronDown, ChevronUp,
  MessageSquare, GitMerge, RotateCcw, Sheet, Megaphone,
  ClipboardList, StickyNote, Code2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { leadsAPI, customersAPI } from '../../services/api'
import PageHeading from '../ui/PageHeading'
import LoadingState from '../ui/LoadingState'
import { fetchAllPages } from '../../utils/pagination'
import Chip from '../ui/Chip'
import Tooltip from '../ui/Tooltip'
import { Timeline, TimelineItem } from '../ui/Timeline'
import { LinearProgress } from '../ui/Progress'
import ScreenModalPortal from '../ui/ScreenModalPortal'
import CopyableContact from '../ui/CopyableContact'
import PhoneInputWithCountry from '../ui/PhoneInputWithCountry'
import DateRangeFilter from '../ui/DateRangeFilter'
import { anyFieldMatchesSearch } from '../../utils/search'
import { emptyDateRange, isWithinDateRange } from '../../utils/dateRangeFilter'

/* ── Constants ─────────────────────────────────────────────────── */
const INDUSTRIES = ['Finance', 'IT', 'SaaS', 'Manufacturing', 'Healthcare', 'E-commerce', 'Retail', 'Education', 'Other']
const normalize = (value) => String(value ?? '').trim().toLowerCase()

const SOURCE_COLORS = {
  facebook:   'bg-blue-500',
  instagram:  'bg-pink-500',
  linkedin:   'bg-sky-600',
  website:    'bg-emerald-500',
  whatsapp:   'bg-green-500',
  google_ads: 'bg-yellow-500',
  meta_ads:   'bg-indigo-500',
  referral:   'bg-purple-500',
  email:      'bg-orange-500',
  other:      'bg-slate-500',
}

const SOURCE_LABELS = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', LINKEDIN: 'LinkedIn',
  WEBSITE: 'Website', WHATSAPP: 'WhatsApp', GOOGLE_ADS: 'Google Ads',
  META_ADS: 'Meta Ads', REFERRAL: 'Referral', EMAIL: 'Email', OTHER: 'Other',
}

const STATUS_BADGES = {
  new:         { label: 'New',         class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  contacted:   { label: 'Contacted',   class: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400' },
  qualified:   { label: 'Qualified',   class: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400' },
  proposal:    { label: 'Proposal',    class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
  negotiation: { label: 'Negotiation', class: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  won:         { label: 'Won',         class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' },
  lost:        { label: 'Lost',        class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
}

const SCORE_BADGES = {
  hot:  { label: 'Hot',  class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  warm: { label: 'Warm', class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
  cold: { label: 'Cold', class: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400' },
}

function formatCurrency(value) {
  const num = Number(value ?? 0)
  if (num === 0) return '₹0'
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`
  if (num >= 1000) return `₹${(num / 1000).toFixed(0)}k`
  return `₹${num.toLocaleString('en-IN')}`
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
function formatTimeAgo(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return null
  const sec = Math.round((date - Date.now()) / 1000)
  const abs = Math.abs(sec)
  const [div, unit] = abs < 60 ? [1, 'second'] : abs < 3600 ? [60, 'minute'] : abs < 86400 ? [3600, 'hour'] : abs < 2592000 ? [86400, 'day'] : abs < 31536000 ? [2592000, 'month'] : [31536000, 'year']
  return RTF.format(Math.round(sec / div), unit)
}

const EMPTY_FORM = { name: '', contact: '', email: '', phone: '', industry: 'IT', status: 'active', revenue: '' }

/* ── Add Customer Modal ─────────────────────────────────────────── */
function AddCustomerModal({ onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const validate = () => {
    const e = {}
    if (!form.name.trim())    e.name    = 'Company name is required'
    if (!form.contact.trim()) e.contact = 'Contact person is required'
    if (!form.email.trim())   e.email   = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Invalid email'
    if (!form.phone.trim())   e.phone   = 'Phone is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    const customer = {
      name: form.name.trim(),
      contact: form.contact.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      industry: form.industry,
      status: form.status,
      revenue: Number(form.revenue) || 0,
    }
    const saved = await onSave(customer)
    if (saved) {
      toast.success(`${customer.name} added`)
      onClose()
    }
  }

  return (
    <ScreenModalPortal>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-label="Add customer"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }}
        className="glass-card w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-brand-500" /> Add Customer
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Company Name *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Infosys Ltd."
              className={`input mt-1 w-full ${errors.name ? 'ring-2 ring-red-400' : ''}`} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Primary Contact *</label>
            <input value={form.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Contact person name"
              className={`input mt-1 w-full ${errors.contact ? 'ring-2 ring-red-400' : ''}`} />
            {errors.contact && <p className="text-xs text-red-500 mt-1">{errors.contact}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email *</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="contact@company.com"
                className={`input mt-1 w-full ${errors.email ? 'ring-2 ring-red-400' : ''}`} />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Phone (with Country Code) *</label>
              <PhoneInputWithCountry
                value={form.phone}
                onChange={(val) => set('phone', val)}
                placeholder="98765 43210"
                required
              />
              {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Industry</label>
              <select value={form.industry} onChange={(e) => set('industry', e.target.value)} className="input mt-1 w-full">
                {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)} className="input mt-1 w-full">
                <option value="active">Active</option>
                <option value="at-risk">At Risk</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Revenue (₹)</label>
            <input type="number" min={0} value={form.revenue} onChange={(e) => set('revenue', e.target.value)}
              placeholder="0" className="input mt-1 w-full" />
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button onClick={handleSave} className="btn-primary flex-1 text-sm">Add Customer</button>
        </div>
      </motion.div>
      </motion.div>
    </ScreenModalPortal>
  )
}

/* ── Smart Notes Parser ────────────────────────────────────────── */
function parseNotes(raw) {
  if (!raw || typeof raw !== 'string') return []
  const sections = []
  const text = raw.trim()

  // Split into blocks by known section markers
  const blocks = text.split(/\n(?=\[(?:Merged Lead|Meta Sync Merge|Reopened Lead)\])/)

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    // Facebook Lead Ad notes
    if (/^Facebook Lead\s*(Ad)?\s*\|/i.test(trimmed)) {
      const metaLine = trimmed.split('\n')[0]
      const pairs = metaLine.split('|').map((p) => p.trim()).filter(Boolean)
      const meta = {}
      for (const pair of pairs) {
        if (pair.toLowerCase().startsWith('facebook lead')) continue
        const colonIdx = pair.indexOf(':')
        if (colonIdx > 0) {
          const key = pair.slice(0, colonIdx).trim()
          const val = pair.slice(colonIdx + 1).trim()
          if (val) meta[key] = val
        }
      }

      // Extract raw payload
      const payloadMatch = trimmed.match(/Raw Payload:\s*\n([\s\S]*)/)
      const payload = payloadMatch ? payloadMatch[1].trim() : null

      sections.push({
        type: 'facebook',
        icon: Megaphone,
        label: 'Facebook Lead Ad',
        color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
        iconColor: 'text-blue-500',
        meta,
        payload,
      })
      continue
    }

    // Google Sheet import
    if (/^Imported from Google Sheet/i.test(trimmed)) {
      const pairs = trimmed.split('|').map((p) => p.trim()).filter(Boolean)
      const meta = {}
      for (const pair of pairs) {
        if (pair.toLowerCase().startsWith('imported from')) continue
        const colonIdx = pair.indexOf(':')
        if (colonIdx > 0) {
          const key = pair.slice(0, colonIdx).trim()
          const val = pair.slice(colonIdx + 1).trim()
          if (val) meta[key] = val
        }
      }
      sections.push({
        type: 'google-sheet',
        icon: Sheet,
        label: 'Imported from Google Sheet',
        color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
        iconColor: 'text-green-500',
        meta,
        payload: null,
      })
      continue
    }

    // Merged lead
    if (/^\[Merged Lead\]/i.test(trimmed)) {
      const body = trimmed.replace(/^\[Merged Lead\]\s*/i, '').trim()
      sections.push({
        type: 'merge',
        icon: GitMerge,
        label: 'Merged Lead',
        color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
        iconColor: 'text-purple-500',
        meta: {},
        body,
        payload: null,
      })
      continue
    }

    // Meta Sync Merge
    if (/^\[Meta Sync Merge\]/i.test(trimmed)) {
      const inner = trimmed.replace(/^\[Meta Sync Merge\]\s*/i, '').trim()
      const metaLine = inner.split('\n')[0]
      const pairs = metaLine.split('|').map((p) => p.trim()).filter(Boolean)
      const meta = {}
      for (const pair of pairs) {
        if (pair.toLowerCase().startsWith('facebook lead')) continue
        const colonIdx = pair.indexOf(':')
        if (colonIdx > 0) {
          const key = pair.slice(0, colonIdx).trim()
          const val = pair.slice(colonIdx + 1).trim()
          if (val) meta[key] = val
        }
      }
      const payloadMatch = inner.match(/Raw Payload:\s*\n([\s\S]*)/)
      const payload = payloadMatch ? payloadMatch[1].trim() : null
      sections.push({
        type: 'meta-merge',
        icon: GitMerge,
        label: 'Meta Sync Merge',
        color: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800',
        iconColor: 'text-indigo-500',
        meta,
        payload,
      })
      continue
    }

    // Reopened lead
    if (/^\[Reopened Lead\]/i.test(trimmed)) {
      const body = trimmed.replace(/^\[Reopened Lead\]\s*/i, '').trim()
      sections.push({
        type: 'reopen',
        icon: RotateCcw,
        label: 'Reopened',
        color: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
        iconColor: 'text-amber-500',
        meta: {},
        body,
        payload: null,
      })
      continue
    }

    // Imported from file
    if (/^Imported from file/i.test(trimmed)) {
      sections.push({
        type: 'import',
        icon: ClipboardList,
        label: 'File Import',
        color: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800',
        iconColor: 'text-cyan-500',
        meta: {},
        body: trimmed,
        payload: null,
      })
      continue
    }

    // Plain / manual note
    sections.push({
      type: 'manual',
      icon: StickyNote,
      label: 'Note',
      color: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700',
      iconColor: 'text-slate-500',
      meta: {},
      body: trimmed,
      payload: null,
    })
  }

  return sections
}

/* ── Field-name prettifier ─────────────────────────────────────── */
const FIELD_LABELS = {
  full_name: 'Full Name', first_name: 'First Name', last_name: 'Last Name',
  email: 'Email', phone_number: 'Phone', phone: 'Phone',
  company_name: 'Company', company: 'Company', city: 'City', state: 'State',
  country: 'Country', zip_code: 'Zip Code', street_address: 'Address',
  job_title: 'Job Title', service: 'Service', service_name: 'Service',
  specialization: 'Specialization', sub_service: 'Sub Service', subservice: 'Sub Service',
  form_name: 'Form', form_id: 'Form ID', ad_id: 'Ad ID', ad_name: 'Ad Name',
  campaign_id: 'Campaign ID', campaign_name: 'Campaign', adset_name: 'Ad Set',
  created_time: 'Submitted At', id: 'Lead ID', leadgen_id: 'Leadgen ID',
  page_id: 'Page ID', page_name: 'Page',
}

function prettifyFieldName(name) {
  if (FIELD_LABELS[name]) return FIELD_LABELS[name]
  return name
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatFieldValue(key, value) {
  if (!value || value === 'null' || value === 'undefined') return null
  if (key === 'created_time') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    }
  }
  return String(value)
}

/* ── Smart payload details (replaces raw JSON viewer) ─────────── */
function PayloadDetails({ data }) {
  const [showRaw, setShowRaw] = useState(false)
  if (!data) return null

  let parsed = null
  try { parsed = typeof data === 'string' ? JSON.parse(data) : data } catch { /* not JSON */ }

  if (!parsed || typeof parsed !== 'object') return null

  // Extract field_data entries → readable key-value pairs
  const fieldEntries = []
  if (Array.isArray(parsed.field_data)) {
    for (const field of parsed.field_data) {
      const name = field?.name
      const values = Array.isArray(field?.values) ? field.values : []
      const val = values.join(', ')
      if (name && val) {
        fieldEntries.push({ key: name, label: prettifyFieldName(name), value: val })
      }
    }
  }

  // Extract useful top-level fields (skip field_data, skip internal IDs if we already have them)
  const TOP_KEYS = ['form_name', 'campaign_name', 'ad_name', 'adset_name', 'page_name', 'created_time', 'id', 'form_id', 'ad_id', 'campaign_id', 'page_id', 'leadgen_id']
  const topEntries = []
  for (const key of TOP_KEYS) {
    const raw = parsed[key]
    if (raw === undefined || raw === null || raw === '' || raw === 'null') continue
    const formatted = formatFieldValue(key, raw)
    if (formatted) {
      topEntries.push({ key, label: prettifyFieldName(key), value: formatted })
    }
  }

  const hasContent = fieldEntries.length > 0 || topEntries.length > 0

  if (!hasContent) {
    // Fallback: if we couldn't extract anything meaningful, show raw toggle only
    return (
      <div className="mt-2">
        <button onClick={() => setShowRaw(!showRaw)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
          <Code2 className="w-3 h-3" /> Raw Data
          {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showRaw && (
          <pre className="mt-1.5 p-2.5 rounded-lg bg-slate-900 dark:bg-slate-950 text-green-400 text-[11px] leading-relaxed overflow-x-auto max-h-48 overflow-y-auto font-mono">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Contact / form field details */}
      {fieldEntries.length > 0 && (
        <div className="rounded-lg bg-white/60 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40 p-2.5">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Form Details</p>
          <div className="space-y-1">
            {fieldEntries.map(({ key, label, value }) => (
              <div key={key} className="text-xs py-0.5">
                <span className="font-semibold text-slate-500 dark:text-slate-400">{label}: </span>
                <span className="text-slate-700 dark:text-slate-300">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Campaign / ad metadata */}
      {topEntries.length > 0 && (
        <div className="rounded-lg bg-white/60 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40 p-2.5">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">Ad & Campaign Info</p>
          <div className="space-y-1">
            {topEntries.map(({ key, label, value }) => (
              <div key={key} className="text-xs py-0.5">
                <span className="font-semibold text-slate-500 dark:text-slate-400">{label}: </span>
                <span className="text-slate-700 dark:text-slate-300">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw toggle for debugging */}
      <button onClick={() => setShowRaw(!showRaw)}
        className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400 transition-colors">
        <Code2 className="w-3 h-3" /> {showRaw ? 'Hide' : 'Show'} raw data
        {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {showRaw && (
        <pre className="p-2.5 rounded-lg bg-slate-900 dark:bg-slate-950 text-green-400 text-[11px] leading-relaxed overflow-x-auto max-h-40 overflow-y-auto font-mono">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  )
}

/* ── Note card component ───────────────────────────────────────── */
function NoteCard({ section }) {
  const Icon = section.icon
  const metaEntries = Object.entries(section.meta || {})

  return (
    <div className={`rounded-xl border p-3 ${section.color}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${section.iconColor} flex-shrink-0`} />
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          {section.label}
        </span>
      </div>

      {/* Structured key-value metadata */}
      {metaEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1.5">
          {metaEntries.map(([key, val]) => (
            <div key={key} className="text-xs">
              <span className="font-semibold text-slate-500 dark:text-slate-400">{key}: </span>
              <span className="text-slate-700 dark:text-slate-300">{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body text (manual notes, merge info, reopen reason) */}
      {section.body && (
        <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-line leading-relaxed">
          {section.body}
        </p>
      )}

      {/* Smart payload details (parsed from JSON) */}
      <PayloadDetails data={section.payload} />
    </div>
  )
}

/* ── Notes Section ─────────────────────────────────────────────── */
function NotesSection({ notes }) {
  const sections = useMemo(() => parseNotes(notes), [notes])
  if (!sections.length) return null

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Notes ({sections.length})
      </p>
      <div className="space-y-2">
        {sections.map((section, i) => (
          <NoteCard key={`${section.type}-${i}`} section={section} />
        ))}
      </div>
    </div>
  )
}

/* ── Map a lead from the API into a customer row ───────────────── */
function mapLeadToCustomer(lead) {
  const source = String(lead.source || 'OTHER').toUpperCase()
  const status = normalize(lead.status || 'new')
  const score = normalize(lead.score || 'cold')
  const dealValue = Number(lead.dealValue ?? lead.value ?? 0)
  const revenueValue = Number(lead.revenueValue ?? dealValue)

  return {
    id: lead.id,
    name: lead.name || '(No Name)',
    email: (lead.email || '').trim().toLowerCase(),
    phone: lead.phone || '',
    company: lead.company || '',
    service: lead.service || '',
    specialization: lead.specialization || '',
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    score,
    status,
    dealValue,
    revenueValue,
    assignedTo: lead.assignedToName || '',
    assignedToId: lead.assignedToId || null,
    tags: Array.isArray(lead.tags) ? lead.tags.join(', ') : (lead.tags || ''),
    notes: lead.notes || '',
    convertedAt: lead.convertedAt || null,
    lastContactedAt: lead.lastContactedAt || null,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    since: formatDate(lead.createdAt),
  }
}

/* ── Stat Card ─────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{value}</p>
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ──────────────────────────────────────────────────── */
export default function CustomersPage() {
  const [searchParams] = useSearchParams()
  const [customers, setCustomers] = useState([])
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateRange, setDateRange] = useState(emptyDateRange)
  const [currentPage, setCurrentPage] = useState(0)
  const pageSize = 10
  const routeSearch = searchParams.get('search') ?? ''

  useEffect(() => { setSearch(routeSearch) }, [routeSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => { setCurrentPage(0) }, [debouncedSearch, sourceFilter, statusFilter, dateRange])

  /* ── Fetch ALL leads — these are the real customers ──────────── */
  useEffect(() => {
    let cancelled = false
    const loadData = async () => {
      setLoading(true)
      try {
        const result = await fetchAllPages((params) => leadsAPI.getAll(params), 200)
        if (cancelled) return

        const rows = (result.rows || []).map(mapLeadToCustomer)

        // Sort by most recent first
        rows.sort((a, b) => {
          const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return db - da
        })

        setCustomers(rows)
        setSelected((prev) => {
          if (rows.length === 0) return null
          const still = prev && rows.some((c) => c.id === prev.id)
          return still ? rows.find((c) => c.id === prev.id) : rows[0]
        })
      } catch (err) {
        if (!cancelled) toast.error(err?.message || 'Failed to load customers')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selected?.id || selected.notesLoaded || selected.notes) return

    let cancelled = false
    leadsAPI.getById(selected.id)
      .then((lead) => {
        if (cancelled || !lead) return
        const fullRow = { ...mapLeadToCustomer(lead), notesLoaded: true }
        setCustomers((prev) => prev.map((customer) => (
          customer.id === fullRow.id ? { ...customer, ...fullRow } : customer
        )))
        setSelected((prev) => (
          prev?.id === fullRow.id ? { ...prev, ...fullRow } : prev
        ))
      })
      .catch(() => {
        if (cancelled) return
        setSelected((prev) => (
          prev?.id === selected.id ? { ...prev, notesLoaded: true } : prev
        ))
      })

    return () => { cancelled = true }
  }, [selected?.id, selected?.notes, selected?.notesLoaded])

  /* ── Filtering + pagination ──────────────────────────────────── */
  const filtered = useMemo(() => {
    let rows = customers
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      rows = rows.filter((c) =>
        anyFieldMatchesSearch(q, [c.name, c.phone, c.company, c.email, c.service, c.assignedTo])
      )
    }
    if (sourceFilter !== 'all') {
      rows = rows.filter((c) => normalize(c.source) === normalize(sourceFilter))
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((c) => c.status === statusFilter)
    }
    rows = rows.filter((c) => isWithinDateRange(c.createdAt || c.updatedAt || c.convertedAt, dateRange))
    return rows
  }, [customers, debouncedSearch, sourceFilter, statusFilter, dateRange])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  /* ── Sources & statuses for filter dropdowns ─────────────────── */
  const availableSources = useMemo(() => {
    const sources = new Set()
    customers.forEach((c) => { if (c.source) sources.add(c.source) })
    return Array.from(sources).sort()
  }, [customers])

  const availableStatuses = useMemo(() => {
    const statuses = new Set()
    customers.forEach((c) => { if (c.status) statuses.add(c.status) })
    return Array.from(statuses).sort()
  }, [customers])

  /* ── Summary stats from real data ────────────────────────────── */
  const stats = useMemo(() => {
    const total = customers.length
    const totalRevenue = customers.reduce((s, c) => s + (c.dealValue || 0), 0)
    const wonCount = customers.filter((c) => c.status === 'won').length
    const hotCount = customers.filter((c) => c.score === 'hot').length
    return { total, totalRevenue, wonCount, hotCount }
  }, [customers])

  const createCustomer = async (data) => {
    try {
      const payload = {
        name: data.name,
        company: data.name,
        primaryContact: data.contact,
        email: data.email,
        phone: data.phone,
        industry: data.industry,
        healthScore: data.status === 'at-risk' ? 40 : 75,
        status: data.status === 'at-risk' ? 'AT_RISK' : 'ACTIVE',
      }
      await customersAPI.create(payload)
      // Reload leads to pick up any changes
      const result = await fetchAllPages((params) => leadsAPI.getAll(params), 200)
      const rows = (result.rows || []).map(mapLeadToCustomer)
      rows.sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return db - da
      })
      setCustomers(rows)
      return true
    } catch (err) {
      toast.error(err?.message || 'Failed to create customer')
      return null
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <PageHeading
          title="Customers"
          subtitle={`${stats.total} total · ${stats.wonCount} converted · ${formatCurrency(stats.totalRevenue)} pipeline value`}
        />
        <button onClick={() => setShowAdd(true)} className="btn-primary w-full justify-center gap-1.5 text-sm sm:w-auto">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      {/* Stats from real data */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Customers" value={stats.total} color="bg-brand-500" />
        <StatCard icon={IndianRupee} label="Pipeline Value" value={formatCurrency(stats.totalRevenue)} color="bg-emerald-500" />
        <StatCard icon={TrendingUp} label="Converted (Won)" value={stats.wonCount} color="bg-purple-500" />
        <StatCard icon={Star} label="Hot Leads" value={stats.hotCount} color="bg-red-500" />
      </div>

      {/* Search + Filters */}
      <div className="glass-card w-full p-2.5 sm:inline-block sm:w-auto">
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <div className="flex min-h-[34px] w-full max-w-sm items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800/60 sm:w-[300px] lg:w-[340px]">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, company, or email..."
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-300"
            />
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:contents">
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              className="input !w-full min-w-0 py-1.5 text-xs sm:!w-[150px] sm:flex-none">
              <option value="all">All Sources</option>
              {availableSources.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="input !w-full min-w-0 py-1.5 text-xs sm:!w-[150px] sm:flex-none">
              <option value="all">All Status</option>
              {availableStatuses.map((s) => (
                <option key={s} value={s}>{STATUS_BADGES[s]?.label || s}</option>
              ))}
            </select>
          </div>
          <DateRangeFilter value={dateRange} onChange={setDateRange} compact className="w-full sm:w-auto" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
        {/* ── Customer List ───────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-2">
          {loading ? (
            <LoadingState text="Loading customers…" card />
          ) : paged.length === 0 ? (
            <div className="glass-card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No customers found</p>
              <p className="text-xs mt-1">
                {debouncedSearch || sourceFilter !== 'all' || statusFilter !== 'all'
                  ? 'Try changing the filters'
                  : 'Add leads to see them here'}
              </p>
            </div>
          ) : paged.map((c) => {
            const badge = STATUS_BADGES[c.status]
            return (
              <button key={c.id} onClick={() => setSelected(c)}
                className={`w-full glass-card p-3 text-left hover:shadow-card-hover transition-all sm:p-3.5
                  ${selected?.id === c.id ? 'ring-2 ring-brand-500/50' : ''}`}>
                <div className="flex items-start gap-2.5 sm:items-center sm:gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 sm:h-10 sm:w-10">
                    {(c.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{c.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {c.company ? `${c.company} · ` : ''}{c.email}
                    </p>
                  </div>
                  {badge && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${badge.class}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 sm:justify-between">
                  <span className="flex items-center gap-1">
                    <IndianRupee className="w-3 h-3" />
                    {formatCurrency(c.dealValue)}
                  </span>
                  {c.sourceLabel && (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white ${SOURCE_COLORS[normalize(c.source)] || 'bg-slate-500'}`}>
                      {c.sourceLabel}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-slate-400">
                    <Calendar className="w-3 h-3" />
                    {c.since}
                  </span>
                </div>
              </button>
            )
          })}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="glass-card p-3">
              <div className="flex items-center justify-between gap-2">
                <button type="button"
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 0))}
                  disabled={currentPage === 0}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                  <ChevronLeft className="w-3 h-3" /> Prev
                </button>
                <p className="text-xs text-slate-500">
                  {currentPage + 1} / {totalPages} · {filtered.length} total
                </p>
                <button type="button"
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages - 1))}
                  disabled={currentPage >= totalPages - 1}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Detail Panel ────────────────────────────────────────── */}
        <div className="glass-card p-3.5 sm:p-5 lg:col-span-2 lg:p-6">
          {selected ? (
            <div className="space-y-4 sm:space-y-5">
              {/* Header */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center text-white text-lg font-bold flex-shrink-0 sm:h-14 sm:w-14 sm:text-xl">
                  {(selected.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="truncate text-lg font-bold text-slate-800 dark:text-slate-200 sm:text-xl">{selected.name}</h2>
                  <p className="text-sm text-slate-500">
                    {selected.company && selected.company !== selected.name ? `${selected.company} · ` : ''}
                    Added {selected.since}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {STATUS_BADGES[selected.status] && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGES[selected.status].class}`}>
                        {STATUS_BADGES[selected.status].label}
                      </span>
                    )}
                    {selected.sourceLabel && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-white ${SOURCE_COLORS[normalize(selected.source)] || 'bg-slate-500'}`}>
                        <Globe className="w-3 h-3" /> {selected.sourceLabel}
                      </span>
                    )}
                    {SCORE_BADGES[selected.score] && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${SCORE_BADGES[selected.score].class}`}>
                        <Star className="w-3 h-3" /> {SCORE_BADGES[selected.score].label}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                {[
                  { label: 'Email', value: selected.email || '—', icon: Mail },
                  { label: 'Phone', value: selected.phone || '—', icon: Phone },
                  { label: 'Company', value: selected.company || '—', icon: Building2 },
                  { label: 'Service', value: selected.service || '—', icon: Briefcase },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5 sm:p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-3.5 h-3.5 text-slate-400" />
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
                    </div>
                    {label === 'Email' || label === 'Phone' ? (
                      <CopyableContact
                        value={value}
                        label={label}
                        className="max-w-full text-sm font-medium text-slate-700 dark:text-slate-300"
                        textClassName="break-all"
                      />
                    ) : (
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 break-all">{value}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Deal & Revenue Info */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-2.5 text-center sm:p-3">
                  <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Deal Value</p>
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                    {formatCurrency(selected.dealValue)}
                  </p>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-2.5 text-center sm:p-3">
                  <p className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Source</p>
                  <p className="text-sm font-bold text-purple-700 dark:text-purple-300 mt-1.5">
                    {selected.sourceLabel || '—'}
                  </p>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-2.5 text-center sm:p-3">
                  <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Score</p>
                  <p className="text-sm font-bold text-blue-700 dark:text-blue-300 mt-1.5 capitalize">
                    {selected.score || '—'}
                  </p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-2.5 text-center sm:p-3">
                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Status</p>
                  <p className="text-sm font-bold text-amber-700 dark:text-amber-300 mt-1.5 capitalize">
                    {selected.status || '—'}
                  </p>
                </div>
              </div>

              {/* Assigned To + Specialization */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                {selected.assignedTo && (
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5 sm:p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <UserCircle className="w-3.5 h-3.5 text-slate-400" />
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Assigned To</p>
                    </div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{selected.assignedTo}</p>
                  </div>
                )}
                {selected.specialization && (
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5 sm:p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Tag className="w-3.5 h-3.5 text-slate-400" />
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Specialization</p>
                    </div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{selected.specialization}</p>
                  </div>
                )}
              </div>

              {/* Notes — smart parsed */}
              <NotesSection notes={selected.notes} />

              {/* Tags */}
              {selected.tags && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {String(selected.tags).split(',').filter(Boolean).map((tag) => (
                      <span key={tag.trim()} className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        {tag.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Timeline</p>
                <div className="space-y-2">
                  {selected.convertedAt && (
                    <div className="flex items-start gap-3 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-slate-700 dark:text-slate-300 font-medium">Converted to Customer</p>
                        <p className="text-slate-400">{formatDate(selected.convertedAt)} · {formatTimeAgo(selected.convertedAt)}</p>
                      </div>
                    </div>
                  )}
                  {selected.lastContactedAt && (
                    <div className="flex items-start gap-3 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-slate-700 dark:text-slate-300 font-medium">Last Contacted</p>
                        <p className="text-slate-400">{formatDate(selected.lastContactedAt)} · {formatTimeAgo(selected.lastContactedAt)}</p>
                      </div>
                    </div>
                  )}
                  {selected.createdAt && (
                    <div className="flex items-start gap-3 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-slate-700 dark:text-slate-300 font-medium">Lead Created</p>
                        <p className="text-slate-400">{formatDate(selected.createdAt)} · {formatTimeAgo(selected.createdAt)}</p>
                      </div>
                    </div>
                  )}
                  {!selected.convertedAt && !selected.lastContactedAt && !selected.createdAt && (
                    <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-4 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                      No timeline data available.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              <div className="text-center">
                <UserCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Select a customer to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddCustomerModal
            onClose={() => setShowAdd(false)}
            onSave={createCustomer}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
