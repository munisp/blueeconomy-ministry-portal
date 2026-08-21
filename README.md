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

## Runtime behaviour

The portal authenticates through the configured OIDC authority using authorization code flow. It sends a bearer token only when an authenticated user explicitly submits an onboarding request to the configured central administration API or requests an on-demand probe against a configured HTTPS endpoint. An onboarding submission records a request for a separate approver; it does not directly create a local user, a password, an identity credential or a Keycloak account. The UI reports observed API outcomes and does not infer service health, authorisation, transactions or operational status.

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
