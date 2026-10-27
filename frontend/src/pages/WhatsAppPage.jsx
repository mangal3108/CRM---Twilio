import { useState, useEffect, useRef } from 'react'
import {
  MessageCircle, Send, RefreshCw, QrCode, CheckCircle2, AlertCircle,
  Phone, User, Search, Plus, ExternalLink, ShieldCheck, Clock,
  Smartphone, Sparkles, X, ChevronRight, Check, ArrowRight
} from 'lucide-react'
import toast from 'react-hot-toast'
import { commsAPI, openwaAPI, leadsAPI } from '../services/api'
import PhoneInputWithCountry from '../components/ui/PhoneInputWithCountry'
import {
  KRISCEL_WHATSAPP_WELCOME_MESSAGE,
  KRISCEL_WHATSAPP_FOLLOW_UP_MESSAGE,
  KRISCEL_WHATSAPP_PROPOSAL_MESSAGE,
  KRISCEL_WHATSAPP_THANK_YOU_MESSAGE,
} from '../utils/whatsappTemplates'

const QUICK_TEMPLATES = [
  { label: '🚀 Welcome Message', text: KRISCEL_WHATSAPP_WELCOME_MESSAGE },
  { label: '📅 Follow Up', text: KRISCEL_WHATSAPP_FOLLOW_UP_MESSAGE },
  { label: '💼 Business Proposal', text: KRISCEL_WHATSAPP_PROPOSAL_MESSAGE },
  { label: '🙏 Thank You', text: KRISCEL_WHATSAPP_THANK_YOU_MESSAGE },
]

export default function WhatsAppPage() {
  const [gatewayStatus, setGatewayStatus] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [conversations, setConversations] = useState([])
  const [selectedContact, setSelectedContact] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [sending, setSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // QR Modal
  const [showQRModal, setShowQRModal] = useState(false)
  const [qrData, setQrData] = useState(null)
  const [loadingQR, setLoadingQR] = useState(false)

  // New Chat Modal
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [newChatNumber, setNewChatNumber] = useState('')
  const [newChatMsg, setNewChatMsg] = useState('')
  const [startingChat, setStartingChat] = useState(false)

  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Load gateway status & conversations
  const fetchStatus = async (silent = false) => {
    if (!silent) setLoadingStatus(true)
    try {
      const res = await openwaAPI.getStatus()
      setGatewayStatus(res.data)
      return res.data
    } catch (err) {
      setGatewayStatus({
        gatewayOnline: false,
        connected: false,
        status: 'offline',
        message: err?.response?.data?.message || err?.message || 'Gateway unreachable',
      })
      return null
    } finally {
      if (!silent) setLoadingStatus(false)
    }
  }

  const fetchConversations = async () => {
    try {
      const res = await openwaAPI.getConversations()
      const list = Array.isArray(res.data) ? res.data : []
      setConversations(list)
      if (list.length > 0 && !selectedContact && statusStr !== 'qr_ready') {
        setSelectedContact(list[0].contact)
      }
    } catch (err) {
      console.error('Failed to load conversations:', err)
    }
  }

  const fetchMessages = async (contact) => {
    if (!contact) return
    setLoadingMessages(true)
    try {
      const res = await openwaAPI.getMessages(contact)
      const list = Array.isArray(res.data) ? res.data : []
      setMessages(list)
    } catch (err) {
      console.error('Failed to load messages for', contact, err)
    } finally {
      setLoadingMessages(false)
    }
  }

  const statusStr = (gatewayStatus?.status || 'offline').toLowerCase()
  const isConnected = Boolean(gatewayStatus?.connected)

  // Polling status and messages
  useEffect(() => {
    fetchStatus()
    fetchConversations()

    const interval = setInterval(() => {
      fetchStatus(true)
      if (selectedContact) fetchMessages(selectedContact)
    }, 4000)

    return () => clearInterval(interval)
  }, [selectedContact])

  // Auto-fetch QR if status is qr_ready
  useEffect(() => {
    if (statusStr === 'qr_ready' && !qrData) {
      openwaAPI.getQR().then(res => {
        if (res.data?.qrCode) setQrData(res.data.qrCode)
      }).catch(() => {})
    }
  }, [statusStr, qrData])

  useEffect(() => {
    if (selectedContact) {
      fetchMessages(selectedContact)
    }
  }, [selectedContact])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Handle QR fetch
  const handleOpenQR = async () => {
    setShowQRModal(true)
    setLoadingQR(true)
    try {
      const res = await openwaAPI.getQR()
      if (res.data && res.data.qrCode) {
        setQrData(res.data.qrCode)
      } else {
        const startRes = await openwaAPI.startSession('nexacrm-session')
        const qrRes = await openwaAPI.getQR(startRes.data?.sessionId)
        setQrData(qrRes.data?.qrCode || null)
      }
    } catch (err) {
      toast.error('Could not fetch QR code: ' + (err?.response?.data?.message || err.message))
    } finally {
      setLoadingQR(false)
    }
  }

  // Handle Start Session
  const handleStartSession = async () => {
    try {
      toast.loading('Starting OpenWA session...', { id: 'start-session' })
      const res = await openwaAPI.startSession('nexacrm-session')
      toast.success('Session started! Fetching QR code...', { id: 'start-session' })
      await fetchStatus()
      handleOpenQR()
    } catch (err) {
      toast.error('Failed to start session: ' + (err?.response?.data?.message || err.message), { id: 'start-session' })
    }
  }

  // Handle Send Message
  const handleSendMessage = async (e) => {
    e?.preventDefault()
    if (!messageText.trim() || !selectedContact) return
    const textToSend = messageText.trim()
    setSending(true)

    const tempMsg = {
      id: 'temp-' + Date.now(),
      contactIdentifier: selectedContact,
      direction: 'OUT',
      body: textToSend,
      createdAt: new Date().toISOString(),
      status: 'SENDING',
    }
    setMessages(prev => [...prev, tempMsg])
    setMessageText('')

    try {
      await openwaAPI.sendMessage(selectedContact, textToSend)
      toast.success('WhatsApp message sent!')
      fetchMessages(selectedContact)
      fetchConversations()
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to send WhatsApp message')
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
      setMessageText(textToSend)
    } finally {
      setSending(false)
    }
  }

  // Handle New Chat Start
  const handleStartNewChat = async (e) => {
    e?.preventDefault()
    const clean = newChatNumber.replace(/\D/g, '')
    if (!clean) {
      toast.error('Please enter a valid phone number')
      return
    }
    if (!newChatMsg.trim()) {
      toast.error('Please enter a message to initiate the conversation')
      return
    }

    setStartingChat(true)
    try {
      await openwaAPI.sendMessage(clean, newChatMsg.trim())
      toast.success(`WhatsApp message sent to ${clean}!`)
      setShowNewChatModal(false)
      setNewChatNumber('')
      setNewChatMsg('')
      setSelectedContact(clean)
      fetchConversations()
      fetchMessages(clean)
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to start conversation')
    } finally {
      setStartingChat(false)
    }
  }

  // Filter conversations
  const filteredConversations = conversations.filter(c => {
    const q = searchQuery.toLowerCase()
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.contact && c.contact.includes(q)) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Top Banner & Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
            <MessageCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">WhatsApp Console</h1>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                OpenWA Gateway
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Direct OpenWA integration for instant messaging, templates, and automated workflows
            </p>
          </div>
        </div>

        {/* Status Pill & Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {loadingStatus ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Checking gateway...
            </div>
          ) : isConnected ? (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected (OpenWA Ready)
            </div>
          ) : statusStr === 'qr_ready' ? (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              QR Ready to Scan
            </div>
          ) : statusStr === 'offline' ? (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs font-semibold">
              <AlertCircle className="w-3.5 h-3.5" />
              Gateway Offline (:2785)
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              Status: {statusStr}
            </div>
          )}

          <button
            onClick={() => {
              fetchStatus()
              fetchConversations()
              toast.success('Status refreshed!')
            }}
            title="Refresh status"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>

          <button
            onClick={() => handleOpenQR()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition"
          >
            <QrCode className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Scan QR
          </button>

          <button
            onClick={handleStartSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-sm transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {isConnected ? 'Restart Session' : 'Start Session'}
          </button>
        </div>
      </div>

      {/* Main Chat Interface */}
      <div className="flex-1 min-h-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-12">
        {/* Left: Contacts / Conversations List */}
        <div className="md:col-span-4 lg:col-span-3 border-r border-slate-200 dark:border-slate-800 flex flex-col h-full bg-slate-50/50 dark:bg-slate-900/50">
          {/* Search & New Chat */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <button
              onClick={() => setShowNewChatModal(true)}
              title="New Chat"
              className="p-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No WhatsApp conversations yet.</p>
                <button
                  onClick={() => setShowNewChatModal(true)}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-medium text-xs hover:bg-emerald-100 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Start First Chat
                </button>
              </div>
            ) : (
              filteredConversations.map((c) => {
                const active = selectedContact === c.contact
                return (
                  <button
                    key={c.contact}
                    onClick={() => setSelectedContact(c.contact)}
                    className={`w-full text-left p-3 flex items-start gap-3 transition ${
                      active
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-l-4 border-emerald-500'
                        : 'hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-xs flex-shrink-0">
                      {c.name ? c.name.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {c.name || c.contact}
                        </span>
                        {c.lastMessageTime && (
                          <span className="text-[10px] text-slate-400 flex-shrink-0">
                            {new Date(c.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {c.lastMessage || 'No recent messages'}
                      </p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Active Chat View OR QR Code Display */}
        <div className="md:col-span-8 lg:col-span-9 flex flex-col h-full bg-white dark:bg-slate-900">
          {selectedContact ? (
            <>
              {/* Chat Header */}
              <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/40 dark:bg-slate-900/40">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-xs">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {selectedContact}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      OpenWA Active Thread
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={`https://wa.me/${selectedContact.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    <ExternalLink className="w-3 h-3" /> WhatsApp Web
                  </a>
                </div>
              </div>

              {/* Messages Thread */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/20 dark:bg-slate-950/20">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading message history...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs">
                    <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No messages yet in this conversation. Send a message below to start chatting!
                  </div>
                ) : (
                  messages.map((m) => {
                    const isOut = m.direction === 'OUT' || m.fromMe
                    return (
                      <div
                        key={m.id || m.createdAt}
                        className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
                            isOut
                              ? 'bg-emerald-600 text-white rounded-br-none'
                              : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none'
                          }`}
                        >
                          <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                          <div
                            className={`flex items-center justify-end gap-1 mt-1 text-[9px] ${
                              isOut ? 'text-emerald-100' : 'text-slate-400'
                            }`}
                          >
                            <span>
                              {m.createdAt
                                ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : ''}
                            </span>
                            {isOut && <Check className="w-2.5 h-2.5 inline" />}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Templates Bar */}
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-1.5 overflow-x-auto text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-shrink-0 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" /> Templates:
                </span>
                {QUICK_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.label}
                    onClick={() => setMessageText(tmpl.text)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-slate-700 dark:text-slate-300 text-[11px] transition shadow-xs"
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>

              {/* Message Composer */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-end gap-2">
                <textarea
                  rows={2}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  placeholder="Type a WhatsApp message (Enter to send, Shift+Enter for new line)..."
                  className="flex-1 p-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={sending || !messageText.trim()}
                  className="px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition flex-shrink-0"
                >
                  {sending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send
                    </>
                  )}
                </button>
              </form>
            </>
          ) : statusStr === 'qr_ready' ? (
            /* Direct In-page QR Display when QR is ready */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/40 dark:bg-slate-950/20">
              <div className="p-4 bg-white rounded-3xl border-2 border-emerald-500 shadow-xl mb-4">
                {qrData ? (
                  <img src={qrData} alt="WhatsApp QR Code" className="w-64 h-64 object-contain" />
                ) : (
                  <div className="w-64 h-64 flex flex-col items-center justify-center text-xs text-slate-500 gap-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                    Fetching QR Code...
                  </div>
                )}
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                <QrCode className="w-5 h-5 text-emerald-600" /> Scan with WhatsApp to Connect
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-3">
                Open WhatsApp on your phone, navigate to Linked Devices, and scan this code to link your account.
              </p>
              <div className="max-w-md text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-1 text-left">
                <p>1. Open WhatsApp on your phone</p>
                <p>2. Tap <strong>Settings</strong> or <strong>⋮ Menu</strong> &gt; <strong>Linked Devices</strong></p>
                <p>3. Tap <strong>Link a Device</strong> and point your camera at this QR code</p>
              </div>
              <button
                onClick={() => {
                  setQrData(null)
                  openwaAPI.getQR().then(res => {
                    if (res.data?.qrCode) setQrData(res.data.qrCode)
                  })
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-xs text-emerald-600 font-semibold hover:underline"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh QR Code
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4 shadow-sm">
                <MessageCircle className="w-8 h-8" />
              </div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-1">
                Select a conversation
              </h3>
              <p className="text-xs max-w-sm text-slate-500 dark:text-slate-400 mb-4">
                Pick a chat from the left or click 'Start New Chat' to send a direct WhatsApp message to any phone number.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNewChatModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-sm transition"
                >
                  <Plus className="w-4 h-4" /> Start New Chat
                </button>
                <button
                  onClick={handleOpenQR}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition"
                >
                  <QrCode className="w-4 h-4 text-emerald-600" /> Pair Phone (QR)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* QR Code Scanner Modal */}
      {showQRModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <QrCode className="w-4 h-4 text-emerald-600" />
                Scan WhatsApp QR Code
              </div>
              <button onClick={() => setShowQRModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-5 flex flex-col items-center text-center">
              {loadingQR ? (
                <div className="py-12 flex flex-col items-center gap-2 text-xs text-slate-500">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                  Generating fresh OpenWA QR code...
                </div>
              ) : qrData ? (
                <div className="p-3 bg-white rounded-2xl border-2 border-emerald-500 shadow-md">
                  <img src={qrData} alt="WhatsApp QR Code" className="w-56 h-56 object-contain" />
                </div>
              ) : (
                <div className="py-8 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-500 max-w-xs">
                  <AlertCircle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                  {isConnected
                    ? 'Session is already connected! You are authenticated.'
                    : 'QR Code not yet ready. Click "Start Session" to spin up the OpenWA session engine.'}
                </div>
              )}

              {/* Instructions */}
              <div className="mt-5 w-full text-left text-xs bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5 text-slate-600 dark:text-slate-300">
                <p className="font-semibold text-slate-900 dark:text-slate-100 text-[11px] uppercase tracking-wider">
                  How to link your WhatsApp:
                </p>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-emerald-600">1.</span>
                  <span>Open WhatsApp on your mobile phone</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-emerald-600">2.</span>
                  <span>Tap <strong>Settings</strong> or <strong>⋮ Menu</strong> &gt; <strong>Linked Devices</strong></span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-emerald-600">3.</span>
                  <span>Tap <strong>Link a Device</strong> and point your camera at the QR code above</span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between w-full">
                <button
                  onClick={handleOpenQR}
                  className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh QR
                </button>
                <button
                  onClick={() => {
                    setShowQRModal(false)
                    fetchStatus()
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <Plus className="w-4 h-4 text-emerald-600" />
                Start New WhatsApp Chat
              </div>
              <button onClick={() => setShowNewChatModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleStartNewChat} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Recipient Phone Number (with Country Code)
                </label>
                <PhoneInputWithCountry
                  value={newChatNumber}
                  onChange={setNewChatNumber}
                  placeholder="Enter recipient phone"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Initial Message
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setNewChatMsg(KRISCEL_WHATSAPP_WELCOME_MESSAGE)}
                      className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      Fill Welcome
                    </button>
                  </div>
                </div>
                <textarea
                  rows={4}
                  value={newChatMsg}
                  onChange={(e) => setNewChatMsg(e.target.value)}
                  placeholder="Type your message here..."
                  className="w-full p-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(false)}
                  className="px-3 py-2 rounded-xl text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={startingChat || !newChatNumber || !newChatMsg.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition"
                >
                  {startingChat ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" /> Start Chat
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
