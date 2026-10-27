import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Phone, PhoneCall, PhoneOff, Delete, User, Building2,
  Clock, CheckCircle2, ChevronDown, AlertCircle, Radio,
  Mic, MicOff, RefreshCw, Bot, Sparkles, History, HelpCircle
} from 'lucide-react'
import toast from 'react-hot-toast'
import { callsAPI } from '../services/api'
import { useAuthStore } from '../store/authStore'
import PhoneInputWithCountry from '../components/ui/PhoneInputWithCountry'

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

export default function DialerPage() {
  const { user } = useAuthStore()
  const [callMode, setCallMode] = useState(() => localStorage.getItem('nexacrm_dialer_mode') || 'direct')
  const [toNumber, setToNumber] = useState('')
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

  // Recent calls
  const [recentCalls, setRecentCalls] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(false)

  const timerRef = useRef(null)
  const pollRef = useRef(null)

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
    loadRecentCalls()
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

  // Poll active call status
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
              loadRecentCalls()
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

  const handleDigitClick = (digit) => {
    playTone(digit)
    setToNumber((prev) => prev + digit)
  }

  const handleDeleteDigit = () => {
    setToNumber((prev) => prev.slice(0, -1))
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
        localStorage.setItem('nexacrm_agent_phone', agentNumber.trim())
        if (effectiveFromNumber) localStorage.setItem('nexacrm_call_from_number', effectiveFromNumber)
        localStorage.setItem('nexacrm_dialer_mode', 'direct')

        const payload = {
          toNumber: toNumber.trim(),
          fromNumber: effectiveFromNumber,
          agentNumber: agentNumber.trim(),
          leadId: '',
          leadName: '',
        }

        const res = await callsAPI.directCall(payload)
        setCallSid(res?.callSid || '')
        setCallStatus(res?.status || 'INITIATED')
        setInCall(true)
        toast.success(res?.message || 'Call initiated! Twilio is calling your phone now.')
      } else {
        await callsAPI.directCall({
          toNumber: toNumber.trim(),
          fromNumber: effectiveFromNumber,
          agentNumber: '',
          leadId: '',
        })
        toast.success('AI Voice agent outbound call dispatched!')
      }
      setTimeout(loadRecentCalls, 2000)
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
      loadRecentCalls()
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <span>Direct Phone Dialer</span>
                <span className="text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold px-2.5 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                  Twilio 2-Way Voice
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Call anyone anywhere directly from your Twilio numbers, or trigger Bolna AI calls
              </p>
            </div>
          </div>
        </div>

        {/* Quick Twilio status badge */}
        <div className="flex items-center gap-2">
          {callOptions?.twilioConfigured ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>Twilio Telephony Active</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-xs font-semibold border border-amber-200 dark:border-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <span>Configure Twilio in Integrations</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid: Dialer on Left, Recent Calls & Info on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Keypad & Call Controls */}
        <div className="lg:col-span-5 xl:col-span-5 space-y-4">
          <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
            {/* Active Call In-Progress View */}
            {inCall ? (
              <div className="p-8 flex flex-col items-center justify-center space-y-6 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white min-h-[460px]">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center animate-pulse">
                    <PhoneCall className="w-12 h-12 text-emerald-400" />
                  </div>
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-slate-900 animate-ping" />
                </div>

                <div className="text-center space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    {callStatus || 'Connecting...'}
                  </span>
                  <h3 className="text-2xl font-bold text-white tracking-wide font-mono">
                    {toNumber}
                  </h3>
                  <p className="text-4xl font-mono font-bold text-slate-100 pt-3">
                    {formatDuration(callDuration)}
                  </p>
                </div>

                <div className="bg-slate-800/80 rounded-2xl p-4 w-full border border-slate-700 text-xs text-slate-300 space-y-2">
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
                    className="px-8 py-3.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm flex items-center gap-2 shadow-xl shadow-rose-600/30 transition-all hover:scale-105 active:scale-95"
                  >
                    <PhoneOff className="w-5 h-5" />
                    <span>End Call</span>
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleStartCall} className="p-6 space-y-4">
                {/* Mode Selector */}
                <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => { setCallMode('direct'); localStorage.setItem('nexacrm_dialer_mode', 'direct') }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      callMode === 'direct'
                        ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Direct Talk (2-Way)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setCallMode('ai'); localStorage.setItem('nexacrm_dialer_mode', 'ai') }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      callMode === 'ai'
                        ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>AI Voice Agent</span>
                  </button>
                </div>

                {/* Recipient Phone Input */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    <span>1. Destination Phone (To)</span>
                    {toNumber && (
                      <button
                        type="button"
                        onClick={() => setToNumber('')}
                        className="text-[11px] text-rose-500 hover:underline normal-case font-medium"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <PhoneInputWithCountry
                    value={toNumber}
                    onChange={setToNumber}
                    placeholder="Enter recipient phone..."
                    required
                  />
                </div>

                {/* Direct Talk Bridge: Agent Phone Number */}
                {callMode === 'direct' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="p-3.5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/50 space-y-1.5"
                  >
                    <label className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
                      2. Your Phone (Agent Receiving Line)
                    </label>
                    <PhoneInputWithCountry
                      value={agentNumber}
                      onChange={setAgentNumber}
                      placeholder="Your mobile/desk phone..."
                      required
                    />
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                      Twilio calls your phone first, then connects to recipient showing your Twilio number.
                    </p>
                  </motion.div>
                )}

                {/* Twilio Caller ID (From) */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                    {callMode === 'direct' ? '3.' : '2.'} Twilio Caller ID (From)
                  </label>
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
                        {selectedFromNumber ? `${selectedFromNumber} (Configured caller)` : 'Select caller ID'}
                      </option>
                    )}
                    <option value="__custom__">+ Enter Custom Caller ID...</option>
                  </select>
                </div>

                {isCustomFrom && (
                  <PhoneInputWithCountry
                    value={customFromNumber}
                    onChange={setCustomFromNumber}
                    placeholder="Verified Twilio caller ID"
                  />
                )}

                {/* Keypad Grid */}
                <div className="pt-2">
                  <div className="grid grid-cols-3 gap-2">
                    {DIAL_KEYS.map((k) => (
                      <button
                        key={k.digit}
                        type="button"
                        onClick={() => handleDigitClick(k.digit)}
                        className="py-3 px-4 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-all text-center flex flex-col items-center justify-center border border-slate-100 dark:border-slate-700/60 shadow-sm"
                      >
                        <span className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight">
                          {k.digit}
                        </span>
                        {k.letters && (
                          <span className="text-[10px] text-slate-400 font-medium tracking-widest leading-none mt-0.5">
                            {k.letters}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Actions & Call Button */}
                  <div className="flex items-center justify-between mt-4 px-2">
                    <div className="w-10" />
                    <button
                      type="submit"
                      disabled={dialing || !toNumber.trim() || (callMode === 'direct' && !agentNumber.trim())}
                      className="px-8 py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-sm flex items-center gap-2 shadow-xl shadow-emerald-600/30 transition-all hover:scale-105 active:scale-95"
                    >
                      <PhoneCall className={`w-4 h-4 ${dialing ? 'animate-spin' : ''}`} />
                      <span>{dialing ? 'Connecting...' : callMode === 'direct' ? 'Call & Talk Directly' : 'Place AI Call'}</span>
                    </button>

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
              </form>
            )}
          </div>
        </div>

        {/* Right: Recent Calls Log + Guide */}
        <div className="lg:col-span-7 xl:col-span-7 space-y-6">
          {/* Quick Guide Card */}
          <div className="rounded-3xl border border-emerald-200/80 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50/50 via-white to-slate-50 dark:from-emerald-950/20 dark:via-slate-900 dark:to-slate-900 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>How Direct Twilio Calling Works</span>
            </h3>
            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 list-disc list-inside">
              <li><strong>Zero WebRTC headache:</strong> No browser microphone permissions or headset issues.</li>
              <li><strong>Crystal Clear Voice:</strong> Twilio rings your mobile or desk phone first.</li>
              <li><strong>Official Twilio Caller ID:</strong> When you answer, Twilio dials the customer showing your office Twilio number.</li>
              <li><strong>Call Recording & Logs:</strong> Every call duration and status is automatically recorded in your CRM activity logs.</li>
            </ul>
          </div>

          {/* Recent Call Records */}
          <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Recent Call History
                </h3>
              </div>
              <button
                type="button"
                onClick={loadRecentCalls}
                disabled={loadingRecent}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
                title="Refresh history"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRecent ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingRecent ? (
              <div className="py-12 text-center text-xs text-slate-400">Loading call records...</div>
            ) : recentCalls.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No outbound calls recorded yet. Make your first call with the dialer!
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[480px] overflow-y-auto custom-scrollbar">
                {recentCalls.map((rc, idx) => (
                  <div
                    key={rc.id || idx}
                    className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 flex items-center justify-between text-xs transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 mt-0.5">
                        <Phone className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">
                          <span>{rc.contactIdentifier || rc.recipient || 'Call'}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            rc.status === 'COMPLETED' || rc.status === 'SUCCESS'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                              : rc.status === 'FAILED'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                          }`}>
                            {rc.status || 'CALL'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {rc.contactName ? `${rc.contactName} · ` : ''}{rc.body || 'Outbound call'}
                        </p>
                        <span className="text-[10px] text-slate-400 mt-1 block">
                          {rc.createdAt ? new Date(rc.createdAt).toLocaleString() : ''}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setToNumber(rc.contactIdentifier || rc.recipient || '')
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 font-semibold flex items-center gap-1.5 transition-colors flex-shrink-0"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>Redial</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
