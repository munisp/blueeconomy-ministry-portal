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

The portal authenticates through the configured OIDC authority using authorization code flow. It sends a bearer token only when an authenticated user explicitly requests an on-demand probe against a configured HTTPS endpoint. The UI reports the observed HTTP result; it does not create records or infer service health, authorisation, transactions or operational status.

The backend and API edge remain authoritative for role enforcement. The portal’s displayed required roles are operational context, not a client-side access-control substitute.

## Real integration gate

Before release, the Ministry must provide the actual OIDC discovery/realm settings, registered client, redirect/logout URIs, approved scopes and audience, APISIX routes, service health paths, TLS trust chain, content-security policy, user-role assignments, cross-origin policy and target cluster deployment. End-to-end sign-in and service probes must be executed in the authorised non-production environment and retained as release evidence.
