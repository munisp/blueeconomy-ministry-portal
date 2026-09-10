import { useCallback, useState } from "react";
import { useApiData } from "../hooks/useApiData";
import { DashboardFrame, KpiCard, KpiGrid } from "../components/dashboard";
import { useTranslation } from "../i18n";
import {
  GeoApiError,
  fetchCongestionForecast,
  parseInsufficientHistory,
  type CongestionForecastResult,
  type InsufficientHistory,
} from "../geo-client";
import type { DashboardPageProps } from "./props";

/**
 * Ports with governed anchor/observation registries in the geo-service
 * (blueeconomy-geo-service `portAnchors`). Operators can query any other
 * 5-letter UN/LOCODE via the input; the backend answers honestly with
 * INSUFFICIENT_HISTORY when no queue series exists.
 */
const KNOWN_PORTS: readonly { code: string; label: string }[] = [
  { code: "KEMBA", label: "Mombasa" },
  { code: "KEKIS", label: "Kisumu" },
  { code: "TZDAR", label: "Dar es Salaam" },
];

const HORIZONS = [24, 48, 72] as const;

type ForecastState =
  | { kind: "result"; result: CongestionForecastResult }
  | { kind: "insufficient"; detail: InsufficientHistory };

/**
 * Per-port congestion forecast cards (#11), consuming the geo-service
 * baseline forecast endpoint. The backend's honest refusals are first-class:
 * HTTP 409 INSUFFICIENT_HISTORY renders a "forecast not available" card
 * naming the recorded observation count — never a synthetic curve. The
 * backend's own model disclaimer and backtest scores are displayed verbatim.
 */
export function CongestionForecastPage({ geoBaseUrl, token }: DashboardPageProps) {
  const { t } = useTranslation();
  const [portCode, setPortCode] = useState<string>("KEMBA");
  const [customCode, setCustomCode] = useState("");
  const [horizon, setHorizon] = useState<number>(24);

  const loader = useCallback(async (): Promise<ForecastState> => {
    if (geoBaseUrl === null || token === null) {
      throw new GeoApiError("not-configured", "geo-service origin or authentication token is missing");
    }
    try {
      return { kind: "result", result: await fetchCongestionForecast(geoBaseUrl, token, portCode, horizon) };
    } catch (error) {
      if (error instanceof GeoApiError && (error.status === 409 || error.status === 503)) {
        const detail = parseInsufficientHistory(error.payload);
        if (detail !== null) {
          return { kind: "insufficient", detail };
        }
      }
      throw error;
    }
  }, [geoBaseUrl, token, portCode, horizon]);

  const { state, reload } = useApiData(geoBaseUrl === null || token === null ? null : loader);

  if (geoBaseUrl === null) {
    return (
      <section className="empty-state empty-state--alert" role="alert">
        <p className="eyebrow">{t("gate.integrationActive")}</p>
        <h2>{t("geo.notConfigured")}</h2>
        <p>{t("geo.notConfiguredDetail")}</p>
      </section>
    );
  }

  function applyCustomCode(): void {
    const code = customCode.trim().toUpperCase();
    if (/^[A-Z]{5}$/.test(code)) {
      setPortCode(code);
    }
  }

  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Geospatial</p>
          <h2>{t("forecast.title")}</h2>
        </div>
        <p className="section-note">
          Baseline queue-length forecast from recorded port observations. The backend labels this as a statistical
          baseline, not an ML model; ports without recorded history return an explicit refusal.
        </p>
      </div>

      <div className="briefing-panel">
        <div className="period-selector" role="group" aria-label="Port">
          {KNOWN_PORTS.map((port) => (
            <button
              key={port.code}
              className={`button ${port.code === portCode ? "" : "button--quiet"}`}
              aria-pressed={port.code === portCode}
              onClick={() => setPortCode(port.code)}
            >
              {port.label} ({port.code})
            </button>
          ))}
        </div>
        <div className="period-selector" role="group" aria-label="Forecast horizon">
          {HORIZONS.map((hours) => (
            <button
              key={hours}
              className={`button ${hours === horizon ? "" : "button--quiet"}`}
              aria-pressed={hours === horizon}
              onClick={() => setHorizon(hours)}
            >
              {hours}h
            </button>
          ))}
          <input
            aria-label="Custom UN/LOCODE"
            placeholder="UN/LOCODE"
            value={customCode}
            onChange={(event) => setCustomCode(event.target.value.toUpperCase().slice(0, 5))}
          />
          <button className="button button--outline" onClick={applyCustomCode} disabled={!/^[A-Z]{5}$/.test(customCode.trim())}>
            Query port
          </button>
        </div>

        <DashboardFrame state={state} loadingLabel={`Forecasting queue length for ${portCode}`} onRetry={reload}>
          {(outcome) => {
            if (outcome.kind === "insufficient") {
              return (
                <div className="empty-state" role="status">
                  <p className="eyebrow">{t("forecast.modelNotDeployed")}</p>
                  <h2>{portCode}</h2>
                  <p>
                    The geo-service refused to forecast: {outcome.detail.error}. Recorded queue observations for this
                    port: {outcome.detail.recordedObservations}
                    {outcome.detail.model !== "" ? ` — model identity: ${outcome.detail.model}` : ""}. No synthetic
                    forecast is shown.
                  </p>
                </div>
              );
            }
            const { result } = outcome;
            const { forecast } = result;
            const peak = forecast.points.reduce((max, point) => (point.queueLength > max.queueLength ? point : max), forecast.points[0]);
            return (
              <>
                <KpiGrid>
                  <KpiCard label="Model" value={forecast.model} detail={`trained on ${forecast.trainedOn} recorded observations`} />
                  <KpiCard
                    label={`Peak predicted queue (${horizon}h)`}
                    value={peak === undefined ? "No forecast points" : `${peak.queueLength.toFixed(1)} vessels`}
                    detail={peak === undefined ? undefined : `at ${new Date(peak.atUnix * 1000).toLocaleString()} (80% PI ${peak.lower80.toFixed(1)}–${peak.upper80.toFixed(1)})`}
                  />
                  <KpiCard
                    label={t("forecast.backtest")}
                    value={`MAE ${forecast.backtestMAE.toFixed(2)} / MAPE ${forecast.backtestMAPE.toFixed(1)}%`}
                    detail={`seasonal-naive reference: MAE ${forecast.backtestNaiveMAE.toFixed(2)} / MAPE ${forecast.backtestNaiveMAPE.toFixed(1)}%`}
                  />
                  <KpiCard
                    label="Provenance"
                    value={result.provenance?.stale ? t("geo.staleData") : t("geo.liveData")}
                    detail={result.provenance?.staleNote ?? `source: ${result.provenance?.source ?? "port_queue_observations"}, as of ${result.provenance?.asOf ?? "unknown"}`}
                    tone={result.provenance?.stale ? "warning" : "success"}
                  />
                </KpiGrid>
                <p className="section-note">
                  {t("forecast.modelDisclaimer")}: {result.modelDisclaimer}
                </p>
                <table className="forecast-table">
                  <caption>Hourly predicted queue length with prediction intervals</caption>
                  <thead>
                    <tr>
                      <th scope="col">Time (UTC)</th>
                      <th scope="col">Queue</th>
                      <th scope="col">80% interval</th>
                      <th scope="col">95% interval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.points.slice(0, 24).map((point) => (
                      <tr key={point.step}>
                        <td>{new Date(point.atUnix * 1000).toISOString().slice(0, 16)}</td>
                        <td>{point.queueLength.toFixed(1)}</td>
                        <td>{point.lower80.toFixed(1)} – {point.upper80.toFixed(1)}</td>
                        <td>{point.lower95.toFixed(1)} – {point.upper95.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          }}
        </DashboardFrame>
      </div>
    </section>
  );
}
