/**
 * Approval logic. The agent chain produces a review verdict and a risk level
 * (as tags); the approval mode decides whether to auto-apply, gate on risk, or
 * require a human.
 *
 * The DECISION logic is firm. How the verdict/risk are read from agent tags is
 * best-effort: the canonical tags are `review_approved` / `risk_level`, but
 * `interpretWalk` also accepts a few legacy keys for resilience, so it's easy to
 * adjust if the agent configs change.
 */

import type { ApprovalMode, RiskLevel } from "./types.js";

export interface ApprovalDecision {
  apply: boolean;
  requiresHuman: boolean;
  /**
   * True when the pipeline intentionally created no flag (e.g. an infra/docs PR
   * that hit Rule F11). There is nothing to review or apply, so this is a
   * successful no-op — NOT a rejection. The PR check should pass.
   */
  noop: boolean;
  /**
   * True when the chain produced NO review verdict — the code reviewer never ran
   * (the chain stalled on an unmet handoff, or stopped early). Distinct from a
   * rejection: the reviewer did not reject, it never got to weigh in. Surfaced
   * as its own outcome so a stall is not misreported as "REJECTED" (issue #9).
   */
  incomplete: boolean;
  reason: string;
}

/** The review verdict + routing signals read from the accumulated agent tags. */
export interface WalkVerdict {
  /** The reviewer approved (an explicit approve/approved/true verdict). */
  reviewApproved: boolean;
  /**
   * An explicit review verdict tag was present at all. False means no verdict
   * was recorded (reviewer never ran) — which is INCOMPLETE, not a rejection.
   */
  hasVerdict: boolean;
  risk?: RiskLevel;
  /** The research planner declared no flag is needed (Rule F11). */
  skipFlagging: boolean;
}

/**
 * Resolve the active approval mode. Defaults to "yolo".
 * TODO: read from a per-repo LaunchDarkly flag once that flag's evaluation
 * context (context kind/key, server-SDK vs REST eval) is pinned; this env
 * fallback is the interim path.
 */
export function getApprovalMode(): ApprovalMode {
  const m = (process.env.APPROVAL_MODE || "yolo").toLowerCase();
  return m === "manual" || m === "middle" ? m : "yolo";
}

export function decideApproval(mode: ApprovalMode, verdict: WalkVerdict): ApprovalDecision {
  const base = { apply: false, requiresHuman: false, noop: false, incomplete: false };

  // 1. Intentional skip (no flag needed — e.g. infra/docs PR). The chain
  //    short-circuits before the reviewer; a successful no-op, not a rejection.
  if (verdict.skipFlagging) {
    return { ...base, noop: true, reason: "no flag needed — nothing to review" };
  }
  // 2. No verdict recorded → the reviewer never ran (chain stalled / stopped
  //    early). INCOMPLETE, NOT a rejection — the reviewer didn't reject, it
  //    never weighed in. (Distinguishing these is the heart of issue #9.)
  if (!verdict.hasVerdict) {
    return { ...base, incomplete: true, reason: "INCOMPLETE — the code reviewer never produced a verdict" };
  }
  // 3. A verdict was recorded and it was negative → genuine rejection.
  if (!verdict.reviewApproved) {
    return { ...base, reason: "code review REJECTED" };
  }
  // 4. Approved → apply per mode.
  switch (mode) {
    case "yolo":
      return { ...base, apply: true, reason: "yolo: auto-apply on approval" };
    case "manual":
      return { ...base, requiresHuman: true, reason: "manual: awaiting human approval" };
    case "middle":
      if (verdict.risk === "high") {
        return { ...base, requiresHuman: true, reason: "middle: high risk → human approval" };
      }
      return { ...base, apply: true, reason: `middle: ${verdict.risk ?? "unknown"} risk → auto-apply` };
  }
}

/**
 * Read the review verdict + risk from accumulated agent tags. The canonical tags
 * the code reviewer emits are `review_approved` and `risk_level` (documented in
 * config/agentcontrol/README.md and config/agentcontrol/tags.json); the
 * additional keys are LEGACY fallbacks kept only for resilience against older
 * config variations.
 */
export function interpretWalk(tags: Record<string, string>): WalkVerdict {
  const rawDecision = (
    tags.review_approved ?? // canonical
    tags.review_decision ?? // legacy
    tags.decision ?? // legacy
    tags.approved ?? // legacy
    ""
  ).toLowerCase();
  // An explicit verdict tag was present at all — distinguishes "reviewer rejected"
  // (hasVerdict + !reviewApproved) from "reviewer never ran" (!hasVerdict).
  const hasVerdict = rawDecision !== "";
  const reviewApproved = rawDecision === "approve" || rawDecision === "approved" || rawDecision === "true";
  const rawRisk = (
    tags.risk_level ?? // canonical
    tags.risk ?? // legacy
    ""
  ).toLowerCase();
  const risk: RiskLevel | undefined =
    rawRisk === "low" || rawRisk === "medium" || rawRisk === "high" ? rawRisk : undefined;
  // The research-planner sets skip_flagging=true when a PR legitimately needs no
  // feature flag (Rule F11: infra, docs, chore, etc.).
  const skipFlagging = (tags.skip_flagging ?? "").toLowerCase() === "true";
  return { reviewApproved, hasVerdict, risk, skipFlagging };
}
