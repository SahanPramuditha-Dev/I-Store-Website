import { createContext, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X, MessageSquare } from "lucide-react";

const FeedbackContext = createContext(null);

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [promptState, setPromptState] = useState(null);
  const recentToastsRef = useRef(new Map());

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const toast = (messageOrObj, tone = "info", timeoutMs = 3800) => {
    const id = makeId();
    let toastItem = { id, tone, timeoutMs };

    if (typeof messageOrObj === "object" && messageOrObj !== null && (messageOrObj.title || messageOrObj.description)) {
      toastItem = {
        ...toastItem,
        title: messageOrObj.title || "",
        description: messageOrObj.description || messageOrObj.message || "",
        details: messageOrObj.details || "",
        tone: messageOrObj.tone || tone,
        iconType: messageOrObj.iconType || (messageOrObj.title?.toLowerCase().includes("whatsapp") ? "whatsapp" : null),
      };
    } else {
      let text = "";
      if (messageOrObj === null || messageOrObj === undefined) text = "";
      else if (typeof messageOrObj === "string") text = messageOrObj;
      else if (typeof messageOrObj === "object") {
        if (messageOrObj.message) text = String(messageOrObj.message);
        else if (messageOrObj.detail) text = String(messageOrObj.detail);
        else text = JSON.stringify(messageOrObj);
      } else {
        text = String(messageOrObj);
      }

      // Automatically strip emoji prefixes so only React Lucide icons are displayed
      const cleanText = text
        .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}âœ…]+/gu, "")
        .trim();

      toastItem = {
        ...toastItem,
        description: cleanText,
        tone,
      };
    }

    // Prevent duplicate consecutive toasts fired within 800ms
    const dedupKey = `${toastItem.title}_${toastItem.description}_${toastItem.tone}`;
    const now = Date.now();
    const lastSeen = recentToastsRef.current.get(dedupKey) || 0;
    if (now - lastSeen < 800) {
      return;
    }
    recentToastsRef.current.set(dedupKey, now);

    setToasts((prev) => [...prev, toastItem]);
    const duration = messageOrObj?.timeoutMs || timeoutMs;
    if (duration > 0) setTimeout(() => dismissToast(id), duration);
  };

  const confirm = (title, message) =>
    new Promise((resolve) => {
      setConfirmState({ title, message, resolve });
    });

  const prompt = (title, message, options = {}) =>
    new Promise((resolve) => {
      setPromptState({
        title,
        message,
        value: options.defaultValue || "",
        placeholder: options.placeholder || "",
        multiline: Boolean(options.multiline),
        confirmText: options.confirmText || "Continue",
        resolve,
      });
    });

  const respondConfirm = (value) => {
    if (confirmState?.resolve) confirmState.resolve(value);
    setConfirmState(null);
  };

  const respondPrompt = (value) => {
    if (promptState?.resolve) promptState.resolve(value);
    setPromptState(null);
  };

  const value = useMemo(() => ({ toast, confirm, prompt }), []);

  const renderIcon = (t) => {
    if (t.iconType === "whatsapp") {
      return <MessageSquare size={16} className="text-emerald-400 shrink-0 mt-0.5" />;
    }
    switch (t.tone) {
      case "success":
        return <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />;
      case "error":
        return <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />;
      case "warning":
        return <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />;
      default:
        return <Info size={16} className="text-sky-400 shrink-0 mt-0.5" />;
    }
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="fixed z-[120] top-4 right-4 w-[min(400px,calc(100vw-2rem))] space-y-2.5 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-2xl border p-3.5 text-sm shadow-2xl backdrop-blur-xl transition-all duration-200 animate-in fade-in slide-in-from-top-2 ${
              t.tone === "success"
                ? "bg-slate-900/95 border-emerald-500/40 text-slate-100 shadow-emerald-950/30"
                : t.tone === "error"
                ? "bg-slate-900/95 border-rose-500/40 text-slate-100 shadow-rose-950/30"
                : t.tone === "warning"
                ? "bg-slate-900/95 border-amber-500/40 text-slate-100 shadow-amber-950/30"
                : "bg-slate-900/95 border-sky-500/40 text-slate-100 shadow-sky-950/30"
            }`}
          >
            <div className="flex items-start gap-3">
              {renderIcon(t)}
              <div className="flex-1 min-w-0 pr-1">
                {t.title && (
                  <h4 className="text-xs font-black uppercase tracking-wider text-white mb-0.5 flex items-center gap-1.5">
                    {t.title}
                  </h4>
                )}
                <p className="text-xs text-slate-200 leading-relaxed break-words whitespace-pre-line">
                  {t.description}
                </p>
                {t.details && (
                  <div className="mt-1.5 text-[11px] font-mono text-slate-400 bg-black/40 border border-white/5 rounded-lg px-2.5 py-1 inline-block">
                    {t.details}
                  </div>
                )}
              </div>
              <button
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition shrink-0"
                onClick={() => dismissToast(t.id)}
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-md grid place-items-center p-4">
          <div className="panel w-full max-w-md p-6 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
            <h3 className="text-lg font-black text-white mb-2">{confirmState.title}</h3>
            <p className="text-sm text-slate-300 mb-6">{confirmState.message}</p>
            <div className="flex justify-end gap-2.5">
              <button className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition" onClick={() => respondConfirm(false)}>
                Cancel
              </button>
              <button className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition shadow-lg shadow-rose-900/30" onClick={() => respondConfirm(true)}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {promptState && (
        <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-md grid place-items-center p-4">
          <div className="panel w-full max-w-md p-6 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
            <h3 className="text-lg font-black text-white mb-2">{promptState.title}</h3>
            {promptState.message ? <p className="text-sm text-slate-300 mb-4">{promptState.message}</p> : null}
            {promptState.multiline ? (
              <textarea
                autoFocus
                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-emerald-500 focus:outline-none min-h-[110px]"
                placeholder={promptState.placeholder}
                value={promptState.value}
                onChange={(event) => setPromptState((prev) => ({ ...prev, value: event.target.value }))}
              />
            ) : (
              <input
                autoFocus
                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                placeholder={promptState.placeholder}
                value={promptState.value}
                onChange={(event) => setPromptState((prev) => ({ ...prev, value: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") respondPrompt(promptState.value);
                  if (event.key === "Escape") respondPrompt(null);
                }}
              />
            )}
            <div className="mt-4 flex justify-end gap-2.5">
              <button className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition" onClick={() => respondPrompt(null)}>
                Cancel
              </button>
              <button className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition shadow-lg shadow-emerald-900/30" onClick={() => respondPrompt(promptState.value)}>
                {promptState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside FeedbackProvider");
  return ctx;
}
