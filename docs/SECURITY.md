# Security Posture — BlueEconomy Ministry Portal

Phase-11 security audit and hardening (branch `phase11/security`). This is a
client-only React SPA served by nginx; all authorization decisions are made by
the platform backend services it calls.

## Controls present (pre-existing)

- **HTTP headers (nginx `deploy/nginx.conf`):** CSP (`default-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`,
  `form-action 'self'`, `script-src 'self'`, `style-src 'self'`,
  `upgrade-insecure-requests`), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, restrictive
  `Permissions-Policy`, `server_tokens off`.
- **Runtime configuration validation:** `platform-config.json` is strictly
  validated; every URL field must be HTTPS with no embedded credentials,
  query, or fragment (fail-closed — invalid config aborts boot).
- **OIDC:** authorization-code flow with PKCE via `oidc-client-ts`; tokens and
  OIDC state live in `sessionStorage` (not localStorage); protocol claims
  filtered; no automatic silent renew.
- **Role gating:** service tiles render only for roles in the validated
  runtime configuration; backend services re-check authorization server-side.
- **Error handling:** UI surfaces only HTTP status codes / generic failure
  text — no stack traces or internal details.
- **Build:** pinned base-image digests in the Dockerfile; `npm ci
  --ignore-scripts`; unprivileged nginx runtime (UID 101, port 8080).

## Fixes applied in Phase 11

1. **Missing HSTS (LOW).** Added `Strict-Transport-Security: max-age=31536000;
   includeSubDomains` to the nginx config. Browsers honour it once the ingress
   terminates TLS in front of this container.
2. **Dependency audit.** `npm audit` (prod and full) against registry.npmjs.org:
   0 vulnerabilities. No changes required.

## Audit notes (categories with no findings)

- **Secrets scan:** no private keys, tokens, passwords, or connection strings
  in the working tree; configuration is runtime-injected, nothing secret is
  bundled.
- **CORS / rate limiting / AuthZ / RLS:** not applicable in this repo — no
  server-side API lives here; these controls belong to the platform services
  (see their SECURITY.md).
- **Error handling:** verified no stack traces or internal details are rendered.

## Residual recommendations

- CSP `connect-src 'self' https:` is intentionally broad because service
  endpoints are runtime-configured; once the set of platform origins is stable,
  replace `https:` with an explicit origin allowlist (build-time templated).
- Consider `require-sri-for script style` and hashed-asset SRI if third-party
  CDNs are ever introduced.
- `automaticSilentRenew` is disabled; sessions end at token expiry — revisit
  only with a backend-for-frontend token pattern.

## Validation

- `npm run build` (tsc -b + vite build): success.
- `npm test` (node --test): 2/2 pass.
- `npm audit`: 0 vulnerabilities.
