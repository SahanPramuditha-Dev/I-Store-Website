/**
 * I Store — WhatsApp Microservice
 * ================================
 * Node.js + Express + whatsapp-web.js
 *
 * CRITICAL FIX (v2): getNumberId() in whatsapp-web.js 1.34+ returns @lid IDs
 * (Linked Identity Device), NOT @c.us IDs. Using @lid as a sendMessage() target
 * causes silent delivery failure. The fix is to always send to cleanPhone@c.us
 * and use getNumberId() ONLY to validate that the number exists on WhatsApp.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { Client, LocalAuth, MessageMedia, MessageAck } = require('whatsapp-web.js');
const qrcode  = require('qrcode-terminal');
const QRCodeImage = require('qrcode');

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = process.env.WHATSAPP_SERVICE_PORT || 3001;
const INTERNAL_SECRET = process.env.WHATSAPP_SERVICE_SECRET;

if (!INTERNAL_SECRET) {
    console.warn('[WhatsApp][WARN] WHATSAPP_SERVICE_SECRET is not set in environment. Endpoint authentication is disabled.');
}

// ─── Process Error Handling (prevents crash on Windows EBUSY file locks) ─────
process.on('uncaughtException', (err) => {
    if (err && err.code === 'EBUSY') {
        console.warn('[WhatsApp][WARN] Handled Windows EBUSY file lock during session cleanup (harmless):', err.message);
        return;
    }
    console.error('[WhatsApp][FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    if (reason && (reason.code === 'EBUSY' || (reason.message && reason.message.includes('EBUSY')))) {
        console.warn('[WhatsApp][WARN] Handled Windows EBUSY lock in promise rejection:', reason.message || reason);
        return;
    }
    console.error('[WhatsApp][WARN] Unhandled Rejection:', reason);
});

// ─── Structured Logger ──────────────────────────────────────────────────────

const log = {
    info:  (...args) => console.log (`[WhatsApp]`, ...args),
    warn:  (...args) => console.warn(`[WhatsApp][WARN]`, ...args),
    error: (...args) => console.error(`[WhatsApp][ERROR]`, ...args),
    debug: (...args) => { if (process.env.WHATSAPP_DEBUG === '1') console.log(`[WhatsApp][DEBUG]`, ...args); }
};

// ─── Phone Normalization ─────────────────────────────────────────────────────

/**
 * Normalize a Sri Lankan phone number to E.164 without '+'.
 * Handles:
 *   0764158980   → 94764158980
 *   94764158980  → 94764158980
 *  +94764158980  → 94764158980
 *   764158980    → 94764158980
 *   076-415-8980 → 94764158980
 *   94 76 415 8980 → 94764158980
 * Returns null if the number is invalid.
 */
function normalizeSriLankanPhone(rawPhone) {
    if (!rawPhone) return null;

    // Strip everything except digits
    let digits = String(rawPhone).replace(/[^\d]/g, '');
    if (!digits) return null;

    // 0XXXXXXXXX (10 digits starting with 0) → 94XXXXXXXXX
    if (digits.startsWith('0') && digits.length === 10) {
        return '94' + digits.slice(1);
    }

    // 7XXXXXXXX (9 digits starting with 7) → 94XXXXXXXXX
    if (digits.startsWith('7') && digits.length === 9) {
        return '94' + digits;
    }

    // E.164 phone numbers (7 to 18 digits) including Sri Lanka (94XXXXXXXXX) and all international numbers
    if (digits.length >= 7 && digits.length <= 18) {
        return digits;
    }

    log.warn(`Cannot normalize phone number: "${rawPhone}" (cleaned: "${digits}")`);
    return null;
}

// ─── Browser Discovery ───────────────────────────────────────────────────────

function findBrowserPath() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            log.info(`Using browser: ${p}`);
            return p;
        }
    }
    log.warn('No Chrome/Edge found. Puppeteer will attempt its bundled browser.');
    return undefined;
}

// ─── State ───────────────────────────────────────────────────────────────────

let clientStatus   = 'INITIALIZING'; // INITIALIZING | UNPAIRED | CONNECTED | DISCONNECTED
let qrCodeText     = null;
let qrCodeDataUrl  = null;
let connectedUser  = null;
let isAuthenticated = false;

// Map<messageId, { phone, status, ack, error, timestamp, resolve? }>
const messageTracker = new Map();

// Map<cleanPhone, lastSendTimestamp> — per-number rate limiting
const lastSentAt = new Map();
const MIN_SEND_INTERVAL_MS = 3000; // minimum 3s between sends to the same number

// Map<phone | rawDigits, rawChatId> to ensure replies to @lid conversations reach the user
const phoneToTargetMap = new Map();

// Automatic memory maintenance: prune stale tracker entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
    for (const [id, item] of messageTracker.entries()) {
        const itemTime = item.timestamp ? new Date(item.timestamp).getTime() : 0;
        if (now - itemTime > MAX_AGE_MS && !item._resolve) {
            messageTracker.delete(id);
        }
    }
    if (messageTracker.size > 500) {
        const keys = Array.from(messageTracker.keys()).slice(0, messageTracker.size - 250);
        for (const k of keys) messageTracker.delete(k);
    }
    if (lastSentAt.size > 500) {
        lastSentAt.clear();
    }
    if (global.gc) {
        try { global.gc(); } catch (_) {}
    }
}, 10 * 60 * 1000);

// Simple async message queue (concurrency = 1 to prevent WhatsApp rate-limiting)
const messageQueue = [];
let queueProcessing = false;

// ─── WhatsApp Client ─────────────────────────────────────────────────────────

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || findBrowserPath();

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'istore-whatsapp-session',
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        executablePath,
        bypassCSP: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-default-apps',
            '--mute-audio',
            '--no-default-browser-check',
            '--disable-web-security',
        ]
    }
});

client.on('loading_screen', (percent, message) => {
    log.info(`WhatsApp Web Loading: ${percent}% - ${message}`);
});

// ─── Client Events ───────────────────────────────────────────────────────────

client.on('qr', async (qr) => {
    clientStatus = 'UNPAIRED';
    isAuthenticated = false;
    qrCodeText = qr;
    try {
        qrCodeDataUrl = await QRCodeImage.toDataURL(qr);
    } catch (err) {
        log.error('QR conversion failed:', err.message);
    }
    log.info('QR code generated — waiting for phone scan...');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    isAuthenticated = true;
    log.info('Session authenticated successfully.');
});

client.on('auth_failure', (msg) => {
    clientStatus = 'UNPAIRED';
    isAuthenticated = false;
    log.error('Authentication failed:', msg);
});

client.on('ready', () => {
    clientStatus = 'CONNECTED';
    qrCodeText = null;
    qrCodeDataUrl = null;
    if (client.info) {
        connectedUser = {
            pushname: client.info.pushname,
            wid:      client.info.wid.user,
            platform: client.info.platform
        };
    }
    log.info('Client CONNECTED and ready.');
    log.info('Connected account:', connectedUser?.pushname, `(${connectedUser?.wid})`);
    log.info('Platform:', connectedUser?.platform);
});

let isReinitializing = false;

async function restartWhatsAppClient() {
    if (isReinitializing) return;
    isReinitializing = true;
    log.info('Gracefully closing previous browser instance before starting new session...');
    
    try {
        await client.destroy();
    } catch (destroyErr) {
        log.warn('Client destroy notice (safe):', destroyErr.message);
    }

    // Allow Windows OS 2 seconds to release all locked file handles
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        log.info('Starting fresh WhatsApp Web client session...');
        await client.initialize();
    } catch (initErr) {
        log.warn('WhatsApp Web Client initialize notice:', initErr.message);
        clientStatus = 'DISCONNECTED';
    } finally {
        isReinitializing = false;
    }
}

client.on('disconnected', (reason) => {
    clientStatus   = 'UNPAIRED';
    isAuthenticated = false;
    qrCodeText     = null;
    qrCodeDataUrl  = null;
    connectedUser  = null;
    log.warn('Client disconnected. Reason:', reason);

    // Auto-recover and generate fresh QR code for next pairing
    if (reason === 'LOGOUT' || reason === 'NAVIGATION') {
        log.info('Device unlinked/logged out. Re-launching browser for new QR pairing session...');
        restartWhatsAppClient();
    }
});

client.on('change_state', (state) => {
    log.info('Client state changed:', state);
});

/**
 * message_create fires for ALL messages sent from this session,
 * including ones we send programmatically.
 */
client.on('message_create', (msg) => {
    if (msg.fromMe) {
        const tracker = messageTracker.get(msg.id.id);
        if (tracker) {
            tracker.status    = 'SENT';
            tracker.messageId = msg.id.id;
            tracker.ack       = MessageAck.ACK_SERVER >= 1 ? 'SERVER' : 'PENDING';
            log.debug(`message_create: id=${msg.id.id} to=${msg.to}`);
        }
    }
});

/**
 * message_ack tracks delivery state for sent messages.
 * ACK values: -1=ERROR, 0=PENDING, 1=SERVER, 2=DEVICE, 3=READ, 4=PLAYED
 */
client.on('message_ack', (msg, ack) => {
    const ackNames = {
        [-1]: 'ERROR',
        0:    'PENDING',
        1:    'SERVER',
        2:    'DEVICE',
        3:    'READ',
        4:    'PLAYED'
    };
    const ackLabel = ackNames[ack] || String(ack);
    log.info(`ACK update → id=${msg.id.id} ack=${ackLabel}(${ack})`);

    const tracker = messageTracker.get(msg.id.id);
    if (tracker) {
        tracker.ack = ackLabel;
        if (ack === -1) {
            tracker.status = 'FAILED';
            tracker.error  = 'WhatsApp server rejected this message (ACK_ERROR). ' +
                             'Possible causes: account rate-limited, recipient has privacy ' +
                             'restrictions on unknown senders, or account-level business messaging limit.';
            log.error(`Message ${msg.id.id} FAILED (ACK_ERROR) to=${msg.to}`);
        } else if (ack >= 2) {
            tracker.status = 'DELIVERED';
            log.info(`Message ${msg.id.id} DELIVERED (ack=${ackLabel}).`);
        } else if (ack === 1) {
            tracker.status = 'SENT';
        }
        // Resolve the waiting promise if the send function is blocked on ACK
        if (tracker._resolve) {
            tracker._resolve(tracker);
            tracker._resolve = null;
        }
    }

    // Dispatch webhook to Python backend to update database audit log & pipeline trace
    try {
        const webhookUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
        fetch(`${webhookUrl}/api/whatsapp/internal-webhook/ack`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(INTERNAL_SECRET ? { 'X-Internal-Secret': INTERNAL_SECRET } : {})
            },
            body: JSON.stringify({
                messageId: msg.id.id,
                ack: ackLabel,
                ackCode: ack,
                to: msg.to,
                timestamp: new Date().toISOString()
            })
        }).catch(err => log.debug(`Webhook sync skipped: ${err.message}`));
    } catch (e) {
        // non-blocking
    }
});

client.on('message', async (msg) => {
    // Ignore group chats or broadcast status
    if (msg.from.includes('@g.us') || msg.from.includes('status@broadcast') || msg.fromMe) return;

    log.info(`Incoming message from: ${msg.from} — forwarding to Bot Engine`);

    try {
        let senderPhone = null;
        let senderName = null;
        try {
            const contact = await msg.getContact();
            if (contact) {
                senderName = contact.name || contact.pushname;
                if (contact.number && !String(contact.number).startsWith('1933') && String(contact.number).length < 15) {
                    senderPhone = contact.number;
                }
                if (!senderPhone && typeof contact.getFormattedNumber === 'function') {
                    const formatted = await contact.getFormattedNumber().catch(() => null);
                    if (formatted) {
                        const fDigits = String(formatted).replace(/[^\d]/g, '');
                        if (fDigits.length >= 9) {
                            senderPhone = fDigits;
                        }
                    }
                }
            }
        } catch (e) {
            log.warn('Could not resolve contact info:', e.message);
        }

        // Check msg.author / msg._data.author / msg._data.sender
        if (!senderPhone && msg.author && msg.author.includes('@c.us')) {
            senderPhone = msg.author.replace('@c.us', '');
        }
        if (!senderPhone && msg._data?.author && String(msg._data.author).includes('@c.us')) {
            senderPhone = String(msg._data.author).replace('@c.us', '');
        }
        if (!senderPhone && msg._data?.sender && String(msg._data.sender).includes('@c.us')) {
            senderPhone = String(msg._data.sender).replace('@c.us', '');
        }

        // Try getting chat directly
        if (!senderPhone) {
            try {
                const chat = await msg.getChat();
                if (chat && chat.id && chat.id.server === 'c.us') {
                    senderPhone = chat.id.user;
                }
            } catch (_) {}
        }

        const rawFrom = msg.from; // e.g. "193398820618326@lid" or "94785571342@c.us"
        const rawDigits = rawFrom.replace(/[^\d]/g, '');
        const normalizedPhone = normalizeSriLankanPhone(senderPhone) || senderPhone || normalizeSriLankanPhone(rawDigits) || rawDigits;

        // Register bidirectional routing mappings
        if (normalizedPhone) {
            phoneToTargetMap.set(normalizedPhone, rawFrom);
            phoneToTargetMap.set(rawDigits, rawFrom);
            if (senderPhone) phoneToTargetMap.set(senderPhone, rawFrom);
        }

        const finalPhone = normalizedPhone || senderPhone || rawDigits;

        log.info(`Resolved incoming message: phone=${finalPhone} (chatId=${rawFrom}, name=${senderName})`);

        let mediaBase64 = null;
        let mediaMimeType = null;
        if (msg.hasMedia) {
            try {
                const downloadedMedia = await msg.downloadMedia();
                if (downloadedMedia && downloadedMedia.data) {
                    mediaBase64 = downloadedMedia.data;
                    mediaMimeType = downloadedMedia.mimetype;
                    log.info(`Downloaded media attachment (${mediaMimeType}) for message ${msg.id.id}`);
                }
            } catch (mediaErr) {
                log.warn(`Could not download message media: ${mediaErr.message}`);
            }
        }

        const webhookUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
        
        await fetch(`${webhookUrl}/api/whatsapp/incoming-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(INTERNAL_SECRET ? { 'X-Internal-Secret': INTERNAL_SECRET } : {})
            },
            body: JSON.stringify({
                phone: finalPhone,
                rawChatId: rawFrom,
                message: msg.body || '',
                fromMe: msg.fromMe,
                messageId: msg.id.id,
                media_base64: mediaBase64,
                media_mime_type: mediaMimeType
            })
        });
    } catch (err) {
        log.error(`Bot webhook forward skipped/error: ${err.message}`);
    }
});

// ─── Message Queue ───────────────────────────────────────────────────────────

async function processQueue() {
    if (queueProcessing || messageQueue.length === 0) return;
    queueProcessing = true;

    while (messageQueue.length > 0) {
        const job = messageQueue.shift();
        try {
            await job();
        } catch (err) {
            log.error('Queue job error:', err.message);
        }
        // Mandatory delay between queue jobs to avoid WhatsApp rate-limiting.
        // 3 seconds is the minimum safe interval for Business linked-device accounts.
        await new Promise(r => setTimeout(r, 3000));
    }

    queueProcessing = false;
}

function enqueueMessage(job) {
    return new Promise((resolve, reject) => {
        messageQueue.push(async () => {
            try { resolve(await job()); }
            catch (err) { reject(err); }
        });
        processQueue();
    });
}

// ─── Core Send Logic ─────────────────────────────────────────────────────────

/**
 * waitForAck
 * Waits up to `timeoutMs` for the message_ack event to update the tracker.
 * Returns the tracker entry when ACK arrives, or the current state on timeout.
 * This ensures the API response reflects REAL delivery state, not just
 * "sendMessage() didn't throw".
 */
function waitForAck(msgId, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const tracker = messageTracker.get(msgId);
        if (!tracker) { resolve(null); return; }

        // If ACK already resolved (very fast networks), return immediately
        if (tracker.ack !== 'PENDING') { resolve(tracker); return; }

        // Attach resolver to tracker so message_ack handler fires it
        tracker._resolve = resolve;

        // Timeout fallback — ACK can legitimately take time on slow connections
        setTimeout(() => {
            if (tracker._resolve) {
                tracker._resolve = null;
                log.warn(`ACK timeout for msgId=${msgId} — returning current state (ack=${tracker.ack})`);
                resolve(tracker);
            }
        }, timeoutMs);
    });
}

/**
 * sendWhatsAppMessage
 */
async function sendWhatsAppMessage(rawPhone, message) {
    const cleanPhone = normalizeSriLankanPhone(rawPhone) || String(rawPhone).replace(/[^\d]/g, '');
    if (!cleanPhone) {
        return { success: false, error: `Invalid phone number format: "${rawPhone}"` };
    }

    // Determine target chatId:
    // 1. If we have a mapped chat target from an incoming message (including @lid), use it
    // 2. Otherwise try getNumberId()
    // 3. Fallback to cleanPhone@c.us
    let chatId = phoneToTargetMap.get(cleanPhone) || phoneToTargetMap.get(String(rawPhone).replace(/[^\d]/g, '')) || null;

    if (!chatId) {
        try {
            const numberInfo = await client.getNumberId(cleanPhone);
            if (numberInfo && numberInfo._serialized) {
                chatId = numberInfo._serialized;
                log.info(`Resolved getNumberId for ${cleanPhone} → ${chatId}`);
            }
        } catch (err) {
            log.warn(`getNumberId check error: ${err.message}`);
        }
    }

    if (!chatId) {
        chatId = `${cleanPhone}@c.us`;
    }

    log.info(`Send requested → phone=${cleanPhone}, targetChatId=${chatId}`);

    // Per-number rate limiting: enforce minimum interval between sends
    const lastSent = lastSentAt.get(cleanPhone);
    if (lastSent) {
        const elapsed = Date.now() - lastSent;
        if (elapsed < MIN_SEND_INTERVAL_MS) {
            const wait = MIN_SEND_INTERVAL_MS - elapsed;
            log.info(`Rate limit: waiting ${wait}ms before send to ${cleanPhone}`);
            await new Promise(r => setTimeout(r, wait));
        }
    }

    lastSentAt.set(cleanPhone, Date.now());

    try {
        const sentMsg = await client.sendMessage(chatId, message);
        const msgId = sentMsg?.id?.id || `sent-${Date.now()}`;

        // Register in tracker for ACK updates
        messageTracker.set(msgId, {
            phone:     cleanPhone,
            chatId,
            status:    'SENT',
            ack:       'PENDING',
            error:     null,
            timestamp: new Date().toISOString()
        });

        // Clean up old tracker entries (keep last 500)
        if (messageTracker.size > 500) {
            const oldest = [...messageTracker.keys()].slice(0, messageTracker.size - 500);
            oldest.forEach(k => messageTracker.delete(k));
        }

        log.info(`Message sent → id=${msgId} chatId=${chatId} — waiting for ACK...`);

        // Wait for real ACK from WhatsApp server (up to 6 seconds)
        const ackResult = await waitForAck(msgId, 6000);

        if (ackResult && ackResult.status === 'FAILED') {
            log.error(`Send FAILED (ACK_ERROR) → phone=${cleanPhone} msgId=${msgId}`);
            log.error(`Error detail: ${ackResult.error}`);
            return {
                success:   false,
                messageId: msgId,
                phone:     cleanPhone,
                status:    'FAILED',
                ack:       'ERROR',
                error:     ackResult.error
            };
        }

        const finalAck = ackResult?.ack || 'PENDING';
        const finalStatus = ackResult?.status || 'SENT';
        log.info(`Send result → phone=${cleanPhone} msgId=${msgId} ack=${finalAck} status=${finalStatus}`);

        return {
            success:     true,
            messageId:   msgId,
            phone:       cleanPhone,
            recipientId: chatId,
            status:      finalStatus,
            ack:         finalAck
        };

    } catch (err) {
        log.error(`sendMessage failed → chatId=${chatId} error=${err.message}`);

        // Fallback attempt: try via getChatById then chat.sendMessage()
        log.info(`Attempting fallback: getChatById(${chatId}).sendMessage()`);
        try {
            const chat = await client.getChatById(chatId);
            const sentMsg = await chat.sendMessage(message);
            const msgId = sentMsg?.id?.id || `sent-fallback-${Date.now()}`;

            messageTracker.set(msgId, {
                phone:     cleanPhone,
                chatId,
                status:    'SENT',
                ack:       'PENDING',
                error:     null,
                timestamp: new Date().toISOString(),
                via:       'fallback'
            });

            log.info(`Fallback send succeeded → id=${msgId}`);

            return {
                success:     true,
                messageId:   msgId,
                phone:       cleanPhone,
                recipientId: chatId,
                status:      'SENT',
                via:         'fallback'
            };
        } catch (fallbackErr) {
            log.error(`Fallback also failed → ${fallbackErr.message}`);
            return {
                success: false,
                error:   err.message,
                phone:   cleanPhone,
                status:  'FAILED'
            };
        }
    }
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireSecret(req, res, next) {
    if (!INTERNAL_SECRET) return next(); // secret not configured → open
    const provided = req.headers['x-internal-secret'];
    if (!provided || provided !== INTERNAL_SECRET) {
        return res.status(403).json({ success: false, error: 'Forbidden: Invalid internal API secret.' });
    }
    next();
}

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// CORS: allow localhost origins only
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://localhost:8000', 'http://127.0.0.1:8000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Internal-Secret']
}));
app.use(express.json({ limit: '10mb' }));

// ─── Endpoints ───────────────────────────────────────────────────────────────

/**
 * GET /status
 * Public — returns connection state without secrets.
 */
app.get('/status', (req, res) => {
    res.json({
        success:       true,
        status:        clientStatus,
        ready:         clientStatus === 'CONNECTED',
        authenticated: isAuthenticated,
        qrCodeAvailable: !!qrCodeText,
        qrCodeUrl:     qrCodeDataUrl || null,
        user:          connectedUser,
        queueSize:     messageQueue.length
    });
});

/**
 * GET /api/debug-pic/:phone
 * Debug: inspect contact profile pic availability via Puppeteer session store.
 */
app.get('/api/debug-pic/:phone', async (req, res) => {
    const rawPhone = (req.params.phone || '').replace(/\D/g, '');
    if (clientStatus !== 'CONNECTED') return res.json({ error: 'Not connected' });
    try {
        const result = await client.pupPage.evaluate(async (phone) => {
            try {
                const jid = `${phone}@c.us`;
                // Check contact store
                const Store = window.require('WAWebCollections');
                const contact = Store.Contact.get(jid);
                const chat = Store.Chat.get(jid);
                return {
                    jid,
                    contactFound: !!contact,
                    chatFound: !!chat,
                    contactName: contact ? (contact.pushname || contact.name || contact.formattedName) : null,
                    contactPicThumb: contact && contact.profilePicThumbObj ? contact.profilePicThumbObj.eurl : null,
                    chatPicFull: chat && chat.contact && chat.contact.profilePicThumbObj ? chat.contact.profilePicThumbObj.eurl : null,
                };
            } catch (e) {
                return { error: e.message };
            }
        }, rawPhone);
        res.json(result);
    } catch (e) {
        res.json({ error: e.message });
    }
});

/**
 * GET /api/qr
 * Returns the current QR code as Base64 for web UI display.
 */
app.get('/api/qr', (req, res) => {
    if (clientStatus === 'CONNECTED') {
        return res.json({ success: true, status: 'CONNECTED', message: 'WhatsApp is already connected.' });
    }
    if (!qrCodeDataUrl) {
        return res.json({ success: false, status: clientStatus, message: 'QR code not yet available. Retry in a few seconds.' });
    }
    res.json({ success: true, status: 'UNPAIRED', qrCodeUrl: qrCodeDataUrl });
});

/**
 * POST /api/reconnect
 * Triggers re-initialization of WhatsApp client to re-establish session or generate new QR.
 */
app.post('/api/reconnect', async (req, res) => {
    log.info('Manual reconnect / re-pair requested via API.');
    try {
        clientStatus = 'INITIALIZING';
        qrCodeText = null;
        qrCodeDataUrl = null;
        connectedUser = null;
        
        restartWhatsAppClient();

        res.json({ success: true, message: 'WhatsApp client is re-initializing. A new QR code will be emitted if unpaired.', status: 'INITIALIZING' });
    } catch (e) {
        log.error(`Reconnect failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/logout
 * Logs out of active session, clears credentials, and emits fresh QR code.
 */
app.post('/api/logout', async (req, res) => {
    log.info('Unlink / Logout requested via API.');
    try {
        if (clientStatus === 'CONNECTED') {
            try {
                await client.logout();
            } catch (logoutErr) {
                log.warn(`Client logout notice: ${logoutErr.message}`);
            }
        }
        
        clientStatus = 'UNPAIRED';
        isAuthenticated = false;
        qrCodeText = null;
        qrCodeDataUrl = null;
        connectedUser = null;

        restartWhatsAppClient();

        res.json({ success: true, message: 'Device unlinked. Session reset, generating new QR code.', status: 'UNPAIRED' });
    } catch (e) {
        log.error(`Logout failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/diagnostics/whatsapp
 * Full system diagnostic without exposing secrets.
 */
app.get('/api/diagnostics/whatsapp', async (req, res) => {
    let wwebVersion = null;
    try {
        wwebVersion = require('./node_modules/whatsapp-web.js/package.json').version;
    } catch (_) {}

    let puppeteerVersion = null;
    try {
        puppeteerVersion = require('./node_modules/puppeteer/package.json').version;
    } catch (_) {}

    const nodeVersion = process.version;

    let clientState = null;
    try {
        clientState = await client.getState();
    } catch (_) {}

    res.json({
        success:          true,
        timestamp:        new Date().toISOString(),
        service: {
            status:         clientStatus,
            ready:          clientStatus === 'CONNECTED',
            authenticated:  isAuthenticated,
            clientState,
            queueSize:      messageQueue.length,
            trackedMessages: messageTracker.size
        },
        account:          connectedUser || null,
        versions: {
            node:         nodeVersion,
            'whatsapp-web.js': wwebVersion,
            puppeteer:    puppeteerVersion
        },
        config: {
            browserPath:  executablePath || 'bundled',
            secretConfigured: !!INTERNAL_SECRET
        }
    });
});

/**
 * GET /api/check-number/:phone
 * Check whether a phone number is registered on WhatsApp.
 */
app.get('/api/check-number/:phone', async (req, res) => {
    if (clientStatus !== 'CONNECTED') {
        return res.status(503).json({ success: false, error: 'WhatsApp client not connected.', status: clientStatus });
    }

    const cleanPhone = normalizeSriLankanPhone(req.params.phone);
    if (!cleanPhone) {
        return res.status(400).json({ success: false, error: `Invalid phone number format: "${req.params.phone}"` });
    }

    try {
        const numberInfo = await client.getNumberId(cleanPhone);
        const isRegistered = numberInfo !== null;
        log.info(`check-number → phone=${cleanPhone} registered=${isRegistered} resolvedType=${numberInfo?.server || 'null'}`);

        res.json({
            success:      true,
            phone:        cleanPhone,
            chatId:       `${cleanPhone}@c.us`,
            isRegistered,
            resolvedType: numberInfo?.server || null
        });
    } catch (err) {
        log.error(`check-number error: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Profile picture in-memory cache (phone -> { url, timestamp })
const profilePicCache = new Map();

/**
 * GET /api/contact-profile/:phone
 * Returns the contact's public WhatsApp profile picture URL.
 */
app.get('/api/contact-profile/:phone', async (req, res) => {
    const rawPhone = (req.params.phone || '').replace(/\D/g, '');
    if (!rawPhone) {
        return res.status(400).json({ success: false, error: 'Phone parameter required' });
    }

    // Serve cached URLs (1hr TTL) — never cache nulls so we always retry
    const cached = profilePicCache.get(rawPhone);
    if (cached && cached.url && (Date.now() - cached.timestamp < 3600000)) {
        return res.json({ success: true, phone: rawPhone, profilePicUrl: cached.url });
    }

    if (clientStatus !== 'CONNECTED') {
        return res.json({ success: false, phone: rawPhone, profilePicUrl: null, status: clientStatus });
    }

    try {
        const jid = `${rawPhone}@c.us`;

        // Strategy 1: direct requestProfilePicFromServer on the Contact store object
        // This bypasses getChat() which may not exist for this contact
        const picUrl = await client.pupPage.evaluate(async (jid) => {
            try {
                const Store = window.require('WAWebCollections');
                const Bridge = window.require('WAWebContactProfilePicThumbBridge');

                // Try contact store first
                let target = Store.Contact.get(jid);
                if (!target) {
                    // Try chat store
                    target = Store.Chat.get(jid);
                }
                if (!target) {
                    // Last resort: getChat which may fetch it
                    target = await window.WWebJS.getChat(jid);
                }
                if (!target) return null;

                const result = await Bridge.requestProfilePicFromServer(target);
                return result ? result.eurl : null;
            } catch (e) {
                // ServerStatusCodeError = privacy restricted; not an error we can solve
                return null;
            }
        }, jid);

        if (picUrl) {
            profilePicCache.set(rawPhone, { url: picUrl, timestamp: Date.now() });
        }

        res.json({ success: true, phone: rawPhone, profilePicUrl: picUrl || null });
    } catch (err) {
        log.debug(`contact-profile error for ${rawPhone}: ${err.message}`);
        res.json({ success: false, phone: rawPhone, profilePicUrl: null, error: err.message });
    }
});

/**
 * POST /api/send-message
 * Body: { phone, message }
 * Header: X-Internal-Secret (optional if not configured)
 *
 * THE FIX IS IN sendWhatsAppMessage() — always sends to @c.us, never @lid.
 */
app.post('/api/send-message', requireSecret, async (req, res) => {
    if (clientStatus !== 'CONNECTED') {
        return res.status(503).json({
            success: false,
            error:   'WhatsApp client is not connected. Please scan the QR code first.',
            status:  clientStatus
        });
    }

    const { phone, message } = req.body;
    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Missing required fields: "phone" and "message".' });
    }

    if (typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Message must be a non-empty string.' });
    }

    try {
        const result = await enqueueMessage(() => sendWhatsAppMessage(phone, message));

        if (result.success) {
            return res.json(result);
        } else {
            const httpStatus = result.status === 'RECIPIENT_NOT_FOUND' ? 422 : 400;
            return res.status(httpStatus).json(result);
        }
    } catch (err) {
        log.error('send-message endpoint error:', err.message);
        return res.status(500).json({ success: false, error: err.message, status: 'FAILED' });
    }
});

/**
 * GET /api/message-status/:id
 * Check delivery/ACK status of a previously sent message.
 */
app.get('/api/message-status/:id', (req, res) => {
    const tracker = messageTracker.get(req.params.id);
    if (!tracker) {
        return res.status(404).json({ success: false, error: 'Message ID not found in tracker.' });
    }
    res.json({ success: true, messageId: req.params.id, ...tracker });
});

/**
 * POST /api/send-media
 * Body: { phone, mediaUrl, caption, filename }
 */
app.post('/api/send-media', requireSecret, async (req, res) => {
    if (clientStatus !== 'CONNECTED') {
        return res.status(503).json({ success: false, error: 'WhatsApp client not connected.', status: clientStatus });
    }

    const { phone, mediaUrl, qrData, mediaBase64, mimetype, caption, filename } = req.body;
    if (!phone || (!mediaUrl && !qrData && !mediaBase64)) {
        return res.status(400).json({ success: false, error: 'Missing required fields: "phone" and "mediaUrl" or "qrData".' });
    }

    const cleanPhone = normalizeSriLankanPhone(phone);
    if (!cleanPhone) {
        return res.status(400).json({ success: false, error: `Invalid phone number: "${phone}"` });
    }

    // Validate recipient first
    try {
        const numberInfo = await client.getNumberId(cleanPhone);
        if (!numberInfo) {
            return res.status(422).json({
                success: false,
                error:   'The phone number is not registered on WhatsApp.',
                phone:   cleanPhone,
                status:  'RECIPIENT_NOT_FOUND'
            });
        }
    } catch (err) {
        log.warn(`Media send: recipient validation failed (continuing): ${err.message}`);
    }

    try {
        const chatId = `${cleanPhone}@c.us`;
        let media = null;

        if (qrData) {
            const qrBuffer = await QRCodeImage.toBuffer(qrData, {
                type: 'png',
                width: 600,
                margin: 2,
                color: { dark: '#090d16', light: '#ffffff' }
            });
            media = new MessageMedia('image/png', qrBuffer.toString('base64'), filename || 'receipt_qr.png');
        } else if (mediaBase64) {
            media = new MessageMedia(mimetype || 'image/png', mediaBase64, filename || 'media.png');
        } else if (mediaUrl) {
            if (mediaUrl.includes('api.qrserver.com') || mediaUrl.includes('create-qr-code')) {
                try {
                    const match = mediaUrl.match(/data=([^&]+)/);
                    const decodedData = match ? decodeURIComponent(match[1]) : mediaUrl;
                    const qrBuffer = await QRCodeImage.toBuffer(decodedData, {
                        type: 'png',
                        width: 600,
                        margin: 2,
                        color: { dark: '#090d16', light: '#ffffff' }
                    });
                    media = new MessageMedia('image/png', qrBuffer.toString('base64'), filename || 'receipt_qr.png');
                } catch (qrErr) {
                    media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true, reqOptions: { rejectUnauthorized: false } });
                }
            } else {
                media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true, reqOptions: { rejectUnauthorized: false } });
            }
        }

        if (!media) {
            throw new Error('Failed to create media payload.');
        }

        if (filename) media.filename = filename;

        const result = await enqueueMessage(async () => {
            const sentMsg = await client.sendMessage(chatId, media, { caption: caption || '' });
            return sentMsg;
        });

        const msgId = result?.id?.id || `media-${Date.now()}`;
        log.info(`Media sent → id=${msgId} chatId=${chatId}`);

        res.json({ success: true, messageId: msgId, phone: cleanPhone, status: 'SENT' });
    } catch (err) {
        log.error('send-media error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Start ───────────────────────────────────────────────────────────────────

log.info('Starting WhatsApp Web Client...');
client.initialize();

app.listen(PORT, '127.0.0.1', () => {
    log.info(`REST API listening on http://127.0.0.1:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function shutdown(signal) {
    log.info(`Received ${signal} — shutting down gracefully...`);
    try { await client.destroy(); } catch (_) {}
    process.exit(0);
}
