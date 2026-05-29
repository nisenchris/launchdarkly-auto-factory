import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStartAutomatedRelease } from "@auto-factory/shared";
import { decideScope } from "@auto-factory/beacon";

describe("decideScope", () => {
  it("frontend scope triggers only for the frontend side", () => {
    assert.equal(decideScope("frontend", "frontend"), "trigger");
    assert.equal(decideScope("frontend", "backend"), "skip");
  });

  it("backend scope triggers only for the backend side", () => {
    assert.equal(decideScope("backend", "backend"), "trigger");
    assert.equal(decideScope("backend", "frontend"), "skip");
  });

  it("fullstack scope always defers to the cross-service check", () => {
    assert.equal(decideScope("fullstack", "frontend"), "check_fullstack");
    assert.equal(decideScope("fullstack", "backend"), "check_fullstack");
  });
});

describe("buildStartAutomatedRelease", () => {
  const base = {
    flagKey: "f",
    environmentKey: "production",
    originalVariationId: "orig",
    targetVariationId: "targ",
    stages: [{ allocation: 50000, durationMillis: 1000 }],
  };

  it("guarded release carries releaseKind, stages, and metrics", () => {
    const instr = buildStartAutomatedRelease({
      ...base,
      releaseKind: "guarded",
      metrics: [{ key: "errors", isGroup: false }],
      metricMonitoringPreferences: { errors: { autoRollback: true } },
    });
    assert.equal(instr.kind, "startAutomatedRelease");
    assert.equal(instr.releaseKind, "guarded");
    assert.deepEqual(instr.stages, base.stages);
    assert.deepEqual(instr.metrics, [{ key: "errors", isGroup: false }]);
    assert.ok("metricMonitoringPreferences" in instr);
  });

  it("progressive release omits metrics", () => {
    const instr = buildStartAutomatedRelease({ ...base, releaseKind: "progressive" });
    assert.equal(instr.releaseKind, "progressive");
    assert.ok(!("metrics" in instr));
    assert.ok(!("metricMonitoringPreferences" in instr));
  });

  it("fallthrough placement omits ruleId; rule placement includes it", () => {
    const fallthrough = buildStartAutomatedRelease({ ...base, releaseKind: "progressive" });
    assert.ok(!("ruleId" in fallthrough));

    const onRule = buildStartAutomatedRelease({
      ...base,
      releaseKind: "progressive",
      placement: { ruleId: "rule-123" },
    });
    assert.equal(onRule.ruleId, "rule-123");
  });
});
