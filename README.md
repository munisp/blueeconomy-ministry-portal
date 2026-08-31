# Blue Economy Ministry Portal

This private TypeScript/React portal is a **runtime-configured** entry point for the Ministry’s approved Blue Economy Platform services. It does not contain seeded users, sample vessels, mock payments, synthetic safety telemetry, fictitious dashboards, default API addresses or substitute service responses.

## Deployment configuration

The deployment must supply a non-secret `/platform-config.json` file. The portal refuses to operate if the configuration is absent, incomplete, insecure or does not define at least one authorised service. Its required shape is:

```json
{
  "application_name": "Approved Ministry portal name",
  "oidc": {
    "authority": "https://approved-oidc-authority",
    "client_id": "approved-public-portal-client",
    "redirect_uri": "https://approved-portal/callback",
    "post_logout_redirect_uri": "https://approved-portal/",
    "scope": "approved scopes"
  },
  "administration": {
    "onboarding_api_url": "https://approved-admin-api/v1/onboarding/requests",
    "organization_id": "approved-keycloak-organization",
    "allowed_roles": ["approved.role"]
  },
  "services": [
    {
      "id": "approved-service-id",
      "label": "Approved service label",
      "health_url": "https://approved-service/authorised-health-route",
      "required_roles": ["approved.role"]
    }
  ],
  "geospatial": {
    "geo_api_url": "https://approved-geo-service/v1/geo",
    "tile_url": "https://approved-tile-service/{z}/{x}/{y}.png",
    "tile_attribution": "Approved tile attribution",
    "poll_interval_ms": 15000,
    "cesium_base_url": "/cesium/",
    "geolibre_enabled": false,
    "geolibre_url": "/geolibre/"
  }
}
```

The JSON above is a **schema illustration only**: it must be replaced at deployment with the actual Keycloak/OIDC authority, registered redirect URI, scopes, APISIX-approved service routes and role model. No corresponding configuration file is committed to this repository.

## Portal route map

The portal uses hash-based routing (no server route table required). Every route renders only observed data from the central administration API; there is no mock data, cached substitute or synthetic endpoint anywhere.

| Hash route | Page | Backend verbs consumed | Access |
|---|---|---|---|
| `#/` | Overview: onboarding submission form + authorised service directory | `POST /v1/onboarding/requests` | Any authenticated session (operator roles required server-side for submission) |
| `#/approvals` | Approval queue: tenant-scoped table with status filter, per-page search, offset pagination | `GET /v1/onboarding/requests` | Approver roles only (`platform-admin`, `nimasa-officer`); others get a truthful "insufficient role" panel |
| `#/approvals/{uuid}` | Request detail: full submission data plus the action set for the recorded status — decision form (`submitted`/`identity_verified`), provision (`approved`), activate (`invited`) | `GET /v1/onboarding/requests` (paged lookup), `POST …/{id}/decision`, `POST …/{id}/provision`, `POST …/{id}/activate` | Approver roles only |
| `#/tracking` | Live vessel-tracking console: 3D/2D map, vessel markers + detail panel, 24 h track polylines, geofence zone overlays, SOS layer (clearance-gated), explicit DEGRADED state | geo-service `GET /v1/geo/vessels`, `GET /v1/geo/vessels/{mmsi}/track`, `GET /v1/geo/zones`, `GET /v1/geo/sos` | Geo-reader roles (`geo-reader`, `geo-zone-maker`, `geo-zone-checker`, `geo-admin`); SOS additionally requires `geo-sos-reader`/`geo-admin` AND RESTRICTED+ clearance; requires the `geospatial` config section |
| `#/geolibre` | GeoLibre geospatial analysis workbench (PILOT) | self-hosted GeoLibre via `@geolibre/embed` postMessage protocol | Any authenticated session; requires build flag + `geospatial.geolibre_*` config |
| `#/sar` | SAR situation console: live case list with status/phase/region filters (region derived from recorded position, labelled as such) | maritime-intelligence `GET /v1/sar/cases?stage=&phase=` | SAR reader roles (`sar-watchkeeper`, `sar-coordinator`, `sar-resourcer`, `sar-observer`, `auditor`); requires `VITE_SAR_API_URL` at build time |
| `#/sar/{caseId}` | SAR case detail: recorded state, taskings, numbered SITREPs, timeline reconstructed from the recorded event sequence, Yaoundé regional cross-links | `GET /v1/sar/cases/{id}`, `GET …/timeline`, `GET …/taskings`, `GET …/sitrep`, `GET /v1/yaounde/releases` | SAR reader roles; per-record clearance enforced by the backend (403/404 surface truthfully) |
| `#/statistics` | Port & blue-economy statistics dashboard: KPI summary cards, provenance ledger, bar charts of exact precomputed gold rows, documented publication gaps | data-platform statistics API `GET /v1/stats/health`, `GET /v1/stats/kpis`, `GET /v1/stats/runs`, `GET /v1/stats/values?kpi_id=&port_code=&period=` | `stats-reader` role; requires `VITE_STATISTICS_API_URL` at build time |

### Build-time console endpoints (Phase 8)

The SAR console and statistics dashboard resolve their backends from build-time environment variables, never from hardcoded defaults: `VITE_SAR_API_URL` (the approved maritime-intelligence deployment serving `/v1/sar/*` and `/v1/yaounde/*`) and `VITE_STATISTICS_API_URL` (the approved data-platform statistics API, including the `/v1/stats` route prefix). Both must be HTTPS URLs without credentials, query parameters or fragments. A deployment built without them renders an explicit "console not configured" state naming the missing variable — no endpoint or data is substituted. The statistics API's published registry is the authoritative KPI list; emissions/MRV and blue-carbon summaries are not part of its published surface at this time and the dashboard states that honestly rather than fabricating figures.

Approver-journey states are derived strictly from the backend-recorded status (`src/approvals-model.ts`): non-actionable states (`pending_verification`, `identity_review`, in-flight `provisioning`/`activating`, terminal and ambiguous states) render an honest explanation instead of actions. Failure states are truthful throughout: HTTP 401 redirects to the approved identity authority for a fresh sign-in, HTTP 403 renders an explicit insufficient-role message, and network/5xx failures render a retry. Unknown hashes fall back to `#/`.

### Backend verbs intentionally without UI

The following administration-service verb groups exist but are **deliberately not surfaced** in this portal:

- **Privacy processing activities** (`POST /v1/privacy/activities`, `GET /v1/privacy/activities/{id}`, `POST …/attest`, `POST …/submit-dpo-review`, `POST …/decision`): the workflow is versioned and evidence-bound (`expected_version`, `evidence_sha256` inputs), and — the blocking gap — **the backend exposes no list endpoint for privacy activities**, so a portal queue would require hand-typed activity UUIDs, the exact discovery anti-pattern flagged by the platform UI audit. Backend gap to close first: `GET /v1/privacy/activities` (tenant-scoped list).
- **Enrollment identity review and batches** (`POST /v1/enrollment/requests/{id}/identity-review/*`, `POST /v1/enrollment/batches`, `POST /v1/enrollment/batches/{id}/confirm`): same class of gap — **no list endpoints for enrollment requests or batches** exist, so there is no honest queue to render. Self-service enrollment requests do appear in the approver queue once they reach a decidable state (`identity_verified`) because the onboarding list endpoint covers them. Backend gaps to close first: `GET /v1/enrollment/requests`, `GET /v1/enrollment/batches`.

These will be surfaced when the backend list endpoints exist; building hand-typed-ID consoles before then would be dead UI.

Related read-surface constraint: the backend exposes **no get-by-id onboarding verb**, so `#/approvals/{uuid}` resolves a record by bounded paging of the tenant queue (at most 10 pages × 100 records) and a request that fell outside the window renders a truthful not-found state rather than a stale copy.

## Runtime behaviour

The portal authenticates through the configured OIDC authority using authorization code flow. It sends a bearer token only to the configured central administration API (onboarding submission, approver queue reads and approver actions) and to on-demand probes against configured HTTPS endpoints. An onboarding submission records a request for a separate approver; it does not directly create a local user, a password, an identity credential or a Keycloak account. The UI reports observed API outcomes and does not infer service health, authorisation, transactions or operational status.

The backend and API edge remain authoritative for role enforcement. The portal’s displayed required roles are operational context, not a client-side access-control substitute.

## Vessel tracking console (`#/tracking`)

The tracking console renders **only validated observations returned by the geo-service for the session's own clearance**; there is no mock vessel data, no simulated AIS feed and no cached substitute anywhere in the bundle (dev fixtures: none shipped).

- **Data source.** All vessel, track, zone and SOS data comes from the deployment-configured geo-service (`geospatial.geo_api_url`, the `blueeconomy-geo-service` `/v1/geo` REST boundary). Freshness is polling-based (`geospatial.poll_interval_ms`, default 15 s, bounded 5–300 s) per the platform store-forward doctrine — no WebSocket dependency.
- **Wire semantics.** Positions are fixed-point micro-degrees, speeds milli-knots and courses milli-degrees per the `geo.*.v1` contracts; the client refuses to coerce floating-point or out-of-range values, drops malformed records, and surfaces the dropped count. SOS alerts below the RESTRICTED contract floor are dropped at parse time.
- **Classification handling.** A banner states the session's clearance on the geo ladder (read from the JWT `clearance` claim; absent defaults to PUBLIC, matching the service). The SOS layer is fetched and rendered only when the session holds `geo-sos-reader`/`geo-admin` AND a clearance covering RESTRICTED; the geo-service remains the authoritative enforcer.
- **Map engines.** Primary: self-hosted **CesiumJS** (Apache-2.0), strictly ion-free — `Ion.defaultAccessToken=""`, the deployment tile template is the only base layer, geocoder/base-layer-picker are disabled, default ellipsoid terrain is kept, and runtime assets are served from the portal's own `/cesium` directory (copied from the npm package at build time). Fallback: **MapLibre GL** (BSD-3-Clause), auto-selected when WebGL2 is unavailable or chosen via the operator toggle. Both engines share the same render-gated tile endpoint and layer styling.
- **Fail-closed degradation.** If the geo-service is unreachable the console shows an explicit DEGRADED state — last confirmed observations with their timestamp (stale-dimmed), or the bare base map — and never fabricates vessel data. Zone and SOS layers degrade per-section without taking down the live picture.

## Render-gating and offline/sovereign operation (decision D8)

Every external resource the portal touches is deployment-configured; pointed at internal endpoints the portal renders fully offline/sovereign:

| Resource | Config key | Rules enforced |
|---|---|---|
| Geo-service API | `geospatial.geo_api_url` | HTTPS, no credentials/query/fragment |
| Base map tiles | `geospatial.tile_url` | HTTPS or same-origin path, must contain literal `{z}/{x}/{y}`, no query (no API keys) |
| Tile attribution | `geospatial.tile_attribution` | optional text |
| Cesium runtime assets | build-time `CESIUM_BASE_URL` (default `/cesium/`) | self-hosted from the npm package; only same-origin paths accepted in config |
| GeoLibre analysis app | `geospatial.geolibre_url` | same-origin absolute path only (reverse-proxied deployment) |
| Fonts/icons | — | system font stack and inline styling only; no external font or icon CDN anywhere |

The strict CSP (`deploy/nginx.conf`) permits `https:` image/connect targets precisely so the tile and geo endpoints can be sovereign internal origins; `worker-src 'self' blob:` covers the bundled map web workers and `frame-src 'self'` the same-origin GeoLibre iframe. Production builds ship **no sourcemaps** (`build.sourcemap: false`).

## GeoLibre pilot (`#/geolibre`, decision D7)

Status: **integration complete against the published `@geolibre/embed` npm package (MIT)** — no WASM vendoring was required, and no external CDN is involved: the GeoLibre app itself is a self-hosted deployment (e.g. `ghcr.io/opengeos/geolibre`) reverse-proxied onto the portal origin. The pilot requires BOTH switches:

1. build flag `VITE_GEOLIBRE_ENABLED=true` (anything else compiles the panel out);
2. runtime config `geospatial.geolibre_enabled: true` with a same-origin `geolibre_url`.

The GeoLibre deployment must in turn allowlist this portal's origin (`GEOLIBRE_EMBED_ORIGINS` for the Docker image); without that allowlist the embed handshake times out and the panel says so honestly. Implemented and verified at build/test level: iframe embed, protocol handshake, fly-to-Nigeria-EEZ and list-layers commands, truthful connecting/ready/failed states. **Not yet verified against a live GeoLibre deployment** (none exists in this environment) — that end-to-end check remains a release gate alongside the "Real integration gate" below.

## Real integration gate

Before release, the Ministry must provide the actual OIDC discovery/realm settings, registered client, redirect/logout URIs, approved scopes and audience, APISIX routes, service health paths, TLS trust chain, content-security policy, user-role assignments, cross-origin policy and target cluster deployment. End-to-end sign-in and service probes must be executed in the authorised non-production environment and retained as release evidence.

## Container artifact and local operational checks

The repository now supplies a two-stage `Dockerfile` that builds the Vite artifact with `npm ci` and serves it through the unprivileged NGINX image on port `8080`. The final image contains only static build output and web-server policy; it does not contain a runtime configuration, OIDC secret, API credential or service endpoint. `/platform-config.json` must be mounted or otherwise supplied by the approved deployment mechanism as a non-secret, no-store runtime artifact.

The image exposes `/healthz`, which returns a no-store JSON readiness response and does not claim downstream service availability. The NGINX policy has an SPA fallback, immutable cache control for fingerprinted assets, a non-cacheable configuration route, and browser controls including CSP, frame denial, no-referrer policy, MIME sniffing denial and a restrictive permissions policy. TLS/HSTS, ingress routing, external CSP review, image signing, registry policy, workload identity, audit logging and non-production OIDC sign-in/probe evidence remain environment-controlled release gates.

```bash
npm ci
npm run build
sudo docker build -t blueeconomy-ministry-portal:local .
sudo docker run --rm -p 18081:8080 \
  -v /approved/non-secret/platform-config.json:/usr/share/nginx/html/platform-config.json:ro \
  blueeconomy-ministry-portal:local
curl --fail http://127.0.0.1:18081/healthz
```

The path in this example is an operator-provided artifact. It is intentionally not present in this repository.
