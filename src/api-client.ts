import type { PortalRuntimeConfiguration, ServiceRuntimeConfiguration } from "./runtime-config";

export type ApiErrorKind = "http" | "network" | "invalid-payload" | "not-configured";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function authorisedFetch(baseUrl: string, path: string, token: string, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: "GET",
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError("http", `request to ${path} failed with HTTP ${response.status}`, response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("network", error instanceof Error ? error.message : "network request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiGet<T>(
  baseUrl: string,
  path: string,
  token: string,
  validate: (candidate: unknown) => T,
): Promise<T> {
  const response = await authorisedFetch(baseUrl, path, token, "application/json");
  let candidate: unknown;
  try {
    candidate = await response.json();
  } catch {
    throw new ApiError("invalid-payload", `response from ${path} was not valid JSON`);
  }
  try {
    return validate(candidate);
  } catch (error) {
    throw new ApiError("invalid-payload", error instanceof Error ? error.message : `response from ${path} failed validation`);
  }
}

export interface SignedBlob {
  blob: Blob;
  signature: string | null;
  signatureAlgorithm: string | null;
}

export async function apiGetSignedBlob(baseUrl: string, path: string, token: string): Promise<SignedBlob> {
  const response = await authorisedFetch(baseUrl, path, token, "application/pdf, application/json");
  const contentType = (response.headers.get("Content-Type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    // JWS envelope: { "payload": base64(pdf), "signature": "<compact jws>", "algorithm": "..." }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new ApiError("invalid-payload", `briefing envelope from ${path} was not valid JSON`);
    }
    if (typeof envelope !== "object" || envelope === null) {
      throw new ApiError("invalid-payload", "briefing envelope must be an object");
    }
    const record = envelope as Record<string, unknown>;
    const payload = record.payload;
    const signature = record.signature;
    if (typeof payload !== "string" || payload.length === 0 || typeof signature !== "string" || signature.split(".").length !== 3) {
      throw new ApiError("invalid-payload", "briefing envelope must carry a base64 payload and a compact JWS signature");
    }
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
    } catch {
      throw new ApiError("invalid-payload", "briefing payload was not valid base64");
    }
    if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      throw new ApiError("invalid-payload", "briefing payload is not a PDF document");
    }
    const algorithm = typeof record.algorithm === "string" ? record.algorithm : null;
    return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), signature, signatureAlgorithm: algorithm };
  }
  if (!contentType.includes("application/pdf")) {
    throw new ApiError("invalid-payload", `briefing response had unexpected content type ${contentType || "(none)"}`);
  }
  // Detached JWS carried in response headers.
  const signature = response.headers.get("X-Content-JWS") ?? response.headers.get("X-JWS-Signature");
  if (signature === null || signature.split(".").length !== 3) {
    throw new ApiError("invalid-payload", "briefing response did not carry a compact JWS signature header");
  }
  return {
    blob: await response.blob(),
    signature,
    signatureAlgorithm: response.headers.get("X-Content-JWS-Alg"),
  };
}

/**
 * Resolve the KPI API base URL from the deployment-provided service registry.
 * The executive dashboards are served by the national single-window backend;
 * when no service carries an explicit id of `singlewindow` the first approved
 * service origin is used. Fail-closed: throws when the registry is empty.
 */
export function resolveDashboardApiBase(configuration: PortalRuntimeConfiguration, serviceId = "singlewindow"): string {
  const preferred = configuration.services.find((service) => service.id === serviceId);
  const service = preferred ?? configuration.services[0];
  if (service === undefined) {
    throw new ApiError("not-configured", "the approved service registry is empty; dashboard endpoints are unavailable");
  }
  return serviceApiOrigin(service);
}

export function serviceApiOrigin(service: ServiceRuntimeConfiguration): string {
  return new URL(service.health_url).origin;
}
