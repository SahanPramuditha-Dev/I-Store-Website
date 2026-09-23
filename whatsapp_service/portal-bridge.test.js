const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startPortalBridge } = require('./portal-bridge');
const flush = () => new Promise(resolve => setImmediate(resolve));
const sample = { id: 'job', claim: 'claim', phone: '+94700000000', code: '123456', expiresAt: '2099-01-01 00:00:00' };
function harness(respond, ready = true) {
    const requests = [], sent = [], waits = [], callbacks = [];
    const stop = startPortalBridge({
        env: { PORTAL_BRIDGE_URL: 'https://example.test', PORTAL_BRIDGE_TOKEN: 't'.repeat(40) },
        connected: () => ready, send: async (...args) => { sent.push(args); return { success: true }; },
        fetchImpl: async (url, options) => { requests.push({ path: url.pathname, body: JSON.parse(options.body) }); return respond(requests.at(-1), requests.length); },
        schedule: (fn, delay) => { callbacks.push(fn); waits.push(delay); return 1; }, cancel: () => {}, log: { warn() {} },
    });
    return { requests, sent, waits, callbacks, stop };
}
const ok = value => ({ ok: true, json: async () => value });
test('idle polling is 30 seconds and offline PC reports not ready', async () => {
    const h = harness(() => ok({ job: null }), false); await flush();
    assert.equal(h.requests[0].body.ready, false); assert.deepEqual(h.waits, [30000]); assert.equal(h.sent.length, 0); h.stop();
});
test('lost ack is retried without resending the message', async () => {
    const h = harness((req, count) => { if (count === 1) return ok({ job: sample }); if (count === 2) throw new Error('timeout'); return ok({ success: true }); });
    await flush(); assert.equal(h.sent.length, 1); assert.equal(h.waits[0], 60000);
    await h.callbacks.shift()(); assert.equal(h.sent.length, 1);
    assert.deepEqual(h.requests.map(r => r.path), ['/internal/delivery/claim','/internal/delivery/ack','/internal/delivery/ack']); h.stop();
});
test('expired payload is acknowledged failed without a send', async () => {
    const h = harness(req => ok(req.path.endsWith('/claim') ? { job: { ...sample, expiresAt: '2000-01-01 00:00:00' } } : {}));
    await flush(); assert.equal(h.sent.length, 0); assert.equal(h.requests[1].body.sent, false); h.stop();
});
test('network failure backs off up to five minutes', async () => {
    const h = harness(() => { throw new Error('offline'); }); await flush();
    for (let i = 0; i < 5; i++) await h.callbacks.shift()();
    assert.deepEqual(h.waits, [60000,120000,240000,300000,300000,300000]); h.stop();
});
test('stop during an outstanding claim prevents sending', async () => {
    let release;
    const h = harness(() => new Promise(resolve => { release = resolve; }));
    h.stop(); release(ok({ job: sample })); await flush();
    assert.equal(h.sent.length, 0); assert.equal(h.waits.length, 0);
});
test('no credentials means no network activity', () => {
    const stop = startPortalBridge({ env: {}, connected: () => true, send: () => assert.fail(), fetchImpl: () => assert.fail() }); stop();
});
