// NovaByte Suggest Relay
// Open source — audit it, self-host it, or use the official instance.
// https://github.com/NovaByteTeam/suggest-relay
//
// What this does: forwards search suggestion requests to upstream engines.
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

// ── Supported engines ─────────────────────────────────────────────────────
const ENGINES = {
    google:     q => `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
    duckduckgo: q => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
    bing:       q => `https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(q)}`,
    brave:      q => `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}`,
    ecosia:     q => `https://ac.ecosia.org/autocomplete?q=${encodeURIComponent(q)}&type=list`,
    yahoo:      q => `https://search.yahoo.com/sugg/gossip/gossip-us-ura/?appid=vs&output=json&command=${encodeURIComponent(q)}`,
};

// ── Per-IP debounce abuse protection ─────────────────────────────────────
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

// ── Suggest endpoint ──────────────────────────────────────────────────────
app.get('/suggest', async (req, res) => {
    const ip     = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const q      = (req.query.q      || '').trim();
    const engine = (req.query.engine || 'google').toLowerCase();

    if (debounced(ip))          return res.status(429).json({ suggestions: [] });
    if (!q)                     return res.status(400).json({ suggestions: [] });
    if (q.length > 200)         return res.status(400).json({ suggestions: [] });
    if (!ENGINES[engine])       return res.status(400).json({ suggestions: [] });

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 4000);

    try {
        const upstream = await fetch(ENGINES[engine](q), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NovaByte/1.0)',
                'Accept':     'application/json, */*;q=0.8',
            },
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!upstream.ok) return res.status(502).json({ suggestions: [] });

        const json = await upstream.json();
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.json(json); // pass raw response — NBOSP server parses it
    } catch {
        clearTimeout(timer);
        res.status(502).json({ suggestions: [] });
    }
});

// ── Health check ──────────────────────────────────────────────────────────
// Returns status only — no uptime, no version, no info disclosure.
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`Suggest relay running on :${PORT}`));
