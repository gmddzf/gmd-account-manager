import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUsageBaseUrlCandidates,
  classifyModelProviderUsageError,
  formatLocalUsageDay,
  formatModelProviderUsageMoney,
  applyNewApiDailyBalanceSnapshot,
  resolveKnownGmdRelayUsageIntegrationType,
  resolveNewApiQuotaSnapshot,
  resolveModelProviderUsageMode,
  updateNewApiDailyBalance,
  type ModelProviderUsageSummary,
} from "./modelProviderUsageService.ts";

function summary(
  partial: Partial<ModelProviderUsageSummary>,
): ModelProviderUsageSummary {
  return {
    modelStatsCount: 0,
    latencyMs: 0,
    ...partial,
  };
}

test("usage lookup tries a root provider URL before its /v1 fallback", () => {
  assert.deepEqual(
    buildUsageBaseUrlCandidates("https://sub2api.example.com/"),
    ["https://sub2api.example.com/", "https://sub2api.example.com/v1"],
  );
});

test("usage lookup does not rewrite providers with an explicit path", () => {
  assert.deepEqual(
    buildUsageBaseUrlCandidates("https://sub2api.example.com/api"),
    ["https://sub2api.example.com/api"],
  );
});

test("new_api quota prefers billing currency over raw token allocation details", () => {
  const snapshot = resolveNewApiQuotaSnapshot(
    summary({
      mode: "new_api",
      quotaLimit: 100,
      quotaRemaining: 80,
      details: [
        { key: "totalGranted", label: "Granted", value: "250" },
        { key: "totalAvailable", label: "Available", value: "175.5" },
        { key: "expiresAt", label: "Expires", value: "1800000000" },
      ],
    }),
  );

  assert.deepEqual(snapshot, {
    granted: 100,
    available: 80,
    expiresAt: 1800000000,
  });
});

test("new_api quota falls back to billing limits when token allocation is absent", () => {
  const snapshot = resolveNewApiQuotaSnapshot(
    summary({
      mode: "new_api",
      quotaLimit: 1849,
      quotaRemaining: 1610,
      details: [
        { key: "hardLimitUsd", label: "Hard Limit", value: "1849" },
        { key: "accessUntil", label: "Access Until", value: "1815609561" },
        { key: "totalUsage", label: "Total Usage", value: "23900" },
      ],
    }),
  );

  assert.deepEqual(snapshot, {
    granted: 1849,
    available: 1610,
    expiresAt: 1815609561,
  });
});

test("new_api quota ignores malformed numeric details", () => {
  const snapshot = resolveNewApiQuotaSnapshot(
    summary({
      mode: "new_api",
      quotaLimit: 75,
      quotaRemaining: 25,
      details: [
        { key: "totalGranted", label: "Granted", value: "unlimited" },
        { key: "totalAvailable", label: "Available", value: "" },
        { key: "expiresAt", label: "Expires", value: "never" },
      ],
    }),
  );

  assert.deepEqual(snapshot, {
    granted: 75,
    available: 25,
    expiresAt: null,
  });
});

test("token plan percentages render without currency decimals", () => {
  assert.equal(formatModelProviderUsageMoney(72, "%"), "72%");
});

test("known GMD relay hosts resolve to their direct billing contracts", () => {
  assert.equal(
    resolveKnownGmdRelayUsageIntegrationType("https://api.gmd.ink/v1"),
    "new_api",
  );
  assert.equal(
    resolveKnownGmdRelayUsageIntegrationType("https://subapi.gmd.ink/"),
    "sub2api",
  );
});

test("relay usage detection does not probe lookalike or arbitrary hosts", () => {
  assert.equal(
    resolveKnownGmdRelayUsageIntegrationType("https://api.gmd.ink.example.com"),
    null,
  );
  assert.equal(
    resolveKnownGmdRelayUsageIntegrationType("https://example.com/v1"),
    null,
  );
  assert.equal(resolveKnownGmdRelayUsageIntegrationType("not a url"), null);
});

test("today balance cost identifies a provider usage summary", () => {
  assert.equal(
    resolveModelProviderUsageMode(
      summary({ todayCost: 1.25, unit: "USD" }),
    ),
    "sub2api",
  );
  assert.equal(formatModelProviderUsageMoney(1.25, "USD"), "$1.25");
});

test("classifies provider failures without exposing upstream response text", () => {
  assert.equal(classifyModelProviderUsageError("PROVIDER_USAGE_HTTP_401"), "authorization");
  assert.equal(classifyModelProviderUsageError("PROVIDER_USAGE_HTTP_503: Presentation data is temporarily unavailable"), "unavailable");
  assert.equal(classifyModelProviderUsageError("PROVIDER_USAGE_NETWORK_FAILED: timeout"), "network");
});

test("new_api daily balance starts with a baseline instead of backfilling unknown spend", () => {
  const update = updateNewApiDailyBalance(
    null,
    100,
    "2026-08-21",
    100,
  );

  assert.equal(update.todayCost, 0);
  assert.deepEqual(update.state, {
    day: "2026-08-21",
    lastRemaining: 100,
    consumed: 0,
    sampledAt: 100,
  });
});

test("new_api daily balance accumulates only positive remaining-balance drops", () => {
  const baseline = updateNewApiDailyBalance(null, 100, "2026-08-21", 100);
  const firstSpend = updateNewApiDailyBalance(
    baseline.state,
    92.5,
    "2026-08-21",
    200,
  );
  const secondSpend = updateNewApiDailyBalance(
    firstSpend.state,
    90,
    "2026-08-21",
    300,
  );

  assert.equal(firstSpend.todayCost, 7.5);
  assert.equal(secondSpend.todayCost, 10);
});

test("new_api recharge does not erase observed spend and later spending resumes from the new baseline", () => {
  const spent = updateNewApiDailyBalance(
    updateNewApiDailyBalance(null, 100, "2026-08-21", 100).state,
    90,
    "2026-08-21",
    200,
  );
  const recharged = updateNewApiDailyBalance(
    spent.state,
    120,
    "2026-08-21",
    300,
  );
  const afterRechargeSpend = updateNewApiDailyBalance(
    recharged.state,
    115,
    "2026-08-21",
    400,
  );

  assert.equal(recharged.todayCost, 10);
  assert.equal(afterRechargeSpend.todayCost, 15);
});

test("new_api daily balance resets on a new local day and ignores stale responses", () => {
  const baseline = updateNewApiDailyBalance(null, 100, "2026-08-21", 100);
  const current = updateNewApiDailyBalance(
    baseline.state,
    90,
    "2026-08-21",
    300,
  );
  const stale = updateNewApiDailyBalance(
    current.state,
    80,
    "2026-08-21",
    200,
  );
  const nextDay = updateNewApiDailyBalance(
    current.state,
    80,
    "2026-08-22",
    400,
  );

  assert.equal(stale.todayCost, 10);
  assert.equal(stale.state.lastRemaining, 90);
  assert.equal(nextDay.todayCost, 0);
  assert.equal(formatLocalUsageDay(new Date(2026, 7, 21)), "2026-08-21");
});

test("new_api daily balance keeps an authoritative server today cost when one is supplied", () => {
  const baseline = updateNewApiDailyBalance(
    null,
    100,
    "2026-08-21",
    100,
    3.25,
  );
  const refreshed = updateNewApiDailyBalance(
    baseline.state,
    90,
    "2026-08-21",
    200,
    4.5,
  );

  assert.equal(baseline.todayCost, 3.25);
  assert.equal(refreshed.todayCost, 4.5);
});

test("new_api query snapshots persist currency-balance deltas without reading raw quota units", () => {
  let saved: string | null = null;
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  };
  const identity = "provider:p1:key:k1:rev:1";
  const first = applyNewApiDailyBalanceSnapshot(
    summary({
      mode: "new_api",
      unit: "USD",
      quotaRemaining: 100,
      details: [{ key: "totalAvailable", label: "raw", value: "50000000" }],
    }),
    identity,
    100,
    storage,
  );
  const second = applyNewApiDailyBalanceSnapshot(
    summary({
      mode: "new_api",
      unit: "USD",
      quotaRemaining: 92.5,
      details: [{ key: "totalAvailable", label: "raw", value: "46250000" }],
    }),
    identity,
    200,
    storage,
  );

  assert.equal(first.todayCost, 0);
  assert.equal(second.todayCost, 7.5);
  const persisted = String(saved ?? "");
  assert.ok(persisted.includes(identity));
  assert.ok(!persisted.includes("sk-"));
});
