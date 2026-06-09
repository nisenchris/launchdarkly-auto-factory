/**
 * Tool set for the Anthropic agent path.
 *
 * Read-only repo inspection (`read_file`, `list_dir`, `grep`) + `tag_conversation`
 * (routing tags the graph walker needs) are always available. When a write-capable
 * `LdResourceWriter` is provided, the `create_flag` tool is added so the
 * flag-implementer can create a real feature flag in the app/data-plane project.
 * Nothing here edits files, runs commands, or pushes git — code changes stay out
 * of scope for this phase.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { LdResourceWriter } from "./ldWriter.js";

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; [k: string]: unknown };
}

const READONLY_TOOLS: AnthropicToolDef[] = [
  {
    name: "read_file",
    description:
      "Read a UTF-8 text file from the repository (relative to the repo root). Use this to inspect source files referenced in the PR or the prior step's brief.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative file path, e.g. backend/app.py" } },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List the entries of a directory (relative to the repo root). Use to explore project structure.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative directory path; \"\" or \".\" for the root" } },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description:
      "Search the repository for a regular expression and return matching file:line snippets. Use to find existing patterns (e.g. flag-evaluation calls, endpoints).",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression" },
        path: { type: "string", description: "Optional repo-relative subdirectory to scope the search" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "tag_conversation",
    description:
      "Record routing tags for the AutoFactory pipeline. Call this once you've decided the outcome of your step so the chain can advance. Pass the tags your instructions specify (e.g. {\"flag_created\":\"true\"}, {\"skip_flagging\":\"true\"}, {\"needs_tests\":\"true\"}, {\"review_approved\":\"true\"}, {\"risk_level\":\"low\"}).",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "object",
          description: "Flat map of string tag keys to string values.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["tags"],
    },
  },
];

const CREATE_FLAG_TOOL: AnthropicToolDef = {
  name: "create_flag",
  description:
    "Create a boolean feature flag in LaunchDarkly (the app/data-plane project). Treatment=true (new behavior), Control=false (existing behavior, served when off). Use this when your flagging rules say a flag is needed. Idempotent: re-creating an existing key is a no-op. After it succeeds, the flag_created/flag_key tags are set for you.",
  input_schema: {
    type: "object",
    properties: {
      key: { type: "string", description: "Flag key, e.g. enable-farewell (lowercase, hyphenated)" },
      name: { type: "string", description: "Human-readable flag name" },
      description: { type: "string", description: "What the flag gates" },
      tags: { type: "array", items: { type: "string" }, description: "Extra tags (auto-factory tags are added automatically)" },
    },
    required: ["key"],
  },
};

/** Build the tool set offered to the model. `create_flag` is included only in write mode. */
export function buildSandboxTools(opts: { writeEnabled: boolean }): AnthropicToolDef[] {
  return opts.writeEnabled ? [...READONLY_TOOLS, CREATE_FLAG_TOOL] : READONLY_TOOLS;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "__pycache__", ".venv"]);
const MAX_GREP_MATCHES = 80;
const MAX_FILE_BYTES = 200_000;

export interface ToolExecResult {
  content: string;
  isError?: boolean;
}

/**
 * Executes tool calls against a fixed root directory, accumulating the tags
 * emitted via `tag_conversation` (and auto-tagging on successful flag creation).
 * One instance per node run. Pass an `LdResourceWriter` to enable `create_flag`.
 */
export class SandboxToolExecutor {
  readonly tags: Record<string, string> = {};

  constructor(
    private readonly root: string,
    private readonly writer?: LdResourceWriter,
  ) {}

  /** Resolve a repo-relative path and reject anything escaping the sandbox root. */
  private safeResolve(rel: string): string {
    const abs = resolve(this.root, rel || ".");
    const within = relative(this.root, abs);
    if (within.startsWith("..") || resolve(abs) !== abs) {
      throw new Error(`path '${rel}' is outside the sandbox`);
    }
    return abs;
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolExecResult> {
    try {
      switch (name) {
        case "read_file":
          return { content: this.readFile(String(input.path ?? "")) };
        case "list_dir":
          return { content: this.listDir(String(input.path ?? "")) };
        case "grep":
          return { content: this.grep(String(input.pattern ?? ""), input.path ? String(input.path) : "") };
        case "tag_conversation":
          return { content: this.tag(input.tags) };
        case "create_flag":
          return await this.createFlag(input);
        default:
          return { content: `Unknown tool: ${name}`, isError: true };
      }
    } catch (e) {
      return { content: e instanceof Error ? e.message : String(e), isError: true };
    }
  }

  private readFile(rel: string): string {
    const abs = this.safeResolve(rel);
    const buf = readFileSync(abs);
    if (buf.byteLength > MAX_FILE_BYTES) {
      return `${buf.subarray(0, MAX_FILE_BYTES).toString("utf8")}\n…[truncated at ${MAX_FILE_BYTES} bytes]`;
    }
    return buf.toString("utf8");
  }

  private listDir(rel: string): string {
    const abs = this.safeResolve(rel);
    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => !SKIP_DIRS.has(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return entries.length ? entries.join("\n") : "(empty)";
  }

  private grep(pattern: string, rel: string): string {
    const re = new RegExp(pattern);
    const start = this.safeResolve(rel);
    const matches: string[] = [];
    const walk = (dir: string): void => {
      if (matches.length >= MAX_GREP_MATCHES) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (matches.length >= MAX_GREP_MATCHES) return;
        if (SKIP_DIRS.has(entry.name)) continue;
        const abs = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.isFile() && statSync(abs).size <= MAX_FILE_BYTES) {
          let text: string;
          try {
            text = readFileSync(abs, "utf8");
          } catch {
            continue;
          }
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && matches.length < MAX_GREP_MATCHES; i++) {
            const line = lines[i] ?? "";
            if (re.test(line)) {
              matches.push(`${relative(this.root, abs)}:${i + 1}: ${line.trim().slice(0, 200)}`);
            }
          }
        }
      }
    };
    walk(start);
    return matches.length ? matches.join("\n") : "(no matches)";
  }

  private tag(raw: unknown): string {
    if (!raw || typeof raw !== "object") return "tag_conversation: expected a `tags` object";
    const recorded: string[] = [];
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      this.tags[k] = String(v);
      recorded.push(`${k}=${String(v)}`);
    }
    return recorded.length ? `Recorded tags: ${recorded.join(", ")}` : "No tags provided";
  }

  private async createFlag(input: Record<string, unknown>): Promise<ToolExecResult> {
    if (!this.writer) return { content: "create_flag is not available (write mode disabled)", isError: true };
    const result = await this.writer.createBooleanFlag({
      key: String(input.key ?? ""),
      ...(input.name ? { name: String(input.name) } : {}),
      ...(input.description ? { description: String(input.description) } : {}),
      ...(Array.isArray(input.tags) ? { tags: input.tags.map(String) } : {}),
    });
    // Set routing tags so the chain advances even if the agent forgets to tag.
    this.tags.flag_created = "true";
    this.tags.flag_key = result.key;
    return { content: result.detail };
  }
}
