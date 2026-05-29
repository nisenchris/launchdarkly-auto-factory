/**
 * Release trigger. Resolves the flag's variations, picks the release method
 * (override → sensible default), and executes via the shared release adapter.
 *
 * Scope note (prototype): handles BOOLEAN flags (off=false → on=true). Reading a
 * flag's configured release policy for defaults is deferred (see ISSUES I5);
 * when no overrides are supplied we fall back to demo defaults below.
 */

import {
  startRelease,
  type DiscoveredFlag,
  type LdClient,
  type MetricRef,
  type ReleaseKind,
  type Stage,
} from "@auto-factory/shared";

/** Demo default rollout when neither overrides nor a policy provide stages (ISSUES I5). */
const DEFAULT_STAGES: Stage[] = [
  { allocation: 20000, durationMillis: 300000 },
  { allocation: 50000, durationMillis: 300000 },
  { allocation: 100000, durationMillis: 300000 },
];
const DEFAULT_RANDOMIZATION_UNIT = "user";

interface FlagVariations {
  variations?: Array<{ _id: string; value: unknown }>;
}

export interface TriggerResult {
  flagKey: string;
  method: ReleaseKind;
  note?: string;
}

export async function triggerRelease(
  ld: LdClient,
  flag: DiscoveredFlag,
  environmentKey: string,
): Promise<TriggerResult> {
  const { data } = await ld.getFlag<FlagVariations>(flag.flagKey);
  const variations = data.variations ?? [];
  const onVar = variations.find((v) => v.value === true);
  const offVar = variations.find((v) => v.value === false);
  if (!onVar || !offVar) {
    throw new Error(
      `Prototype supports boolean flags only; '${flag.flagKey}' has no true/false variations`,
    );
  }

  const ov = flag.releaseOverrides ?? {};
  const metricKeys = ov.metricKeys ?? [];
  const metricGroupKeys = ov.metricGroupKeys ?? [];
  const hasMetrics = metricKeys.length > 0 || metricGroupKeys.length > 0;

  const method: ReleaseKind = ov.releaseMethod ?? (hasMetrics ? "guarded" : "progressive");

  if (method === "immediate") {
    await ld.patchFlagSemantic(
      flag.flagKey,
      environmentKey,
      [
        { kind: "turnFlagOn" },
        { kind: "updateFallthroughVariationOrRollout", variationId: onVar._id },
      ],
      "auto-factory: immediate release",
    );
    return { flagKey: flag.flagKey, method };
  }

  const metrics: MetricRef[] = [
    ...metricKeys.map((key) => ({ key, isGroup: false })),
    ...metricGroupKeys.map((key) => ({ key, isGroup: true })),
  ];
  const metricMonitoringPreferences: Record<string, { autoRollback: boolean }> = {};
  for (const m of metrics) metricMonitoringPreferences[m.key] = { autoRollback: true };

  const stages = ov.stages ?? DEFAULT_STAGES;
  const usedDefaults = !ov.stages;

  await startRelease(ld, {
    flagKey: flag.flagKey,
    environmentKey,
    releaseKind: method,
    originalVariationId: offVar._id,
    targetVariationId: onVar._id,
    randomizationUnit: ov.randomizationUnit ?? DEFAULT_RANDOMIZATION_UNIT,
    stages,
    ...(ov.extensionDurationMillis !== undefined
      ? { extensionDurationMillis: ov.extensionDurationMillis }
      : {}),
    ...(method === "guarded" && metrics.length
      ? { metrics, metricMonitoringPreferences }
      : {}),
  });

  return {
    flagKey: flag.flagKey,
    method,
    ...(usedDefaults ? { note: "used demo default stages (no overrides/policy — ISSUES I5)" } : {}),
  };
}
