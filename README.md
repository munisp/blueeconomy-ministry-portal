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
  ]
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

Approver-journey states are derived strictly from the backend-recorded status (`src/approvals-model.ts`): non-actionable states (`pending_verification`, `identity_review`, in-flight `provisioning`/`activating`, terminal and ambiguous states) render an honest explanation instead of actions. Failure states are truthful throughout: HTTP 401 redirects to the approved identity authority for a fresh sign-in, HTTP 403 renders an explicit insufficient-role message, and network/5xx failures render a retry. Unknown hashes fall back to `#/`.

### Backend verbs intentionally without UI

The following administration-service verb groups exist but are **deliberately not surfaced** in this portal:

- **Privacy processing activities** (`POST /v1/privacy/activities`, `GET /v1/privacy/activities/{id}`, `POST …/attest`, `POST …/submit-dpo-review`, `POST …/decision`): the workflow is versioned and evidence-bound (`expected_version`, `evidence_sha256` inputs), and — the blocking gap — **the backend exposes no list endpoint for privacy activities**, so a portal queue would require hand-typed activity UUIDs, the exact discovery anti-pattern flagged by the platform UI audit. Backend gap to close first: `GET /v1/privacy/activities` (tenant-scoped list).
- **Enrollment identity review and batches** (`POST /v1/enrollment/requests/{id}/identity-review/*`, `POST /v1/enrollment/batches`, `POST /v1/enrollment/batches/{id}/confirm`): same class of gap — **no list endpoints for enrollment requests or batches** exist, so there is no honest queue to render. Self-service enrollment requests do appear in the approver queue once they reach a decidable state (`identity_verified`) because the onboarding list endpoint covers them. Backend gaps to close first: `GET /v1/enrollment/requests`, `GET /v1/enrollment/batches`.

These will be surfaced when the backend list endpoints exist; building hand-typed-ID consoles before then would be dead UI.

## Runtime behaviour

The portal authenticates through the configured OIDC authority using authorization code flow. It sends a bearer token only to the configured central administration API (onboarding submission, approver queue reads and approver actions) and to on-demand probes against configured HTTPS endpoints. An onboarding submission records a request for a separate approver; it does not directly create a local user, a password, an identity credential or a Keycloak account. The UI reports observed API outcomes and does not infer service health, authorisation, transactions or operational status.

The backend and API edge remain authoritative for role enforcement. The portal’s displayed required roles are operational context, not a client-side access-control substitute.

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
