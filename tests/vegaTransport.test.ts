import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GraphQLVegaTransport } from "@auto-factory/shared";

function withFetch(impl: typeof fetch): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = orig;
  };
}

const opts = { endpoint: "https://vega.example/graphql", token: "api-abc" };

describe("GraphQLVegaTransport", () => {
  it("dispatches with a raw LD API key (no Bearer) and returns the conversation id", async () => {
    let auth: unknown;
    let body: any;
    const restore = withFetch((async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization;
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: { agentDispatch: { conversation_id: "c1", success: true } } }), { status: 200 });
    }) as unknown as typeof fetch);

    const t = new GraphQLVegaTransport(opts);
    const res = await t.dispatch({ configKey: "research", prompt: "hi", maxTurns: 5 });
    restore();

    assert.equal(res.conversationId, "c1");
    assert.equal(auth, "api-abc"); // raw, no "Bearer "
    assert.equal(body.variables.input.ai_config_key, "research");
    assert.equal(body.variables.input.request_type, "Fix");
    assert.equal(body.variables.input.max_turns, 5);
  });

  it("maps status messages and tags", async () => {
    const restore = withFetch((async () =>
      new Response(
        JSON.stringify({
          data: {
            agentDispatchStatus: {
              conversation_id: "c1",
              status: "completed",
              messages: [{ role: "assistant", content: "done", turn: 1, is_final: true }],
              tags: [{ key: "review_decision", value: "approve" }],
            },
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch);

    const t = new GraphQLVegaTransport(opts);
    const res = await t.getStatus("c1");
    restore();

    assert.equal(res.status, "completed");
    assert.equal(res.messages[0]?.isFinal, true);
    assert.equal(res.messages[0]?.content, "done");
    assert.equal(res.tags.review_decision, "approve");
  });

  it("throws when dispatch is not accepted", async () => {
    const restore = withFetch((async () =>
      new Response(JSON.stringify({ data: { agentDispatch: { conversation_id: "", success: false } } }), { status: 200 })) as unknown as typeof fetch);
    const t = new GraphQLVegaTransport(opts);
    await assert.rejects(() => t.dispatch({ configKey: "x", prompt: "p" }), /not accepted/);
    restore();
  });
});
