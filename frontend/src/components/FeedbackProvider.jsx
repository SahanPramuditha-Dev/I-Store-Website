import { createContext, useContext, useMemo, useState } from "react";

const FeedbackContext = createContext(null);

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [promptState, setPromptState] = useState(null);

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const toast = (message, tone = "info", timeoutMs = 2800) => {
    const id = makeId();
    setToasts((prev) => [...prev, { id, message, tone }]);
    if (timeoutMs > 0) setTimeout(() => dismissToast(id), timeoutMs);
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

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="fixed z-[120] top-4 right-4 w-[min(360px,calc(100vw-2rem))] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur ${
              t.tone === "success"
                ? "bg-emerald-500/15 border-emerald-400/35 text-emerald-100"
                : t.tone === "error"
                ? "bg-rose-500/15 border-rose-400/35 text-rose-100"
                : t.tone === "warning"
                ? "bg-amber-500/15 border-amber-400/35 text-amber-100"
                : "bg-sky-500/15 border-sky-400/35 text-sky-100"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p>{t.message}</p>
              <button className="text-xs opacity-80 hover:opacity-100" onClick={() => dismissToast(t.id)}>
                Close
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-sm grid place-items-center p-4">
          <div className="panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold mb-2">{confirmState.title}</h3>
            <p className="text-sm text-slate-300 mb-4">{confirmState.message}</p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => respondConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => respondConfirm(true)}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {promptState && (
        <div className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-sm grid place-items-center p-4">
          <div className="panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold mb-2">{promptState.title}</h3>
            {promptState.message ? <p className="text-sm text-slate-300 mb-4">{promptState.message}</p> : null}
            {promptState.multiline ? (
              <textarea
                autoFocus
                className="field min-h-[110px] w-full"
                placeholder={promptState.placeholder}
                value={promptState.value}
                onChange={(event) => setPromptState((prev) => ({ ...prev, value: event.target.value }))}
              />
            ) : (
              <input
                autoFocus
                className="field w-full"
                placeholder={promptState.placeholder}
                value={promptState.value}
                onChange={(event) => setPromptState((prev) => ({ ...prev, value: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") respondPrompt(promptState.value);
                  if (event.key === "Escape") respondPrompt(null);
                }}
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => respondPrompt(null)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => respondPrompt(promptState.value)}>
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
