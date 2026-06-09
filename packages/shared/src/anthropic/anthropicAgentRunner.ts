/**
 * Anthropic implementation of the `AgentRunner` seam.
 *
 * Runs the AutoFactory agent graph LOCALLY. The agent's instructions and model
 * are resolved NATIVELY by the LaunchDarkly AI SDK (the graph walker passes the
 * already-interpolated `instructions`, `model`, and a per-node `tracker` from the
 * `LDAIAgentConfig`). This runner just executes: it drives an Anthropic tool-use
 * loop with a read-only sandbox tool set (see sandboxTools.ts) and records
 * generation metrics to LaunchDarkly via the tracker.
 *
 * This is the piece Vega's `agentDispatch` does NOT do — Vega runs built-in
 * personas and ignores the AI config's instructions. Here the LD-authored
 * instructions ARE the agent.
 *
 * Sandbox / dry-run: the agents cannot write to LaunchDarkly, git, or the repo.
 * They inspect the code and emit routing tags via `tag_conversation`, which is
 * what the graph walker needs to advance the chain. Promote to write tools (LD
 * flag creation, git) for in-pipeline runs without touching the walker.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AgentNodeRequest, AgentNodeResult, AgentRunner, AgentStatus } from "../agentRunner.js";
import type { LdResourceWriter } from "./ldWriter.js";
import { SandboxToolExecutor, buildSandboxTools } from "./sandboxTools.js";

const COMMON_NOTE = `

You CANNOT edit files, run commands, or push git commits — code changes are out of
scope for this phase. Keep repo exploration focused (a handful of tool calls), then
finish with a short brief for the next agent.

You MUST call \`tag_conversation\` with the routing tag(s) your instructions specify
(e.g. flag_created, skip_flagging, flag_worthy, needs_tests, review_approved,
risk_level). The downstream chain advances on these tags — a step that sets no tags
stalls the pipeline.`;

const DRY_RUN_NOTE = `

---
## EXECUTION MODE: DRY-RUN (read-only)

You have read-only tools (\`read_file\`, \`list_dir\`, \`grep\`) and \`tag_conversation\`.
You CANNOT create LaunchDarkly flags or metrics. Wherever your instructions tell you
to create one, describe what you WOULD do and emit the corresponding routing tag.
${COMMON_NOTE}`;

const WRITE_NOTE = `

---
## EXECUTION MODE: LIVE (flag creation enabled)

You have read-only repo tools plus \`create_flag\`, which creates a REAL boolean
feature flag in the LaunchDarkly app project. When your flagging rules say a flag is
needed, CALL \`create_flag\` (it is idempotent — safe on PR re-runs). For metrics and
tests you have no write tool: describe what you would do and tag accordingly.
${COMMON_NOTE}`;

const DEFAULT_MAX_TURNS = 12;
const MAX_TOKENS = 4096;
const DEFAULT_MODEL = "claude-sonnet-4-6";
/** Only this node may create flags — research/metrics/testing/review must not. */
const DEFAULT_FLAG_CREATION_CONFIG_KEY = "autofactory-flag-implementer";

export interface AnthropicAgentRunnerOptions {
  /** Absolute path the read-only sandbox tools operate within (the repo under review). */
  sandboxRoot: string;
  /** Anthropic API key; falls back to ANTHROPIC_API_KEY in the env. */
  apiKey?: string;
  /**
   * When provided, the `create_flag` tool is enabled (creates real flags in the
   * app/data-plane project) — but ONLY for the flag-creation node. Omit for dry-run.
   */
  writer?: LdResourceWriter;
  /** Config key of the node allowed to create flags (default the flag-implementer). */
  flagCreationConfigKey?: string;
}

export class AnthropicAgentRunner implements AgentRunner {
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicAgentRunnerOptions) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async runNode(req: AgentNodeRequest): Promise<AgentNodeResult> {
    // Write tools are enabled per-node: only the flag-creation node may create flags.
    const flagNode = this.opts.flagCreationConfigKey ?? DEFAULT_FLAG_CREATION_CONFIG_KEY;
    const writeForThisNode = this.opts.writer !== undefined && req.configKey === flagNode;
    const writer = writeForThisNode ? this.opts.writer : undefined;

    const system = (req.instructions ?? "") + (writeForThisNode ? WRITE_NOTE : DRY_RUN_NOTE);
    const model = anthropicModelId(req.model);
    const executor = new SandboxToolExecutor(this.opts.sandboxRoot, writer);
    const tools = buildSandboxTools({ writeEnabled: writeForThisNode }) as Anthropic.Tool[];
    const maxTurns = req.maxTurns ?? DEFAULT_MAX_TURNS;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: req.prompt }];
    let finalText = "";
    let status: AgentStatus = "completed";
    let inputTokens = 0;
    let outputTokens = 0;
    const started = Date.now();

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        const resp = await this.client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system,
          tools,
          messages,
        });
        inputTokens += resp.usage.input_tokens;
        outputTokens += resp.usage.output_tokens;
        messages.push({ role: "assistant", content: resp.content });
        finalText = textOf(resp.content) || finalText;

        if (resp.stop_reason !== "tool_use") break;

        const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const b of toolUses) {
          const r = await executor.execute(b.name, (b.input ?? {}) as Record<string, unknown>);
          results.push({
            type: "tool_result",
            tool_use_id: b.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          });
        }
        messages.push({ role: "user", content: results });

        if (turn === maxTurns - 1) status = "stopped"; // hit the turn cap mid-task
      }
      req.tracker?.trackSuccess();
    } catch (e) {
      status = "failed";
      finalText = e instanceof Error ? e.message : String(e);
      req.tracker?.trackError();
    } finally {
      req.tracker?.trackDuration(Date.now() - started);
      if (inputTokens || outputTokens) {
        req.tracker?.trackTokens({ input: inputTokens, output: outputTokens, total: inputTokens + outputTokens });
      }
    }

    return {
      status,
      messages: [{ role: "assistant", content: finalText, isFinal: true }],
      tags: { ...executor.tags },
    };
  }
}

/** Concatenate the text blocks of an Anthropic response. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Map a LaunchDarkly model name to an Anthropic model id. LD model names may be
 * provider-qualified (e.g. "Anthropic.claude-sonnet-4-5") — strip the prefix.
 */
function anthropicModelId(name: string | undefined): string {
  if (!name) return DEFAULT_MODEL;
  const id = name.includes(".") ? name.split(".").slice(1).join(".") : name;
  return id.trim() || DEFAULT_MODEL;
}
