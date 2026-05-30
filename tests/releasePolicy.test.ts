import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeReleasePolicy } from "@auto-factory/shared";

describe("normalizeReleasePolicy", () => {
  it("maps a guarded release policy (method, stages, randomization unit, metrics)", () => {
    const p = normalizeReleasePolicy({
      releaseMethod: "guarded-release",
      guardedReleaseConfig: {
        rolloutContextKindKey: "member",
        metricKeys: ["errors"],
        metricGroupKeys: ["core"],
        stages: [{ allocation: 50000, durationMillis: 1000 }],
      },
    });
    assert.equal(p.releaseMethod, "guarded");
    assert.equal(p.randomizationUnit, "member");
    assert.deepEqual(p.stages, [{ allocation: 50000, durationMillis: 1000 }]);
    assert.deepEqual(p.metricKeys, ["errors"]);
    assert.deepEqual(p.metricGroupKeys, ["core"]);
  });

  it("maps a progressive release policy (no metrics)", () => {
    const p = normalizeReleasePolicy({
      releaseMethod: "progressive-rollout",
      progressiveReleaseConfig: { rolloutContextKindKey: "user", stages: [{ allocation: 100000, durationMillis: 1 }] },
    });
    assert.equal(p.releaseMethod, "progressive");
    assert.equal(p.randomizationUnit, "user");
    assert.equal(p.metricKeys, undefined);
  });

  it("returns an empty policy when nothing is configured", () => {
    assert.deepEqual(normalizeReleasePolicy({}), {});
  });
});
