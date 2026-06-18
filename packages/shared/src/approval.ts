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
  reason: string;
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

export function decideApproval(
  mode: ApprovalMode,
  reviewApproved: boolean,
  risk?: RiskLevel,
  skipFlagging = false,
): ApprovalDecision {
  // An intentional skip (no flag needed — e.g. infra/docs PR) short-circuits the
  // chain before the code reviewer runs, so `review_approved` is never set. That
  // is a successful no-op, not a rejection: pass the check with nothing to apply.
  if (skipFlagging) {
    return {
      apply: false,
      requiresHuman: false,
      noop: true,
      reason: "no flag needed — nothing to review",
    };
  }
  if (!reviewApproved) {
    return { apply: false, requiresHuman: false, noop: false, reason: "code review REJECTED" };
  }
  switch (mode) {
    case "yolo":
      return { apply: true, requiresHuman: false, noop: false, reason: "yolo: auto-apply on approval" };
    case "manual":
      return { apply: false, requiresHuman: true, noop: false, reason: "manual: awaiting human approval" };
    case "middle":
      if (risk === "high") {
        return { apply: false, requiresHuman: true, noop: false, reason: "middle: high risk → human approval" };
      }
      return {
        apply: true,
        requiresHuman: false,
        noop: false,
        reason: `middle: ${risk ?? "unknown"} risk → auto-apply`,
      };
  }
}

/**
 * Read the review verdict + risk from accumulated agent tags. The canonical tags
 * the code reviewer emits are `review_approved` and `risk_level` (documented in
 * config/agentcontrol/README.md); the additional keys are LEGACY fallbacks kept
 * only for resilience against older config variations.
 */
export function interpretWalk(tags: Record<string, string>): {
  reviewApproved: boolean;
  risk?: RiskLevel;
  skipFlagging: boolean;
} {
  const decision = (
    tags.review_approved ?? // canonical
    tags.review_decision ?? // legacy
    tags.decision ?? // legacy
    tags.approved ?? // legacy
    ""
  ).toLowerCase();
  const reviewApproved = decision === "approve" || decision === "approved" || decision === "true";
  const rawRisk = (
    tags.risk_level ?? // canonical
    tags.risk ?? // legacy
    ""
  ).toLowerCase();
  const risk: RiskLevel | undefined =
    rawRisk === "low" || rawRisk === "medium" || rawRisk === "high" ? rawRisk : undefined;
  // The research-planner / flag-implementer set skip_flagging=true when a PR
  // legitimately needs no feature flag (Rule F11: infra, docs, chore, etc.).
  const skipFlagging = (tags.skip_flagging ?? "").toLowerCase() === "true";
  return { reviewApproved, risk, skipFlagging };
}
