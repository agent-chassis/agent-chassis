# Run inference through Vertex AI

AgentChassis can route a registered Codex model through a local LiteLLM gateway
to Vertex AI. The supported mappings are `vertex-claude-opus-5-5` and
`vertex-claude-sonnet-5-5`. Codex is the client; Vertex AI serves the Anthropic
model. This route works for an operator-launched orchestrator and for managed
roles that select the same model.

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
[models."vertex-claude-sonnet-5-5"]
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
npx agent-launch orchestrator IN-0001 --model vertex-claude-sonnet-5-5
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
model = "vertex-claude-sonnet-5-5"
```

Managed dispatch then follows the same model route. For the exact configuration,
validation, gateway lifecycle, and recovery rules, see the
[environment reference](env-reference.md#per-model-litellm-routing-modelsid-vertexai).
