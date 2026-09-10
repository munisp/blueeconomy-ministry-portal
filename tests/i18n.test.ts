import assert from "node:assert/strict";
import test from "node:test";

import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  getLanguage,
  resetLanguageForTests,
  setLanguage,
  subscribeLanguage,
  translate,
  type TranslationKey,
} from "../src/i18n.ts";

// The English bundle is the typed source of truth; import it indirectly by
// exercising translate() across every key used by the shell.
const SHELL_KEYS: TranslationKey[] = [
  "masthead.ministry",
  "masthead.description",
  "session.authenticated",
  "session.required",
  "session.signIn",
  "session.signOut",
  "nav.aria",
  "nav.administration",
  "nav.kpiPack",
  "nav.executive",
  "nav.operational",
  "nav.trade",
  "nav.risk",
  "nav.sla",
  "nav.customs",
  "nav.briefing",
  "nav.portPerformance",
  "nav.geoHeatmap",
  "nav.congestionForecast",
  "nav.transparency",
  "nav.incidentSar",
  "language.label",
];

test("every supported language defines every shell key (parity, no fake translator)", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of SHELL_KEYS) {
      const value = translate(key, language);
      assert.ok(typeof value === "string" && value.length > 0, `${language}.${key} must be translated`);
    }
  }
});

test("English and French actually differ for shell chrome", () => {
  assert.notEqual(translate("nav.executive", "en"), translate("nav.executive", "fr"));
  assert.notEqual(translate("session.signIn", "en"), translate("session.signIn", "fr"));
});

test("language switch notifies subscribers and is readable globally", () => {
  resetLanguageForTests();
  assert.equal(getLanguage(), "en");
  let notified = 0;
  const unsubscribe = subscribeLanguage(() => {
    notified += 1;
  });
  setLanguage("fr");
  assert.equal(getLanguage(), "fr");
  assert.equal(notified, 1);
  setLanguage("fr"); // no-op: no redundant notification
  assert.equal(notified, 1);
  unsubscribe();
  setLanguage("en");
  assert.equal(notified, 1);
});

test("language labels are native names", () => {
  assert.equal(LANGUAGE_LABELS.en, "English");
  assert.equal(LANGUAGE_LABELS.fr, "Français");
});
