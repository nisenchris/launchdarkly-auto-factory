/**
 * Real Vega transport over the agent-dispatch GraphQL API.
 *
 * Implements the `VegaTransport` seam (see vegaClient.ts):
 *   mutation agentDispatch(input: AgentDispatchInput!): AgentDispatchPayload
 *   query    agentDispatchStatus(conversation_id): AgentDispatchStatusPayload
 *
 * The endpoint and auth are **environment-configured**, never hardcoded — the
 * dispatch host is a private/internal surface today and the auth header name may
 * differ per deployment. Operators supply `endpoint`, `token`, and (if needed) a
 * non-default `authHeaderName`.
 */

import type {
  VegaDispatchRequest,
  VegaDispatchResult,
  VegaStatus,
  VegaStatusResult,
  VegaTransport,
} from "./vegaClient.js";

const DISPATCH_MUTATION = `mutation AgentDispatch($input: AgentDispatchInput!) {
  agentDispatch(input: $input) { conversation_id success }
}`;

const STATUS_QUERY = `query AgentDispatchStatus($id: StringID!) {
  agentDispatchStatus(conversation_id: $id) {
    conversation_id
    status
    messages { role content turn is_final }
    tags { key value }
  }
}`;

export interface GraphQLVegaTransportOptions {
  /** GraphQL endpoint URL (environment-specific; not hardcoded). */
  endpoint: string;
  /** Auth credential placed in the auth header. */
  token: string;
  /** Auth header name (default "Authorization"); set per the target deployment. */
  authHeaderName?: string;
  /** Auth scheme prefix. Default "" — LD API keys are sent raw (no "Bearer"). */
  authScheme?: string;
  /** AgentRequestType for dispatches (default "Fix"). */
  requestType?: string;
  /** Repositories the agents may access. */
  repositories?: string[];
  /** LD project slug. */
  projectSlug?: string;
}

interface DispatchData {
  agentDispatch: { conversation_id: string; success: boolean };
}
interface StatusData {
  agentDispatchStatus: {
    conversation_id: string;
    status: string;
    messages: Array<{ role: string; content: unknown; is_final: boolean }>;
    tags?: Array<{ key: string; value: string }>;
  };
}

export class GraphQLVegaTransport implements VegaTransport {
  constructor(private readonly opts: GraphQLVegaTransportOptions) {}

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const headerName = this.opts.authHeaderName ?? "Authorization";
    const scheme = this.opts.authScheme ?? ""; // LD API keys are sent raw
    const res = await fetch(this.opts.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        [headerName]: `${scheme} ${this.opts.token}`.trim(),
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (!res.ok || json.errors) {
      throw new Error(`Vega GraphQL error (HTTP ${res.status}): ${JSON.stringify(json.errors ?? "")}`);
    }
    return json.data as T;
  }

  async dispatch(req: VegaDispatchRequest): Promise<VegaDispatchResult> {
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      ai_config_key: req.configKey,
      request_type: this.opts.requestType ?? "Fix",
    };
    if (this.opts.repositories?.length) input.repositories = this.opts.repositories;
    if (req.maxTurns !== undefined) input.max_turns = req.maxTurns;
    if (this.opts.projectSlug) input.project_slug = this.opts.projectSlug;

    const data = await this.gql<DispatchData>(DISPATCH_MUTATION, { input });
    if (!data.agentDispatch?.success) {
      throw new Error(`Vega dispatch was not accepted for config '${req.configKey}'`);
    }
    return { conversationId: data.agentDispatch.conversation_id };
  }

  async getStatus(conversationId: string): Promise<VegaStatusResult> {
    const data = await this.gql<StatusData>(STATUS_QUERY, { id: conversationId });
    const p = data.agentDispatchStatus;
    const tags: Record<string, string> = {};
    for (const t of p.tags ?? []) tags[t.key] = t.value;
    return {
      conversationId: p.conversation_id,
      status: p.status as VegaStatus,
      messages: p.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        isFinal: m.is_final,
      })),
      tags,
    };
  }
}
