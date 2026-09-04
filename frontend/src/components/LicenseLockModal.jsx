import React, { useState, useEffect, useCallback } from 'react';
import { KeyRound, ShieldAlert, WifiOff, CheckCircle2, RefreshCw, Laptop } from 'lucide-react';
import api from '../lib/api';

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
  const [feedback, setFeedback] = useState(null);

  const checkLicense = useCallback(async () => {
    // 1. Electron Desktop IPC check
    if (window.istore?.license?.getStatus) {
      try {
        const res = await window.istore.license.getStatus();
        if (res && res.status) {
          if (res.payload) {
            localStorage.setItem('istore_license_token', JSON.stringify({ payload: res.payload }));
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
        }
        return;
      } else if (data && data.active === false) {
        setLicenseState({
          status: 'UNLICENSED',
          message: data.message || 'POS terminal requires activation with an E-Store license key.',
          hardware_uuid: 'WEB-POS-TERMINAL-' + (window.navigator?.hardwareConcurrency || 4) + 'CPU'
        });
        return;
      }
    } catch (apiErr) {
      // If 402 payment required or network error
      if (apiErr.response?.status === 402) {
        setLicenseState({
          status: 'UNLICENSED',
          message: apiErr.response?.data?.message || 'POS terminal requires activation with an E-Store license key.',
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
          message: 'POS terminal requires activation with an E-Store license key.',
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
      setLicenseState({
        status: 'UNLICENSED',
        message: e.detail?.message || 'POS terminal requires activation with an E-Store license key.',
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
    const key = licenseKeyInput.trim().toUpperCase();
    if (!key) return;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      // 1. Electron Desktop Activation
      if (window.istore?.license?.activate) {
        const res = await window.istore.license.activate(key);
        if (res.success) {
          setFeedback({ type: 'success', message: 'Terminal activated successfully with Ed25519 cloud signature!' });
          setTimeout(() => checkLicense(), 800);
          return;
        } else {
          setFeedback({ type: 'error', message: res.error || 'Activation failed' });
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

        setFeedback({ type: 'success', message: data.message || 'Terminal activated successfully!' });
        setTimeout(() => {
          checkLicense();
          window.location.reload();
        }, 600);
      } else {
        setFeedback({ type: 'error', message: data.detail || data.message || 'Activation failed' });
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.userMessage || err.message || 'Error communicating with license activation server';
      setFeedback({ type: 'error', message: errMsg });
    } finally {
      setIsSubmitting(false);
    }
  };

  // If activated without warning, don't show overlay
  if (licenseState.status === 'ACTIVATED' && !licenseState.is_offline_fallback) {
    return null;
  }

  // Warning Banner for Offline Grace Period
  if (licenseState.status === 'ACTIVATED' && licenseState.is_offline_fallback) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-slate-950 px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2">
          <WifiOff className="w-4 h-4" />
          <span>Offline License Mode: {licenseState.offline_grace_remaining_hours}h remaining before online check required.</span>
        </div>
        <button onClick={checkLicense} className="underline hover:text-white flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Retry Connection
        </button>
      </div>
    );
  }

  // Full Screen Lock Overlay if UNLICENSED, SUSPENDED, REVOKED, or EXPIRED
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-white text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <h2 className="text-xl font-bold text-slate-100 mb-1">
          {licenseState.status === 'UNLICENSED' ? 'Terminal Activation Required' : 'POS Terminal Locked'}
        </h2>

        <p className="text-sm text-slate-400 mb-6">
          {licenseState.message || 'Please enter your E-Store license activation key to use this POS terminal.'}
        </p>

        {feedback && (
          <div className={`p-3 rounded-lg text-xs mb-4 text-left ${feedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
            {feedback.message}
          </div>
        )}

        <form onSubmit={handleActivate} className="space-y-4">
          <div className="text-left">
            <label className="block text-xs font-medium text-slate-400 mb-1">License Key</label>
            <div className="relative">
              <input
                type="text"
                placeholder="ESTORE-XXXX-XXXX-XXXX"
                value={licenseKeyInput}
                onChange={(e) => setLicenseKeyInput(e.target.value.toUpperCase())}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-2.5 pl-10 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition duration-150 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {isSubmitting ? 'Activating Terminal...' : 'Activate License'}
          </button>
        </form>

        {licenseState.hardware_uuid && (
          <div className="mt-6 pt-4 border-t border-slate-800/60 text-[11px] text-slate-500 flex items-center justify-center gap-1.5 font-mono">
            <Laptop className="w-3.5 h-3.5" />
            <span>Machine ID: {licenseState.hardware_uuid.substring(0, 16)}...</span>
          </div>
        )}
      </div>
    </div>
  );
}
