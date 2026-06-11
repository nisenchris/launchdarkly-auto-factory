import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRailwayWebhook } from "@auto-factory/beacon";

describe("parseRailwayWebhook", () => {
  it("parses a successful deploy (current layout)", () => {
    const result = parseRailwayWebhook({
      type: "DEPLOY",
      status: "SUCCESS",
      service: { id: "s1", name: "demo-backend" },
      environment: { id: "e1", name: "production" },
      deployment: { id: "d1", meta: { commitHash: "abc123", branch: "main" } },
    });
    assert.deepEqual(result, {
      kind: "deploy_success",
      service: "demo-backend",
      sha: "abc123",
      railwayEnvironment: "production",
    });
  });

  it("parses alternate field placements (status/meta nested differently)", () => {
    const result = parseRailwayWebhook({
      deployment: { status: "SUCCESS", meta: { commitSha: "def456", serviceName: "demo-frontend" } },
    });
    assert.deepEqual(result, { kind: "deploy_success", service: "demo-frontend", sha: "def456" });
  });

  it("ignores non-SUCCESS deploy events", () => {
    const result = parseRailwayWebhook({ status: "BUILDING", service: { name: "demo-backend" } });
    assert.equal(result.kind, "ignored");
  });

  it("reports unrecognized payloads without throwing", () => {
    assert.equal(parseRailwayWebhook(null).kind, "unrecognized");
    assert.equal(parseRailwayWebhook("nope").kind, "unrecognized");
    assert.equal(parseRailwayWebhook({ hello: "world" }).kind, "unrecognized");
    // SUCCESS but no way to identify the service/commit.
    assert.equal(parseRailwayWebhook({ status: "SUCCESS" }).kind, "unrecognized");
  });
});
