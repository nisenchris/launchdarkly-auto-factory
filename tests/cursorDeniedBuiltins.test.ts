import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURSOR_DENIED_BUILTINS } from "@auto-factory/shared";

describe("CURSOR_DENIED_BUILTINS", () => {
  it("denies Cursor's built-in shell and file editor", () => {
    for (const tool of ["shell", "edit"]) assert.ok(CURSOR_DENIED_BUILTINS.includes(tool), `${tool} must be denied`);
  });

  it("never denies 'mcp', which would also remove the factory's custom tools", () => {
    assert.ok(!CURSOR_DENIED_BUILTINS.includes("mcp"));
  });
});
