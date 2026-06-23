# Cloud Automation prompt (paste into Cursor)

This is the prompt for the **cloud** Cursor Automation (trigger: *Pull request
opened*). It is the cloud counterpart to the local `/autofactory` command
(`dot-cursor/commands/autofactory.md`). Unlike the local command, it tells the
agent to **commit** so Cursor opens a PR — this is the one cloud-specific
override; the shared `@autofactory` rule is otherwise unchanged.

Paste everything below the line into the automation's prompt field at
cursor.com/automations (or via `/automate`). Enable the **LaunchDarkly MCP**
server and the **Open PR** + **Comment on PR** tools for the automation.

---

Run the LaunchDarkly AutoFactory Phase 1 workflow on this pull request, following
the `@autofactory` rule in `.cursor/rules/autofactory.mdc`.

**Loop guard — do this first.** If the change set already contains a
`.release-flags/` manifest covering this change, stop immediately and do nothing.
The automation opens its own PR (with a manifest), and that PR re-fires this same
"pull request opened" trigger; this guard is what keeps it from re-processing its
own output.

**Run the chain.** Work from the PR's diff against its base branch. Go through all
five phases in order — research & plan, flag, metrics, tests, review — fetching
each phase's instructions from LaunchDarkly via the `get-ai-config` MCP tool and
carrying them out with the native tools per the rule's tool-translation table.

Fetch the agent configs from the **factory** project `auto-factory-prototype` —
this is where the agent instructions live, *not* the app project. Create flags
and metrics in the **app** project `autofactory-demo`. (These are the rule's
defaults; if the rule failed to load, these two lines are authoritative.)

**Short-circuit.** If the research phase concludes no flag is needed (config-only,
dependency bump, infrastructure, test-only, or docs with no user-facing behavior
change), stop after research, post a brief comment saying no flag was needed, and
do **not** open a pull request.

**Output (cloud mode — this overrides the rule's "leave edits in the working
tree" instruction).** When the chain finishes and a flag was created, commit all
changes so Cursor opens a pull request from them. Then comment on the triggering
PR with:

- the flag key created, with its LaunchDarkly link
- the metric keys created, with links
- the release-manifest path written
- the review verdict and risk level as a fenced JSON block:
  ```json
  { "review_approved": true, "risk_level": "low" }
  ```
