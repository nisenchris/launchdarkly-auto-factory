/**
 * Minimal GitHub Contents API client — enough to list a directory and read a
 * JSON file at a given ref (SHA/branch). Used for release-flag discovery.
 */

export interface RepoRef {
  owner: string;
  name: string;
}

/** Parse "owner/name" into a RepoRef. */
export function parseRepo(slug: string): RepoRef {
  const [owner, name] = slug.split("/");
  if (!owner || !name) throw new Error(`Invalid repo slug (expected owner/name): ${slug}`);
  return { owner, name };
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly api = "https://api.github.com",
  ) {}

  private async req<T>(path: string): Promise<{ status: number; data: T | null }> {
    const res = await fetch(`${this.api}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 404) return { status: 404, data: null };
    if (!res.ok) {
      throw new Error(`GitHub ${path} failed: HTTP ${res.status} — ${await res.text()}`);
    }
    return { status: res.status, data: (await res.json()) as T };
  }

  /** List files in a directory at a ref. Returns [] if the dir doesn't exist there. */
  async listDir(repo: RepoRef, dirPath: string, ref: string): Promise<string[]> {
    const clean = dirPath.replace(/^\/+|\/+$/g, "");
    const { data } = await this.req<Array<{ name: string; type: string }>>(
      `/repos/${repo.owner}/${repo.name}/contents/${clean}?ref=${encodeURIComponent(ref)}`,
    );
    if (!data) return [];
    return data.filter((e) => e.type === "file").map((e) => e.name);
  }

  /** Read and JSON-parse a file at a ref. Returns null if absent. */
  async getFileJson<T>(repo: RepoRef, filePath: string, ref: string): Promise<T | null> {
    const clean = filePath.replace(/^\/+/, "");
    const { data } = await this.req<{ content?: string; encoding?: string }>(
      `/repos/${repo.owner}/${repo.name}/contents/${clean}?ref=${encodeURIComponent(ref)}`,
    );
    if (!data?.content) return null;
    const decoded = Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
    return JSON.parse(decoded) as T;
  }

  /** Whether a specific file exists at a ref. */
  async fileExists(repo: RepoRef, filePath: string, ref: string): Promise<boolean> {
    const clean = filePath.replace(/^\/+/, "");
    const { status } = await this.req(
      `/repos/${repo.owner}/${repo.name}/contents/${clean}?ref=${encodeURIComponent(ref)}`,
    );
    return status !== 404;
  }
}
