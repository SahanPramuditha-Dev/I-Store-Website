import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  MessageSquare,
  Bot,
  QrCode,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Save,
  RotateCcw,
  Search,
  Clock,
  Layers,
  Sparkles,
  Smartphone,
  PhoneCall,
  CheckCheck,
  XCircle,
  Loader2,
  ShieldCheck,
  Activity,
  AlertTriangle,
  Play,
  FileText,
  User,
  Wrench,
  Shield,
  CreditCard,
  Bell,
  ArrowRight,
  TrendingUp,
  Cpu,
  Eye,
  Check,
  CornerDownLeft,
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  Smile,
  Copy,
  Plus,
  SlidersHorizontal,
  Zap,
  Tag,
  HelpCircle,
  SendHorizontal,
  Paperclip,
  Trash2,
  Edit3,
  Image as ImageIcon,
  File,
  Calendar,
  Moon,
  Sun,
  ToggleLeft,
  ToggleRight,
  X,
  Filter
} from "lucide-react";
import { Button, Input, Select, CustomerSelect } from "../components/UI";
import { useFeedback } from "../components/FeedbackProvider";
import { useFetch } from "../hooks/useFetch";
import api from "../lib/api";


function formatDateTime(isoStr) {
  if (!isoStr) return "—";
  const s = String(isoStr);
  const normalized = s.endsWith("Z") || s.includes("+") ? s : s + "Z";
  try {
    return new Date(normalized).toLocaleString();
  } catch {
    return s;
  }
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status, loading }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 bg-slate-800/80 border border-white/10 text-slate-300 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md">
        <Loader2 size={13} className="animate-spin text-cyan-400" /> Checking...
      </div>
    );
  }

  const variants = {
    CONNECTED:    { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-300", icon: <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />, label: "CONNECTED" },
    UNPAIRED:     { bg: "bg-amber-500/15",   border: "border-amber-500/30",   text: "text-amber-300",   icon: <AlertCircle size={13} className="text-amber-400 shrink-0" />,  label: "UNPAIRED — Scan QR" },
    DISCONNECTED: { bg: "bg-rose-500/15",    border: "border-rose-500/30",    text: "text-rose-300",    icon: <XCircle size={13} className="text-rose-400 shrink-0" />,       label: "DISCONNECTED" },
    OFFLINE:      { bg: "bg-rose-500/15",    border: "border-rose-500/30",    text: "text-rose-300",    icon: <XCircle size={13} className="text-rose-400 shrink-0" />,       label: "MICROSERVICE OFFLINE" },
  };
  const v = variants[status] || { bg: "bg-slate-800", border: "border-white/10", text: "text-slate-300", icon: <Loader2 size={13} className="animate-spin" />, label: status || "INITIALIZING" };
  return (
    <div className={`flex items-center gap-2 ${v.bg} border ${v.border} ${v.text} px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-md`}>
      {v.icon}
      <span>{v.label}</span>
    </div>
  );
}

// ─── WhatsApp Text Formatter Component ───────────────────────────────────────

function FormattedWhatsAppText({ text }) {
  if (!text) return null;
  const lines = String(text).split("\n");

  return (
    <div className="space-y-1 text-xs font-sans leading-relaxed select-text">
      {lines.map((line, idx) => {
        if (!line.trim()) return <div key={idx} className="h-2" />;
        if (line.includes("━━━━") || line.includes("────") || line.includes("════")) {
          return <div key={idx} className="border-b border-white/15 my-2" />;
        }

        const parts = [];
        const regex = /(\*[^*]+\*|_[^_]+_|~[^~]+~|`[^`]+`|https?:\/\/[^\s]+)/g;
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(line)) !== null) {
          if (match.index > lastIndex) {
            parts.push(line.substring(lastIndex, match.index));
          }
          const token = match[0];
          if (token.startsWith("*") && token.endsWith("*")) {
            parts.push(<strong key={match.index} className="font-extrabold text-white">{token.slice(1, -1)}</strong>);
          } else if (token.startsWith("_") && token.endsWith("_")) {
            parts.push(<em key={match.index} className="italic text-emerald-100/90">{token.slice(1, -1)}</em>);
          } else if (token.startsWith("~") && token.endsWith("~")) {
            parts.push(<del key={match.index} className="line-through text-slate-400">{token.slice(1, -1)}</del>);
          } else if (token.startsWith("`") && token.endsWith("`")) {
            parts.push(<code key={match.index} className="bg-slate-950/80 px-1.5 py-0.5 rounded font-mono text-[11px] text-cyan-200">{token.slice(1, -1)}</code>);
          } else if (token.startsWith("http")) {
            parts.push(
              <a
                key={match.index}
                href={token}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline underline-offset-2 break-all hover:text-cyan-100 font-medium"
              >
                {token}
              </a>
            );
          }
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < line.length) {
          parts.push(line.substring(lastIndex));
        }

        return <div key={idx} className="leading-relaxed">{parts}</div>;
      })}
    </div>
  );
}

// ─── Message Status Badge ────────────────────────────────────────────────────

function MsgStatusBadge({ status }) {
  const m = {
    READ:      { cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",       label: "✓✓ READ" },
    DELIVERED: { cls: "bg-blue-500/15 text-blue-300 border-blue-500/30",       label: "✓✓ DELIVERED" },
    SENT:      { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "✓ SENT" },
    QUEUED:    { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",     label: "⏳ QUEUED" },
    FAILED:    { cls: "bg-rose-500/15 text-rose-300 border-rose-500/30",       label: "✕ FAILED" },
    CANCELLED: { cls: "bg-slate-700/50 text-slate-400 border-white/10",        label: "CANCELLED" },
  }[status] || { cls: "bg-white/5 text-slate-400 border-white/10", label: status };

  return (
    <span className={`border px-2 py-0.5 rounded-md font-extrabold text-[10px] tracking-wide inline-flex items-center gap-1 ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function WhatsAppManager() {
  const { toast } = useFeedback();
  const [activeTab, setActiveTab] = useState("overview");

  // Overview & Telemetry
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  // Connection
  const [status, setStatus] = useState("INITIALIZING");
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [connectedUser, setConnectedUser] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [templateCategory, setTemplateCategory] = useState("all");
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedEventType, setSelectedEventType] = useState("pos_receipt");
  const [editedBody, setEditedBody] = useState("");
  const [editedActive, setEditedActive] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [activeVariableGroup, setActiveVariableGroup] = useState("all");
  const [testPhoneInput, setTestPhoneInput] = useState("");
  const [sendingTestPreview, setSendingTestPreview] = useState(false);
  const templateTextareaRef = useRef(null);

  // Logs
  const [logs, setLogs] = useState([]);
  const [logStatusFilter, setLogStatusFilter] = useState("ALL");
  const [logCategoryFilter, setLogCategoryFilter] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [totalLogs, setTotalLogs] = useState(0);

  // Pipeline Trace Modal
  const [inspectingTrace, setInspectingTrace] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // Direct Message Composer
  const [directPhone, setDirectPhone] = useState("");
  const [directMessage, setDirectMessage] = useState("");
  const [directInvoice, setDirectInvoice] = useState("");
  const [directRepair, setDirectRepair] = useState("");
  const [sendingDirect, setSendingDirect] = useState(false);
  const [checkingNumber, setCheckingNumber] = useState(false);
  const [numberStatus, setNumberStatus] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const customersFetch = useFetch("/customers?limit=200");
  const customers = useMemo(() => {
    if (Array.isArray(customersFetch.data)) return customersFetch.data;
    if (customersFetch.data && Array.isArray(customersFetch.data.items)) return customersFetch.data.items;
    return [];
  }, [customersFetch.data]);

  // Diagnostics Suite
  const [diagnosticResults, setDiagnosticResults] = useState(null);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);

  // ── Automation Rules State ─────────────────────────────────────────────────
  const [automationRules, setAutomationRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [rulesCategoryFilter, setRulesCategoryFilter] = useState("all");
  const [togglingRuleKey, setTogglingRuleKey] = useState(null);

  // ── Canned Quick Replies State ─────────────────────────────────────────────
  const [quickReplies, setQuickReplies] = useState([]);
  const [loadingQuickReplies, setLoadingQuickReplies] = useState(false);
  const [showQuickReplyModal, setShowQuickReplyModal] = useState(false);
  const [editingQuickReply, setEditingQuickReply] = useState(null);
  const [quickReplyForm, setQuickReplyForm] = useState({ shortcut: "", title: "", content: "", category: "general" });
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [showQuickReplyPicker, setShowQuickReplyPicker] = useState(false);
  const [quickReplyFilterText, setQuickReplyFilterText] = useState("");

  // ── Custom Bot Rules & Away Message State ──────────────────────────────────
  const [botRules, setBotRules] = useState([]);
  const [loadingBotRules, setLoadingBotRules] = useState(false);
  const [showBotRuleModal, setShowBotRuleModal] = useState(false);
  const [editingBotRule, setEditingBotRule] = useState(null);
  const [botRuleForm, setBotRuleForm] = useState({
    name: "",
    keywords: "",
    match_type: "contains",
    response_body: "",
    category: "custom",
    priority: 10,
    is_active: true
  });
  const [savingBotRule, setSavingBotRule] = useState(false);
  const [awaySettings, setAwaySettings] = useState({
    enabled: false,
    text: "",
    start_time: "09:00",
    end_time: "20:00",
    active_days: "0,1,2,3,4,5,6"
  });
  const [loadingAwaySettings, setLoadingAwaySettings] = useState(false);
  const [savingAwaySettings, setSavingAwaySettings] = useState(false);
  const [simulatedBotInput, setSimulatedBotInput] = useState("");
  const [simulatedBotReply, setSimulatedBotReply] = useState(null);
  const [simulatingBot, setSimulatingBot] = useState(false);

  // ── Live Chat & Media Attachments State ────────────────────────────────────
  const [attachedFile, setAttachedFile] = useState(null); // { name, size, type, base64, previewUrl, isImage }
  const chatFileInputRef = useRef(null);

  // ── Live Chat & Inbox State ────────────────────────────────────────────────
  const [chats, setChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [selectedChatPhone, setSelectedChatPhone] = useState(null);
  const [chatData, setChatData] = useState({ phone: "", customer: null, messages: [] });
  const [loadingChatMessages, setLoadingChatMessages] = useState(false);
  const [chatInputText, setChatInputText] = useState("");
  const [sendingChatMsg, setSendingChatMsg] = useState(false);
  const [profilePics, setProfilePics] = useState({});
  const chatContainerRef = useRef(null);
  const chatMessagesEndRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const prevPhoneRef = useRef(null);
  const prevMsgCountRef = useRef(0);

  const fetchProfilePic = useCallback(async (phone) => {
    if (!phone) return;
    try {
      const res = await api.get(`/api/whatsapp/chats/${encodeURIComponent(phone)}/profile-pic`);
      if (res.data?.profilePicUrl) {
        setProfilePics(prev => ({ ...prev, [phone]: res.data.profilePicUrl }));
      }
    } catch {
      // Ignored
    }
  }, []);

  const handleChatContainerScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If distance from bottom is greater than 100px, user is reading older messages
    userScrolledUpRef.current = distanceFromBottom > 100;
  };

  // ── Fetch Conversation Threads ─────────────────────────────────────────────
  const fetchChats = useCallback(async () => {
    try {
      setLoadingChats(true);
      const res = await api.get("/api/whatsapp/chats", {
        params: { search: chatSearch.trim() || undefined }
      });
      const chatList = res.data || [];
      setChats(chatList);
      if (!selectedChatPhone && chatList.length > 0) {
        setSelectedChatPhone(chatList[0].phone);
      }
      // Pre-fetch avatars for threads
      chatList.slice(0, 15).forEach(c => {
        if (c.phone) fetchProfilePic(c.phone);
      });
    } catch (err) {
      console.error("Failed to fetch WhatsApp chats:", err);
    } finally {
      setLoadingChats(false);
    }
  }, [chatSearch, selectedChatPhone, fetchProfilePic]);

  // ── Fetch Chronological Messages for Selected Thread ──────────────────────
  const fetchChatMessages = useCallback(async (phone) => {
    if (!phone) return;
    try {
      setLoadingChatMessages(true);
      const res = await api.get(`/api/whatsapp/chats/${encodeURIComponent(phone)}/messages`);
      setChatData(res.data || { phone, customer: null, messages: [] });
    } catch (err) {
      console.error("Failed to fetch chat messages:", err);
    } finally {
      setLoadingChatMessages(false);
    }
  }, []);

  // Poll chats & active thread when on inbox tab
  useEffect(() => {
    fetchChats();
  }, [chatSearch]);

  useEffect(() => {
    if (activeTab === "inbox") {
      fetchChats();
      const interval = setInterval(() => {
        api.get("/api/whatsapp/chats", { params: { search: chatSearch.trim() || undefined } })
          .then(res => setChats(res.data || []))
          .catch(() => {});
        if (selectedChatPhone) {
          api.get(`/api/whatsapp/chats/${encodeURIComponent(selectedChatPhone)}/messages`)
            .then(res => {
              setChatData(prev => {
                const newMessages = res.data?.messages || [];
                const prevMessages = prev?.messages || [];
                // Only update if count or IDs changed to prevent needless re-renders
                if (newMessages.length === prevMessages.length &&
                    newMessages[newMessages.length - 1]?.id === prevMessages[prevMessages.length - 1]?.id) {
                  return prev;
                }
                return res.data || { phone: selectedChatPhone, customer: null, messages: [] };
              });
            })
            .catch(() => {});
        }
      }, 3500);
      return () => clearInterval(interval);
    }
  }, [activeTab, chatSearch, selectedChatPhone]);

  useEffect(() => {
    if (selectedChatPhone) {
      fetchChatMessages(selectedChatPhone);
    }
  }, [selectedChatPhone, fetchChatMessages]);

  useEffect(() => {
    const isNewChat = prevPhoneRef.current !== selectedChatPhone;
    const msgCount = chatData?.messages?.length || 0;
    const hasNewMsg = msgCount > prevMsgCountRef.current;

    prevPhoneRef.current = selectedChatPhone;
    prevMsgCountRef.current = msgCount;

    if (isNewChat) {
      userScrolledUpRef.current = false;
      setTimeout(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 60);
    } else if (hasNewMsg && !userScrolledUpRef.current) {
      chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatData?.messages, selectedChatPhone]);

  // ── Media Attachment Handlers ──────────────────────────────────────────────
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "File Too Large", description: "Attachments must be under 15 MB.", tone: "warning" });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Content = reader.result.split(",")[1];
      const isImg = file.type.startsWith("image/");
      setAttachedFile({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        base64: base64Content,
        previewUrl: isImg ? reader.result : null,
        isImage: isImg
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAttachedFile = () => {
    setAttachedFile(null);
    if (chatFileInputRef.current) {
      chatFileInputRef.current.value = "";
    }
  };

  // ── Send Manual Reply from Live Chat Inbox (Text or Media Attachment) ──────
  const handleSendChatMessage = async (e) => {
    if (e) e.preventDefault();
    if (!selectedChatPhone || (!chatInputText.trim() && !attachedFile) || sendingChatMsg) return;

    const textToSend = chatInputText.trim();
    const currentAttachment = attachedFile;
    setSendingChatMsg(true);

    try {
      const payload = {
        message: textToSend,
        caption: textToSend
      };

      if (currentAttachment) {
        payload.media_base64 = currentAttachment.base64;
        payload.mimetype = currentAttachment.type;
        payload.filename = currentAttachment.name;
      }

      const res = await api.post(`/api/whatsapp/chats/${encodeURIComponent(selectedChatPhone)}/send`, payload);
      setChatInputText("");
      handleRemoveAttachedFile();

      if (res.data?.message) {
        setChatData(prev => ({
          ...prev,
          messages: [...(prev?.messages || []), res.data.message]
        }));
      }
      userScrolledUpRef.current = false;
      setTimeout(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 60);
      toast({
        title: currentAttachment ? "Attachment & Message Sent" : "Message Sent",
        description: `Delivered to +${selectedChatPhone}`,
        tone: "success",
        iconType: "whatsapp",
        timeoutMs: 2500
      });
      fetchChats();
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to send chat reply.";
      toast({
        title: "Message Delivery Failed",
        description: detail,
        tone: "error",
        timeoutMs: 4000
      });
    } finally {
      setSendingChatMsg(false);
    }
  };

  // ── Automation Rules Handlers ──────────────────────────────────────────────
  const fetchAutomationRules = useCallback(async () => {
    try {
      setLoadingRules(true);
      const res = await api.get("/api/whatsapp/automation-rules");
      setAutomationRules(res.data?.rules || []);
    } catch (err) {
      console.error("Failed to fetch automation rules:", err);
    } finally {
      setLoadingRules(false);
    }
  }, []);

  const handleToggleRule = async (eventType, isEnabled) => {
    setTogglingRuleKey(eventType);
    try {
      await api.put(`/api/whatsapp/automation-rules/${eventType}`, {
        is_enabled: isEnabled
      });
      setAutomationRules(prev =>
        prev.map(r => (r.event_type === eventType ? { ...r, is_enabled: isEnabled } : r))
      );
      toast({
        title: isEnabled ? "Automation Enabled" : "Automation Disabled",
        description: `Trigger for '${eventType}' is now ${isEnabled ? "active" : "muted"}.`,
        tone: isEnabled ? "success" : "info",
        timeoutMs: 2500
      });
    } catch (err) {
      toast({ title: "Failed to Update Rule", description: err.response?.data?.detail || err.message, tone: "error" });
    } finally {
      setTogglingRuleKey(null);
    }
  };

  const handleBulkToggleRules = async (category, isEnabled) => {
    try {
      setLoadingRules(true);
      await api.post("/api/whatsapp/automation-rules/bulk-toggle", {
        category: category,
        is_enabled: isEnabled
      });
      toast({
        title: isEnabled ? "All Triggers Activated" : "All Triggers Muted",
        description: `${category === "all" ? "All rules" : category + " rules"} updated.`,
        tone: isEnabled ? "success" : "info",
        timeoutMs: 3000
      });
      fetchAutomationRules();
    } catch (err) {
      toast({ title: "Bulk Toggle Failed", description: err.message, tone: "error" });
    } finally {
      setLoadingRules(false);
    }
  };

  // ── Canned Quick Replies Handlers ──────────────────────────────────────────
  const fetchQuickReplies = useCallback(async () => {
    try {
      setLoadingQuickReplies(true);
      const res = await api.get("/api/whatsapp/quick-replies");
      setQuickReplies(res.data?.quick_replies || []);
    } catch (err) {
      console.error("Failed to fetch quick replies:", err);
    } finally {
      setLoadingQuickReplies(false);
    }
  }, []);

  const handleSaveQuickReply = async (e) => {
    if (e) e.preventDefault();
    if (!quickReplyForm.shortcut.trim() || !quickReplyForm.content.trim()) {
      toast({ title: "Validation Error", description: "Shortcut and content are required.", tone: "warning" });
      return;
    }

    try {
      setSavingQuickReply(true);
      if (editingQuickReply) {
        await api.put(`/api/whatsapp/quick-replies/${editingQuickReply.id}`, quickReplyForm);
        toast({ title: "Quick Reply Updated", description: `Saved ${quickReplyForm.shortcut}`, tone: "success" });
      } else {
        await api.post("/api/whatsapp/quick-replies", quickReplyForm);
        toast({ title: "Quick Reply Created", description: `Added ${quickReplyForm.shortcut}`, tone: "success" });
      }
      setShowQuickReplyModal(false);
      setEditingQuickReply(null);
      setQuickReplyForm({ shortcut: "", title: "", content: "", category: "general" });
      fetchQuickReplies();
    } catch (err) {
      toast({ title: "Save Failed", description: err.response?.data?.detail || err.message, tone: "error" });
    } finally {
      setSavingQuickReply(false);
    }
  };

  const handleDeleteQuickReply = async (id) => {
    if (!window.confirm("Are you sure you want to delete this canned response shortcut?")) return;
    try {
      await api.delete(`/api/whatsapp/quick-replies/${id}`);
      toast({ title: "Quick Reply Deleted", tone: "info" });
      fetchQuickReplies();
    } catch (err) {
      toast({ title: "Delete Failed", description: err.message, tone: "error" });
    }
  };

  const handleInsertQuickReply = (content) => {
    setChatInputText(prev => (prev ? prev + "\n" + content : content));
    setShowQuickReplyPicker(false);
  };

  // ── Custom Bot Rules & Away Message Handlers ───────────────────────────────
  const fetchBotRules = useCallback(async () => {
    try {
      setLoadingBotRules(true);
      const res = await api.get("/api/whatsapp/bot-rules");
      setBotRules(res.data?.bot_rules || []);
    } catch (err) {
      console.error("Failed to fetch bot rules:", err);
    } finally {
      setLoadingBotRules(false);
    }
  }, []);

  const fetchAwaySettings = useCallback(async () => {
    try {
      setLoadingAwaySettings(true);
      const res = await api.get("/api/whatsapp/away-settings");
      setAwaySettings(res.data || {});
    } catch (err) {
      console.error("Failed to fetch away settings:", err);
    } finally {
      setLoadingAwaySettings(false);
    }
  }, []);

  const handleSaveAwaySettings = async (e) => {
    if (e) e.preventDefault();
    try {
      setSavingAwaySettings(true);
      await api.put("/api/whatsapp/away-settings", awaySettings);
      toast({
        title: "Away Responder Saved",
        description: awaySettings.enabled ? "After-hours responder is ACTIVE." : "Away message is disabled.",
        tone: "success",
        timeoutMs: 3000
      });
    } catch (err) {
      toast({ title: "Save Failed", description: err.message, tone: "error" });
    } finally {
      setSavingAwaySettings(false);
    }
  };

  const handleSaveBotRule = async (e) => {
    if (e) e.preventDefault();
    if (!botRuleForm.name.trim() || !botRuleForm.keywords.trim() || !botRuleForm.response_body.trim()) {
      toast({ title: "Missing Fields", description: "Rule name, keywords, and reply body are required.", tone: "warning" });
      return;
    }

    try {
      setSavingBotRule(true);
      if (editingBotRule) {
        await api.put(`/api/whatsapp/bot-rules/${editingBotRule.id}`, botRuleForm);
        toast({ title: "Bot Rule Updated", description: `Rule '${botRuleForm.name}' saved.`, tone: "success" });
      } else {
        await api.post("/api/whatsapp/bot-rules", botRuleForm);
        toast({ title: "Bot Rule Created", description: `Rule '${botRuleForm.name}' active.`, tone: "success" });
      }
      setShowBotRuleModal(false);
      setEditingBotRule(null);
      setBotRuleForm({
        name: "",
        keywords: "",
        match_type: "contains",
        response_body: "",
        category: "custom",
        priority: 10,
        is_active: true
      });
      fetchBotRules();
    } catch (err) {
      toast({ title: "Failed to Save Bot Rule", description: err.response?.data?.detail || err.message, tone: "error" });
    } finally {
      setSavingBotRule(false);
    }
  };

  const handleDeleteBotRule = async (id) => {
    if (!window.confirm("Are you sure you want to delete this custom bot rule?")) return;
    try {
      await api.delete(`/api/whatsapp/bot-rules/${id}`);
      toast({ title: "Bot Rule Deleted", tone: "info" });
      fetchBotRules();
    } catch (err) {
      toast({ title: "Delete Failed", description: err.message, tone: "error" });
    }
  };

  const handleToggleBotRule = async (rule) => {
    try {
      const nextActive = !rule.is_active;
      await api.put(`/api/whatsapp/bot-rules/${rule.id}`, { is_active: nextActive });
      setBotRules(prev => prev.map(r => (r.id === rule.id ? { ...r, is_active: nextActive } : r)));
      toast({
        title: nextActive ? "Rule Activated" : "Rule Paused",
        description: `'${rule.name}' is now ${nextActive ? "live" : "paused"}.`,
        tone: nextActive ? "success" : "info",
        timeoutMs: 2000
      });
    } catch (err) {
      toast({ title: "Toggle Failed", description: err.message, tone: "error" });
    }
  };

  const handleSimulateBot = () => {
    if (!simulatedBotInput.trim()) return;
    setSimulatingBot(true);
    const query = simulatedBotInput.trim().toLowerCase();

    // Check custom rules
    let matchedRule = null;
    const sorted = [...botRules].filter(r => r.is_active).sort((a, b) => (b.priority || 10) - (a.priority || 10));
    for (const r of sorted) {
      const kws = (r.keywords || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      if (r.match_type === "exact" && kws.includes(query)) {
        matchedRule = r;
        break;
      }
      if (r.match_type === "startswith" && kws.some(k => query.startsWith(k))) {
        matchedRule = r;
        break;
      }
      if (kws.some(k => query.includes(k))) {
        matchedRule = r;
        break;
      }
    }

    setTimeout(() => {
      if (matchedRule) {
        setSimulatedBotReply({
          rule: matchedRule.name,
          matchType: matchedRule.match_type,
          text: formatWhatsappPreview(matchedRule.response_body)
        });
      } else if (["1", "bill", "invoice"].includes(query)) {
        setSimulatedBotReply({
          rule: "Option 1: Digital Bill Lookup",
          matchType: "system",
          text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_bill_lookup")?.template_body || "🧾 *YOUR LATEST DIGITAL INVOICE*\nInvoice: #INV-2026-000007\nTotal: LKR 1,500.00\nLink: https://i-store.app/invoice/INV-2026-000007")
        });
      } else if (["2", "repair", "job", "status"].includes(query)) {
        setSimulatedBotReply({
          rule: "Option 2: Live Repair Tracker",
          matchType: "system",
          text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_repair_status")?.template_body || "🛠️ *LIVE REPAIR STATUS*\nTicket: #REP-2026-889\nDevice: iPhone 15 Pro Max\nStatus: Ready for Pickup")
        });
      } else if (["3", "warranty"].includes(query)) {
        setSimulatedBotReply({
          rule: "Option 3: Active Warranty Check",
          matchType: "system",
          text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_warranty_check")?.template_body || "🛡️ *ACTIVE WARRANTIES*\nProduct: AirPods Pro Gen 2\nValid Until: August 16, 2027")
        });
      } else if (["4", "hours", "location", "address"].includes(query)) {
        setSimulatedBotReply({
          rule: "Option 4: Store Info & Hours",
          matchType: "system",
          text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_store_info")?.template_body || "📍 *STORE INFO*\nHours: Mon – Sun: 9:00 AM – 8:00 PM\nHotline: +94 77 123 4567")
        });
      } else {
        setSimulatedBotReply({
          rule: "Default Greeting & Interactive Menu",
          matchType: "fallback",
          text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_greeting")?.template_body || "👋 *Hello Customer! Welcome to I-Store ERP.*\nReply with:\n1 ➔ View latest Bill\n2 ➔ Check Repair Status\n3 ➔ Check Warranty\n4 ➔ Store Hours")
        });
      }
      setSimulatingBot(false);
    }, 250);
  };

  // ── Fetch Overview ─────────────────────────────────────────────────────────
  const fetchOverview = useCallback(async () => {
    try {
      setLoadingOverview(true);
      const res = await api.get("/api/whatsapp/overview");
      setOverview(res.data);
      if (res.data?.service) {
        setStatus(res.data.service.status || "OFFLINE");
        setQrCodeUrl(res.data.service.qrCodeUrl || null);
        setConnectedUser(res.data.service.user || null);
      }
    } catch {
      setStatus("OFFLINE");
    } finally {
      setLoadingOverview(false);
      setLoadingStatus(false);
    }
  }, []);

  // ── Fetch Templates ────────────────────────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await api.get("/api/whatsapp/templates", {
        params: { category: templateCategory !== "all" ? templateCategory : undefined }
      });
      setTemplates(res.data);
      const initial = res.data.find(t => t.event_type === selectedEventType) || res.data[0];
      if (initial) {
        setEditedBody(initial.template_body);
        setEditedActive(initial.is_active);
      }
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    }
  }, [templateCategory, selectedEventType]);

  // ── Fetch Audit Logs ───────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    try {
      setLoadingLogs(true);
      const res = await api.get("/api/whatsapp/logs", {
        params: {
          status: logStatusFilter !== "ALL" ? logStatusFilter : undefined,
          category: logCategoryFilter !== "all" ? logCategoryFilter : undefined,
          search: logSearch.trim() || undefined,
          limit: 50
        }
      });
      setLogs(res.data.logs || []);
      setTotalLogs(res.data.total || 0);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  }, [logStatusFilter, logCategoryFilter, logSearch]);

  useEffect(() => {
    fetchOverview();
    fetchTemplates();
    fetchQuickReplies();
    fetchAutomationRules();
    const interval = setInterval(fetchOverview, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === "logs") fetchLogs();
    if (activeTab === "automation") fetchAutomationRules();
    if (activeTab === "bot_builder") {
      fetchBotRules();
      fetchAwaySettings();
    }
    if (activeTab === "inbox") fetchQuickReplies();
  }, [activeTab, logStatusFilter, logCategoryFilter, logSearch]);

  useEffect(() => {
    fetchTemplates();
  }, [templateCategory]);

  // ── Template Handlers ──────────────────────────────────────────────────────
  const handleSelectTemplate = (tmpl) => {
    setSelectedEventType(tmpl.event_type);
    setEditedBody(tmpl.template_body);
    setEditedActive(tmpl.is_active);
    setFeedback("");
  };

  const handleInsertVariable = (varName) => {
    const placeholder = `{{${varName}}}`;
    const textarea = templateTextareaRef.current;
    if (!textarea) {
      setEditedBody(prev => prev + placeholder);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const text = textarea.value;
    const newText = text.substring(0, start) + placeholder + text.substring(end);
    setEditedBody(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
    }, 0);
  };

  const handleFormatWrap = (prefix, suffix = prefix) => {
    const textarea = templateTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    const replacement = `${prefix}${selectedText || "text"}${suffix}`;
    const newText = text.substring(0, start) + replacement + text.substring(end);
    setEditedBody(newText);
    setTimeout(() => {
      textarea.focus();
      if (selectedText) {
        textarea.selectionStart = start;
        textarea.selectionEnd = start + replacement.length;
      } else {
        textarea.selectionStart = start + prefix.length;
        textarea.selectionEnd = start + prefix.length + 4;
      }
    }, 0);
  };

  const handleInsertEmoji = (emoji) => {
    const textarea = templateTextareaRef.current;
    if (!textarea) {
      setEditedBody(prev => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const text = textarea.value;
    const newText = text.substring(0, start) + emoji + text.substring(end);
    setEditedBody(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
    }, 0);
  };

  const handleSendTestPreview = async () => {
    const targetPhone = testPhoneInput.trim() || overview?.service?.user?.wid || "94785571342";
    if (!targetPhone) {
      toast({ title: "Recipient Needed", description: "Please enter a phone number to test-send.", tone: "warning" });
      return;
    }
    setSendingTestPreview(true);
    try {
      const resolvedMsg = formatWhatsappPreview(editedBody);
      const res = await api.post("/api/whatsapp/send-direct", {
        phone: targetPhone,
        message: resolvedMsg
      });
      if (res.data?.success) {
        toast({
          title: "Test Message Dispatched",
          description: `Delivered sample template to +${targetPhone}`,
          tone: "success",
          iconType: "whatsapp",
          timeoutMs: 3000
        });
      } else {
        toast({ title: "Delivery Error", description: res.data?.error || "Send failed.", tone: "error" });
      }
    } catch (err) {
      toast({
        title: "Test Send Failed",
        description: err.response?.data?.detail || err.message,
        tone: "error"
      });
    } finally {
      setSendingTestPreview(false);
    }
  };

  const handleSaveTemplate = async () => {
    try {
      setSavingTemplate(true);
      setFeedback("");
      await api.put(`/api/whatsapp/templates/${selectedEventType}`, {
        template_body: editedBody,
        is_active: editedActive
      });
      setFeedback("✅ Template saved & active in ERP!");
      toast({
        title: "Template Saved",
        description: `Changes to ${currentTemplate?.name || selectedEventType} are now live!`,
        tone: "success",
        timeoutMs: 2500
      });
      fetchTemplates();
    } catch {
      setFeedback("❌ Failed to save template.");
      toast({ title: "Save Failed", description: "Could not save template changes.", tone: "error" });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleResetTemplate = async () => {
    if (!window.confirm("Reset this template to system default?")) return;
    try {
      const res = await api.post(`/api/whatsapp/templates/${selectedEventType}/reset`);
      setEditedBody(res.data.template_body);
      setFeedback("🔄 Reset to default!");
      toast({ title: "Reset Complete", description: "Template restored to original system wording.", tone: "info" });
      fetchTemplates();
    } catch {
      setFeedback("❌ Failed to reset template.");
    }
  };

  // ── Pipeline Trace Inspector ──────────────────────────────────────────────
  const handleOpenTrace = async (logId) => {
    try {
      setTraceLoading(true);
      const res = await api.get(`/api/whatsapp/logs/${logId}/trace`);
      setInspectingTrace(res.data);
    } catch (err) {
      toast({ title: "Trace Error", description: "Could not load message trace.", tone: "error" });
    } finally {
      setTraceLoading(false);
    }
  };

  const handleRetryLog = async (logId) => {
    try {
      const res = await api.post(`/api/whatsapp/logs/${logId}/retry`);
      toast({
        title: "WhatsApp Message Retried",
        description: `Message successfully redispatched.`,
        details: `Message ID: ${res.data?.message_id || "retried"} • Status: SENT`,
        tone: "success",
        iconType: "whatsapp",
        timeoutMs: 4500
      });
      fetchLogs();
      fetchOverview();
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      toast({
        title: "Retry Failed",
        description: detail,
        tone: "error",
        timeoutMs: 4500
      });
    }
  };

  // ── Number Check ───────────────────────────────────────────────────────────
  const handleCheckNumber = async () => {
    if (!directPhone.trim()) return;
    setCheckingNumber(true);
    setNumberStatus(null);
    try {
      const res = await api.get(`/api/whatsapp/check-number/${encodeURIComponent(directPhone.trim())}`);
      setNumberStatus(res.data);
      if (!res.data.isRegistered) {
        toast({ title: "Recipient Not Found", description: `+${res.data.phone || directPhone} is not registered on WhatsApp.`, tone: "warning", timeoutMs: 4000 });
      } else {
        toast({ title: "Number Verified", description: `+${res.data.phone} is active on WhatsApp.`, tone: "success", iconType: "whatsapp", timeoutMs: 3500 });
      }
    } catch (err) {
      toast({ title: "Verification Failed", description: err.response?.data?.detail || "Could not verify number.", tone: "error" });
    } finally {
      setCheckingNumber(false);
    }
  };

  // ── Send Direct Message ───────────────────────────────────────────────────
  const handleSendDirect = async (e) => {
    e.preventDefault();
    if (!directPhone.trim() || !directMessage.trim()) return;

    try {
      setSendingDirect(true);
      const res = await api.post("/api/whatsapp/send-direct", {
        phone: directPhone,
        message: directMessage,
        invoice_no: directInvoice.trim() || undefined,
        repair_no: directRepair.trim() || undefined
      });

      toast({
        title: "WhatsApp Message Dispatched",
        description: `Message delivered to +${res.data?.phone || directPhone}`,
        details: `Message ID: ${res.data?.message_id || "sent"} • Status: ${res.data?.status || "SENT"}`,
        tone: "success",
        iconType: "whatsapp",
        timeoutMs: 5000
      });

      setDirectPhone("");
      setDirectMessage("");
      setDirectInvoice("");
      setDirectRepair("");
      setSelectedCustomerId("");
      setNumberStatus(null);
      fetchOverview();
      if (activeTab === "logs") fetchLogs();
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to send message.";
      toast({
        title: "WhatsApp Dispatch Failed",
        description: detail,
        tone: "error",
        timeoutMs: 5000
      });
    } finally {
      setSendingDirect(false);
    }
  };

  // ── Run End-to-End Diagnostics ─────────────────────────────────────────────
  const handleRunDiagnostics = async () => {
    try {
      setRunningDiagnostics(true);
      const res = await api.get("/api/whatsapp/diagnostics/run");
      setDiagnosticResults(res.data);
      toast({
        title: "Diagnostic Completed",
        description: `Overall Pipeline Health: ${res.data?.overall_health}`,
        tone: res.data?.overall_health === "HEALTHY" ? "success" : "warning",
        timeoutMs: 4000
      });
    } catch (err) {
      toast({ title: "Diagnostic Failed", description: err.response?.data?.detail || "Could not run diagnostics.", tone: "error" });
    } finally {
      setRunningDiagnostics(false);
    }
  };

  const handleReconnect = async () => {
    try {
      await api.post("/api/whatsapp/service/reconnect");
      toast({ title: "Reconnecting...", description: "Triggered WhatsApp session reconnect.", tone: "info" });
      setTimeout(fetchOverview, 3000);
    } catch (e) {
      toast({ title: "Reconnect Error", description: "Could not trigger reconnect.", tone: "error" });
    }
  };

  const currentTemplate = templates.find(t => t.event_type === selectedEventType) || {};

  const formatWhatsappPreview = (text) => {
    if (!text) return "";
    return text
      .replace(/{{customer_name}}/g, "Nexusis Technologies")
      .replace(/{{customer_phone}}/g, "+94 78 557 1342")
      .replace(/{{store_name}}/g, "I-Store Digital")
      .replace(/{{invoice_number}}/g, "INV-2026-000007")
      .replace(/{{invoice_date}}/g, "2026-08-16 07:27 PM")
      .replace(/{{invoice_total}}/g, "1,500.00")
      .replace(/{{subtotal}}/g, "1,500.00")
      .replace(/{{discount_amount}}/g, "0.00")
      .replace(/{{paid_amount}}/g, "1,500.00")
      .replace(/{{balance_due}}/g, "0.00")
      .replace(/{{payment_method}}/g, "Cash")
      .replace(/{{smart_bill_url}}/g, "https://i-store.app/invoice/INV-2026-000007")
      .replace(/{{job_number}}/g, "REP-2026-889")
      .replace(/{{device_model}}/g, "iPhone 15 Pro Max")
      .replace(/{{reported_issue}}/g, "Display Glass Replacement")
      .replace(/{{repair_status}}/g, "Ready for Pickup")
      .replace(/{{status_note}}/g, "Quality checked & OEM screen fitted")
      .replace(/{{estimated_cost}}/g, "24,500.00")
      .replace(/{{advance_paid}}/g, "5,000.00")
      .replace(/{{repair_tracking_url}}/g, "https://i-store.app/track/REP-2026-889")
      .replace(/{{warranty_period}}/g, "90 Days Replacement")
      .replace(/{{payment_amount}}/g, "1,500.00")
      .replace(/{{refund_amount}}/g, "1,500.00")
      .replace(/{{refund_method}}/g, "Cash")
      .replace(/{{product_name}}/g, "AirPods Pro Gen 2")
      .replace(/{{serial_number}}/g, "H73KD83J99")
      .replace(/{{expiry_date}}/g, "August 16, 2027")
      .replace(/{{store_phone}}/g, "+94 77 123 4567")
      .replace(/{{store_address}}/g, "No. 45 Galle Road, Colombo")
      .replace(/{{store_website}}/g, "https://i-store.app")
      .replace(/{{transaction_id}}/g, "TX-99812")
      .replace(/{{current_date}}/g, "2026-08-17")
      .replace(/{{current_time}}/g, "01:45 AM")
      .replace(/{{staff_name}}/g, "Manager Sahan")
      .replace(/{{override_reason}}/g, "Special VIP Discount");
  };

  const renderFormattedBubble = (text) => {
    if (!text) return null;
    const resolved = formatWhatsappPreview(text);
    const lines = resolved.split("\n");

    return (
      <div className="space-y-1 text-[13px] text-slate-100 font-sans leading-relaxed select-text">
        {lines.map((line, idx) => {
          if (!line.trim()) return <div key={idx} className="h-2" />;
          if (line.includes("━━━━")) {
            return <div key={idx} className="border-b border-emerald-400/25 my-2.5" />;
          }

          const parts = [];
          const regex = /(\*[^*]+\*|_[^_]+_|~[^~]+~|`[^`]+`|https?:\/\/[^\s]+)/g;
          let lastIndex = 0;
          let match;

          while ((match = regex.exec(line)) !== null) {
            if (match.index > lastIndex) {
              parts.push(line.substring(lastIndex, match.index));
            }
            const token = match[0];
            if (token.startsWith("*") && token.endsWith("*")) {
              parts.push(<strong key={match.index} className="font-extrabold text-white">{token.slice(1, -1)}</strong>);
            } else if (token.startsWith("_") && token.endsWith("_")) {
              parts.push(<em key={match.index} className="italic text-emerald-100/90">{token.slice(1, -1)}</em>);
            } else if (token.startsWith("~") && token.endsWith("~")) {
              parts.push(<del key={match.index} className="line-through text-slate-300">{token.slice(1, -1)}</del>);
            } else if (token.startsWith("`") && token.endsWith("`")) {
              parts.push(<code key={match.index} className="bg-slate-900/80 px-1.5 py-0.5 rounded font-mono text-xs text-cyan-300">{token.slice(1, -1)}</code>);
            } else if (token.startsWith("http")) {
              parts.push(
                <a key={match.index} href={token} target="_blank" rel="noreferrer" className="text-cyan-300 underline underline-offset-2 break-all hover:text-cyan-200 font-medium">
                  {token}
                </a>
              );
            }
            lastIndex = regex.lastIndex;
          }
          if (lastIndex < line.length) {
            parts.push(line.substring(lastIndex));
          }

          return <div key={idx} className="leading-relaxed">{parts}</div>;
        })}
      </div>
    );
  };

  const metrics = overview?.metrics || {};

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-400 shadow-lg shadow-emerald-950/40">
            <MessageSquare size={32} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-white tracking-tight">WhatsApp Automation Hub</h1>
              <StatusBadge status={status} loading={loadingStatus} />
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Enterprise Notification Engine · Smart Receipts · Repair Alerts · End-to-End Tracing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {status === "CONNECTED" && connectedUser && (
            <div className="flex items-center gap-2 text-xs font-mono bg-black/30 border border-white/10 rounded-xl px-3.5 py-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-white font-bold">{connectedUser.pushname}</span>
              <span className="text-slate-400">+{connectedUser.wid}</span>
            </div>
          )}

          <Button
            onClick={fetchOverview}
            variant="outline"
            className="border-white/10 hover:bg-white/5 text-slate-300 rounded-xl px-3.5"
            title="Refresh Telemetry"
          >
            <RefreshCw size={14} className={loadingOverview ? "animate-spin text-cyan-400" : ""} />
          </Button>
        </div>
      </div>

      {/* ── Tab Navigation ─────────────────────────────────────────────────── */}
      <div className="flex border-b border-white/10 gap-1.5 overflow-x-auto pb-0.5">
        {[
          { key: "inbox",       icon: <MessageSquare size={14} />, label: `Live Chats (${chats.length || 0})` },
          { key: "automation",  icon: <SlidersHorizontal size={14} />, label: `Automation Rules (${automationRules.filter(r => r.is_enabled).length}/${automationRules.length || 17})` },
          { key: "bot_builder", icon: <Bot size={14} />,           label: `Bot & Away Rules (${botRules.length} Rules)` },
          { key: "templates",   icon: <Layers size={14} />,        label: "Templates & Variables" },
          { key: "messenger",   icon: <Send size={14} />,          label: "Smart Messenger" },
          { key: "overview",    icon: <Activity size={14} />,      label: "Hub Overview" },
          { key: "logs",        icon: <Clock size={14} />,         label: `Audit Trail (${totalLogs || metrics.total_messages || 0})` },
          { key: "diagnostics", icon: <ShieldCheck size={14} />,   label: "Diagnostics & QR Pair" },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider rounded-t-2xl whitespace-nowrap transition-all duration-200 ${
              activeTab === tab.key
                ? "bg-slate-900 text-emerald-400 border-t border-x border-white/10 shadow-lg"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: HUB OVERVIEW ────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* KPI Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sent Today</span>
              <p className="text-2xl font-black text-white">{metrics.sent_today || 0}</p>
              <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                <TrendingUp size={11} /> Outbound Messages
              </span>
            </div>

            <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Delivered</span>
              <p className="text-2xl font-black text-blue-400">{metrics.delivered_today || 0}</p>
              <span className="text-[10px] text-slate-400 font-mono">
                {metrics.delivery_rate_pct || 100}% Delivery Rate
              </span>
            </div>

            <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Read Receipts</span>
              <p className="text-2xl font-black text-cyan-400">{metrics.read_today || 0}</p>
              <span className="text-[10px] text-cyan-300 font-semibold">Seen by Customers</span>
            </div>

            <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Failed Today</span>
              <p className="text-2xl font-black text-rose-400">{metrics.failed_today || 0}</p>
              <span className="text-[10px] text-rose-300 font-semibold">
                {metrics.failed_today > 0 ? "Requires Review" : "0 Errors"}
              </span>
            </div>

            <div className="bg-slate-900/70 border border-white/10 rounded-2xl p-4 space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Queue</span>
              <p className="text-2xl font-black text-amber-400">{overview?.service?.queueSize || metrics.active_queue_count || 0}</p>
              <span className="text-[10px] text-amber-300 font-semibold">Single-Concurrency FIFO</span>
            </div>
          </div>

          {/* Quick Actions & Telemetry Banner */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Quick Actions */}
            <div className="lg:col-span-4 bg-slate-900/70 border border-white/10 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Quick Operations</h3>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setActiveTab("inbox")}
                  className="flex items-center justify-between p-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-xl text-emerald-300 font-bold text-xs transition shadow-lg shadow-emerald-950/20"
                >
                  <span className="flex items-center gap-2"><MessageSquare size={14} /> Open Live Customer Inbox</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={() => setActiveTab("messenger")}
                  className="flex items-center justify-between p-3 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 rounded-xl text-emerald-300 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><Send size={14} /> Send Instant Message</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={() => setActiveTab("diagnostics")}
                  className="flex items-center justify-between p-3 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-xl text-cyan-300 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><ShieldCheck size={14} /> Run Pipeline Diagnostics</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={() => setActiveTab("templates")}
                  className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-200 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><Layers size={14} /> Customize Message Templates</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={handleReconnect}
                  className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-300 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><RefreshCw size={14} /> Force Session Reconnect</span>
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>

            {/* Telemetry Details */}
            <div className="lg:col-span-8 bg-slate-900/70 border border-white/10 rounded-2xl p-5 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">System Activity Telemetry</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                    <CheckCircle2 size={14} /> Last Successful Dispatch
                  </div>
                  {overview?.last_activity?.last_success_at ? (
                    <div>
                      <p className="text-xs text-white font-mono font-semibold">
                        +{overview.last_activity.last_success_recipient}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {formatDateTime(overview.last_activity.last_success_at)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No dispatches recorded today.</p>
                  )}
                </div>

                <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-400">
                    <AlertTriangle size={14} /> Last Failed Message
                  </div>
                  {overview?.last_activity?.last_failed_at ? (
                    <div>
                      <p className="text-xs text-white font-mono font-semibold">
                        +{overview.last_activity.last_failed_recipient}
                      </p>
                      <p className="text-[11px] text-rose-300/80 truncate" title={overview.last_activity.last_failed_reason}>
                        {overview.last_activity.last_failed_reason}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-400/80 font-semibold">No recent failures!</p>
                  )}
                </div>
              </div>

              <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-300">Supported ERP Dynamic Placeholders: </span>
                  <span className="text-slate-400">25+ ERP variables available across sales, repairs, warranty, and customer notifications.</span>
                </div>
                <button
                  onClick={() => setActiveTab("templates")}
                  className="text-emerald-400 font-bold hover:underline ml-3 whitespace-nowrap"
                >
                  View Placeholders →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 0: LIVE CHATS & INBOX ──────────────────────────────────────── */}
      {activeTab === "inbox" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[720px]">
          {/* Left Panel: Conversation Threads */}
          <div className="lg:col-span-4 bg-slate-900/80 border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl backdrop-blur-xl">
            {/* Header / Search */}
            <div className="p-4 border-b border-white/10 space-y-3 bg-slate-950/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-emerald-400" />
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">Live Inboxes</h3>
                </div>
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                  {chats.length} Threads
                </span>
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search customer, phone, text..."
                  value={chatSearch}
                  onChange={e => setChatSearch(e.target.value)}
                  className="w-full bg-slate-950/80 border border-white/10 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 transition"
                />
                {chatSearch && (
                  <button
                    onClick={() => setChatSearch("")}
                    className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Conversation Thread List */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/5 pr-0.5">
              {loadingChats && chats.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <Loader2 size={24} className="animate-spin text-emerald-400 mx-auto" />
                  <p className="text-xs text-slate-400">Loading conversation threads...</p>
                </div>
              ) : chats.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-slate-500">
                    <MessageSquare size={22} />
                  </div>
                  <p className="text-xs font-bold text-slate-300">No Conversations Found</p>
                  <p className="text-[11px] text-slate-500 max-w-[200px] mx-auto">
                    When customers message your connected WhatsApp number, their chat threads will appear here in real-time.
                  </p>
                </div>
              ) : (
                chats.map(chat => {
                  const isSelected = selectedChatPhone === chat.phone;
                  const lastMsg = chat.last_message || {};
                  const isLastInbound = lastMsg.direction === "inbound";
                  const isLastBot = lastMsg.trigger_type === "bot_auto";

                  const nameParts = (chat.customer_name || "Customer").split(" ");
                  const initials = nameParts.length > 1
                    ? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
                    : nameParts[0].slice(0, 2).toUpperCase();

                  return (
                    <button
                      key={chat.phone}
                      onClick={() => setSelectedChatPhone(chat.phone)}
                      className={`w-full text-left p-3.5 flex items-start gap-3 transition-all cursor-pointer ${
                        isSelected
                          ? "bg-emerald-500/15 border-l-4 border-emerald-400 text-white"
                          : "hover:bg-white/5 text-slate-300"
                      }`}
                    >
                      {/* Avatar */}
                      {profilePics[chat.phone] ? (
                        <img
                          src={profilePics[chat.phone]}
                          alt={chat.customer_name || "Customer"}
                          className="w-10 h-10 rounded-xl object-cover shrink-0 shadow-md border border-emerald-500/30"
                          onError={(e) => {
                            e.target.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black shrink-0 shadow-md ${
                          isSelected
                            ? "bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 font-extrabold shadow-emerald-950/40"
                            : "bg-slate-800 border border-white/10 text-emerald-300"
                        }`}>
                          {initials}
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="text-xs font-bold text-white truncate">
                            {chat.customer_name || "Customer"}
                          </span>
                          <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                            {formatDateTime(lastMsg.created_at || chat.updated_at).split(",")[1] || "Today"}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-400 font-mono mb-1">
                          {chat.display_phone || `+${chat.phone}`}
                        </p>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                          {isLastInbound ? (
                            <span className="text-cyan-400 shrink-0 font-bold">Customer:</span>
                          ) : isLastBot ? (
                            <span className="text-amber-400 shrink-0 font-bold flex items-center gap-1">
                              <Bot size={11} /> Bot:
                            </span>
                          ) : (
                            <span className="text-emerald-400 shrink-0 font-bold">Staff:</span>
                          )}
                          <span className="truncate text-slate-300">
                            {lastMsg.body || "No messages"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Chat Thread Window & Reply Box */}
          <div className="lg:col-span-8 bg-slate-900/80 border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl backdrop-blur-xl">
            {selectedChatPhone ? (
              <>
                {/* Active Chat Header */}
                <div className="p-4 bg-slate-950/80 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {profilePics[selectedChatPhone] ? (
                      <img
                        src={profilePics[selectedChatPhone]}
                        alt={chatData.customer?.name || "Customer"}
                        className="w-11 h-11 rounded-2xl object-cover shadow-lg border border-emerald-500/40 shrink-0"
                        onError={(e) => {
                          e.target.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 flex items-center justify-center font-black text-xs shadow-md shrink-0">
                        {((chatData.customer?.name || "Customer").slice(0, 2)).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-white">
                          {chatData.customer?.name || "Customer"}
                        </h3>
                        <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.2 rounded-full font-bold">
                          +{selectedChatPhone}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                        {chatData.customer?.invoices_count > 0 && (
                          <span className="text-cyan-300">
                            🧾 {chatData.customer.invoices_count} Invoices
                          </span>
                        )}
                        {chatData.customer?.repairs_count > 0 && (
                          <span className="text-amber-300">
                            🛠️ {chatData.customer.repairs_count} Active Repairs
                          </span>
                        )}
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 size={11} /> 2-Way Bot Active
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => fetchChatMessages(selectedChatPhone)}
                      variant="outline"
                      size="sm"
                      className="border-white/10 hover:bg-white/5 text-slate-300 rounded-xl px-3"
                      title="Refresh Thread"
                    >
                      <RefreshCw size={12} className={loadingChatMessages ? "animate-spin text-cyan-400" : ""} />
                    </Button>
                  </div>
                </div>

                {/* Message Bubble Thread */}
                <div
                  ref={chatContainerRef}
                  onScroll={handleChatContainerScroll}
                  className="flex-1 p-5 overflow-y-auto space-y-3.5 bg-[#0b141a] bg-opacity-95"
                >
                  {loadingChatMessages && chatData.messages.length === 0 ? (
                    <div className="p-8 text-center space-y-2">
                      <Loader2 size={24} className="animate-spin text-emerald-400 mx-auto" />
                      <p className="text-xs text-slate-400">Loading messages...</p>
                    </div>
                  ) : chatData.messages.length === 0 ? (
                    <div className="p-8 text-center space-y-2 text-slate-500 text-xs">
                      No message history found for this number. Send the first message below!
                    </div>
                  ) : (
                    chatData.messages.map(msg => {
                      const isInbound = msg.direction === "inbound" || msg.trigger_type === "customer_inbound" || msg.status === "RECEIVED";
                      const isBot = msg.trigger_type === "bot_auto";

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isInbound ? "items-start" : "items-end"}`}
                        >
                          <div
                            className={`p-3.5 rounded-2xl max-w-lg shadow-lg text-xs leading-relaxed ${
                              isInbound
                                ? "bg-[#202c33] text-slate-100 rounded-tl-sm border border-white/5"
                                : isBot
                                ? "bg-[#064e3b] text-slate-100 rounded-tr-sm border border-emerald-600/40 shadow-emerald-950/30"
                                : "bg-[#005c4b] text-slate-100 rounded-tr-sm border border-[#007a63]"
                            }`}
                          >
                            {/* Message Sender Header */}
                            <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-white/10">
                              <span className="text-[10px] font-bold tracking-wider">
                                {isInbound ? (
                                  <span className="text-cyan-300 font-bold">
                                    👤 {chatData.customer?.name || "Customer"}
                                  </span>
                                ) : isBot ? (
                                  <span className="text-emerald-200 font-black flex items-center gap-1">
                                    <Bot size={12} className="text-emerald-300" /> Self-Service Auto-Reply
                                  </span>
                                ) : (
                                  <span className="text-emerald-200 font-bold">
                                    💼 Staff / Manual Dispatch
                                  </span>
                                )}
                              </span>
                              {msg.template_name && (
                                <span className="text-[9px] text-white/50 font-mono truncate max-w-[140px]">
                                  {msg.template_name}
                                </span>
                              )}
                            </div>

                            {/* Attachment rendering if present */}
                            {msg.media_url && (
                              <div className="mb-2 p-2 bg-black/40 border border-white/10 rounded-xl flex items-center gap-2 text-xs">
                                <FileText size={16} className="text-cyan-400 shrink-0" />
                                <span className="truncate font-mono text-cyan-200 text-[11px]">{msg.media_url}</span>
                              </div>
                            )}

                            {/* Message Body with WhatsApp formatting */}
                            <FormattedWhatsAppText text={msg.message_body} />

                            {/* Timestamp & Delivery Indicators */}
                            <div className="flex items-center justify-end gap-1 text-[10px] text-white/50 font-mono mt-2">
                              <span>{formatDateTime(msg.created_at)}</span>
                              {!isInbound && (
                                <span className="text-emerald-300 font-bold" title={msg.status}>
                                  ✓✓
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatMessagesEndRef} />
                </div>

                {/* Quick Canned Shortcuts Bar & Quick Replies Manager */}
                <div className="px-4 py-2 bg-slate-950/90 border-t border-white/10 flex items-center justify-between gap-2 overflow-x-auto text-[11px]">
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    <span className="text-slate-500 font-bold shrink-0 flex items-center gap-1">
                      <Zap size={12} className="text-amber-400" /> Canned:
                    </span>
                    {(quickReplies.length > 0 ? quickReplies.slice(0, 5) : [
                      { shortcut: "/menu", title: "Greeting Menu", content: "👋 Hello! Welcome to I-Store Digital Care.\n\n1 ➔ View latest Bill\n2 ➔ Check Repair Status\n3 ➔ Check Warranty\n4 ➔ Store Hours" },
                      { shortcut: "/ready", title: "Ready for Pickup", content: "Hello! Your device repair is complete, thoroughly tested, and ready for pickup at our store." },
                      { shortcut: "/thanks", title: "Thank You", content: "Thank you for choosing I-Store! Please let us know if you need any additional assistance." }
                    ]).map((qr, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleInsertQuickReply(qr.content)}
                        className="bg-white/5 hover:bg-white/10 text-slate-300 px-2.5 py-1 rounded-lg border border-white/5 whitespace-nowrap transition flex items-center gap-1"
                        title={qr.content}
                      >
                        <span className="font-mono text-cyan-400 font-bold">{qr.shortcut}</span>
                        <span className="text-slate-300">{qr.title}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowQuickReplyPicker(!showQuickReplyPicker)}
                      className="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-bold px-2.5 py-1 rounded-lg border border-amber-500/30 transition flex items-center gap-1"
                    >
                      <Zap size={12} /> All ({quickReplies.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingQuickReply(null);
                        setQuickReplyForm({ shortcut: "", title: "", content: "", category: "general" });
                        setShowQuickReplyModal(true);
                      }}
                      className="text-xs bg-white/5 hover:bg-white/10 text-slate-300 font-bold px-2 py-1 rounded-lg border border-white/10 transition flex items-center gap-1"
                      title="Manage Canned Replies"
                    >
                      <Plus size={12} /> New
                    </button>
                  </div>
                </div>

                {/* Quick Reply Selector Popover / Drawer */}
                {showQuickReplyPicker && (
                  <div className="p-3 bg-slate-900 border-t border-white/10 space-y-2 max-h-56 overflow-y-auto">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center gap-1">
                        <Zap size={13} className="text-amber-400" /> Select Canned Response Shortcut
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowQuickReplyPicker(false)}
                        className="text-slate-400 hover:text-white p-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {quickReplies.map(qr => (
                        <div
                          key={qr.id}
                          onClick={() => handleInsertQuickReply(qr.content)}
                          className="p-2.5 bg-slate-950/70 hover:bg-emerald-950/40 border border-white/5 hover:border-emerald-500/30 rounded-xl cursor-pointer transition space-y-1 group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-cyan-400">{qr.shortcut}</span>
                            <span className="text-[10px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded font-mono uppercase">{qr.category}</span>
                          </div>
                          <p className="text-xs font-bold text-white group-hover:text-emerald-300">{qr.title}</p>
                          <p className="text-[11px] text-slate-400 truncate">{qr.content}</p>
                        </div>
                      ))}
                      {quickReplies.length === 0 && (
                        <p className="text-xs text-slate-500 col-span-2 text-center py-2">No canned replies configured yet.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Attachment Preview Banner if File Selected */}
                {attachedFile && (
                  <div className="px-4 py-2 bg-slate-900/90 border-t border-emerald-500/30 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      {attachedFile.isImage ? (
                        <img src={attachedFile.previewUrl} alt="Preview" className="w-9 h-9 object-cover rounded-lg border border-white/20" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                          <FileText size={18} />
                        </div>
                      )}
                      <div className="truncate">
                        <p className="font-bold text-white truncate max-w-xs">{attachedFile.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{(attachedFile.size / 1024).toFixed(1)} KB • Ready to send</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveAttachedFile}
                      className="p-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 transition"
                      title="Remove attachment"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={chatFileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*,.pdf,.doc,.docx,.txt"
                  className="hidden"
                />

                {/* Live Message Input */}
                <form
                  onSubmit={handleSendChatMessage}
                  className="p-3.5 bg-slate-950 border-t border-white/10 flex items-end gap-2.5"
                >
                  {/* Media Attachment Button */}
                  <button
                    type="button"
                    onClick={() => chatFileInputRef.current?.click()}
                    className={`p-3 rounded-xl border transition flex items-center justify-center shrink-0 cursor-pointer ${
                      attachedFile
                        ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                        : "bg-slate-900 hover:bg-white/5 border-white/10 text-slate-400 hover:text-white"
                    }`}
                    title="Attach Image or PDF Document"
                  >
                    <Paperclip size={18} />
                  </button>

                  <div className="flex-1">
                    <textarea
                      rows={2}
                      value={chatInputText}
                      onChange={e => setChatInputText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChatMessage();
                        }
                      }}
                      placeholder={attachedFile ? `Add caption for ${attachedFile.name}...` : `Type message or / for shortcuts to +${selectedChatPhone}... (Enter to send)`}
                      className="w-full bg-slate-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition resize-none leading-relaxed"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={sendingChatMsg || (!chatInputText.trim() && !attachedFile) || status !== "CONNECTED"}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-[58px] px-5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer shrink-0 transition"
                  >
                    {sendingChatMsg ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <>
                        <Send size={15} />
                        <span>Send</span>
                      </>
                    )}
                  </Button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-xl shadow-emerald-950/20">
                  <MessageSquare size={32} />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h3 className="text-base font-black text-white">Select a WhatsApp Conversation</h3>
                  <p className="text-xs text-slate-400">
                    Choose a conversation thread from the left list to view the message history or reply in real-time.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: AUTOMATION RULES & EVENT TOGGLES ─────────────────────────── */}
      {activeTab === "automation" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Header Banner */}
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <SlidersHorizontal size={20} className="text-emerald-400" /> WhatsApp Event Automation Rules
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Toggle and configure automatic customer notifications triggered by ERP actions (Checkout, Repairs, Warranty, Security).
              </p>
            </div>

            <div className="flex items-center gap-2 self-stretch md:self-auto">
              <Button
                onClick={() => handleBulkToggleRules(rulesCategoryFilter, true)}
                className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5"
                disabled={loadingRules}
              >
                <Check size={14} /> Enable Category
              </Button>
              <Button
                onClick={() => handleBulkToggleRules(rulesCategoryFilter, false)}
                variant="outline"
                className="border-white/10 hover:bg-rose-500/10 hover:text-rose-300 text-slate-400 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5"
                disabled={loadingRules}
              >
                <X size={14} /> Mute Category
              </Button>
              <Button
                onClick={fetchAutomationRules}
                variant="outline"
                className="border-white/10 hover:bg-white/5 text-slate-300 px-3 py-2 rounded-xl"
                title="Refresh Rules"
              >
                <RefreshCw size={14} className={loadingRules ? "animate-spin text-cyan-400" : ""} />
              </Button>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {[
              { id: "all", label: "All Rules", icon: <Layers size={13} /> },
              { id: "sales", label: "Sales & POS", icon: <CreditCard size={13} /> },
              { id: "repairs", label: "Repairs", icon: <Wrench size={13} /> },
              { id: "warranty", label: "Warranty", icon: <Shield size={13} /> },
              { id: "payments", label: "Payments", icon: <CreditCard size={13} /> },
              { id: "security", label: "Security & Alerts", icon: <ShieldCheck size={13} /> },
              { id: "inventory", label: "Inventory", icon: <Tag size={13} /> },
              { id: "chatbot", label: "Chatbot & Away", icon: <Bot size={13} /> },
            ].map(cat => {
              const count = cat.id === "all"
                ? automationRules.length
                : automationRules.filter(r => r.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setRulesCategoryFilter(cat.id)}
                  className={`px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                    rulesCategoryFilter === cat.id
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-md"
                      : "bg-slate-900/60 text-slate-400 hover:text-white border border-white/5 hover:bg-white/5"
                  }`}
                >
                  {cat.icon} {cat.label} <span className="text-[10px] opacity-60 font-mono">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Automation Rules Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {automationRules
              .filter(r => rulesCategoryFilter === "all" || r.category === rulesCategoryFilter)
              .map(rule => {
                const isToggling = togglingRuleKey === rule.event_type;
                return (
                  <div
                    key={rule.id || rule.event_type}
                    className={`bg-slate-900/80 border rounded-2xl p-5 space-y-4 shadow-xl transition-all duration-200 flex flex-col justify-between ${
                      rule.is_enabled
                        ? "border-white/10 hover:border-emerald-500/30 shadow-emerald-950/10"
                        : "border-white/5 opacity-70 bg-slate-950/40"
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400">
                            {rule.category}
                          </span>
                          <h4 className="text-sm font-bold text-white leading-snug">{rule.name}</h4>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {rule.is_enabled ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> ACTIVE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 border border-white/10 px-2 py-0.5 rounded-full">
                              MUTED
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed font-sans min-h-[36px]">
                        {rule.description || `Automated dispatch for ${rule.event_type}`}
                      </p>

                      <div className="text-[11px] font-mono text-cyan-300/80 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-white/5 truncate">
                        ⚡ Trigger: {rule.event_type}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono">
                        {rule.is_enabled ? "Auto-sending enabled" : "Manual dispatch only"}
                      </span>

                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => handleToggleRule(rule.event_type, !rule.is_enabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          rule.is_enabled ? "bg-emerald-600" : "bg-slate-700"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            rule.is_enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── TAB: BOT BUILDER & AFTER-HOURS AWAY RULES ───────────────────────── */}
      {activeTab === "bot_builder" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Top Row: Away Responder + Sandbox Simulator */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* After-Hours Away Auto-Responder Card */}
            <div className="lg:col-span-7 bg-slate-900/80 border border-white/10 rounded-2xl p-6 space-y-5 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    <Moon size={18} className="text-indigo-400" /> After-Hours Away Auto-Responder
                  </h3>
                  <p className="text-xs text-slate-400">
                    Automatically reply when customers message outside store working hours.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-300">
                    {awaySettings.enabled ? "ACTIVE" : "OFF"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAwaySettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      awaySettings.enabled ? "bg-indigo-600" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${
                        awaySettings.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Working Hours Time Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Sun size={14} className="text-amber-400" /> Store Opens (Start Time)
                  </label>
                  <input
                    type="time"
                    value={awaySettings.start_time || "09:00"}
                    onChange={e => setAwaySettings(prev => ({ ...prev, start_time: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Moon size={14} className="text-indigo-400" /> Store Closes (End Time)
                  </label>
                  <input
                    type="time"
                    value={awaySettings.end_time || "20:00"}
                    onChange={e => setAwaySettings(prev => ({ ...prev, end_time: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              {/* Active Days Checkboxes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Calendar size={14} className="text-cyan-400" /> Working Business Days
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 0, label: "Mon" },
                    { id: 1, label: "Tue" },
                    { id: 2, label: "Wed" },
                    { id: 3, label: "Thu" },
                    { id: 4, label: "Fri" },
                    { id: 5, label: "Sat" },
                    { id: 6, label: "Sun" },
                  ].map(day => {
                    const daysArr = (awaySettings.active_days || "0,1,2,3,4,5,6").split(",").map(Number);
                    const isSelected = daysArr.includes(day.id);
                    return (
                      <button
                        key={day.id}
                        type="button"
                        onClick={() => {
                          const nextDays = isSelected
                            ? daysArr.filter(d => d !== day.id)
                            : [...daysArr, day.id].sort();
                          setAwaySettings(prev => ({ ...prev, active_days: nextDays.join(",") }));
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          isSelected
                            ? "bg-indigo-600 text-white shadow"
                            : "bg-slate-950 text-slate-400 border border-white/5 hover:text-white"
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Away Message Editor */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300">Away Auto-Reply Message</label>
                  <span className="text-[10px] text-slate-400">Supports *bold*, _italic_, placeholders</span>
                </div>
                <textarea
                  rows={4}
                  value={awaySettings.text}
                  onChange={e => setAwaySettings(prev => ({ ...prev, text: e.target.value }))}
                  placeholder="Enter message to send when customer writes outside business hours..."
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed resize-none"
                />
              </div>

              {/* Variable Chips */}
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="text-slate-500 text-[10px] font-bold py-0.5">Insert:</span>
                {["customer_name", "store_name", "store_phone", "current_time", "current_date"].map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAwaySettings(prev => ({ ...prev, text: (prev.text || "") + ` {{${v}}}` }))}
                    className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-2 py-0.5 rounded font-mono text-[10px]"
                  >
                    + {`{{${v}}}`}
                  </button>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveAwaySettings}
                  disabled={savingAwaySettings}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-indigo-950/40"
                >
                  {savingAwaySettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Away Responder
                </Button>
              </div>
            </div>

            {/* Interactive Bot Sandbox Simulator */}
            <div className="lg:col-span-5 bg-slate-900/80 border border-white/10 rounded-2xl p-6 space-y-5 shadow-xl flex flex-col justify-between">
              <div className="space-y-4">
                <div className="space-y-1 pb-3 border-b border-white/10">
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    <Sparkles size={18} className="text-amber-400" /> Interactive Bot Simulator
                  </h3>
                  <p className="text-xs text-slate-400">
                    Test what the bot responds with when a customer types different queries.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300">Simulate Customer Input</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={simulatedBotInput}
                      onChange={e => setSimulatedBotInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSimulateBot()}
                      placeholder="e.g. 'store hours', 'repairs', 'bank', '1'"
                      className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                    />
                    <Button
                      onClick={handleSimulateBot}
                      disabled={simulatingBot || !simulatedBotInput.trim()}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl flex items-center gap-1.5 shrink-0 shadow-lg shadow-amber-950/30"
                    >
                      {simulatingBot ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      Test
                    </Button>
                  </div>
                </div>

                {/* Simulated Output WhatsApp Bubble */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Simulated Bot Reply</span>
                  {simulatedBotReply ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 size={12} /> Matched Rule: {simulatedBotReply.rule}
                        </span>
                        <span className="font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded text-[10px] uppercase">
                          {simulatedBotReply.matchType}
                        </span>
                      </div>
                      <div className="bg-[#0b141a] p-3.5 rounded-2xl border border-emerald-500/30 shadow-xl max-w-full">
                        <div className="bg-[#005c4b] text-white p-3.5 rounded-2xl rounded-tr-sm text-xs space-y-1">
                          <FormattedWhatsAppText text={simulatedBotReply.text} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-950/60 border border-dashed border-white/10 rounded-2xl p-6 text-center text-xs text-slate-500 space-y-1">
                      <Bot size={24} className="mx-auto text-slate-600" />
                      <p>Type a test phrase above to preview simulated bot reply.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Sample Queries */}
              <div className="pt-3 border-t border-white/5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-500 font-bold">Samples:</span>
                {["1", "job status", "warranty", "store location", "bank", "hello"].map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      setSimulatedBotInput(q);
                      setTimeout(() => {
                        const query = q.toLowerCase();
                        let matchedRule = null;
                        const sorted = [...botRules].filter(r => r.is_active).sort((a, b) => (b.priority || 10) - (a.priority || 10));
                        for (const r of sorted) {
                          const kws = (r.keywords || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
                          if (r.match_type === "exact" && kws.includes(query)) { matchedRule = r; break; }
                          if (r.match_type === "startswith" && kws.some(k => query.startsWith(k))) { matchedRule = r; break; }
                          if (kws.some(k => query.includes(k))) { matchedRule = r; break; }
                        }
                        if (matchedRule) {
                          setSimulatedBotReply({ rule: matchedRule.name, matchType: matchedRule.match_type, text: formatWhatsappPreview(matchedRule.response_body) });
                        } else if (["1", "bill", "invoice"].includes(query)) {
                          setSimulatedBotReply({ rule: "Option 1: Digital Bill Lookup", matchType: "system", text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_bill_lookup")?.template_body || "🧾 *DIGITAL BILL*\n#INV-2026-000007\nTotal: LKR 1,500.00") });
                        } else if (["2", "repair", "job", "status", "job status"].includes(query)) {
                          setSimulatedBotReply({ rule: "Option 2: Live Repair Tracker", matchType: "system", text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_repair_status")?.template_body || "🛠️ *REPAIR STATUS*\nTicket: #REP-2026-889\nReady for Pickup") });
                        } else if (["3", "warranty"].includes(query)) {
                          setSimulatedBotReply({ rule: "Option 3: Active Warranty Check", matchType: "system", text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_warranty_check")?.template_body || "🛡️ *ACTIVE WARRANTIES*\nAirPods Pro Gen 2") });
                        } else if (["4", "hours", "location", "store location"].includes(query)) {
                          setSimulatedBotReply({ rule: "Option 4: Store Info & Hours", matchType: "system", text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_store_info")?.template_body || "📍 *STORE INFO*\nHours: 9:00 AM – 8:00 PM\nHotline: +94 77 123 4567") });
                        } else {
                          setSimulatedBotReply({ rule: "Default Greeting Menu", matchType: "fallback", text: formatWhatsappPreview(templates.find(t => t.event_type === "bot_greeting")?.template_body || "👋 *Hello Customer!*\nReply with 1, 2, 3, or 4.") });
                        }
                      }, 50);
                    }}
                    className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white px-2 py-0.5 rounded"
                  >
                    "{q}"
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom Card: Custom Keyword Rules Manager */}
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-6 space-y-5 shadow-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Bot size={18} className="text-emerald-400" /> Custom Keyword Trigger Rules ({botRules.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Define custom keyword matches that trigger instant responses before fallback to menu.
                </p>
              </div>

              <Button
                onClick={() => {
                  setEditingBotRule(null);
                  setBotRuleForm({
                    name: "",
                    keywords: "",
                    match_type: "contains",
                    response_body: "",
                    category: "custom",
                    priority: 10,
                    is_active: true
                  });
                  setShowBotRuleModal(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-950/40"
              >
                <Plus size={14} /> New Keyword Rule
              </Button>
            </div>

            {/* Bot Rules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {botRules.map(rule => (
                <div
                  key={rule.id}
                  className={`bg-slate-950/70 border rounded-2xl p-4 space-y-3 flex flex-col justify-between transition ${
                    rule.is_active ? "border-white/10 hover:border-emerald-500/40" : "border-white/5 opacity-60"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-bold text-white truncate">{rule.name}</h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10 uppercase">
                        {rule.match_type}
                      </span>
                    </div>

                    {/* Keywords Badges */}
                    <div className="flex flex-wrap gap-1">
                      {(rule.keywords || "").split(",").map((kw, i) => (
                        <span key={i} className="text-[10px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-md font-bold">
                          {kw.trim()}
                        </span>
                      ))}
                    </div>

                    <div className="bg-slate-900 p-2.5 rounded-xl border border-white/5 text-slate-300 text-xs font-sans max-h-24 overflow-y-auto leading-relaxed">
                      {rule.response_body}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleBotRule(rule)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border transition ${
                          rule.is_active
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            : "bg-slate-800 text-slate-400 border-white/10"
                        }`}
                      >
                        {rule.is_active ? "ACTIVE" : "PAUSED"}
                      </button>
                      <span className="text-[10px] text-slate-500 font-mono">P{rule.priority || 10}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBotRule(rule);
                          setBotRuleForm({
                            name: rule.name,
                            keywords: rule.keywords,
                            match_type: rule.match_type || "contains",
                            response_body: rule.response_body,
                            category: rule.category || "custom",
                            priority: rule.priority || 10,
                            is_active: rule.is_active
                          });
                          setShowBotRuleModal(true);
                        }}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition"
                        title="Edit Rule"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBotRule(rule.id)}
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition"
                        title="Delete Rule"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {botRules.length === 0 && (
                <div className="col-span-3 text-center py-10 bg-slate-950/40 border border-dashed border-white/10 rounded-2xl text-xs text-slate-500 space-y-2">
                  <Bot size={28} className="mx-auto text-slate-600" />
                  <p className="font-bold text-slate-400">No Custom Keyword Rules Added Yet</p>
                  <p>Click "New Keyword Rule" above to create automated replies for questions like pricing, bank info, or directions.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: SMART MESSENGER ─────────────────────────────────────────── */}
      {activeTab === "messenger" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-slate-900/80 border border-white/10 rounded-2xl p-6 space-y-5 shadow-xl">
            <div>
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <Send size={18} className="text-emerald-400" /> Smart Message Composer
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Dispatch personalized WhatsApp messages with real-time phone normalization and variable resolution.
              </p>
            </div>

            {status !== "CONNECTED" && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-rose-300 text-xs font-semibold flex items-center gap-2">
                <XCircle size={15} /> WhatsApp is offline. Messages cannot be sent until session is connected.
              </div>
            )}

            <form onSubmit={handleSendDirect} className="space-y-4">
              {/* Central Customer Dropdown */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Search Customer (Optional):
                </label>
                <CustomerSelect
                  size="md"
                  className="w-full"
                  value={selectedCustomerId}
                  onChange={(e) => {
                    const cid = e.target.value;
                    setSelectedCustomerId(cid);
                    if (!cid) return;
                    const c = customers.find((cust) => String(cust.id) === String(cid));
                    if (c) {
                      setDirectPhone(c.phone || c.whatsapp_number || "");
                      setNumberStatus(null);
                    }
                  }}
                  customers={customers}
                  placeholder="-- Select / Search Customer (Optional) --"
                  searchPlaceholder="Search customer by name or phone..."
                />
              </div>

              {/* Recipient Phone & Validate Button */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Recipient Phone Number:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. 0764158980 or 94764158980"
                    value={directPhone}
                    onChange={e => { setDirectPhone(e.target.value); setNumberStatus(null); }}
                    className="flex-1 bg-slate-950 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-emerald-500 focus:outline-none font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleCheckNumber}
                    disabled={!directPhone.trim() || checkingNumber || status !== "CONNECTED"}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40 transition font-bold"
                  >
                    {checkingNumber ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />}
                    Verify WA
                  </button>
                </div>

                {numberStatus && (
                  <div className={`mt-2 flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${
                    numberStatus.isRegistered
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                      : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
                  }`}>
                    {numberStatus.isRegistered ? <CheckCheck size={14} /> : <XCircle size={14} />}
                    <span>{numberStatus.isRegistered ? `+${numberStatus.phone} is active on WhatsApp.` : `+${numberStatus.phone} is NOT registered on WhatsApp.`}</span>
                  </div>
                )}
              </div>

              {/* Optional Context Linking */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Linked Invoice # (Optional):</label>
                  <input
                    type="text"
                    placeholder="INV-2026-000001"
                    value={directInvoice}
                    onChange={e => setDirectInvoice(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Linked Repair # (Optional):</label>
                  <input
                    type="text"
                    placeholder="REP-2026-889"
                    value={directRepair}
                    onChange={e => setDirectRepair(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              {/* Message Body */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Message Content:</label>
                <textarea
                  rows={6}
                  placeholder="Type your WhatsApp message..."
                  value={directMessage}
                  onChange={e => setDirectMessage(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-emerald-500 focus:outline-none leading-relaxed font-sans"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={sendingDirect || status !== "CONNECTED"}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 flex items-center justify-center gap-2 rounded-xl transition shadow-lg shadow-emerald-950/40 cursor-pointer"
              >
                {sendingDirect
                  ? <><Loader2 size={16} className="animate-spin" /> Dispatching via Provider Pipeline...</>
                  : <><Send size={16} /> Send WhatsApp Message</>}
              </Button>
            </form>
          </div>

          {/* Live Preview */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-950 border border-white/10 rounded-2xl p-5 shadow-2xl">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Sparkles size={14} className="text-emerald-400" /> WhatsApp Live Bubble Preview
              </p>
              <div className="bg-[#0b141a] rounded-2xl p-4 border border-[#1f2c34] min-h-[180px] flex justify-end">
                <div className="bg-[#005c4b] text-slate-100 p-3.5 rounded-xl max-w-sm shadow-md text-xs whitespace-pre-wrap font-sans relative border-t border-[#007a63] leading-relaxed">
                  {directMessage ? formatWhatsappPreview(directMessage) : <span className="text-slate-400 italic">Preview will appear here as you type...</span>}
                  <div className="text-[10px] text-emerald-200/60 text-right mt-1.5 font-mono">
                    12:45 PM ✓✓
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 text-xs text-slate-400 space-y-2">
              <p className="font-bold text-white flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-400" /> WhatsApp Delivery Safeguards
              </p>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                <li>3-second anti-spam throttling between consecutive sends.</li>
                <li>E.164 automatic number formatting for local and international SIMs.</li>
                <li>Real-time ACK status confirmation before closing.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: TEMPLATES & VARIABLES (CUSTOMIZATION STUDIO) ─────────────── */}
      {activeTab === "templates" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Template Catalog & Filter */}
          <div className="lg:col-span-4 bg-slate-900/80 border border-white/10 rounded-3xl p-6 flex flex-col space-y-4 shadow-2xl backdrop-blur-xl">
            {/* Catalog Header & Category Selector */}
            <div className="space-y-3.5 pb-4 border-b border-white/10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-md">
                    <SlidersHorizontal size={17} />
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-white">Templates</h3>
                    <p className="text-[11px] text-slate-400 font-medium">{templates.length} system & bot templates</p>
                  </div>
                </div>

                <Select
                  size="sm"
                  fullWidth={false}
                  minWidth={140}
                  value={templateCategory}
                  onChange={e => setTemplateCategory(e.target.value)}
                  options={[
                    { value: "all", label: "All Categories" },
                    { value: "chatbot", label: "🤖 Bot Menu & Replies" },
                    { value: "sales", label: "🧾 Sales & Billing" },
                    { value: "repairs", label: "🛠️ Repair Center" },
                    { value: "warranty", label: "🛡️ Warranty Alerts" },
                    { value: "payments", label: "💳 Payments" },
                    { value: "customer", label: "👤 Customer Care" },
                    { value: "system", label: "⚠️ Security & Alerts" }
                  ]}
                />
              </div>

              {/* Template Search Bar */}
              <div className="relative pt-1">
                <Search size={14} className="absolute left-3.5 top-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search template name, event, keyword..."
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                  className="w-full bg-slate-950/80 border border-white/10 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition shadow-inner"
                />
              </div>
            </div>

            {/* Template Card List */}
            <div className="space-y-3 max-h-[620px] overflow-y-auto pr-2">
              {templates
                .filter(tmpl => {
                  if (!templateSearch.trim()) return true;
                  const q = templateSearch.toLowerCase();
                  return (
                    (tmpl.name || "").toLowerCase().includes(q) ||
                    (tmpl.event_type || "").toLowerCase().includes(q) ||
                    (tmpl.description || "").toLowerCase().includes(q) ||
                    (tmpl.category || "").toLowerCase().includes(q)
                  );
                })
                .map(tmpl => {
                  const isSelected = selectedEventType === tmpl.event_type;
                  const cat = (tmpl.category || "sales").toLowerCase();
                  const catConfig = {
                    chatbot: { bg: "bg-purple-500/20 text-purple-300 border-purple-500/30", label: "BOT MENU" },
                    sales: { bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", label: "SALES" },
                    repairs: { bg: "bg-amber-500/20 text-amber-300 border-amber-500/30", label: "REPAIRS" },
                    warranty: { bg: "bg-sky-500/20 text-sky-300 border-sky-500/30", label: "WARRANTY" },
                    payments: { bg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30", label: "PAYMENT" },
                    customer: { bg: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30", label: "CUSTOMER" },
                    system: { bg: "bg-rose-500/20 text-rose-300 border-rose-500/30", label: "SECURITY" },
                  }[cat] || { bg: "bg-slate-700/50 text-slate-400 border-white/10", label: cat.toUpperCase() };

                  return (
                    <button
                      key={tmpl.event_type}
                      onClick={() => handleSelectTemplate(tmpl)}
                      className={`w-full text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-emerald-500/15 border-emerald-500/60 text-white shadow-xl shadow-emerald-950/50 ring-1 ring-emerald-500/30"
                          : "bg-slate-950/40 border-white/5 text-slate-300 hover:bg-white/5 hover:border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${tmpl.is_active ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                          <span className="text-xs font-bold text-white truncate">{tmpl.name}</span>
                        </div>
                        <span className={`text-[9px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider border shrink-0 ${catConfig.bg}`}>
                          {catConfig.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mt-1">{tmpl.description || "Automated WhatsApp notification"}</p>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Right Column: Customization Studio & Live Preview */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-7 space-y-6 shadow-2xl backdrop-blur-xl">
              {/* Studio Header */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-lg font-black text-white tracking-tight">{currentTemplate.name || "Template Editor"}</h3>
                    <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded-md font-semibold">
                      {selectedEventType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{currentTemplate.description || "Customize message text and placeholders below."}</p>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer font-bold bg-slate-950/60 border border-white/10 px-4 py-2 rounded-xl hover:border-emerald-500/40 transition shadow-sm">
                    <input
                      type="checkbox"
                      checked={editedActive}
                      onChange={e => setEditedActive(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 bg-slate-900 border-white/10 cursor-pointer"
                    />
                    <span className={editedActive ? "text-emerald-300" : "text-slate-400"}>
                      {editedActive ? "Active & Auto-Triggering" : "Paused"}
                    </span>
                  </label>

                  <button
                    onClick={handleResetTemplate}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-rose-300 bg-white/5 hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/30 px-3.5 py-2 rounded-xl transition cursor-pointer"
                    title="Restore default text"
                  >
                    <RotateCcw size={13} /> Reset Default
                  </button>
                </div>
              </div>

              {/* Categorized Variable Insert Palette */}
              <div className="space-y-3 bg-slate-950/60 border border-white/10 rounded-2xl p-4.5 shadow-inner">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
                    <Zap size={15} className="text-amber-400" /> Insert Dynamic Variables (Click to insert at cursor):
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { id: "all", label: "🌟 Recommended" },
                      { id: "customer", label: "👤 Customer" },
                      { id: "sales", label: "🧾 Billing" },
                      { id: "repairs", label: "🛠️ Repairs" },
                      { id: "warranty", label: "🛡️ Warranty" },
                      { id: "store", label: "🏬 Store" }
                    ].map(g => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setActiveVariableGroup(g.id)}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          activeVariableGroup === g.id
                            ? "bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-950/40"
                            : "bg-white/5 text-slate-400 hover:text-white"
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Variable Buttons */}
                <div className="flex flex-wrap gap-2 max-h-[110px] overflow-y-auto pr-1">
                  {(activeVariableGroup === "all"
                    ? (currentTemplate.variables || ["customer_name", "store_name", "invoice_number", "invoice_total", "smart_bill_url", "store_phone"])
                    : activeVariableGroup === "customer"
                    ? ["customer_name", "customer_phone"]
                    : activeVariableGroup === "sales"
                    ? ["invoice_number", "invoice_date", "invoice_total", "subtotal", "discount_amount", "paid_amount", "balance_due", "payment_method", "smart_bill_url"]
                    : activeVariableGroup === "repairs"
                    ? ["job_number", "device_model", "reported_issue", "repair_status", "status_note", "estimated_cost", "advance_paid", "balance_due", "repair_tracking_url"]
                    : activeVariableGroup === "warranty"
                    ? ["product_name", "serial_number", "expiry_date"]
                    : ["store_name", "store_phone", "store_address", "store_website"]
                  ).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => handleInsertVariable(v)}
                      className="bg-emerald-500/10 hover:bg-emerald-500/25 active:scale-95 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 text-[11px] font-mono font-semibold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                      title={`Click to insert {{${v}}}`}
                    >
                      <Plus size={11} className="text-emerald-400" />
                      <span>{`{{${v}}}`}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Formatting Quick-Bar & Emoji Tools */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 border border-white/5 p-3 rounded-2xl text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-400 mr-1">Format:</span>
                  <button
                    type="button"
                    onClick={() => handleFormatWrap("*")}
                    className="p-1.5 bg-white/5 hover:bg-white/10 text-slate-200 rounded-lg font-black text-[11px] px-2.5 flex items-center gap-1.5 transition cursor-pointer"
                    title="Bold (*text*)"
                  >
                    <Bold size={12} /> Bold
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormatWrap("_")}
                    className="p-1.5 bg-white/5 hover:bg-white/10 text-slate-200 rounded-lg italic text-[11px] px-2.5 flex items-center gap-1.5 transition cursor-pointer"
                    title="Italic (_text_)"
                  >
                    <Italic size={12} /> Italic
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFormatWrap("~")}
                    className="p-1.5 bg-white/5 hover:bg-white/10 text-slate-200 rounded-lg text-[11px] px-2.5 flex items-center gap-1.5 transition cursor-pointer"
                    title="Strikethrough (~text~)"
                  >
                    <Strikethrough size={12} /> Strike
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertEmoji("• ")}
                    className="p-1.5 bg-white/5 hover:bg-white/10 text-slate-200 rounded-lg text-[11px] px-2.5 flex items-center gap-1.5 transition cursor-pointer"
                    title="Bullet point"
                  >
                    <List size={12} /> Bullet
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertEmoji("\n━━━━━━━━━━━━━━━━━━━━\n")}
                    className="p-1.5 bg-white/5 hover:bg-white/10 text-slate-200 rounded-lg text-[11px] px-2.5 font-mono transition cursor-pointer"
                    title="Divider line"
                  >
                    ━━ Line
                  </button>
                </div>

                {/* Quick Emoji Bar */}
                <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                  <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
                    <Smile size={12} />
                  </span>
                  {["🧾", "🛍️", "📱", "🛠️", "🔍", "⚡", "💰", "💳", "✅", "🎉", "🛡️", "📍", "⏰", "📞", "⚠️", "⭐", "🙏", "📋", "📝"].map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => handleInsertEmoji(e)}
                      className="hover:scale-125 transition-transform text-sm p-1 cursor-pointer"
                      title={`Insert ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <label className="font-semibold text-slate-300">Message Template Body (WhatsApp Markdown):</label>
                  <span className="font-mono text-[11px] text-slate-400">
                    {editedBody.length} characters • {(editedBody.match(/{{[^{}]+}}/g) || []).length} variables
                  </span>
                </div>
                <textarea
                  ref={templateTextareaRef}
                  rows={9}
                  value={editedBody}
                  onChange={e => setEditedBody(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-2xl p-4.5 text-sm text-slate-100 font-mono leading-relaxed focus:border-emerald-500 focus:outline-none transition shadow-inner"
                  placeholder="Type your message template text or click variables above..."
                />
              </div>

              {/* Bottom Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
                <div className="flex items-center gap-2">
                  {feedback && (
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Check size={14} /> {feedback}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSaveTemplate}
                    disabled={savingTemplate}
                    className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black flex items-center gap-2 px-6 py-2.5 rounded-xl cursor-pointer shadow-lg shadow-emerald-950/40"
                  >
                    {savingTemplate ? <Loader2 size={16} className="animate-spin text-slate-950" /> : <Save size={16} />}
                    Save & Deploy Template
                  </Button>
                </div>
              </div>
            </div>

            {/* Live WhatsApp Preview & Test Dispatcher */}
            <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-7 space-y-5 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-white/10">
                <div>
                  <p className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Sparkles size={16} className="text-emerald-400" /> Live WhatsApp Mobile Simulation
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Real-time preview formatted exactly as customers see it on their WhatsApp app.</p>
                </div>

                {/* Test Dispatch to Physical Phone */}
                <div className="flex items-center gap-2.5">
                  <input
                    type="text"
                    placeholder="Test phone (e.g. 94785571342)"
                    value={testPhoneInput}
                    onChange={e => setTestPhoneInput(e.target.value)}
                    className="bg-slate-950 border border-white/10 rounded-xl px-3.5 py-1.5 text-xs text-white w-48 focus:outline-none focus:border-emerald-500 shadow-inner"
                  />
                  <Button
                    onClick={handleSendTestPreview}
                    disabled={sendingTestPreview}
                    size="sm"
                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 px-4 py-2 rounded-xl cursor-pointer transition shadow-md"
                    title="Send a live test of this template to your WhatsApp"
                  >
                    {sendingTestPreview ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Send Test to Phone
                  </Button>
                </div>
              </div>

              {/* Chat Screen Container */}
              <div className="bg-[#0b141a] rounded-3xl border border-[#1f2c34] overflow-hidden shadow-2xl">
                {/* Chat Top Bar */}
                <div className="bg-[#1f2c34] px-5 py-3 flex items-center justify-between border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shadow-md">
                      <MessageSquare size={14} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">Nexusis Technologies</h4>
                      <p className="text-[10px] text-emerald-400 font-medium">I-Store Official Business Account</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded">
                    Preview Mode
                  </span>
                </div>

                {/* Message Canvas */}
                <div className="p-6 md:p-8 flex justify-end bg-[radial-gradient(#1f2c34_1px,transparent_1px)] [background-size:16px_16px] min-h-[180px]">
                  <div className="bg-[#005c4b] text-slate-100 p-4.5 rounded-2xl rounded-tr-xs max-w-xl shadow-2xl relative border-t border-[#007a63]">
                    {renderFormattedBubble(editedBody)}
                    <div className="text-[10px] text-emerald-200/70 text-right mt-3 font-mono flex items-center justify-end gap-1 select-none">
                      <span>01:45 AM</span>
                      <CheckCheck size={14} className="text-cyan-300 inline shrink-0" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 4: AUDIT TRAIL & PIPELINE TRACER ───────────────────────────── */}
      {activeTab === "logs" && (
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <Clock size={18} className="text-emerald-400" /> Message Dispatch History & Audit Trail
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Click on any message row to inspect its full step-by-step pipeline execution trace.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-3 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search phone, ID, invoice..."
                  value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  className="bg-slate-950 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <Select
                size="sm"
                fullWidth={false}
                minWidth={130}
                value={logStatusFilter}
                onChange={e => setLogStatusFilter(e.target.value)}
                options={[
                  { value: "ALL", label: "All Statuses" },
                  { value: "SENT", label: "Sent" },
                  { value: "DELIVERED", label: "Delivered" },
                  { value: "READ", label: "Read" },
                  { value: "FAILED", label: "Failed" },
                  { value: "QUEUED", label: "Queued" }
                ]}
              />

              <Select
                size="sm"
                fullWidth={false}
                minWidth={140}
                value={logCategoryFilter}
                onChange={e => setLogCategoryFilter(e.target.value)}
                options={[
                  { value: "all", label: "All Categories" },
                  { value: "sales", label: "Sales" },
                  { value: "repairs", label: "Repairs" },
                  { value: "warranty", label: "Warranty" },
                  { value: "payments", label: "Payments" },
                  { value: "system", label: "System" }
                ]}
              />

              <button
                onClick={fetchLogs}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
              >
                <RefreshCw size={14} className={loadingLogs ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-white/10 rounded-xl bg-slate-950/40">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-black/40 text-slate-400 font-bold uppercase text-[10px] tracking-wider border-b border-white/10">
                <tr>
                  <th className="p-3.5">Time</th>
                  <th className="p-3.5">Recipient</th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5">Event</th>
                  <th className="p-3.5">Message Content</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map(log => (
                  <tr
                    key={log.id}
                    onClick={() => handleOpenTrace(log.id)}
                    className="hover:bg-white/5 transition-colors cursor-pointer group"
                  >
                    <td className="p-3.5 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="p-3.5">
                      <p className="font-bold text-white">{log.customer_name || "—"}</p>
                      <p className="font-mono text-[11px] text-slate-400">+{log.phone_number}</p>
                    </td>
                    <td className="p-3.5 whitespace-nowrap">
                      <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 uppercase">
                        {log.category || "sales"}
                      </span>
                    </td>
                    <td className="p-3.5 whitespace-nowrap">
                      <span className="font-bold text-slate-200">{log.template_name || log.event_type}</span>
                      {log.invoice_no && <span className="block text-[10px] font-mono text-cyan-400">{log.invoice_no}</span>}
                      {log.repair_no && <span className="block text-[10px] font-mono text-amber-400">{log.repair_no}</span>}
                    </td>
                    <td className="p-3.5 max-w-xs truncate text-slate-300 font-sans text-xs">
                      {log.message_body}
                    </td>
                    <td className="p-3.5 whitespace-nowrap">
                      <MsgStatusBadge status={log.status} />
                      {log.error_detail && (
                        <p className="text-[10px] text-rose-400/70 mt-0.5 max-w-[160px] truncate" title={log.error_detail}>
                          {log.error_detail}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5 text-right space-x-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenTrace(log.id)}
                        className="bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-white/10 transition inline-flex items-center gap-1"
                        title="View Execution Trace"
                      >
                        <Eye size={12} /> Trace
                      </button>
                      {log.status === "FAILED" && (
                        <button
                          onClick={() => handleRetryLog(log.id)}
                          className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-emerald-500/30 transition"
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center p-8 text-slate-500">
                      No message logs found matching criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 5: DIAGNOSTICS & QR PAIRING ────────────────────────────────── */}
      {activeTab === "diagnostics" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Automated Pipeline Diagnostics */}
          <div className="lg:col-span-7 bg-slate-900/80 border border-white/10 rounded-2xl p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-400" /> Automated Pipeline Diagnostics
                </h3>
                <p className="text-xs text-slate-400 mt-1">Run an 8-step end-to-end audit verifying every component in the WhatsApp dispatch chain.</p>
              </div>
              <Button
                onClick={handleRunDiagnostics}
                disabled={runningDiagnostics}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center gap-2 text-xs rounded-xl cursor-pointer"
              >
                {runningDiagnostics ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Run Full Diagnostic
              </Button>
            </div>

            {diagnosticResults ? (
              <div className="space-y-3">
                <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                  diagnosticResults.overall_health === "HEALTHY"
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                    : "bg-amber-500/15 border-amber-500/30 text-amber-300"
                }`}>
                  <span>Overall Health: {diagnosticResults.overall_health}</span>
                  <span className="font-mono text-[11px] text-slate-400">{new Date(diagnosticResults.timestamp).toLocaleTimeString()}</span>
                </div>

                <div className="divide-y divide-white/5 border border-white/10 rounded-xl bg-slate-950/40">
                  {diagnosticResults.results.map((r, i) => (
                    <div key={i} className="p-3 flex items-start justify-between gap-3 text-xs">
                      <div>
                        <span className="font-bold text-white">{r.step}</span>
                        <p className="text-[11px] text-slate-400 mt-0.5">{r.detail}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-extrabold text-[10px] uppercase ${
                        r.status === "PASS"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : r.status === "WARN"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : r.status === "SKIP"
                          ? "bg-slate-700/50 text-slate-400"
                          : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      }`}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/40 border border-dashed border-white/10 rounded-xl p-8 text-center text-xs text-slate-400 space-y-2">
                <ShieldCheck size={28} className="mx-auto text-slate-500" />
                <p className="font-bold text-slate-300">No Diagnostic Run Yet</p>
                <p>Click "Run Full Diagnostic" above to verify backend, session, normalizer, and WhatsApp transport readiness.</p>
              </div>
            )}
          </div>

          {/* Device QR Pairing */}
          <div className="lg:col-span-5 bg-slate-900/80 border border-white/10 rounded-2xl p-6 text-center space-y-5 shadow-xl">
            <div>
              <h3 className="text-lg font-black text-white flex items-center justify-center gap-2">
                <QrCode size={18} className="text-emerald-400" /> Device Pairing
              </h3>
              <p className="text-xs text-slate-400 mt-1">Link your store phone to auto-send receipts without third-party fees.</p>
            </div>

            {status === "CONNECTED" && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                  <ShieldCheck size={24} />
                </div>
                <h4 className="text-lg font-bold text-emerald-300">WhatsApp Client Connected</h4>
                {connectedUser && (
                  <>
                    <p className="text-xs text-slate-300">
                      Account: <strong className="text-white">{connectedUser.pushname}</strong>
                    </p>
                    <p className="text-xs text-slate-400 font-mono">+{connectedUser.wid}</p>
                    {connectedUser.platform && (
                      <p className="text-[11px] text-slate-500">Platform: {connectedUser.platform}</p>
                    )}
                  </>
                )}
                <p className="text-xs text-slate-400">Messages will auto-dispatch in background.</p>
              </div>
            )}

            {status === "UNPAIRED" && qrCodeUrl && (
              <div className="bg-slate-950 border border-white/10 rounded-2xl p-5 space-y-3">
                <img
                  src={qrCodeUrl}
                  alt="WhatsApp QR Code"
                  className="w-52 h-52 mx-auto rounded-xl border-4 border-white shadow-2xl"
                />
                <div className="text-left bg-black/40 p-3.5 rounded-xl space-y-1 text-xs text-slate-300">
                  <p className="font-bold text-emerald-400">How to Pair:</p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px]">
                    <li>Open WhatsApp on store mobile phone.</li>
                    <li>Tap <strong>Settings / Linked Devices</strong>.</li>
                    <li>Scan this QR code.</li>
                  </ol>
                </div>
              </div>
            )}

            {status === "OFFLINE" && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-rose-300 text-xs space-y-2">
                <p className="font-bold text-sm">Microservice Offline</p>
                <p>Ensure <code className="bg-black/40 px-1.5 py-0.5 rounded">node server.js</code> is running on port 3001.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STEP-BY-STEP PIPELINE TRACE MODAL ──────────────────────────────── */}
      {inspectingTrace && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl w-full max-w-xl p-6 text-slate-100 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Activity size={18} className="text-emerald-400" /> End-to-End Message Pipeline Trace
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {inspectingTrace.id}</p>
              </div>
              <button
                onClick={() => setInspectingTrace(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/60 p-3.5 rounded-xl border border-white/5">
              <div>
                <span className="text-slate-500">Recipient:</span>{" "}
                <strong className="text-white font-mono">+{inspectingTrace.phone}</strong>
              </div>
              <div>
                <span className="text-slate-500">Event:</span>{" "}
                <strong className="text-emerald-300">{inspectingTrace.event}</strong>
              </div>
              <div>
                <span className="text-slate-500">Final Status:</span>{" "}
                <MsgStatusBadge status={inspectingTrace.status} />
              </div>
              <div>
                <span className="text-slate-500">Message ID:</span>{" "}
                <span className="text-slate-300 font-mono text-[11px]">{inspectingTrace.message_id || "N/A"}</span>
              </div>
            </div>

            {/* Visual Step Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Execution Timeline</h4>
              
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/10">
                {(inspectingTrace.trace || []).map((step, idx) => (
                  <div key={idx} className="relative">
                    <div className={`absolute -left-6 top-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      step.status === "OK"
                        ? "bg-emerald-950 border-emerald-400 text-emerald-400"
                        : "bg-rose-950 border-rose-400 text-rose-400"
                    }`}>
                      {step.status === "OK" ? <Check size={10} /> : <XCircle size={10} />}
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white font-mono">{step.step}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {formatDateTime(step.time)}
                        </span>
                      </div>
                      {step.detail && (
                        <p className="text-[11px] text-slate-400 mt-0.5 font-sans">{step.detail}</p>
                      )}
                    </div>
                  </div>
                ))}

                {(!inspectingTrace.trace || inspectingTrace.trace.length === 0) && (
                  <p className="text-xs text-slate-500 italic">No detailed steps recorded for this legacy log entry.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => setInspectingTrace(null)}
                className="bg-white/10 hover:bg-white/15 text-white font-bold text-xs px-5 rounded-xl"
              >
                Close Trace
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE / EDIT QUICK REPLY ───────────────────────────────── */}
      {showQuickReplyModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl w-full max-w-lg p-6 text-slate-100 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Zap size={18} className="text-amber-400" />
                {editingQuickReply ? "Edit Canned Quick Reply" : "New Canned Quick Reply"}
              </h3>
              <button
                onClick={() => setShowQuickReplyModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveQuickReply} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Shortcut Command</label>
                  <input
                    type="text"
                    required
                    placeholder="/shortcut"
                    value={quickReplyForm.shortcut}
                    onChange={e => setQuickReplyForm(prev => ({ ...prev, shortcut: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-[10px] text-slate-500 font-mono">e.g. /bank, /hours</span>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Category</label>
                  <select
                    value={quickReplyForm.category}
                    onChange={e => setQuickReplyForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="general">General</option>
                    <option value="payments">Payments & Bank</option>
                    <option value="repairs">Repairs</option>
                    <option value="warranty">Warranty</option>
                    <option value="support">Support</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">Snippet Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Commercial Bank Details"
                  value={quickReplyForm.title}
                  onChange={e => setQuickReplyForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">Response Text Body</label>
                <textarea
                  rows={5}
                  required
                  placeholder="Enter the canned reply text that will be inserted when using this shortcut..."
                  value={quickReplyForm.content}
                  onChange={e => setQuickReplyForm(prev => ({ ...prev, content: e.target.value }))}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-amber-500 font-sans leading-relaxed resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <Button
                  type="button"
                  onClick={() => setShowQuickReplyModal(false)}
                  variant="outline"
                  className="border-white/10 text-slate-300 text-xs px-4"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={savingQuickReply}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-5"
                >
                  {savingQuickReply ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Shortcut
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE / EDIT CUSTOM BOT RULE ────────────────────────────── */}
      {showBotRuleModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl w-full max-w-lg p-6 text-slate-100 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Bot size={18} className="text-emerald-400" />
                {editingBotRule ? "Edit Keyword Bot Rule" : "New Keyword Bot Trigger"}
              </h3>
              <button
                onClick={() => setShowBotRuleModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveBotRule} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Rule Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Bank Payment Inquiry"
                    value={botRuleForm.name}
                    onChange={e => setBotRuleForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Match Mode</label>
                  <select
                    value={botRuleForm.match_type}
                    onChange={e => setBotRuleForm(prev => ({ ...prev, match_type: e.target.value }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="contains">Contains Keyword</option>
                    <option value="exact">Exact Match Only</option>
                    <option value="startswith">Starts With Keyword</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300">Trigger Keywords (comma-separated)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. bank, transfer, account number, payment slip"
                  value={botRuleForm.keywords}
                  onChange={e => setBotRuleForm(prev => ({ ...prev, keywords: e.target.value }))}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
                <span className="text-[10px] text-slate-500 font-mono">Matches any of these words in customer messages</span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300">Automated Bot Response</label>
                  <span className="text-[10px] text-slate-400">Supports *bold*, _italic_, placeholders</span>
                </div>
                <textarea
                  rows={5}
                  required
                  placeholder="Enter the automated reply text..."
                  value={botRuleForm.response_body}
                  onChange={e => setBotRuleForm(prev => ({ ...prev, response_body: e.target.value }))}
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500 font-sans leading-relaxed resize-none"
                />
              </div>

              {/* Variable Chips */}
              <div className="flex flex-wrap gap-1 text-[10px]">
                <span className="text-slate-500 font-bold py-0.5">Insert:</span>
                {["customer_name", "store_name", "store_phone", "store_address", "store_website"].map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBotRuleForm(prev => ({ ...prev, response_body: (prev.response_body || "") + ` {{${v}}}` }))}
                    className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-1.5 py-0.5 rounded font-mono"
                  >
                    + {`{{${v}}}`}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300">Priority Score (1-100)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={botRuleForm.priority}
                    onChange={e => setBotRuleForm(prev => ({ ...prev, priority: parseInt(e.target.value) || 10 }))}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="rule_active"
                    checked={botRuleForm.is_active}
                    onChange={e => setBotRuleForm(prev => ({ ...prev, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 bg-slate-950 border-white/10"
                  />
                  <label htmlFor="rule_active" className="text-xs font-bold text-slate-300 cursor-pointer">
                    Rule is Active & Enabled
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <Button
                  type="button"
                  onClick={() => setShowBotRuleModal(false)}
                  variant="outline"
                  className="border-white/10 text-slate-300 text-xs px-4"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={savingBotRule}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5"
                >
                  {savingBotRule ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Rule
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
