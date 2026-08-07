import { Eye, EyeOff, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { clearAuthState, getAuthValue, hasPermission, NAV_PERMISSION_MAP, savePermissions, setSessionAuthValue } from "../lib/rbac";
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
    image: `${import.meta.env.BASE_URL}login-sys-1.png`,
    title: "Enterprise POS / Billing",
    text: "Seamless checkout, thermal receipt generation, and intelligent inventory deduction in dark mode."
  },
  {
    image: `${import.meta.env.BASE_URL}login-sys-2.png`,
    title: "Comprehensive Repair Tracking",
    text: "Interactive kanban board to monitor device repairs from diagnostic to delivery in real time."
  },
  {
    image: `${import.meta.env.BASE_URL}login-sys-3.png`,
    title: "Advanced Inventory Control",
    text: "Effortlessly manage low stock alerts, product variants, and barcode scanning at your fingertips."
  },
  {
    image: `${import.meta.env.BASE_URL}login-sys-4.png`,
    title: "Offline-First Reliability",
    text: "Fully functional without internet connection. Your store stays operational under any circumstances."
  },
  {
    image: `${import.meta.env.BASE_URL}login-sys-5.png`,
    title: "Secure Cloud Backups",
    text: "Automated and encrypted metadata backups ensure your disaster recovery strategy is flawless."
  },
  {
    image: `${import.meta.env.BASE_URL}login-sys-6.png`,
    title: "Role-Based Access Control",
    text: "Granular permission handling and audit trails keeping your sensitive store data absolutely secure."
  },
  {
    image: `${import.meta.env.BASE_URL}login-sys-7.png`,
    title: "CRM & Customer Management",
    text: "Build loyalty with rich customer profiles, repair histories, and outstanding balance tracking."
  },
  {
    image: `${import.meta.env.BASE_URL}login-sys-8.png`,
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
  const [activeStaff, setActiveStaff] = useState([]);
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
  const [appVersion, setAppVersion] = useState("v1.1.80");
  const [pinSetupModal, setPinSetupModal] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pendingLoginData, setPendingLoginData] = useState(null);

  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showSetupConfirmPassword, setShowSetupConfirmPassword] = useState(false);

  const pwdChecks = useMemo(() => {
    const pwd = setupForm.password || "";
    return {
      length: pwd.length >= 8,
      uppercase: /[A-Z]/.test(pwd),
      lowercase: /[a-z]/.test(pwd),
      symbol: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
    };
  }, [setupForm.password]);

  const strengthScore = useMemo(() => {
    let score = 0;
    if (pwdChecks.length) score++;
    if (pwdChecks.uppercase) score++;
    if (pwdChecks.lowercase) score++;
    if (pwdChecks.symbol) score++;
    return score;
  }, [pwdChecks]);

  const strengthLabel = useMemo(() => {
    if (strengthScore === 0) return "Very Weak";
    if (strengthScore === 1) return "Weak";
    if (strengthScore === 2) return "Fair";
    if (strengthScore === 3) return "Good";
    return "Strong & Compliant";
  }, [strengthScore]);

  const canSubmit = useMemo(() => Boolean(String(username || "").trim() && password && !submitting), [username, password, submitting]);
  const canPinSubmit = useMemo(() => Boolean(pin.length === 4 && !submitting), [pin, submitting]);
  const canSetupSubmit = useMemo(
    () => Boolean(
      String(setupForm.full_name || "").trim()
      && String(setupForm.username || "").trim()
      && setupForm.password
      && pwdChecks.length
      && pwdChecks.uppercase
      && pwdChecks.lowercase
      && pwdChecks.symbol
      && setupForm.password === setupForm.confirm_password
      && !submitting
    ),
    [setupForm, pwdChecks, submitting],
  );
  const shopName = identity?.shopName || identity?.softwareName || "I Store";
  const statusLabel = serviceStatus === "online" ? "Online" : serviceStatus === "offline" ? "Offline" : "Checking";
  const modeLabel = setupRequired ? "Owner Setup" : loginMode === "pin" ? "Staff PIN" : "Password";

  useEffect(() => {
    if (window.istore?.updater?.getVersion) {
      window.istore.updater.getVersion().then((res) => {
        if (res?.version) setAppVersion(`v${res.version}`);
      }).catch(() => {});
    }
  }, []);

  const checkBootstrapStatus = useCallback(async () => {
    setSetupLoading(true);
    setServiceStatus("checking");
    try {
      const res = await api.get("/auth/bootstrap/status");
      const required = Boolean(res?.data?.setup_required);
      setSetupRequired(required);
      setServiceStatus("online");
      const token = getAuthValue("token");
      if (!required && token) {
        try {
          const staffRes = await api.get("/auth/active-staff");
          if (Array.isArray(staffRes?.data)) {
            setActiveStaff(staffRes.data);
          }
        } catch (staffErr) {
          if (staffErr?.response?.status !== 401) {
            console.error("Failed to load active staff in checkBootstrapStatus:", staffErr);
          }
        }
      }
    } catch (err) {
      setSetupRequired(false);
      setServiceStatus("offline");
      console.error("Failed bootstrap status check:", err);
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
        const required = Boolean(res?.data?.setup_required);
        setSetupRequired(required);
        setServiceStatus("online");
        const token = getAuthValue("token");
        if (!required && token) {
          api.get("/auth/active-staff")
            .then((staffRes) => {
              if (active && Array.isArray(staffRes?.data)) {
                setActiveStaff(staffRes.data);
              }
            })
            .catch((staffErr) => {
              if (staffErr?.response?.status !== 401) {
                console.error("Failed to load active staff on mount:", staffErr);
              }
            });
        }
      })
      .catch((err) => {
        if (!active) return;
        setSetupRequired(false);
        setServiceStatus("offline");
        console.error("Failed bootstrap status check on mount:", err);
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

  const completeLoginNavigation = (meRes, permissionRes, fallbackUsername) => {
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

  const finishLogin = async (tokenRes, fallbackUsername) => {
    const accessToken = tokenRes?.data?.access_token;
    if (!accessToken) throw new Error("Missing access token");

    setSessionAuthValue("token", accessToken);
    if (tokenRes?.data?.session_id) setSessionAuthValue("session_id", tokenRes.data.session_id);

    let meRes, permissionRes;
    try {
      [meRes, permissionRes] = await Promise.all([
        api.get("/auth/me"),
        api.get("/auth/me/permissions").catch(() => ({ data: { permissions: [] } })),
      ]);
    } catch (_meErr) {
      // If /auth/me fails (e.g. connection reset), proceed with minimal data.
      // The token is already saved; the app shell will re-fetch on mount.
      meRes = { data: { username: fallbackUsername, role: "owner", pin_set: true } };
      permissionRes = { data: { permissions: [] } };
    }

    const me = meRes?.data || {};

    // Only show the PIN setup modal if we successfully got user data AND pin is not set.
    // Skip it on first login when /auth/me may have failed — user can set PIN later from Settings.
    if (me.pin_set === false && me.username) {
      setPendingLoginData({ meRes, permissionRes, fallbackUsername });
      setPinSetupModal(true);
      setSubmitting(false);
      return;
    }

    completeLoginNavigation(meRes, permissionRes, fallbackUsername);
  };

  const handleSaveInitialPin = async (e) => {
    e?.preventDefault();
    if (newPin.length !== 4) {
      setError("PIN must be 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs do not match");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await api.post("/auth/set-pin", { pin: newPin });
      setPinSetupModal(false);
      if (pendingLoginData) {
        completeLoginNavigation(
          pendingLoginData.meRes,
          pendingLoginData.permissionRes,
          pendingLoginData.fallbackUsername
        );
      }
    } catch (err) {
      setSubmitting(false);
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Failed to set PIN.");
    }
  };

  const handleSkipPinSetup = () => {
    setPinSetupModal(false);
    if (pendingLoginData) {
      completeLoginNavigation(
        pendingLoginData.meRes,
        pendingLoginData.permissionRes,
        pendingLoginData.fallbackUsername
      );
    }
  };

  const handlePinSubmit = async (staffIdToUse = null, explicitPin = null) => {
    const pinToSubmit = explicitPin || pin;
    if (pinToSubmit.length !== 4 || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const payload = { pin: pinToSubmit };
      if (staffIdToUse) payload.user_id = staffIdToUse;

      const tokenRes = await api.post("/auth/login-pin", payload);
      await finishLogin(tokenRes, "Staff");
    } catch (err) {
      setSubmitting(false);
      clearAuthState();
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 400 && typeof detail === "string" && detail.includes("disabled")) {
        setError("PIN sign-in is currently disabled. Please use password sign-in.");
      } else if (status === 401) {
        setError("Invalid PIN or PIN not set for this account. Switch to password sign-in to set your PIN.");
      } else if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("Invalid PIN. Please try again.");
      }
      setPin("");
      setShakeError(true);
      setTimeout(() => setShakeError(false), 500);
    }
  };

  const handleOwnerSetupSubmit = async (event) => {
    event.preventDefault();
    if (!canSetupSubmit || submitting) return;

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
                <strong>Version</strong>
                {appVersion}
              </span>
            </div>

            {serviceStatus === "offline" ? (
              <div className="exact-login-offline">
                <AlertTriangle size={16} />
                <span>Backend service is offline. Sign-in will resume when the local service is reachable.</span>
                <button type="button" onClick={checkBootstrapStatus}>Retry</button>
              </div>
            ) : null}

            {loginSuccess ? (
              <div className="login-success-view">
                <div className="login-success-badge-wrapper">
                  <CheckCircle2 size={52} className="success-check-svg" />
                </div>
                <div className="login-success-headline">Access Granted!</div>
                <div className="login-success-subtext">Welcome back, {username || "User"}! Launching store workspace...</div>
                <div className="login-success-progress-track">
                  <div className="login-success-progress-bar-inner" />
                </div>
              </div>
            ) : setupLoading ? (
              <div className="exact-login-form animate-slide-up">
                <div className="exact-login-checking"><Loader2 size={16} className="animate-spin" /> Checking system setup status...</div>
              </div>
            ) : !setupRequired && loginMode === "password" ? (
            <form className={`exact-login-form animate-slide-up stagger-1 ${shakeError ? "error-shake" : ""}`} onSubmit={onSubmit}>
              <label className="exact-login-field animate-slide-up stagger-2">
                <span className="sr-only">Username</span>
                <input
                  type="text"
                  placeholder="Username or Staff ID"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={submitting}
                  autoFocus
                />
              </label>

              <label className="exact-login-field animate-slide-up stagger-3">
                <span className="sr-only">Password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={submitting}
                />
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
                <span className="remember-text-with-hint">
                  Remember my login details
                  <span className="remember-hint">
                    {rememberMe ? "keeps you signed in for 30 days" : "keeps you signed in for 30 minutes"}
                  </span>
                </span>
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
                onKeyDown={(e) => {
                  if (e.key >= "0" && e.key <= "9") handlePinClick(e.key);
                  else if (e.key === "Backspace") handlePinDelete();
                  else if (e.key === "Enter" && pin.length === 4) handlePinSubmit();
                }}
              >
                {activeStaff.length > 0 && (
                  <div className="mb-3">
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Select Staff Account</label>
                    <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                      {activeStaff.map((staff) => (
                        <button
                          key={staff.id}
                          type="button"
                          onClick={() => {
                            if (pin.length === 4) handlePinSubmit(staff.id);
                          }}
                          className="flex items-center gap-2 p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-left transition-all group"
                        >
                          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs group-hover:scale-105 transition-transform">
                            {staff.full_name ? staff.full_name[0].toUpperCase() : staff.username[0].toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-200 truncate">{staff.full_name || staff.username}</p>
                            <p className="text-[10px] text-slate-400 capitalize">{roleToLabel(staff.role)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pin-display animate-slide-up stagger-2">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={`pin-dot ${i < pin.length ? "filled" : ""}`} />
                  ))}
                </div>

                {error ? <div className="exact-login-error text-center">{error}</div> : null}

                <div className="pin-pad animate-slide-up stagger-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handlePinClick(String(num))}
                      disabled={submitting}
                    >
                      {num}
                    </button>
                  ))}
                  <button type="button" onClick={handlePinDelete} disabled={submitting || pin.length === 0}>
                    ⌫
                  </button>
                  <button type="button" onClick={() => handlePinClick("0")} disabled={submitting}>
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePinSubmit()}
                    disabled={!canPinSubmit}
                  >
                    ↵
                  </button>
                </div>

                <div className="exact-login-actions animate-slide-up stagger-4">
                  <button type="button" className="exact-login-toggle-mode" onClick={() => { setLoginMode("password"); setError(""); }}>
                    Use Password Sign-in
                  </button>
                </div>
              </div>
            ) : (
              <form className={`exact-login-form animate-slide-up stagger-1 ${shakeError ? "error-shake" : ""}`} onSubmit={handleOwnerSetupSubmit}>
                <label className="exact-login-field animate-slide-up stagger-2">
                  <span className="sr-only">Full Name</span>
                  <input
                    type="text"
                    placeholder="Owner Full Name"
                    value={setupForm.full_name}
                    onChange={(event) => setSetupForm((prev) => ({ ...prev, full_name: event.target.value }))}
                    disabled={submitting}
                    autoFocus
                  />
                </label>

                <label className="exact-login-field animate-slide-up stagger-3">
                  <span className="sr-only">Username</span>
                  <input
                    type="text"
                    placeholder="Owner Username"
                    value={setupForm.username}
                    onChange={(event) => setSetupForm((prev) => ({ ...prev, username: event.target.value }))}
                    disabled={submitting}
                  />
                </label>

                <label className="exact-login-field exact-login-password animate-slide-up stagger-4">
                  <span className="sr-only">Password</span>
                  <input
                    type={showSetupPassword ? "text" : "password"}
                    placeholder="Password (min 8 chars, 1 uppercase, 1 symbol)"
                    value={setupForm.password}
                    onChange={(event) => setSetupForm((prev) => ({ ...prev, password: event.target.value }))}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="exact-login-eye"
                    onClick={() => setShowSetupPassword(!showSetupPassword)}
                    tabIndex="-1"
                    aria-label={showSetupPassword ? "Hide password" : "Show password"}
                  >
                    {showSetupPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </label>

                {setupForm.password ? (
                  <div className="password-strength-box animate-fadeIn">
                    <div className="password-strength-header">
                      <span>Password Strength:</span>
                      <span className={`strength-label strength-${strengthScore}`}>{strengthLabel}</span>
                    </div>
                    <div className="strength-bar-track">
                      <div className={`strength-bar-fill strength-fill-${strengthScore}`} />
                    </div>
                    <div className="password-rules-grid">
                      <div className={`rule-item ${pwdChecks.length ? "met" : "unmet"}`}>
                        {pwdChecks.length ? "✓" : "○"} At least 8 characters
                      </div>
                      <div className={`rule-item ${pwdChecks.uppercase ? "met" : "unmet"}`}>
                        {pwdChecks.uppercase ? "✓" : "○"} 1 Uppercase letter (A-Z)
                      </div>
                      <div className={`rule-item ${pwdChecks.lowercase ? "met" : "unmet"}`}>
                        {pwdChecks.lowercase ? "✓" : "○"} 1 Lowercase letter (a-z)
                      </div>
                      <div className={`rule-item ${pwdChecks.symbol ? "met" : "unmet"}`}>
                        {pwdChecks.symbol ? "✓" : "○"} 1 Special symbol (@!#$%)
                      </div>
                    </div>
                  </div>
                ) : null}

                <label className="exact-login-field exact-login-password animate-slide-up stagger-5">
                  <span className="sr-only">Confirm Password</span>
                  <input
                    type={showSetupConfirmPassword ? "text" : "password"}
                    placeholder="Confirm Password"
                    value={setupForm.confirm_password}
                    onChange={(event) => setSetupForm((prev) => ({ ...prev, confirm_password: event.target.value }))}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="exact-login-eye"
                    onClick={() => setShowSetupConfirmPassword(!showSetupConfirmPassword)}
                    tabIndex="-1"
                    aria-label={showSetupConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showSetupConfirmPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </label>

                {setupForm.confirm_password && setupForm.password !== setupForm.confirm_password ? (
                  <div className="password-mismatch-warning animate-fadeIn">
                    ⚠️ Passwords do not match
                  </div>
                ) : null}

                {error ? <div className="exact-login-error">{error}</div> : null}

                <div className="exact-login-actions animate-slide-up stagger-6">
                  <button type="submit" className="exact-login-submit" disabled={!canSetupSubmit}>
                    {submitting ? "Activating..." : "Create Owner Account"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {pinSetupModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-scale-up">
            <div className="text-center space-y-1">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 mb-2">
                🔒
              </div>
              <h3 className="text-lg font-bold text-slate-100">Set Up Your Quick PIN</h3>
              <p className="text-xs text-slate-400">
                Create a 4-digit PIN for quick sign-in to POS and repair stations without entering your full password each time.
              </p>
            </div>

            <form onSubmit={handleSaveInitialPin} className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  4-Digit PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  pattern="\d{4}"
                  placeholder="e.g. 1234"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-center text-2xl tracking-[0.5em] font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Confirm 4-Digit PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  pattern="\d{4}"
                  placeholder="e.g. 1234"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-center text-2xl tracking-[0.5em] font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {error ? <div className="text-rose-400 text-sm text-center">{error}</div> : null}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSkipPinSetup}
                  disabled={submitting}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors text-sm font-medium"
                >
                  Skip for Now
                </button>
                <button
                  type="submit"
                  disabled={submitting || newPin.length !== 4 || newPin !== confirmPin}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : "Save PIN & Continue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
