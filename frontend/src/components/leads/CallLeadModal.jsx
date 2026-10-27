import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, PhoneCall, Bot, Phone, Globe, Sparkles, AlertCircle,
  CheckCircle2, ChevronDown, ChevronUp, User, Building2,
  PhoneOff, Mic, MicOff, Clock, ShieldCheck
} from 'lucide-react'
import toast from 'react-hot-toast'
import { callsAPI, leadsAPI } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import PhoneInputWithCountry from '../ui/PhoneInputWithCountry'

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
  const { user } = useAuthStore()
  const [callMode, setCallMode] = useState(() => localStorage.getItem('nexacrm_call_mode') || 'direct') // 'direct' | 'ai'
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
  const [agentNumber, setAgentNumber] = useState(() => {
    return localStorage.getItem('nexacrm_agent_phone') || user?.phone || ''
  })
  const [script, setScript] = useState(() => {
    const leadName = lead?.name?.trim() || 'there'
    const service = lead?.service?.trim() ? ` for ${lead.service.trim()}` : ''
    return `Hi ${leadName}, this is NexaCRM calling regarding your enquiry${service}. Is this a good time to talk?`
  })
  const [showScript, setShowScript] = useState(false)
  const [calling, setCalling] = useState(false)

  // In-call active state
  const [inCall, setInCall] = useState(false)
  const [callSid, setCallSid] = useState('')
  const [callStatus, setCallStatus] = useState('')
  const [callDuration, setCallDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)

  const timerRef = useRef(null)
  const pollRef = useRef(null)

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

  // Call timer
  useEffect(() => {
    if (inCall) {
      setCallDuration(0)
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [inCall])

  // Poll status when in call
  useEffect(() => {
    if (inCall && callSid) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await callsAPI.getStatus(callSid)
          if (res?.status) {
            setCallStatus(res.status)
            const terminal = ['COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED']
            if (terminal.includes(res.status.toUpperCase())) {
              setInCall(false)
              clearInterval(pollRef.current)
              toast('Call ended (' + res.status.toLowerCase() + ')', { icon: '📞' })
            }
          }
        } catch (e) {
          // ignore transient poll error
        }
      }, 2500)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [inCall, callSid])

  const availableNumbers = callOptions?.phoneNumbers || []
  const effectiveFromNumber = isCustomFrom ? customFromNumber.trim() : (selectedFromNumber || callOptions?.defaultPhoneNumber || '')

  const formatDuration = (sec) => {
    const mins = Math.floor(sec / 60)
    const secs = sec % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

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

  const handleModeSwitch = (mode) => {
    setCallMode(mode)
    localStorage.setItem('nexacrm_call_mode', mode)
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

    if (callMode === 'direct' && !agentNumber.trim()) {
      toast.error('Please enter your phone number to receive the call and talk directly.')
      return
    }

    setCalling(true)
    try {
      if (callMode === 'direct') {
        // Direct human-to-human call via Twilio
        if (effectiveFromNumber) localStorage.setItem('nexacrm_call_from_number', effectiveFromNumber)
        localStorage.setItem('nexacrm_agent_phone', agentNumber.trim())

        const payload = {
          toNumber: toNumber.trim(),
          fromNumber: effectiveFromNumber,
          agentNumber: agentNumber.trim(),
          leadId: lead?.id || '',
          leadName: lead?.name || '',
        }

        const res = await callsAPI.directCall(payload)
        setCallSid(res?.callSid || '')
        setCallStatus(res?.status || 'INITIATED')
        setInCall(true)
        toast.success(res?.message || 'Twilio is calling your phone first. Pick up to connect with lead!')
        onCallSuccess?.(res)
      } else {
        // AI Voice Call via Bolna
        const payload = {
          setup: selectedSetup,
          provider: selectedSetup,
          fromNumber: effectiveFromNumber,
          toNumber: toNumber.trim(),
          script: script.trim(),
        }

        const res = await leadsAPI.callNow(lead.id, payload)
        if (effectiveFromNumber) localStorage.setItem('nexacrm_call_from_number', effectiveFromNumber)
        localStorage.setItem('nexacrm_call_setup', selectedSetup)

        const setupName = SETUP_CARDS.find(s => s.id === selectedSetup)?.name || selectedSetup
        toast.success(res?.message || `AI Call placed via ${setupName}!`)
        onCallSuccess?.(res)
        onClose?.()
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to place call')
    } finally {
      setCalling(false)
    }
  }

  const handleHangup = async () => {
    if (!callSid) {
      setInCall(false)
      return
    }
    try {
      await callsAPI.hangup(callSid)
      toast.success('Call ended successfully')
    } catch (err) {
      toast.error(err?.message || 'Failed to hang up')
    } finally {
      setInCall(false)
      setCallStatus('COMPLETED')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Place call">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={inCall ? undefined : onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl z-10 custom-scrollbar"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className={`p-2 rounded-xl ${inCall ? 'bg-emerald-500 text-white animate-pulse' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'}`}>
                <PhoneCall className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {callMode === 'direct' ? 'Talk Directly with Lead' : 'Place AI Outbound Call'}
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

        {/* Active In-Call View */}
        {inCall ? (
          <div className="p-8 flex flex-col items-center justify-center space-y-6 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center animate-pulse">
                <PhoneCall className="w-10 h-10 text-emerald-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-slate-900 animate-ping" />
            </div>

            <div className="text-center space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                {callStatus || 'Connecting Call...'}
              </span>
              <h3 className="text-xl font-bold text-white tracking-wide">
                {toNumber}
              </h3>
              <p className="text-xs text-slate-400">
                {lead?.name || 'Lead Contact'}
              </p>
              <p className="text-3xl font-mono font-bold text-slate-100 pt-2">
                {formatDuration(callDuration)}
              </p>
            </div>

            <div className="bg-slate-800/80 rounded-2xl p-4 w-full max-w-md border border-slate-700 text-xs text-slate-300 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Twilio Caller ID:</span>
                <span className="font-mono text-emerald-300 font-semibold">{effectiveFromNumber || 'Default'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Bridged Your Phone:</span>
                <span className="font-mono text-slate-200">{agentNumber}</span>
              </div>
              {callSid && (
                <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-700/50">
                  <span>Call SID:</span>
                  <span className="font-mono truncate max-w-[200px]">{callSid}</span>
                </div>
              )}
            </div>

            {/* In-Call Actions */}
            <div className="flex items-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className={`p-3 rounded-full border transition-all ${
                  isMuted
                    ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={handleHangup}
                className="px-8 py-3.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-2 shadow-xl shadow-rose-600/30 transition-all hover:scale-105"
              >
                <PhoneOff className="w-5 h-5" />
                <span>End Call</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleStartCall} className="p-6 space-y-5">
            {/* Call Mode Switcher: Direct Talk vs AI Voice Agent */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Select Call Mode
                </label>
                <span className="text-[11px] text-slate-500">Choose human talk or AI agent</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() => handleModeSwitch('direct')}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all select-none flex items-start gap-3 ${
                    callMode === 'direct'
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-2 ring-emerald-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Direct Talk (Twilio)
                      </span>
                      <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full font-semibold">
                        Live Human
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      Twilio calls your phone and bridges directly with the customer.
                    </p>
                  </div>
                </div>

                <div
                  onClick={() => handleModeSwitch('ai')}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all select-none flex items-start gap-3 ${
                    callMode === 'ai'
                      ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30 ring-2 ring-purple-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex-shrink-0">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        AI Voice Agent
                      </span>
                      <span className="text-[10px] bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full font-semibold">
                        Bolna AI
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      Autonomous conversational voice AI calls lead and qualifies.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Mode: Agent Phone Number (Bridge) */}
            {callMode === 'direct' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-emerald-50/50 dark:bg-emerald-950/20 p-4 rounded-2xl border border-emerald-200/60 dark:border-emerald-800/50 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    <span>Your Receiving Phone Number (Agent)</span>
                  </label>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    Saved for future calls
                  </span>
                </div>
                <PhoneInputWithCountry
                  value={agentNumber}
                  onChange={setAgentNumber}
                  placeholder="Enter your phone to answer call..."
                  required
                />
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400/90 leading-normal">
                  💡 <strong>How it works:</strong> Twilio will ring this phone first. When you answer, it immediately dials the lead with your chosen Twilio number so you talk directly.
                </p>
              </motion.div>
            )}

            {/* AI Mode: Choose Setup */}
            {callMode === 'ai' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <span>Select AI Setup</span>
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
              </motion.div>
            )}

            {/* Choose Caller Phone Number (From) */}
            <div className="bg-slate-50/80 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Twilio Caller ID to Display (From)
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
                  className="w-full text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
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
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-1">
                  <PhoneInputWithCountry
                    value={customFromNumber}
                    onChange={setCustomFromNumber}
                    placeholder="Caller ID (e.g. 98765 43210)"
                  />
                  <p className="text-[10px] text-slate-500">
                    Select your country code and enter the verified Twilio caller ID.
                  </p>
                </motion.div>
              )}
            </div>

            {/* Lead Recipient Phone Number (To) */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block mb-1.5">
                Lead Destination Phone Number (To)
              </label>
              <PhoneInputWithCountry
                value={toNumber}
                onChange={setToNumber}
                placeholder="Recipient phone number"
                required
              />
              <p className="text-[10px] text-slate-500 mt-1">
                The lead will receive the call displaying your chosen Twilio number on caller ID.
              </p>
            </div>

            {/* AI Script (only in AI mode) */}
            {callMode === 'ai' && (
              <div className="border border-slate-200/80 dark:border-slate-800 rounded-2xl overflow-hidden">
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
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30 resize-none"
                      placeholder="Greeting script..."
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      For Bolna agents, this serves as the conversation starter and intent context.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={calling}
                className="btn-secondary flex-1 py-2.5 text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={calling || !toNumber.trim() || (callMode === 'direct' && !agentNumber.trim())}
                className={`flex-1 py-2.5 text-xs font-bold gap-2 shadow-lg disabled:opacity-50 text-white rounded-xl flex items-center justify-center transition-all ${
                  callMode === 'direct'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                    : 'bg-brand-600 hover:bg-brand-700 shadow-brand-500/20'
                }`}
              >
                <PhoneCall className={`w-4 h-4 ${calling ? 'animate-spin' : ''}`} />
                {calling
                  ? 'Connecting Call...'
                  : callMode === 'direct'
                  ? 'Connect & Talk Directly'
                  : 'Place AI Call Now'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}
