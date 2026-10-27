import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Phone, PhoneCall, PhoneOff, Delete, User, Building2,
  Volume2, VolumeX, Sparkles, Bot, Clock, CheckCircle2,
  ChevronDown, AlertCircle, Radio, Mic, MicOff, RefreshCw
} from 'lucide-react'
import toast from 'react-hot-toast'
import { callsAPI } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import PhoneInputWithCountry from '../ui/PhoneInputWithCountry'

const DIAL_KEYS = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
]

// Play soft DTMF tone on digit press
function playTone(digit) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'

    const freqs = {
      '1': 697, '2': 697, '3': 697,
      '4': 770, '5': 770, '6': 770,
      '7': 852, '8': 852, '9': 852,
      '*': 941, '0': 941, '#': 941,
    }
    osc.frequency.setValueAtTime(freqs[digit] || 800, ctx.currentTime)
    gain.gain.setValueAtTime(0.06, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
  } catch (e) {
    // Ignore audio autoplay restrictions
  }
}

export default function DirectDialerModal({ isOpen, onClose, initialNumber = '', initialLead = null }) {
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('dialer') // 'dialer' | 'recent'
  const [callMode, setCallMode] = useState(() => localStorage.getItem('nexacrm_dialer_mode') || 'direct') // 'direct' | 'ai'
  const [toNumber, setToNumber] = useState(initialNumber || initialLead?.phone || '')
  const [agentNumber, setAgentNumber] = useState(() => localStorage.getItem('nexacrm_agent_phone') || user?.phone || '')
  const [callOptions, setCallOptions] = useState(null)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [selectedFromNumber, setSelectedFromNumber] = useState(() => localStorage.getItem('nexacrm_call_from_number') || '')
  const [customFromNumber, setCustomFromNumber] = useState('')
  const [isCustomFrom, setIsCustomFrom] = useState(false)
  const [aiScript, setAiScript] = useState('Hello, this is NexaCRM calling. Is this a good time to speak?')

  // Active call state
  const [inCall, setInCall] = useState(false)
  const [callSid, setCallSid] = useState('')
  const [callStatus, setCallStatus] = useState('')
  const [callDuration, setCallDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [dialing, setDialing] = useState(false)
  const [recentCalls, setRecentCalls] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(false)

  const timerRef = useRef(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (initialNumber) setToNumber(initialNumber)
    if (initialLead?.phone) setToNumber(initialLead.phone)
  }, [initialNumber, initialLead])

  // Fetch call options (Twilio lines)
  useEffect(() => {
    let alive = true
    callsAPI.getOptions()
      .then((data) => {
        if (!alive) return
        setCallOptions(data)
        if (!selectedFromNumber) {
          if (data?.defaultPhoneNumber) {
            setSelectedFromNumber(data.defaultPhoneNumber)
          } else if (data?.phoneNumbers?.length > 0) {
            setSelectedFromNumber(data.phoneNumbers[0])
          }
        }
      })
      .catch((err) => console.warn('Could not load call options:', err))
      .finally(() => { if (alive) setLoadingOptions(false) })
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

  // Poll call status when active
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

  // Fetch recent calls
  const loadRecentCalls = async () => {
    setLoadingRecent(true)
    try {
      const res = await callsAPI.getRecent()
      const list = res?.content || res?.data || res || []
      setRecentCalls(Array.isArray(list) ? list : [])
    } catch (e) {
      console.warn('Could not load recent calls', e)
    } finally {
      setLoadingRecent(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'recent') {
      loadRecentCalls()
    }
  }, [activeTab])

  if (!isOpen) return null

  const availableNumbers = callOptions?.phoneNumbers || []
  const effectiveFromNumber = isCustomFrom ? customFromNumber.trim() : (selectedFromNumber || callOptions?.defaultPhoneNumber || '')

  const formatDuration = (sec) => {
    const mins = Math.floor(sec / 60)
    const secs = sec % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleDigitClick = (digit) => {
    playTone(digit)
    setToNumber((prev) => prev + digit)
  }

  const handleDeleteDigit = () => {
    setToNumber((prev) => prev.slice(0, -1))
  }

  const handleClearNumber = () => {
    setToNumber('')
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

  const handleStartCall = async () => {
    if (!toNumber.trim()) {
      toast.error('Please enter a destination phone number.')
      return
    }

    if (callMode === 'direct' && !agentNumber.trim()) {
      toast.error('Please enter your phone number to receive the bridged call.')
      return
    }

    if (isCustomFrom && !customFromNumber.trim()) {
      toast.error('Please enter a custom Twilio caller ID.')
      return
    }

    setDialing(true)
    try {
      if (callMode === 'direct') {
        // Direct Twilio call
        localStorage.setItem('nexacrm_agent_phone', agentNumber.trim())
        if (effectiveFromNumber) localStorage.setItem('nexacrm_call_from_number', effectiveFromNumber)
        localStorage.setItem('nexacrm_dialer_mode', 'direct')

        const payload = {
          toNumber: toNumber.trim(),
          fromNumber: effectiveFromNumber,
          agentNumber: agentNumber.trim(),
          leadId: initialLead?.id || '',
          leadName: initialLead?.name || '',
        }

        const res = await callsAPI.directCall(payload)
        setCallSid(res?.callSid || '')
        setCallStatus(res?.status || 'INITIATED')
        setInCall(true)
        toast.success(res?.message || 'Call initiated! Twilio is calling your phone now.')
      } else {
        // AI Voice Call
        const payload = {
          setup: 'bolna_twilio',
          fromNumber: effectiveFromNumber,
          toNumber: toNumber.trim(),
          script: aiScript.trim(),
        }

        if (initialLead?.id) {
          await callsAPI.trigger(initialLead.id, payload)
        } else {
          // generic outbound call
          await callsAPI.directCall({
            toNumber: toNumber.trim(),
            fromNumber: effectiveFromNumber,
            agentNumber: '',
            leadId: '',
          })
        }
        toast.success('AI Voice agent outbound call dispatched!')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to place call.')
    } finally {
      setDialing(false)
    }
  }

  const handleHangup = async () => {
    if (!callSid) {
      setInCall(false)
      return
    }
    try {
      await callsAPI.hangup(callSid)
      toast.success('Call ended')
    } catch (err) {
      toast.error(err?.message || 'Failed to hang up')
    } finally {
      setInCall(false)
      setCallStatus('COMPLETED')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={inCall ? undefined : onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Main Modal Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        className="relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl z-10 custom-scrollbar flex flex-col"
      >
        {/* Top Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${inCall ? 'bg-emerald-500 text-white animate-pulse' : 'bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400'}`}>
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <span>Twilio Direct Phone Dialer</span>
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-semibold px-2 py-0.5 rounded-full">
                  Live Voice
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Call anyone directly or with AI voice
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* In-Call Active Screen Banner */}
        {inCall ? (
          <div className="p-6 flex flex-col items-center justify-center space-y-5 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center animate-pulse">
                <PhoneCall className="w-9 h-9 text-emerald-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-slate-900 animate-ping" />
            </div>

            <div className="text-center space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                {callStatus || 'Connecting...'}
              </span>
              <h3 className="text-lg font-bold text-white tracking-wide">
                {toNumber}
              </h3>
              {initialLead?.name && (
                <p className="text-xs text-slate-400 flex items-center justify-center gap-1">
                  <User className="w-3 h-3" /> {initialLead.name}
                </p>
              )}
              <p className="text-2xl font-mono font-bold text-slate-200 pt-2">
                {formatDuration(callDuration)}
              </p>
            </div>

            <div className="bg-slate-800/80 rounded-xl p-3 w-full border border-slate-700 text-[11px] text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Caller ID (Twilio):</span>
                <span className="font-mono text-emerald-300">{effectiveFromNumber || 'Default'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Bridged Agent Phone:</span>
                <span className="font-mono text-slate-200">{agentNumber}</span>
              </div>
              {callSid && (
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>Call SID:</span>
                  <span className="font-mono truncate max-w-[150px]">{callSid}</span>
                </div>
              )}
            </div>

            {/* In-Call Controls */}
            <div className="flex items-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className={`p-3.5 rounded-full border transition-all ${
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
                className="px-6 py-3.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all hover:scale-105"
              >
                <PhoneOff className="w-5 h-5" />
                <span>Hang Up</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Tabs: Dialer vs Recent */}
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('dialer')}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  activeTab === 'dialer'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Dialpad
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('recent')}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  activeTab === 'recent'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Recent Calls
              </button>
            </div>

            {activeTab === 'recent' ? (
              <div className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar">
                {loadingRecent ? (
                  <div className="py-8 text-center text-xs text-slate-400">Loading recent calls...</div>
                ) : recentCalls.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">No recent call records found</div>
                ) : (
                  recentCalls.map((rc, i) => (
                    <div
                      key={rc.id || i}
                      className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center justify-between text-xs transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5">
                          <PhoneCall className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                          <span>{rc.contactIdentifier || rc.recipient || 'Unknown'}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {rc.contactName || rc.body || 'Call log'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setToNumber(rc.contactIdentifier || rc.recipient || '')
                          setActiveTab('dialer')
                        }}
                        className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition-colors flex-shrink-0"
                        title="Redial"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <>
                {/* Call Mode Switcher */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setCallMode('direct'); localStorage.setItem('nexacrm_dialer_mode', 'direct') }}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all ${
                      callMode === 'direct'
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/30'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <Phone className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">Direct Talk</div>
                      <div className="text-[10px] text-slate-500 truncate">Talk live on phone</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setCallMode('ai'); localStorage.setItem('nexacrm_dialer_mode', 'ai') }}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all ${
                      callMode === 'ai'
                        ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 ring-2 ring-purple-500/30'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    <Bot className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">AI Voice Agent</div>
                      <div className="text-[10px] text-slate-500 truncate">Bolna conversational AI</div>
                    </div>
                  </button>
                </div>

                {/* Destination Phone Input */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    <span>Destination Phone (To)</span>
                    {toNumber && (
                      <button
                        type="button"
                        onClick={handleClearNumber}
                        className="text-[10px] text-rose-500 hover:underline normal-case font-medium"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <PhoneInputWithCountry
                    value={toNumber}
                    onChange={setToNumber}
                    placeholder="Enter phone number..."
                    required
                  />
                </div>

                {/* Direct mode: Agent's receiving number */}
                {callMode === 'direct' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-1 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-800/50"
                  >
                    <label className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
                      Your Phone Number (Agent to Bridge)
                    </label>
                    <PhoneInputWithCountry
                      value={agentNumber}
                      onChange={setAgentNumber}
                      placeholder="Your mobile/desk number..."
                      required
                    />
                    <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400 mt-1">
                      Twilio rings your phone first, then connects to the recipient with your Twilio caller ID.
                    </p>
                  </motion.div>
                )}

                {/* AI mode: Script */}
                {callMode === 'ai' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-1"
                  >
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                      AI Conversation Greeting
                    </label>
                    <textarea
                      rows={2}
                      value={aiScript}
                      onChange={(e) => setAiScript(e.target.value)}
                      className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-purple-500/30 resize-none"
                    />
                  </motion.div>
                )}

                {/* Twilio Caller ID Selector */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    Twilio Caller ID (From)
                  </label>
                  <select
                    value={isCustomFrom ? '__custom__' : selectedFromNumber}
                    onChange={(e) => handleFromNumberChange(e.target.value)}
                    className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand-500/30"
                  >
                    {availableNumbers.length > 0 ? (
                      availableNumbers.map((num, idx) => (
                        <option key={num} value={num}>
                          {num} {idx === 0 ? '(Default Twilio Line)' : `(Line ${idx + 1})`}
                        </option>
                      ))
                    ) : (
                      <option value={selectedFromNumber || ''}>
                        {selectedFromNumber ? `${selectedFromNumber} (Configured caller)` : 'Select caller ID'}
                      </option>
                    )}
                    <option value="__custom__">+ Enter Custom Caller ID...</option>
                  </select>
                </div>

                {isCustomFrom && (
                  <div className="space-y-1">
                    <PhoneInputWithCountry
                      value={customFromNumber}
                      onChange={setCustomFromNumber}
                      placeholder="Verified Twilio caller ID"
                    />
                  </div>
                )}

                {/* Keypad Grid */}
                <div className="pt-2">
                  <div className="grid grid-cols-3 gap-2">
                    {DIAL_KEYS.map((k) => (
                      <button
                        key={k.digit}
                        type="button"
                        onClick={() => handleDigitClick(k.digit)}
                        className="py-2.5 px-3 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all text-center flex flex-col items-center justify-center border border-slate-100 dark:border-slate-700/60 shadow-sm"
                      >
                        <span className="text-base font-bold text-slate-800 dark:text-slate-100 leading-tight">
                          {k.digit}
                        </span>
                        {k.letters && (
                          <span className="text-[9px] text-slate-400 font-medium tracking-widest leading-none mt-0.5">
                            {k.letters}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Backspace & Action */}
                  <div className="flex items-center justify-between mt-3 px-2">
                    <div className="w-10" />
                    {/* Big Call Button */}
                    <button
                      type="button"
                      onClick={handleStartCall}
                      disabled={dialing || !toNumber.trim()}
                      className="px-8 py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-sm flex items-center gap-2 shadow-xl shadow-emerald-600/30 transition-all hover:scale-105 active:scale-95"
                    >
                      <PhoneCall className={`w-4 h-4 ${dialing ? 'animate-spin' : ''}`} />
                      <span>{dialing ? 'Connecting...' : callMode === 'direct' ? 'Call & Talk' : 'Start AI Call'}</span>
                    </button>

                    {/* Backspace Button */}
                    <button
                      type="button"
                      onClick={handleDeleteDigit}
                      className="p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                      title="Backspace"
                    >
                      <Delete className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
