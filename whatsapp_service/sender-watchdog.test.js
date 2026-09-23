const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startSenderWatchdog } = require('./sender-watchdog');
const flush=()=>new Promise(r=>setImmediate(r));
test('reconnects stalled sessions with bounded retries, never disturbs QR pairing',async()=>{
    let time=0,status='INITIALIZING',tick,restarts=0;
    const stop=startSenderWatchdog({state:()=>status,now:()=>time,restart:async()=>{restarts++;},schedule:fn=>{tick=fn;return 1;},cancel:()=>{},log:{warn(){}}});
    time=300000;tick();await flush();assert.equal(restarts,1);
    time=310000;tick();await flush();assert.equal(restarts,1);
    time=600000;tick();await flush();time=900000;tick();await flush();time=1200000;tick();await flush();assert.equal(restarts,3);
    status='CONNECTED';tick();status='UNPAIRED';time=2000000;tick();time=2400000;tick();await flush();assert.equal(restarts,3);
    stop();status='DISCONNECTED';time=3000000;tick();await flush();assert.equal(restarts,3);
});
