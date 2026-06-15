// GitHub Action front-end surface. The provider-agnostic orchestration
// (walkGraph, approval) now lives in @auto-factory/shared so every front end
// (Action, Cursor extension) depends only on shared, not on each other.
export * from "./prContext.js";
export * from "./comment.js";
