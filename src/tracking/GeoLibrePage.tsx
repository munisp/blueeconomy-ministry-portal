// GeoLibrePage is the #/geolibre analysis panel — the decision-D7 GeoLibre
// pilot. It embeds a self-hosted GeoLibre deployment in a same-origin
// iframe and drives it through the typed @geolibre/embed postMessage
// protocol (MIT, no external CDN: the app is reverse-proxied onto the
// portal origin, so nothing leaves the enclave). The panel is a PILOT
// gated by two independent switches that must BOTH be on:
//   1. build flag VITE_GEOLIBRE_ENABLED=true
//   2. runtime config geospatial.geolibre_enabled=true + geolibre_url
// With either off the panel renders an honest not-enabled state; it never
// pretends an analysis session exists. The GeoLibre deployment itself must
// allowlist this portal's origin (GEOLIBRE_EMBED_ORIGINS) — see README.
import { useEffect, useRef, useState } from "react";
import { connect, type GeoLibreEmbedClient, type LayerSummary } from "@geolibre/embed";
import type { GeospatialRuntimeConfiguration } from "../runtime-config";

// GEOLIBRE_BUILD_ENABLED is the build-time pilot switch (baked by vite from
// VITE_GEOLIBRE_ENABLED; anything other than the exact string "true" is
// off).
const GEOLIBRE_BUILD_ENABLED: boolean = import.meta.env.VITE_GEOLIBRE_ENABLED === "true";

const NIGERIA_EEZ_VIEW = { center: [4.0, 6.5] as [number, number], zoom: 5.2, duration: 1200 };

type EmbedState =
  | { kind: "connecting" }
  | { kind: "ready"; client: GeoLibreEmbedClient }
  | { kind: "failed"; message: string };

interface GeoLibrePageProperties {
  configuration?: GeospatialRuntimeConfiguration;
}

export function GeoLibrePage({ configuration }: GeoLibrePageProperties) {
  if (!GEOLIBRE_BUILD_ENABLED) {
    return (
      <PilotShell>
        <p className="eyebrow">Pilot not enabled</p>
        <h2>The GeoLibre analysis pilot is not compiled into this build</h2>
        <p>This portal was built without <code>VITE_GEOLIBRE_ENABLED=true</code>, so the analysis panel is intentionally absent. Rebuild with the flag to evaluate the pilot; nothing is substituted in its place.</p>
      </PilotShell>
    );
  }
  if (configuration === undefined || !configuration.geolibre_enabled || configuration.geolibre_url === undefined) {
    return (
      <PilotShell>
        <p className="eyebrow">Pilot not configured</p>
        <h2>The deployment has not wired a GeoLibre endpoint</h2>
        <p>The build carries the pilot, but the runtime configuration does not set <code>geospatial.geolibre_enabled</code> and a same-origin <code>geospatial.geolibre_url</code>. The portal does not fall back to any hosted or CDN instance.</p>
      </PilotShell>
    );
  }
  return <GeoLibreEmbed url={configuration.geolibre_url} />;
}

function PilotShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="geolibre-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GeoLibre analysis · PILOT</p>
          <h2>Geospatial analysis workbench</h2>
        </div>
        <p className="section-note">Pilot-grade integration (decision D7): a self-hosted GeoLibre deployment embedded same-origin and driven through the typed embed protocol.</p>
      </div>
      <section className="empty-state">{children}</section>
    </section>
  );
}

function GeoLibreEmbed({ url }: { url: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [state, setState] = useState<EmbedState>({ kind: "connecting" });
  const [layers, setLayers] = useState<LayerSummary[] | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null) {
      return;
    }
    let active = true;
    let client: GeoLibreEmbedClient | null = null;
    // Same-origin iframe: the embed origin is this portal's own origin, and
    // the GeoLibre deployment must allowlist it (GEOLIBRE_EMBED_ORIGINS).
    void connect(iframe, { origin: window.location.origin, timeoutMs: 20_000 }).then(
      (connected) => {
        if (!active) {
          connected.disconnect();
          return;
        }
        client = connected;
        setState({ kind: "ready", client: connected });
      },
      (error: unknown) => {
        if (active) {
          setState({ kind: "failed", message: error instanceof Error ? error.message : "GeoLibre embed handshake failed" });
        }
      },
    );
    return () => {
      active = false;
      client?.disconnect();
    };
  }, [url]);

  async function flyToNigeria(): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }
    setActionNote(null);
    try {
      await state.client.setView(NIGERIA_EEZ_VIEW);
    } catch (error) {
      setActionNote(`setView rejected: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  async function refreshLayers(): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }
    setActionNote(null);
    try {
      setLayers(await state.client.listLayers());
    } catch (error) {
      setActionNote(`listLayers rejected: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return (
    <section className="geolibre-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GeoLibre analysis · PILOT</p>
          <h2>Geospatial analysis workbench</h2>
        </div>
        <p className="section-note">
          {state.kind === "connecting" && "Connecting to the self-hosted GeoLibre deployment…"}
          {state.kind === "ready" && "Embed protocol connected — commands below act on the framed map."}
          {state.kind === "failed" && "The embed protocol could not be established."}
        </p>
      </div>
      {state.kind === "failed" && (
        <section className="empty-state empty-state--alert" role="alert">
          <p className="eyebrow">Pilot unavailable</p>
          <h2>GeoLibre did not answer the embed handshake</h2>
          <p>{state.message}. Confirm the deployment is proxied at the configured path and that its <code>GEOLIBRE_EMBED_ORIGINS</code> allowlist names this portal origin. No substitute analysis view is rendered.</p>
        </section>
      )}
      <div className="geolibre-toolbar">
        <button className="button button--outline" disabled={state.kind !== "ready"} onClick={() => void flyToNigeria()}>Fly to Nigeria EEZ</button>
        <button className="button button--outline" disabled={state.kind !== "ready"} onClick={() => void refreshLayers()}>List analysis layers</button>
      </div>
      {actionNote !== null && <p className="tracking-note tracking-note--warn" role="status">{actionNote}</p>}
      {layers !== null && (
        <ul className="geolibre-layers">
          {layers.map((layer) => (
            <li key={layer.id}>
              <span className="geolibre-layers__name">{layer.name}</span>
              <span className="geolibre-layers__meta">{layer.type} · {layer.visible ? "visible" : "hidden"}</span>
            </li>
          ))}
          {layers.length === 0 && <li className="tracking-note">The framed project exposes no layers yet.</li>}
        </ul>
      )}
      <iframe
        ref={iframeRef}
        src={url}
        title="GeoLibre geospatial analysis (pilot)"
        className="geolibre-frame"
        sandbox="allow-scripts allow-same-origin"
      />
    </section>
  );
}
