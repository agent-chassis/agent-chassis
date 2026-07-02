

import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";
import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";

const TOOL_NAME = "workspace_agent_dispatch";
const STALE_MODEL_HINT_VERBS = /\b(?:ignore|ignores|ignored|drop|drops|dropped)\b/i;

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

function getModelHintBehaviorSentence(desc) {
  const sentenceMatch = desc.match(
    /[^.]*?(?:model_hint_unsupported_for_codex_executor|model_hint_unsupported_for_agy_executor)[^.]*\./i
  );

  assert.ok(
    sentenceMatch,
    "description must include the caller-visible model-hint behavior sentence"
  );

  return sentenceMatch[0];
}

test("WK-0764 workspace_agent_dispatch description is registered", () => {
  const desc = getDispatchDescription();
  assert.ok(desc.length > 0, "description must be non-empty");
});

test("WK-0764 model hint: Codex refuses with stable reason code", () => {
  const desc = getModelHintBehaviorSentence(getDispatchDescription());
  assert.ok(
    desc.includes("model_hint_unsupported_for_codex_executor"),
    "description must name the Codex model-hint refusal reason code"
  );
});

test("WK-0764 model hint: Agy refuses with stable reason code", () => {
  const desc = getModelHintBehaviorSentence(getDispatchDescription());
  assert.ok(
    desc.includes("model_hint_unsupported_for_agy_executor"),
    "description must name the Agy model-hint refusal reason code"
  );
});

test("WK-0764 model hint: description says Codex and Agy explicitly refuse", () => {
  const desc = getModelHintBehaviorSentence(getDispatchDescription());
  assert.ok(
    /(?:Codex.*Agy|Agy.*Codex).*?\brefuse\b.*\bunsupported model hints\b/i.test(desc),
    "description must say Codex and Agy refuse unsupported model hints"
  );
});

test("WK-0764 model hint: Claude honors supported hints", () => {
  const desc = getModelHintBehaviorSentence(getDispatchDescription());
  assert.ok(
    /\bClaude honors supported model hints\b/i.test(desc),
    "description must say Claude honors supported model hints"
  );
});

test("WK-0764 model hint: description must not say Codex/Agy ignore hints (anti-regression)", () => {
  const desc = getModelHintBehaviorSentence(getDispatchDescription());
  assert.ok(
    !STALE_MODEL_HINT_VERBS.test(desc),
    "description must not say Codex or Agy ignore or drop the model hint"
  );
});

test("WK-1010 model hint: app selector caveat stays caller-visible", () => {
  const desc = getDispatchDescription();
  assert.ok(
    /\bapp_required\b/.test(desc),
    "description must keep the app_required refusal caveat for a missing app"
  );
  assert.ok(
    /\bunsupported_app\b/.test(desc),
    "description must keep the unsupported_app refusal caveat"
  );
  assert.ok(
    /codex/i.test(desc) && /claude/i.test(desc) && /agy/i.test(desc),
    "description must name the codex/claude/agy app selector that gates a launch"
  );
});

test("WK-1010 model hint: typed model field is the only hint source", () => {
  const desc = getDispatchDescription();
  assert.ok(
    /\bmodel\b/i.test(desc) && /\bhint\b/i.test(desc),
    "description must keep the typed model-hint caveat for app/model disposition"
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
