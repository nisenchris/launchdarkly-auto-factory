/**
 * LaunchDarkly resource writer for the agent write tools.
 *
 * Programmatic flag creation is a REST operation (no SDK creates flags), so this
 * wraps the `api-`-key `LdClient` pointed at the APP/data-plane project. Kept
 * tiny and idempotent: LaunchDarkly returns 409 when a flag already exists (PR
 * re-runs on synchronize), which we report rather than treat as an error.
 */

import type { LdClient } from "../ldClient.js";

export interface CreateFlagArgs {
  /** Flag key (e.g. "enable-farewell"). */
  key: string;
  /** Human-readable name. Defaults to the key. */
  name?: string;
  description?: string;
  /** Extra tags, merged with the standard auto-factory tags. */
  tags?: string[];
}

export interface LdWriteResult {
  created: boolean;
  alreadyExists: boolean;
  key: string;
  detail: string;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class LdResourceWriter {
  constructor(private readonly ld: LdClient) {}

  get projectKey(): string {
    return this.ld.projectKey;
  }

  /**
   * Create a boolean feature flag (treatment=true / control=false) following the
   * AutoFactory convention: temporary, off-variation = control (safe default).
   */
  async createBooleanFlag(args: CreateFlagArgs): Promise<LdWriteResult> {
    if (!args.key) throw new Error("flag key is required");
    const body = {
      key: args.key,
      name: args.name || args.key,
      ...(args.description ? { description: args.description } : {}),
      temporary: true,
      tags: dedupe(["auto-factory", "auto-generated", ...(args.tags ?? [])]),
      variations: [
        { value: true, name: "Treatment" },
        { value: false, name: "Control" },
      ],
      // On = treatment (index 0); Off = control (index 1) — flag-off preserves existing behavior.
      defaults: { onVariation: 0, offVariation: 1 },
    };
    const res = await this.ld.createFlag(body);
    const alreadyExists = res.status === 409;
    return {
      created: !alreadyExists,
      alreadyExists,
      key: args.key,
      detail: alreadyExists
        ? `Flag '${args.key}' already exists in project '${this.ld.projectKey}' (no change).`
        : `Created flag '${args.key}' in project '${this.ld.projectKey}'.`,
    };
  }
}
