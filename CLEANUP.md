# CLEANUP.md — Project cleanup & refactoring punch list

Findings from a full-repo review (2026-06-09), focused on making this a plug-and-play,
customer-facing prototype. Each item is self-contained so an agent can work through them
independently. Items are grouped by priority; within a group, order is suggested but not required.

**Ground rules for whoever works this list:**
- This repo is PUBLIC. Run `npm run check:public` after every change. Never reference
  internal LaunchDarkly instance/tool names.
- After any source change under `packages/phase1-resource-factory/` or `packages/shared/`,
  rebuild the action bundle: `npm run bundle -w @auto-factory/phase1-resource-factory` and
  commit `dist/action.bundle.js` (CI fails on drift — see `.github/workflows/ci.yml:28-33`).
- `docs/build-checklist.md`, `docs/ISSUES.md`, `docs/demo-punchlist.md`,
  `docs/demo-pipeline-runbook.md` are **gitignored / local-only**. Do not un-ignore them
  without the owner's say-so.

---

## P0 — Broken right now

### 1. `tests/walker.test.ts` is broken — the test suite is red (3 failures)
- **File:** `tests/walker.test.ts`
- **Symptom:** `npm test` → 3 failures: `TypeError: graphDef.rootNode is not a function`.
- **Cause:** the test was written against the old `walkGraph(graph, vegaClient, ctx)` signature.
  `walkGraph` (`packages/phase1-resource-factory/src/graphWalker.ts:101`) now takes
  `(graphDef: AgentGraphDefinition, runner: AgentRunner, context, graphTracker?)` — an AI-SDK
  `AgentGraphDefinition` (with `.rootNode()`, `.getNode()`, node `.getConfig()/.getEdges()`),
  not a plain `{key, rootConfigKey, edges}` object. The test also imports `type AgentGraph`
  from `@auto-factory/phase1-resource-factory`, which is no longer exported (it's a type-only
  import so it doesn't crash, but it's dead).
- **Fix:** rewrite the test with (a) a fake `AgentRunner` (replaces the `FakeTransport`/`VegaClient`
  plumbing — much simpler now: `runNode` returns scripted `{status, messages, tags}` per configKey),
  and (b) a small in-test fabrication of the `AgentGraphDefinition` surface the walker uses
  (`rootNode()`, `getNode(key)`, `getConfig()` returning `{root, edges}`, per-node `getKey()`,
  `getConfig()` (instructions/model/createTracker), `getEdges()`). Keep the same three scenarios:
  full chain, `skip_if_tags` short-circuit, unmet `require_tags`.

### 2. Tests are not typechecked, which is how #1 slipped through
- **Files:** `tsconfig.json` (root — only references `packages/*`), `package.json:18` (test script
  runs via `tsx`, which strips types without checking them).
- **Fix:** add a `tests/tsconfig.json` (extends `tsconfig.base.json`, `noEmit: true`, references the
  packages) and include it in the root `typecheck` script, e.g.
  `"typecheck": "tsc --build --pretty && tsc -p tests --noEmit"`. This makes signature drift in
  `tests/` a CI failure instead of a runtime surprise.

### 3. `approval.ts` has zero test coverage despite being the most recently fixed logic
- **Files:** `packages/phase1-resource-factory/src/approval.ts` (all three functions);
  the latest commit on this branch ("honor the reviewer's review_approved tag") changed
  `interpretWalk` with no test.
- **Fix:** add `tests/approval.test.ts` covering: `decideApproval` for all 3 modes ×
  approved/rejected × risk low/high/undefined; `interpretWalk` for each accepted tag key
  (`review_approved`, `review_decision`, `decision`, `approved`) and value form
  (`approve`/`approved`/`true`), plus risk parsing; `getApprovalMode` defaulting/normalization.

---

## P1 — Plug-and-play blockers (a design partner cannot succeed today)

### 4. Agent configs can't reach a customer — add a seed-from-LaunchDarkly path
- **Files:** `config/agentcontrol/ai-configs/` (empty by design — see below);
  `bootstrap/create.mjs:36-38` provisions from it; `packages/config-bridge/src/cli.ts`
  (`sync` and `provision` exist as separate commands but nothing chains them);
  `.env.example:26-31` (LD_SOURCE_* vars already document this intent).
- **Decision (owner, 2026-06-09):** the five `autofactory-*` configs are still in flight and will
  **NOT be committed** to the repo. The source of truth stays the LaunchDarkly
  `auto-factory-prototype` project. Plug-and-play instead means: pull the latest configs + graph
  from that project at setup time and provision them straight into the customer's project.
- **Why it matters:** today a partner who runs `npm run bootstrap` gets the graph
  (`graphs/auto-factory.json`) but none of the five AI configs it references — the pipeline
  cannot run. The two halves of the fix already exist in the bridge; they just aren't connected.
- **Fix:** add a `seed` command to the bridge CLI (`bridge seed` = `sync` from LD_SOURCE_* into a
  gitignored staging dir, e.g. `.agentcontrol-cache/`, then `provision` from that dir into the
  target project — no commit step). Then:
  - `bootstrap/create.mjs`: when LD_SOURCE_* is configured, run `seed` instead of the local-dir
    `provision`; fall back to local-dir provision otherwise (keeps the eventual committed-configs
    path working).
  - Make sure `seed` pulls the **graph** from source too (sync already supports `--graphs`), so a
    customer gets the current graph shape, not the possibly-stale committed
    `graphs/auto-factory.json`.
  - Credentials: `LD_SOURCE_API_KEY` can live in the customer's `.env` locally or as a GitHub
    secret for CI-run seeding. It must be a **read-only token scoped to the
    auto-factory-prototype project only** — a secret distributed to customers is effectively
    semi-public.
  - Sanitization note: `check-public` only guards committed files; runtime-pulled configs bypass
    it. The prototype LD project itself becomes the sanitization boundary — keep internal
    names/tools out of the live config instructions there.
  - Update the stale "provision is a no-op pending sanitization" messaging (see #12, #16) to
    describe the seed flow instead.

### 5. `.env.example` is missing `ANTHROPIC_API_KEY` — the DEFAULT provider's key
- **File:** `.env.example`
- **Why it matters:** the `auto-factory-ai-provider` flag defaults to `anthropic`
  (`packages/shared/src/providerFlag.ts:14`), and `AnthropicAgentRunner` needs
  `ANTHROPIC_API_KEY` (`packages/phase1-resource-factory/src/action.ts:82`). The file documents
  the optional Vega path in detail but omits the key the default path requires.
- **Fix:** add an `ANTHROPIC_API_KEY=` entry with a comment ("required when the
  auto-factory-ai-provider flag serves 'anthropic' — the default"). While there, also document
  the Phase 1 toggles read from env: `ENABLE_FLAG_CREATION`, `ENABLE_CODE_CHANGES`,
  `APPROVAL_MODE`, `GRAPH_KEY`, `SANDBOX_ROOT`, `VEGA_REQUEST_TYPE`, and
  `LD_PIPELINE_CONTEXT_KEY` (read at `packages/shared/src/ldSdk.ts:64`).

### 6. `action.yml` and `mapActionInputs` are out of sync
- **Files:** `packages/phase1-resource-factory/action.yml` (inputs list),
  `packages/phase1-resource-factory/src/action.ts:122-146` (`mapActionInputs`).
- **Mismatches:**
  - `ld_project_key` is mapped in code (`action.ts:132`) but **not declared** in `action.yml`.
    Undeclared `with:` inputs generate workflow warnings and aren't a documented contract.
  - `VEGA_REQUEST_TYPE` is read by the action (`action.ts:46`) but has no `action.yml` input and
    no `mapActionInputs` entry — it only works as a raw env var.
- **Fix:** declare `ld_project_key` (and optionally `vega_request_type`) in `action.yml` inputs,
  or remove the orphaned mapping. Keep `action.yml`, `mapActionInputs`, and `.env.example`
  as one consistent contract.

### 7. Preflight doesn't check the keys Phase 1 actually needs
- **File:** `bootstrap/checks/preflight.mjs`
- **Issue:** preflight validates Node version + `LD_API_KEY`/`LD_PROJECT_KEY` reachability, but
  never checks `LD_SDK_KEY` (hard-required at runtime, `packages/shared/src/ldSdk.ts:34`) or
  `ANTHROPIC_API_KEY` (required on the default provider path). A partner passes preflight and
  then fails on their first PR.
- **Fix:** add checks: `LD_SDK_KEY` present (issue if missing); `ANTHROPIC_API_KEY` present
  (note/warning, since the provider flag could serve `vega`). Optionally verify the SDK key by
  initializing the server SDK with a short timeout.

### 8. Phase 1 never writes the `.release-flags/` file that Phase 2 consumes
- **Files:** `docs/plan.html` (Phase 1 diagram: "+ `.release-flags/<id>.json` written");
  `examples/demo-app/GUIDE.md:25` ("A `.release-flags/pr-N.json` lands"); the agent tooling
  (`packages/shared/src/anthropic/sandboxTools.ts`) and the CHANGELOG show no agent/tool/
  instruction responsible for creating it. `examples/demo-app/.release-flags/pr-1.json` is hand-authored.
- **Why it matters:** this is the hand-off between Phase 1 and Phase 2. Today it's a silent manual
  step — the "fully autonomous" loop has a hole.
- **Fix (pick one, document the choice):** (a) add writing `.release-flags/<flag-key>.json` to the
  flag-implementer's instructions (it already has `write_file` + `commit_and_push`), or (b) have the
  action itself write the file deterministically after a successful walk (more reliable than an
  instruction; fits "idempotent glue code"). Then fix the docs to match. Note plan §8 already
  recommends keying by **flag key, not PR number** — do that here rather than `pr-N.json`.

### 9. Public files reference gitignored docs (broken links for partners)
- **Occurrences:**
  - `README.md:14-15` → `docs/build-checklist.md`, `docs/ISSUES.md`; `README.md:26` → `docs/ISSUES.md`
  - `docs/plan.html` "What this document is" callout (~line 94) and footer (~line 489) → both
  - `bootstrap/create.mjs:48-49` → "see docs/ISSUES.md I3"
  - `packages/config-bridge/src/cli.ts:12,62` → "docs/ISSUES.md I3"
  - `packages/config-bridge/src/provision.ts:9` → "ISSUES.md I4"; `cli.ts:39` → "ISSUES I4"
  - `packages/beacon/src/trigger.ts:6,21` → "ISSUES I5"; `packages/beacon/src/notify.ts:13,28` → "ISSUES I8"
  - `examples/demo-app/GUIDE.md:39` → "docs/ISSUES.md I7"
  - `packages/phase1-resource-factory/src/approval.ts:7,21,50` → "ISSUES I9 / I6"
- **Fix:** these files ship to partners who don't have the local docs. Replace each reference with
  either (a) the substantive content inline (one sentence usually suffices), or (b) a public
  tracking location (GitHub issues). Don't just delete the pointers — the context they point to is
  often the only explanation of a deliberate gap.

---

## P2 — Documentation that no longer matches the code

### 10. `packages/phase1-resource-factory/README.md` describes a package that doesn't exist
- **Wrong now:**
  - Directory table (`github-action/`, `agents/`, `approval/`, `adapters/ci-github/`, `adapters/ld/`)
    — actual layout is flat: `src/{action,approval,comment,graphWalker,index,prContext}.ts` + `action.yml`.
  - "The agents themselves run on LaunchDarkly's hosted runtime — this package does not contain an
    agent loop" — false since the provider pivot: the **default** is the local Anthropic runner
    (`packages/shared/src/anthropic/anthropicAgentRunner.ts`); Vega is the alternative behind the
    `auto-factory-ai-provider` flag.
  - Graph description (`Research & Planning → Flagging → Metrics → Testing → Code Review`) doesn't
    name the real nodes/keys (`autofactory-research-planner` → `autofactory-flag-implementer` →
    `autofactory-metrics-author` → `autofactory-flag-testing` → `autofactory-code-reviewer`,
    per `config/agentcontrol/graphs/auto-factory.json`).
  - "Read the approval mode from a LaunchDarkly flag (per-repo)" — it's an env var /
    action input today (`approval.ts:24-27`, explicitly TODO).
- **Fix:** rewrite to document what's actually here: the action entrypoint (`action.ts`), the
  graph walker + handoff semantics (`require_tags` / `skip_if_tags` / `max_turns`), approval modes
  (env-driven, flag planned), PR comment posting, the `action.yml` input contract, and the
  commit-the-bundle requirement.

### 11. `packages/config-bridge/README.md` — wrong directories, wrong config location, resolved question
- **Wrong now:** the dir table (`configs/`, `provision/`, `sync/`) — actual layout is flat
  `src/{cli,provision,sync,index}.ts`; canonical copies live in **`config/agentcontrol/`**, not
  `packages/config-bridge/configs/`; "Build-time detail to confirm: Agent Graph CRUD may need the
  raw REST API" — resolved (graph CRUD is REST; the bridge does it in `provision.ts:126-156`).
- **Fix:** rewrite around the actual CLI: `bridge provision [--ai-configs <dir>] [--graphs <dir>] [--dry-run]`
  and `bridge sync --out <dir> [--tags ...] [--graphs ...]`, the LD_*/LD_SOURCE_* env contract,
  idempotency behavior, and the tools/snippets-stripping caveat.

### 12. Root `README.md` Status section is stale (and now inaccurate)
- **Wrong now (`README.md:17-26`):**
  - "Two things gate a live end-to-end run: a reachable Vega dispatch endpoint and the canonical
    agent configs" — per the project owner, Phase 1 runs end-to-end today on the Anthropic
    provider against a live demo repo. Vega is optional, not a gate.
  - "23 unit tests … all green" — the suite is currently red (see #1), and the count drifts; drop the number.
  - Phase 1 bullet (line 7) says "a graph of LaunchDarkly-hosted agents" — the default execution is
    local (Anthropic API) with LD-native config/graph resolution; LD-hosted (Vega) is the alternative.
- **Fix:** rewrite Status to reflect reality: Phase 1 works end-to-end (PR → agents → flag created →
  code wired → tests → review → approval); name the provider-flag architecture; list what's still
  genuinely open (Vega entitlement, Phase 2 live deploy validation, approval-mode flag). Update the
  Quickstart to mention `LD_SDK_KEY` + `ANTHROPIC_API_KEY` (it currently says only "LD_API_KEY,
  LD_PROJECT_KEY, …").

### 13. `docs/plan.html` architecture callouts contradict the build
- **Wrong now:** §2 "Agent runtime: Vega" callout says "**No agent loop ships in this repo**" and the
  Phase 1 diagram shows Vega as the only execution path; the footer says "Phase 1 agent execution
  awaits a reachable live Vega endpoint; canonical agent configs await a sanitization review".
- **Fix:** plan.html is the design-rationale document, so don't rewrite history — add a clearly-dated
  "What changed in the build" note (callout near §2 + updated footer): the runtime pivoted to a
  provider seam (`AgentRunner`), default = local Anthropic execution with LD-native AI-config/graph
  resolution; an agent loop *does* ship in `packages/shared/src/anthropic/`. Update the
  "last updated" date.

### 14. Missing ADR for the biggest architectural decision in the repo
- **Files:** `docs/adr/` (0001–0004). ADR 0004 still describes Vega-behind-a-stub as the execution
  story.
- **Fix:** add `docs/adr/0005-provider-seam-local-anthropic-execution.md`: context (Vega dispatch
  blocked on entitlement; agents needed to run for real), decision (provider-agnostic `AgentRunner`
  seam; `auto-factory-ai-provider` LD flag selects backend; default local Anthropic tool-use loop
  with capability-gated sandbox tools; LD AI SDK still resolves configs/graphs/tracking natively),
  consequences (agent loop now ships in-repo; Vega path preserved unchanged). Add a one-line
  "Superseded in part by ADR 0005" note to ADR 0004's status.

### 15. `packages/beacon/README.md` directory table doesn't match the code
- **Wrong now:** table lists `notifier/`, `discovery/`, `scope/`, `coordination/`,
  `adapters/cd-railway/` — actual layout is flat `src/{server,notify,discovery,scope,fullstack,github,trigger,config,index}.ts`.
  There is **no Railway adapter at all** — Beacon calls the LaunchDarkly release API directly
  (that's ADR 0002, and it's the better description).
- **Fix:** rewrite the table for the real files; document the HTTP contract (`POST /flag-releases`
  with `x-beacon-secret`, `GET /health`), the `auto-factory-notify` bin, and the config surface
  (`config/services.yaml`, `config/scopes.yaml`, `config/release-source.yaml`, env).

### 16. `bootstrap/create.mjs` prints stale next-steps
- **File:** `bootstrap/create.mjs:41-50`
- **Wrong now:** "Add repo secrets: LD_API_KEY (+ GITHUB_TOKEN and BEACON_WEBHOOK_SECRET for
  Phase 2)" — the workflow template (`bootstrap/github-action-template/auto-factory.yml`) actually
  needs secrets `LD_SDK_KEY`, `ANTHROPIC_API_KEY`, `LD_API_KEY` and the repo **variable**
  `LD_APP_PROJECT_KEY`. The closing note ("provision is a no-op" pending sanitization) goes away
  once #4 lands.
- **Fix:** align the printed secrets/vars list with the template; replace the no-op caveat with a
  description of the seed-from-LaunchDarkly flow once #4 lands.

### 17. `packages/shared/README.md` undersells/misdescribes the package
- **Wrong now:** describes only "types, LD API client, config schemas". The package now contains the
  heart of the prototype: the `AgentRunner` seam, the Anthropic runner + sandbox tools + LD writer,
  the Vega client/transport, the native SDK bootstrap (`ldSdk.ts`), the provider flag, and the
  release adapter.
- **Fix:** add a short module map (one line per file) so partners can find the customization seams.

### 18. `packages/shared/src/vegaClient.ts` header says PLACEHOLDER — it isn't anymore
- **File:** `packages/shared/src/vegaClient.ts:1-14, 50-56`
- **Wrong now:** "⚠️ PLACEHOLDER. The real public Vega dispatch endpoint, auth model, and
  payload/response shapes are pending" — `GraphQLVegaTransport` exists (`vegaTransport.ts`), the
  shapes are implemented, and auth was live-verified. Also `VegaClientOptions.endpoint` and
  `VegaClientOptions.auth` are **dead fields** — `VegaClient` never reads them (the transport owns
  endpoint/auth).
- **Fix:** rewrite the header ("transport seam; `GraphQLVegaTransport` is the real implementation,
  `StubVegaTransport` is the no-config fallback"), delete `endpoint`/`auth` from
  `VegaClientOptions`, and drop the two `eslint-disable` comments (the repo has no eslint config).

### 19. `setup-steps.md` is an abandoned scratch file at the repo root
- **File:** `setup-steps.md` (3 lines, ends with a dangling "- ").
- **Fix:** move its one real fact ("the Agent Dispatch API must be enabled via a LaunchDarkly flag /
  entitlement for the project before Vega dispatch works") into the Vega section of `.env.example`
  or the root README's Vega notes, then delete the file.

### 20. `config/ld-targets.yaml` is decorative — nothing reads it
- **File:** `config/ld-targets.yaml`; referenced as the config surface by
  `packages/config-bridge/README.md:13-14` and `docs/plan.html` §3.
- **Issue:** the `${LD_BASE_URL}`-style placeholders are never interpolated; source/target
  connections come entirely from env (`packages/shared/src/env.ts`). A partner editing this file
  changes nothing — the worst kind of customization point.
- **Fix (pick one):** (a) delete it and point docs at `.env.example` as the single connection
  surface, or (b) make `env.ts` actually read it as defaults-under-env. (a) is less code and
  honest; recommended for a prototype.

### 21. `sources/` scaffolding promises tooling that doesn't exist
- **Files:** `sources/manifest.yaml` (all entries commented out), `sources/ld-configs/.gitkeep`;
  `docs/plan.html` §3/§4 references `scripts/sync-sources` and `scripts/sanitize` — `scripts/`
  contains only `check-public.mjs`.
- **Fix:** either remove the `sources/` tree + manifest and the plan's references (nothing vendored
  in practice; the bridge's `sync` covers LD configs), or keep the manifest but fix plan.html to say
  syncing is manual. Don't ship references to scripts that don't exist.

### 22. `examples/demo-app/GUIDE.md` vs. the real demo setup
- **File:** `examples/demo-app/GUIDE.md`
- **Issues:** (a) it implies this in-repo copy is *the* demo, while the working Phase 1 demo runs
  against a separate app repo wired with the workflow template — clarify the relationship
  (in-repo copy = reference/starting point; the action targets whatever repo installs the
  workflow); (b) the flag is named `new-greeting` here but agents derive flag keys per-PR — note
  that; (c) `docs/ISSUES.md` reference (covered by #9).

### 23. `.gitignore` has an unexplained ignore of `examples/demo-app/README.md`
- **File:** `.gitignore:35` (sitting under the "Editor / OS" section, with no comment).
- **Fix:** if agents generate a README there during runs, say so in a comment and move it out of the
  Editor/OS block; otherwise delete the rule. Unexplained ignores of normal-looking files confuse
  contributors.

---

## P3 — Code refactors worth doing (prototype-appropriate, not gold-plating)

### 24. `NODE_CAPABILITIES` hardcodes agent config keys in the runner
- **File:** `packages/shared/src/anthropic/anthropicAgentRunner.ts:64-67`
- **Issue:** write capabilities are granted by exact config key
  (`autofactory-flag-implementer`, `autofactory-flag-testing`). A partner who renames or adds an
  agent silently gets a read-only node and a stalled pipeline — invisible coupling that
  contradicts the "agent steps are config, not code" principle.
- **Fix:** move capability grants into config — the natural seam is the graph edge `handoff`
  object (it already carries `max_turns`/`request_type`; add e.g. `"capabilities": ["create_flag",
  "edit_files"]` on the inbound edge, plus a root-node default in the graph file), or a small map in
  `config/agentcontrol/`. Keep `NODE_CAPABILITIES` only as a fallback, and log when a node gets
  no grant so renames are diagnosable.

### 25. Phase 1 env-var sprawl — centralize the runtime config
- **Files:** `packages/phase1-resource-factory/src/action.ts` (reads ~12 env vars inline),
  `packages/shared/src/{env,ldSdk}.ts`, `packages/shared/src/anthropic/sandboxTools.ts:336,421`
  (reads `PR_BASE_REF` / `PR_BRANCH` directly from `process.env` deep inside tool code).
- **Issue:** the configuration surface is scattered, so "what knobs exist" requires reading five
  files; sandbox tools reaching into `process.env` makes them untestable without env mutation.
- **Fix:** introduce one `loadPhase1Config()` (in the action package) that maps inputs → a typed
  object, and pass `prBranch`/`prBaseRef` into `SandboxToolExecutor`/`AnthropicAgentRunnerOptions`
  explicitly. `mapActionInputs` folds into it. This is also what makes #6 stay fixed.

### 26. `postPrComment` posts a new comment on every run
- **File:** `packages/phase1-resource-factory/src/comment.ts`
- **Issue:** every `synchronize` (including the agents' own pushes — each agent commit re-triggers
  the workflow) appends another summary comment; busy PRs accumulate noise. Customer-facing polish.
- **Fix:** standard marker pattern — embed `<!-- auto-factory-phase1 -->` in the body, list the PR's
  comments, and PATCH the existing one if found, else POST.

### 27. Pin the agent tag contract; stop guessing in `interpretWalk`
- **Files:** `packages/phase1-resource-factory/src/approval.ts:50-67`;
  `packages/shared/src/anthropic/anthropicAgentRunner.ts:26-31` (TAGGING_NOTE);
  `config/agentcontrol/graphs/auto-factory.json` (edge conditions).
- **Issue:** the agent configs now reliably emit `review_approved` / `risk_level` (per the
  CHANGELOG and the recent fix), but `interpretWalk` still probes four legacy keys "best-effort".
  For a partner-facing contract, ambiguity is a liability.
- **Fix:** document the canonical tags in one place (the agentcontrol README is a good home:
  `skip_flagging`, `flag_created`, `flag_key`, `needs_tests`, `review_approved`, `risk_level`),
  make `interpretWalk` read the canonical keys first, and either delete the fallbacks or keep them
  behind a comment that names them as legacy. Pair with tests from #3.

### 28. `graphWalker` ignores `prompt_template` carried by every graph edge
- **Files:** `config/agentcontrol/graphs/auto-factory.json` (every edge has
  `"prompt_template": "{{PR_NUMBER}}"`); `packages/phase1-resource-factory/src/graphWalker.ts`
  (`buildPrompt` never reads it).
- **Issue:** the canonical graph advertises a templating capability the walker doesn't implement —
  a partner editing `prompt_template` would see no effect.
- **Fix (pick one):** implement it (interpolate `{{VAR}}` from the walk context into the node
  prompt, falling back to the current header+brief behavior), or strip `prompt_template` from the
  canonical graph JSON and note in `config/agentcontrol/README.md` which handoff fields the walker
  honors (`require_tags`, `skip_if_tags`, `max_turns`, `request_type`).

### 29. `safeResolve` sandbox check — tighten the no-op clause
- **File:** `packages/shared/src/anthropic/sandboxTools.ts:192-199`
- **Issue:** `resolve(abs) !== abs` is always false (resolving an already-absolute path is identity)
  — dead guard. Escape protection rests solely on `within.startsWith("..")`, which works (including
  for absolute inputs) but is subtle, and `within.startsWith("..")` would also wrongly reject a file
  literally named `..foo` at the root (cosmetic).
- **Fix:** replace with the idiomatic check: `const within = relative(this.root, abs);` then reject if
  `within === ".." || within.startsWith(".." + sep) || isAbsolute(within)`. Add a couple of unit
  tests (inside, `../escape`, absolute path) — this is the security boundary for agent tool calls.

### 30. `anthropicModelId` mis-handles fully-qualified Bedrock-style ids
- **File:** `packages/shared/src/anthropic/anthropicAgentRunner.ts:173-177`
- **Issue:** the "strip provider prefix" rule (`split(".").slice(1)`) turns
  `us.anthropic.claude-sonnet-4-6-v1:0` into `anthropic.claude-sonnet-4-6-v1:0` — wrong for any
  multi-dot model name. Works today only because LD configs use `Anthropic.claude-…`.
- **Fix:** strip at most one known provider prefix (case-insensitive `anthropic.`), optionally after
  a region segment; otherwise pass through unchanged. One unit test per shape.

### 31. Beacon's fullstack "waiting" path still has no backstop (known, but now load-bearing)
- **Files:** `packages/beacon/src/server.ts:65-71`, `packages/beacon/README.md` (open consideration).
- **Issue:** acknowledged in the plan (§8) and README, but as the prototype heads to partners, a
  lost notification silently strands a release with no retry/timeout and no visibility.
- **Fix (minimum viable):** log "waiting" outcomes with enough detail to act on, and document the
  manual re-trigger (re-POST the notification). A retry queue is overkill for the prototype; an
  honest runbook note is not.

### 32. Test gaps for the code that now does the real work
- **Files:** no tests exist for `packages/shared/src/anthropic/*` (tool dispatch, capability gating,
  tag accumulation, `create_flag` fallback tagging at `sandboxTools.ts:301-304`), `ldWriter.ts`
  (409 → alreadyExists), or `vegaAgentRunner.ts`.
- **Fix:** add focused unit tests with a fake `LdClient`/`writer` and a temp-dir sandbox root:
  read_file/list_dir/grep happy paths, sandbox escape rejection (pairs with #29), edit_file
  uniqueness errors, tag_conversation accumulation, capability-gated tool availability
  (`buildSandboxTools` and executor refusals). No network, no git.

---

## P4 — Nits / consistency

### 33. Naming: "Auto-Factory" vs "AutoFactory" vs "auto-factory"
- README/plan/action.yml say "Auto-Factory"; CHANGELOG/agent configs/commit messages say
  "AutoFactory"; keys/flags use `auto-factory-*` and `autofactory-*` (`gha-auto-factory` graph but
  `autofactory-research-planner` configs). Pick one prose form (suggest **AutoFactory**) and one
  key prefix convention for *new* resources; don't rename existing LD resources (the configs/graph
  in LD are live) — just document the convention in `config/agentcontrol/README.md`.

### 34. `initial_instructions.md` at the repo root
- Historical kickoff brief. Harmless, but for a partner-facing repo consider moving to
  `docs/initial-instructions.md` (and fix the one link in any doc that references it) so the root
  stays: README, CLEANUP, configs, code.

### 35. `.vscode/settings.json` is an empty `{}` (2 bytes), tracked
- Delete it (and add `.vscode/` to `.gitignore`) or put real recommended settings in it.

### 36. `packages/*/tsconfig.tsbuildinfo` clutter
- Untracked (covered by `*.tsbuildinfo`) but sitting in package roots because `tsc -b` defaults
  there. Optional: set `"tsBuildInfoFile": "dist/.tsbuildinfo"` in `tsconfig.base.json` variants to
  keep build state out of source dirs. Cosmetic only.

### 37. README layout table omits `config/agentcontrol/` and the CHANGELOG convention
- `README.md` Layout lists `config/` generically. Given the CHANGELOG-on-config-change convention
  (`config/agentcontrol/CHANGELOG.md`) is a real working agreement, surface it: one line in the
  Layout table or a "Conventions" bullet ("changes to AI configs / the graph / operational flags
  are logged in config/agentcontrol/CHANGELOG.md").

---

## Suggested execution order

1. **P0 first** (#1–#3) — gets CI green and guards the rest of the work.
2. **#4 (seed-from-LD path)** — pure code now (no sanitization review needed since nothing is
   committed); a `seed` CLI command + bootstrap wiring.
3. **The contract triple (#5, #6, #7, #16)** — one PR: env/example, action.yml, preflight, bootstrap
   messages all aligned.
4. **Doc sweep (#9–#15, #17–#23)** — mostly mechanical once the architecture story (#14) is written;
   write ADR 0005 first and let the READMEs reference it.
5. **#8 (release-flags hand-off)** — small code change + doc fix; decide approach with the owner.
6. **P3 refactors** as time allows — #24, #27, #29 have the best value-to-effort for a partner-facing
   prototype.
