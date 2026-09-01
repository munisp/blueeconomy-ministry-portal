export interface ServiceWorkerRegistrationResult {
  registered: boolean;
  reason?: string;
}

/** Minimal structural view of the platform APIs the registration logic needs (injectable for tests). */
export interface ServiceWorkerRegistrationEnvironment {
  serviceWorker?: {
    register: (scriptUrl: string) => Promise<unknown>;
  };
}

function browserEnvironment(): ServiceWorkerRegistrationEnvironment | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  const container = (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
  if (container === undefined) {
    return {};
  }
  return { serviceWorker: { register: (scriptUrl) => container.register(scriptUrl) } };
}

/**
 * Register the offline app-shell service worker. Fail-soft by design: the
 * portal remains fully functional without a service worker, so unsupported
 * environments and registration failures are reported, never thrown.
 */
export async function registerServiceWorker(
  scriptUrl = "/sw.js",
  environment: ServiceWorkerRegistrationEnvironment | undefined = browserEnvironment(),
): Promise<ServiceWorkerRegistrationResult> {
  if (environment === undefined || environment.serviceWorker === undefined) {
    return { registered: false, reason: "service workers are not supported in this environment" };
  }
  try {
    await environment.serviceWorker.register(scriptUrl);
    return { registered: true };
  } catch (error) {
    return { registered: false, reason: error instanceof Error ? error.message : "service worker registration failed" };
  }
}

/** Register after window load so first paint is never blocked. */
export function registerServiceWorkerOnLoad(scriptUrl = "/sw.js"): void {
  if (typeof window === "undefined") {
    return;
  }
  const register = () => {
    void registerServiceWorker(scriptUrl).then((result) => {
      if (!result.registered) {
        // eslint-disable-next-line no-console
        console.info("PWA service worker not active:", result.reason ?? "unknown reason");
      }
    });
  };
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
