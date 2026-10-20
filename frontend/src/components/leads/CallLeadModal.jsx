import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  X, PhoneCall, Bot, Phone, Globe, Sparkles, AlertCircle,
  CheckCircle2, ChevronDown, ChevronUp, User, Building2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { callsAPI, leadsAPI } from '../../services/api'

const SETUP_CARDS = [
  {
    id: 'bolna_twilio',
    name: 'Bolna AI + Twilio',
    badge: 'Recommended',
    badgeCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800',
    icon: Bot,
    iconCls: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800',
    description: 'Conversational AI voice agent (Bolna) routed through your Twilio telephony line.',
  },
  {
    id: 'bolna',
    name: 'Bolna AI (Default)',
    badge: 'Standard',
    badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border border-blue-300 dark:border-blue-800',
    icon: Sparkles,
    iconCls: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
    description: 'Bolna conversational AI voice agent using Bolna built-in telephony.',
  },
  {
    id: 'twilio',
    name: 'Twilio Direct Voice',
    badge: 'Direct Line',
    badgeCls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-300 dark:border-rose-800',
    icon: Phone,
    iconCls: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
    description: 'Direct automated outbound call using Twilio Voice text-to-speech.',
  },
  {
    id: 'webhook',
    name: 'Custom Webhook',
    badge: 'Webhook',
    badgeCls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
    icon: Globe,
    iconCls: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
    description: 'Forward call event to your custom webhook endpoint.',
  },
]

export default function CallLeadModal({ lead, onClose, onCallSuccess }) {
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [callOptions, setCallOptions] = useState(null)
  const [selectedSetup, setSelectedSetup] = useState(() => {
    return localStorage.getItem('nexacrm_call_setup') || 'bolna_twilio'
  })
  const [selectedFromNumber, setSelectedFromNumber] = useState(() => {
    return localStorage.getItem('nexacrm_call_from_number') || ''
  })
  const [customFromNumber, setCustomFromNumber] = useState('')
  const [isCustomFrom, setIsCustomFrom] = useState(false)
  const [toNumber, setToNumber] = useState(lead?.phone || '')
  const [script, setScript] = useState(() => {
    const leadName = lead?.name?.trim() || 'there'
    const service = lead?.service?.trim() ? ` for ${lead.service.trim()}` : ''
    return `Hi ${leadName}, this is NexaCRM calling regarding your enquiry${service}. Is this a good time to talk?`
  })
  const [showScript, setShowScript] = useState(false)
  const [calling, setCalling] = useState(false)

  useEffect(() => {
    let alive = true
    callsAPI.getOptions()
      .then((data) => {
        if (!alive) return
        setCallOptions(data)
        if (data?.activeSetup && !localStorage.getItem('nexacrm_call_setup')) {
          setSelectedSetup(data.activeSetup)
        }
        if (!selectedFromNumber) {
          if (data?.defaultPhoneNumber) {
            setSelectedFromNumber(data.defaultPhoneNumber)
          } else if (data?.phoneNumbers?.length > 0) {
            setSelectedFromNumber(data.phoneNumbers[0])
          }
        }
      })
      .catch((err) => {
        console.warn('Could not load call options:', err)
      })
      .finally(() => {
        if (alive) setLoadingOptions(false)
      })

    return () => { alive = false }
  }, [])

  const availableNumbers = callOptions?.phoneNumbers || []
  const effectiveFromNumber = isCustomFrom ? customFromNumber.trim() : (selectedFromNumber || callOptions?.defaultPhoneNumber || '')

  const handleSetupSelect = (setupId) => {
    setSelectedSetup(setupId)
    localStorage.setItem('nexacrm_call_setup', setupId)
  }

  const handleFromNumberChange = (value) => {
    if (value === '__custom__') {
      setIsCustomFrom(true)
    } else {
      setIsCustomFrom(false)
      setSelectedFromNumber(value)
      localStorage.setItem('nexacrm_call_from_number', value)
    }
  }

  const handleStartCall = async (e) => {
    e?.preventDefault()
    if (!toNumber.trim()) {
      toast.error('Recipient phone number is required.')
      return
    }

    if (isCustomFrom && !customFromNumber.trim()) {
      toast.error('Please enter a valid custom caller phone number.')
      return
    }

    setCalling(true)
    try {
      const payload = {
        setup: selectedSetup,
        provider: selectedSetup,
        fromNumber: effectiveFromNumber,
        toNumber: toNumber.trim(),
        script: script.trim(),
      }

      const res = await leadsAPI.callNow(lead.id, payload)

      if (effectiveFromNumber) {
        localStorage.setItem('nexacrm_call_from_number', effectiveFromNumber)
      }
      localStorage.setItem('nexacrm_call_setup', selectedSetup)

      const setupName = SETUP_CARDS.find(s => s.id === selectedSetup)?.name || selectedSetup
      toast.success(res?.message || `Call placed via ${setupName}!`)
      onCallSuccess?.(res)
    } catch (err) {
      toast.error(err?.message || 'Failed to place call')
    } finally {
      setCalling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Place call">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl z-10 custom-scrollbar"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400">
                <PhoneCall className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Place AI Outbound Call
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <User className="w-3 h-3 text-slate-400" /> {lead?.name || 'Lead'}
                  </span>
                  {lead?.company && (
                    <span className="flex items-center gap-1">
                      · <Building2 className="w-3 h-3 text-slate-400" /> {lead.company}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleStartCall} className="p-6 space-y-5">
          {/* Section 1: Choose Call Setup */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>1. Select Call Setup</span>
              </label>
              <span className="text-[11px] text-slate-500">Pick telephony & AI provider</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {SETUP_CARDS.map((setup) => {
                const Icon = setup.icon
                const isSelected = selectedSetup === setup.id
                return (
                  <div
                    key={setup.id}
                    onClick={() => handleSetupSelect(setup.id)}
                    className={`relative p-3 rounded-xl border text-left cursor-pointer transition-all select-none ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 ring-2 ring-brand-500/30'
                        : 'border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`p-1.5 rounded-lg border flex-shrink-0 ${setup.iconCls}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                            {setup.name}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${setup.badgeCls}`}>
                            {setup.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1 leading-snug">
                          {setup.description}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Section 2: Choose Caller Phone Number (From) */}
          <div className="bg-slate-50/80 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-700/50 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                2. Choose Caller Phone Number (From)
              </label>
              {callOptions?.twilioConfigured && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Twilio Connected
                </span>
              )}
            </div>

            <div>
              <select
                value={isCustomFrom ? '__custom__' : selectedFromNumber}
                onChange={(e) => handleFromNumberChange(e.target.value)}
                className="w-full text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                {availableNumbers.length > 0 ? (
                  availableNumbers.map((num, idx) => (
                    <option key={num} value={num}>
                      {num} {idx === 0 ? '(Default Twilio Line)' : `(Line ${idx + 1})`}
                    </option>
                  ))
                ) : (
                  <option value={selectedFromNumber || ''}>
                    {selectedFromNumber ? `${selectedFromNumber} (Configured caller)` : 'Select / Enter caller phone number'}
                  </option>
                )}
                <option value="__custom__">+ Enter Custom Phone Number / Caller ID...</option>
              </select>
            </div>

            {isCustomFrom && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <input
                  type="text"
                  value={customFromNumber}
                  onChange={(e) => setCustomFromNumber(e.target.value)}
                  placeholder="e.g. +12055551234 or +919876543210"
                  className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Provide international format starting with + (e.g. +1... or +91...)
                </p>
              </motion.div>
            )}
          </div>

          {/* Section 3: Lead Recipient Phone Number (To) */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block mb-1.5">
              3. Lead Phone Number to Call (To)
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="+91..."
                required
                className="w-full text-xs font-semibold pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Confirm or edit the phone number that will receive the outbound call.
            </p>
          </div>

          {/* Section 4: Collapsible Call Script */}
          <div className="border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowScript(!showScript)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                Customize Call Intro Script (Optional)
              </span>
              {showScript ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {showScript && (
              <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                <textarea
                  rows={3}
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30 resize-none"
                  placeholder="Greeting script..."
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  For Bolna agents, this serves as the conversation starter and intent context.
                </p>
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={calling}
              className="btn-secondary flex-1 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={calling || !toNumber.trim()}
              className="btn-primary flex-1 py-2 text-xs font-bold gap-2 shadow-lg shadow-brand-500/20 disabled:opacity-50"
            >
              <PhoneCall className={`w-3.5 h-3.5 ${calling ? 'animate-spin' : ''}`} />
              {calling ? 'Connecting Call...' : 'Place Call Now'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
