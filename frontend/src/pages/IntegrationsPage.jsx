import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, CheckCircle2, ExternalLink, Copy, Eye, EyeOff,
  RefreshCw, Zap, Link2, Shield, Linkedin, Sheet, PhoneCall, Sparkles, Database
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useIntegrationsStore } from '../store/integrationsStore'
import ScreenModalPortal from '../components/ui/ScreenModalPortal'

const INTEGRATIONS = [
  {
    id: 'facebook', name: 'Facebook', category: 'Social Media',
    tagline: 'Capture leads from Facebook Pages & Ads',
    description: 'Connect your Facebook Business account to automatically import leads from Lead Ads, Messenger conversations, and Page interactions into NexaCRM.',
    features: ['Lead Ads sync', 'Messenger inbox', 'Page comments', 'Ad campaign tracking'],
    color: '#1877F2', bg: '#EBF3FF',
    authType: 'oauth', oauthProvider: 'Meta',
    docsUrl: 'https://developers.facebook.com/docs/marketing-api/leads',
    fields: [
      { key: 'pageId',      label: 'Facebook Page ID',        placeholder: '123456789012345', hint: 'Found in Page Settings → About' },
      { key: 'accessToken', label: 'Page Access Token',        placeholder: 'EAABsbCS...', secret: true },
      { key: 'adAccountId', label: 'Ad Account ID (optional)', placeholder: 'act_123456789' },
    ],
    Icon: () => <svg viewBox="0 0 24 24" fill="#1877F2" className="w-7 h-7"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>,
  },
  {
    id: 'instagram', name: 'Instagram', category: 'Social Media',
    tagline: 'Sync DMs and leads from Instagram Business',
    description: 'Link your Instagram Business account to receive DMs, capture story mentions, and sync Instagram Lead Ads into your CRM pipeline automatically.',
    features: ['DM inbox sync', 'Lead Ads import', 'Story mentions', 'Comment management'],
    color: '#E1306C', bg: '#FFF0F5',
    authType: 'oauth', oauthProvider: 'Meta',
    docsUrl: 'https://developers.facebook.com/docs/instagram-api',
    fields: [
      { key: 'igAccountId', label: 'Instagram Account ID', placeholder: '17841400000000000', hint: 'Linked via Facebook Business Manager' },
      { key: 'accessToken', label: 'Page Access Token',    placeholder: 'EAABsbCS...', secret: true },
    ],
    Icon: () => <svg viewBox="0 0 24 24" className="w-7 h-7"><defs><linearGradient id="igG" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f09433"/><stop offset="25%" stopColor="#e6683c"/><stop offset="50%" stopColor="#dc2743"/><stop offset="75%" stopColor="#cc2366"/><stop offset="100%" stopColor="#bc1888"/></linearGradient></defs><path fill="url(#igG)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>,
  },
  {
    id: 'linkedin', name: 'LinkedIn', category: 'Social Media',
    tagline: 'Capture B2B leads from LinkedIn conversations',
    description: 'Connect LinkedIn to sync direct messages, lead forms, and profile engagement into your CRM pipeline for B2B follow-up workflows.',
    features: ['Inbox sync', 'Lead Gen Forms', 'Profile engagement', 'B2B follow-up automation'],
    color: '#0A66C2', bg: '#EDF5FF',
    authType: 'oauth', oauthProvider: 'LinkedIn',
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/',
    fields: [
      { key: 'clientId', label: 'LinkedIn Client ID', placeholder: '86xxxxxx' },
      { key: 'clientSecret', label: 'LinkedIn Client Secret', placeholder: 'xxxxxxxx', secret: true },
    ],
    Icon: Linkedin,
  },
  {
    id: 'reddit', name: 'Reddit', category: 'Social Media',
    tagline: 'Track subreddit discussions and capture intent signals',
    description: 'Connect Reddit API credentials to monitor selected subreddits, capture buying-intent conversations, and turn high-signal threads into actionable CRM follow-up tasks.',
    features: ['Subreddit monitoring', 'Keyword tracking', 'Intent signals', 'Lead research workflow'],
    color: '#FF4500', bg: '#FFF2EC',
    authType: 'oauth', oauthProvider: 'Reddit',
    docsUrl: 'https://www.reddit.com/prefs/apps',
    defaultValues: {
      userAgent: 'NexaCRM/1.0 by u/your_username',
      subredditKeywords: 'crm,sales,lead generation'
    },
    fields: [
      { key: 'clientId', label: 'Reddit Client ID', placeholder: 'abc123xyz', hint: 'Create a script app at reddit.com/prefs/apps' },
      { key: 'clientSecret', label: 'Reddit Client Secret', placeholder: 'xxxxxxxxxxxx', secret: true },
      { key: 'refreshToken', label: 'Refresh Token', placeholder: '1234567890_refresh_token', secret: true },
      { key: 'username', label: 'Reddit Username', placeholder: 'your_username' },
      { key: 'userAgent', label: 'User Agent (optional)', placeholder: 'NexaCRM/1.0 by u/your_username' },
      { key: 'subredditKeywords', label: 'Subreddit Keywords (optional)', placeholder: 'crm,sales,saas,startups' },
    ],
    Icon: () => <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7"><circle cx="12" cy="12" r="10" fill="#FF4500"/><path d="M16.58 14.38c.07.32.11.64.11.97 0 2.1-2.1 3.8-4.69 3.8-2.59 0-4.69-1.7-4.69-3.8 0-.33.04-.65.12-.97a1.5 1.5 0 1 1 .97-2.28 6.15 6.15 0 0 1 3.6-1.16c1.34 0 2.59.44 3.6 1.16a1.5 1.5 0 1 1 .98 2.28Z" fill="white"/><circle cx="10.14" cy="14.07" r=".9" fill="#FF4500"/><circle cx="13.86" cy="14.07" r=".9" fill="#FF4500"/><path d="M10.2 16.18c.43.34 1.03.54 1.8.54.77 0 1.37-.2 1.8-.54" stroke="#FF4500" strokeWidth="1.1" strokeLinecap="round"/><path d="m14.97 9.74.6-2.08 1.8.42" stroke="white" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  },
  {
    id: 'whatsapp', name: 'WhatsApp Business', category: 'Messaging',
    tagline: 'Send WhatsApp messages via AKNexus',
    description: 'Connect your AKNexus WhatsApp instance to send messages directly from NexaCRM, workflows, lead automation, and the communication inbox.',
    features: ['AKNexus API sending', 'Workflow WhatsApp actions', 'Lead auto-welcome messages', 'Legacy provider support'],
    color: '#25D366', bg: '#F0FFF4',
    authType: 'apikey',
    docsUrl: 'https://app.aknexus.in/api_automation/docs',
    defaultValues: {
      provider: 'aknexus',
      apiUrl: 'https://app.aknexus.in/api/v2',
      instanceId: '6A9FAD7115E71',
      senderNumber: '919971364324',
    },
    fields: [
      { key: 'provider',     label: 'Provider',                          placeholder: 'aknexus', hint: 'Use aknexus for app.aknexus.in; legacy values kriscelwa and aiadrika still work.' },
      { key: 'apiUrl',       label: 'API Base URL',                      placeholder: 'https://app.aknexus.in/api/v2', hint: 'AKNexus API base URL from API & Automation docs.' },
      { key: 'apiToken',     label: 'AKNexus API Token',                 placeholder: 'wz_...', secret: true, hint: 'Create in AKNexus → API & Automation → Tokens.' },
      { key: 'instanceId',   label: 'AKNexus Instance ID',               placeholder: '6A9FAD7115E71', hint: 'From AKNexus /api/v2/whatsapp/instances.' },
      { key: 'senderNumber', label: 'Default Sender Number (optional)',  placeholder: '919971364324' },
      { key: 'apiKey',       label: 'Legacy Kriscel WA API Key',         placeholder: 'owa_k1_...', secret: true, hint: 'Only for provider=kriscelwa.' },
      { key: 'sessionId',    label: 'Legacy Kriscel WA Session ID',      placeholder: 'my-crm-session', hint: 'Only for provider=kriscelwa.' },
      { key: 'accessToken',  label: 'Legacy Aiadrika Access Token',      placeholder: 'token...', secret: true, hint: 'Only for provider=aiadrika.' },
    ],
    Icon: () => <svg viewBox="0 0 24 24" fill="#25D366" className="w-7 h-7"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
  },
  {
    id: 'voice_call_agent', name: 'Voice Call Agent', category: 'Messaging',
    tagline: 'AI voice calls using Bolna (with Twilio telephony) or custom webhooks',
    description: 'Run outbound AI calls with Bolna directly from NexaCRM with Twilio telephony integration, or keep using any webhook-based calling agent.',
    features: ['Bolna + Twilio AI calls', 'Choose caller phone numbers', 'Auto-call on lead create', 'Transcripts & Call Intelligence'],
    color: '#7C3AED', bg: '#F5F1FF',
    authType: 'apikey',
    docsUrl: 'https://www.bolna.ai/docs/api-reference/calls/make',
    defaultValues: {
      enabled: 'true',
      autoCallOnLeadCreate: 'true',
      provider: 'bolna_twilio',
      bolnaApiUrl: 'https://api.bolna.ai',
    },
    fields: [
      { key: 'provider', label: 'Provider Setup (bolna_twilio, bolna, twilio, webhook)', placeholder: 'bolna_twilio', hint: 'Options: bolna_twilio (Bolna AI with Twilio), bolna (Bolna default), twilio (Direct Twilio), webhook' },
      { key: 'bolnaApiUrl', label: 'Bolna API URL', placeholder: 'https://api.bolna.ai', hint: 'Defaults to https://api.bolna.ai' },
      { key: 'bolnaApiKey', label: 'Bolna API Key', placeholder: 'sk_live_...', secret: true },
      { key: 'bolnaAgentId', label: 'Bolna Agent ID', placeholder: '123e4567-e89b-12d3-a456-426655440000' },
      { key: 'bolnaVoiceId', label: 'Bolna Voice ID (optional)', placeholder: 'Sam', hint: 'Overrides default agent voice for this call' },
      { key: 'twilioAccountSid', label: 'Twilio Account SID (for Twilio/Bolna)', placeholder: 'AC...', hint: 'Optional if configured in Twilio integration' },
      { key: 'twilioAuthToken', label: 'Twilio Auth Token (for Twilio/Bolna)', placeholder: '...', secret: true, hint: 'Optional if configured in Twilio integration' },
      { key: 'twilioFromNumber', label: 'Twilio Caller Number (From)', placeholder: '+12055551234', hint: 'Twilio phone number to call leads from' },
      { key: 'twilioPhoneNumbers', label: 'Selectable Twilio Phone Numbers', placeholder: '+12055551234, +12055559876', hint: 'Comma-separated caller phone numbers selectable during lead calls' },
      { key: 'callbackWebhookUrl', label: 'Callback Webhook URL (optional)', placeholder: 'https://your-backend.example.com/api/calls/webhook', hint: 'Where the AI worker should POST call outcomes' },
      { key: 'webhookUrl', label: 'Webhook URL (for provider=webhook)', placeholder: 'https://your-agent.example.com/outbound-call' },
      { key: 'apiKey', label: 'Provider API Key (optional)', placeholder: 'sk_live_...', secret: true },
      { key: 'webhookSecret', label: 'Webhook Secret (optional)', placeholder: 'super-secret', secret: true },
      { key: 'agentId', label: 'Agent ID (optional)', placeholder: 'agent_123' },
      { key: 'fromNumber', label: 'Caller Number (optional)', placeholder: '+911234567890', hint: 'Caller ID when placed' },
      { key: 'enabled', label: 'Enabled (optional, true/false)', placeholder: 'true' },
      { key: 'autoCallOnLeadCreate', label: 'Auto Call On New Lead (optional, true/false)', placeholder: 'true' },
      { key: 'autoAssignHotLead', label: 'Auto Assign Hot Lead (optional, true/false)', placeholder: 'true' },
      { key: 'adminNotificationPhone', label: 'Admin WhatsApp Numbers for Notifications (up to 5)', placeholder: '918985419420, 919876543210', hint: 'Comma-separated WhatsApp numbers (up to 5)' },
      { key: 'agentName', label: 'Agent Name (optional)', placeholder: 'Riya from NexaCRM' },
      { key: 'scriptTemplate', label: 'Call Script Template (optional)', placeholder: 'Hi {leadName}, this is {agentName}...' },
    ],
    Icon: PhoneCall,
  },
  {
    id: 'twilio', name: 'Twilio Telephony', category: 'Messaging',
    tagline: 'Twilio phone lines & telephony for Bolna AI & Direct calls',
    description: 'Connect your Twilio Account SID, Auth Token, and caller phone numbers. Works directly with Bolna AI voice agents to place real phone calls to leads and receive call updates.',
    features: ['Bolna AI + Twilio telephony', 'Choose caller phone numbers', 'Twilio direct outbound calls', 'Call status callbacks'],
    color: '#F22F46', bg: '#FFF1F2',
    authType: 'apikey',
    docsUrl: 'https://www.twilio.com/docs/voice',
    defaultValues: {
      accountSid: '',
      authToken: '',
      defaultFromNumber: '+12055551234',
      phoneNumbers: '+12055551234',
    },
    fields: [
      { key: 'accountSid', label: 'Twilio Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', hint: 'Found in your Twilio Console Dashboard' },
      { key: 'authToken', label: 'Twilio Auth Token', placeholder: 'your_auth_token', secret: true, hint: 'Found in your Twilio Console Dashboard' },
      { key: 'defaultFromNumber', label: 'Default Caller Phone Number', placeholder: '+12055551234', hint: 'Primary phone number to place outbound calls from' },
      { key: 'phoneNumbers', label: 'All Selectable Phone Numbers', placeholder: '+12055551234, +12055559876', hint: 'Comma-separated phone numbers you want to choose from when calling leads' },
      { key: 'twimlAppSid', label: 'TwiML App SID (optional)', placeholder: 'APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
    Icon: () => (
      <svg viewBox="0 0 24 24" fill="#F22F46" className="w-7 h-7">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 3.5c4.694 0 8.5 3.806 8.5 8.5s-3.806 8.5-8.5 8.5-8.5-3.806-8.5-8.5 3.806-8.5 8.5-8.5zm-3.5 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
      </svg>
    ),
  },
  {
    id: 'gmail', name: 'Gmail / Google', category: 'Email',
    tagline: 'Send emails and sync your Gmail inbox',
    description: 'Connect Gmail via Google OAuth to send personalized emails, track opens and replies, and sync email conversations with leads directly inside NexaCRM.',
    features: ['Send & receive emails', 'Open/click tracking', 'Thread sync', 'AI email drafts'],
    color: '#EA4335', bg: '#FFF4F3',
    authType: 'oauth', oauthProvider: 'Google',
    docsUrl: 'https://developers.google.com/gmail/api',
    fields: [
      { key: 'clientId',     label: 'Google OAuth Client ID',     placeholder: '123456789-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'OAuth Client Secret',        placeholder: 'GOCSPX-...', secret: true },
      { key: 'refreshToken', label: 'Refresh Token (after auth)', placeholder: '1//0g...', secret: true },
    ],
    Icon: () => <svg viewBox="0 0 24 24" className="w-7 h-7"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/></svg>,
  },
  {
    id: 'google_calendar', name: 'Google Calendar', category: 'Calendar',
    tagline: 'Schedule meetings and sync your calendar',
    description: 'Link Google Calendar to schedule follow-up meetings, get reminders for lead activities, and auto-create calendar events when deals progress.',
    features: ['Meeting scheduling', 'Auto-reminders', 'Pipeline event sync', 'Team availability'],
    color: '#4285F4', bg: '#EFF4FF',
    authType: 'oauth', oauthProvider: 'Google',
    docsUrl: 'https://developers.google.com/calendar/api',
    fields: [
      { key: 'clientId',     label: 'Google OAuth Client ID', placeholder: '123456789-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'OAuth Client Secret',   placeholder: 'GOCSPX-...', secret: true },
      { key: 'calendarId',   label: 'Calendar ID (optional)', placeholder: 'primary' },
    ],
    Icon: () => <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7"><rect x="2" y="4" width="20" height="18" rx="2" fill="white" stroke="#4285F4" strokeWidth="1.5"/><path d="M2 9h20" stroke="#4285F4" strokeWidth="1.5"/><rect x="7" y="2" width="2" height="4" rx="1" fill="#4285F4"/><rect x="15" y="2" width="2" height="4" rx="1" fill="#4285F4"/><text x="12" y="18" textAnchor="middle" fill="#EA4335" fontSize="7" fontWeight="bold">AI</text></svg>,
  },
  {
    id: 'google_sheets_leads', name: 'Google Sheets Leads', category: 'Data Sync',
    tagline: 'Manual sync from public Google Sheet to CRM Leads',
    description: 'Connect your public Google Sheet and manually sync lead rows into NexaCRM without Google Cloud Console or OAuth setup.',
    features: ['Manual configure', 'No console setup', 'Header auto-mapping', 'One-click lead sync'],
    color: '#16A34A', bg: '#EDFFF3',
    authType: 'manual',
    docsUrl: 'https://support.google.com/docs/answer/3093335',
    defaultValues: {
      spreadsheetId: '1iiarMz6cIv-eTKI3vJtqlL_oTUUvrE1PYeM3liLFL88',
      sheetName: 'Leads(Kriscel.com)',
      gid: '0',
      sourceLabel: 'Kriscel.com'
    },
    fields: [
      { key: 'spreadsheetId', label: 'Spreadsheet ID', placeholder: '1iiarMz6cIv-eTKI3vJtqlL_oTUUvrE1PYeM3liLFL88', hint: 'From your sheet URL between /d/ and /edit' },
      { key: 'sheetName', label: 'Sheet Tab Name', placeholder: 'Leads(Kriscel.com)' },
      { key: 'gid', label: 'Sheet GID (optional)', placeholder: '0', hint: 'From URL: ...?gid=0' },
      { key: 'sourceLabel', label: 'Source Label (optional)', placeholder: 'Kriscel.com' },
      { key: 'publishedCsvUrl', label: 'Published CSV URL (recommended)', placeholder: 'https://docs.google.com/spreadsheets/d/e/.../pub?output=csv', hint: 'From File -> Share -> Publish to web -> CSV' },
      { key: 'appsScriptWebAppUrl', label: 'Apps Script Web App URL (optional)', placeholder: 'https://script.google.com/macros/s/.../exec', hint: 'Store for team reference' },
    ],
    Icon: Sheet,
  },
  {
    id: 'openai', name: 'OpenAI', category: 'AI',
    tagline: 'Power all AI features with OpenAI GPT',
    description: 'Connect your OpenAI API key to enable AI lead scoring, email drafting, deal prediction, smart replies, and the CRM AI assistant chatbot.',
    features: ['Lead scoring', 'Email generation', 'Deal prediction', 'AI chatbot', 'Smart replies'],
    color: '#10A37F', bg: '#F0FDF9',
    authType: 'apikey',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    fields: [
      { key: 'apiKey', label: 'OpenAI API Key', placeholder: 'sk-...', secret: true, hint: 'Create one at platform.openai.com/api-keys' },
      { key: 'model',  label: 'Model',       placeholder: 'gpt-4o-mini', hint: 'Recommended: gpt-4o-mini' },
    ],
    Icon: Sparkles,
  },
  {
    id: 'mongodb', name: 'MongoDB Atlas Database', category: 'Database',
    tagline: 'Connect and verify MongoDB Atlas cluster',
    description: 'Connect your MongoDB Atlas cloud database to power NexaCRM AI data persistence for leads, call logs, integrations, and automation workflows.',
    features: ['Cluster connectivity test', 'Real-time ping latency', 'Collection inspection', 'Atlas multi-tenant sync'],
    color: '#00ED64', bg: '#F0FDF4',
    authType: 'apiKey',
    docsUrl: 'https://www.mongodb.com/docs/atlas/',
    defaultValues: {
      uri: 'mongodb+srv://admin:123@internitecrm.t9xvmx7.mongodb.net/nexacrm?retryWrites=true&w=majority',
      database: 'nexacrm'
    },
    fields: [
      { key: 'uri',      label: 'MongoDB URI',      placeholder: 'mongodb+srv://admin:123@internitecrm.t9xvmx7.mongodb.net/nexacrm?retryWrites=true&w=majority', secret: true, hint: 'MongoDB Atlas connection string with credentials' },
      { key: 'database', label: 'Database Name',    placeholder: 'nexacrm', hint: 'Default database name (e.g. nexacrm)' },
    ],
    Icon: Database,
  },
]

const CAT_COLORS = {
  'Social Media': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'Messaging':    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Email':        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'Calendar':     'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  'Data Sync':    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'AI':           'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Database':     'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
}

function getErrorMessage(err, fallback) {
  if (typeof err === 'string' && err.trim()) return err
  if (err?.message && String(err.message).trim()) return String(err.message)
  if (err?.error && String(err.error).trim()) return String(err.error)
  return fallback
}

/* ── Setup Modal ── */
function SetupModal({ integration, onClose }) {
  const {
    configs,
    connected,
    testing,
    syncing,
    saving,
    saveIntegration,
    syncIntegration,
    testIntegration,
    disconnectIntegration,
  } = useIntegrationsStore()
  const saved = configs[integration.id] || {}
  const [values, setValues] = useState({ ...(integration.defaultValues || {}), ...saved })
  const [revealed, setRevealed] = useState({})
  const [tested, setTested] = useState(false)
  const isConnected = !!connected[integration.id]

  const update = (key, val) => setValues(p => ({ ...p, [key]: val }))
  const copy = (val) => { navigator.clipboard?.writeText(val); toast.success('Copied!') }
  const providerMode = String(values.provider || '').trim().toLowerCase()

  const getVisibleFields = () => {
    if (integration.id === 'whatsapp') {
      const baseKeys = ['provider', 'senderNumber']
      const aknexusKeys = ['apiUrl', 'apiToken', 'instanceId']
      const kriscelKeys = ['apiUrl', 'apiKey', 'sessionId']
      const aiadrikaKeys = ['apiUrl', 'instanceId', 'accessToken']
      const providerKeys = providerMode === 'kriscelwa'
        ? kriscelKeys
        : providerMode === 'aiadrika'
          ? aiadrikaKeys
          : aknexusKeys
      return integration.fields.filter(f => [...baseKeys, ...providerKeys].includes(f.key))
    }
    return integration.fields
  }

  const getRequiredFields = () => {
    if (integration.id === 'whatsapp') {
      const requiredKeys = providerMode === 'kriscelwa'
        ? ['provider', 'apiKey', 'sessionId']
        : providerMode === 'aiadrika'
          ? ['provider', 'apiUrl', 'instanceId', 'accessToken']
          : ['provider', 'apiUrl', 'apiToken', 'instanceId']
      return integration.fields.filter(f => requiredKeys.includes(f.key))
    }

    if (integration.id !== 'voice_call_agent') {
      return integration.fields.filter(
        f => !f.label.toLowerCase().includes('optional') && !f.hint?.includes('after auth')
      )
    }

    const baseKeys = ['provider']
    const bolnaKeys = ['bolnaApiUrl', 'bolnaApiKey', 'bolnaAgentId']
    const webhookKeys = ['webhookUrl']
    const twilioKeys = ['twilioAccountSid', 'twilioAuthToken']
    const requiredKeys = providerMode === 'webhook'
      ? [...baseKeys, ...webhookKeys]
      : providerMode === 'twilio'
        ? [...baseKeys, ...twilioKeys]
        : [...baseKeys, ...bolnaKeys]

    return integration.fields.filter(f => requiredKeys.includes(f.key))
  }

  const handleTest = async () => {
    const required = getRequiredFields()
    const missing = required.filter(f => !values[f.key]?.trim())
    if (missing.length) { toast.error('Please fill required fields first'); return }
    try {
      await testIntegration(integration.id, values)
      setTested(true)
      toast.success('Connection test successful!')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Connection test failed. Make sure backend is restarted.'))
    }
  }

  const handleSave = async () => {
    const required = getRequiredFields()
    const missing = required.filter(f => !values[f.key]?.trim())
    if (missing.length) { toast.error(`Required: ${missing.map(f => f.label).join(', ')}`); return }
    try {
      await saveIntegration(integration.id, values)
      toast.success(`${integration.name} connected!`)
      onClose()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save integration. Make sure backend is restarted.'))
    }
  }

  const handleManualSync = async () => {
    if (integration.id !== 'google_sheets_leads') return
    try {
      const result = await syncIntegration(integration.id, values)
      toast.success(`Sync complete: ${result.imported || 0} imported, ${result.skipped || 0} skipped`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Lead sync failed. Verify sheet settings and backend status.'))
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnectIntegration(integration.id)
      toast.success('Disconnected.')
      onClose()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to disconnect integration.'))
    }
  }

  return (
    <ScreenModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div initial={{ opacity:0, scale:0.95, y:20 }} animate={{ opacity:1, scale:1, y:0 }} exit={{ opacity:0, scale:0.95, y:20 }}
        className="w-full max-w-xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-700"
             style={{ background: `linear-gradient(135deg,${integration.color}15,transparent)` }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm" style={{ background: integration.bg }}>
            <integration.Icon />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{integration.name}</h2>
            <p className="text-xs text-slate-500">{integration.tagline}</p>
          </div>
          {isConnected && <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/> Connected
          </span>}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Notice */}
          <div className={`mx-5 mt-4 p-3 rounded-xl border flex gap-3 text-xs ${
            integration.authType === 'oauth'
              ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
              : integration.authType === 'manual'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
          }`}>
            <Shield className="w-4 h-4 flex-shrink-0 mt-0.5"/>
            <div>
              {integration.authType === 'oauth'
                ? <><strong>{integration.oauthProvider} OAuth 2.0</strong> — Create an app in the developer console, paste credentials below.</>
                : integration.authType === 'manual'
                ? <><strong>Manual setup mode</strong> — Uses public sheet CSV + backend sync (no Google Cloud Console needed).</>
                : <><strong>API Key</strong> — Encrypted before storage. Never share publicly.</>}
              {' '}<a href={integration.docsUrl} target="_blank" rel="noreferrer"
                 className="underline font-semibold inline-flex items-center gap-0.5 ml-1">
                Docs <ExternalLink className="w-2.5 h-2.5"/>
              </a>
            </div>
          </div>

          {/* Fields */}
          <div className="px-5 py-4 space-y-3">
            {getVisibleFields().map(f => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{f.label}</label>
                <div className="relative">
                  <input
                    type={f.secret && !revealed[f.key] ? 'password' : 'text'}
                    value={values[f.key] || ''}
                    onChange={e => update(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition pr-16"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    {f.secret && (
                      <button onClick={() => setRevealed(p => ({ ...p, [f.key]: !p[f.key] }))}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 transition">
                        {revealed[f.key] ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                      </button>
                    )}
                    {!f.secret && values[f.key] && (
                      <button onClick={() => copy(values[f.key])} className="p-1 rounded text-slate-400 hover:text-slate-600 transition">
                        <Copy className="w-3.5 h-3.5"/>
                      </button>
                    )}
                  </div>
                </div>
                {f.hint && <p className="text-[10px] text-slate-400 mt-0.5">{f.hint}</p>}
              </div>
            ))}
          </div>

          {integration.id === 'google_sheets_leads' && (
            <div className="mx-5 mb-4 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-900/20">
              <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-widest mb-2">
                Manual Setup (No Console)
              </p>
              <ol className="space-y-1 text-xs text-emerald-800 dark:text-emerald-200 list-decimal list-inside">
                <li>Open your Google Sheet and keep the tab name exactly <strong>Leads(Kriscel.com)</strong>.</li>
                <li>Share as <strong>Anyone with link - Viewer</strong> (for CSV read access).</li>
                <li>Best method: <strong>File, then Share, then Publish to web, then CSV</strong>, then paste that link into <strong>Published CSV URL</strong>.</li>
                <li>Paste <strong>Spreadsheet ID</strong>, <strong>Sheet Tab Name</strong>, and optional <strong>GID</strong> here.</li>
                <li>Click <strong>Test</strong>, then <strong>Connect</strong>, then <strong>Sync Existing Leads</strong>.</li>
              </ol>
            </div>
          )}

          {/* Features */}
          <div className="px-5 pb-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Unlocks</p>
            <div className="flex flex-wrap gap-1.5">
              {integration.features.map(feat => (
                <span key={feat} className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500"/> {feat}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-between gap-2">
          <div>
            {isConnected && (
              <button onClick={handleDisconnect} className="btn-secondary text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 border-red-200 dark:border-red-900">
                Disconnect
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
            <button onClick={handleTest} disabled={testing || saving} className="btn-secondary text-xs gap-1.5 disabled:opacity-60">
              <RefreshCw className={`w-3 h-3 ${testing ? 'animate-spin' : ''}`}/>
              {testing ? 'Testing…' : tested ? '✓ Tested' : 'Test'}
            </button>
            {integration.id === 'google_sheets_leads' && (
              <button onClick={handleManualSync} disabled={syncing || saving || testing} className="btn-secondary text-xs gap-1.5 disabled:opacity-60">
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`}/>
                {syncing ? 'Syncing…' : 'Sync Existing Leads'}
              </button>
            )}
            <button onClick={handleSave} disabled={saving || testing} className="btn-primary text-xs gap-1.5 disabled:opacity-60" style={{ background: integration.color, borderColor: integration.color }}>
              <Link2 className="w-3 h-3"/>
              {saving ? 'Saving…' : isConnected ? 'Update' : 'Connect'}
            </button>
          </div>
        </div>
      </motion.div>
      </div>
    </ScreenModalPortal>
  )
}

/* ── Card ── */
function IntegrationCard({ integration, isConnected, onOpen }) {
  return (
    <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} whileHover={{ y:-2 }}
      className="glass-card p-5 flex flex-col gap-3 relative overflow-hidden cursor-pointer"
      onClick={() => onOpen(integration)}>
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ background: integration.color }}/>
      <div className="flex items-start justify-between mt-1">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-sm" style={{ background: integration.bg }}>
          <integration.Icon />
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAT_COLORS[integration.category]}`}>{integration.category}</span>
          {isConnected
            ? <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>Connected</span>
            : <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-slate-300"/>Not connected</span>}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{integration.name}</h3>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{integration.description}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {integration.features.slice(0,3).map(f => (
          <span key={f} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{f}</span>
        ))}
      </div>
      <button className="w-full text-xs font-semibold py-2 rounded-xl transition-all mt-auto"
        style={{ background: isConnected ? '#f1f5f9' : integration.color, color: isConnected ? '#475569' : '#fff' }}>
        {integration.id === 'google_sheets_leads'
          ? (isConnected ? 'Manual Configure' : 'Manual Connect')
          : (isConnected ? 'Configure' : 'Connect')}
      </button>
    </motion.div>
  )
}

/* ── Page ── */
export default function IntegrationsPage() {
  const { connected, fetchIntegrations, loaded } = useIntegrationsStore()
  const [activeModal, setActiveModal] = useState(null)
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    if (!loaded) fetchIntegrations()
  }, [fetchIntegrations, loaded])

  const categories = ['All', 'Social Media', 'Messaging', 'Email', 'Calendar', 'Data Sync', 'AI']
  const filtered = filter === 'All' ? INTEGRATIONS : INTEGRATIONS.filter(i => i.category === filter)
  const connectedCount = Object.values(connected).filter(Boolean).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Integrations</h1>
          <p className="text-sm text-slate-500 mt-0.5">{connectedCount} of {INTEGRATIONS.length} connected</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 font-semibold">
          <Zap className="w-3.5 h-3.5"/> {connectedCount} Active · {INTEGRATIONS.length - connectedCount} Available
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => (
          <button key={cat} onClick={() => setFilter(cat)}
            className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              filter === cat ? 'bg-brand-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-brand-400'
            }`}>{cat}</button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <AnimatePresence>
          {filtered.map(intg => (
            <IntegrationCard key={intg.id} integration={intg} isConnected={!!connected[intg.id]} onOpen={setActiveModal}/>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {activeModal && <SetupModal integration={activeModal} onClose={() => setActiveModal(null)}/>}
      </AnimatePresence>
    </div>
  )
}
