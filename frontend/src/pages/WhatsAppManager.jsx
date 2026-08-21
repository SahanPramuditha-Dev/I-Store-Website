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
  Filter,
  BookOpen,
  UserCheck,
  Megaphone,
  Users,
  Target,
  ShieldAlert
} from "lucide-react";
import { Button, Input, Select, CustomerSelect } from "../components/UI";
import { useFeedback } from "../components/FeedbackProvider";
import { useFetch } from "../hooks/useFetch";
import api from "../lib/api";
import "./WhatsAppManager.css";

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
      <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-sm">
        <Loader2 size={13} className="animate-spin text-cyan-600 dark:text-cyan-400" /> Checking...
      </div>
    );
  }

  const variants = {
    CONNECTED:    { bg: "bg-emerald-50 dark:bg-emerald-500/15", border: "border-emerald-300 dark:border-emerald-500/30", text: "text-emerald-800 dark:text-emerald-300", icon: <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />, label: "CONNECTED" },
    UNPAIRED:     { bg: "bg-amber-50 dark:bg-amber-500/15",   border: "border-amber-300 dark:border-amber-500/30",   text: "text-amber-800 dark:text-amber-300",   icon: <AlertCircle size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />,  label: "UNPAIRED — Scan QR" },
    DISCONNECTED: { bg: "bg-rose-50 dark:bg-rose-500/15",    border: "border-rose-300 dark:border-rose-500/30",    text: "text-rose-800 dark:text-rose-300",    icon: <XCircle size={13} className="text-rose-600 dark:text-rose-400 shrink-0" />,       label: "DISCONNECTED" },
    OFFLINE:      { bg: "bg-rose-50 dark:bg-rose-500/15",    border: "border-rose-300 dark:border-rose-500/30",    text: "text-rose-800 dark:text-rose-300",    icon: <XCircle size={13} className="text-rose-600 dark:text-rose-400 shrink-0" />,       label: "MICROSERVICE OFFLINE" },
  };
  const v = variants[status] || { bg: "bg-slate-100 dark:bg-slate-800", border: "border-slate-200 dark:border-white/10", text: "text-slate-700 dark:text-slate-300", icon: <Loader2 size={13} className="animate-spin" />, label: status || "INITIALIZING" };
  return (
    <div className={`flex items-center gap-2 ${v.bg} border ${v.border} ${v.text} px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-sm`}>
      {v.icon}
      <span>{v.label}</span>
    </div>
  );
}

// ─── WhatsApp Text Formatter Component ───────────────────────────────────────

function FormattedWhatsAppText({ text, isDark = true }) {
  if (!text) return null;
  const lines = String(text).split("\n");

  return (
    <div className="space-y-1 text-xs font-sans leading-relaxed select-text">
      {lines.map((line, idx) => {
        if (!line.trim()) return <div key={idx} className="h-2" />;
        if (line.includes("━━━━") || line.includes("────") || line.includes("════")) {
          return <div key={idx} className={`border-b ${isDark ? "border-white/15" : "border-slate-300"} my-2`} />;
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
            parts.push(<strong key={match.index} className={`font-extrabold ${isDark ? "text-white" : "text-slate-950"}`}>{token.slice(1, -1)}</strong>);
          } else if (token.startsWith("_") && token.endsWith("_")) {
            parts.push(<em key={match.index} className={`italic ${isDark ? "text-emerald-100/90" : "text-emerald-800"}`}>{token.slice(1, -1)}</em>);
          } else if (token.startsWith("~") && token.endsWith("~")) {
            parts.push(<del key={match.index} className={`line-through ${isDark ? "text-slate-400" : "text-slate-500"}`}>{token.slice(1, -1)}</del>);
          } else if (token.startsWith("`") && token.endsWith("`")) {
            parts.push(<code key={match.index} className={`${isDark ? "bg-slate-950/80 text-cyan-200" : "bg-slate-200 text-cyan-800"} px-1.5 py-0.5 rounded font-mono text-[11px]`}>{token.slice(1, -1)}</code>);
          } else if (token.startsWith("http")) {
            parts.push(
              <a
                key={match.index}
                href={token}
                target="_blank"
                rel="noreferrer"
                className={`${isDark ? "text-cyan-300 hover:text-cyan-100" : "text-cyan-700 hover:text-cyan-900"} underline underline-offset-2 break-all font-medium`}
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
    READ:      { cls: "bg-cyan-50 dark:bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30", label: "✓✓ READ" },
    DELIVERED: { cls: "bg-blue-50 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-500/30", label: "✓✓ DELIVERED" },
    SENT:      { cls: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30", label: "✓ SENT" },
    QUEUED:    { cls: "bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30", label: "⏳ QUEUED" },
    FAILED:    { cls: "bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-500/30", label: "✕ FAILED" },
    CANCELLED: { cls: "bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10", label: "CANCELLED" },
  }[status] || { cls: "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10", label: status };

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

  // Automation Rules State
  const [automationRules, setAutomationRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [rulesCategoryFilter, setRulesCategoryFilter] = useState("all");
  const [togglingRuleKey, setTogglingRuleKey] = useState(null);

  // Canned Quick Replies State
  const [quickReplies, setQuickReplies] = useState([]);
  const [loadingQuickReplies, setLoadingQuickReplies] = useState(false);
  const [showQuickReplyModal, setShowQuickReplyModal] = useState(false);
  const [editingQuickReply, setEditingQuickReply] = useState(null);
  const [quickReplyForm, setQuickReplyForm] = useState({ shortcut: "", title: "", content: "", category: "general" });
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [showQuickReplyPicker, setShowQuickReplyPicker] = useState(false);

  // Custom Bot Rules & Away Message State
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

  // Live Chat State
  const [attachedFile, setAttachedFile] = useState(null);
  const chatFileInputRef = useRef(null);
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

  // AI Knowledge Base State
  const [kbArticles, setKbArticles] = useState([]);
  const [loadingKb, setLoadingKb] = useState(false);
  const [kbCategoryFilter, setKbCategoryFilter] = useState("All");
  const [kbSearch, setKbSearch] = useState("");
  const [kbCategories, setKbCategories] = useState([]);
  const [showKbModal, setShowKbModal] = useState(false);
  const [editingKbArticle, setEditingKbArticle] = useState(null);
  const [kbForm, setKbForm] = useState({
    title: "",
    category: "Warranty Policy",
    content: "",
    keywords: "",
    priority: 10,
    is_active: true
  });
  const [savingKb, setSavingKb] = useState(false);
  const [kbPreviewQuestion, setKbPreviewQuestion] = useState("");
  const [kbPreviewResult, setKbPreviewResult] = useState(null);
  const [loadingKbPreview, setLoadingKbPreview] = useState(false);

  // Automated Follow-Up Engine State
  const [followUpRules, setFollowUpRules] = useState([]);
  const [followUpMetrics, setFollowUpMetrics] = useState({ scheduled_count: 0, sent_count: 0, cancelled_count: 0, opt_outs_count: 0 });
  const [followUpLogs, setFollowUpLogs] = useState([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [editingFollowUpRule, setEditingFollowUpRule] = useState(null);
  const [showFollowUpRuleModal, setShowFollowUpRuleModal] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({
    delay_hours: 2,
    max_follow_ups: 2,
    quiet_hours_start: "21:00",
    quiet_hours_end: "08:00",
    template_body: "",
    is_enabled: true
  });
  const [savingFollowUpRule, setSavingFollowUpRule] = useState(false);
  const [triggeringWorker, setTriggeringWorker] = useState(false);

  // Marketing & Bulk Broadcast Campaigns State
  const [campaignName, setCampaignName] = useState("");
  const [campaignSegment, setCampaignSegment] = useState("all");
  const [campaignMessage, setCampaignMessage] = useState("Hello {customer_name}, we value your business at {store_name}! Enjoy an exclusive discount on your next visit with code VIP2026.");
  const [campaignDelaySec, setCampaignDelaySec] = useState(4);
  const [campaignRunning, setCampaignRunning] = useState(false);
  const [campaignProgress, setCampaignProgress] = useState({ sent: 0, total: 0, failed: 0 });
  const [campaignLogs, setCampaignLogs] = useState([]);

  // Audience Segmentation Computation
  const targetAudience = useMemo(() => {
    if (!customers || customers.length === 0) return [];
    if (campaignSegment === "all") return customers;
    if (campaignSegment === "with_balance") return customers.filter(c => Number(c.outstanding_balance || 0) > 0);
    if (campaignSegment === "vip") return customers.filter(c => Number(c.total_spent || 0) > 50000 || Number(c.points || 0) > 100);
    if (campaignSegment === "recent") return customers.slice(0, 20);
    return customers;
  }, [customers, campaignSegment]);

  const handleStartCampaign = async () => {
    if (!campaignName.trim()) {
      toast("Please provide a Campaign Title.", { type: "warning" });
      return;
    }
    if (!campaignMessage.trim()) {
      toast("Please write a message body.", { type: "warning" });
      return;
    }
    if (targetAudience.length === 0) {
      toast("No recipients found in the selected segment.", { type: "warning" });
      return;
    }

    setCampaignRunning(true);
    setCampaignProgress({ sent: 0, total: targetAudience.length, failed: 0 });
    setCampaignLogs([]);
    toast(`Launching Broadcast "${campaignName}" to ${targetAudience.length} customers with safe anti-ban delay (${campaignDelaySec}s/msg)...`, { type: "info" });

    let sentCount = 0;
    let failCount = 0;

    for (let i = 0; i < targetAudience.length; i++) {
      const recipient = targetAudience[i];
      const phone = recipient.phone || recipient.mobile;
      if (!phone) {
        failCount++;
        setCampaignProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
        continue;
      }

      const personalized = campaignMessage
        .replace(/{customer_name}/g, recipient.name || "Valued Customer")
        .replace(/{store_name}/g, "I-Store");

      try {
        await api.post("/api/whatsapp/send", {
          phone: phone,
          message: personalized
        });
        sentCount++;
        setCampaignLogs(prev => [
          { time: new Date().toLocaleTimeString(), phone, name: recipient.name, status: "SENT" },
          ...prev.slice(0, 49)
        ]);
      } catch (err) {
        failCount++;
        setCampaignLogs(prev => [
          { time: new Date().toLocaleTimeString(), phone, name: recipient.name, status: "FAILED" },
          ...prev.slice(0, 49)
        ]);
      }

      setCampaignProgress({ sent: sentCount, total: targetAudience.length, failed: failCount });
      if (i < targetAudience.length - 1) {
        await new Promise(r => setTimeout(r, campaignDelaySec * 1000));
      }
    }

    setCampaignRunning(false);
    toast(`Campaign "${campaignName}" Completed! ${sentCount} sent, ${failCount} failed.`, { type: "success" });
  };

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
    userScrolledUpRef.current = distanceFromBottom > 100;
  };

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
      chatList.slice(0, 15).forEach(c => {
        if (c.phone) fetchProfilePic(c.phone);
      });
    } catch (err) {
      console.error("Failed to fetch WhatsApp chats:", err);
    } finally {
      setLoadingChats(false);
    }
  }, [chatSearch, selectedChatPhone, fetchProfilePic]);

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

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await api.get("/api/whatsapp/templates", {
        params: { category: templateCategory !== "all" ? templateCategory : undefined }
      });
      setTemplates(res.data || []);
      const initial = (res.data || []).find(t => t.event_type === selectedEventType) || (res.data || [])[0];
      if (initial) {
        setEditedBody(initial.template_body);
        setEditedActive(initial.is_active);
      }
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    }
  }, [templateCategory, selectedEventType]);

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

  const fetchKnowledgeBase = useCallback(async () => {
    try {
      setLoadingKb(true);
      const res = await api.get("/api/whatsapp/kb/articles", {
        params: {
          category: kbCategoryFilter !== "All" ? kbCategoryFilter : undefined,
          search: kbSearch.trim() || undefined
        }
      });
      setKbArticles(res.data.articles || []);
      setKbCategories(res.data.categories || []);
    } catch (err) {
      console.error("Failed to fetch knowledge base:", err);
    } finally {
      setLoadingKb(false);
    }
  }, [kbCategoryFilter, kbSearch]);

  const handleSaveKbArticle = async (e) => {
    e.preventDefault();
    try {
      setSavingKb(true);
      if (editingKbArticle) {
        await api.put(`/api/whatsapp/kb/articles/${editingKbArticle.id}`, kbForm);
        toast({ title: "Policy Updated", message: "Knowledge base policy saved successfully.", type: "success" });
      } else {
        await api.post("/api/whatsapp/kb/articles", kbForm);
        toast({ title: "Policy Created", message: "New knowledge base policy added.", type: "success" });
      }
      setShowKbModal(false);
      setEditingKbArticle(null);
      fetchKnowledgeBase();
    } catch (err) {
      toast({ title: "Error", message: err?.response?.data?.detail || "Could not save policy.", type: "error" });
    } finally {
      setSavingKb(false);
    }
  };

  const handleDeleteKbArticle = async (articleId) => {
    if (!window.confirm("Are you sure you want to delete this knowledge base policy?")) return;
    try {
      await api.delete(`/api/whatsapp/kb/articles/${articleId}`);
      toast({ title: "Deleted", message: "Policy removed from knowledge base.", type: "success" });
      fetchKnowledgeBase();
    } catch (err) {
      toast({ title: "Error", message: "Could not delete policy.", type: "error" });
    }
  };

  const handlePreviewKbAnswer = async () => {
    if (!kbPreviewQuestion.trim()) return;
    try {
      setLoadingKbPreview(true);
      const res = await api.post("/api/whatsapp/kb/preview-ai", {
        question: kbPreviewQuestion.trim()
      });
      setKbPreviewResult(res.data.preview);
    } catch (err) {
      toast({ title: "Preview Error", message: "Failed to generate AI test answer.", type: "error" });
    } finally {
      setLoadingKbPreview(false);
    }
  };

  const fetchFollowUps = useCallback(async () => {
    try {
      setLoadingFollowUps(true);
      const res = await api.get("/api/whatsapp/followups/overview");
      setFollowUpRules(res.data.rules || []);
      setFollowUpMetrics(res.data.metrics || { scheduled_count: 0, sent_count: 0, cancelled_count: 0, opt_outs_count: 0 });
      setFollowUpLogs(res.data.recent_logs || []);
    } catch (err) {
      console.error("Failed to fetch follow-ups:", err);
    } finally {
      setLoadingFollowUps(false);
    }
  }, []);

  const handleSaveFollowUpRule = async (e) => {
    e.preventDefault();
    if (!editingFollowUpRule) return;
    try {
      setSavingFollowUpRule(true);
      await api.put(`/api/whatsapp/followups/rules/${editingFollowUpRule.id}`, followUpForm);
      toast({ title: "Rule Updated", message: "Follow-up automation rule saved.", type: "success" });
      setShowFollowUpRuleModal(false);
      setEditingFollowUpRule(null);
      fetchFollowUps();
    } catch (err) {
      toast({ title: "Error", message: "Could not update follow-up rule.", type: "error" });
    } finally {
      setSavingFollowUpRule(false);
    }
  };

  const handleCancelFollowUp = async (logId) => {
    try {
      await api.post(`/api/whatsapp/followups/logs/${logId}/cancel`);
      toast({ title: "Follow-Up Cancelled", message: "Scheduled follow-up has been cancelled.", type: "info" });
      fetchFollowUps();
    } catch (err) {
      toast({ title: "Error", message: "Could not cancel follow-up.", type: "error" });
    }
  };

  const handleTriggerFollowUpWorker = async () => {
    try {
      setTriggeringWorker(true);
      const res = await api.post("/api/whatsapp/followups/process-now");
      toast({
        title: "Follow-Up Worker Run",
        message: `Processed: ${res.data.result.processed_total} | Sent: ${res.data.result.sent} | Cancelled: ${res.data.result.cancelled}`,
        type: "success"
      });
      fetchFollowUps();
    } catch (err) {
      toast({ title: "Worker Error", message: "Failed to run follow-up worker.", type: "error" });
    } finally {
      setTriggeringWorker(false);
    }
  };

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
    if (activeTab === "knowledge_base") fetchKnowledgeBase();
    if (activeTab === "follow_ups") fetchFollowUps();
  }, [activeTab, logStatusFilter, logCategoryFilter, logSearch, kbCategoryFilter, kbSearch]);

  useEffect(() => {
    fetchTemplates();
  }, [templateCategory]);

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
      toast({ title: "Re-Initializing Session...", description: "Triggered WhatsApp client restart. A fresh QR code will be generated if unpaired.", tone: "info" });
      setTimeout(fetchOverview, 2500);
    } catch (e) {
      toast({ title: "Reconnect Error", description: "Could not trigger reconnect. Please ensure the background Node.js service is running.", tone: "error" });
    }
  };

  const handleUnlink = async () => {
    if (!window.confirm("Are you sure you want to unlink this WhatsApp device? You will need to scan a new QR code to reconnect.")) return;
    try {
      await api.post("/api/whatsapp/service/logout");
      toast({ title: "Device Unlinked", description: "WhatsApp session cleared. Preparing fresh QR code for new pairing.", tone: "info" });
      setTimeout(fetchOverview, 2000);
    } catch (e) {
      toast({ title: "Unlink Error", description: "Could not unlink device.", tone: "error" });
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
      <div className="space-y-1 text-[13px] text-slate-900 dark:text-slate-100 font-sans leading-relaxed select-text">
        {lines.map((line, idx) => {
          if (!line.trim()) return <div key={idx} className="h-2" />;
          if (line.includes("━━━━")) {
            return <div key={idx} className="border-b border-emerald-500/25 my-2.5" />;
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
              parts.push(<strong key={match.index} className="font-extrabold text-slate-950 dark:text-white">{token.slice(1, -1)}</strong>);
            } else if (token.startsWith("_") && token.endsWith("_")) {
              parts.push(<em key={match.index} className="italic text-emerald-800 dark:text-emerald-100/90">{token.slice(1, -1)}</em>);
            } else if (token.startsWith("~") && token.endsWith("~")) {
              parts.push(<del key={match.index} className="line-through text-slate-500 dark:text-slate-300">{token.slice(1, -1)}</del>);
            } else if (token.startsWith("`") && token.endsWith("`")) {
              parts.push(<code key={match.index} className="bg-slate-200 dark:bg-slate-900/80 px-1.5 py-0.5 rounded font-mono text-xs text-cyan-800 dark:text-cyan-300">{token.slice(1, -1)}</code>);
            } else if (token.startsWith("http")) {
              parts.push(
                <a key={match.index} href={token} target="_blank" rel="noreferrer" className="text-cyan-700 dark:text-cyan-300 underline underline-offset-2 break-all hover:text-cyan-900 dark:hover:text-cyan-200 font-medium">
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
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-3xl p-5 md:p-6 shadow-sm dark:shadow-2xl backdrop-blur-xl transition-colors">
        <div className="flex items-center gap-4">
          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl text-emerald-600 dark:text-emerald-400 shadow-sm dark:shadow-emerald-950/40 shrink-0">
            <MessageSquare size={30} />
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight">WhatsApp Automation Hub</h1>
              <StatusBadge status={status} loading={loadingStatus} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Enterprise Notification Engine · Smart Receipts · Repair Alerts · End-to-End Tracing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end md:self-auto">
          {status === "CONNECTED" && connectedUser && (
            <div className="flex items-center gap-2 text-xs font-mono bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
              <span className="text-slate-900 dark:text-white font-bold">{connectedUser.pushname}</span>
              <span className="text-slate-500 dark:text-slate-400">+{connectedUser.wid}</span>
            </div>
          )}

          <Button
            onClick={fetchOverview}
            variant="outline"
            className="border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300 rounded-xl px-3.5 h-10 shadow-sm"
            title="Refresh Telemetry"
          >
            <RefreshCw size={14} className={loadingOverview ? "animate-spin text-cyan-600 dark:text-cyan-400" : ""} />
          </Button>
        </div>
      </div>

      {/* ── Microservice Offline Notification Banner ────────────────────────── */}
      {(status === "OFFLINE" || status === "DISCONNECTED") && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs shadow-sm">
          <div className="flex items-start gap-3 text-amber-900 dark:text-amber-300">
            <AlertCircle size={18} className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <span className="font-bold">WhatsApp Node.js Microservice is Currently Offline</span>
              <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Local rule configuration, AI knowledge base policies, canned replies, and template customization remain active. To send live WhatsApp messages, launch the service on port 3001.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveTab("diagnostics")}
              className="bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 dark:text-amber-200 border border-amber-300 dark:border-amber-500/30 px-3 py-1.5 rounded-xl font-bold transition"
            >
              Setup Guide & Pair QR
            </button>
            <button
              onClick={fetchOverview}
              className="bg-white hover:bg-slate-50 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={loadingOverview ? "animate-spin" : ""} /> Check Now
            </button>
          </div>
        </div>
      )}

      {/* ── Tab Navigation ─────────────────────────────────────────────────── */}
      <div className="whatsapp-hub-tab-bar border-b border-slate-200 dark:border-white/10 pb-1">
        {[
          { key: "inbox",          icon: <MessageSquare size={14} />, label: `Live Chats (${chats.length || 0})` },
          { key: "campaigns",      icon: <Megaphone size={14} />,     label: `Campaigns & Broadcast (${targetAudience.length} Audience)` },
          { key: "knowledge_base", icon: <BookOpen size={14} />,      label: `AI Knowledge Base (${kbArticles.length || 6})` },
          { key: "follow_ups",     icon: <UserCheck size={14} />,     label: `Follow-Up Engine (${followUpRules.filter(r => r.is_enabled).length}/${followUpRules.length || 3})` },
          { key: "automation",     icon: <SlidersHorizontal size={14} />, label: `Automation Rules (${automationRules.filter(r => r.is_enabled).length}/${automationRules.length || 17})` },
          { key: "bot_builder",    icon: <Bot size={14} />,           label: `Bot & Away Rules (${botRules.length} Rules)` },
          { key: "templates",      icon: <Layers size={14} />,        label: "Templates & Variables" },
          { key: "messenger",      icon: <Send size={14} />,          label: "Smart Messenger" },
          { key: "overview",       icon: <Activity size={14} />,      label: "Hub Overview" },
          { key: "logs",           icon: <Clock size={14} />,         label: `Audit Trail (${totalLogs || metrics.total_messages || 0})` },
          { key: "diagnostics",    icon: <ShieldCheck size={14} />,   label: "Diagnostics & QR Pair" },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl whitespace-nowrap transition-all duration-200 ${
              activeTab === tab.key
                ? "bg-emerald-600 text-white dark:bg-slate-900 dark:text-emerald-400 border border-emerald-600 dark:border-white/10 shadow-sm"
                : "bg-slate-100/80 dark:bg-slate-950/40 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-white/5 border border-slate-200/60 dark:border-white/5"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: HUB OVERVIEW ────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* KPI Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 space-y-1 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Sent Today</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white">{metrics.sent_today || 0}</p>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <TrendingUp size={11} /> Outbound Messages
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 space-y-1 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Delivered</span>
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{metrics.delivered_today || 0}</p>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                {metrics.delivery_rate_pct || 100}% Delivery Rate
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 space-y-1 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Read Receipts</span>
              <p className="text-2xl font-black text-cyan-600 dark:text-cyan-400">{metrics.read_today || 0}</p>
              <span className="text-[10px] text-cyan-700 dark:text-cyan-300 font-semibold">Seen by Customers</span>
            </div>

            <div className="bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 space-y-1 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Failed Today</span>
              <p className="text-2xl font-black text-rose-600 dark:text-rose-400">{metrics.failed_today || 0}</p>
              <span className="text-[10px] text-rose-700 dark:text-rose-300 font-semibold">
                {metrics.failed_today > 0 ? "Requires Review" : "0 Errors"}
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 space-y-1 shadow-sm">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Active Queue</span>
              <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{overview?.service?.queueSize || metrics.active_queue_count || 0}</p>
              <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">Single-Concurrency FIFO</span>
            </div>
          </div>

          {/* Quick Actions & Telemetry Banner */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-white/10 rounded-2xl p-5 space-y-3 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Quick Operations</h3>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setActiveTab("inbox")}
                  className="flex items-center justify-between p-3 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 border border-emerald-200 dark:border-emerald-500/40 rounded-xl text-emerald-800 dark:text-emerald-300 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><MessageSquare size={14} /> Open Live Customer Inbox</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={() => setActiveTab("messenger")}
                  className="flex items-center justify-between p-3 bg-emerald-50/60 hover:bg-emerald-100/80 dark:bg-emerald-600/15 dark:hover:bg-emerald-600/25 border border-emerald-200/70 dark:border-emerald-500/30 rounded-xl text-emerald-800 dark:text-emerald-300 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><Send size={14} /> Send Instant Message</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={() => setActiveTab("diagnostics")}
                  className="flex items-center justify-between p-3 bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-500/30 rounded-xl text-cyan-800 dark:text-cyan-300 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><ShieldCheck size={14} /> Run Pipeline Diagnostics</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={() => setActiveTab("templates")}
                  className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-xl text-slate-700 dark:text-slate-200 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><Layers size={14} /> Customize Message Templates</span>
                  <ArrowRight size={14} />
                </button>

                <button
                  onClick={handleReconnect}
                  className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-xl text-slate-700 dark:text-slate-300 font-bold text-xs transition"
                >
                  <span className="flex items-center gap-2"><RefreshCw size={14} /> Force Session Reconnect</span>
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>

            <div className="lg:col-span-8 bg-white dark:bg-slate-900/70 border border-slate-200/90 dark:border-white/10 rounded-2xl p-5 space-y-4 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">System Activity Telemetry</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-white/5 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={14} /> Last Successful Dispatch
                  </div>
                  {overview?.last_activity?.last_success_at ? (
                    <div>
                      <p className="text-xs text-slate-900 dark:text-white font-mono font-semibold">
                        +{overview.last_activity.last_success_recipient}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {formatDateTime(overview.last_activity.last_success_at)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No dispatches recorded today.</p>
                  )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-white/5 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400">
                    <AlertTriangle size={14} /> Last Failed Message
                  </div>
                  {overview?.last_activity?.last_failed_at ? (
                    <div>
                      <p className="text-xs text-slate-900 dark:text-white font-mono font-semibold">
                        +{overview.last_activity.last_failed_recipient}
                      </p>
                      <p className="text-[11px] text-rose-600 dark:text-rose-300/80 truncate" title={overview.last_activity.last_failed_reason}>
                        {overview.last_activity.last_failed_reason}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400/80 font-semibold">No recent failures!</p>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-white/5 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-300">Supported ERP Dynamic Placeholders: </span>
                  <span className="text-slate-500 dark:text-slate-400">25+ ERP variables available across sales, repairs, warranty, and customer notifications.</span>
                </div>
                <button
                  onClick={() => setActiveTab("templates")}
                  className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline ml-3 whitespace-nowrap"
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[700px] animate-in fade-in duration-150">
          {/* Left Panel: Conversation Threads */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-sm dark:shadow-2xl backdrop-blur-xl">
            {/* Header / Search */}
            <div className="p-4 border-b border-slate-200 dark:border-white/10 space-y-3 bg-slate-50 dark:bg-slate-950/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">Live Inboxes</h3>
                </div>
                <span className="text-[10px] font-mono bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                  {chats.length} Threads
                </span>
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder="Search customer, phone, text..."
                  value={chatSearch}
                  onChange={e => setChatSearch(e.target.value)}
                  className="w-full bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-white/10 rounded-xl pl-8 pr-8 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition shadow-sm"
                />
                {chatSearch && (
                  <button
                    onClick={() => setChatSearch("")}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Conversation Thread List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5 pr-0.5 wa-custom-scroll">
              {loadingChats && chats.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <Loader2 size={24} className="animate-spin text-emerald-500 mx-auto" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">Loading conversation threads...</p>
                </div>
              ) : chats.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center mx-auto text-slate-400">
                    <MessageSquare size={22} />
                  </div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No Conversations Found</p>
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
                          ? "bg-emerald-50 dark:bg-emerald-500/15 border-l-4 border-emerald-500 text-slate-900 dark:text-white"
                          : "hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {profilePics[chat.phone] ? (
                        <img
                          src={profilePics[chat.phone]}
                          alt={chat.customer_name || "Customer"}
                          className="w-10 h-10 rounded-xl object-cover shrink-0 shadow-sm border border-emerald-500/30"
                          onError={(e) => { e.target.style.display = "none"; }}
                        />
                      ) : (
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black shrink-0 shadow-sm ${
                          isSelected
                            ? "bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-extrabold"
                            : "bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-emerald-700 dark:text-emerald-300"
                        }`}>
                          {initials}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {chat.customer_name || "Customer"}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            {formatDateTime(lastMsg.created_at || chat.updated_at).split(",")[1] || "Today"}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mb-1">
                          {chat.display_phone || `+${chat.phone}`}
                        </p>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {isLastInbound ? (
                            <span className="text-cyan-600 dark:text-cyan-400 shrink-0 font-bold">Customer:</span>
                          ) : isLastBot ? (
                            <span className="text-amber-600 dark:text-amber-400 shrink-0 font-bold flex items-center gap-1">
                              <Bot size={11} /> Bot:
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400 shrink-0 font-bold">Staff:</span>
                          )}
                          <span className="truncate text-slate-700 dark:text-slate-300">
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

          {/* Right Panel: Chat Window & Reply */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-sm dark:shadow-2xl backdrop-blur-xl">
            {selectedChatPhone ? (
              <>
                <div className="p-4 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {profilePics[selectedChatPhone] ? (
                      <img
                        src={profilePics[selectedChatPhone]}
                        alt={chatData.customer?.name || "Customer"}
                        className="w-11 h-11 rounded-2xl object-cover shadow-sm border border-emerald-500/40 shrink-0"
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-black text-xs shadow-sm shrink-0">
                        {((chatData.customer?.name || "Customer").slice(0, 2)).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white">
                          {chatData.customer?.name || "Customer"}
                        </h3>
                        <span className="text-[10px] font-mono bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.2 rounded-full font-bold">
                          +{selectedChatPhone}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {chatData.customer?.invoices_count > 0 && (
                          <span className="text-cyan-700 dark:text-cyan-300">
                            🧾 {chatData.customer.invoices_count} Invoices
                          </span>
                        )}
                        {chatData.customer?.repairs_count > 0 && (
                          <span className="text-amber-700 dark:text-amber-300">
                            🛠️ {chatData.customer.repairs_count} Active Repairs
                          </span>
                        )}
                        {status === "CONNECTED" ? (
                          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-bold">
                            <CheckCircle2 size={11} /> 2-Way Bot Active
                          </span>
                        ) : status === "UNPAIRED" ? (
                          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-bold">
                            <AlertCircle size={11} /> Device Unpaired (Read-Only History)
                          </span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1 font-bold">
                            <XCircle size={11} /> Service Offline (Read-Only History)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {status !== "CONNECTED" && (
                      <button
                        onClick={() => setActiveTab("diagnostics")}
                        className="text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1"
                      >
                        <QrCode size={12} /> Link Device
                      </button>
                    )}
                    <Button
                      onClick={() => fetchChatMessages(selectedChatPhone)}
                      variant="outline"
                      size="sm"
                      className="border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300 rounded-xl px-3"
                      title="Refresh Thread"
                    >
                      <RefreshCw size={12} className={loadingChatMessages ? "animate-spin text-cyan-500" : ""} />
                    </Button>
                  </div>
                </div>

                {/* Unpaired/Offline Notice Banner */}
                {status !== "CONNECTED" && (
                  <div className="px-4 py-2.5 bg-amber-50/90 dark:bg-amber-950/40 border-b border-amber-200/80 dark:border-amber-500/20 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
                    <span className="flex items-center gap-2 font-medium">
                      <AlertCircle size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
                      Viewing saved ERP conversation history. Re-link your WhatsApp phone to send live messages and resume automated replies.
                    </span>
                    <button
                      onClick={() => setActiveTab("diagnostics")}
                      className="text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:underline shrink-0 ml-2"
                    >
                      Scan QR Code →
                    </button>
                  </div>
                )}

                {/* Message Bubble Thread */}
                <div
                  ref={chatContainerRef}
                  onScroll={handleChatContainerScroll}
                  className="flex-1 p-5 overflow-y-auto space-y-3.5 bg-slate-100/70 dark:bg-[#0b141a] wa-custom-scroll"
                >
                  {loadingChatMessages && chatData.messages.length === 0 ? (
                    <div className="p-8 text-center space-y-2">
                      <Loader2 size={24} className="animate-spin text-emerald-500 mx-auto" />
                      <p className="text-xs text-slate-500 dark:text-slate-400">Loading messages...</p>
                    </div>
                  ) : chatData.messages.length === 0 ? (
                    <div className="p-8 text-center space-y-2 text-slate-400 text-xs">
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
                            className={`p-3.5 rounded-2xl max-w-lg shadow-sm text-xs leading-relaxed ${
                              isInbound
                                ? "bg-white text-slate-900 border border-slate-200/80 rounded-tl-sm dark:bg-[#202c33] dark:text-slate-100 dark:border-white/5"
                                : isBot
                                ? "bg-emerald-50 text-emerald-950 border border-emerald-200 rounded-tr-sm dark:bg-[#064e3b] dark:text-slate-100 dark:border-emerald-600/40"
                                : "bg-emerald-100/90 text-emerald-950 border border-emerald-300/80 rounded-tr-sm dark:bg-[#005c4b] dark:text-slate-100 dark:border-[#007a63]"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-black/5 dark:border-white/10">
                              <span className="text-[10px] font-bold tracking-wider">
                                {isInbound ? (
                                  <span className="text-cyan-700 dark:text-cyan-300 font-bold">
                                    👤 {chatData.customer?.name || "Customer"}
                                  </span>
                                ) : isBot ? (
                                  <span className="text-emerald-800 dark:text-emerald-200 font-black flex items-center gap-1">
                                    <Bot size={12} className="text-emerald-600 dark:text-emerald-300" /> Self-Service Auto-Reply
                                  </span>
                                ) : (
                                  <span className="text-emerald-800 dark:text-emerald-200 font-bold">
                                    💼 Staff / Manual Dispatch
                                  </span>
                                )}
                              </span>
                              {msg.template_name && (
                                <span className="text-[9px] text-slate-500 dark:text-white/50 font-mono truncate max-w-[140px]">
                                  {msg.template_name}
                                </span>
                              )}
                            </div>

                            {msg.media_url && (
                              <div className="mb-2 p-2 bg-black/5 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl flex items-center gap-2 text-xs">
                                <FileText size={16} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
                                <span className="truncate font-mono text-cyan-800 dark:text-cyan-200 text-[11px]">{msg.media_url}</span>
                              </div>
                            )}

                            <FormattedWhatsAppText text={msg.message_body} isDark={false} />

                            <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500 dark:text-white/50 font-mono mt-2">
                              <span>{formatDateTime(msg.created_at)}</span>
                              {!isInbound && (
                                <span className="text-emerald-600 dark:text-emerald-300 font-bold" title={msg.status}>
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

                {/* Quick Canned Shortcuts Bar */}
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950/90 border-t border-slate-200 dark:border-white/10 flex items-center justify-between gap-2 overflow-x-auto text-[11px]">
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    <span className="text-slate-500 font-bold shrink-0 flex items-center gap-1">
                      <Zap size={12} className="text-amber-500" /> Canned:
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
                        className="bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/5 whitespace-nowrap transition flex items-center gap-1 shadow-xs"
                        title={qr.content}
                      >
                        <span className="font-mono text-cyan-700 dark:text-cyan-400 font-bold">{qr.shortcut}</span>
                        <span className="text-slate-700 dark:text-slate-300">{qr.title}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowQuickReplyPicker(!showQuickReplyPicker)}
                      className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 dark:text-amber-300 font-bold px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-500/30 transition flex items-center gap-1"
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
                      className="text-xs bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-bold px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 transition flex items-center gap-1"
                      title="Manage Canned Replies"
                    >
                      <Plus size={12} /> New
                    </button>
                  </div>
                </div>

                {/* Popover for Canned Replies */}
                {showQuickReplyPicker && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-white/10 space-y-2 max-h-56 overflow-y-auto wa-custom-scroll">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-300 flex items-center gap-1">
                        <Zap size={13} className="text-amber-500" /> Select Canned Response Shortcut
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowQuickReplyPicker(false)}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {quickReplies.map(qr => (
                        <div
                          key={qr.id}
                          onClick={() => handleInsertQuickReply(qr.content)}
                          className="p-2.5 bg-white dark:bg-slate-950/70 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-slate-200 dark:border-white/5 hover:border-emerald-500/30 rounded-xl cursor-pointer transition space-y-1 group shadow-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-cyan-700 dark:text-cyan-400">{qr.shortcut}</span>
                            <span className="text-[10px] bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-mono uppercase">{qr.category}</span>
                          </div>
                          <p className="text-xs font-bold text-slate-800 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-300">{qr.title}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{qr.content}</p>
                        </div>
                      ))}
                      {quickReplies.length === 0 && (
                        <p className="text-xs text-slate-500 col-span-2 text-center py-2">No canned replies configured yet.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Attachment Preview Banner */}
                {attachedFile && (
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-900/90 border-t border-emerald-300 dark:border-emerald-500/30 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      {attachedFile.isImage ? (
                        <img src={attachedFile.previewUrl} alt="Preview" className="w-9 h-9 object-cover rounded-lg border border-slate-200 dark:border-white/20" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                          <FileText size={18} />
                        </div>
                      )}
                      <div className="truncate">
                        <p className="font-bold text-slate-900 dark:text-white truncate max-w-xs">{attachedFile.name}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{(attachedFile.size / 1024).toFixed(1)} KB • Ready to send</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveAttachedFile}
                      className="p-1 rounded-lg bg-rose-100 hover:bg-rose-200 dark:bg-rose-500/20 dark:hover:bg-rose-500/30 text-rose-700 dark:text-rose-300 transition"
                      title="Remove attachment"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

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
                  className="p-3.5 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-white/10 flex items-end gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() => chatFileInputRef.current?.click()}
                    className={`p-3 rounded-xl border transition flex items-center justify-center shrink-0 cursor-pointer ${
                      attachedFile
                        ? "bg-emerald-500/20 border-emerald-500 text-emerald-600 dark:text-emerald-300"
                        : "bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
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
                      placeholder={
                        status !== "CONNECTED"
                          ? "Device not paired. Re-link WhatsApp in Diagnostics & QR Pair tab to send live replies..."
                          : attachedFile
                          ? `Add caption for ${attachedFile.name}...`
                          : `Type message or / for shortcuts to +${selectedChatPhone}... (Enter to send)`
                      }
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition resize-none leading-relaxed shadow-inner"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={sendingChatMsg || (!chatInputText.trim() && !attachedFile) || status !== "CONNECTED"}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-[58px] px-5 rounded-xl flex items-center justify-center gap-2 shadow-sm cursor-pointer shrink-0 transition"
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
                <div className="w-16 h-16 rounded-3xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm">
                  <MessageSquare size={32} />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Select a WhatsApp Conversation</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Choose a conversation thread from the left list to view the message history or reply in real-time.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: MARKETING CAMPAIGNS & BROADCAST WIZARD ───────────────────── */}
      {activeTab === "campaigns" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Header Banner */}
          <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Megaphone size={20} className="text-emerald-600 dark:text-emerald-400" /> WhatsApp Marketing & Broadcast Engine
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Segment audiences, personalize promotional offers, and dispatch high-conversion campaigns with automated anti-ban rate limiting.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-emerald-600 dark:text-emerald-400" /> Safe Rate-Limit Active
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Campaign Builder */}
            <div className="lg:col-span-2 space-y-5 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 shadow-sm">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                <Target size={16} className="text-emerald-600 dark:text-emerald-400" /> Campaign Configuration
              </h4>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                    Campaign Title *
                  </label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                    placeholder="e.g. Summer Tech Clearance Sale 2026"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                      Audience Segment
                    </label>
                    <select
                      value={campaignSegment}
                      onChange={e => setCampaignSegment(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                    >
                      <option value="all">All Registered Customers ({customers?.length || 0})</option>
                      <option value="vip">VIP High Spenders (Rs. 50k+ or 100+ pts)</option>
                      <option value="with_balance">Customers with Pending Dues</option>
                      <option value="recent">Recent 20 Customers (Test Batch)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-600 dark:text-slate-400 mb-1">
                      Throttle Delay (Anti-Ban Safety)
                    </label>
                    <select
                      value={campaignDelaySec}
                      onChange={e => setCampaignDelaySec(Number(e.target.value))}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                    >
                      <option value={3}>3 Seconds / message (Standard)</option>
                      <option value={4}>4 Seconds / message (Recommended)</option>
                      <option value={6}>6 Seconds / message (High Safety)</option>
                      <option value={10}>10 Seconds / message (Maximum Safety)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400">
                      Message Template *
                    </label>
                    <div className="flex items-center gap-1">
                      {["{customer_name}", "{store_name}"].map(v => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setCampaignMessage(prev => prev + " " + v)}
                          className="text-[10px] bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded font-mono border border-slate-200 dark:border-white/10"
                        >
                          + {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={5}
                    value={campaignMessage}
                    onChange={e => setCampaignMessage(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white outline-none focus:border-emerald-500 leading-relaxed"
                  />
                </div>

                {/* Dispatch Button & Live Progress */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200 dark:border-white/10">
                  <div className="text-xs text-slate-500">
                    Targeting <span className="font-bold text-emerald-600 dark:text-emerald-400">{targetAudience.length}</span> recipients
                  </div>

                  <Button
                    onClick={handleStartCampaign}
                    disabled={campaignRunning || targetAudience.length === 0}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 shadow-md w-full sm:w-auto justify-center"
                  >
                    {campaignRunning ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Sending ({campaignProgress.sent}/{campaignProgress.total})...</span>
                      </>
                    ) : (
                      <>
                        <SendHorizontal size={16} />
                        <span>Launch Broadcast ({targetAudience.length})</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Right: Audience Preview & Live Dispatch Feed */}
            <div className="space-y-5">
              <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Users size={14} className="text-emerald-600 dark:text-emerald-400" /> Audience Recipients
                  </span>
                  <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-500/20">
                    {targetAudience.length} Total
                  </span>
                </h4>

                <div className="max-h-[220px] overflow-y-auto space-y-2 custom-scrollbar">
                  {targetAudience.slice(0, 10).map((c, i) => (
                    <div key={c.id || i} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-white/5 text-xs">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{c.name || "Customer"}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{c.phone || c.mobile || "No phone"}</p>
                      </div>
                      {c.total_spent > 0 && (
                        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                          LKR {Math.round(c.total_spent).toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                  {targetAudience.length > 10 && (
                    <p className="text-[11px] text-center text-slate-400 pt-1">
                      + {targetAudience.length - 10} more in this segment
                    </p>
                  )}
                  {targetAudience.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-6">No recipients in this segment.</p>
                  )}
                </div>
              </div>

              {/* Live Dispatch Stream */}
              <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Activity size={14} className="text-cyan-600 dark:text-cyan-400" /> Real-Time Delivery Feed
                </h4>

                <div className="max-h-[160px] overflow-y-auto space-y-1.5 custom-scrollbar text-[11px]">
                  {campaignLogs.map((log, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1 px-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-white/5 font-mono">
                      <span className="text-slate-500 text-[10px]">{log.time}</span>
                      <span className="truncate max-w-[120px] text-slate-700 dark:text-slate-300 font-sans font-bold">{log.name}</span>
                      <span className={log.status === "SENT" ? "text-emerald-600 font-bold" : "text-rose-500 font-bold"}>
                        {log.status}
                      </span>
                    </div>
                  ))}
                  {campaignLogs.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">No active broadcast running.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {activeTab === "knowledge_base" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen size={20} className="text-emerald-600 dark:text-emerald-400" /> AI Knowledge Base & Business Grounding
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Manage verified store policies (Return, Warranty, Payment, Repairs, Hours) that Gemini AI retrieves to answer customer inquiries.
              </p>
            </div>

            <Button
              onClick={() => {
                setEditingKbArticle(null);
                setKbForm({
                  title: "",
                  category: "Warranty Policy",
                  content: "",
                  keywords: "",
                  priority: 10,
                  is_active: true
                });
                setShowKbModal(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl px-4 flex items-center gap-2 shadow-sm"
            >
              <Plus size={14} /> Add Policy Article
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Columns: Policy Management Table */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search policies by title or keyword..."
                      value={kbSearch}
                      onChange={e => setKbSearch(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <select
                    value={kbCategoryFilter}
                    onChange={e => setKbCategoryFilter(e.target.value)}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="All">All Categories</option>
                    {kbCategories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {loadingKb ? (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                    <Loader2 size={24} className="animate-spin text-emerald-500" />
                    <span className="text-xs">Loading knowledge base articles...</span>
                  </div>
                ) : kbArticles.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs">
                    No knowledge base articles found matching your criteria.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {kbArticles.map(article => (
                      <div
                        key={article.id}
                        className="bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200 dark:border-white/10 hover:border-emerald-500/40 rounded-xl p-4 transition-all duration-200 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                {article.category}
                              </span>
                              <span className="text-slate-900 dark:text-white font-bold text-sm">{article.title}</span>
                              <span className="text-slate-400 text-[10px] font-mono">v{article.version}</span>
                              {!article.is_active && (
                                <span className="bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                  INACTIVE
                                </span>
                              )}
                            </div>
                            {article.keywords && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 font-mono">
                                <Tag size={11} className="text-slate-400" /> {article.keywords}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => {
                                setEditingKbArticle(article);
                                setKbForm({
                                  title: article.title,
                                  category: article.category,
                                  content: article.content,
                                  keywords: article.keywords,
                                  priority: article.priority,
                                  is_active: article.is_active
                                });
                                setShowKbModal(true);
                              }}
                              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 rounded-lg transition-colors"
                              title="Edit Policy"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteKbArticle(article.id)}
                              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                              title="Delete Policy"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="bg-white dark:bg-black/30 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-xs text-slate-700 dark:text-slate-300 font-sans leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto wa-custom-scroll">
                          {article.content}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-200 dark:border-white/5">
                          <span>Priority: {article.priority}</span>
                          <span>Last updated: {formatDateTime(article.updated_at)} by {article.updated_by}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: AI Test Box */}
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-200 dark:border-white/10">
                  <Sparkles size={16} className="text-cyan-600 dark:text-cyan-400" />
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Test Knowledge Base with AI</h4>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Enter a sample customer question to verify that Gemini grounds its answer strictly on your active store policies without sending anything to WhatsApp.
                </p>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Sample Customer Question</label>
                  <textarea
                    rows={3}
                    placeholder="e.g. Can I return a charger after opening the packaging?"
                    value={kbPreviewQuestion}
                    onChange={e => setKbPreviewQuestion(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 resize-none font-sans"
                  />
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    <span className="text-slate-400">Try:</span>
                    {[
                      "Can I return opened items?",
                      "Do you have screen warranty?",
                      "What payment methods do you accept?",
                      "What are your Sunday hours?"
                    ].map(sample => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => setKbPreviewQuestion(sample)}
                        className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={handlePreviewKbAnswer}
                  disabled={loadingKbPreview || !kbPreviewQuestion.trim()}
                  className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs py-2.5 rounded-xl shadow-sm flex items-center justify-center gap-2"
                >
                  {loadingKbPreview ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Run AI Preview Test
                </Button>

                {kbPreviewResult && (
                  <div className="bg-slate-50 dark:bg-slate-950 border border-cyan-300 dark:border-cyan-500/30 rounded-xl p-4 space-y-3 animate-in fade-in">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-cyan-700 dark:text-cyan-400 font-bold flex items-center gap-1.5">
                        <CheckCircle2 size={13} /> Grounded Preview Answer
                      </span>
                      <span className="text-slate-400 font-mono text-[10px]">
                        Matched: {kbPreviewResult.grounded_count} Policy Docs
                      </span>
                    </div>

                    <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-xs text-slate-800 dark:text-slate-200 font-sans leading-relaxed whitespace-pre-wrap">
                      <FormattedWhatsAppText text={kbPreviewResult.ai_preview_answer} isDark={false} />
                    </div>

                    <p className="text-[10px] text-slate-400 italic">
                      🔒 Simulated preview only. No message was sent to WhatsApp.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AUTOMATED FOLLOW-UP ENGINE ───────────────────────────────── */}
      {activeTab === "follow_ups" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck size={20} className="text-emerald-600 dark:text-emerald-400" /> Automated Follow-Up Engine
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Controlled, safe customer follow-ups with server-side cancellation (stops when customer replies, buys, reserves, or opts out) and quiet-hours protection.
              </p>
            </div>

            <Button
              onClick={handleTriggerFollowUpWorker}
              disabled={triggeringWorker}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl px-4 flex items-center gap-2 shadow-sm"
            >
              {triggeringWorker ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Run Queue Worker Now
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Scheduled (Pending)</span>
              <div className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">{followUpMetrics.scheduled_count}</div>
              <span className="text-[10px] text-slate-400">Queued for delivery</span>
            </div>

            <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Dispatched (Sent)</span>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">{followUpMetrics.sent_count}</div>
              <span className="text-[10px] text-slate-400">Delivered to WhatsApp</span>
            </div>

            <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Cancelled Safe</span>
              <div className="text-2xl font-black text-slate-700 dark:text-slate-300 font-mono">{followUpMetrics.cancelled_count}</div>
              <span className="text-[10px] text-slate-400">Customer replied or ordered</span>
            </div>

            <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-4 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Opt-Out List</span>
              <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">{followUpMetrics.opt_outs_count}</div>
              <span className="text-[10px] text-slate-400">Muted numbers (STOP)</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-4">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-emerald-600 dark:text-emerald-400" /> Active Follow-Up Automation Triggers
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {followUpRules.map(rule => (
                <div
                  key={rule.id}
                  className="bg-slate-50/70 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-900 dark:text-white font-bold text-xs">{rule.name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${rule.is_enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30"}`}>
                        {rule.is_enabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                      <div>⏱️ Delay: <strong className="text-slate-900 dark:text-white">{rule.delay_hours} Hours</strong> after silence</div>
                      <div>🔄 Max Follow-Ups: <strong className="text-slate-900 dark:text-white">{rule.max_follow_ups} Messages</strong></div>
                      <div>🌙 Quiet Hours: <strong className="text-slate-900 dark:text-white">{rule.quiet_hours_start} → {rule.quiet_hours_end}</strong></div>
                    </div>

                    <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-2.5 text-[11px] text-slate-700 dark:text-slate-300 font-sans line-clamp-3">
                      {rule.template_body}
                    </div>
                  </div>

                  <Button
                    onClick={() => {
                      setEditingFollowUpRule(rule);
                      setFollowUpForm({
                        delay_hours: rule.delay_hours,
                        max_follow_ups: rule.max_follow_ups,
                        quiet_hours_start: rule.quiet_hours_start,
                        quiet_hours_end: rule.quiet_hours_end,
                        template_body: rule.template_body,
                        is_enabled: rule.is_enabled
                      });
                      setShowFollowUpRuleModal(true);
                    }}
                    className="w-full bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white font-bold text-xs py-2 rounded-xl flex items-center justify-center gap-1.5"
                  >
                    <Edit3 size={13} /> Configure Rule
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AUTOMATION RULES ────────────────────────────────────────── */}
      {activeTab === "automation" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <SlidersHorizontal size={20} className="text-emerald-600 dark:text-emerald-400" /> WhatsApp Event Automation Rules
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Toggle and configure automatic customer notifications triggered by ERP actions (Checkout, Repairs, Warranty, Security).
              </p>
            </div>

            <div className="flex items-center gap-2 self-stretch md:self-auto flex-wrap">
              <Button
                onClick={() => handleBulkToggleRules(rulesCategoryFilter, true)}
                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5"
                disabled={loadingRules}
              >
                <Check size={14} /> Enable Category
              </Button>
              <Button
                onClick={() => handleBulkToggleRules(rulesCategoryFilter, false)}
                variant="outline"
                className="border-slate-200 dark:border-white/10 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-700 dark:text-slate-400 text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5"
                disabled={loadingRules}
              >
                <X size={14} /> Mute Category
              </Button>
              <Button
                onClick={fetchAutomationRules}
                variant="outline"
                className="border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300 px-3 py-2 rounded-xl"
                title="Refresh Rules"
              >
                <RefreshCw size={14} className={loadingRules ? "animate-spin text-cyan-500" : ""} />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs wa-custom-scroll">
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
                      ? "bg-emerald-600 text-white dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-600 dark:border-emerald-500/40 shadow-xs"
                      : "bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-white/5"
                  }`}
                >
                  {cat.icon} {cat.label} <span className="text-[10px] opacity-75 font-mono">({count})</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {automationRules
              .filter(r => rulesCategoryFilter === "all" || r.category === rulesCategoryFilter)
              .map(rule => {
                const isToggling = togglingRuleKey === rule.event_type;
                return (
                  <div
                    key={rule.id || rule.event_type}
                    className={`bg-white dark:bg-slate-900/80 border rounded-2xl p-5 space-y-4 shadow-sm transition-all duration-200 flex flex-col justify-between ${
                      rule.is_enabled
                        ? "border-slate-200 dark:border-white/10 hover:border-emerald-500/30"
                        : "border-slate-200/60 dark:border-white/5 opacity-70 bg-slate-50/50 dark:bg-slate-950/40"
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400">
                            {rule.category}
                          </span>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{rule.name}</h4>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {rule.is_enabled ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> ACTIVE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 px-2 py-0.5 rounded-full">
                              MUTED
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-sans min-h-[36px]">
                        {rule.description || `Automated dispatch for ${rule.event_type}`}
                      </p>

                      <div className="text-[11px] font-mono text-cyan-800 dark:text-cyan-300/80 bg-slate-100 dark:bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/5 truncate">
                        ⚡ Trigger: {rule.event_type}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400 font-mono">
                        {rule.is_enabled ? "Auto-sending enabled" : "Manual dispatch only"}
                      </span>

                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => handleToggleRule(rule.event_type, !rule.is_enabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          rule.is_enabled ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
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

      {/* ── TAB: BOT BUILDER & AWAY RULES ─────────────────────────────────── */}
      {activeTab === "bot_builder" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Away Auto-Responder */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/10">
                <div className="space-y-1">
                  <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Moon size={18} className="text-indigo-600 dark:text-indigo-400" /> After-Hours Away Auto-Responder
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Automatically reply when customers message outside store working hours.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {awaySettings.enabled ? "ACTIVE" : "OFF"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAwaySettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      awaySettings.enabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                        awaySettings.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Sun size={14} className="text-amber-500" /> Store Opens (Start Time)
                  </label>
                  <input
                    type="time"
                    value={awaySettings.start_time || "09:00"}
                    onChange={e => setAwaySettings(prev => ({ ...prev, start_time: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Moon size={14} className="text-indigo-600 dark:text-indigo-400" /> Store Closes (End Time)
                  </label>
                  <input
                    type="time"
                    value={awaySettings.end_time || "20:00"}
                    onChange={e => setAwaySettings(prev => ({ ...prev, end_time: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Calendar size={14} className="text-cyan-600 dark:text-cyan-400" /> Working Business Days
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
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/5 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Away Auto-Reply Message</label>
                  <span className="text-[10px] text-slate-400">Supports *bold*, _italic_, placeholders</span>
                </div>
                <textarea
                  rows={4}
                  value={awaySettings.text}
                  onChange={e => setAwaySettings(prev => ({ ...prev, text: e.target.value }))}
                  placeholder="Enter message to send when customer writes outside business hours..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed resize-none"
                />
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveAwaySettings}
                  disabled={savingAwaySettings}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm"
                >
                  {savingAwaySettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Away Responder
                </Button>
              </div>
            </div>

            {/* Sandbox Simulator */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 space-y-5 shadow-sm flex flex-col justify-between">
              <div className="space-y-4">
                <div className="space-y-1 pb-3 border-b border-slate-200 dark:border-white/10">
                  <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles size={18} className="text-amber-500" /> Interactive Bot Simulator
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Test what the bot responds with when a customer types different queries.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Simulate Customer Input</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={simulatedBotInput}
                      onChange={e => setSimulatedBotInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSimulateBot()}
                      placeholder="e.g. 'store hours', 'repairs', 'bank', '1'"
                      className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                    />
                    <Button
                      onClick={handleSimulateBot}
                      disabled={simulatingBot || !simulatedBotInput.trim()}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl flex items-center gap-1.5 shrink-0 shadow-sm"
                    >
                      {simulatingBot ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      Test
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Simulated Bot Reply</span>
                  {simulatedBotReply ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 size={12} /> Matched Rule: {simulatedBotReply.rule}
                        </span>
                        <span className="font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded text-[10px] uppercase">
                          {simulatedBotReply.matchType}
                        </span>
                      </div>
                      <div className="bg-slate-100 dark:bg-[#0b141a] p-3.5 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 shadow-xs max-w-full">
                        <div className="bg-emerald-100 text-emerald-950 dark:bg-[#005c4b] dark:text-white p-3.5 rounded-2xl rounded-tr-sm text-xs space-y-1">
                          <FormattedWhatsAppText text={simulatedBotReply.text} isDark={false} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 dark:bg-slate-950/60 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl p-6 text-center text-xs text-slate-400 space-y-1">
                      <Bot size={24} className="mx-auto text-slate-400" />
                      <p>Type a test phrase above to preview simulated bot reply.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: SMART MESSENGER ─────────────────────────────────────────── */}
      {activeTab === "messenger" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-150">
          <div className="lg:col-span-7 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 space-y-5 shadow-sm">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Send size={18} className="text-emerald-600 dark:text-emerald-400" /> Smart Message Composer
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Dispatch personalized WhatsApp messages with real-time phone normalization and variable resolution.
              </p>
            </div>

            <form onSubmit={handleSendDirect} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
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

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Recipient Phone Number:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. 0764158980 or 94764158980"
                    value={directPhone}
                    onChange={e => { setDirectPhone(e.target.value); setNumberStatus(null); }}
                    className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3 text-sm text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleCheckNumber}
                    disabled={!directPhone.trim() || checkingNumber || status !== "CONNECTED"}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-40 transition font-bold"
                  >
                    {checkingNumber ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />}
                    Verify WA
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Message Content:</label>
                <textarea
                  rows={6}
                  placeholder="Type your WhatsApp message..."
                  value={directMessage}
                  onChange={e => setDirectMessage(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3 text-sm text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none leading-relaxed font-sans"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={sendingDirect || status !== "CONNECTED"}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 flex items-center justify-center gap-2 rounded-xl transition shadow-sm cursor-pointer"
              >
                {sendingDirect
                  ? <><Loader2 size={16} className="animate-spin" /> Dispatching via Provider Pipeline...</>
                  : <><Send size={16} /> Send WhatsApp Message</>}
              </Button>
            </form>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-slate-950 border border-slate-200/90 dark:border-white/10 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Sparkles size={14} className="text-emerald-600 dark:text-emerald-400" /> WhatsApp Live Bubble Preview
              </p>
              <div className="bg-slate-100 dark:bg-[#0b141a] rounded-2xl p-4 border border-slate-200 dark:border-[#1f2c34] min-h-[180px] flex justify-end">
                <div className="bg-emerald-100 text-slate-900 dark:bg-[#005c4b] dark:text-slate-100 p-3.5 rounded-xl max-w-sm shadow-xs text-xs whitespace-pre-wrap font-sans relative leading-relaxed">
                  {directMessage ? formatWhatsappPreview(directMessage) : <span className="text-slate-400 italic">Preview will appear here as you type...</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: TEMPLATES & VARIABLES ────────────────────────────────────── */}
      {activeTab === "templates" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-in fade-in duration-150">
          <div className="lg:col-span-4 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-3xl p-6 flex flex-col space-y-4 shadow-sm">
            <div className="space-y-3.5 pb-4 border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-xs">
                    <SlidersHorizontal size={17} />
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Templates</h3>
                    <p className="text-[11px] text-slate-400 font-medium">{templates.length} system templates</p>
                  </div>
                </div>
              </div>

              <div className="relative pt-1">
                <Search size={14} className="absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search template..."
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-white/10 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-3 max-h-[580px] overflow-y-auto pr-2 wa-custom-scroll">
              {templates
                .filter(tmpl => !templateSearch.trim() || (tmpl.name || "").toLowerCase().includes(templateSearch.toLowerCase()))
                .map(tmpl => (
                  <button
                    key={tmpl.event_type}
                    onClick={() => handleSelectTemplate(tmpl)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      selectedEventType === tmpl.event_type
                        ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-500 text-slate-900 dark:text-white shadow-sm"
                        : "bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold truncate">{tmpl.name}</span>
                      <span className="text-[9px] px-2 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 uppercase font-mono">{tmpl.category || "General"}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{tmpl.description}</p>
                  </button>
                ))}
            </div>
          </div>

          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-3xl p-6 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-white/10 pb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{currentTemplate.name || "Template Editor"}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{currentTemplate.description}</p>
                </div>

                <Button
                  onClick={handleSaveTemplate}
                  disabled={savingTemplate}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 py-2 rounded-xl flex items-center gap-1.5"
                >
                  {savingTemplate ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Template
                </Button>
              </div>

              <textarea
                ref={templateTextareaRef}
                rows={9}
                value={editedBody}
                onChange={e => setEditedBody(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-100 font-mono leading-relaxed focus:border-emerald-500 focus:outline-none"
                placeholder="Type template text..."
              />
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AUDIT TRAIL & LOGS ────────────────────────────────────────── */}
      {activeTab === "logs" && (
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 space-y-4 shadow-sm animate-in fade-in duration-150">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Clock size={18} className="text-emerald-600 dark:text-emerald-400" /> Dispatch History & Audit Trail
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Click on any message row to inspect its full step-by-step pipeline execution trace.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button
                onClick={fetchLogs}
                className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              >
                <RefreshCw size={14} className={loadingLogs ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-xl bg-slate-50/50 dark:bg-slate-950/40">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="bg-slate-100 dark:bg-black/40 text-slate-600 dark:text-slate-400 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-white/10">
                <tr>
                  <th className="p-3.5">Time</th>
                  <th className="p-3.5">Recipient</th>
                  <th className="p-3.5">Event</th>
                  <th className="p-3.5">Message</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                {logs.map(log => (
                  <tr
                    key={log.id}
                    onClick={() => handleOpenTrace(log.id)}
                    className="hover:bg-slate-100/80 dark:hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <td className="p-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="p-3.5">
                      <p className="font-bold text-slate-900 dark:text-white">{log.customer_name || "—"}</p>
                      <p className="font-mono text-[11px] text-slate-500">+{log.phone_number}</p>
                    </td>
                    <td className="p-3.5 whitespace-nowrap font-bold text-slate-800 dark:text-slate-200">
                      {log.template_name || log.event_type}
                    </td>
                    <td className="p-3.5 max-w-xs truncate font-sans text-xs">
                      {log.message_body}
                    </td>
                    <td className="p-3.5 whitespace-nowrap">
                      <MsgStatusBadge status={log.status} />
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenTrace(log.id)}
                        className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 transition inline-flex items-center gap-1"
                      >
                        <Eye size={12} /> Trace
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: DIAGNOSTICS & QR PAIRING ─────────────────────────────────── */}
      {activeTab === "diagnostics" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-150">
          <div className="lg:col-span-7 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400" /> Automated Pipeline Diagnostics
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Run an 8-step end-to-end audit verifying every component in the WhatsApp dispatch chain.</p>
              </div>
              <Button
                onClick={handleRunDiagnostics}
                disabled={runningDiagnostics}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center gap-2 text-xs rounded-xl cursor-pointer"
              >
                {runningDiagnostics ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Run Diagnostic
              </Button>
            </div>

            {diagnosticResults ? (
              <div className="space-y-3">
                <div className="divide-y divide-slate-200 dark:divide-white/5 border border-slate-200 dark:border-white/10 rounded-xl bg-slate-50 dark:bg-slate-950/40">
                  {diagnosticResults.results.map((r, i) => (
                    <div key={i} className="p-3 flex items-start justify-between gap-3 text-xs">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-white">{r.step}</span>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{r.detail}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-extrabold text-[10px] uppercase ${
                        r.status === "PASS"
                          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-200"
                          : "bg-rose-50 text-rose-800 dark:bg-rose-500/20 dark:text-rose-400 border border-rose-200"
                      }`}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-950/40 border border-dashed border-slate-200 dark:border-white/10 rounded-xl p-8 text-center text-xs text-slate-500 space-y-2">
                <ShieldCheck size={28} className="mx-auto text-slate-400" />
                <p className="font-bold text-slate-700 dark:text-slate-300">No Diagnostic Run Yet</p>
                <p>Click "Run Diagnostic" to verify connection readiness.</p>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-white/10 rounded-2xl p-6 text-center space-y-5 shadow-sm">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center justify-center gap-2">
                <QrCode size={18} className="text-emerald-600 dark:text-emerald-400" /> Device Pairing
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Link your store phone to auto-send receipts without third-party fees.</p>
            </div>

            {status === "CONNECTED" ? (
              <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-6 space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h4 className="text-base font-bold text-emerald-800 dark:text-emerald-300">WhatsApp Device Linked</h4>
                  {connectedUser && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-sm font-black text-slate-900 dark:text-white">{connectedUser.pushname}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">+{connectedUser.wid}</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Automated invoices, repair notifications, and bot auto-replies will dispatch seamlessly.</p>
                <div className="pt-2 flex justify-center gap-2">
                  <Button
                    onClick={handleUnlink}
                    variant="outline"
                    className="border-rose-200 hover:bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:hover:bg-rose-500/10 dark:text-rose-300 text-xs px-4 py-2 rounded-xl font-bold"
                  >
                    Unlink / Switch Phone
                  </Button>
                  <Button
                    onClick={handleReconnect}
                    variant="outline"
                    className="border-slate-200 text-slate-700 dark:border-white/10 dark:text-slate-300 text-xs px-3 py-2 rounded-xl font-bold"
                    title="Refresh connection"
                  >
                    <RefreshCw size={13} />
                  </Button>
                </div>
              </div>
            ) : status === "UNPAIRED" && qrCodeUrl ? (
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <div className="bg-white p-2 rounded-2xl inline-block shadow-sm border border-slate-200">
                  <img
                    src={qrCodeUrl}
                    alt="WhatsApp QR Code"
                    className="w-52 h-52 mx-auto rounded-xl object-contain"
                  />
                </div>
                <div className="text-left bg-white dark:bg-black/40 p-3.5 rounded-xl border border-slate-200 dark:border-white/5 space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  <p className="font-bold text-emerald-700 dark:text-emerald-400">How to Pair:</p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
                    <li>Open WhatsApp on your mobile phone.</li>
                    <li>Tap <strong>Settings / Linked Devices</strong>.</li>
                    <li>Tap <strong>Link a Device</strong> and point your camera at this QR code.</li>
                  </ol>
                </div>
                <Button
                  onClick={handleReconnect}
                  variant="outline"
                  className="w-full border-slate-200 text-slate-700 dark:border-white/10 dark:text-slate-300 text-xs py-2 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={13} /> Refresh QR Code
                </Button>
              </div>
            ) : status === "DISCONNECTED" ? (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
                  <AlertCircle size={24} />
                </div>
                <h4 className="text-base font-bold text-amber-800 dark:text-amber-300">Session Disconnected / Unpaired</h4>
                <p className="text-xs text-slate-600 dark:text-slate-400">The WhatsApp Web session is not currently active. Click below to initialize a fresh pairing session and generate a QR code.</p>
                <Button
                  onClick={handleReconnect}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 mx-auto shadow-sm"
                >
                  <QrCode size={14} /> Start Pairing & Generate QR
                </Button>
              </div>
            ) : (
              <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-2xl p-6 text-center text-xs space-y-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                  <XCircle size={20} />
                </div>
                <div>
                  <p className="font-bold text-sm text-rose-800 dark:text-rose-300">Node.js Microservice Offline</p>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">To link a phone or send live messages, the background service must be running:</p>
                </div>
                <div className="bg-white dark:bg-black/40 p-2.5 rounded-xl border border-rose-200 dark:border-white/10 font-mono text-[11px] text-slate-800 dark:text-slate-200 select-all">
                  cd whatsapp_service && npm start
                </div>
                <Button
                  onClick={fetchOverview}
                  className="bg-rose-600 hover:bg-rose-500 text-white text-xs px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 mx-auto"
                >
                  <RefreshCw size={13} /> Check Service Status
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODALS (TRACE, KB, BOT RULE, QUICK REPLY, FOLLOW UP) ─────────────── */}
      {inspectingTrace && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl w-full max-w-xl p-6 text-slate-900 dark:text-slate-100 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/10">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Activity size={18} className="text-emerald-600 dark:text-emerald-400" /> Pipeline Trace
              </h3>
              <button onClick={() => setInspectingTrace(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-2">
              {(inspectingTrace.trace || []).map((step, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5">
                  <span className="font-bold">{step.step}</span>
                  <span className="text-slate-500">{step.status}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setInspectingTrace(null)} className="bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-white px-4 text-xs">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {showQuickReplyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl w-full max-w-lg p-6 text-slate-900 dark:text-slate-100 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/10">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Zap size={18} className="text-amber-500" /> Canned Reply
              </h3>
              <button onClick={() => setShowQuickReplyModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveQuickReply} className="space-y-3">
              <input
                type="text"
                required
                placeholder="/shortcut"
                value={quickReplyForm.shortcut}
                onChange={e => setQuickReplyForm(prev => ({ ...prev, shortcut: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-mono"
              />
              <input
                type="text"
                required
                placeholder="Title"
                value={quickReplyForm.title}
                onChange={e => setQuickReplyForm(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white"
              />
              <textarea
                rows={4}
                required
                placeholder="Content"
                value={quickReplyForm.content}
                onChange={e => setQuickReplyForm(prev => ({ ...prev, content: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setShowQuickReplyModal(false)} variant="outline" className="border-slate-200 dark:border-white/10 text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={savingQuickReply} className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs">
                  Save
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showKbModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-full max-w-xl p-6 text-slate-900 dark:text-slate-100 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/10">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen size={18} className="text-emerald-600 dark:text-emerald-400" /> Policy Article
              </h3>
              <button onClick={() => setShowKbModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveKbArticle} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Policy Title"
                value={kbForm.title}
                onChange={e => setKbForm(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white"
              />
              <textarea
                rows={6}
                required
                placeholder="Policy Content..."
                value={kbForm.content}
                onChange={e => setKbForm(prev => ({ ...prev, content: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3.5 text-xs text-slate-900 dark:text-white"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setShowKbModal(false)} variant="outline" className="border-slate-200 dark:border-white/10 text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={savingKb} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
                  Save Policy
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showFollowUpRuleModal && editingFollowUpRule && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-full max-w-xl p-6 text-slate-900 dark:text-slate-100 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/10">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck size={18} className="text-emerald-600 dark:text-emerald-400" /> Configure Follow-Up
              </h3>
              <button onClick={() => setShowFollowUpRuleModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveFollowUpRule} className="space-y-3">
              <textarea
                rows={4}
                required
                value={followUpForm.template_body}
                onChange={e => setFollowUpForm(prev => ({ ...prev, template_body: e.target.value }))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-3 text-xs text-slate-900 dark:text-white"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setShowFollowUpRuleModal(false)} variant="outline" className="border-slate-200 dark:border-white/10 text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={savingFollowUpRule} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs">
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
