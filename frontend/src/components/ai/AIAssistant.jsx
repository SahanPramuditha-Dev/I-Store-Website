import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  X,
  Send,
  Trash2,
  Bot,
  User,
  TrendingUp,
  AlertTriangle,
  Wrench,
  DollarSign,
  Copy,
  Check,
  RotateCcw,
  Square,
  Maximize2,
  Minimize2,
  PackageCheck,
  BarChart3,
  Lightbulb,
  ShieldAlert,
  ArrowRight,
  Info,
  Mic,
  MicOff,
  Camera,
  Image as ImageIcon,
  ExternalLink,
  Download,
  Users,
  ShoppingCart,
  Receipt,
  FileSpreadsheet
} from "lucide-react";
import { useAIChat } from "./useAIChat";
import { getAuthValue } from "../../lib/rbac";
import "./AIAssistant.css";

function getAutoSelectedRole() {
  try {
    const rawRole = String(
      getAuthValue("login_role") ||
      getAuthValue("role") ||
      localStorage.getItem("login_role") ||
      localStorage.getItem("role") ||
      localStorage.getItem("login_role_label") ||
      ""
    ).toLowerCase();

    if (rawRole.includes("tech") || rawRole.includes("repair")) {
      return "technician";
    }
    if (rawRole.includes("cashier") || rawRole.includes("pos") || rawRole.includes("sales") || rawRole.includes("clerk")) {
      return "cashier";
    }
    return "admin";
  } catch {
    return "admin";
  }
}

const ROLE_PROMPTS = {
  admin: [
    {
      category: "Executive",
      label: "Executive Summary",
      prompt: "Give me an executive summary of today's sales, gross profit estimate, repairs, and low stock status.",
      icon: TrendingUp,
      color: "#6366f1",
    },
    {
      category: "Financial",
      label: "Profit & Margins",
      prompt: "Analyze today's estimated gross profit, margin percentage, and store expenses.",
      icon: BarChart3,
      color: "#10b981",
    },
    {
      category: "Receivables",
      label: "Customer Debts",
      prompt: "What is the total unpaid customer balance and outstanding receivables?",
      icon: DollarSign,
      color: "#f59e0b",
    },
    {
      category: "Inventory",
      label: "Dead Stock Audit",
      prompt: "Identify dead stock items with no sales in 60+ days and tied-up capital.",
      icon: PackageCheck,
      color: "#06b6d4",
    },
    {
      category: "Stock Alert",
      label: "Critical Low Stock",
      prompt: "Which items are below minimum safety threshold and need immediate supplier reordering?",
      icon: AlertTriangle,
      color: "#ef4444",
    },
    {
      category: "Risk / Audit",
      label: "Void & Anomaly Check",
      prompt: "Check for any voided sales, discounts, or abnormal transaction flags today.",
      icon: ShieldAlert,
      color: "#ec4899",
    },
  ],
  technician: [
    {
      category: "Repair Queue",
      label: "Active Tickets",
      prompt: "List all active repair tickets, pending diagnostics, and jobs waiting for parts.",
      icon: Wrench,
      color: "#6366f1",
    },
    {
      category: "Spare Parts",
      label: "Parts Availability",
      prompt: "Check stock levels for common replacement screens, batteries, and spare parts.",
      icon: PackageCheck,
      color: "#10b981",
    },
    {
      category: "Diagnostics",
      label: "Hardware Diagnosis",
      prompt: "How should I diagnose a device with no display and intermittent boot looping?",
      icon: Sparkles,
      color: "#a855f7",
    },
    {
      category: "Turnaround",
      label: "Delayed Repairs",
      prompt: "Are there any repair tickets overdue or in progress for more than 3 days?",
      icon: AlertTriangle,
      color: "#f59e0b",
    },
  ],
  cashier: [
    {
      category: "POS Quick Stats",
      label: "Today's Sales Count",
      prompt: "How many orders and what total revenue has been processed through POS today?",
      icon: TrendingUp,
      color: "#6366f1",
    },
    {
      category: "Receivables",
      label: "Customer Balances",
      prompt: "Check current outstanding customer ledger balances and credit limits.",
      icon: DollarSign,
      color: "#10b981",
    },
    {
      category: "Stock Lookup",
      label: "Item Availability",
      prompt: "Which best-selling accessory and phone items are low in stock right now?",
      icon: PackageCheck,
      color: "#06b6d4",
    },
    {
      category: "Shortcuts",
      label: "POS Navigation Tips",
      prompt: "What are the fastest keyboard shortcuts and search tips for POS checkout?",
      icon: Lightbulb,
      color: "#ec4899",
    },
  ],
};

const FOLLOW_UP_CHIPS = [
  "What are the top low stock items?",
  "How much unpaid customer debt is there?",
  "Give me today's profit margin breakdown",
  "Which repairs are waiting for parts?",
];

function parseInlineMarkdown(text) {
  if (!text) return null;
  const tokens = [];
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*|__.*?__|_.*?_|\$[\d,]+(?:\.\d{2})?|LKR\s*[\d,]+(?:\.\d{2})?)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.substring(lastIndex, match.index));
    }
    const full = match[0];
    if (
      (full.startsWith("**") && full.endsWith("**") && full.length >= 4) ||
      (full.startsWith("__") && full.endsWith("__") && full.length >= 4)
    ) {
      const inner = full.slice(2, -2);
      tokens.push(
        <strong key={match.index} className="ai-md-strong">
          {inner}
        </strong>
      );
    } else if (full.startsWith("`") && full.endsWith("`") && full.length >= 2) {
      tokens.push(
        <code key={match.index} className="ai-md-code">
          {full.slice(1, -1)}
        </code>
      );
    } else if (full.startsWith("$") || full.startsWith("LKR")) {
      tokens.push(
        <span key={match.index} className="ai-md-currency">
          {full}
        </span>
      );
    } else if (
      (full.startsWith("*") && full.endsWith("*") && full.length >= 2) ||
      (full.startsWith("_") && full.endsWith("_") && full.length >= 2)
    ) {
      tokens.push(
        <em key={match.index} className="ai-md-em">
          {full.slice(1, -1)}
        </em>
      );
    } else {
      tokens.push(full);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push(text.substring(lastIndex));
  }
  return tokens.length > 0 ? tokens : text;
}

function renderSmartListItem(item, index) {
  const lower = item.toLowerCase();
  let tag = null;

  if (lower.includes("sales") || lower.includes("revenue") || lower.includes("order")) {
    tag = { label: "Sales", icon: TrendingUp, className: "tag-sales" };
  } else if (lower.includes("profit") || lower.includes("margin") || lower.includes("cogs")) {
    tag = { label: "Profit", icon: BarChart3, className: "tag-profit" };
  } else if (lower.includes("repair") || lower.includes("ticket") || lower.includes("diagnos")) {
    tag = { label: "Repairs", icon: Wrench, className: "tag-repairs" };
  } else if (lower.includes("low stock") || lower.includes("inventory") || lower.includes("dead stock") || lower.includes("threshold")) {
    tag = { label: "Stock", icon: AlertTriangle, className: "tag-warning" };
  } else if (lower.includes("unpaid") || lower.includes("debt") || lower.includes("balance") || lower.includes("receivable")) {
    tag = { label: "Finance", icon: DollarSign, className: "tag-finance" };
  }

  return (
    <li key={index} className="ai-md-list-item">
      <span className="ai-md-bullet">
        <span className="ai-bullet-dot"></span>
      </span>
      <div className="ai-md-list-content">
        {tag && (
          <span className={`ai-kpi-badge ${tag.className}`}>
            <tag.icon size={11} className="ai-kpi-icon" />
            <span>{tag.label}</span>
          </span>
        )}
        <span className="ai-list-text">{parseInlineMarkdown(item)}</span>
      </div>
    </li>
  );
}

function getActionChipsForContent(content, navigate, onClose) {
  if (!content || typeof content !== "string") return [];
  const lower = content.toLowerCase();
  const chips = [];

  const addChip = (label, path, icon) => {
    if (!chips.some((c) => c.path === path)) {
      chips.push({ label, path, icon });
    }
  };

  if (lower.includes("inventory") || lower.includes("stock") || lower.includes("sku") || lower.includes("reorder") || lower.includes("/inventory")) {
    addChip("Open Inventory", "/inventory", PackageCheck);
  }
  if (lower.includes("repair") || lower.includes("ticket") || lower.includes("technician") || lower.includes("/repairs")) {
    addChip("View Repairs", "/repairs", Wrench);
  }
  if (lower.includes("sales") || lower.includes("pos") || lower.includes("cashier") || lower.includes("/pos")) {
    addChip("Open POS", "/pos", ShoppingCart);
  }
  if (lower.includes("customer") || lower.includes("unpaid") || lower.includes("debt") || lower.includes("receivable") || lower.includes("/customers")) {
    addChip("Customer Ledgers", "/customers", Users);
  }
  if (lower.includes("purchase order") || lower.includes("supplier") || lower.includes("/purchase-orders")) {
    addChip("Purchase Orders", "/purchase-orders", Receipt);
  }
  if (lower.includes("expense") || lower.includes("/expenses")) {
    addChip("View Expenses", "/expenses", DollarSign);
  }

  return chips.slice(0, 3);
}

function FormattedAIMessage({ content, isUser, navigate, onClose }) {
  if (!content) return null;

  if (isUser) {
    return <div className="ai-user-text">{content}</div>;
  }

  if (content.startsWith("[AI Error:") || content.startsWith("[AI unavailable:")) {
    return (
      <div className="ai-error-banner">
        <AlertTriangle size={16} className="ai-error-icon" />
        <div className="ai-error-body">
          <span className="ai-error-title">AI Processing Notice</span>
          <span className="ai-error-desc">{content.replace(/^\[|\]$/g, "")}</span>
        </div>
      </div>
    );
  }

  const lines = content.split("\n");
  const elements = [];
  let currentList = null;

  const flushList = () => {
    if (!currentList) return;
    if (currentList.type === "ul") {
      elements.push(
        <ul key={`ul-${elements.length}`} className="ai-md-list">
          {currentList.items.map((item, i) => renderSmartListItem(item, i))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={`ol-${elements.length}`} className="ai-md-num-list">
          {currentList.items.map((item, i) => (
            <li key={i} className="ai-md-num-item">
              <span className="ai-md-num-idx">{i + 1}</span>
              <div className="ai-md-list-content">{parseInlineMarkdown(item)}</div>
            </li>
          ))}
        </ol>
      );
    }
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Markdown Headers
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <div key={`h3-${i}`} className="ai-section-heading h3">
          <span className="ai-heading-bar"></span>
          <h4>{parseInlineMarkdown(trimmed.slice(4))}</h4>
        </div>
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <div key={`h2-${i}`} className="ai-section-heading h2">
          <span className="ai-heading-bar"></span>
          <h3>{parseInlineMarkdown(trimmed.slice(3))}</h3>
        </div>
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(
        <div key={`h1-${i}`} className="ai-section-heading h1">
          <span className="ai-heading-bar"></span>
          <h2>{parseInlineMarkdown(trimmed.slice(2))}</h2>
        </div>
      );
      continue;
    }

    // Section title written as **Actionable Advice:** or Actionable Insights:
    const isStandaloneTitle =
      (trimmed.startsWith("**") && trimmed.endsWith(":**")) ||
      (trimmed.endsWith(":") && trimmed.length < 45 && !trimmed.startsWith("*") && !trimmed.startsWith("-"));

    if (isStandaloneTitle) {
      flushList();
      const cleanTitle = trimmed.replace(/\*\*/g, "").replace(/:$/, "");
      elements.push(
        <div key={`title-${i}`} className="ai-section-title-banner">
          <Lightbulb size={14} className="ai-section-icon" />
          <span className="ai-section-title-text">{cleanTitle}</span>
        </div>
      );
      continue;
    }

    // Bullet item (*, -, •)
    const bulletMatch = trimmed.match(/^[\*\-\•]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(bulletMatch[1]);
      continue;
    }

    // Numbered item (1., 2., etc.)
    const numMatch = trimmed.match(/^\d+[\.\)]\s+(.*)$/);
    if (numMatch) {
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(numMatch[1]);
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${i}`} className="ai-md-p">
        {parseInlineMarkdown(trimmed)}
      </p>
    );
  }

  flushList();

  const actionChips = getActionChipsForContent(content, navigate, onClose);

  return (
    <div className="ai-rendered-content">
      {elements}

      {/* Embedded Action Navigation Chips */}
      {actionChips.length > 0 && (
        <div className="ai-action-chips-container">
          <span className="ai-action-chips-title">Quick Actions:</span>
          <div className="ai-action-chips-list">
            {actionChips.map((chip, idx) => {
              const Icon = chip.icon;
              return (
                <button
                  key={idx}
                  className="ai-action-nav-chip"
                  onClick={() => {
                    navigate(chip.path);
                    if (onClose) onClose();
                  }}
                  title={`Navigate to ${chip.label}`}
                >
                  <Icon size={12} className="ai-nav-chip-icon" />
                  <span>{chip.label}</span>
                  <ExternalLink size={10} className="ai-nav-chip-arrow" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AIAssistant() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputText, setInputText] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [activeRole, setActiveRole] = useState(() => getAutoSelectedRole());
  const [attachedImage, setAttachedImage] = useState(null); // { base64, previewUrl, name }
  const [isListening, setIsListening] = useState(false);

  const {
    messages,
    sendMessage,
    stopGeneration,
    retryLastMessage,
    isLoading,
    clearHistory,
  } = useAIChat();

  const chatBottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const speechRecognitionRef = useRef(null);

  // Sync role automatically whenever AI modal is opened
  useEffect(() => {
    if (isOpen) {
      setActiveRole(getAutoSelectedRole());
    }
  }, [isOpen]);

  // Auto scroll
  useEffect(() => {
    if (isOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const baseSpeechTextRef = useRef("");

  // Setup Web Speech API for voice dictation
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };
      recognition.onend = () => {
        setIsListening(false);
      };
      recognition.onerror = (e) => {
        console.warn("Speech recognition error:", e);
        setIsListening(false);
      };
      recognition.onresult = (event) => {
        let speechTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          speechTranscript += event.results[i][0].transcript;
        }
        const base = baseSpeechTextRef.current.trim();
        const speech = speechTranscript.trim();
        setInputText(base ? `${base} ${speech}` : speech);
      };

      speechRecognitionRef.current = recognition;
    }
  }, []);

  const toggleSpeechRecognition = () => {
    if (!speechRecognitionRef.current) {
      alert("Voice input is not supported in this browser. Please use Chrome or Edge.");
      return;
    }
    if (isListening) {
      speechRecognitionRef.current.stop();
    } else {
      baseSpeechTextRef.current = inputText;
      try {
        speechRecognitionRef.current.start();
      } catch (err) {
        console.warn("Speech start error:", err);
      }
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload a valid image file (PNG, JPG, WebP).");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedImage({
        base64: event.target.result,
        previewUrl: event.target.result,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemoveImage = () => {
    setAttachedImage(null);
  };

  const handleSend = (textToSend) => {
    const text = textToSend !== undefined ? textToSend : inputText;
    const imageToSend = attachedImage?.base64 || null;

    if ((!text.trim() && !imageToSend) || isLoading) return;

    setInputText("");
    setAttachedImage(null);
    if (isListening && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userRoleLabel = getAuthValue("login_role_label") || getAuthValue("login_role") || "Staff";
    sendMessage(text || "Please analyze this attached photo.", imageToSend, activeRole, userRoleLabel);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e) => {
    setInputText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
  };

  const handleCopyMessage = (content, id) => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportChat = () => {
    const exportText = messages
      .map((m) => {
        const author = m.role === "user" ? "👤 User" : "🤖 E Store AI";
        const dateStr = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
        return `### ${author} [${dateStr}]\n${m.content}\n`;
      })
      .join("\n---\n\n");

    const blob = new Blob([`# E Store AI Conversation Export\n\n${exportText}`], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `E-Store-AI-Report-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatTime = (ts) => {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const activeRolePrompts = ROLE_PROMPTS[activeRole] || ROLE_PROMPTS.admin;

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        className={`ai-assistant-toggle-btn ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        title="E Store AI Assistant"
        aria-label="Toggle AI Assistant"
      >
        <Sparkles size={20} className="ai-btn-sparkle" />
        <span className="ai-btn-pulse"></span>
      </button>

      {/* Floating Chat Panel */}
      {isOpen && (
        <div className={`ai-assistant-panel ${isExpanded ? "expanded" : ""}`}>
          {/* Header */}
          <div className="ai-assistant-header">
            <div className="ai-assistant-title">
              <div className="ai-bot-avatar">
                <Bot size={18} />
              </div>
              <div className="ai-title-details">
                <div className="ai-name-row">
                  <span className="ai-name-text">E Store AI</span>
                  <span className="ai-assistant-badge">Gemini 3.5</span>
                </div>
                <span className="ai-status-indicator">
                  <span className="ai-status-dot"></span> Live Store Intelligence
                </span>
              </div>
            </div>

            <div className="ai-header-actions">
              <button
                className="ai-icon-btn"
                onClick={handleExportChat}
                title="Export conversation"
                aria-label="Export chat"
              >
                <Download size={15} />
              </button>

              <button
                className="ai-icon-btn"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Standard view" : "Expand view"}
                aria-label="Toggle size"
              >
                {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>

              <button
                className="ai-icon-btn"
                onClick={clearHistory}
                title="Clear Chat"
                aria-label="Clear chat"
              >
                <Trash2 size={15} />
              </button>

              <button
                className="ai-icon-btn close-btn"
                onClick={() => setIsOpen(false)}
                title="Close"
                aria-label="Close panel"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          {/* Role Filter Tabs */}
          <div className="ai-role-tabs-bar">
            <span className="ai-role-tabs-label">Role:</span>
            <div className="ai-role-pills">
              <button
                className={`ai-role-pill ${activeRole === "admin" ? "active" : ""}`}
                onClick={() => setActiveRole("admin")}
              >
                Admin / Owner
              </button>
              <button
                className={`ai-role-pill ${activeRole === "technician" ? "active" : ""}`}
                onClick={() => setActiveRole("technician")}
              >
                Technician
              </button>
              <button
                className={`ai-role-pill ${activeRole === "cashier" ? "active" : ""}`}
                onClick={() => setActiveRole("cashier")}
              >
                Cashier
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="ai-assistant-body">
            {messages.map((msg, idx) => {
              const isUser = msg.role === "user";
              const msgId = msg.id || `msg-${idx}`;
              const isCopied = copiedId === msgId;

              return (
                <div
                  key={msgId}
                  className={`ai-message-row ${isUser ? "user-row" : "model-row"}`}
                >
                  <div className={`ai-avatar-circle ${isUser ? "user-avatar" : "model-avatar"}`}>
                    {isUser ? <User size={13} /> : <Bot size={13} />}
                  </div>

                  <div className={`ai-message-container ${isUser ? "user" : "model"}`}>
                    <div className="ai-message-bubble">
                      {/* Attached user image thumbnail */}
                      {isUser && msg.image_base64 && (
                        <div className="ai-bubble-image-wrapper">
                          <img
                            src={msg.image_base64}
                            alt="Uploaded attachment"
                            className="ai-bubble-image"
                          />
                        </div>
                      )}

                      {msg.content ? (
                        <FormattedAIMessage
                          content={msg.content}
                          isUser={isUser}
                          navigate={navigate}
                          onClose={() => setIsOpen(false)}
                        />
                      ) : (
                        <div className="ai-typing-indicator">
                          <span className="ai-typing-text">Analyzing store metrics</span>
                          <div className="ai-typing-dots">
                            <div className="ai-typing-dot"></div>
                            <div className="ai-typing-dot"></div>
                            <div className="ai-typing-dot"></div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Message Meta */}
                    <div className="ai-message-meta">
                      <span className="ai-msg-time">{formatTime(msg.timestamp)}</span>
                      {!isUser && msg.content && (
                        <button
                          className={`ai-action-btn ${isCopied ? "copied" : ""}`}
                          onClick={() => handleCopyMessage(msg.content, msgId)}
                          title="Copy response"
                        >
                          {isCopied ? (
                            <>
                              <Check size={11} />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Quick Action Cards */}
            {messages.length <= 1 && !isLoading && (
              <div className="ai-quick-chips">
                <div className="ai-quick-title">
                  <Sparkles size={13} className="ai-quick-sparkle" />
                  <span>Suggested {activeRole.toUpperCase()} Queries</span>
                </div>
                <div className="ai-chips-grid">
                  {activeRolePrompts.map((qp, i) => {
                    const IconComp = qp.icon;
                    return (
                      <button
                        key={i}
                        className="ai-chip-card"
                        onClick={() => handleSend(qp.prompt)}
                      >
                        <div
                          className="ai-chip-icon-box"
                          style={{ color: qp.color, background: `${qp.color}15` }}
                        >
                          <IconComp size={15} />
                        </div>
                        <div className="ai-chip-text-box">
                          <span className="ai-chip-label">{qp.label}</span>
                          <span className="ai-chip-category">{qp.category}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Follow-up Quick Pills */}
          {messages.length > 1 && !isLoading && (
            <div className="ai-followup-ribbon">
              {FOLLOW_UP_CHIPS.map((chip, idx) => (
                <button
                  key={idx}
                  className="ai-followup-pill"
                  onClick={() => handleSend(chip)}
                >
                  <span>{chip}</span>
                  <ArrowRight size={11} className="ai-pill-arrow" />
                </button>
              ))}
            </div>
          )}

          {/* Retry bar if there's an error */}
          {!isLoading && messages.length > 1 && messages[messages.length - 1]?.content?.includes("[AI Error:") && (
            <div className="ai-retry-bar">
              <button className="ai-retry-btn" onClick={retryLastMessage}>
                <RotateCcw size={13} />
                <span>Retry Last Request</span>
              </button>
            </div>
          )}

          {/* Attached Image Preview Pill */}
          {attachedImage && (
            <div className="ai-attachment-preview-bar">
              <div className="ai-attachment-thumb-box">
                <img
                  src={attachedImage.previewUrl}
                  alt="Attachment preview"
                  className="ai-attachment-thumb"
                />
              </div>
              <div className="ai-attachment-info">
                <span className="ai-attachment-name">{attachedImage.name}</span>
                <span className="ai-attachment-hint">Ready for visual diagnosis</span>
              </div>
              <button
                className="ai-attachment-remove"
                onClick={handleRemoveImage}
                title="Remove image"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Footer Input Area */}
          <div className="ai-assistant-footer">
            <div className="ai-input-pill">
              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleImageSelect}
              />

              {/* Photo / Vision Button */}
              <button
                type="button"
                className={`ai-pill-tool-btn ${attachedImage ? "has-attachment" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                title="Attach photo of broken device or invoice for diagnosis"
                disabled={isLoading}
              >
                <Camera size={15} />
              </button>

              {/* Voice Dictation Button */}
              <button
                type="button"
                className={`ai-pill-tool-btn ${isListening ? "listening" : ""}`}
                onClick={toggleSpeechRecognition}
                title={isListening ? "Listening... click to stop" : "Voice dictation (Speak)"}
                disabled={isLoading}
              >
                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
                {isListening && <span className="ai-mic-pulse"></span>}
              </button>

              <textarea
                ref={textareaRef}
                className="ai-assistant-textarea"
                placeholder={
                  isListening
                    ? "Listening... speak clearly now"
                    : attachedImage
                    ? "Ask question about attached image..."
                    : "Ask about sales, profits, repairs, stock, debt..."
                }
                rows={1}
                value={inputText}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
              />

              {isLoading ? (
                <button
                  className="ai-stop-btn"
                  onClick={stopGeneration}
                  title="Stop generating"
                  aria-label="Stop generating"
                >
                  <Square size={13} />
                </button>
              ) : (
                <button
                  className="ai-send-btn"
                  onClick={() => handleSend()}
                  disabled={!inputText.trim() && !attachedImage}
                  title="Send message"
                  aria-label="Send message"
                >
                  <Send size={14} />
                </button>
              )}
            </div>

            <div className="ai-footer-hint">
              <span>Press <kbd>Enter</kbd> to send, <kbd>Shift+Enter</kbd> for new line</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
