import React, { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Trash2, Bot, TrendingUp, AlertTriangle, Wrench, DollarSign } from "lucide-react";
import { useAIChat } from "./useAIChat";
import "./AIAssistant.css";

const QUICK_PROMPTS = [
  { label: "📊 Store Summary", prompt: "Give me a quick executive summary of today's sales, active repairs, and low stock status.", icon: TrendingUp },
  { label: "⚠️ Low Stock Alert", prompt: "Which inventory items are currently at or below their low stock safety threshold?", icon: AlertTriangle },
  { label: "🔧 Repair Status", prompt: "Summarize active repair tickets and what requires immediate attention.", icon: Wrench },
  { label: "💰 Outstanding Balances", prompt: "What is the total unpaid customer balance and outstanding customer invoices?", icon: DollarSign },
];

export default function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const { messages, sendMessage, isLoading, clearHistory } = useAIChat();
  const chatBottomRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSend = (textToSend) => {
    const text = textToSend || inputText;
    if (!text.trim() || isLoading) return;
    setInputText("");
    sendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        className="ai-assistant-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="I Store AI Assistant"
        aria-label="Toggle AI Assistant"
      >
        <Sparkles size={24} />
      </button>

      {/* Floating Chat Panel */}
      {isOpen && (
        <div className="ai-assistant-panel">
          {/* Header */}
          <div className="ai-assistant-header">
            <div className="ai-assistant-title">
              <Bot size={20} color="#a855f7" />
              <span>I Store AI</span>
              <span className="ai-assistant-badge">Gemini</span>
            </div>
            <div className="ai-header-actions">
              <button
                className="ai-icon-btn"
                onClick={clearHistory}
                title="Clear Chat"
              >
                <Trash2 size={16} />
              </button>
              <button
                className="ai-icon-btn"
                onClick={() => setIsOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="ai-assistant-body">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`ai-message ${msg.role === "user" ? "user" : "model"}`}
              >
                {msg.content || (
                  <div className="ai-typing-indicator">
                    <div className="ai-typing-dot"></div>
                    <div className="ai-typing-dot"></div>
                    <div className="ai-typing-dot"></div>
                  </div>
                )}
              </div>
            ))}

            {/* Quick Action Chips when conversation is initial */}
            {messages.length <= 1 && !isLoading && (
              <div className="ai-quick-chips">
                <div className="ai-quick-title">Suggested Quick Actions:</div>
                <div className="ai-chips-grid">
                  {QUICK_PROMPTS.map((qp, i) => {
                    const IconComp = qp.icon;
                    return (
                      <button
                        key={i}
                        className="ai-chip-btn"
                        onClick={() => handleSend(qp.prompt)}
                      >
                        <IconComp size={14} className="ai-chip-icon" />
                        <span>{qp.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Footer Input */}
          <div className="ai-assistant-footer">
            <input
              type="text"
              className="ai-assistant-input"
              placeholder="Ask about sales, stock, repairs..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <button
              className="ai-send-btn"
              onClick={() => handleSend()}
              disabled={isLoading || !inputText.trim()}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

