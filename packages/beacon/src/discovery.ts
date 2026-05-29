/**
 * Release-flag discovery: a file is "new" if it exists in the release-flags
 * directory at the current SHA but not at the previous SHA. Mirrors the
 * reference (GitHub Contents API diff of `.release-flags/`).
 */

import type { DiscoveredFlag, ReleaseFlagFile } from "@auto-factory/shared";
import type { GitHubClient, RepoRef } from "./github.js";

export async function discoverNewReleaseFlags(
  gh: GitHubClient,
  repo: RepoRef,
  dir: string,
  currentSha: string,
  previousSha: string | undefined,
): Promise<DiscoveredFlag[]> {
  const current = await gh.listDir(repo, dir, currentSha);
  const previous = previousSha ? new Set(await gh.listDir(repo, dir, previousSha)) : new Set<string>();

  const newJsonFiles = current.filter((name) => name.endsWith(".json") && !previous.has(name));

  const discovered: DiscoveredFlag[] = [];
  const cleanDir = dir.replace(/^\/+|\/+$/g, "");
  for (const name of newJsonFiles) {
    const filePath = `${cleanDir}/${name}`;
    const parsed = await gh.getFileJson<ReleaseFlagFile>(repo, filePath, currentSha);
    if (!parsed?.flagKey) continue; // not a valid release-flag file
    discovered.push({ ...parsed, sourceFile: filePath });
  }
  return discovered;
}
