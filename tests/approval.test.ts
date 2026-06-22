import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ApprovalMode, RiskLevel, WalkVerdict } from "@auto-factory/shared";
import { decideApproval, getApprovalMode, interpretWalk } from "@auto-factory/shared";

/** Build a WalkVerdict with safe defaults (no verdict, no skip). */
const verdict = (o: Partial<WalkVerdict> = {}): WalkVerdict => ({
  reviewApproved: false,
  hasVerdict: false,
  skipFlagging: false,
  ...o,
});

describe("decideApproval", () => {
  const modes: ApprovalMode[] = ["yolo", "middle", "manual"];
  const risks: (RiskLevel | undefined)[] = ["low", "high", undefined];

  it("rejects only when a verdict WAS recorded and was negative, in any mode", () => {
    for (const mode of modes) {
      for (const risk of risks) {
        const d = decideApproval(mode, verdict({ hasVerdict: true, reviewApproved: false, risk }));
        assert.equal(d.apply, false, `${mode}/${risk}`);
        assert.equal(d.requiresHuman, false, `${mode}/${risk}`);
        assert.equal(d.noop, false, `${mode}/${risk}`);
        assert.equal(d.incomplete, false, `${mode}/${risk}`);
        assert.match(d.reason, /reject/i);
      }
    }
  });

  it("reports INCOMPLETE (not a rejection) when NO verdict was recorded", () => {
    for (const mode of modes) {
      for (const risk of risks) {
        // The reviewer never ran (e.g. the chain stalled) → no verdict tag.
        const d = decideApproval(mode, verdict({ hasVerdict: false, risk }));
        assert.equal(d.incomplete, true, `${mode}/${risk}`);
        assert.equal(d.apply, false, `${mode}/${risk}`);
        assert.equal(d.requiresHuman, false, `${mode}/${risk}`);
        assert.equal(d.noop, false, `${mode}/${risk}`);
        assert.match(d.reason, /incomplete/i, `${mode}/${risk}`);
        assert.doesNotMatch(d.reason, /reject/i, `${mode}/${risk}`);
      }
    }
  });

  it("treats skipFlagging as a successful no-op (not rejection/incomplete), in any mode", () => {
    for (const mode of modes) {
      for (const risk of risks) {
        // Skip wins even with no verdict recorded — it's an intentional clean pass.
        const d = decideApproval(mode, verdict({ skipFlagging: true, risk }));
        assert.equal(d.noop, true, `${mode}/${risk}`);
        assert.equal(d.apply, false, `${mode}/${risk}`);
        assert.equal(d.requiresHuman, false, `${mode}/${risk}`);
        assert.equal(d.incomplete, false, `${mode}/${risk}`);
        assert.doesNotMatch(d.reason, /reject/i, `${mode}/${risk}`);
      }
    }
  });

  it("yolo auto-applies on approval at any risk", () => {
    for (const risk of risks) {
      const d = decideApproval("yolo", verdict({ hasVerdict: true, reviewApproved: true, risk }));
      assert.equal(d.apply, true);
      assert.equal(d.requiresHuman, false);
    }
  });

  it("manual always requires a human on approval, never auto-applies", () => {
    for (const risk of risks) {
      const d = decideApproval("manual", verdict({ hasVerdict: true, reviewApproved: true, risk }));
      assert.equal(d.apply, false);
      assert.equal(d.requiresHuman, true);
    }
  });

  it("middle gates only high risk on a human; otherwise auto-applies", () => {
    const high = decideApproval("middle", verdict({ hasVerdict: true, reviewApproved: true, risk: "high" }));
    assert.equal(high.apply, false);
    assert.equal(high.requiresHuman, true);

    for (const risk of ["low", "medium", undefined] as const) {
      const d = decideApproval("middle", verdict({ hasVerdict: true, reviewApproved: true, risk }));
      assert.equal(d.apply, true, `risk=${risk}`);
      assert.equal(d.requiresHuman, false, `risk=${risk}`);
    }
  });
});

describe("interpretWalk", () => {
  it("reads each accepted decision tag key", () => {
    for (const key of ["review_approved", "review_decision", "decision", "approved"]) {
      assert.equal(interpretWalk({ [key]: "approve" }).reviewApproved, true, key);
    }
  });

  it("accepts approve / approved / true as approval values", () => {
    for (const v of ["approve", "approved", "true", "APPROVE", "Approved"]) {
      assert.equal(interpretWalk({ review_approved: v }).reviewApproved, true, v);
    }
  });

  it("treats anything else (or absent) as not approved", () => {
    assert.equal(interpretWalk({ review_approved: "reject" }).reviewApproved, false);
    assert.equal(interpretWalk({ review_approved: "false" }).reviewApproved, false);
    assert.equal(interpretWalk({}).reviewApproved, false);
  });

  it("distinguishes a recorded verdict (hasVerdict) from no verdict at all", () => {
    // A present verdict tag — even a rejection — means the reviewer ran.
    assert.equal(interpretWalk({ review_approved: "reject" }).hasVerdict, true);
    assert.equal(interpretWalk({ review_approved: "approve" }).hasVerdict, true);
    assert.equal(interpretWalk({ decision: "false" }).hasVerdict, true);
    // No verdict tag → the reviewer never produced one (INCOMPLETE, not rejection).
    assert.equal(interpretWalk({}).hasVerdict, false);
    assert.equal(interpretWalk({ risk_level: "low" }).hasVerdict, false);
  });

  it("parses risk from risk_level and risk, normalizing case", () => {
    assert.equal(interpretWalk({ risk_level: "high" }).risk, "high");
    assert.equal(interpretWalk({ risk: "LOW" }).risk, "low");
    assert.equal(interpretWalk({ risk_level: "Medium" }).risk, "medium");
  });

  it("returns undefined risk for unknown/absent values", () => {
    assert.equal(interpretWalk({ risk_level: "catastrophic" }).risk, undefined);
    assert.equal(interpretWalk({}).risk, undefined);
  });

  it("reads skip_flagging=true (case-insensitive), false/absent otherwise", () => {
    assert.equal(interpretWalk({ skip_flagging: "true" }).skipFlagging, true);
    assert.equal(interpretWalk({ skip_flagging: "TRUE" }).skipFlagging, true);
    assert.equal(interpretWalk({ skip_flagging: "false" }).skipFlagging, false);
    assert.equal(interpretWalk({}).skipFlagging, false);
  });
});

describe("getApprovalMode", () => {
  const original = process.env.APPROVAL_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.APPROVAL_MODE;
    else process.env.APPROVAL_MODE = original;
  });

  it("defaults to yolo when unset", () => {
    delete process.env.APPROVAL_MODE;
    assert.equal(getApprovalMode(), "yolo");
  });

  it("normalizes case and accepts manual/middle", () => {
    process.env.APPROVAL_MODE = "MANUAL";
    assert.equal(getApprovalMode(), "manual");
    process.env.APPROVAL_MODE = "Middle";
    assert.equal(getApprovalMode(), "middle");
  });

  it("falls back to yolo on unrecognized values", () => {
    process.env.APPROVAL_MODE = "nonsense";
    assert.equal(getApprovalMode(), "yolo");
  });
});
