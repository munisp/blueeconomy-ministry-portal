// endpoint-config resolves the Phase-8 console endpoints (SAR C2 / Yaoundé
// gateway and the data-platform statistics API) strictly from build-time
// environment variables. No endpoint is hardcoded anywhere: a deployment
// that does not supply the variable gets a clear configuration error and
// the console refuses to render, exactly like the runtime configuration
// gate in runtime-config.ts. URLs must be HTTPS without credentials, query
// parameters or fragments (the same rules as every other configured URL in
// this portal).

export interface SarConsoleEndpoints {
  // Base of the maritime-intelligence API serving /v1/sar/* and
  // /v1/yaounde/* (blueeconomy-maritime-intelligence internal/server).
  sar_api_url: string;
}

export interface StatisticsEndpoints {
  // Base of the data-platform statistics API serving /v1/stats/*
  // (blueeconomy-data-platform src/blueeconomy_data_platform/stats_api.py).
  statistics_api_url: string;
}

export type EndpointResolution<T> = { ok: true; endpoints: T } | { ok: false; error: string };

export const SAR_API_URL_ENV = "VITE_SAR_API_URL";
export const STATISTICS_API_URL_ENV = "VITE_STATISTICS_API_URL";

// readBuildEnv reads a VITE_* build-time variable. The literal
// `import.meta.env` token is required so Vite statically replaces it in the
// production bundle; under the Node test runner (tsx) `import.meta.env` is
// undefined and the process environment is consulted instead, keeping the
// module unit-testable without a bundler.
function readBuildEnv(name: string): string | undefined {
  const viteEnv: Record<string, string | undefined> | undefined = import.meta.env;
  const fromVite = viteEnv === undefined ? undefined : viteEnv[name];
  if (fromVite !== undefined) {
    return fromVite;
  }
  // Node fallback for the test runner (tsx): `process` is not part of the
  // browser bundle's type surface, so it is reached through globalThis.
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return nodeProcess?.env?.[name];
}

function validateEndpointUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} is not a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${field} must be an HTTPS URL without credentials, query parameters or fragments`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function resolve<T>(fields: ReadonlyArray<[string, string]>, build: (values: Record<string, string>) => T): EndpointResolution<T> {
  const values: Record<string, string> = {};
  for (const [envName, field] of fields) {
    const raw = readBuildEnv(envName);
    if (raw === undefined || raw.trim().length === 0) {
      return { ok: false, error: `${envName} is not configured: the deployment must supply the approved ${field} endpoint at build time` };
    }
    try {
      values[field] = validateEndpointUrl(raw.trim(), `${envName} (${field})`);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : `${envName} is invalid` };
    }
  }
  return { ok: true, endpoints: build(values) };
}

// resolveSarConsoleEndpoints fails closed unless VITE_SAR_API_URL points at
// the approved maritime-intelligence deployment.
export function resolveSarConsoleEndpoints(): EndpointResolution<SarConsoleEndpoints> {
  return resolve([[SAR_API_URL_ENV, "sar_api_url"]], (values) => ({ sar_api_url: values.sar_api_url }));
}

// resolveStatisticsEndpoints fails closed unless VITE_STATISTICS_API_URL
// points at the approved data-platform statistics API (the URL includes the
// /v1/stats prefix, matching the service's route root).
export function resolveStatisticsEndpoints(): EndpointResolution<StatisticsEndpoints> {
  return resolve([[STATISTICS_API_URL_ENV, "statistics_api_url"]], (values) => ({ statistics_api_url: values.statistics_api_url }));
}
