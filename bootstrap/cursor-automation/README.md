# AutoFactory Phase 1 as a native Cursor automation (prototype)

A third front end for Phase 1, alongside the GitHub Action
(`packages/phase1-resource-factory`) and the VS Code extension
(`packages/phase1-cursor-extension`). Instead of running our own agent loop, this
runs the chain inside **Cursor's native agent**, so it uses Cursor's own model
subscription. There is no Anthropic API key, which is the point: Cursor does not
expose its models to extensions, but it does run them in its own agent.

Run it two ways: **locally and by hand** (the `/autofactory` command — edits land
in your working tree for review) or as a **cloud Automation** (a GitHub trigger
fires a cloud sandbox that opens a PR). Both share the same artifacts; see
[Run as a cloud Automation](#run-as-a-cloud-automation).

It is kept separate from the extension and the TypeScript packages on purpose:
these are just editor config artifacts (`.cursor/` rules, a command, an MCP
config, and one shell script), not compiled code.

## How it works

A bootstrap rule (`rules/autofactory.mdc`) owns the sequencing, the LaunchDarkly
conventions, and a tool-translation table. The five agents' detailed
instructions stay in LaunchDarkly (the source of truth); the rule has the agent
**fetch each phase's instructions at run time** via the LaunchDarkly MCP
`get-ai-config` tool, then carry them out with Cursor's native tools.

The translation matters: the LaunchDarkly instructions name tools from our other
runtimes (`create_flag`, `create_metric`, `commit_and_push`, ...). The rule maps
each to a native equivalent:

- `create_flag` to the LaunchDarkly MCP `create-feature-flag` tool
- `create_metric` to `create-metric.sh` (LaunchDarkly has no metric MCP tool)
- file edits, `git diff`, tests to Cursor's native file/terminal tools
- `commit_and_push` to nothing: edits are left in the working tree for you

## Layout

```
bootstrap/cursor-automation/
  README.md
  dot-cursor/                      # rename or merge into a target repo's .cursor/
    rules/autofactory.mdc          # bootstrap rule: sequencing + tool translation + conventions
    commands/autofactory.md        # the /autofactory manual command
    mcp.json                       # LaunchDarkly MCP server config (add your api key)
    autofactory/create-metric.sh   # metric creation via LD REST (no MCP tool exists)
```

## Prerequisites

- Cursor, and Node (the LaunchDarkly MCP server runs via `npx`).
- A LaunchDarkly API access token (`api-...`) with access to **both** projects:
  the factory project that holds the agent configs (`auto-factory-prototype`,
  read via `get-ai-config`) and the app project where flags and metrics are
  created (`autofactory-demo`).
- `LD_API_KEY` exported in the shell you launch Cursor from (the metric script
  reads it).

## Install into a target app repo

1. Copy `dot-cursor/` into the target repo as `.cursor/` (or merge its contents
   into an existing `.cursor/`).
2. In `.cursor/mcp.json`, replace `REPLACE_WITH_LD_API_KEY` with your token. Do
   not commit a real token. Then enable the **LaunchDarkly** MCP server in
   Cursor settings.
3. Export `LD_API_KEY` in your shell so `create-metric.sh` can call the REST API.
4. If your project keys differ from the defaults, edit them in
   `rules/autofactory.mdc` (factory and app project keys).

## Run

1. On a feature branch in the target repo, make a normal change (no flag).
2. In Cursor, run the `/autofactory` command (or ask the agent to "run
   AutoFactory on my changes" and `@autofactory`).
3. The agent goes through research, flag, metrics, tests, and review, fetching
   each phase's instructions from LaunchDarkly. It creates the flag (MCP) and
   metrics (script) in the app project, writes the `.release-flags/...json`
   manifest, adds flag-on/flag-off tests, and reports a verdict.
4. Review the edits in Cursor's Source Control panel and commit them yourself.
   Nothing is committed or pushed for you.

## Run as a cloud Automation

The same artifacts also back a **cloud** Cursor Automation: a GitHub trigger
fires a cloud sandbox that clones the repo, runs the chain, and opens a PR — no
local Cursor session, no manual command. The chain, the `@autofactory` rule, and
the LaunchDarkly-hosted instructions are identical; only the trigger, the
secret/MCP wiring, and the output (a PR instead of working-tree edits) differ.

Setup, once the `dot-cursor/` artifacts are in your target app repo on GitHub:

1. **Environment.** `dot-cursor/environment.json` installs the app's deps so the
   Tests phase can run. Adjust its `install` command to your repo's layout (the
   shipped one matches the demo app: a Node `frontend/` + a Python `backend/`).
2. **Secret.** Add `LD_API_KEY` (an `api-…` token with access to both projects)
   in cursor.com/dashboard/cloud-agents → Secrets. It surfaces to the sandbox as
   `$LD_API_KEY`, which both `create-metric.sh` and the MCP server use. Never
   commit the token — this repo is public.
3. **MCP.** Register the LaunchDarkly MCP server in the MCP dropdown at
   cursor.com/agents (cloud agents configure MCP in the web, not from the repo's
   `.cursor/mcp.json`), referencing the `LD_API_KEY` secret instead of an inline
   key.
4. **Automation.** Create an automation (cursor.com/automations or `/automate`)
   with trigger *Pull request opened*, the prompt from
   [`cloud-automation-prompt.md`](cloud-automation-prompt.md), and the
   **LaunchDarkly MCP** + **Open PR** + **Comment on PR** tools enabled.

The prompt carries a loop guard (skip if the change set already has a
`.release-flags/` manifest) because the PR the automation opens would otherwise
re-fire the "pull request opened" trigger.

## Limitations (prototype)

- **Two ways to run.** The local `/autofactory` command (above) leaves edits in
  your working tree; the cloud Automation opens a PR. Both share these artifacts.
- **Approval is advisory.** The reviewer's verdict is reported, not enforced
  (the edits are already in your tree). Hook-based gating is a later option.
- **Metrics use a REST script** because LaunchDarkly's MCP server has no
  metric-creation tool. Flags use the MCP tool.
- **Fetch-and-obey reliability** is exactly what this prototype tests: whether an
  agent reliably pulls each phase's instructions from LaunchDarkly and follows
  them. If it proves flaky, the fallback is to bake the five prompt bodies into
  `.cursor/rules/` (synced from `config/agentcontrol/ai-configs/`).
- **No LaunchDarkly agent-generation metrics.** Cursor's runtime does not emit
  the per-agent token/duration tracking the Node runtimes do.

## Relation to the other front ends

Same Phase 1 chain, same LaunchDarkly-hosted instructions, same release-manifest
handoff to Phase 2. The Action commits to a PR in CI; the extension edits your
working tree using a direct Anthropic key; this path edits your working tree
using Cursor's own models. None of them depend on each other.
