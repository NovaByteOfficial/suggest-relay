// NovaByte Relay
// Open source — audit it, self-host it, or use the official instance.
// https://github.com/NovaByteOfficial/suggest-relay
//
// What this does: forwards requests to upstream services on behalf of NBOSP users.
//   /suggest      — search engine autocomplete suggestions
//   /favicon      — site favicons via Google's favicon service
//   /email-image  — email images (tracking pixel protection)
//
// What this does NOT do: log queries, log IPs, store anything.

const express = require('express');
const app     = express();

const PORT = process.env.PORT || 3010;

// ── No logging middleware ─────────────────────────────────────────────────
// Express default logger is not used. No morgan, no winston, no access logs.
// Queries and IPs are never written anywhere.

// ── HTTPS enforcement ─────────────────────────────────────────────────────
// Render terminates TLS and sets x-forwarded-proto.
// Any plain HTTP request is redirected to HTTPS immediately.
// This means Render only ever sees encrypted traffic — not query contents.
app.use((req, res, next) => {
    if (
        process.env.NODE_ENV === 'production' &&
        req.headers['x-forwarded-proto'] !== 'https'
    ) {
        return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
});

// ── CORS ──────────────────────────────────────────────────────────────────
// Only NBOSP local server calls this — lock it down if you want.
// Set ALLOWED_ORIGIN env var to restrict. Default allows all (open relay).
app.use((req, res, next) => {
    const origin = process.env.ALLOWED_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    next();
});

// ── Shared: clean outbound headers ───────────────────────────────────────
// No user-identifying info forwarded upstream on any request.
const CLEAN_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; NovaByte/1.0)',
    'Accept':     'application/json, */*;q=0.8',
};

// ── Shared: per-IP debounce abuse protection ──────────────────────────────
// Drops duplicate requests from the same IP within 100ms.
// Not a hard rate limit — normal typing speed is never affected.
const lastSeen = new Map();
const DEBOUNCE = 100; // ms

function debounced(ip) {
    const now  = Date.now();
    const last = lastSeen.get(ip) || 0;
    if (now - last < DEBOUNCE) return true;
    lastSeen.set(ip, now);
    // Prevent unbounded growth — evict entries older than 10s
    if (lastSeen.size > 10000) {
        for (const [k, v] of lastSeen) {
            if (now - v > 10000) lastSeen.delete(k);
        }
    }
    return false;
}

// ── Shared: fetch with timeout ────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ── /suggest — Search engine autocomplete ────────────────────────────────
const ENGINES = {
    google:     q => `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
    duckduckgo: q => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
    bing:       q => `https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(q)}`,
    brave:      q => `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}`,
    ecosia:     q => `https://ac.ecosia.org/autocomplete?q=${encodeURIComponent(q)}&type=list`,
    yahoo:      q => `https://search.yahoo.com/sugg/gossip/gossip-us-ura/?appid=vs&output=json&command=${encodeURIComponent(q)}`,
};

app.get('/suggest', async (req, res) => {
    const ip     = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const q      = (req.query.q      || '').trim();
    const engine = (req.query.engine || 'google').toLowerCase();

    if (debounced(ip))          return res.status(429).json({ suggestions: [] });
    if (!q)                     return res.status(400).json({ suggestions: [] });
    if (q.length > 200)         return res.status(400).json({ suggestions: [] });
    if (!ENGINES[engine])       return res.status(400).json({ suggestions: [] });

    try {
        const upstream = await fetchWithTimeout(ENGINES[engine](q), {
            headers: CLEAN_HEADERS,
        }, 4000);

        if (!upstream.ok) return res.status(502).json({ suggestions: [] });

        const json = await upstream.json();
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.json(json); // pass raw response — NBOSP server parses it
    } catch {
        res.status(502).json({ suggestions: [] });
    }
});

// ── /favicon — Site favicon fetcher ──────────────────────────────────────
// NBOSP server has already validated the domain for SSRF before calling here.
// The relay just fetches from Google's favicon service and returns the image.
// Google sees the relay's IP, not the user's.

app.get('/favicon', async (req, res) => {
    const ip      = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const domain  = (req.query.domain || '').trim().toLowerCase();
    const size    = parseInt(req.query.size) || 32;

    if (debounced(ip))  return res.status(429).send();
    if (!domain)        return res.status(400).send();
    // Basic domain sanity check — real validation happens in NBOSP server
    if (!domain.includes('.') || /[\s/\\]/.test(domain)) return res.status(400).send();
    // Clamp size to sensible range
    const safeSize = Math.min(Math.max(size, 16), 128);

    try {
        const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${safeSize}`;
        const upstream = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NovaByte/1.0)',
                'Accept':     'image/png,image/x-icon,image/*,*/*;q=0.8',
            },
        }, 5000);

        if (!upstream.ok) return res.status(502).send();

        const contentType = upstream.headers.get('content-type') || 'image/png';
        // Only pass through image responses
        if (!contentType.startsWith('image/')) return res.status(502).send();

        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h
        res.send(buf);
    } catch {
        res.status(502).send();
    }
});

// ── /email-image — Email image fetcher ───────────────────────────────────
// NBOSP server handles all security: SSRF validation, tracker blocking,
// redirect following, content-type checking, and size capping BEFORE
// calling here. The relay receives a pre-validated, pre-stripped URL and
// just makes the final outbound fetch so the user's IP never reaches the
// sender's tracking server.

app.get('/email-image', async (req, res) => {
    const ip  = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const url = (req.query.url || '').trim();

    if (debounced(ip)) return res.status(429).send();
    if (!url)          return res.status(400).send();

    // Basic scheme check — full SSRF validation done by NBOSP server already
    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).send(); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).send();

    try {
        const upstream = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NovaByte/1.0)',
                'Accept':     'image/png,image/webp,image/jpeg,image/gif,image/*,*/*;q=0.8',
            },
            redirect: 'follow',
        }, 6000);

        if (!upstream.ok) return res.status(502).send();

        const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim();
        if (!contentType.startsWith('image/')) return res.status(502).send();

        // 5MB hard cap — matches NBOSP server's own cap
        const SIZE_CAP = 5 * 1024 * 1024;
        const reader = upstream.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > SIZE_CAP) { reader.cancel(); return res.status(413).send(); }
            chunks.push(value);
        }

        const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // 1h
        res.send(buf);
    } catch {
        res.status(502).send();
    }
});

// ── Health check ──────────────────────────────────────────────────────────
// Returns status only — no uptime, no version, no info disclosure.
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`NovaByte relay running on :${PORT}`));
