

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseAgentLaunchRoleConfigSource
} from "../../packages/agent-launch-cli/src/lib/agent-launch-role-config.mjs";
import {
  resolveCarriedModelSelection,
  resolveLauncherProfile,
  resolveRoleModelSelection
} from "../../packages/agent-launch-cli/src/lib/agent-launch-profiles.mjs";
import {
  LITELLM_CODEX_PROVIDER_ID,
  MODEL_ROUTE_KINDS,
  liteLlmGatewayRoutes,
  validateModelRouting
} from "../../packages/agent-launch-cli/src/lib/agent-launch-model-route.mjs";
import {
  MODEL_REGISTRY,
  buildModelRegistry
} from "../../packages/agent-launch-cli/src/lib/agent-launch-model-registry.mjs";
import {
  CODEX_LITELLM_KEY_READER,
  buildCodexModelProviderOverrides,
  buildCodexReasoningEffortConfigOverrides,
  codexModelArgs
} from "../../packages/agent-launch-cli/src/lib/codex-role-reasoning-effort.mjs";
import {
  resolveDispatchSelection
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-selection.mjs";
import { attachCodexModelRoute } from "../../packages/agent-launch-cli/src/lib/litellm-gateway-launch.mjs";
import {
  LITELLM_GATEWAY_POLICY,
  renderLiteLlmGatewayConfig
} from "../../packages/agent-launch-core/src/lib/litellm-gateway.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const ROUTED_MODEL = "gpt-5.4";
const ORDINARY_MODEL = "gpt-5.5";
const CODEX_ROLES = Object.freeze(["worker", "reviewer", "redteam", "orchestrator", "resume"]);

const TEST_VERTEX_MODEL = "wk2689-test-vertex-model";
const MAPPED_REGISTRY = buildModelRegistry(MODEL_REGISTRY.map(([model, spec]) =>
  model === ROUTED_MODEL ? [model, { ...spec, vertex_model: TEST_VERTEX_MODEL }] : [model, spec]));

function repoWithConfig(t, text) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const dir = mkdtempSync(path.join(os.tmpdir(), "wk2689-routing-"));
  scope.add("repo", () => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "agent-launch.toml"), text, "utf8");
  return dir;
}

const KEY_FILE = "/etc/wk2689/service-account.json";
const KEY_TABLE = `[vertexai]\ncredentials_file = "${KEY_FILE}"\n`;

const ROUTED_CONFIG = [
  KEY_TABLE,
  `[models."${ROUTED_MODEL}"]`,
  "use_litellm = true",
  "",
  `[models."${ORDINARY_MODEL}"]`,
  "use_litellm = false",
  "",
  ...["worker", "reviewer", "redteam", "orchestrator"].flatMap((role) => [
    `[roles.${role}]`, `model = "${ROUTED_MODEL}"`, ""
  ])
].join("\n");

test("model tables parse quoted ids and booleans in the one config snapshot", () => {
  const snapshot = parseAgentLaunchRoleConfigSource([
    '[models."gpt-5.4"]', "use_litellm = true",
    "[models.gpt-6-luna]", "use_litellm = false",
    "[vertexai]", `credentials_file = "${KEY_FILE}"`, 'project = "demo-project-1"', "port = 4100"
  ].join("\n"));
  assert.equal(snapshot.models["gpt-5.4"].use_litellm, true);
  assert.equal(snapshot.models["gpt-6-luna"].use_litellm, false);
  assert.deepEqual(snapshot.vertexai,
    { credentials_file: KEY_FILE, project: "demo-project-1", location: null, port: 4100 });
});

test("invalid model routing declarations refuse with stable codes", () => {
  const cases = [
    ['[models."gpt-5.4"]\nuse_litellm = "true"', "role_config.value_not_boolean"],
    ['[models."gpt-5.4"]\nuse_litellm = 1', "role_config.value_not_boolean"],

    ['[models."gpt-5.4"]\nuse_vertexai = true', "role_config.unsupported_key"],
    ['[roles.worker]\nmodel = "gpt-5.4"\nuse_litellm = true', "role_config.unsupported_key"],
    ['[models."gpt-5.4"]\nuse_litellm = true\nuse_litellm = false', "role_config.duplicate_key"],
    ['[models."gpt-5.4"]\n[models."gpt-5.4"]', "role_config.duplicate_table"],
    ["[models]\nuse_litellm = true", "role_config.models_root_assignment"],
    ['[models."../x"]', "role_config.invalid_model_table"],
    ['[vertexai]\nport = 70000', "role_config.value_not_port"],
    ['[vertexai]\nregion = "us"', "role_config.unsupported_key"]
  ];
  for (const [text, code] of cases) {
    assert.throws(() => parseAgentLaunchRoleConfigSource(text), (error) => error.code === code, text);
  }
});

test("registry validation refuses unknown models and non-Codex LiteLLM routes before any effect", () => {
  const unknown = validateModelRouting(parseAgentLaunchRoleConfigSource('[models."not-a-model"]\nuse_litellm = true'));
  assert.equal(unknown.reason, "model_route_unknown_model");
  const claude = validateModelRouting(parseAgentLaunchRoleConfigSource('[models."opus"]\nuse_litellm = true'));
  assert.equal(claude.reason, "model_route_unsupported_client");
  const project = validateModelRouting(parseAgentLaunchRoleConfigSource('[vertexai]\nproject = "Bad_Project"'));
  assert.equal(project.reason, "model_route_vertex_project_invalid");

  const selection = resolveRoleModelSelection({
    role: "worker",
    model: ORDINARY_MODEL,
    snapshot: parseAgentLaunchRoleConfigSource('[models."opus"]\nuse_litellm = true')
  });
  assert.equal(selection.ok, false);
  assert.equal(selection.reason, "model_route_unsupported_client");
});

test("the selected model decides the same route for every Codex role (CLI funnel)", (t) => {
  const dir = repoWithConfig(t, ROUTED_CONFIG);
  const routes = CODEX_ROLES.map((role) => {
    const resolved = resolveLauncherProfile({ role, env: {}, dir, modelRegistry: MAPPED_REGISTRY });
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    assert.equal(resolved.value.model, ROUTED_MODEL);
    return resolved.value.model_selection.route;
  });
  for (const route of routes) {
    assert.deepEqual(route, routes[0]);
    assert.equal(route.kind, MODEL_ROUTE_KINDS.LITELLM);
    assert.equal(route.base_url, "http://127.0.0.1:4000/v1");
    assert.equal(route.provider_id, LITELLM_CODEX_PROVIDER_ID);
    assert.equal(route.upstream_model, `vertex_ai/${TEST_VERTEX_MODEL}`, "the declared mapping, not the model name");
    assert.deepEqual(route.gateway_routes, [
      { model: ROUTED_MODEL, upstream: `vertex_ai/${TEST_VERTEX_MODEL}` }, ...liteLlmGatewayRoutes()
    ]);
    assert.deepEqual(route.gateway, {
      host: "127.0.0.1", port: 4000, credentials_file: KEY_FILE, vertex_project: null, vertex_location: "global"
    });
  }
});

test("an explicit --model override selects its model first, then that model's route", (t) => {
  const dir = repoWithConfig(t, ROUTED_CONFIG);
  for (const role of CODEX_ROLES) {
    const ordinary = resolveLauncherProfile({ role, model: ORDINARY_MODEL, env: {}, dir, modelRegistry: MAPPED_REGISTRY });
    assert.equal(ordinary.ok, true, JSON.stringify(ordinary));
    assert.equal(ordinary.value.model_selection.route.kind, MODEL_ROUTE_KINDS.ORDINARY);
    const unmapped = resolveLauncherProfile({ role, model: "gpt-6-luna", env: {}, dir, modelRegistry: MAPPED_REGISTRY });
    assert.equal(unmapped.value.model_selection.route.kind, MODEL_ROUTE_KINDS.ORDINARY);
  }
});

test("the MCP dispatch funnel returns the identical frozen selection for dispatched roles", (t) => {
  const dir = repoWithConfig(t, ROUTED_CONFIG);
  for (const role of ["worker", "reviewer", "redteam"]) {
    const selection = resolveDispatchSelection({ role, target: "WK-0001", workspaceDir: dir, modelRegistry: MAPPED_REGISTRY });
    assert.equal(selection.ok, true, JSON.stringify(selection));
    const cli = resolveLauncherProfile({ role, env: {}, dir, modelRegistry: MAPPED_REGISTRY }).value.model_selection;
    assert.deepEqual(selection.model_selection.route, cli.route);
    assert.equal(selection.model_selection.effort, cli.effort);
  }
  const invalid = repoWithConfig(t, '[models."opus"]\nuse_litellm = true\n[roles.worker]\nmodel = "gpt-5.4"\n');
  const refused = resolveDispatchSelection({ role: "worker", target: "WK-0001", workspaceDir: invalid, modelRegistry: MAPPED_REGISTRY });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "model_route_unsupported_client");
});

test("a configuration change after selection cannot alter the launched model, effort or route", (t) => {
  const dir = repoWithConfig(t, `${ROUTED_CONFIG}\n`);
  const selection = resolveLauncherProfile({ role: "reviewer", env: {}, dir, modelRegistry: MAPPED_REGISTRY }).value.model_selection;
  writeFileSync(path.join(dir, "agent-launch.toml"),
    `[roles.reviewer]\nmodel = "${ORDINARY_MODEL}"\neffort = "high"\n`, "utf8");
  let reads = 0;
  const carried = resolveCarriedModelSelection({
    role: "reviewer",
    model: ROUTED_MODEL,
    carried: selection,
    dir,
    readConfigSnapshot: () => { reads += 1; throw new Error("a carried selection must not re-read config"); }
  });
  assert.equal(reads, 0);
  assert.equal(carried.value, selection);
  assert.deepEqual(codexModelArgs({ model_selection: selection }), ["-m", ROUTED_MODEL]);
  assert.deepEqual(buildCodexReasoningEffortConfigOverrides({ role: "reviewer", modelSelection: selection }),
    ["model_reasoning_effort=medium"]);
  assert.equal(selection.route.kind, MODEL_ROUTE_KINDS.LITELLM);
  const mismatch = resolveCarriedModelSelection({ role: "reviewer", model: ORDINARY_MODEL, carried: selection });
  assert.equal(mismatch.reason, "model_selection_model_mismatch");
});

test("resume uses the current model and route in either transition direction", (t) => {
  const dir = repoWithConfig(t, `[roles.orchestrator]\nmodel = "${ROUTED_MODEL}"\n`);
  const ordinary = resolveLauncherProfile({ role: "resume", env: {}, dir, modelRegistry: MAPPED_REGISTRY }).value.model_selection;
  assert.equal(ordinary.route.kind, MODEL_ROUTE_KINDS.ORDINARY);
  writeFileSync(path.join(dir, "agent-launch.toml"),
    `${KEY_TABLE}[roles.orchestrator]\nmodel = "${ROUTED_MODEL}"\n[models."${ROUTED_MODEL}"]\nuse_litellm = true\n`, "utf8");
  assert.equal(resolveLauncherProfile({ role: "resume", env: {}, dir, modelRegistry: MAPPED_REGISTRY }).value.model_selection.route.kind,
    MODEL_ROUTE_KINDS.LITELLM);
  writeFileSync(path.join(dir, "agent-launch.toml"),
    `[roles.orchestrator]\nmodel = "${ROUTED_MODEL}"\n[models."${ROUTED_MODEL}"]\nuse_litellm = false\n`, "utf8");
  assert.equal(resolveLauncherProfile({ role: "resume", env: {}, dir, modelRegistry: MAPPED_REGISTRY }).value.model_selection.route.kind,
    MODEL_ROUTE_KINDS.ORDINARY);
});

test("the shared renderer emits provider overrides only for a LiteLLM route, with an exact key reader", () => {
  const snapshot = parseAgentLaunchRoleConfigSource(
    `[models."${ROUTED_MODEL}"]\nuse_litellm = true\n[vertexai]\nport = 4123\ncredentials_file = "${KEY_FILE}"\n`);
  const routed = resolveRoleModelSelection({ role: "worker", model: ROUTED_MODEL, snapshot, registry: MAPPED_REGISTRY }).value;
  const ordinary = resolveRoleModelSelection({ role: "worker", model: ORDINARY_MODEL, snapshot, registry: MAPPED_REGISTRY }).value;
  assert.deepEqual(buildCodexModelProviderOverrides({ modelSelection: ordinary, keyFilePath: "/k" }), []);
  assert.throws(() => buildCodexModelProviderOverrides({ modelSelection: routed }), /per-run key file/);
  const overrides = buildCodexModelProviderOverrides({ modelSelection: routed, keyFilePath: "/run/key file" });
  assert.deepEqual(overrides, [
    `model_provider="${LITELLM_CODEX_PROVIDER_ID}"`,
    `model_providers.${LITELLM_CODEX_PROVIDER_ID}={name="agent-launch LiteLLM gateway",` +
      'base_url="http://127.0.0.1:4123/v1",wire_api="responses",' +
      `auth={command="${CODEX_LITELLM_KEY_READER}",args=["/run/key file"]}}`,
    'web_search="disabled"'
  ]);

  assert.deepEqual(buildCodexReasoningEffortConfigOverrides({ role: "orch", modelSelection: routed }), []);
  assert.deepEqual(buildCodexReasoningEffortConfigOverrides({ role: "orch-resume", modelSelection: routed }), []);
});

function planWithSelection(selection, secretDir) {
  return {
    role: "worker",
    args: ["exec", "PROMPT"],
    model_selection: selection,
    model_route_secret_dir: secretDir
  };
}

test("ordinary, unselected and selection-less plans reach no gateway effect", async () => {
  const snapshot = parseAgentLaunchRoleConfigSource(`${KEY_TABLE}[models."${ROUTED_MODEL}"]\nuse_litellm = true\n`);
  const ordinary = resolveRoleModelSelection({ role: "worker", model: ORDINARY_MODEL, snapshot, registry: MAPPED_REGISTRY }).value;
  const ensureGateway = () => { throw new Error("an ordinary launch must not ensure a gateway"); };
  for (const plan of [planWithSelection(ordinary, "/nonexistent"), planWithSelection(null, null), { args: [] }]) {
    const before = JSON.stringify(plan.args);
    const attachment = await attachCodexModelRoute(plan, { ensureGateway });
    assert.equal(attachment.attached, false);
    assert.equal(JSON.stringify(plan.args), before);
  }
});

test("a LiteLLM plan gets an exact private per-run key and overrides before the final positional", async (t) => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const dir = mkdtempSync(path.join(os.tmpdir(), "wk2689-attach-"));
  scope.add("dir", () => rmSync(dir, { recursive: true, force: true }));
  const sharedKey = path.join(dir, "master.key");
  writeFileSync(sharedKey, "sk-shared-local-key-0123456789abcdef\n", { mode: 0o600 });
  const snapshot = parseAgentLaunchRoleConfigSource(`${KEY_TABLE}[models."${ROUTED_MODEL}"]\nuse_litellm = true\n`);
  const routed = resolveRoleModelSelection({ role: "worker", model: ROUTED_MODEL, snapshot, registry: MAPPED_REGISTRY }).value;
  const plan = planWithSelection(routed, dir);
  const calls = [];
  const attachment = await attachCodexModelRoute(plan, {
    env: { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/should-not-matter" },
    ensureGateway: async (request) => {
      calls.push(request);
      return { base_url: routed.route.base_url, key_path: sharedKey, generation: "g1", reused: true };
    }
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].route, routed.route);
  assert.equal(plan.args.at(-1), "PROMPT");
  const keyPath = plan.model_route_run_key_path;
  assert.equal(path.dirname(keyPath), dir);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  assert.equal(readFileSync(keyPath, "utf8"), "sk-shared-local-key-0123456789abcdef");
  assert.ok(plan.args.includes(`auth={command="/usr/bin/cat",args=["${keyPath}"]}`) ||
    plan.args.some((arg) => arg.includes(`args=[${JSON.stringify(keyPath)}]`)));
  assert.equal(plan.args.some((arg) => arg.includes("sk-shared-local-key")), false, "no secret bytes in argv");
  attachment.release();
  assert.equal(existsSync(keyPath), false);
  assert.equal(existsSync(sharedKey), true, "the shared key is preserved");
  attachment.release();
});

test("only a declared Vertex mapping can be routed, and the gateway serves exactly the declared table", () => {
  const snapshot = parseAgentLaunchRoleConfigSource(`${KEY_TABLE}[models."${ROUTED_MODEL}"]\nuse_litellm = true\n`);

  assert.deepEqual(liteLlmGatewayRoutes(), [
    { model: "vertex-claude-opus-5-5", upstream: "vertex_ai/claude-opus-5-5" },
    { model: "vertex-claude-sonnet-5-5", upstream: "vertex_ai/claude-sonnet-5-5" }
  ]);
  const undeclared = resolveRoleModelSelection({ role: "worker", model: ROUTED_MODEL, snapshot });
  assert.equal(undeclared.ok, false);
  assert.equal(undeclared.reason, "model_route_vertex_model_undeclared");
  assert.match(undeclared.detail.message, /use_litellm = false/);

  assert.equal(resolveRoleModelSelection({ role: "worker", model: ORDINARY_MODEL, snapshot }).reason,
    "model_route_vertex_model_undeclared");
  assert.throws(() => buildModelRegistry([["opus", { app: "claude", backend: "claude", codex_profile: null,
    default_effort: "max", vertex_model: "x" }]]), /non-codex model opus must not declare vertex_model/);
  assert.throws(() => buildModelRegistry([["m1", { app: "codex", backend: "codex", codex_profile: "worker",
    default_effort: "low", vertex_model: "../evil" }]]), /vertex_model must be a Vertex AI model id/);

  const routes = liteLlmGatewayRoutes(MAPPED_REGISTRY);
  assert.deepEqual(routes, [
    { model: ROUTED_MODEL, upstream: `vertex_ai/${TEST_VERTEX_MODEL}` }, ...liteLlmGatewayRoutes()
  ]);
  const config = renderLiteLlmGatewayConfig({ routes, vertexProject: "demo-project-1", vertexLocation: "global" });
  assert.ok(config.includes(`model_name: "${ROUTED_MODEL}"`));
  assert.ok(config.includes(`model: "vertex_ai/${TEST_VERTEX_MODEL}"`));
  assert.equal(config.includes("vertex_ai/gpt-"), false);
  assert.match(config, /vertex_project: "demo-project-1"/);
  assert.match(config, /master_key: os\.environ\/LITELLM_MASTER_KEY/);
  assert.match(config, /drop_params: false/);
  assert.match(config, /num_retries: 0/);
  assert.match(config, /fallbacks: \[\]/);
  assert.deepEqual(LITELLM_GATEWAY_POLICY.fallbacks, []);
  assert.doesNotMatch(config, /sk-/);
});

test("a LiteLLM route requires an absolute declared service-account key", () => {
  const routed = `[models."${ROUTED_MODEL}"]\nuse_litellm = true\n`;
  const missing = resolveRoleModelSelection({ role: "worker", model: ORDINARY_MODEL,
    snapshot: parseAgentLaunchRoleConfigSource(routed), registry: MAPPED_REGISTRY });
  assert.equal(missing.reason, "model_route_vertex_credentials_undeclared");
  assert.match(missing.detail.correction, /credentials_file = /);
  const relative = resolveRoleModelSelection({ role: "worker", model: ORDINARY_MODEL,
    snapshot: parseAgentLaunchRoleConfigSource(`${routed}[vertexai]\ncredentials_file = "keys/sa.json"\n`),
    registry: MAPPED_REGISTRY });
  assert.equal(relative.reason, "model_route_vertex_credentials_invalid");

  const ordinaryOnly = resolveRoleModelSelection({ role: "worker", model: ORDINARY_MODEL,
    snapshot: parseAgentLaunchRoleConfigSource(`[models."${ROUTED_MODEL}"]\nuse_litellm = false\n`) });
  assert.equal(ordinaryOnly.ok, true);
});
