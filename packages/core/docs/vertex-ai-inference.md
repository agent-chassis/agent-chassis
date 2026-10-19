# Run inference through Vertex AI

AgentChassis can route a registered Codex model through a local LiteLLM gateway
to Vertex AI. The registered mappings are `vertex-claude-opus-5-5`,
`vertex-claude-sonnet-5-5`, `vertex-gemini-3.8-flash`, and
`vertex-gemini-4-argon`. Codex is the client;
Vertex AI serves the selected Anthropic or Gemini model. This route works for
an operator-launched orchestrator and for managed roles that select the same model.

Start with the [quickstart](quickstart.md) to install AgentChassis, set up the
repository, and initialize the launcher. You also need a Google Cloud project
with access to the selected Vertex AI model and a service-account JSON key for
that project. Keep the key outside the repository. The launcher requires the key
file to be owned by your user and inaccessible to group and other users.

## Configure the route

Set the key's permissions, then edit the repository's `agent-launch.toml`:

```sh
chmod 600 /absolute/path/to/service-account.json
```

```toml
[models."vertex-gemini-3.8-flash"]
use_litellm = true

[vertexai]
credentials_file = "/absolute/path/to/service-account.json"
location = "global"
```

Use the real absolute path in `credentials_file`; do not put the key's contents
in the TOML file. The gateway uses the key's `project_id` by default. Set
`project = "your-project-id"` under `[vertexai]` if you need a different project.
The default gateway port is `4000`; set `port` under `[vertexai]` if that port
is already in use. The selected model must be available to your project in the
configured location.

## Start an inference session

From the configured repository, launch an orchestrator with the routed model:

```sh
npx agent-launch orchestrator IN-0001 --model vertex-gemini-3.8-flash
```

Replace `IN-0001` with your initiative ID. The command starts an interactive
Codex session. On the first real routed launch, AgentChassis prepares its pinned
LiteLLM runtime and starts the local gateway; this requires host CPython 3.12
with `pip` and access to the required packages unless the runtime has been
prepared offline. The gateway alone reads the Google key. It persists for later
sessions under the same user and port.

To make this model the default for a role, set that role's `model` in
`agent-launch.toml`, for example:

```toml
[roles.worker]
model = "vertex-gemini-3.8-flash"
```

Managed dispatch then follows the same model route. For the exact configuration,
validation, gateway lifecycle, and recovery rules, see the
[environment reference](env-reference.md#per-model-litellm-routing-modelsid-vertexai).

## Gemini 4 Argon runtime boundary

`vertex-gemini-4-argon` is a Codex-client registry entry with upstream
`vertex_ai/gemini-4-argon` and default effort `high`. Its Vertex location is
`global`. A `[models."vertex-gemini-4-argon"]` table with `use_litellm = true`
enables the route; the table does not register a model.

The repository's `agent-launch.argon.vertex.toml` selects Argon at `high` for
the orchestrator and `medium` for reviewer/redteam, and Gemini 3.8 Flash at
`medium` for workers. The packaged LiteLLM runtime is pinned to `1.105.1`.
Streaming `/v1/responses` requests with `reasoning.effort = medium` or `high`
produce `generationConfig.thinkingConfig.thinkingLevel` with the corresponding
value and no `thinkingBudget`, as required by the
[official Argon reference](https://docs.litellm.ai/blog/gemini-4-argon).

The hash lock and its regeneration input live in
`@agent-chassis/agent-launch-core/data/litellm-gateway/`. The repository
provisioner installs the exact hash-locked runtime into a private generation;
changing the lock selects a new generation. Keep the runtime pin and lock
together. Do not drop effort or change retries or fallbacks to make a model fit.

`tests/integration/argon-vertex-runtime.test.mjs` qualifies the pinned runtime
using the repository gateway config generator, fake ADC and a loopback-only
fake Vertex server. It exercises text streaming and function-call/result round
trips for Argon `medium` and `high`, and Flash `medium`, while inspecting each
upstream model, location and thinking level. Requests use the ordinary Responses
effort field without forced parameter admission. The fake upstream rejects
budgets. Stream-start 429s produce `response.failed` with
`rate_limit_exceeded` after exactly one upstream attempt; a later client request
can recover. Gateway retries remain zero, fallbacks remain empty, and the Codex
provider still sets five stream retries. Native Codex retry execution is a
separate transport boundary and is not exercised by this no-agent test.

These tests establish neither Google project access nor live model success.
Set `AGENTCHASSIS_LITELLM_PYTHON` to the pinned venv's Python, then run through
the repository runner:

```sh
node tests/run-tests.mjs integration tests/integration/argon-vertex-runtime.test.mjs --test-reporter=spec
```

Existing prepared images retain their installed package contents. They need a
fresh package selection containing the updated `@agent-chassis/agent-launch-cli`
registry and `@agent-chassis/agent-launch-core` runtime pin and lock, through the
supported preparation path; a TOML edit alone cannot refresh these assets.
Local development preparation uses the complete freshly packed AgentChassis
package set and a new package-selection record. The provisioning stage's cache
identity includes the packaged lock and gateway module. Existing shared gateways
retain their running runtime; a launch against a differing configuration digest
refuses with `litellm_gateway_config_conflict` and offers a separate `[vertexai]`
port. Replacing a running gateway requires its operator to stop it explicitly.
Runtime qualification does not itself refresh images or restart gateways.
Core packaging regenerates the bundled documentation.
