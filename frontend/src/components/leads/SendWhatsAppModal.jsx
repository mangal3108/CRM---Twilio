import { useState } from 'react'
import { MessageCircle, Send, ExternalLink, X, Sparkles, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import PhoneInputWithCountry from '../ui/PhoneInputWithCountry'
import { openwaAPI } from '../../services/api'
import {
  KRISCEL_WHATSAPP_WELCOME_MESSAGE,
  KRISCEL_WHATSAPP_FOLLOW_UP_MESSAGE,
  KRISCEL_WHATSAPP_PROPOSAL_MESSAGE,
  KRISCEL_WHATSAPP_THANK_YOU_MESSAGE,
} from '../../utils/whatsappTemplates'

const TEMPLATES = [
  { label: '🚀 Welcome', text: KRISCEL_WHATSAPP_WELCOME_MESSAGE },
  { label: '📅 Follow Up', text: KRISCEL_WHATSAPP_FOLLOW_UP_MESSAGE },
  { label: '💼 Proposal', text: KRISCEL_WHATSAPP_PROPOSAL_MESSAGE },
  { label: '🙏 Thank You', text: KRISCEL_WHATSAPP_THANK_YOU_MESSAGE },
]

export default function SendWhatsAppModal({ lead, onClose, onSent }) {
  const [phone, setPhone] = useState(lead?.phone || lead?.contact || '')
  const [message, setMessage] = useState(
    (KRISCEL_WHATSAPP_WELCOME_MESSAGE || '').replace('{name}', lead?.name || 'there')
  )
  const [sending, setSending] = useState(false)
  const [sendMode, setSendMode] = useState('openwa') // 'openwa' | 'web'

  const handleSend = async (e) => {
    e?.preventDefault()
    const clean = phone.replace(/\D/g, '')
    if (!clean) {
      toast.error('Please enter a valid phone number')
      return
    }
    if (!message.trim()) {
      toast.error('Please enter a message')
      return
    }

    if (sendMode === 'web') {
      const url = `https://wa.me/${clean}?text=${encodeURIComponent(message.trim())}`
      window.open(url, '_blank')
      toast.success('Opened in WhatsApp Web')
      onClose?.()
      return
    }

    setSending(true)
    try {
      await openwaAPI.sendMessage(clean, message.trim())
      toast.success(`WhatsApp message sent to ${lead?.name || clean} via OpenWA!`)
      onSent?.()
      onClose?.()
    } catch (err) {
      const errMsg = err?.response?.data?.message || err?.message || 'Failed to send WhatsApp message via OpenWA.'
      toast.error(errMsg)
    } finally {
      setSending(false)
    }
  }

  const applyTemplate = (templateText) => {
    const personalized = templateText.replace('{name}', lead?.name || 'there')
    setMessage(personalized)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-emerald-50/50 dark:bg-emerald-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-sm">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Send WhatsApp Message
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lead?.name ? `Messaging ${lead.name}` : 'Send message via OpenWA or WhatsApp Web'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSend} className="p-6 space-y-4">
          {/* Method Choice */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
              Sending Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSendMode('openwa')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl text-xs font-medium border transition ${
                  sendMode === 'openwa'
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                OpenWA Gateway (Direct)
              </button>
              <button
                type="button"
                onClick={() => setSendMode('web')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl text-xs font-medium border transition ${
                  sendMode === 'web'
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <ExternalLink className="w-4 h-4 text-emerald-500" />
                WhatsApp Web
              </button>
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Recipient Phone Number
            </label>
            <PhoneInputWithCountry
              value={phone}
              onChange={setPhone}
              placeholder="Enter phone with country code"
            />
          </div>

          {/* Quick Templates */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Quick Templates
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.label}
                  type="button"
                  onClick={() => applyTemplate(tmpl.text)}
                  className="px-2.5 py-1 text-[11px] rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition"
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message Text */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Message Text
            </label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your WhatsApp message..."
              className="w-full p-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || !phone}
              className="px-5 py-2.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-1.5 shadow-sm transition"
            >
              {sending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Sending via OpenWA...
                </>
              ) : sendMode === 'web' ? (
                <>
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in WhatsApp Web
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Send Message
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
