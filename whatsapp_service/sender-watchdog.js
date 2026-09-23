'use strict';
// Local-only recovery. Never destroys a paired session to force a new QR.
function startSenderWatchdog({ state, restart, log = console, now = Date.now, schedule = setInterval, cancel = clearInterval }) {
    let previous = state(), changedAt = now(), lastAttempt = 0, attempts = 0, busy = false, stopped = false;
    const timer = schedule(() => {
        const current = state();
        if (current !== previous) { previous = current; changedAt = now(); }
        if (current === 'CONNECTED') { attempts = 0; return; }
        if (current === 'UNPAIRED' || current === 'AUTH_FAILURE') return;
        if (stopped || busy || attempts >= 3 || now() - changedAt < 240000 || now() - lastAttempt < 300000) return;
        lastAttempt = now(); attempts++; busy = true;
        log.warn('[Sender watchdog] Reconnecting after a stalled/disconnected session.');
        Promise.resolve().then(restart).catch(() => log.warn('[Sender watchdog] Reconnect failed; check the POS diagnostics screen.')).finally(() => {
            busy = false;
            if (attempts >= 3 && state() !== 'CONNECTED') log.warn('[Sender watchdog] Automatic retries exhausted; manual reconnect or QR scan required.');
        });
    },30000);
    timer.unref?.();
    return () => { stopped = true; cancel(timer); };
}
module.exports = { startSenderWatchdog };
