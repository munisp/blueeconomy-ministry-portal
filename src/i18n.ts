import { useSyncExternalStore } from "react";

/**
 * i18n skeleton: real EN/FR resource dictionaries with a reactive language
 * switcher. This is a deliberately small, dependency-free architecture —
 * dictionaries are typed against the English source of truth so a missing
 * French key is a compile error, never a runtime surprise. Untranslated
 * additions fall back to English with a console-free, explicit fallback
 * path (no fake machine translation anywhere).
 */

export const SUPPORTED_LANGUAGES = ["en", "fr"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  fr: "Français",
};

const STORAGE_KEY = "ministry-portal.language";

/** English resource bundle — the source of truth for the key catalogue. */
const EN = {
  "masthead.ministry": "Federal Ministry Marine and Blue Economy",
  "masthead.description": "Executive oversight surface for authorised, interoperable Blue Economy services.",
  "session.authenticated": "Authenticated session",
  "session.required": "Authentication required",
  "session.signIn": "Sign in",
  "session.signOut": "Sign out",
  "session.signInAgain": "Sign in again",
  "nav.aria": "Portal sections",
  "nav.administration": "Administration",
  "nav.kpiPack": "Ministerial KPI pack",
  "nav.executive": "Executive",
  "nav.operational": "Operational KPIs",
  "nav.trade": "Trade analytics",
  "nav.risk": "Risk model",
  "nav.sla": "SLA breaches",
  "nav.customs": "Customs / NCS–NRS",
  "nav.briefing": "Weekly briefing",
  "nav.portPerformance": "Port performance",
  "nav.geoHeatmap": "Congestion heatmap",
  "nav.congestionForecast": "Congestion forecast",
  "nav.transparency": "Transparency",
  "nav.incidentSar": "Incident / SAR",
  "nav.lockedTitle": "Requires a ministerial oversight role",
  "language.label": "Language",
  "gate.integrationActive": "Integration gate active",
  "gate.backendNotConfigured": "Dashboard backend is not configured",
  "gate.roleRequired": "A ministerial oversight role is required",
  "gate.signInRequired": "Sign in through the approved identity authority",
  "geo.notConfigured": "Geospatial service is not configured",
  "geo.notConfiguredDetail":
    "The approved service registry does not define a geo-service origin. This surface fails closed: no map data is fetched and no substitute endpoint has been assumed.",
  "geo.staleData": "Stale data",
  "geo.liveData": "Live",
  "geo.lastUpdated": "Last updated",
  "heatmap.title": "Port congestion & vessel density heatmap",
  "heatmap.vesselsInView": "vessels in view",
  "heatmap.tileNotice":
    "Base-map tiles are not configured for this deployment. Vessel positions are drawn over a reference grid only; no third-party tile host has been assumed.",
  "forecast.title": "Port congestion forecast",
  "forecast.modelNotDeployed": "Forecast not available for this port",
  "forecast.modelDisclaimer": "Model disclaimer",
  "forecast.backtest": "Backtest accuracy",
  "sar.title": "Incident / SAR mode",
  "sar.liveAlerts": "Live SOS alerts",
  "sar.noLiveAlerts": "No live SOS alerts",
  "sar.acknowledge": "Acknowledge",
  "sar.resolve": "Resolve",
  "sar.clearanceDenied":
    "The geo-service refused the request (HTTP 403). The SOS ledger requires RESTRICTED clearance and a geo-sos role; your session does not carry them. No alerts are displayed.",
  "transparency.title": "Public transparency dashboard",
  "transparency.signedProvenance": "Signed-data provenance",
  "transparency.unsigned": "No signed envelope accompanied this payload; provenance could not be established.",
} as const;

export type TranslationKey = keyof typeof EN;

/** French resource bundle — must cover every English key (typed). */
const FR: Record<TranslationKey, string> = {
  "masthead.ministry": "Ministère fédéral de la Marine et de l'Économie bleue",
  "masthead.description": "Surface de supervision exécutive pour les services autorisés et interopérables de l'économie bleue.",
  "session.authenticated": "Session authentifiée",
  "session.required": "Authentification requise",
  "session.signIn": "Se connecter",
  "session.signOut": "Se déconnecter",
  "session.signInAgain": "Se reconnecter",
  "nav.aria": "Sections du portail",
  "nav.administration": "Administration",
  "nav.kpiPack": "Paquet d'indicateurs ministériels",
  "nav.executive": "Exécutif",
  "nav.operational": "Indicateurs opérationnels",
  "nav.trade": "Analyse du commerce",
  "nav.risk": "Modèle de risque",
  "nav.sla": "Violations de SLA",
  "nav.customs": "Douanes / NCS–NRS",
  "nav.briefing": "Briefing hebdomadaire",
  "nav.portPerformance": "Performance portuaire",
  "nav.geoHeatmap": "Carte de congestion",
  "nav.congestionForecast": "Prévision de congestion",
  "nav.transparency": "Transparence",
  "nav.incidentSar": "Incident / SAR",
  "nav.lockedTitle": "Nécessite un rôle de supervision ministérielle",
  "language.label": "Langue",
  "gate.integrationActive": "Barrière d'intégration active",
  "gate.backendNotConfigured": "Le backend des tableaux de bord n'est pas configuré",
  "gate.roleRequired": "Un rôle de supervision ministérielle est requis",
  "gate.signInRequired": "Connectez-vous via l'autorité d'identité approuvée",
  "geo.notConfigured": "Le service géospatial n'est pas configuré",
  "geo.notConfiguredDetail":
    "Le registre de services approuvés ne définit pas d'origine geo-service. Cette surface échoue en mode fermé : aucune donnée cartographique n'est récupérée et aucun point de terminaison de substitution n'a été supposé.",
  "geo.staleData": "Données obsolètes",
  "geo.liveData": "En direct",
  "geo.lastUpdated": "Dernière mise à jour",
  "heatmap.title": "Carte thermique de congestion portuaire et de densité des navires",
  "heatmap.vesselsInView": "navires en vue",
  "heatmap.tileNotice":
    "Les tuiles de fond de carte ne sont pas configurées pour ce déploiement. Les positions des navires sont affichées sur une grille de référence uniquement ; aucun hôte de tuiles tiers n'a été supposé.",
  "forecast.title": "Prévision de congestion portuaire",
  "forecast.modelNotDeployed": "Prévision indisponible pour ce port",
  "forecast.modelDisclaimer": "Avertissement du modèle",
  "forecast.backtest": "Précision du backtest",
  "sar.title": "Mode incident / SAR",
  "sar.liveAlerts": "Alertes SOS actives",
  "sar.noLiveAlerts": "Aucune alerte SOS active",
  "sar.acknowledge": "Accuser réception",
  "sar.resolve": "Résoudre",
  "sar.clearanceDenied":
    "Le service géospatial a refusé la requête (HTTP 403). Le registre SOS exige une habilitation RESTRICTED et un rôle geo-sos ; votre session ne les possède pas. Aucune alerte n'est affichée.",
  "transparency.title": "Tableau de bord public de transparence",
  "transparency.signedProvenance": "Provenance des données signées",
  "transparency.unsigned": "Aucune enveloppe signée n'accompagnait cette charge utile ; la provenance n'a pas pu être établie.",
};

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { en: EN, fr: FR };

let currentLanguage: Language = detectInitialLanguage();
const listeners = new Set<() => void>();

function detectInitialLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "fr") {
      return stored;
    }
    const navigatorLanguage = window.navigator.language?.slice(0, 2);
    if (navigatorLanguage === "fr") {
      return "fr";
    }
  } catch {
    // storage/navigation unavailable (tests, locked-down browsers) — default below
  }
  return "en";
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(language: Language): void {
  if (language === currentLanguage) {
    return;
  }
  currentLanguage = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // persistence is best-effort; the switch still applies for the session
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Translate a key in the active language. Falls back to English when a
 * language bundle somehow lacks the key (typed dictionaries make this
 * unreachable in practice; the fallback keeps the architecture honest).
 */
export function translate(key: TranslationKey, language: Language = currentLanguage): string {
  return DICTIONARIES[language][key] ?? EN[key];
}

export function useTranslation(): { language: Language; t: (key: TranslationKey) => string; setLanguage: (language: Language) => void } {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage);
  return { language, t: (key) => translate(key, language), setLanguage };
}

/** Test hook: restore the default language without touching storage. */
export function resetLanguageForTests(): void {
  currentLanguage = "en";
}
