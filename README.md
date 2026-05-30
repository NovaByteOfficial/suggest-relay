# NovaByte Suggest Relay

A tiny open source relay that forwards search suggestion requests to upstream engines on behalf of [NBOSP Browser](https://github.com/NovaByteTeam/novabyte-os).

Because NBOSP runs locally, the local suggest proxy in `server.js` shares your home IP. This relay runs on a remote machine — so Google, DuckDuckGo, Bing, and others see the relay's IP, never yours.

---

## How It Works

```
You type → NBOSP local server → this relay (remote VPS) → Google/DDG/Bing
                                        ↑
                               Google sees this IP
                                  not yours
```

NBOSP's local server still handles caching, rate limiting, and input validation. The relay is purely a forwarding layer — it receives a query, forwards it to the upstream engine, and returns the raw response. Nothing else.

---

## Privacy

- **No query logging** — queries are never written to disk or memory beyond the in-flight request
- **No IP logging** — client IPs are used only for per-IP debounce (in-memory, evicted after 10 seconds) and never stored
- **No analytics** — no tracking, no telemetry, no third-party scripts
- **Audit it** — the entire relay is `relay.js`. Read it in five minutes and confirm for yourself

This is the same trust model as Mullvad, ProtonVPN, and similar open source privacy tools — open the code so you don't have to take our word for it.

---

## Official Instance

NBOSP ships pointed at the official NovaByte-hosted instance:

```
https://relay.novabyte.com
```

If you don't trust the official instance, self-host your own (see below) and point NBOSP at it.

---

## Self-Hosting

Anyone can run their own instance. It is a single Node.js file with one dependency.

### Requirements

- Node.js 18+
- Any VPS, cloud instance, or remote machine (the whole point is it needs a different IP from yours)

### Setup

```bash
git clone https://github.com/NovaByteTeam/suggest-relay
cd suggest-relay
npm install
node relay.js
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3010` | Port to listen on |
| `ALLOWED_ORIGIN` | `*` | CORS origin. Set to `http://localhost:3003` to restrict to NBOSP only |

### Point NBOSP at your instance

In NBOSP's `server.js`, set:

```js
const RELAY_URL = 'https://your-domain.com';
```

---

## Supported Engines

| Engine | Upstream |
|---|---|
| Google | `suggestqueries.google.com` |
| DuckDuckGo | `duckduckgo.com/ac` |
| Bing | `api.bing.com/qsonhs.aspx` |
| Brave | `search.brave.com/api/suggest` |
| Ecosia | `ac.ecosia.org/autocomplete` |
| Yahoo | `search.yahoo.com/sugg/gossip` |

---

## Endpoints

### `GET /suggest`

| Parameter | Required | Description |
|---|---|---|
| `q` | Yes | Search query (max 200 chars) |
| `engine` | No | One of the supported engines above. Defaults to `google` |

Returns the raw upstream JSON response. NBOSP's local server handles parsing.

### `GET /health`

Returns `{ "status": "ok" }`. No uptime or version info exposed.

---

## Abuse Protection

The relay has no hard rate limit — a hard limit would break the typing experience, which is exactly the problem NBOSP moved away from Ultraviolet to fix.

Instead it uses per-IP debounce: requests from the same IP within 100ms are dropped. Normal typing speed never triggers this. It only catches hammering.

---

## License

Apache 2.0 — same as NBOSP. Free to use, modify, fork, and self-host.
