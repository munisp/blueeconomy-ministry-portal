/**
 * Browser RUM (real-user monitoring) for the portal, per phase-7 OTel design
 * (OTEL_DESIGN.md §2 RUM row): document-load + fetch/XHR instrumentation,
 * web-vitals, session-id attribution, 10% default sampling, OTLP/HTTP export
 * to the cluster collector agent (:4318).
 *
 * Fail-open contract (the one sanctioned fail-open): telemetry is GUARDED by
 * the deployment-supplied runtime configuration. No `telemetry.otlp_endpoint`
 * in /platform-config.json = telemetry disabled. Initialisation is async,
 * dynamically imported (never in the critical render path) and NEVER throws
 * or rejects — a collector outage or a broken OTel chunk load must not break
 * page load or any interaction.
 *
 * Tenant attribution: intentionally NOT set. The portal's OIDC profile does
 * not expose a tenant/agency claim client-side today; adding one is an auth
 * (Keycloak claim mapping) decision, not a telemetry one. When a tenant claim
 * becomes available it can be added here as `tenant.id` without new auth
 * flows.
 */

export const DEFAULT_SAMPLE_RATIO = 0.1;

export interface TelemetryInitOptions {
  /**
   * OTLP/HTTP base URL of the collector agent, e.g. "https://otel.example:4318".
   * "/v1/traces" is appended. Undefined/empty = telemetry disabled.
   */
  endpoint?: string;
  /** Trace sampling ratio in [0, 1]. Default DEFAULT_SAMPLE_RATIO (10%). */
  sampleRatio?: number;
  /** OTel service.name resource attribute. */
  serviceName: string;
  /**
   * URL prefixes that may receive W3C traceparent headers on fetch/XHR
   * (CORS-approved API origins only). Same-origin requests always propagate.
   */
  propagateTo?: string[];
  /** Session id override (tests). Defaults to a per-tab sessionStorage id. */
  sessionId?: string;
}

export interface TelemetryHandle {
  readonly enabled: boolean;
  /** Human-readable reason when disabled (or "ok" when enabled). */
  readonly reason: string;
  /** Effective sampling ratio. */
  readonly sampleRatio: number;
  /** Flushes pending spans, disables instrumentations; never rejects. */
  shutdown(): Promise<void>;
}

const noopShutdown = (): Promise<void> => Promise.resolve();

function disabledHandle(reason: string, sampleRatio: number): TelemetryHandle {
  return { enabled: false, reason, sampleRatio, shutdown: noopShutdown };
}

/**
 * Effective sampling ratio: 10% default, configurable. Defensive by design —
 * a malformed value degrades to the default or the nearest bound instead of
 * breaking the page (fail-open).
 */
export function resolveSampleRatio(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SAMPLE_RATIO;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SAMPLE_RATIO;
  }
  return Math.min(1, Math.max(0, value));
}

export function isTelemetryEnabled(options: Pick<TelemetryInitOptions, "endpoint">): boolean {
  return typeof options.endpoint === "string" && options.endpoint.trim().length > 0;
}

const SESSION_STORAGE_KEY = "be.otel.session_id";

/**
 * Per-tab session id (sessionStorage survives reloads, not new tabs — the
 * standard RUM session boundary). Falls back to an in-memory id when storage
 * is unavailable (private mode); never throws.
 */
export function resolveSessionId(): string {
  const newId = (): string => globalThis.crypto.randomUUID();
  try {
    const stored = globalThis.window?.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    if (stored !== null && stored !== undefined && stored.length > 0) {
      return stored;
    }
    const created = newId();
    globalThis.window?.sessionStorage?.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    try {
      return newId();
    } catch {
      // Last resort for exotic webviews: non-crypto id, telemetry-only.
      return `session-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Initialises browser RUM. ALWAYS resolves — never rejects, never throws
 * synchronously. Callers should fire-and-forget (`void initTelemetry(...)`)
 * so telemetry stays out of the critical render path.
 */
export async function initTelemetry(options: TelemetryInitOptions): Promise<TelemetryHandle> {
  const sampleRatio = resolveSampleRatio(options.sampleRatio);
  const endpoint = options.endpoint?.trim();
  if (!endpoint) {
    return disabledHandle("no OTLP endpoint configured", sampleRatio);
  }

  try {
    // Dynamic imports: the OTel/web-vitals bundles load asynchronously and
    // only when telemetry is configured — absent endpoint means zero cost.
    const [
      { WebTracerProvider },
      { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler },
      { OTLPTraceExporter },
      { resourceFromAttributes },
      { ATTR_SERVICE_NAME },
      { registerInstrumentations },
      { DocumentLoadInstrumentation },
      { FetchInstrumentation },
      { XMLHttpRequestInstrumentation },
      webVitals,
    ] = await Promise.all([
      import("@opentelemetry/sdk-trace-web"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
      import("@opentelemetry/instrumentation"),
      import("@opentelemetry/instrumentation-document-load"),
      import("@opentelemetry/instrumentation-fetch"),
      import("@opentelemetry/instrumentation-xml-http-request"),
      import("web-vitals"),
    ]);

    const sessionId = options.sessionId ?? resolveSessionId();
    const tracesUrl = `${endpoint.replace(/\/+$/, "")}/v1/traces`;
    // Never trace the exporter's own exports (feedback loop).
    const exporterPattern = new RegExp(`^${escapeRegExp(endpoint.replace(/\/+$/, ""))}`);
    const propagationTargets = (options.propagateTo ?? []).map(
      (prefix) => new RegExp(`^${escapeRegExp(prefix.replace(/\/+$/, ""))}`),
    );

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
      }),
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
      spanProcessors: [
        // session.id on every span = RUM session attribution.
        {
          onStart(span) {
            span.setAttribute("session.id", sessionId);
          },
          onEnd() {},
          forceFlush: () => Promise.resolve(),
          shutdown: () => Promise.resolve(),
        },
        // Batched, async export: telemetry never blocks the business path.
        new BatchSpanProcessor(new OTLPTraceExporter({ url: tracesUrl })),
      ],
    });
    provider.register();

    const instrumentations = [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: propagationTargets,
        ignoreUrls: [exporterPattern],
        clearTimingResources: true,
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: propagationTargets,
        ignoreUrls: [exporterPattern],
        clearTimingResources: true,
      }),
    ];
    registerInstrumentations({ instrumentations, tracerProvider: provider });

    // web-vitals: one ended span per metric report, correlated via session.id.
    const tracer = provider.getTracer(options.serviceName);
    const recordVital = (metric: { name: string; value: number; rating: string; id: string }): void => {
      const span = tracer.startSpan(`web-vitals.${metric.name}`, {
        attributes: {
          "web_vitals.name": metric.name,
          "web_vitals.value": metric.value,
          "web_vitals.rating": metric.rating,
          "web_vitals.id": metric.id,
        },
      });
      span.end();
    };
    webVitals.onCLS(recordVital, { reportAllChanges: true });
    webVitals.onFCP(recordVital);
    webVitals.onINP(recordVital, { reportAllChanges: true });
    webVitals.onLCP(recordVital, { reportAllChanges: true });
    webVitals.onTTFB(recordVital);

    return {
      enabled: true,
      reason: "ok",
      sampleRatio,
      shutdown: async () => {
        try {
          for (const instrumentation of instrumentations) {
            instrumentation.disable();
          }
          await provider.shutdown();
        } catch {
          // fail-open: shutdown problems must never surface to the app
        }
      },
    };
  } catch {
    return disabledHandle("telemetry initialisation failed", sampleRatio);
  }
}
