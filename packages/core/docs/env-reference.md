
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

The repo-local `.env` lives at `<workspace>/.env` and is read by an explicit-key
reader (`packages/wiki-core/src/lib/node-engine-env-bootstrap.mjs`),
not a general dotenv loader:

- Only the reader's **listed keys** are imported; unsupported keys are ignored
  (never funneled through the secret bootstrap path). The sections below document
  each surface's keys; hosted-tier onboarding keys are provided to onboarded beta
  users separately and are not fully listed here.
- An explicit environment value **wins** — the repo `.env` never overrides a
  value already set in the launcher-minted environment.
- For its diagnostics, the reader returns key *names* and counts rather than
  values. This is the exact parser/result contract, not a general AgentChassis
  credential-leak-prevention guarantee.
- **Malformed lines are ignored** with a value-free count (never a throw); an
  **absent or unreadable `.env` is a no-op**.
- Values are **not** expanded or interpolated — this is a credential carrier,
  not a shell. A single pair of surrounding quotes is stripped; `export ` is
  tolerated.
- The repo-local `.env` is read keyed on the workspace directory
  (`WIKI_MCP_WORKSPACE_DIR` for the MCP server; the launch input's workspace dir
  for the launcher-owned host wiki-MCP server), so launcher surfaces share one
  parser and key list.

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
model = "gpt-5.6-luna"
effort = "medium"   # optional: low | medium | high | xhigh | max

[roles.reviewer]
model = "gpt-5.6-sol"
effort = "high"

[roles.orchestrator]
model = "gpt-5.6-sol"
effort = "high"

[roles.redteam]
model = "gpt-5.6-sol"
effort = "high"
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

These values document the Codex-family template defaults. Installing or updating
the package does not automatically rewrite an existing operator-owned
`agent-launch.toml`; users who copied an older template must intentionally
re-copy the current template or edit their file to adopt the corrected defaults.

For agent MCP dispatch, the normal `workspace_agent_dispatch` input is
`{ role, subject }`. The backend reads this file on every dispatch, so a later
`agent-launch.toml` edit applies to the next call without restarting the server.
Typed `app` and `model` are explicit per-dispatch overrides, not required
fields. Missing, malformed, or registry-unknown role models refuse with an
actionable role-specific configuration diagnostic. Launcher/MCP source-code
changes are loaded modules and require restarting the owning server or launcher
session; that restart boundary does not apply to this per-dispatch config read.

### Per-model LiteLLM routing (`[models."<id>"]`, `[vertexai]`)

The route is a property of the model, not of a role. A registered Codex model
can be routed through a local LiteLLM gateway backed by Vertex AI:

```toml
[models."gpt-5.4"]
use_litellm = true    # false or absent: the model's ordinary route

[vertexai]
credentials_file = "/abs/path/to/service-account.json"  # required when any model uses LiteLLM
project = "my-project-id"   # optional; default: the key's project_id
location = "global"         # default: global
port = 4000                 # default: 4000; endpoint is always http://127.0.0.1:<port>/v1
```

Roles keep selecting models exactly as above (explicit `--model`/typed `model`,
then `[roles.<role>]`). The selected model is resolved first and then decides the
route, so the same model routes identically for the orchestrator, worker,
reviewer, redteam, headless and interactive launches and resume. There is no
per-role switch. `use_litellm` must be a TOML boolean; unknown keys, duplicate
tables, an unregistered model id, a non-Codex model with `use_litellm = true`, a
model whose registry entry declares no Vertex AI mapping, a missing or relative
`credentials_file` while any model sets `use_litellm = true`, and an invalid
`[vertexai]` value refuse before any launch effect, even when the entry is not
selected.

The Vertex AI model that serves a routed model is a registry fact
(`vertex_model` on the Codex entry in `agent-launch-model-registry.mjs`), never
derived from the registered name. A mapping is declared only for a model id
Vertex AI actually publishes. The routable models are the Codex-client entries
`vertex-claude-opus-5-5` (Vertex `claude-opus-5-5`) and
`vertex-claude-sonnet-5-5` (Vertex `claude-sonnet-5-5`): Codex drives Anthropic
models on Vertex through the gateway. `use_litellm = true` on any other model
refuses with `model_route_vertex_model_undeclared`. The Claude Code tokens
`opus`/`sonnet`/`haiku`/`fable` still launch the `claude` CLI and are not
LiteLLM-routable.

Each launch reads `agent-launch.toml` once. The resolved model, effort and route
are frozen and every Codex renderer consumes that value; a later edit applies to
the next launch, never to one already resolved. Resume uses the current model
and its current route in either direction.

Only a real launch or resume whose selected model has `use_litellm = true`
touches the gateway. An ordinary route, an unselected `[models]` entry, invalid
configuration, `--dry-run-json` and inspection do not install anything, probe
Python, create keys or use Google credentials. On first real use the launcher:

1. provisions a private runtime: the host `python3` (CPython 3.12 with `pip`)
   installs the hash-locked LiteLLM release pinned in
   `@agent-chassis/agent-launch-core/data/litellm-gateway/runtime-requirements.lock`
   into a venv at a permanent generation path, and publishes readiness
   atomically only after validation. System Python is never modified. A
   prepared environment may seed the state root with a private interpreter at
   `python/bin/python3` (searched first) and the lock's wheels at `wheelhouse/`
   (installed offline with `--no-index`, hashes still verified);
2. starts one gateway per port for this OS user under
   `$XDG_STATE_HOME/agent-launch/litellm` (default
   `~/.local/state/agent-launch/litellm`, mode 0700). It serves exactly the
   registry's declared mappings (`<model>` -> `vertex_ai/<vertex_model>`) with
   `drop_params: false`, `num_retries: 0` and no fallbacks. Repositories share
   it, concurrent starts converge on one process, and it outlives the launching
   session. A gateway whose state record cannot be published is stopped rather
   than left running unrecorded;
3. gives Codex an exact per-run copy (0600) of the gateway key inside the role's
   own runtime directory, read by `/usr/bin/cat` through Codex's command-backed
   provider auth, and removes it when the run ends.

Only the gateway uses Google credentials: the declared `credentials_file`, a
service-account JSON key that must be a regular file owned by this user and not
readable by group or others. It is checked, and its `project_id` read, before
any setup; it is never copied. The gateway receives it as
`GOOGLE_APPLICATION_CREDENTIALS` in an otherwise closed environment (no
inherited credential variable, gcloud configuration or metadata-host override)
with a private `HOME`; Codex roles never see it. No Google token or key bytes appear in
argv, configuration text or diagnostics.

The launcher never takes over, restarts or stops a gateway. It refuses, with
the exact path and correction, when the port is held by another service, the
running gateway has a different configuration, the recorded gateway is no
longer running, a state or lock file is unreadable, or startup fails or times
out. Recovery is explicit: stop the named process if it is still running, remove
the named state or lock file, and relaunch (or choose another `[vertexai] port`).
Local tests cover the gateway runtime and Codex transport against local fakes;
real Vertex inference through the gateway requires a separately authorized
live check.

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
| `WIKI_MCP_TOOL_PROFILE` | Session role: `operator`, `orchestrator`, `worker`, `reviewer` or `redteam`; any other value refuses startup |

Response-shaping tuning (optional, non-secret): `WIKI_MCP_RESPONSE_STATE_DIR`,
`WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT`, `WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT`,
`WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT`.

## 4. Launcher / operator-owned runtime environment

Set by the operator or minted by the launcher from canonical config — not
repo-local `.env` keys.

| Key | Purpose |
|---|---|
| `AGENT_LAUNCH_RUNTIME_STATE_DIR` | Root for mutable launcher runtime state (nonces, token state). Must resolve outside the repo / `HOME` / `XDG` roots; defaults to an OS-tmpdir location when unset (`packages/agent-launch-core/src/lib/config.mjs`). |
| `AGENT_CHASSIS_MCP_METRICS_ROOT` | Optional host-only **destination** for anonymous MCP metric files. Unset (the default) disables collection with no writer, timer, or file. When set it must be an absolute path to an existing real directory this uid owns at mode `0700`; an invalid value collects nothing and emits one path-free `invalid_config` diagnostic without refusing startup. Launcher-managed host servers receive only the launcher-resolved root, and every receiving host revalidates it. It is not accepted from tool arguments or worker environments, is independent of transcript capture, and is not repo-local `.env` configuration. See [Anonymous MCP metrics](mcp-telemetry.md). |
| `AGENT_CHASSIS_MCP_TRANSCRIPT_ROOT` | Optional observability **destination** that arms the launcher's dormant stdio-MCP transcript capture. Unset (the default) means the conduit spawns the host wiki-MCP server exactly as it always did and records nothing. When set it must be an absolute path to an existing real directory this uid owns at mode `0700`; the launcher re-validates it and mints every per-session directory itself, and anything else disables capture with a diagnostic rather than refusing the launch. It selects no policy, transport, tool surface, or authority, and it is not repo-local `.env` configuration. See [Agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md). |

Other `AGENT_LAUNCH_*` variables (role-guard, isolation, bin-dir) are
launcher-internal plumbing minted from canonical config
for a single launch; they are not operator-facing configuration and should not
be set by hand. Agent-authored environment is never policy authority — any
runtime environment a tool needs must be launcher-minted from canonical config.

## 5. Third-party agent-CLI credentials (intentionally not configured here)

The supported underlying agent CLIs (Claude and Codex) read their **own**
credentials and configuration from their own config/home locations (for example
`CODEX_HOME` and each CLI's vendor credential mechanism). AgentChassis neither
sets, proxies, nor documents those credentials as its own keys. The launcher
references only the narrow approved locations needed to isolate each launch and
never treats them as wiki-MCP authority. Agy is unsupported and receives no
credential or runtime-state projection.

## Secret vs non-secret summary

- **Secret** (never commit, never logged): `NODE_ENGINE_API_KEY` (and its
  `NODE_ENGINE_LICENSE_KEY` alias); third-party agent-CLI credentials.
- **Non-secret** (may appear in diagnostics): role `*_APP` / `*_MODEL`
  selections, the non-credential `NODE_ENGINE_*` service-config keys, and the
  `WIKI_MCP_*` / `AGENT_LAUNCH_RUNTIME_STATE_DIR` settings. The
  `AGENT_CHASSIS_MCP_METRICS_ROOT` and `AGENT_CHASSIS_MCP_TRANSCRIPT_ROOT`
  destinations are non-secret, but diagnostics never print their paths.
