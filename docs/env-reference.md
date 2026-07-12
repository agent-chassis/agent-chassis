
# Environment and `.env` configuration reference

This page is the canonical reference for the environment variables and repo-local
`.env` keys that AgentChassis reads. Keys are grouped by **class** (who owns them
and where they are read), with secret vs. non-secret called out.

Two framing rules first:

- **`.env` is a configuration carrier, not an admission or enforcement boundary.**
  The local packages prepare and record configuration and evidence; policy and
  admission *decisions* belong to the hosted policy/admission service boundary
  where applicable. A value in `.env` configures a client; it does not grant or
  enforce anything by itself.
- **Authority/precedence:** an explicit launcher/operator-supplied environment
  value always wins over a repo-local `.env` value where the source implements
  that precedence. Agent-authored inline environment is **not** policy authority.

## How the repo-local `.env` is read

The repo-local `.env` lives at `<workspace>/.env` and is read by a narrow,
allowlisted reader (`packages/wiki-core/src/lib/node-engine-env-bootstrap.mjs`),
not a general dotenv loader:

- Only **allowlisted keys** are ever imported; unsupported keys are ignored
  (never funneled through the secret bootstrap path). The sections below document
  each surface's keys; hosted-tier onboarding keys are provided to onboarded beta
  users separately and are not fully listed here.
- An explicit environment value **wins** — the repo `.env` never overrides a
  value already set in the launcher-minted environment.
- Secret values are copied **value-free**: the reader returns only key *names*
  and counts, never the value, so credentials are never logged or echoed.
- **Malformed lines are ignored** with a value-free count (never a throw); an
  **absent or unreadable `.env` is a no-op**.
- Values are **not** expanded or interpolated — this is a credential carrier,
  not a shell. A single pair of surrounding quotes is stripped; `export ` is
  tolerated.
- The repo-local `.env` is read keyed on the workspace directory
  (`WIKI_MCP_WORKSPACE_DIR` for the MCP server; the launch input's workspace dir
  for the host-write-authority broker), so both launcher surfaces share one
  parser and allowlist.

> `.env.example` at the repo root is **operator documentation only** — the
> launcher does not read it. Copy the keys you need into the real
> `<workspace>/.env`. Keep `.env` out of version control; never commit a real
> secret.

## 1. Hosted Chassis Control Engine service keys (repo-local `.env`)

An optional, private-beta hosted Chassis Control Engine adds remote admission and
signed run attestation. **The local substrate works fully without it** — these
keys matter only if you have been onboarded to the beta, and the configuration
details are provided to onboarded users separately. `NODE_ENGINE_API_KEY` is a
secret and must never be committed or logged. Thresholds, defaults, and admission
outcomes are the hosted service's, not local product policy.

## 2. Agent-launch role defaults (repo-root `agent-launch.toml`)

Non-secret launcher settings selecting the default model — and optional reasoning
effort — for base-role launches (`agent-launch worker|review|redteam <unit>`) live
in the committed repo-root `agent-launch.toml`, not in `.env` next to secrets. Each
role is a `[roles.<role>]` sub-table:

```toml
[roles.worker]
model = "gpt-5.5"
effort = "medium"   # optional: low | medium | high | xhigh | max

[roles.reviewer]
model = "gpt-5.5"

[roles.orchestrator]
model = "opus"

[roles.redteam]
model = "opus"
effort = "max"
```

`model` is required; `effort` is optional (`low | medium | high | xhigh | max`).
The app/backend are derived from the neutral model registry (`decision`), not
declared independently. A duplicate `[roles.<role>]` table, an unknown role, or an
unknown effort value is a load-time error.

Legacy `.env` role model keys (`WORKER_MODEL`, `REVIEWER_MODEL`,
`ORCHESTRATOR_MODEL`, `REDTEAM_MODEL`) are migration inputs only. The migration
copies them into `agent-launch.toml` and does not copy secrets. Legacy
`WORKER_APP`, `REVIEWER_APP`, `ORCHESTRATOR_APP`, and `REDTEAM_APP` values are
deprecated; if one disagrees with the app derived from its role model, migration
refuses with an actionable error naming the stale app key to remove or fix.

Precedence for later launch resolution remains: an explicit launch override wins
over the role default, and missing or unknown declarations refuse pre-spawn in
the resolver funnel. `.env` remains the repo-local carrier for Chassis Control Engine
service configuration and secrets only.

For agent MCP dispatch, the normal `workspace_agent_dispatch` input is
`{ role, subject }`. The backend reads this file on every dispatch, so a later
`agent-launch.toml` edit applies to the next call without restarting the server.
Typed `app` and `model` are explicit per-dispatch overrides, not required
fields. Missing, malformed, or registry-unknown role models refuse with an
actionable role-specific configuration diagnostic. Launcher/MCP source-code
changes are loaded modules and require restarting the owning server or launcher
session; that restart boundary does not apply to this per-dispatch config read.

## 3. MCP server environment keys

Configuration for the `wiki-mcp` stdio server process — **server configuration,
not repo-local policy.** See [mcp-integration.md](mcp-integration.md) for the
full precedence and resolution rules.

| Key | Purpose |
|---|---|
| `WIKI_MCP_REPOS` | Configured workspace repositories |
| `WIKI_MCP_DEFAULT_REPO` | Default repo when none is specified |
| `WIKI_MCP_WORKSPACE_ALIAS` | Repo alias selection |
| `WIKI_MCP_WORKSPACE_DIR` | Workspace directory the server operates on |
| `WIKI_MCP_TOOL_PROFILE` | Tool-surface profile |

Response-shaping tuning (optional, non-secret): `WIKI_MCP_RESPONSE_STATE_DIR`,
`WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT`, `WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT`,
`WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT`.

## 4. Launcher / operator-owned runtime environment

Set by the operator or minted by the launcher from canonical config — not
repo-local `.env` keys.

| Key | Purpose |
|---|---|
| `AGENT_LAUNCH_RUNTIME_STATE_DIR` | Root for mutable launcher runtime state (nonces, token state). Must resolve outside the repo / `HOME` / `XDG` roots; defaults to an OS-tmpdir location when unset (`packages/agent-launch-core/src/lib/config.mjs`). |

Other `AGENT_LAUNCH_*` variables (role-guard, host-write-authority broker,
isolation, bin-dir) are launcher-internal plumbing minted from canonical config
for a single launch; they are not operator-facing configuration and should not
be set by hand. Agent-authored environment is never policy authority — any
runtime environment a tool needs must be launcher-minted from canonical config.

## 5. Third-party agent-CLI credentials (intentionally not configured here)

The underlying agent CLIs (Claude, Codex, Agy) read their **own** credentials and
configuration from their own config/home locations (e.g. `CODEX_HOME`, and each
CLI's own API-key/credential mechanism). AgentChassis neither sets, proxies, nor
documents those credentials as its own keys — configure each agent CLI per its
own vendor instructions. The launcher only references such locations to isolate
them per launch, never to supply credentials.

## Secret vs non-secret summary

- **Secret** (never commit, never logged): `NODE_ENGINE_API_KEY` (and its
  `NODE_ENGINE_LICENSE_KEY` alias); third-party agent-CLI credentials.
- **Non-secret** (may appear in diagnostics): role `*_APP` / `*_MODEL`
  selections, the non-credential `NODE_ENGINE_*` service-config keys, and the
  `WIKI_MCP_*` / `AGENT_LAUNCH_RUNTIME_STATE_DIR` settings.
