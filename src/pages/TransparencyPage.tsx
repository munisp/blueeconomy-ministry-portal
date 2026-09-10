import { useCallback } from "react";
import { useApiData } from "../hooks/useApiData";
import { DashboardFrame, KpiCard, KpiGrid, formatNumber } from "../components/dashboard";
import { useTranslation } from "../i18n";
import { fetchTransparencyView } from "../transparency";
import type { DashboardPageProps } from "./props";

/**
 * Public transparency dashboard (#13): a read-only aggregated view of the
 * real port-performance report (throughput, TEU, transshipment, vessel
 * calls) plus signed-data provenance. When the backend's signed export
 * envelope carries a JWS, its header metadata (alg, kid) is displayed so
 * consumers can anchor verification at the published signing key; unsigned
 * payloads are labelled unsigned. Totals are sums of backend-reported
 * figures only — null legs yield an honest "no data" card, never a guess.
 *
 * Role gate: any ministerial dashboard role (fmmbe-oversight / auditor /
 * platform-admin) — intentionally broader than the platform-admin-only
 * port-performance page, since this surface is the public-accountability
 * view. Backend authorisation remains authoritative.
 */
export function TransparencyPage({ baseUrl, token }: DashboardPageProps) {
  const { t } = useTranslation();
  const loader = useCallback(
    () => (token === null ? Promise.reject(new Error("authentication required")) : fetchTransparencyView(baseUrl, token)),
    [baseUrl, token],
  );
  const { state, reload } = useApiData(token === null ? null : loader);

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Accountability</p>
          <h2>{t("transparency.title")}</h2>
        </div>
        <p className="section-note">
          Aggregated quarterly totals from the signed port-performance reporting pipeline. Figures marked unavailable
          had no underlying records for the period; nothing is estimated.
        </p>
      </div>

      <DashboardFrame state={state} loadingLabel="Aggregating transparency totals" onRetry={reload}>
        {(view) => (
          <>
            <p className="dashboard-period">
              {view.totals.period} — period: {view.totals.periodStart} → {view.totals.periodEnd} (generated {view.totals.generatedAt})
            </p>
            <KpiGrid>
              {view.totals.cargoThroughputTonnes === null ? (
                <KpiCard label="Total cargo throughput" value="No data available for this period" tone="warning" />
              ) : (
                <KpiCard label="Total cargo throughput" value={`${formatNumber(view.totals.cargoThroughputTonnes)} tonnes`} />
              )}
              {view.totals.teuTotal === null ? (
                <KpiCard label="TEU throughput (in + out)" value="No data available for this period" tone="warning" />
              ) : (
                <KpiCard label="TEU throughput (in + out)" value={`${formatNumber(view.totals.teuTotal)} TEU`} />
              )}
              {view.totals.transshipmentTeu === null ? (
                <KpiCard label="Transshipment volume" value="No data available for this period" tone="warning" />
              ) : (
                <KpiCard label="Transshipment volume" value={`${formatNumber(view.totals.transshipmentTeu)} TEU`} />
              )}
              {view.totals.vesselCalls === null ? (
                <KpiCard label="Vessel calls" value="No data available for this period" tone="warning" />
              ) : (
                <KpiCard label="Vessel calls" value={formatNumber(view.totals.vesselCalls)} />
              )}
            </KpiGrid>

            <div className="briefing-panel">
              <h3>{t("transparency.signedProvenance")}</h3>
              {view.provenance === null ? (
                <p className="section-note" role="status">{t("transparency.unsigned")}</p>
              ) : (
                <p className="briefing-evidence">
                  Payload carries a compact JWS signature (algorithm: {view.provenance.algorithm ?? "not declared"}
                  {view.provenance.keyId !== null ? `, signing key id (kid): ${view.provenance.keyId}` : ", no kid declared"})
                  — cryptographic verification is anchored at the backend signing key.
                </p>
              )}
              <p className="section-note">
                Data sources: {view.totals.sources.join(" · ")}
              </p>
            </div>
          </>
        )}
      </DashboardFrame>
    </section>
  );
}
