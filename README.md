# NovaByte Relay

A tiny open source relay that forwards requests to upstream services on behalf of [NBOSP Browser](https://github.com/NovaByteOfficial/novabyte-os).

Because NBOSP runs locally, all outbound requests share your home IP. This relay runs on a remote machine — so Google, email senders, and other upstream services see the relay's IP, never yours.

---

## What It Covers

| Feature | Without relay | With relay |
|---|---|---|
| Search suggestions | Your IP → Google/Bing/DDG | Relay IP → Google/Bing/DDG |
| Site favicons | Your IP → Google Favicons | Relay IP → Google Favicons |
| Email images | Your IP → sender's tracking server | Relay IP → sender's tracking server |

---

## How It Works

```
You type / open email → NBOSP local server → this relay (remote VPS) → upstream service
                                                      ↑
                                          Upstream sees this IP
                                               not yours
```

NBOSP's local server still handles all security: SSRF validation, tracker blocking, redirect following, caching, rate limiting, and input validation. The relay is purely a forwarding layer — it receives a pre-validated request, fetches from upstream, and returns the response. Nothing else.

---

## Privacy

- **No query logging** — queries, URLs, and domains are never written to disk or memory beyond the in-flight request
- **No IP logging** — client IPs are used only for per-IP debounce (in-memory, evicted after 10 seconds) and never stored
- **No analytics** — no tracking, no telemetry, no third-party scripts
- **Audit it** — the entire relay is `relay.js`. Read it in five minutes and confirm for yourself

This is the same trust model as Mullvad, ProtonVPN, and similar open source privacy tools — open the code so you don't have to take our word for it.

---

## Official Instance

NBOSP ships pointed at the official NovaByte-hosted instance:

```
https://suggest-relay.onrender.com
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
git clone https://github.com/NovaByteOfficial/suggest-relay
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

## Endpoints

### `GET /suggest`

Forwards search engine autocomplete requests. NBOSP's local server handles response parsing.

| Parameter | Required | Description |
|---|---|---|
| `q` | Yes | Search query (max 200 chars) |
| `engine` | No | One of the supported engines below. Defaults to `google` |

**Supported engines:** `google`, `duckduckgo`, `bing`, `brave`, `ecosia`, `yahoo`

---

### `GET /favicon`

Fetches site favicons via Google's favicon service. Google sees the relay's IP, not the user's.

| Parameter | Required | Description |
|---|---|---|
| `domain` | Yes | Hostname to fetch favicon for (e.g. `github.com`) |
| `size` | No | Icon size in pixels. Defaults to `32`, clamped to 16–128 |

Returns the favicon image directly. NBOSP's server handles SSRF validation before calling here.

---

### `GET /email-image`

Fetches images from email bodies. Sender's tracking server sees the relay's IP, not the user's.

| Parameter | Required | Description |
|---|---|---|
| `url` | Yes | Pre-validated, tracking-param-stripped image URL |

Returns the image directly. All security checks (SSRF, tracker blocking, redirect validation, size capping) happen in NBOSP's local server before this endpoint is called. The relay just makes the final outbound fetch.

---

### `GET /health`

Returns `{ "status": "ok" }`. No uptime or version info exposed.

---

## Abuse Protection

The relay has no hard rate limit — a hard limit would break the typing experience, which is exactly the problem NBOSP moved away from Ultraviolet to fix.

Instead it uses per-IP debounce: requests from the same IP within 100ms are dropped. Normal typing speed never triggers this. It only catches hammering.

---

## A Note on Privacy

The relay masks your IP from upstream services. It does not make you anonymous. When you actually navigate to a search engine and hit Enter, that request goes directly from your browser to the engine as normal — that's just how browsing works. For full IP privacy, use a VPN. Like Brave without a VPN, the relay covers the background/automatic requests that happen without your explicit action.

---

## License

Apache 2.0 — same as NBOSP. Free to use, modify, fork, and self-host.
