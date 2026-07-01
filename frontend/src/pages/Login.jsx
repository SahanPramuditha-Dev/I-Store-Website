import { Eye, EyeOff, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { clearAuthState, hasPermission, NAV_PERMISSION_MAP, savePermissions, setSessionAuthValue } from "../lib/rbac";
import { useStoreProfile } from "../hooks/useStoreProfile";
import "./Login.css";

function roleToLabel(role) {
  const raw = String(role || "").trim();
  if (!raw) return "Staff";
  return raw
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function pickLandingPath(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) return "/dashboard";
  const navRows = Object.entries(NAV_PERMISSION_MAP);
  for (const [path, permission] of navRows) {
    if (hasPermission(permission, permissions)) return path;
  }
  return "/access-denied";
}

const slides = [
  {
    image: "/login-sys-1.png",
    title: "Enterprise POS / Billing",
    text: "Seamless checkout, thermal receipt generation, and intelligent inventory deduction in dark mode."
  },
  {
    image: "/login-sys-2.png",
    title: "Comprehensive Repair Tracking",
    text: "Interactive kanban board to monitor device repairs from diagnostic to delivery in real time."
  },
  {
    image: "/login-sys-3.png",
    title: "Advanced Inventory Control",
    text: "Effortlessly manage low stock alerts, product variants, and barcode scanning at your fingertips."
  },
  {
    image: "/login-sys-4.png",
    title: "Offline-First Reliability",
    text: "Fully functional without internet connection. Your store stays operational under any circumstances."
  },
  {
    image: "/login-sys-5.png",
    title: "Secure Cloud Backups",
    text: "Automated and encrypted metadata backups ensure your disaster recovery strategy is flawless."
  },
  {
    image: "/login-sys-6.png",
    title: "Role-Based Access Control",
    text: "Granular permission handling and audit trails keeping your sensitive store data absolutely secure."
  },
  {
    image: "/login-sys-7.png",
    title: "CRM & Customer Management",
    text: "Build loyalty with rich customer profiles, repair histories, and outstanding balance tracking."
  },
  {
    image: "/login-sys-8.png",
    title: "Deep Financial Analytics",
    text: "Generate instant profit/loss statements and performance reports for your entire business."
  }
];

export default function Login() {
  const navigate = useNavigate();
  const { identity } = useStoreProfile();
  const pinPanelRef = useRef(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [shakeError, setShakeError] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loginMode, setLoginMode] = useState("password");
  const [pin, setPin] = useState("");
  const [setupLoading, setSetupLoading] = useState(true);
  const [serviceStatus, setServiceStatus] = useState("checking");
  const [setupForm, setSetupForm] = useState({
    full_name: "",
    username: "",
    password: "",
    confirm_password: "",
    phone_number: "",
    email: "",
  });

  const canSubmit = useMemo(() => Boolean(String(username || "").trim() && password && !submitting), [username, password, submitting]);
  const canPinSubmit = useMemo(() => Boolean(pin.length === 4 && !submitting), [pin, submitting]);
  const canSetupSubmit = useMemo(
    () => Boolean(
      String(setupForm.full_name || "").trim()
      && String(setupForm.username || "").trim()
      && setupForm.password
      && setupForm.password === setupForm.confirm_password
      && !submitting
    ),
    [setupForm, submitting],
  );
  const shopName = identity?.shopName || identity?.softwareName || "I Store";
  const statusLabel = serviceStatus === "online" ? "Online" : serviceStatus === "offline" ? "Offline" : "Checking";
  const modeLabel = setupRequired ? "Owner Setup" : loginMode === "pin" ? "Staff PIN" : "Password";

  const checkBootstrapStatus = useCallback(async () => {
    setSetupLoading(true);
    setServiceStatus("checking");
    try {
      const res = await api.get("/auth/bootstrap/status");
      setSetupRequired(Boolean(res?.data?.setup_required));
      setServiceStatus("online");
    } catch {
      setSetupRequired(false);
      setServiceStatus("offline");
    } finally {
      setSetupLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setSetupLoading(true);
    setServiceStatus("checking");
    api.get("/auth/bootstrap/status")
      .then((res) => {
        if (!active) return;
        setSetupRequired(Boolean(res?.data?.setup_required));
        setServiceStatus("online");
      })
      .catch(() => {
        if (!active) return;
        setSetupRequired(false);
        setServiceStatus("offline");
      })
      .finally(() => {
        if (active) setSetupLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
        setFading(false);
      }, 400);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!setupLoading && !setupRequired && loginMode === "pin") {
      pinPanelRef.current?.focus();
    }
  }, [loginMode, setupLoading, setupRequired]);

  const handleDotClick = (index) => {
    if (index === currentSlideIndex) return;
    setFading(true);
    setTimeout(() => {
      setCurrentSlideIndex(index);
      setFading(false);
    }, 400);
  };

  const handleKeyDown = (e) => {
    if (e.getModifierState && e.getModifierState("CapsLock")) {
      setCapsLockActive(true);
    } else {
      setCapsLockActive(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const handlePinClick = (num) => {
    if (!submitting && pin.length < 4) setPin((prev) => prev + num);
  };

  const handlePinDelete = () => {
    if (!submitting) setPin((prev) => prev.slice(0, -1));
  };

  const finishLogin = async (tokenRes, fallbackUsername) => {
    const accessToken = tokenRes?.data?.access_token;
    if (!accessToken) throw new Error("Missing access token");

    setSessionAuthValue("token", accessToken);
    if (tokenRes?.data?.session_id) setSessionAuthValue("session_id", tokenRes.data.session_id);

    const [meRes, permissionRes] = await Promise.all([
      api.get("/auth/me"),
      api.get("/auth/me/permissions").catch(() => ({ data: { permissions: [] } })),
    ]);

    setLoginSuccess(true);

    setTimeout(() => {
      const me = meRes?.data || {};
      const permissions = savePermissions(permissionRes?.data?.permissions || []);

      localStorage.setItem("username", me?.username || fallbackUsername);
      localStorage.setItem("login_role", me?.role || "staff");
      localStorage.setItem("login_role_label", roleToLabel(me?.role || "staff"));

      navigate(pickLandingPath(permissions), { replace: true });
    }, 1200);
  };

  const handlePinSubmit = async () => {
    if (!canPinSubmit) return;

    setSubmitting(true);
    setError("");
    try {
      const trimmedUsername = String(username || "admin").trim();
      const tokenRes = await api.post("/auth/login-pin", {
        username: trimmedUsername,
        pin,
        remember_me: rememberMe,
      });
      await finishLogin(tokenRes, trimmedUsername);
    } catch (err) {
      setSubmitting(false);
      clearAuthState();
      setShakeError(true);
      setTimeout(() => setShakeError(false), 500);
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 428) setSetupRequired(true);
      setError(typeof detail === "string" ? detail : "PIN sign-in failed. Please verify username and PIN.");
      setPin("");
    }
  };

  const handlePinKeyDown = (event) => {
    if (submitting) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.tagName === "INPUT" && event.key !== "Enter") return;

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      setPin((prev) => (prev.length < 4 ? `${prev}${event.key}` : prev));
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      setPin((prev) => prev.slice(0, -1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      handlePinSubmit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setPin("");
    }
  };

  const submitBootstrap = async (event) => {
    event.preventDefault();
    if (!canSetupSubmit) return;

    setSubmitting(true);
    setError("");
    try {
      await api.post("/auth/bootstrap/owner", {
        username: String(setupForm.username || "").trim(),
        full_name: String(setupForm.full_name || "").trim(),
        password: setupForm.password,
        phone_number: String(setupForm.phone_number || "").trim() || null,
        email: String(setupForm.email || "").trim() || null,
      });
      setSetupRequired(false);
      setUsername(String(setupForm.username || "").trim());
      setPassword("");
      setSetupForm((prev) => ({ ...prev, password: "", confirm_password: "" }));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Owner setup failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError("");

    try {
      const form = new URLSearchParams();
      form.set("username", String(username || "").trim());
      form.set("password", password);
      form.set("grant_type", "password");
      form.set("remember_me", rememberMe ? "true" : "false");

      const tokenRes = await api.post("/auth/login", form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      await finishLogin(tokenRes, String(username || "").trim());

    } catch (err) {
      setSubmitting(false);
      clearAuthState();
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 428) setSetupRequired(true);
      setError(typeof detail === "string" ? detail : "Sign in failed. Please verify username and password.");
      setShakeError(true);
      setTimeout(() => setShakeError(false), 500);
    }
  };

  return (
    <div className="exact-login-shell">
      <div className="login-particles">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="login-particle" style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 5}s`,
            animationDuration: `${15 + Math.random() * 25}s`
          }} />
        ))}
      </div>
      <section className="exact-login-window">
        <div className="exact-login-visual">
          {slides.map((slide, idx) => (
            <div
              key={slide.image}
              className={`exact-login-slide-bg ${idx === currentSlideIndex ? "active" : ""}`}
              style={{ backgroundImage: `url("${slide.image}")` }}
            />
          ))}

          <div className="exact-login-brand brand-float">{shopName}</div>

          <div className={`exact-login-copy ${fading ? "fade-out" : ""}`}>
            <h2>{slides[currentSlideIndex].title}</h2>
            <p>{slides[currentSlideIndex].text}</p>
          </div>

          <div className="exact-login-dots" aria-hidden="true">
            {slides.map((_, idx) => (
              <span
                key={idx}
                className={idx === currentSlideIndex ? "active" : ""}
                onClick={() => handleDotClick(idx)}
              >
                {idx === currentSlideIndex && <span className="dot-progress" />}
              </span>
            ))}
          </div>
        </div>

        <div className="exact-login-auth">
          <div className="exact-login-form-shell">
            <header className="exact-login-head">
              <span className="exact-login-storeline">{shopName}</span>
              <h1>{setupRequired ? "First-Run Setup" : getGreeting()}</h1>
              <p>{setupRequired ? "Create the first Owner account to activate login." : "Sign in to continue store operations."}</p>
            </header>

            <div className="exact-login-system-strip" aria-label="Login system status">
              <span className="exact-login-system-pill">
                <strong>Store</strong>
                {shopName}
              </span>
              <span className={`exact-login-system-pill ${serviceStatus === "offline" ? "is-offline" : serviceStatus === "online" ? "is-online" : ""}`}>
                <strong>Backend</strong>
                {statusLabel}
              </span>
              <span className="exact-login-system-pill">
                <strong>Mode</strong>
                {modeLabel}
              </span>
            </div>

            {serviceStatus === "offline" ? (
              <div className="exact-login-offline">
                <AlertTriangle size={16} />
                <span>Backend service is offline. Sign-in will resume when the local service is reachable.</span>
                <button type="button" onClick={checkBootstrapStatus}>Retry</button>
              </div>
            ) : null}

            {setupLoading ? (
              <div className="exact-login-form animate-slide-up">
                <div className="exact-login-checking"><Loader2 size={16} className="animate-spin" /> Checking system setup status...</div>
              </div>
            ) : !setupRequired && loginMode === "password" ? (
            <form className={`exact-login-form animate-slide-up stagger-1 ${shakeError ? "error-shake" : ""}`} onSubmit={onSubmit}>
              <label className="exact-login-field animate-slide-up stagger-2">
                <span className="sr-only">Username</span>
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  placeholder="Username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={submitting}
                />
              </label>

              <label className="exact-login-field exact-login-password animate-slide-up stagger-3">
                <span className="sr-only">Password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={handleKeyDown}
                  onKeyDown={handleKeyDown}
                  disabled={submitting}
                />
                {capsLockActive && (
                  <div className="caps-warning" title="Caps Lock is ON">
                    <AlertTriangle size={16} />
                  </div>
                )}
                <button
                  type="button"
                  className="exact-login-eye"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex="-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </label>

              <label className="exact-login-remember animate-slide-up stagger-4">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  disabled={submitting}
                />
                <span>Remember my login details</span>
              </label>

              {error ? <div className="exact-login-error">{error}</div> : null}

              <div className="exact-login-actions animate-slide-up stagger-5">
                <button type="submit" className={`exact-login-submit ${loginSuccess ? "success-morph" : ""}`} disabled={!canSubmit || loginSuccess}>
                  {loginSuccess ? (
                    <CheckCircle2 size={24} className="morph-icon" />
                  ) : submitting ? (
                    <span className="exact-login-submit-content">
                      <Loader2 size={20} className="animate-spin" />
                      <span>Processing...</span>
                    </span>
                  ) : (
                    "Sign in to account"
                  )}
                </button>
                <button type="button" className="exact-login-toggle-mode" onClick={() => { setLoginMode("pin"); setError(""); setPin(""); }}>
                  Use Staff PIN
                </button>
              </div>

            </form>
            ) : !setupRequired && loginMode === "pin" ? (
              <div
                ref={pinPanelRef}
                className={`exact-login-form animate-slide-up stagger-1 ${shakeError ? "error-shake" : ""}`}
                tabIndex={-1}
                onKeyDown={handlePinKeyDown}
              >
                <label className="exact-login-field animate-slide-up stagger-2">
                  <span className="sr-only">Username</span>
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    placeholder="Username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={submitting}
                  />
                </label>
                <div className="pin-display animate-slide-up stagger-2">
                  {[0,1,2,3].map(i => (
                    <div key={i} className={`pin-dot ${pin.length > i ? "filled" : ""}`} />
                  ))}
                </div>
                <div className="pin-pad animate-slide-up stagger-3">
                  {[1,2,3,4,5,6,7,8,9].map(num => (
                    <button key={num} type="button" onClick={() => handlePinClick(String(num))} disabled={submitting}>{num}</button>
                  ))}
                  <button type="button" onClick={handlePinDelete} disabled={submitting}>Del</button>
                  <button type="button" onClick={() => handlePinClick("0")} disabled={submitting}>0</button>
                  <button type="button" onClick={handlePinSubmit} disabled={!canPinSubmit}>
                    {submitting ? <Loader2 size={18} className="animate-spin" /> : "Go"}
                  </button>
                </div>
                
                {error ? <div className="exact-login-error text-center">{error}</div> : null}

                <button type="button" className="exact-login-toggle-mode animate-slide-up stagger-4" onClick={() => { setLoginMode("password"); setError(""); setPin(""); }}>
                  Use Password
                </button>
              </div>
            ) : (
            <form className="exact-login-form animate-slide-up stagger-1" onSubmit={submitBootstrap}>
              <label className="exact-login-field animate-slide-up stagger-2">
                <input
                  type="text"
                  placeholder="Owner full name"
                  value={setupForm.full_name}
                  onChange={(event) => setSetupForm((prev) => ({ ...prev, full_name: event.target.value }))}
                  disabled={submitting}
                />
              </label>
              <label className="exact-login-field animate-slide-up stagger-3">
                <input
                  type="text"
                  placeholder="Owner username"
                  value={setupForm.username}
                  onChange={(event) => setSetupForm((prev) => ({ ...prev, username: event.target.value }))}
                  disabled={submitting}
                />
              </label>
              <label className="exact-login-field exact-login-password animate-slide-up stagger-4">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Strong password"
                  value={setupForm.password}
                  onChange={(event) => setSetupForm((prev) => ({ ...prev, password: event.target.value }))}
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="exact-login-eye"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={submitting}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </label>
              <label className="exact-login-field animate-slide-up stagger-5">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirm password"
                  value={setupForm.confirm_password}
                  onChange={(event) => setSetupForm((prev) => ({ ...prev, confirm_password: event.target.value }))}
                  disabled={submitting}
                />
              </label>
              <label className="exact-login-field animate-slide-up stagger-6">
                <input
                  type="text"
                  placeholder="Phone (optional)"
                  value={setupForm.phone_number}
                  onChange={(event) => setSetupForm((prev) => ({ ...prev, phone_number: event.target.value }))}
                  disabled={submitting}
                />
              </label>
              <label className="exact-login-field">
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={setupForm.email}
                  onChange={(event) => setSetupForm((prev) => ({ ...prev, email: event.target.value }))}
                  disabled={submitting}
                />
              </label>
              {setupForm.confirm_password && setupForm.password !== setupForm.confirm_password ? (
                <div className="exact-login-error">Password confirmation does not match.</div>
              ) : null}
              {error ? <div className="exact-login-error">{error}</div> : null}
              <button type="submit" className="exact-login-submit" disabled={!canSetupSubmit}>
                {submitting ? "Creating owner..." : "Create Owner Account"}
              </button>
            </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
