# M5: Public Web App (PWA)

**Depends on**: M2 (Ingestion API — public endpoints must be live)
**Required by**: nothing downstream (end-user deliverable)

---

## What This Milestone Delivers

A Progressive Web App at `panahon.live` that lets citizens view current and recent weather conditions for any deployed node — no login required. Includes a service worker for offline data access.

---

## Requirements

### Pages & Views

#### Home / Node List
- Shows all public-facing nodes (one card per node).
- Each card displays: node label/location, last reading timestamp, current temperature, humidity, rainfall accumulation.
- Data sourced from `GET /api/v1/public/latest/{node_id}` for each listed node.

#### Node Detail
- Full detail for a single node: `/node/{node_id}`
- Shows last 24 hours of readings as a chart (temperature, humidity, rainfall over time).
- Data sourced from `GET /api/v1/public/history/{node_id}`.
- "Last updated: X ago" timestamp shown prominently.
- Offline indicator: if service worker is serving cached data, display a banner: "Showing cached data — last updated [timestamp]."

### PWA Requirements
- `manifest.json` with icon set, theme color, `display: standalone`.
- Service worker registered on first load.
- App shell (HTML/CSS/JS bundle) cached for offline loading.

### Service Worker Caching Strategy

**App shell**: Cache-first. The service worker serves the HTML/CSS/JS bundle from cache; updates in background (stale-while-revalidate).

**Weather data**: Cache the last **24 hours of readings per node**, keyed by `node_id`. Strategy:
1. On each successful API response, write the response to the cache (keyed by URL).
2. On fetch: return the network response if available; fall back to cache if the network fails.
3. Cached entries older than 25 hours are evicted on the next cache write for that node.

**Cache storage limit**: Each node's 24-hour history at Nominal rate (~288 readings) fits well under any browser storage quota.

### Performance & Accessibility
- First Contentful Paint < 2 seconds on a 3G connection when served from CDN.
- Accessible markup: ARIA labels on interactive elements, sufficient color contrast.
- Responsive layout: usable on mobile (primary audience).

### Cloudflare Integration (optional)
- All `Cache-Control` headers on API responses set to `public, max-age=60` for Cloudflare compatibility.
- No application changes are required to enable Cloudflare — it is a deployment-time decision.

---

## Interactions

| Interacts With | Direction | How |
|----------------|-----------|-----|
| M2 Ingestion API (public endpoints) | fetches from → | `GET /api/v1/public/latest/:node_id`, `GET /api/v1/public/history/:node_id` |
| Cloudflare CDN (optional) | ← served through | Cloudflare caches API responses and PWA static assets |
| Service Worker | manages ↔ | Intercepts fetch calls, serves cache on failure |

---

## Testing Checklist

### Data Display
- [ ] Home page shows a card for each node with label, location, and last reading timestamp
- [ ] Node detail page shows a chart of temperature over the last 24 hours
- [ ] Rainfall accumulation is correctly displayed (mm, not raw integer)
- [ ] "Last updated: X minutes ago" timestamp is accurate

### PWA Manifest
- [ ] `manifest.json` is valid (use Chrome DevTools > Application > Manifest)
- [ ] App can be installed ("Add to Home Screen") on Android Chrome
- [ ] Installed app opens in standalone mode (no browser chrome)

### Service Worker — Online
- [ ] On first load, app shell is cached by the service worker
- [ ] On second load, app shell is served from cache (check Network tab: `from ServiceWorker`)
- [ ] On each successful API response, the response is written to the weather data cache

### Service Worker — Offline
- [ ] With network disabled in DevTools: home page loads from service worker cache
- [ ] Cached node detail data (last 24 hours) is visible when offline
- [ ] Offline banner is displayed: "Showing cached data — last updated [timestamp]"
- [ ] Data older than 25 hours is not shown as fresh (cache eviction)

### Rate Limiting
- [ ] Sending >60 requests per minute from the same IP to `/api/v1/public/latest/:node_id` returns `429 Too Many Requests`
- [ ] Normal usage (< 60 req/min) is unaffected

### Cache-Control Headers
- [ ] API response includes `Cache-Control: public, max-age=60`
- [ ] If Cloudflare is deployed: Cloudflare serves a cached response for requests within the TTL window (verify via `CF-Cache-Status: HIT` header)

### Accessibility
- [ ] Page passes WCAG 2.1 AA color contrast check for all text
- [ ] All interactive elements have ARIA labels
- [ ] Page is usable at 375px viewport width (mobile)
