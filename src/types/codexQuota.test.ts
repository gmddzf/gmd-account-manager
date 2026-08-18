import assert from "node:assert/strict";
import test from "node:test";

import {
  getCodexAdditionalQuotaWindows,
  getCodexSubscriptionPresentationForAccount,
  getCodexQuotaWindowLabel,
  type CodexQuota,
} from "./codex.ts";

const quota: CodexQuota = {
  hourly_percentage: 75,
  weekly_percentage: 40,
  raw_data: {
    additional_rate_limits: [
      {
        limit_name: "gpt-5.3-codex-spark",
        metered_feature: "codex_spark",
        rate_limit: {
          primary_window: {
            used_percent: 35,
            limit_window_seconds: 18_000,
            reset_at: 1_790_000_000,
          },
          secondary_window: {
            used_percent: 60,
            limit_window_seconds: 604_800,
            reset_at: 1_790_500_000,
          },
        },
      },
    ],
  },
};

test("uses 5h / Weekly / N Week window labels", () => {
  assert.equal(getCodexQuotaWindowLabel(300, "hourly"), "5h");
  assert.equal(getCodexQuotaWindowLabel(10_080, "weekly"), "Weekly");
  assert.equal(getCodexQuotaWindowLabel(50_400, "weekly"), "5 Week");
  assert.equal(getCodexQuotaWindowLabel(undefined, "weekly"), "Weekly");
  assert.equal(getCodexQuotaWindowLabel(undefined, "hourly"), "5h");
});

test("keeps upstream Spark-specific quota windows for the account card", () => {
  assert.deepEqual(getCodexAdditionalQuotaWindows(quota), [
    {
      id: "additional:0:primary",
      sourceIndex: 0,
      windowKind: "primary",
      limitName: "gpt-5.3-codex-spark",
      limitLabel: "GPT 5.3 Codex Spark",
      meteredFeature: "codex_spark",
      allowed: undefined,
      limitReached: undefined,
      label: "5h",
      percentage: 65,
      resetTime: 1_790_000_000,
      windowMinutes: 300,
    },
    {
      id: "additional:0:secondary",
      sourceIndex: 0,
      windowKind: "secondary",
      limitName: "gpt-5.3-codex-spark",
      limitLabel: "GPT 5.3 Codex Spark",
      meteredFeature: "codex_spark",
      allowed: undefined,
      limitReached: undefined,
      label: "Weekly",
      percentage: 40,
      resetTime: 1_790_500_000,
      windowMinutes: 10_080,
    },
  ]);
});

test("treats K12 quota as usable when official subscription endpoint returns not found", () => {
  const account = {
    id: "k12-account",
    email: "student@example.test",
    plan_type: "k12",
    tokens: {
      id_token: "",
      access_token: "access-token",
      refresh_token: "refresh-token",
    },
    quota,
    subscription_active_until: undefined,
    subscription_query_last_error:
      'PROVIDER_SUBSCRIPTION_HTTP_404: {"detail":"No subscription found for account"}',
    created_at: 0,
    last_used: 0,
  };

  const presentation = getCodexSubscriptionPresentationForAccount(
    account,
    (key, options) => {
      if (key === "codex.subscription.entitlementUsable") {
        return `${String(options?.plan ?? "")} 额度可用`;
      }
      if (key === "codex.subscription.entitlementUsableDetail") {
        return "官方未提供订阅到期日，5h/Weekly 配额仍可正常刷新";
      }
      return String(options?.defaultValue ?? key);
    },
  );

  assert.equal(presentation.bucket, "entitlement_only");
  assert.equal(presentation.tone, "active");
  assert.equal(presentation.valueText, "K12 额度可用");
  assert.equal(presentation.timestampMs, null);
});
