'use strict';

// Runs inside the existing sender; outbound HTTPS only. No OTPs or tokens logged.
function startPortalBridge({ connected, send, env = process.env, fetchImpl = fetch, log = console, schedule = setTimeout, cancel = clearTimeout, now = Date.now, onStatus = () => {} }) {
    if (!env.PORTAL_BRIDGE_URL || !env.PORTAL_BRIDGE_TOKEN) { onStatus({ state: 'disabled' }); return () => {}; }
    const base = new URL(env.PORTAL_BRIDGE_URL);
    if (base.protocol !== 'https:' || env.PORTAL_BRIDGE_TOKEN.length < 32) throw new Error('Invalid portal bridge configuration');
    let stopped = false;
    let timer;
    let pendingAck = null;
    let failures = 0;
    async function post(path, body) {
        const response = await fetchImpl(new URL(path, base), {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${env.PORTAL_BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error('Bridge request failed');
        return response.json();
    }
    async function tick() {
        let delay = 30000;
        try {
            // Retry acknowledgments, never an ambiguous WhatsApp send.
            if (pendingAck) {
                await post('/internal/delivery/ack', pendingAck);
                pendingAck = null;
            } else {
                const { job } = await post('/internal/delivery/claim', { ready: connected() });
                if (job && !stopped) {
                    let sent = false;
                    const expires = Date.parse(job.expiresAt.replace(' ', 'T').replace(/Z?$/, 'Z'));
                    if (/^\d{6}$/.test(job.code) && /^\+?\d{9,15}$/.test(job.phone) && expires > now() + 10000 && connected()) {
                        try {
                            sent = (await send(job.phone, `Your I-Store verification code is ${job.code}. It expires in 5 minutes. Do not share this code.`, expires))?.success === true;
                        } catch { /* Unknown outcome: do not resend. */ }
                    }
                    pendingAck = { id: job.id, claim: job.claim, sent };
                    await post('/internal/delivery/ack', pendingAck);
                    pendingAck = null;
                    delay = 5000;
                }
            }
            failures = 0;
            onStatus({ state: connected() ? 'online' : 'sender_offline', lastContactAt: new Date(now()).toISOString(), failures: 0 });
        } catch {
            failures += 1;
            delay = Math.min(300000, 30000 * 2 ** Math.min(failures, 4));
            onStatus({ state: 'cloud_unreachable', failures, retryInSeconds: delay / 1000 });
            if (failures === 1) log.warn('[Portal bridge] Connection unavailable; retrying with backoff.');
        }
        finally { if (!stopped) { timer = schedule(tick, delay); timer.unref?.(); } }
    }
    void tick();
    return () => { stopped = true; cancel(timer); };
}
module.exports = { startPortalBridge };
