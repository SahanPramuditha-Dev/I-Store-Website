import { useState, useCallback, useRef } from "react";
import api from "../../lib/api";

export function useAIChat() {
  const [messages, setMessages] = useState([
    {
      id: "init-1",
      role: "model",
      content: "Hello! I'm your E Store AI Assistant. How can I help you manage your sales, stock, repairs, or customer reports today?",
      timestamp: new Date()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (userText, imageBase64 = null, userRole = "admin", userName = "Manager") => {
    if ((!userText.trim() && !imageBase64) || isLoading) return;

    const userMessageId = `u-${Date.now()}`;
    const modelMessageId = `m-${Date.now()}`;

    const newMessages = [
      ...messages,
      { 
        id: userMessageId, 
        role: "user", 
        content: userText, 
        image_base64: imageBase64,
        timestamp: new Date() 
      }
    ];

    setMessages(newMessages);
    setIsLoading(true);
    setError(null);

    // Placeholder entry for streaming output
    setMessages((prev) => [
      ...prev,
      { id: modelMessageId, role: "model", content: "", timestamp: new Date() }
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 60000);

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
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
            image_base64: m.image_base64 || null
          })),
          user_role: userRole,
          user_name: userName
        }),
      });

      if (!response.ok) {
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
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "model") {
            updated[lastIdx] = { ...updated[lastIdx], content: accumText };
          }
          return updated;
        });
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("AI generation stopped or timed out");
      } else {
        const errorMsg = err.message || "Failed to communicate with AI service.";
        console.error("AI Assistant Error:", err);
        setError(errorMsg);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx]?.role === "model" && !updated[lastIdx]?.content) {
            updated[lastIdx] = { ...updated[lastIdx], content: `[AI Error: ${errorMsg}]` };
          }
          return updated;
        });
      }
    } finally {
      clearTimeout(timeoutId);
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, [messages, isLoading]);

  const retryLastMessage = useCallback(() => {
    // Find the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg && !isLoading) {
      // Remove last model message if empty or error
      setMessages((prev) => {
        const copy = [...prev];
        if (copy.length > 0 && copy[copy.length - 1].role === "model") {
          copy.pop();
        }
        if (copy.length > 0 && copy[copy.length - 1].role === "user") {
          copy.pop();
        }
        return copy;
      });
      sendMessage(lastUserMsg.content);
    }
  }, [messages, isLoading, sendMessage]);

  const clearHistory = useCallback(() => {
    stopGeneration();
    setMessages([
      {
        id: `init-${Date.now()}`,
        role: "model",
        content: "Chat history cleared. How can I assist you?",
        timestamp: new Date()
      }
    ]);
    setError(null);
  }, [stopGeneration]);

  return {
    messages,
    sendMessage,
    stopGeneration,
    retryLastMessage,
    isLoading,
    error,
    clearHistory
  };
}
