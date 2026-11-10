import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { getSocket } from '../services/socket.js';
import { telephonyVoiceManager, TelephonyCallState } from '../services/telephonyVoice.js';
import { webrtcManager } from '../services/webrtc.js';
import { voiceService } from '../services/voice.js';
import { ringtoneService } from '../services/ringtone.js';
import { AgentWorkQueue } from './AgentWorkQueue.js';
import { User, CallRecord, KnowledgeEntry, LanguageCode, SUPPORTED_LANGUAGES } from '../types.js';
import {
  PhoneCall, PhoneOutgoing, PhoneOff, Mic, MicOff,
  Volume2, VolumeX, Clock, Search, BookOpen,
  Smartphone, AlertCircle, CheckCircle2, Radio, Info,
  Globe, Sparkles, MessageSquare, Pause, Play, Send, Copy, Users, ListChecks
} from 'lucide-react';

interface LogEntry {
  id: string;
  sender: 'system' | 'agent' | 'customer';
  senderName: string;
  text: string;
  translation?: string;
  timestamp: string;
}

interface IncomingCall {
  callId: string;
  callRecordId?: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  preferredLanguage: string;
  languageName: string;
  customerSocketId: string;
  startTime: number;
}

export const AgentDashboard: React.FC = () => {
  const { user, token } = useAuth();

  // Navigation tab for agent workflows.
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing' | 'console' | 'history' | 'knowledge' | 'queue'>('queue');

  // Agent Availability & Supported Languages
  const [agentStatus, setAgentStatus] = useState<'available' | 'busy'>(
    (user?.agentStatus as 'available' | 'busy') || 'available'
  );

  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(
    user?.supportedLanguages ? user.supportedLanguages.split(',') : ['en', 'ta', 'te', 'ml', 'hi']
  );

  // Incoming call state & ringing
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [incomingRingSec, setIncomingRingSec] = useState(0);

  // Live waiting queue count
  const [queueCount, setQueueCount] = useState<number>(0);

  // Telephony provider configuration status
  const [providerStatus, setProviderStatus] = useState<{
    configured: boolean;
    provider: string;
    callerId?: string;
    message?: string;
  } | null>(null);

  // Active call state (Supports both WebRTC incoming support calls and Outgoing PSTN calls)
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    callRecordId?: string;
    customerName: string;
    customerPhone: string;
    customerId?: string;
    preferredLanguage?: string;
    isIncomingSupport?: boolean;
    state: TelephonyCallState | 'ringing' | 'connected' | 'on_hold';
    statusText: string;
  } | null>(null);

  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isCallHeld, setIsCallHeld] = useState(false);
  const [callNotes, setCallNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);

  // Live logs / transcript
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [callError, setCallError] = useState<string | null>(null);

  // Embedded Knowledge Base Copilot
  const [copilotSearch, setCopilotSearch] = useState('');
  const [copilotSuggestion, setCopilotSuggestion] = useState<{
    query: string;
    answer: string;
    sources: any[];
    isGrounded: boolean;
    language: string;
  } | null>(null);
  const [copilotLoading, setCopilotLoading] = useState(false);

  // Outgoing calls: Customer list and search
  const [customers, setCustomers] = useState<User[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // Direct manual dial input state
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');

  // Call history
  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Knowledge Base tab search
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [kbSearch, setKbSearch] = useState('');
  const [loadingKb, setLoadingKb] = useState(false);

  // Log auto-scroll
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Check telephony provider status on load
  const checkStatus = async () => {
    const status = await telephonyVoiceManager.checkProviderStatus();
    setProviderStatus(status);
  };

  useEffect(() => {
    checkStatus();
  }, []);

  // Sync Agent Availability Toggle
  const handleToggleStatus = async () => {
    const nextStatus = agentStatus === 'available' ? 'busy' : 'available';
    setAgentStatus(nextStatus);

    const socket = getSocket();
    socket.emit('agent:status_toggle', { agentStatus: nextStatus });

    if (token) {
      try {
        await fetch('/api/auth/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ agentStatus: nextStatus })
        });
      } catch (err) {
        console.warn('Could not save agent status:', err);
      }
    }
  };

  // Sync Supported Languages
  const handleToggleLanguage = async (code: string) => {
    let next: string[];
    if (supportedLanguages.includes(code)) {
      if (supportedLanguages.length === 1) return; // Must have at least 1 language
      next = supportedLanguages.filter(l => l !== code);
    } else {
      next = [...supportedLanguages, code];
    }
    setSupportedLanguages(next);

    const socket = getSocket();
    socket.emit('agent:languages_update', { supportedLanguages: next });

    if (token) {
      try {
        await fetch('/api/auth/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ supportedLanguages: next })
        });
      } catch (err) {
        console.warn('Could not save agent languages:', err);
      }
    }
  };

  // Incoming call ringing timer
  useEffect(() => {
    let interval: any;
    if (incomingCall) {
      interval = setInterval(() => {
        setIncomingRingSec(Math.floor((Date.now() - incomingCall.startTime) / 1000));
      }, 1000);
    } else {
      setIncomingRingSec(0);
    }
    return () => clearInterval(interval);
  }, [incomingCall]);

  // Live Call Duration timer (Unlimited duration)
  useEffect(() => {
    let timer: any;
    if (activeCall && (activeCall.state === 'connected' || activeCall.state === 'on_hold')) {
      timer = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [activeCall]);

  // Socket event listeners for incoming support calls and queue
  useEffect(() => {
    const socket = getSocket();

    // 1. Incoming Call Notification
    socket.on('agent:incoming_call', (data: IncomingCall) => {
      console.log('[Agent] Incoming call from customer:', data.customerName, data.preferredLanguage);
      setIncomingCall(data);
      // Play synthetic ringtone audio & trigger desktop notification
      ringtoneService.start(data.customerName);
    });

    // 2. Incoming Call Missed / Cancelled
    socket.on('agent:call_missed', (data: { callId: string }) => {
      if (incomingCall?.callId === data.callId) {
        ringtoneService.stop();
        setIncomingCall(null);
      }
    });

    // 3. Queue update
    socket.on('queue:status_updated', (data: { queueLength: number }) => {
      setQueueCount(data.queueLength || 0);
    });

    // 4. Live speech transcript relay (Multilingual)
    socket.on('call:live_transcript', (data: {
      sender: any;
      senderName: string;
      text: string;
      translation?: string;
      language?: string;
      timestamp: string;
    }) => {
      setLogs(prev => [
        ...prev,
        {
          id: 'log_' + Date.now() + Math.random(),
          sender: data.sender,
          senderName: data.senderName,
          text: data.text,
          translation: data.translation,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    // 5. AI Knowledge Base Answer Suggestion
    socket.on('call:kb_suggestion', (data: {
      callId: string;
      query: string;
      answer: string;
      sources: any[];
      isGrounded: boolean;
      language: string;
    }) => {
      setCopilotLoading(false);
      setCopilotSuggestion({
        query: data.query,
        answer: data.answer,
        sources: data.sources || [],
        isGrounded: data.isGrounded,
        language: data.language
      });
    });

    // 6. Call ended by customer or system
    socket.on('call:ended', (data: { callId: string; duration?: number }) => {
      if (activeCall && activeCall.callId === data.callId) {
        cleanupActiveCall();
        fetchHistory();
      }
    });

    return () => {
      socket.off('agent:incoming_call');
      socket.off('agent:call_missed');
      socket.off('queue:status_updated');
      socket.off('call:live_transcript');
      socket.off('call:kb_suggestion');
      socket.off('call:ended');
    };
  }, [incomingCall, activeCall]);

  // Accept Incoming Customer Call
  const handleAcceptIncomingCall = async () => {
    if (!incomingCall) return;

    // Stop ringtone immediately
    ringtoneService.stop();

    const selectedCall = incomingCall;
    setIncomingCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCallHeld(false);
    setCallNotes('');
    setCopilotSuggestion(null);

    setActiveCall({
      callId: selectedCall.callId,
      callRecordId: selectedCall.callRecordId,
      customerName: selectedCall.customerName,
      customerPhone: selectedCall.customerPhone,
      customerId: selectedCall.customerId,
      preferredLanguage: selectedCall.preferredLanguage,
      isIncomingSupport: true,
      state: 'connected',
      statusText: `Connected with ${selectedCall.customerName} (${selectedCall.languageName})`
    });

    setLogs([
      {
        id: 'log_0',
        sender: 'system',
        senderName: 'System',
        text: `Call accepted by Support Specialist ${user?.name}. Language: ${selectedCall.languageName}. Two-way voice established.`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    setActiveTab('console');

    // Notify backend
    const socket = getSocket();
    socket.emit('agent:accept_call', {
      callId: selectedCall.callId,
      agentId: user?.id,
      agentName: user?.name
    });

    // Acquire microphone and start speech recognition
    try {
      await webrtcManager.getMicrophoneStream();
      voiceService.setLanguage('en'); // Agent speaks in English or selected language
      voiceService.startListening((text, isFinal) => {
        if (isFinal && text.trim()) {
          socket.emit('call:live_speech', {
            callId: selectedCall.callId,
            sender: 'agent',
            senderName: user?.name || 'Support Agent',
            text: text.trim(),
            language: 'en'
          });
        }
      });
    } catch (err) {
      console.error('Failed to access microphone for agent call:', err);
    }
  };

  // Reject Incoming Customer Call
  const handleRejectIncomingCall = () => {
    if (!incomingCall) return;

    ringtoneService.stop();
    const socket = getSocket();
    socket.emit('agent:reject_call', {
      callId: incomingCall.callId,
      agentId: user?.id,
      reason: 'Agent busy or rejected'
    });

    setIncomingCall(null);
  };

  // Toggle Hold / Resume
  const handleToggleHold = () => {
    if (!activeCall) return;
    const socket = getSocket();
    if (!isCallHeld) {
      setIsCallHeld(true);
      socket.emit('call:hold', { callId: activeCall.callId });
      addLog('system', 'Call placed on hold by Support Agent.');
    } else {
      setIsCallHeld(false);
      socket.emit('call:resume', { callId: activeCall.callId });
      addLog('system', 'Call resumed.');
    }
  };

  // Save Call Notes
  const handleSaveNotes = async () => {
    if (!activeCall) return;
    const socket = getSocket();
    socket.emit('call:save_notes', { callId: activeCall.callId, notes: callNotes });
    if (activeCall.callRecordId && token) {
      try {
        await fetch(`/api/calls/${activeCall.callRecordId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ notes: callNotes })
        });
      } catch (e) {}
    }
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  // Request AI Knowledge Base Answer Suggestion
  const handleRequestKbCopilot = (queryText?: string) => {
    const query = (queryText || copilotSearch).trim();
    if (!query || !activeCall) return;

    setCopilotLoading(true);
    const socket = getSocket();
    socket.emit('call:request_kb_suggest', {
      callId: activeCall.callId,
      query,
      targetLanguage: activeCall.preferredLanguage || 'en'
    });
  };

  // Fetch customers
  const fetchCustomers = async () => {
    if (!token) return;
    setLoadingCustomers(true);
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(customerSearch)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setCustomers(data.customers || []);
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoadingCustomers(false);
    }
  };

  // Fetch call history
  const fetchHistory = async () => {
    if (!token) return;
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/calls', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setCallHistory(data.calls || []);
    } catch (err) {
      console.error('Failed to fetch calls:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Fetch Knowledge Base entries
  const fetchKnowledge = async () => {
    if (!token) return;
    setLoadingKb(true);
    try {
      const res = await fetch(`/api/knowledge?search=${encodeURIComponent(kbSearch)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setKbEntries(data.entries || []);
    } catch (err) {
      console.error('Failed to fetch knowledge entries:', err);
    } finally {
      setLoadingKb(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [token, customerSearch]);

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
    if (activeTab === 'knowledge') fetchKnowledge();
  }, [activeTab, kbSearch]);

  const addLog = (sender: 'system' | 'agent' | 'customer', text: string) => {
    setLogs(prev => [
      ...prev,
      {
        id: 'log_' + Date.now() + Math.random(),
        sender,
        senderName: sender === 'agent' ? (user?.name || 'Agent') : sender === 'customer' ? (activeCall?.customerName || 'Customer') : 'System',
        text,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
  };

  // Initiate Outbound Real Telephone Call (PSTN)
  const handleStartCall = async (targetName: string, targetPhone: string, customerId?: string) => {
    if (!targetPhone.trim()) {
      alert('Please provide a valid destination mobile phone number.');
      return;
    }

    setCallError(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCallHeld(false);
    setCallNotes('');

    const callInitId = 'call_' + Date.now();
    setActiveCall({
      callId: callInitId,
      customerName: targetName,
      customerPhone: targetPhone,
      customerId,
      isIncomingSupport: false,
      state: 'initiating',
      statusText: `Preparing outbound call to ${targetName} (${targetPhone})...`
    });

    setLogs([
      {
        id: 'log_0',
        sender: 'system',
        senderName: 'System',
        text: `Support Agent ${user?.name || 'Agent'} is placing an outbound telephone call to ${targetName} at ${targetPhone}.`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    setActiveTab('console');

    let registeredCallRecordId: string | undefined;
    try {
      const regRes = await fetch('/api/telephony/register-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          customerId: customerId || null,
          customerName: targetName,
          customerPhone: targetPhone
        })
      });

      const regData = await regRes.json();
      if (regRes.ok && regData.callRecord) {
        registeredCallRecordId = regData.callRecord.id;
        setActiveCall(prev => prev ? { ...prev, callRecordId: registeredCallRecordId, callId: regData.callRecord.callId } : null);
      }
    } catch (err) {
      console.warn('Could not pre-register call record in DB:', err);
    }

    await telephonyVoiceManager.makeCall(
      targetPhone,
      targetName,
      token || '',
      user?.id || '',
      {
        onStateChange: (state: TelephonyCallState, message?: string) => {
          setActiveCall(prev => prev ? { ...prev, state, statusText: message || state } : null);
          if (message) addLog('system', message);
          if (state === 'ended' || state === 'failed') {
            if (token) {
              fetch('/api/telephony/end-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  callId: registeredCallRecordId || callInitId,
                  duration: telephonyVoiceManager.getDurationSeconds(),
                  failureReason: state === 'failed' ? (message || 'Call failed') : null
                })
              }).catch(() => {});
            }
          }
        },
        onError: (err: string) => {
          setCallError(err);
          addLog('system', `Error: ${err}`);
        },
        onDurationTick: (sec: number) => {
          setCallDuration(sec);
        }
      }
    );
  };

  // End active call (Handles both WebRTC and Telephony)
  const handleEndCall = () => {
    if (!activeCall) return;

    if (activeCall.isIncomingSupport) {
      // WebRTC call
      const socket = getSocket();
      socket.emit('call:end', {
        callId: activeCall.callId,
        duration: callDuration,
        endedBy: 'agent',
        notes: callNotes
      });
      cleanupActiveCall();
    } else {
      // Twilio Telephony call
      telephonyVoiceManager.endCall();
      if (token) {
        fetch('/api/telephony/end-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            callId: activeCall.callRecordId || activeCall.callId,
            duration: callDuration
          })
        }).catch(() => {});
      }
      cleanupActiveCall();
    }
    fetchHistory();
  };

  const cleanupActiveCall = () => {
    voiceService.stopListening();
    webrtcManager.endCall();
    setActiveCall(null);
    setIsCallHeld(false);
    setCopilotSuggestion(null);
  };

  const handleToggleMute = () => {
    if (activeCall?.isIncomingSupport) {
      const muted = webrtcManager.toggleMute();
      setIsMuted(muted);
    } else {
      const muted = telephonyVoiceManager.toggleMute();
      setIsMuted(muted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (activeCall?.isIncomingSupport) {
      webrtcManager.setVolume(val);
    } else {
      telephonyVoiceManager.setVolume(val);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Incoming Call Notification Modal & Ringing Sound */}
      {incomingCall && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border-2 border-indigo-500 animate-in fade-in zoom-in-95 duration-200 space-y-5 text-center">
            {/* Ringing Visual */}
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-indigo-300">
                <PhoneCall className="w-9 h-9 animate-bounce" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="px-3 py-1 rounded-full text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Incoming Customer Call ({incomingRingSec}s)
                </span>
              </div>
              <h3 className="text-xl font-black text-slate-900 mt-2">{incomingCall.customerName}</h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{incomingCall.customerPhone}</p>
            </div>

            {/* Language Badge */}
            <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-2xl flex items-center justify-between text-left">
              <div className="flex items-center gap-2.5">
                <Globe className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                    Customer's Preferred Language
                  </div>
                  <div className="text-sm font-extrabold text-blue-950">
                    {incomingCall.languageName}
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-white text-blue-800 text-xs font-bold rounded-lg border border-blue-200">
                {incomingCall.preferredLanguage.toUpperCase()}
              </span>
            </div>

            {/* Accept / Reject Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={handleRejectIncomingCall}
                className="py-3.5 px-4 rounded-2xl bg-slate-100 hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-slate-200 text-slate-700 font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <PhoneOff className="w-4 h-4 text-red-500" />
                Reject
              </button>

              <button
                onClick={handleAcceptIncomingCall}
                className="py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-lg shadow-emerald-200 transition-all cursor-pointer flex items-center justify-center gap-2 hover:scale-[1.02]"
              >
                <PhoneCall className="w-4 h-4" />
                Accept Call
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header & Agent Status Bar */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Support Agent Console</h1>
              {/* Agent Status Toggle */}
              <button
                onClick={handleToggleStatus}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  agentStatus === 'available'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                }`}
                title="Click to toggle Available / Busy"
              >
                <span className={`w-2 h-2 rounded-full ${agentStatus === 'available' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                Status: {agentStatus === 'available' ? 'Available for Calls' : 'Busy / Break'}
              </button>

              {/* Waiting Queue Count Pill */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                Queue: {queueCount} Waiting
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Multilingual customer incoming voice calls, WebRTC audio, grounded KB copilot, and PSTN outbound dialer.
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200 text-xs font-semibold overflow-x-auto">
            <button
              onClick={() => setActiveTab('queue')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'queue' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5 text-indigo-600" />
              Work Queue
            </button>
            <button
              onClick={() => setActiveTab('outgoing')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                activeTab === 'outgoing' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Outgoing Calls
            </button>
            <button
              onClick={() => setActiveTab('console')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'console' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {activeCall && (activeCall.state === 'connected' || activeCall.state === 'on_hold') && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              )}
              Active Call {activeCall && activeCall.state !== 'ended' ? '(Live)' : ''}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                activeTab === 'history' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Call History
            </button>
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'knowledge' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              Knowledge Base
            </button>
          </div>
        </div>

        {/* Supported Languages Multi-select Pills */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mr-1">
            <Globe className="w-3.5 h-3.5 text-indigo-600" />
            My Fluent Languages:
          </span>
          {(Object.entries(SUPPORTED_LANGUAGES) as [LanguageCode, typeof SUPPORTED_LANGUAGES[LanguageCode]][]).map(([code, meta]) => {
            const isSupported = supportedLanguages.includes(code);
            return (
              <button
                key={code}
                onClick={() => handleToggleLanguage(code)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  isSupported
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {meta.nativeName} ({meta.name})
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'queue' && <AgentWorkQueue />}

      {/* 1. OUTGOING CALLS TAB */}
      {activeTab === 'outgoing' && (
        <div className="space-y-6">
          {/* Direct Dial Any Phone Number Card */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-blue-600" />
                  Quick Outbound Dial to Any Mobile Phone
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Dial any registered customer or mobile number. The customer's mobile phone rings over PSTN.
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Recipient Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. John Doe or Test Customer"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Mobile Phone Number (E.164 with Country Code)
                </label>
                <input
                  type="tel"
                  placeholder="e.g. +919876543210 or +14155552671"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900 font-mono"
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={() => {
                    if (!manualPhone.trim()) {
                      alert('Please enter a mobile phone number.');
                      return;
                    }
                    handleStartCall(manualName.trim() || 'Mobile Customer', manualPhone.trim());
                  }}
                  disabled={!manualPhone.trim() || Boolean(activeCall && activeCall.state === 'connected')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
                >
                  <PhoneOutgoing className="w-4 h-4" />
                  Dial Mobile Phone
                </button>
              </div>
            </div>
          </div>

          {/* Registered Customer Directory */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Registered Customer Directory</h2>
                <p className="text-xs text-slate-500">
                  Select a registered customer to place an outbound telephone call to their verified phone number.
                </p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search by name, email, phone..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
                />
              </div>
            </div>

            {loadingCustomers ? (
              <div className="py-8 text-center text-xs text-slate-500">Loading customers...</div>
            ) : customers.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">No registered customers found.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customers.map((c) => (
                  <div key={c.id} className="p-5 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all bg-slate-50/50 hover:bg-white hover:shadow-md space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-slate-900 truncate">{c.name}</h3>
                        <p className="text-[11px] text-slate-500 truncate">{c.email}</p>
                      </div>
                    </div>

                    <div className="text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Phone:</span>
                        <span className="font-mono font-medium text-slate-900">{c.phone || 'Not provided'}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Language:</span>
                        <span className="font-semibold text-indigo-700">
                          {SUPPORTED_LANGUAGES[(c.preferredLanguage as LanguageCode) || 'en']?.name || 'English'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleStartCall(c.name, c.phone || '', c.id)}
                      disabled={!c.phone || Boolean(activeCall && activeCall.state === 'connected')}
                      className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    >
                      <PhoneOutgoing className="w-3.5 h-3.5" />
                      Initiate Voice Call
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. ACTIVE LIVE CALL CONSOLE TAB */}
      {activeTab === 'console' && (
        <div className="space-y-6">
          {!activeCall ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-4">
              <PhoneOff className="w-12 h-12 text-slate-300 mx-auto" />
              <h3 className="text-base font-bold text-slate-900">No Active Voice Call</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                When an incoming customer call is accepted, or an outbound telephone call is initiated, the live two-way audio session and copilot appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left 2 Cols: Main Voice Console & Transcripts */}
              <div className="lg:col-span-2 space-y-6">
                {/* Active Session Header Card */}
                <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold text-lg shadow-md shadow-emerald-200">
                        {activeCall.customerName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-black text-slate-900">{activeCall.customerName}</h2>
                          {activeCall.preferredLanguage && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              {SUPPORTED_LANGUAGES[activeCall.preferredLanguage as LanguageCode]?.name}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {activeCall.isIncomingSupport ? 'WebRTC Real-time Voice' : 'PSTN Outbound Call'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{activeCall.customerPhone}</p>
                      </div>
                    </div>

                    {/* Timer */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-sm font-black text-slate-800">
                      <Clock className="w-4 h-4 text-slate-400" />
                      {formatDuration(callDuration)}
                    </div>
                  </div>

                  {/* Soundwave animation */}
                  <div className="h-16 flex items-center justify-center gap-1.5 py-2">
                    <span className="w-1.5 rounded-full bg-emerald-500 animate-soundwave-1" />
                    <span className="w-1.5 rounded-full bg-emerald-500 animate-soundwave-2" />
                    <span className="w-1.5 rounded-full bg-emerald-500 animate-soundwave-3" />
                    <span className="w-1.5 rounded-full bg-emerald-500 animate-soundwave-4" />
                    <span className="w-1.5 rounded-full bg-emerald-500 animate-soundwave-5" />
                    <span className="w-1.5 rounded-full bg-emerald-500 animate-soundwave-2" />
                    <span className="w-1.5 rounded-full bg-emerald-500 animate-soundwave-4" />
                  </div>

                  {isCallHeld && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs font-bold text-center animate-pulse">
                      Call is currently on hold. Customer cannot hear you.
                    </div>
                  )}

                  {/* In-Call Controls */}
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    {/* Mute Button */}
                    <button
                      onClick={handleToggleMute}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                        isMuted ? 'bg-red-50 border-red-200 text-red-600' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                      }`}
                      title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
                    >
                      {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>

                    {/* Hold / Resume Button */}
                    <button
                      onClick={handleToggleHold}
                      className={`flex items-center gap-2 px-4 py-3.5 rounded-2xl border font-bold text-xs transition-all cursor-pointer ${
                        isCallHeld
                          ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-200'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                      }`}
                    >
                      {isCallHeld ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      {isCallHeld ? 'Resume Call' : 'Hold Call'}
                    </button>

                    {/* End Call Button */}
                    <button
                      onClick={handleEndCall}
                      className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-lg shadow-red-200 transition-all cursor-pointer hover:scale-[1.02]"
                    >
                      <PhoneOff className="w-4 h-4" />
                      End Call
                    </button>

                    {/* Volume Slider */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-2xl">
                      {volume === 0 ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-slate-600" />}
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={handleVolumeChange}
                        className="w-20 accent-indigo-600 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Live Multilingual Conversation Logs */}
                <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-indigo-600" />
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Live Conversation Transcript & Translations
                      </h3>
                    </div>
                    <span className="text-[11px] text-slate-400">{logs.length} messages</span>
                  </div>

                  <div className="bg-slate-50/70 rounded-2xl border border-slate-200 p-4 h-72 overflow-y-auto space-y-3">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className={`flex flex-col ${
                          log.sender === 'agent'
                            ? 'items-end'
                            : log.sender === 'system'
                            ? 'items-center'
                            : 'items-start'
                        }`}
                      >
                        {log.sender === 'system' ? (
                          <span className="px-3 py-1 bg-slate-200/60 text-slate-700 text-[11px] rounded-full font-medium my-0.5">
                            {log.text}
                          </span>
                        ) : (
                          <div className="max-w-[85%] space-y-1">
                            <span className="text-[10px] font-semibold text-slate-400 px-1 block">
                              {log.senderName} • {log.timestamp}
                            </span>
                            <div
                              className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${
                                log.sender === 'agent'
                                  ? 'bg-blue-600 text-white rounded-tr-xs shadow-xs'
                                  : 'bg-white text-slate-900 border border-slate-200 rounded-tl-xs shadow-2xs'
                              }`}
                            >
                              <div>{log.text}</div>
                              {log.translation && (
                                <div className={`mt-1.5 pt-1.5 border-t text-[11px] font-normal italic ${
                                  log.sender === 'agent' ? 'border-blue-400/50 text-blue-100' : 'border-slate-100 text-indigo-600'
                                }`}>
                                  Translated: {log.translation}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>

                {/* Call Notes Area */}
                <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Agent Call Notes & Summary
                    </h3>
                    <button
                      onClick={handleSaveNotes}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200 transition-colors cursor-pointer"
                    >
                      {notesSaved ? 'Saved ✓' : 'Save Notes'}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Enter customer call notes, inquiries discussed, resolution steps..."
                    value={callNotes}
                    onChange={(e) => setCallNotes(e.target.value)}
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900"
                  />
                </div>
              </div>

              {/* Right 1 Col: Grounded Corporate Knowledge Base Copilot */}
              <div className="space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Approved Knowledge Base Copilot</h3>
                      <p className="text-[11px] text-slate-500">Grounded strictly in company verified data</p>
                    </div>
                  </div>

                  {/* Search query input */}
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Ask copilot or search product inquiry..."
                      value={copilotSearch}
                      onChange={(e) => setCopilotSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRequestKbCopilot()}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-900"
                    />
                    <button
                      onClick={() => handleRequestKbCopilot()}
                      disabled={copilotLoading || !copilotSearch.trim()}
                      className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      {copilotLoading ? (
                        <span>Searching Knowledge Base...</span>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Get Grounded AI Answer</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Suggestion Card */}
                  {copilotSuggestion && (
                    <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-2xl space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] text-indigo-700 font-bold">
                        <span>Grounded Answer Suggestion</span>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono text-[10px]">
                          {copilotSuggestion.language.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed font-medium">
                        {copilotSuggestion.answer}
                      </p>

                      {/* Source references */}
                      {copilotSuggestion.sources.length > 0 && (
                        <div className="pt-2 border-t border-indigo-200/60 text-[10px] text-slate-500">
                          <span className="font-bold">Verified Sources: </span>
                          {copilotSuggestion.sources.map(s => s.title).join(', ')}
                        </div>
                      )}

                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(copilotSuggestion.answer);
                          alert('Copied suggestion to clipboard!');
                        }}
                        className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 hover:text-indigo-900 pt-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Copy talking point
                      </button>
                    </div>
                  )}

                  {/* Quick Knowledge Base References */}
                  <div className="pt-2 space-y-2">
                    <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Quick KB Topics
                    </h4>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {[
                        'KAIRA VoiceCore Features',
                        'Voice Agent Pricing & Subscription',
                        'LiveEscalate Human Transfer Protocol',
                        'Refund & Cancellation Policy'
                      ].map((topic) => (
                        <button
                          key={topic}
                          onClick={() => {
                            setCopilotSearch(topic);
                            handleRequestKbCopilot(topic);
                          }}
                          className="w-full text-left p-2 rounded-xl bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-xs text-slate-700 border border-slate-200 transition-colors cursor-pointer truncate"
                        >
                          {topic}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. CALL HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Enterprise Call History</h2>
            <button
              onClick={fetchHistory}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {loadingHistory ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading call history...</div>
          ) : callHistory.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No calls recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Language</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {callHistory.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {new Date(c.startTime).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{c.customerName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{c.customerPhone || 'N/A'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[10px]">
                          {SUPPORTED_LANGUAGES[(c.language as LanguageCode) || 'en']?.name || 'English'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium">{formatDuration(c.duration)}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          {c.type}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                        {c.callNotes || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. KNOWLEDGE BASE SEARCH TAB */}
      {activeTab === 'knowledge' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Approved Corporate Knowledge Base</h2>
              <p className="text-xs text-slate-500">
                Official verified answers managed by Administrators. Grounded reference for all customer questions.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search approved knowledge..."
                value={kbSearch}
                onChange={(e) => setKbSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900"
              />
            </div>
          </div>

          {loadingKb ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading knowledge entries...</div>
          ) : kbEntries.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No knowledge entries found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {kbEntries.map((kb) => (
                <div key={kb.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200">
                      {kb.category}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(kb.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{kb.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{kb.content}</p>
                  {kb.answer && (
                    <div className="mt-2 p-3 bg-white rounded-xl border border-slate-200 text-xs text-indigo-900">
                      <span className="font-bold text-indigo-600 block mb-1">Direct Verified Answer:</span>
                      {kb.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
