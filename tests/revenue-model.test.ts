import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENCIES,
  agenciesWithoutRates,
  assessmentProvenance,
  bookingReceiptProvenance,
  describeProvenance,
  exemptionAuditsProvenance,
  filterLinesByAgency,
  filterRatesByAgency,
  isRevenueReader,
  monthBuckets,
  resolveDateRange,
  REVENUE_READER_ROLES,
  settlementReportProvenance,
  subsidyReportProvenance,
  subsidySharePercent,
  summarizeRatesByAgency,
  sumSubsidyLines,
  tariffRatesProvenance,
  type AssessmentLine,
  type DateRange,
  type SubsidyLine,
  type TariffRateRow,
} from "../src/revenue/revenue-model.ts";

function rateRow(overrides: Partial<TariffRateRow> = {}): TariffRateRow {
  return {
    RateID: "rate-1",
    Instrument: "NPA_SHIP_DUES",
    Agency: "NPA",
    BandLogic: "PER_GRT_BAND",
    Currency: "USD",
    RateMinorPerUnit: 320,
    RateBps: 0,
    BandFloor: 0,
    BandCeiling: null,
    StatutoryReference: "NPA Act s.12",
    Provisional: false,
    EffectiveFrom: "2026-01-01T00:00:00Z",
    EffectiveTo: null,
    State: "ACTIVE",
    Maker: "officer-a",
    Checker: "officer-b",
    ...overrides,
  };
}

function assessmentLine(overrides: Partial<AssessmentLine> = {}): AssessmentLine {
  return {
    lineNo: 1,
    instrument: "NPA_SHIP_DUES",
    agency: "NPA",
    applicability: "CHARGED",
    basis: "basis",
    amountMinor: 100,
    currency: "USD",
    ...overrides,
  };
}

/* Agency filter logic: the agency dimension comes from data fields only. */

test("agency filter: ALL preserves every row including unknown agency codes", () => {
  const rates = [rateRow(), rateRow({ RateID: "r2", Agency: "NIMASA", Instrument: "SEA_PROTECTION_LEVY_2012" }), rateRow({ RateID: "r3", Agency: "SPL" })];
  assert.equal(filterRatesByAgency(rates, "ALL").length, 3);
});

test("agency filter: a specific agency keeps only rows whose data carries that agency", () => {
  const rates = [rateRow(), rateRow({ RateID: "r2", Agency: "NIMASA" }), rateRow({ RateID: "r3", Agency: "NIWA" })];
  const filtered = filterRatesByAgency(rates, "NIMASA");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].RateID, "r2");
  assert.equal(filterRatesByAgency(rates, "CBN").length, 0);
});

test("agency filter: assessment lines filter on the data agency field", () => {
  const lines = [assessmentLine(), assessmentLine({ lineNo: 2, agency: "NIMASA" }), assessmentLine({ lineNo: 3, agency: "NIMASA" })];
  assert.equal(filterLinesByAgency(lines, "NIMASA").length, 2);
  assert.equal(filterLinesByAgency(lines, "ALL").length, 3);
});

test("agency summaries: agencies with no observed rows are absent (never zero-filled) and reported as no-data", () => {
  const rates = [rateRow(), rateRow({ RateID: "r2", Agency: "NPA", State: "DRAFT", Provisional: true }), rateRow({ RateID: "r3", Agency: "NIWA", Instrument: "NIWA_INLAND_CHARGE" })];
  const summaries = summarizeRatesByAgency(rates);
  assert.deepEqual(summaries.map((summary) => summary.agency), ["NPA", "NIWA"]);
  const npa = summaries[0];
  assert.equal(npa.rateCount, 2);
  assert.equal(npa.activeCount, 1);
  assert.equal(npa.provisionalCount, 1);
  assert.deepEqual(agenciesWithoutRates(rates), ["NIMASA", "FMMBE", "CBN"]);
});

test("agency list: CBN is tracked but has no data-producing endpoint (gap card, not figures)", () => {
  assert.ok(AGENCIES.includes("CBN"));
  assert.deepEqual(agenciesWithoutRates([]), [...AGENCIES]);
});

/* Date-range handling: inclusive UI range to exclusive upstream window. */

test("date range: the upstream `to` is exclusive — one day is added to the inclusive end", () => {
  const range = resolveDateRange("2026-08-01", "2026-08-31");
  assert.deepEqual(range, { from: "2026-08-01", toInclusive: "2026-08-31", toExclusive: "2026-09-01" });
});

test("date range: month rollover and invalid inputs fail closed", () => {
  assert.deepEqual((resolveDateRange("2026-12-15", "2026-12-31") as DateRange).toExclusive, "2027-01-01");
  assert.equal(typeof resolveDateRange("2026-08-01", "2026-07-31"), "string");
  assert.equal(typeof resolveDateRange("08/01/2026", "2026-08-31"), "string");
  assert.equal(typeof resolveDateRange("2026-13-01", "2026-12-31"), "string");
});

test("month buckets: a multi-month range splits at calendar boundaries with exclusive ends", () => {
  const range = resolveDateRange("2026-07-20", "2026-09-05") as DateRange;
  const buckets = monthBuckets(range);
  assert.deepEqual(buckets, [
    { label: "2026-07", from: "2026-07-20", toExclusive: "2026-08-01" },
    { label: "2026-08", from: "2026-08-01", toExclusive: "2026-09-01" },
    { label: "2026-09", from: "2026-09-01", toExclusive: "2026-09-06" },
  ]);
});

test("month buckets: a single-day range yields one bucket ending the next day", () => {
  const range = resolveDateRange("2026-08-14", "2026-08-14") as DateRange;
  assert.deepEqual(monthBuckets(range), [{ label: "2026-08", from: "2026-08-14", toExclusive: "2026-08-15" }]);
});

/* Subsidy aggregation honesty. */

test("subsidy totals: sums are exact integer minor units", () => {
  const lines: SubsidyLine[] = [
    { routeReference: "A", rides: 3, standardFareNgnMinor: 1000, chargedNgnMinor: 700, subsidyNgnMinor: 300 },
    { routeReference: "B", rides: 2, standardFareNgnMinor: 500, chargedNgnMinor: 500, subsidyNgnMinor: 0 },
  ];
  assert.deepEqual(sumSubsidyLines(lines), { rides: 5, standardFareNgnMinor: 1500, chargedNgnMinor: 1200, subsidyNgnMinor: 300 });
  assert.deepEqual(sumSubsidyLines([]), { rides: 0, standardFareNgnMinor: 0, chargedNgnMinor: 0, subsidyNgnMinor: 0 });
});

test("subsidy share: null when there were no capped journeys (never a fabricated 0%)", () => {
  assert.equal(subsidySharePercent({ rides: 0, standardFareNgnMinor: 0, chargedNgnMinor: 0, subsidyNgnMinor: 0 }), null);
  assert.equal(subsidySharePercent({ rides: 4, standardFareNgnMinor: 2000, chargedNgnMinor: 1500, subsidyNgnMinor: 500 }), 25);
});

/* Role gate mirrors the ferry report route policy. */

test("revenue reader gate: report-reader roles pass, unrelated roles do not", () => {
  for (const role of REVENUE_READER_ROLES) {
    assert.equal(isRevenueReader(new Set([role])), true, role);
  }
  assert.equal(isRevenueReader(new Set(["passenger"])), false);
  assert.equal(isRevenueReader(new Set()), false);
});

/* Provenance: every figure names its exact upstream call. */

test("provenance links: subsidy and settlement paths match the recorded ferry endpoints", () => {
  assert.equal(
    describeProvenance(subsidyReportProvenance("2026-08-01", "2026-09-01")),
    "ferry-ticketing GET /v1/reports/subsidy?from=2026-08-01&to=2026-09-01",
  );
  assert.equal(
    describeProvenance(settlementReportProvenance("lagos-ferry-co", "2026-08-01", "2026-09-01")),
    "ferry-ticketing GET /v1/reports/settlement?operatorId=lagos-ferry-co&from=2026-08-01&to=2026-09-01",
  );
});

test("provenance links: tariff and booking paths match the recorded upstream endpoints", () => {
  assert.equal(describeProvenance(tariffRatesProvenance()), "financial-controls GET /v1/tariffs/rates");
  assert.equal(
    describeProvenance(assessmentProvenance("abc-1")),
    "financial-controls GET /v1/tariffs/assessments/abc-1",
  );
  assert.equal(
    describeProvenance(exemptionAuditsProvenance("abc-1")),
    "financial-controls GET /v1/tariffs/assessments/abc-1/exemption-audits",
  );
  assert.equal(
    describeProvenance(bookingReceiptProvenance("booking/1")),
    "port-interoperability GET /v1/bookings/booking%2F1",
  );
});
