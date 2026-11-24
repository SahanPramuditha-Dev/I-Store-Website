import React, { useState, useEffect, useCallback, useRef } from 'react';
import { KeyRound, WifiOff, CheckCircle2, RefreshCw, Laptop, X, ShieldCheck, LockKeyhole, Copy, Check, ArrowRight } from 'lucide-react';
import api from '../lib/api';
import './LicenseLockModal.css';

const normalizeKey = (value) => {
  const compact = value.toUpperCase().replace(/\s/g, '');
  if (/^ESTORE-?[A-Z0-9-]*$/.test(compact)) {
    const suffix = compact.replace(/^ESTORE-?/, '').replace(/-/g, '');
    return 'ESTORE-' + (suffix.match(/.{1,4}/g) || []).join('-');
  }
  return compact;
};
const hasKeyFormat = (value) => /^(?:ESTORE|ISTORE(?:-[A-Z0-9]+)?)(?:-[A-Z0-9]{4}){3}$/.test(value);
const activationError = (detail) => {
  const message = typeof detail === 'string' ? detail : 'Activation failed. Please try again.';
  if (/machine limit|machine is not authorized|different device/i.test(message)) return `${message} Open Control Center → Licenses → Reset Machine, then try again.`;
  if (/expired/i.test(message)) return 'This license has expired. Renew it in your E Store Control Center.';
  if (/not found|invalid.*key/i.test(message)) return 'License key not found. Check the key and try again.';
  if (/network|reach|connect|timeout/i.test(message)) return 'Unable to connect to the license server. Check your internet connection and try again.';
  return message;
};

const OFFLINE_BANNER_DISMISSED_KEY = 'istore_offline_license_banner_dismissed';

function wasOfflineBannerDismissed() {
  try {
    return window.sessionStorage.getItem(OFFLINE_BANNER_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function LicenseLockModal() {
  const [licenseState, setLicenseState] = useState({
    status: 'CHECKING',
    message: '',
    hardware_uuid: 'WEB-POS-TERMINAL-' + (typeof window !== 'undefined' ? (window.navigator?.hardwareConcurrency || 4) : 4) + 'CPU',
    is_offline_fallback: false,
    offline_grace_remaining_hours: null,
  });
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [activationResult, setActivationResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const submittingRef = useRef(false);
  const activationRef = useRef(false);
  const validFormat = hasKeyFormat(licenseKeyInput);
  const keyCharacters = validFormat
    ? licenseKeyInput.split('-').slice(-3).join('')
    : licenseKeyInput.replace(/^(?:ESTORE|ISTORE)-?/, '').replace(/-/g, '').slice(0, 12);
  const [feedback, setFeedback] = useState(null);
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(wasOfflineBannerDismissed);

  const dismissOfflineBanner = () => {
    setOfflineBannerDismissed(true);
    try {
      window.sessionStorage.setItem(OFFLINE_BANNER_DISMISSED_KEY, 'true');
    } catch {
      // The in-memory dismissal still works when session storage is unavailable.
    }
  };

  const checkLicense = useCallback(async () => {
    if (submittingRef.current || activationRef.current) return;
    // 1. Electron Desktop IPC check
    if (window.istore?.license?.getStatus) {
      try {
        const res = await window.istore.license.getStatus();
        if (res && res.status) {
          if (res.payload) {
            localStorage.setItem('istore_license_token', JSON.stringify({ payload: res.payload }));
            window.dispatchEvent(new CustomEvent('istore_license_updated', { detail: res.payload }));
          }
          setLicenseState(res);
          return;
        }
      } catch (err) {
        console.error('Electron license check error:', err);
      }
    }

    // 2. Query Local ERP Backend License Status API
    try {
      const res = await api.get('/saas/license/status');
      const data = res.data;
      if (data && data.active === true) {
        setLicenseState({
          status: 'ACTIVATED',
          is_offline_fallback: Boolean(data.in_grace_period),
          offline_grace_remaining_hours: data.grace_remaining_hours || null,
          message: data.message || 'License active and verified',
          hardware_uuid: data.payload?.machine_fingerprint || 'WEB-POS-TERMINAL',
          payload: data.payload
        });
        if (data.payload) {
          localStorage.setItem('istore_license_token', JSON.stringify({ payload: data.payload }));
          window.dispatchEvent(new CustomEvent('istore_license_updated', { detail: data.payload }));
        }
        return;
      } else if (data && data.active === false) {
        setLicenseState({
          status: 'UNLICENSED',
          message: data.message || 'POS terminal requires activation with an E Store license key.',
          hardware_uuid: 'WEB-POS-TERMINAL-' + (window.navigator?.hardwareConcurrency || 4) + 'CPU'
        });
        return;
      }
    } catch (apiErr) {
      // If 402 payment required or network error
      if (apiErr.response?.status === 402) {
        setLicenseState({
          status: 'UNLICENSED',
          message: apiErr.response?.data?.message || 'POS terminal requires activation with an E Store license key.',
          hardware_uuid: 'WEB-POS-TERMINAL-' + (window.navigator?.hardwareConcurrency || 4) + 'CPU'
        });
        return;
      }
    }

    // 3. Browser fallback: Check local storage for active signed token
    try {
      const storedToken = localStorage.getItem('istore_license_token');
      if (storedToken) {
        const parsed = JSON.parse(storedToken);
        setLicenseState({
          status: 'ACTIVATED',
          is_offline_fallback: false,
          message: 'Active Browser Terminal License',
          hardware_uuid: parsed.payload?.machine_fingerprint || 'WEB-POS-TERMINAL'
        });
      } else {
        setLicenseState({
          status: 'UNLICENSED',
          message: 'POS terminal requires activation with an E Store license key.',
          hardware_uuid: 'WEB-POS-TERMINAL-' + (window.navigator?.hardwareConcurrency || 4) + 'CPU'
        });
      }
    } catch (_e) {
      setLicenseState({ status: 'UNLICENSED', message: 'License key required.' });
    }
  }, []);

  useEffect(() => {
    checkLicense();
    const interval = setInterval(checkLicense, 60000);

    const handleLockEvent = (e) => {
      activationRef.current = false;
      setActivationResult(null);
      setIsRestarting(false);
      setLicenseState({
        status: 'UNLICENSED',
        message: e.detail?.message || 'POS terminal requires activation with an E Store license key.',
        hardware_uuid: 'WEB-POS-TERMINAL-' + (window.navigator?.hardwareConcurrency || 4) + 'CPU'
      });
    };
    window.addEventListener('istore_license_locked', handleLockEvent);

    return () => {
      clearInterval(interval);
      window.removeEventListener('istore_license_locked', handleLockEvent);
    };
  }, [checkLicense]);

  const handleActivate = async (e) => {
    e.preventDefault();
    const key = normalizeKey(licenseKeyInput);
    if (submittingRef.current || activationRef.current) return;
    if (!hasKeyFormat(key)) {
      setFeedback({ type: 'error', message: 'Enter the complete license key provided by your store administrator.' });
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      // 1. Electron Desktop Activation
      if (window.istore?.license?.activate) {
        const res = await window.istore.license.activate(key);
        if (res.success) {
          activationRef.current = true;
          setActivationResult(res.device || {});
          setIsRestarting(Boolean(res.restarting));
          return;
        } else {
          setFeedback({ type: 'error', message: activationError(res.error) });
          return;
        }
      }

      // 2. Local Backend Activation Endpoint
      const res = await api.post('/saas/license/activate-key', {
        license_key: key,
        machine_fingerprint: licenseState.hardware_uuid || 'WEB-POS-TERMINAL'
      });

      const data = res.data;
      if (data && data.success) {
        if (data.token) {
          localStorage.setItem('istore_license_token', JSON.stringify(data.token));
        }
        localStorage.setItem('istore_active_tenant', data.tenant_name || data.tenant_code || '');
        localStorage.setItem('istore_active_branch', data.shop_name || data.shop_code || '');
        localStorage.setItem('istore_active_industry', data.industry_code || 'MOBILE_RETAIL');
        localStorage.setItem('istore_active_package', data.package_code || 'ENTERPRISE');

        window.dispatchEvent(new CustomEvent('istore_license_updated', { detail: data }));

        activationRef.current = true;
        setActivationResult(data);
      } else {
        setFeedback({ type: 'error', message: activationError(data.detail || data.message) });
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.userMessage || err.message || 'Error communicating with license activation server';
      setFeedback({ type: 'error', message: activationError(errMsg) });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // If activated without warning, don't show overlay
  if (!activationResult && licenseState.status === 'ACTIVATED' && !licenseState.is_offline_fallback) {
    return null;
  }

  // License verification is asynchronous on desktop startup. Never present the
  // activation form until the installed cache and backend have both had a chance
  // to report a definitive state.
  if (licenseState.status === 'CHECKING') {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950"
        role="status"
        aria-live="polite"
        aria-label="Verifying terminal licence"
      >
        <div className="flex flex-col items-center gap-3 text-center text-slate-300">
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-indigo-400/25 bg-indigo-500/10">
            <RefreshCw className="h-5 w-5 animate-spin motion-reduce:animate-none text-indigo-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">Starting E Store</p>
            <p className="mt-1 text-xs text-slate-500">Verifying this terminal licence…</p>
          </div>
        </div>
      </div>
    );
  }

  // Warning Banner for Offline Grace Period
  if (licenseState.status === 'ACTIVATED' && licenseState.is_offline_fallback) {
    if (offlineBannerDismissed) return null;
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-slate-950 px-4 py-2 text-xs font-semibold flex items-center gap-3 shadow-lg" role="status">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <WifiOff className="w-4 h-4" />
          <span className="truncate">Offline License Mode: {licenseState.offline_grace_remaining_hours}h remaining before online check required.</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={checkLicense} className="underline hover:text-white flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Retry Connection
          </button>
          <button
            type="button"
            onClick={dismissOfflineBanner}
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-950/20 bg-slate-950/5 transition hover:bg-slate-950/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-950"
            aria-label="Dismiss offline license notification"
            title="Dismiss"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const copyMachineId = async () => {
    try {
      await navigator.clipboard.writeText(licenseState.hardware_uuid);
      setCopied(true);
    } catch {
      setFeedback({ type: 'error', message: 'Copy unavailable. Select the Machine ID below and copy it manually.' });
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="activation-title" className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 text-white text-center">
        <div className={`activation-emblem w-16 h-16 rounded-full border flex items-center justify-center mx-auto mb-5 ${activationResult ? 'activation-success bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-blue-500/10 border-blue-500/25 text-blue-400'}`}>
          {activationResult ? <ShieldCheck className="w-8 h-8" /> : <LockKeyhole className="w-8 h-8" />}
        </div>
        <h2 id="activation-title" className="text-2xl font-bold text-slate-100">
          {activationResult ? 'Terminal activated' : 'Activate your terminal'}
        </h2>
        <p className="text-sm text-slate-400 mt-2 mb-6" role="status" aria-live="polite">
          {activationResult ? 'Your license is verified. Welcome to E Store.' : licenseState.status === 'UNLICENSED' ? 'Enter your E Store license key to get started.' : licenseState.message || 'Enter your license key to unlock this terminal.'}
        </p>
        <form onSubmit={handleActivate} className="space-y-4">
          <div className="text-left">
            <label htmlFor="terminal-license-key" className="block text-xs font-medium text-slate-400 mb-2">License key</label>
            <div className="relative">
              <input id="terminal-license-key" type="text" placeholder="ESTORE-XXXX-XXXX-XXXX" value={licenseKeyInput}
                onChange={(e) => { setLicenseKeyInput(normalizeKey(e.target.value)); setFeedback(null); }}
                disabled={isSubmitting || Boolean(activationResult)} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                aria-describedby="license-format" aria-invalid={feedback?.type === 'error' || undefined}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 pl-10 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-70" required />
              <KeyRound aria-hidden="true" className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
            </div>
            <div className="activation-squares mt-3" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => <span key={index} style={{ '--accept-delay': `${index * 60}ms` }} className={`activation-square ${activationResult ? 'accepted' : ''} ${keyCharacters[index] ? 'filled' : ''}`}>
                {keyCharacters[index] || '·'}
              </span>)}
            </div>
            <p id="license-format" className="mt-2 text-xs text-slate-400">
              {activationResult ? 'All key characters accepted.' : isSubmitting ? 'Verifying your license with the server…' : validFormat ? 'Key format looks correct. Activate to verify your license.' : 'Paste your key; spacing and letter case are handled automatically.'}
            </p>
          </div>
          {feedback && <p role="alert" className="p-3 rounded-lg text-sm text-left bg-rose-500/10 text-rose-300 border border-rose-500/20">{feedback.message}</p>}
          {activationResult ? <div className="activation-confirmation">
            {(activationResult.tenant_name || activationResult.organization_name) && <p className="text-sm text-slate-200 mb-2">{activationResult.tenant_name || activationResult.organization_name}</p>}
            {activationResult.package_code && <p className="text-xs text-slate-400 mb-4">Plan: {activationResult.package_code}</p>}
            {isRestarting ? <p role="status" className="flex items-center justify-center gap-2 text-sm text-emerald-300"><RefreshCw className="w-4 h-4 animate-spin motion-reduce:animate-none" />Setting up your terminal. E Store will restart automatically…</p> :
              <button type="button" onClick={() => window.location.reload()} className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 font-medium flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400">Open POS <ArrowRight className="w-4 h-4" /></button>}
          </div> : <button type="submit" disabled={isSubmitting || !validFormat} className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium py-3 rounded-xl transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
            {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="w-4 h-4" />}
            {isSubmitting ? 'Verifying license…' : 'Activate license'}
          </button>}
        </form>
        {!activationResult && <details className="mt-5 text-left text-xs text-slate-400">
          <summary className="cursor-pointer text-blue-300 py-2">Where do I find my license key?</summary>
          <p className="mt-2 leading-relaxed">Open your E Store Control Center and go to Licenses. Copy the key assigned to this store. If you need help, contact your E Store administrator or the support contact provided with your license.</p>
          <a href="#terminal-details" className="inline-block mt-2 text-blue-300 underline">Terminal details for support</a>
        </details>}
        {licenseState.hardware_uuid && <details id="terminal-details" className="mt-5 pt-4 border-t border-slate-800 text-left text-xs text-slate-400">
          <summary className="cursor-pointer py-1">Terminal details</summary>
          <div className="mt-3 flex items-start gap-2"><Laptop className="w-4 h-4 shrink-0" /><div className="min-w-0 flex-1"><p className="mb-1">Machine ID</p><code className="break-all select-all">{licenseState.hardware_uuid}</code></div>
            <button type="button" onClick={copyMachineId} aria-label="Copy Machine ID" className="p-2 rounded-lg hover:bg-slate-800 focus-visible:outline focus-visible:outline-blue-400">{copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}</button>
          </div><span role="status" className="block mt-2">{copied ? 'Machine ID copied.' : ''}</span>
        </details>}
      </section>
    </div>
  );
}
