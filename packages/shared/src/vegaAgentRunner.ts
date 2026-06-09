/**
 * Vega implementation of the `AgentRunner` seam.
 *
 * Thin adapter over the existing `VegaClient` (vegaClient.ts / vegaTransport.ts
 * are intentionally left unchanged). The Vega result shape is already
 * structurally what the walker needs, so this just maps field-for-field.
 */

import type { AgentNodeRequest, AgentNodeResult, AgentRunner } from "./agentRunner.js";
import type { VegaClient } from "./vegaClient.js";

export class VegaAgentRunner implements AgentRunner {
  constructor(private readonly vega: VegaClient) {}

  async runNode(req: AgentNodeRequest): Promise<AgentNodeResult> {
    const result = await this.vega.runNode({
      configKey: req.configKey,
      prompt: req.prompt,
      ...(req.context ? { context: req.context } : {}),
      ...(req.maxTurns !== undefined ? { maxTurns: req.maxTurns } : {}),
    });
    return { status: result.status, messages: result.messages, tags: result.tags };
  }
}
