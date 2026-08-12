import type { ServiceRuntimeConfiguration } from "./runtime-config";

export interface ServiceProbeResult {
  service_id: string;
  completed_at: string;
  ok: boolean;
  http_status?: number;
  failure?: string;
}

export async function probeService(service: ServiceRuntimeConfiguration, token: string): Promise<ServiceProbeResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(service.health_url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      service_id: service.id,
      completed_at: new Date().toISOString(),
      ok: response.ok,
      http_status: response.status,
    };
  } catch (error) {
    return {
      service_id: service.id,
      completed_at: new Date().toISOString(),
      ok: false,
      failure: error instanceof Error ? error.message : "network probe failed",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
