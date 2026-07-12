

import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";
import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";

const TOOL_NAME = "workspace_agent_dispatch";

const DISPATCH_DESCRIPTION_BUDGET = 1800;

const BANNED_DESCRIPTION_DETAIL = [

  { label: "WK changelog provenance", pattern: /\bWK-\d{3,}\b/ },

  { label: "backend .mjs module path", pattern: /\.mjs\b/ },
];

function captureToolDefinitions() {
  const definitions = new Map();

  registerDispatchTools({
    registerTool: (name, def, _handler) => {
      definitions.set(name, def);
    },
    registeredToolNames: new Set(),
    workspaceRepos: new Map(),
    z,
    jsonContent: (obj) => obj,
    errorContent: (err) => { throw err; },
    resolveWorkspaceRepo: (_repos, repo) => ({ repo: repo ?? "demo", dir: null }),
    dispatchBackend: null,
    dispatchSessionIdentity: "wk0764-model-hint-desc-test"
  });

  return definitions;
}

function getDispatchDescription() {
  const def = captureToolDefinitions().get(TOOL_NAME);
  assert.ok(def, `${TOOL_NAME} must be registered`);
  const desc = def.description;
  assert.equal(typeof desc, "string", "description must be a string");
  assert.ok(desc.length > 0, "description must be non-empty");
  return desc;
}

test("WK-0764 workspace_agent_dispatch description is registered", () => {
  const desc = getDispatchDescription();
  assert.ok(desc.length > 0, "description must be non-empty");
});

test("WK-1381 description makes role and subject the normal call shape", () => {
  const desc = getDispatchDescription();
  assert.ok(
    /normal agent call supplies only `role` and `subject`/i.test(desc),
    "description must teach the normal role+subject call shape"
  );
  assert.ok(
    !/\bapp_required\b/.test(desc),
    "description must not train agents to supply app"
  );
});

test("WK-1381 description identifies agent-launch.toml and neutral derivation", () => {
  const desc = getDispatchDescription();
  assert.ok(
    /agent-launch\.toml/i.test(desc) && /neutral model registry/i.test(desc),
    "description must name the role config and neutral registry"
  );
});

test("WK-1381 description reserves typed app/model for explicit overrides", () => {
  const desc = getDispatchDescription();
  assert.ok(
    /Typed `app` and `model` are explicit per-dispatch overrides only/i.test(desc),
    "description must keep app/model override-only"
  );
  assert.ok(
    /identity carriers.*never become selection authority/i.test(desc),
    "description must keep caller carriers out of selection authority"
  );
});

test("WK-1381 description keeps actionable refusal and supported-family posture", () => {
  const desc = getDispatchDescription();
  assert.ok(
    /actionable role-specific configuration blocker/i.test(desc),
    "description must state actionable role-config refusal"
  );
  assert.ok(
    /codex/i.test(desc) && /claude/i.test(desc) && /agy/i.test(desc),
    "description must retain the supported family vocabulary"
  );
});

test("WK-1010 dispatch description budget: stays within length budget", () => {
  const desc = getDispatchDescription();
  assert.ok(
    desc.length <= DISPATCH_DESCRIPTION_BUDGET,
    `${TOOL_NAME} description is ${desc.length} chars, over the ${DISPATCH_DESCRIPTION_BUDGET} budget; ` +
      "trim selection guidance rather than restoring changelog/essay prose"
  );
});

test("WK-1010 dispatch description budget: no changelog or backend-path detail", () => {
  const desc = getDispatchDescription();
  for (const { label, pattern } of BANNED_DESCRIPTION_DETAIL) {
    assert.ok(
      !pattern.test(desc),
      `${TOOL_NAME} description must not carry ${label} (matched ${pattern})`
    );
  }
});

test("WK-1010 dispatch description budget: no duplicated sentences", () => {
  const desc = getDispatchDescription();
  const sentences = desc
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, " "))

    .filter((s) => s.length >= 30);

  const seen = new Set();
  const duplicates = [];
  for (const sentence of sentences) {
    if (seen.has(sentence)) {
      duplicates.push(sentence);
    }
    seen.add(sentence);
  }

  assert.deepEqual(
    duplicates,
    [],
    `${TOOL_NAME} description repeats sentences verbatim: ${duplicates.join(" | ")}`
  );
});
