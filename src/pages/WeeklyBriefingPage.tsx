import { useState } from "react";
import { fetchWeeklyBriefing } from "../kpi-client";
import { ApiError } from "../api-client";
import { KPI_ENDPOINTS } from "../kpi-client";
import type { DashboardPageProps } from "./props";

type BriefingState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; filename: string; signature: string; algorithm: string | null }
  | { kind: "error"; error: string };

/**
 * Weekly ministerial briefing: requests a JWS-signed PDF from the backend.
 * Fail-closed: when the endpoint is absent (404) or the signature is missing
 * or malformed, an error state is rendered and no document is produced.
 */
export function WeeklyBriefingPage({ baseUrl, token }: DashboardPageProps) {
  const [state, setState] = useState<BriefingState>({ kind: "idle" });

  async function requestBriefing(): Promise<void> {
    if (token === null) {
      setState({ kind: "error", error: "authentication required" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const briefing = await fetchWeeklyBriefing(baseUrl, token);
      if (briefing.signature === null) {
        throw new ApiError("invalid-payload", "backend returned an unsigned briefing; refusing to present it");
      }
      const url = URL.createObjectURL(briefing.blob);
      const anchor = document.createElement("a");
      const filename = `ministerial-weekly-briefing-${new Date().toISOString().slice(0, 10)}.pdf`;
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setState({ kind: "ready", filename, signature: briefing.signature, algorithm: briefing.signatureAlgorithm });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setState({
          kind: "error",
          error: `The weekly briefing endpoint (GET ${KPI_ENDPOINTS.weeklyBriefing}) is not available on the approved backend (HTTP 404). No briefing has been generated locally.`,
        });
      } else {
        setState({ kind: "error", error: error instanceof Error ? error.message : "briefing request failed" });
      }
    }
  }

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Weekly briefing</p>
          <h2>JWS-signed ministerial briefing</h2>
        </div>
        <p className="section-note">Requests the signed PDF briefing from the backend. Unsigned or malformed responses are refused.</p>
      </div>
      <div className="briefing-panel">
        <p>
          The briefing is compiled and digitally signed (JWS) by the platform backend. This portal never assembles
          briefing content itself; if the backend endpoint is unavailable the request fails closed.
        </p>
        <button
          className="button"
          disabled={token === null || state.kind === "loading"}
          onClick={() => void requestBriefing()}
        >
          {state.kind === "loading" ? "Requesting signed briefing…" : token === null ? "Sign in to request briefing" : "Request signed weekly briefing"}
        </button>
        {state.kind === "ready" && (
          <p className="briefing-evidence" aria-live="polite">
            Downloaded {state.filename}. JWS signature present ({state.algorithm ?? "algorithm not declared"}),{" "}
            {state.signature.split(".")[0].length > 0 ? "compact serialisation" : ""} — cryptographic verification is
            anchored at the backend signing key.
          </p>
        )}
        {state.kind === "error" && (
          <div className="empty-state empty-state--alert" role="alert">
            <p className="eyebrow">Briefing unavailable</p>
            <pre>{state.error}</pre>
          </div>
        )}
      </div>
    </section>
  );
}
