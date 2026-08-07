import { useEffect, useState } from "react";
import { RefreshCw, Download, CheckCircle2, ShieldCheck, Cpu, HardDrive, Sparkles, Activity, FileText } from "lucide-react";
import { Button, SectionCard, Badge } from "../UI";

export default function SoftwareUpdatesSettingsPanel({ toast }) {
  const [appVersion, setAppVersion] = useState("v1.1.79");
  const [checking, setChecking] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState("idle"); // 'idle' | 'checking' | 'available' | 'downloading' | 'ready-to-install' | 'up-to-date' | 'error'
  const [progress, setProgress] = useState(0);
  const [releaseNotes, setReleaseNotes] = useState("");
  const [latestVersion, setLatestVersion] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (window.istore?.updater?.getVersion) {
      window.istore.updater.getVersion().then((res) => {
        if (res?.version) setAppVersion(`v${res.version}`);
      }).catch(() => {});
    }

    if (window.istore?.updater?.onStatus) {
      const unsubStatus = window.istore.updater.onStatus((data) => {
        if (data.status === "checking") {
          setUpdaterStatus("checking");
        } else if (data.status === "available") {
          setUpdaterStatus("available");
          if (data.version) setLatestVersion(data.version);
          if (data.releaseNotes) setReleaseNotes(data.releaseNotes);
          toast?.(`New version v${data.version || ''} is available for download!`, "info");
        } else if (data.status === "not-available") {
          setUpdaterStatus("up-to-date");
          toast?.("You are using the latest version of iStore OS!", "success");
        } else if (data.status === "downloaded" || data.status === "ready-to-install") {
          setUpdaterStatus("ready-to-install");
          if (data.version) setLatestVersion(data.version);
          toast?.("Update package ready! Click Restart to apply.", "success");
        } else if (data.status === "error" || data.status === "backup-failed") {
          setUpdaterStatus("error");
          setErrorMessage(data.error || "Update error occurred");
          toast?.(`Update check failed: ${data.error || 'Network error'}`, "error");
        }
      });

      const unsubProgress = window.istore.updater.onProgress((data) => {
        setUpdaterStatus("downloading");
        setProgress(Math.round(data.percent || 0));
      });

      return () => {
        unsubStatus?.();
        unsubProgress?.();
      };
    }
  }, [toast]);

  const handleCheckUpdates = async () => {
    if (!window.istore?.updater) {
      toast?.("Updates can be checked only inside the installed desktop application.", "info");
      return;
    }
    setChecking(true);
    setUpdaterStatus("checking");
    try {
      const result = await window.istore.updater.checkForUpdates();
      if (result?.skipped) {
        toast?.(result.reason || "Update check skipped.", "info");
        setUpdaterStatus("idle");
      } else if (result?.upToDate) {
        setUpdaterStatus("up-to-date");
        toast?.("You are using the latest version of iStore OS!", "success");
      } else if (result?.error) {
        setUpdaterStatus("error");
        setErrorMessage(result.error);
        toast?.(`Update check failed: ${result.error}`, "error");
      }
    } catch (err) {
      setUpdaterStatus("error");
      toast?.("Failed to check for updates", "error");
    } finally {
      setChecking(false);
    }
  };

  const handleDownload = async () => {
    if (!window.istore?.updater) return;
    try {
      setUpdaterStatus("downloading");
      await window.istore.updater.downloadUpdate();
    } catch (err) {
      toast("Download failed", "error");
      setUpdaterStatus("error");
    }
  };

  const handleInstall = async () => {
    if (!window.istore?.updater) return;
    try {
      await window.istore.updater.installUpdate();
    } catch (err) {
      toast("Installation trigger failed", "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Hero */}
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-6 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300">
              <Sparkles size={13} className="text-cyan-400" />
              <span>Official Release Channel</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              iStore OS Software Updates
              <Badge tone="cyan" className="text-xs font-bold">{appVersion}</Badge>
            </h2>
            <p className="text-xs text-slate-400 max-w-xl">
              Automatic update manager for iStore ERP. Checks for verified GitHub Releases, performs automated pre-update SQLite database backups, and applies seamless hot-reboots.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Button
              size="md"
              variant="secondary"
              onClick={handleCheckUpdates}
              disabled={checking || updaterStatus === "downloading"}
              className="font-bold border-indigo-500/40 hover:bg-indigo-500/20 text-indigo-200"
            >
              <RefreshCw size={15} className={checking ? "animate-spin text-cyan-400" : ""} />
              {checking ? "Checking GitHub..." : "Check for Updates"}
            </Button>

            {updaterStatus === "available" && (
              <Button size="md" onClick={handleDownload} className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold">
                <Download size={15} />
                Download v{latestVersion}
              </Button>
            )}

            {updaterStatus === "ready-to-install" && (
              <Button size="md" onClick={handleInstall} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold animate-bounce">
                <ShieldCheck size={15} />
                Restart & Apply Update
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Status Card */}
        <div className="xl:col-span-2 space-y-4">
          <SectionCard title="Update Engine Status" subtitle="Real-time status of your workstation installation and update manager">
            <div className="p-4 rounded-xl border border-white/10 bg-slate-950/60 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Current Installed Build</span>
                <span className="text-sm font-bold text-slate-100">{appVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Update Server URL</span>
                <span className="text-xs font-mono text-cyan-400">github.com/SahanPramuditha-Dev/I-Store-Website</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Automatic Pre-Update DB Backup</span>
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={13} /> Active & Enforced
                </span>
              </div>

              {/* Dynamic Status Display */}
              <div className="pt-3 border-t border-white/10">
                {updaterStatus === "checking" && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">
                    <RefreshCw size={15} className="animate-spin text-cyan-400" />
                    <span>Connecting to release servers and comparing versions...</span>
                  </div>
                )}

                {updaterStatus === "up-to-date" && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    <span>Your workstation is completely up to date with the latest iStore OS release!</span>
                  </div>
                )}

                {updaterStatus === "available" && (
                  <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-cyan-200">New Release Ready: v{latestVersion}</span>
                      <Badge tone="cyan">Available Now</Badge>
                    </div>
                    <p className="text-xs text-slate-300">
                      Click Download below to begin downloading the verified update package. Your application will remain fully usable during download.
                    </p>
                    <Button size="sm" onClick={handleDownload} className="bg-cyan-600 hover:bg-cyan-500 font-bold">
                      <Download size={13} /> Start Download
                    </Button>
                  </div>
                )}

                {updaterStatus === "downloading" && (
                  <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/30 space-y-2">
                    <div className="flex justify-between text-xs font-bold text-slate-200">
                      <span>Downloading Package Package...</span>
                      <span className="text-cyan-400">{progress}%</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                {updaterStatus === "ready-to-install" && (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                      <CheckCircle2 size={18} />
                      <span>Release Downloaded & Verified!</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      A pre-update database backup has been saved to your local storage. Click below to restart iStore OS and finalize the installation.
                    </p>
                    <Button size="sm" onClick={handleInstall} className="bg-emerald-600 hover:bg-emerald-500 font-bold">
                      Restart & Install Now
                    </Button>
                  </div>
                )}

                {updaterStatus === "error" && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                    <p className="font-bold mb-1">Update Failed</p>
                    <p>{errorMessage || "Unable to reach update server or download update package."}</p>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Info & Diagnostics Sidebar */}
        <div className="space-y-4">
          <SectionCard title="System Diagnostics" subtitle="Workstation environment detail">
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <Cpu size={14} className="text-indigo-400" />
                <span className="text-slate-400">Platform:</span>
                <span className="font-semibold text-slate-200">Windows x64 (NSIS Electron)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <HardDrive size={14} className="text-cyan-400" />
                <span className="text-slate-400">Database Engine:</span>
                <span className="font-semibold text-slate-200">SQLite Offline-First DB</span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Activity size={14} className="text-emerald-400" />
                <span className="text-slate-400">Background Services:</span>
                <span className="font-semibold text-emerald-400">FastAPI Server Online</span>
              </div>

              <div className="pt-3 border-t border-white/10">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full text-xs font-semibold justify-center"
                  onClick={() => {
                    window.open("/api/v1/settings/support-bundle", "_blank");
                    toast("Downloading diagnostic support bundle...", "info");
                  }}
                >
                  <FileText size={13} /> Export System Diagnostics Bundle
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
