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

  it("accepts DEPLOYED/REDEPLOYED as success statuses (webhook event spellings)", () => {
    for (const status of ["DEPLOYED", "Redeployed"]) {
      const result = parseRailwayWebhook({
        status,
        service: { name: "demo-backend" },
        deployment: { meta: { commitHash: "abc" } },
      });
      assert.equal(result.kind, "deploy_success", `status ${status}`);
    }
  });

  it("ignores non-success deploy events", () => {
    for (const status of ["BUILDING", "FAILED", "CRASHED", "REMOVED", "QUEUED"]) {
      const result = parseRailwayWebhook({ status, service: { name: "demo-backend" } });
      assert.equal(result.kind, "ignored", `status ${status}`);
    }
  });

  it("reports unrecognized payloads without throwing", () => {
    assert.equal(parseRailwayWebhook(null).kind, "unrecognized");
    assert.equal(parseRailwayWebhook("nope").kind, "unrecognized");
    assert.equal(parseRailwayWebhook({ hello: "world" }).kind, "unrecognized");
    // SUCCESS but no way to identify the service/commit.
    assert.equal(parseRailwayWebhook({ status: "SUCCESS" }).kind, "unrecognized");
  });
});
