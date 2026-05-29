/**
 * Fullstack coordination — stateless. For a fullstack-scoped flag, check whether
 * the OTHER side's currently-deployed SHA already contains the same release-flag
 * file. If yes, both sides have the code → release. If no → wait; the other
 * side's Notifier will re-evaluate when it deploys.
 */

import { otherSideServices, type BeaconConfig, type Side } from "./config.js";
import type { GitHubClient } from "./github.js";

/** Read a service's currently-deployed SHA from its status endpoint. */
async function fetchDeployedSha(statusUrl: string, shaField: string): Promise<string | null> {
  try {
    const res = await fetch(statusUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const sha = json[shaField];
    return typeof sha === "string" ? sha : null;
  } catch {
    return null;
  }
}

/**
 * True if at least one service on the opposite side has the release-flag file in
 * its currently-deployed SHA.
 */
export async function otherSideHasFile(
  cfg: BeaconConfig,
  gh: GitHubClient,
  callerSide: Side,
  sourceFile: string,
): Promise<boolean> {
  const others = otherSideServices(cfg, callerSide);
  for (const svc of others) {
    const sha = await fetchDeployedSha(svc.statusUrl, svc.statusShaField);
    if (!sha) continue;
    if (await gh.fileExists(svc.repo, sourceFile, sha)) return true;
  }
  return false;
}
