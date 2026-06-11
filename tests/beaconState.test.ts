import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { FileDeployStateStore, MemoryDeployStateStore, resolvePreviousSha } from "@auto-factory/beacon";

describe("MemoryDeployStateStore", () => {
  it("keeps two-deep history per service@environment", () => {
    const store = new MemoryDeployStateStore();
    store.record("svc", "production", "aaa");
    assert.deepEqual(store.get("svc", "production"), { last: "aaa" });

    store.record("svc", "production", "bbb");
    assert.deepEqual(store.get("svc", "production"), { last: "bbb", prior: "aaa" });

    // Other environments and services are independent.
    assert.deepEqual(store.get("svc", "staging"), {});
    assert.deepEqual(store.get("other", "production"), {});
  });

  it("re-recording the current SHA is a no-op (preserves prior)", () => {
    const store = new MemoryDeployStateStore();
    store.record("svc", "production", "aaa");
    store.record("svc", "production", "bbb");
    store.record("svc", "production", "bbb"); // provider retry / restart
    assert.deepEqual(store.get("svc", "production"), { last: "bbb", prior: "aaa" });
  });
});

describe("resolvePreviousSha", () => {
  const store = new MemoryDeployStateStore();
  store.record("svc", "production", "aaa");
  store.record("svc", "production", "bbb");

  it("an explicit previousSha always wins", () => {
    assert.deepEqual(resolvePreviousSha(store, "svc", "production", "ccc", "explicit"), {
      previousSha: "explicit",
      source: "request",
    });
  });

  it("falls back to the stored last SHA for a new deploy", () => {
    assert.deepEqual(resolvePreviousSha(store, "svc", "production", "ccc", undefined), {
      previousSha: "bbb",
      source: "state",
    });
  });

  it("a re-notification of the current SHA re-diffs the same range (prior)", () => {
    assert.deepEqual(resolvePreviousSha(store, "svc", "production", "bbb", undefined), {
      previousSha: "aaa",
      source: "state",
    });
  });

  it("first deploy has no previousSha", () => {
    assert.deepEqual(resolvePreviousSha(store, "fresh", "production", "ccc", undefined), {
      previousSha: undefined,
      source: "none",
    });
  });
});

describe("FileDeployStateStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "beacon-state-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("persists across instances", () => {
    const file = join(dir, "state.json");
    const a = new FileDeployStateStore(file);
    a.record("svc", "production", "aaa");
    a.record("svc", "production", "bbb");

    const b = new FileDeployStateStore(file);
    assert.deepEqual(b.get("svc", "production"), { last: "bbb", prior: "aaa" });
  });

  it("starts empty when the file does not exist", () => {
    const store = new FileDeployStateStore(join(dir, "missing.json"));
    assert.deepEqual(store.get("svc", "production"), {});
  });
});
