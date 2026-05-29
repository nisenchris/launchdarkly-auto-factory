/**
 * Scope routing. Given a flag's scope and the side of the service that just
 * deployed, decide whether to release now, skip (the other side will handle it),
 * or run the fullstack cross-service check.
 */

import type { Scope } from "@auto-factory/shared";
import type { Side } from "./config.js";

export type ScopeDecision = "trigger" | "skip" | "check_fullstack";

export function decideScope(flagScope: Scope, callerSide: Side): ScopeDecision {
  switch (flagScope) {
    case "frontend":
      return callerSide === "frontend" ? "trigger" : "skip";
    case "backend":
      return callerSide === "backend" ? "trigger" : "skip";
    case "fullstack":
      return "check_fullstack";
    default:
      return "skip";
  }
}
