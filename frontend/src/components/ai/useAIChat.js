import { useState, useCallback, useRef } from "react";
import api from "../../lib/api";

export function useAIChat() {
  const [messages, setMessages] = useState([
    {
      role: "model",
      content: "Hello! I'm your I Store AI Assistant. How can I help you manage your sales, stock, repairs, or customer reports today?"
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const sendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isLoading) return;

    const newMessages = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setIsLoading(true);
    setError(null);

    // Placeholder entry for streaming output
    setMessages((prev) => [...prev, { role: "model", content: "" }]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const token = localStorage.getItem("token") || sessionStorage.getItem("token");
      const baseURL = (api.defaults.baseURL || "").replace(/\/$/, "");
      const response = await fetch(`${baseURL}/api/ai/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        // Try to read error detail from body
        let detail = `Server error ${response.status}`;
        try { const j = await response.json(); detail = j.detail || j.message || detail; } catch (_) {}
        throw new Error(detail);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let accumText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumText += chunk;

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "model", content: accumText };
          return updated;
        });
      }
    } catch (err) {
      const isAbort = err.name === "AbortError";
      const errorMsg = isAbort ? "Request timed out. The AI took too long to respond." : (err.message || "Failed to communicate with AI service.");
      console.error("AI Assistant Error:", err);
      setError(errorMsg);
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[updated.length - 1]?.role === "model" && !updated[updated.length - 1]?.content) {
          updated[updated.length - 1] = { role: "model", content: `⚠️ ${errorMsg}` };
        }
        return updated;
      });
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, [messages, isLoading]);

  const clearHistory = useCallback(() => {
    setMessages([
      {
        role: "model",
        content: "Chat history cleared. How can I assist you?"
      }
    ]);
    setError(null);
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    error,
    clearHistory
  };
}
