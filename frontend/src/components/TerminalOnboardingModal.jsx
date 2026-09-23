import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, CircleAlert, Printer, RefreshCw, ScanBarcode, WalletCards, HardDrive } from "lucide-react";
import api from "../lib/api";
import AppModal from "./layout/AppModal";
import { Button, Input } from "./UI";

const ONBOARDING_KEY = "istore_terminal_onboarding_v1";

function getInitialOpenState() {
  try {
    const state = localStorage.getItem(ONBOARDING_KEY);
    return state !== "complete" && state !== "dismissed";
  } catch (_error) {
    return true;
  }
}

function persistOnboardingState(state) {
  try {
    localStorage.setItem(ONBOARDING_KEY, state);
  } catch (_error) {
    // The modal still closes for this session when storage is unavailable.
  }
}

function Step({ icon: Icon, title, description, ready, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start gap-3">
        {ready ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" size={19} /> : <Circle className="mt-0.5 shrink-0 text-slate-400" size={19} />}
        <Icon className="mt-0.5 shrink-0 text-indigo-500" size={18} />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-800 dark:text-white">{title}</div>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{description}</p>
          {children ? <div className="mt-2">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function TerminalOnboardingModal() {
  const [open, setOpen] = useState(getInitialOpenState);
  const [loading, setLoading] = useState(true);
  const [storeReady, setStoreReady] = useState(false);
  const [backupReady, setBackupReady] = useState(false);
  const [backupPath, setBackupPath] = useState("");
  const [printerReady, setPrinterReady] = useState(false);
  const [printerDetail, setPrinterDetail] = useState("Checking installed printers…");
  const [scannerTest, setScannerTest] = useState("");
  const [scannerReady, setScannerReady] = useState(false);
  const [drawerReady, setDrawerReady] = useState(false);

  const refreshChecks = async () => {
    setLoading(true);
    const [profile, backup, printers] = await Promise.all([
      api.get("/settings/section/store_profile").catch(() => ({ data: {} })),
      api.get("/settings/section/backup_data").catch(() => ({ data: {} })),
      window.istore?.terminal?.getHardwareStatus
        ? window.istore.terminal.getHardwareStatus().catch(() => null)
        : Promise.resolve(null),
    ]);
    const identity = profile.data?.business_identity || {};
    const contact = profile.data?.contact_information || {};
    const autoBackup = backup.data?.auto_backup || {};
    setStoreReady(Boolean(identity.shop_name && (contact.primary_phone || contact.email_address || identity.business_type)));
    setBackupPath(autoBackup.local_backup_path || "");
    setBackupReady(Boolean(autoBackup.enable_automatic_backup && autoBackup.local_backup_path));
    const names = printers?.printers || [];
    setPrinterReady(names.length > 0);
    setPrinterDetail(names.length ? `${names.length} installed printer${names.length === 1 ? "" : "s"} found` : "No printer detected — connect one, then refresh.");
    setLoading(false);
  };

  useEffect(() => { refreshChecks(); }, []);

  const allReady = useMemo(() => storeReady && backupReady && printerReady && scannerReady && drawerReady, [storeReady, backupReady, printerReady, scannerReady, drawerReady]);
  const finish = () => {
    persistOnboardingState("complete");
    setOpen(false);
  };
  const finishLater = () => {
    persistOnboardingState("dismissed");
    setOpen(false);
  };

  return (
    <AppModal
      open={open}
      onClose={finishLater}
      title="Set up this POS workstation"
      panelClassName="max-w-xl"
      footer={<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">{allReady ? "All checks completed." : "You can finish the remaining checks later from Settings."}</span><div className="flex gap-2"><Button variant="secondary" onClick={finishLater}>Finish later</Button><Button onClick={finish} disabled={!allReady}>Complete setup</Button></div></div>}
    >
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"><CircleAlert size={17} className="shrink-0" />This quick checklist is stored only on this workstation. It does not claim that generic USB scanners or cash drawers can be detected automatically.</div>
        <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={refreshChecks} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh checks</Button></div>
        <Step icon={Printer} title="Receipt printer" description={printerDetail} ready={printerReady} />
        <Step icon={ScanBarcode} title="Barcode scanner" description="Run a real scan into this field, then press Enter." ready={scannerReady}>
          <Input value={scannerTest} onChange={(event) => setScannerTest(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && scannerTest.trim()) setScannerReady(true); }} placeholder="Scan a barcode here" />
        </Step>
        <Step icon={WalletCards} title="Cash drawer" description="Confirm the drawer opens through the receipt printer and closes securely." ready={drawerReady}>
          <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={drawerReady} onChange={(event) => setDrawerReady(event.target.checked)} />I tested the drawer manually</label>
        </Step>
        <Step icon={CircleAlert} title="Store profile" description="Business name and basic store identity must be configured in Settings." ready={storeReady} />
        <Step icon={HardDrive} title="Backup location" description={backupPath ? `Automatic local backup: ${backupPath}` : "Set an automatic backup location in Settings → Backup & Data."} ready={backupReady} />
      </div>
    </AppModal>
  );
}
