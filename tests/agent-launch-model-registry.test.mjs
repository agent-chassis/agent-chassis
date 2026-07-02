import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_NAME_SET,
  MODEL_REGISTRY,
  appDefault,
  buildModelRegistry,
  resolveModel
} from "../packages/agent-launch-cli/src/lib/agent-launch-model-registry.mjs";

const VALID_CODEX_SPEC = Object.freeze({
  app: "codex",
  backend: "codex",
  codex_profile: "worker",
  default_effort: "medium"
});

const VALID_CLAUDE_SPEC = Object.freeze({
  app: "claude",
  backend: "claude_filesystem_mcp",
  codex_profile: null,
  default_effort: "max"
});

test("array-source duplicate model names throw before building the registry map", () => {
  assert.throws(
    () => buildModelRegistry([
      ["gpt-duplicate", VALID_CODEX_SPEC],
      ["gpt-duplicate", { ...VALID_CODEX_SPEC, codex_profile: "reviewer" }]
    ]),
    /duplicate model name gpt-duplicate/
  );
});

test("resolveModel returns the model spec and derives app/backend from the registry", () => {
  assert.equal(resolveModel("gpt-5.5").app, "codex");
  assert.equal(resolveModel("gpt-5.5").backend, "codex");
  assert.equal(resolveModel("gpt-5.5-pro").codex_profile, "orchestrator_xhigh");
  assert.equal(resolveModel("gpt-5.4-nano").default_effort, "low");
  assert.equal(resolveModel("fable").app, "claude");
  assert.equal(resolveModel("opus").backend, "claude_filesystem_mcp");
  assert.equal(resolveModel("sonnet").default_effort, "high");
  assert.equal(resolveModel("haiku").default_effort, "medium");
});

test("Claude launcher-facing tokens are stable mode names, not provider API IDs", () => {
  for (const token of ["opus", "sonnet", "haiku", "fable"]) {
    assert.equal(resolveModel(token).app, "claude");
    assert.equal(resolveModel(token).backend, "claude_filesystem_mcp");
  }
  assert.equal(resolveModel("claude-opus-4-8"), null);
  assert.equal(resolveModel("claude-sonnet-5"), null);
  assert.equal(resolveModel("claude-haiku-4-5-20251001"), null);
});

test("one app_default per app is enforced and appDefault exposes the declared model", () => {
  const registry = buildModelRegistry([
    ["codex-default", { ...VALID_CODEX_SPEC, app_default: true }],
    ["claude-default", { ...VALID_CLAUDE_SPEC, app_default: true }]
  ]);

  assert.equal(appDefault("codex", registry), "codex-default");
  assert.equal(appDefault("claude", registry), "claude-default");

  assert.throws(
    () => buildModelRegistry([
      ["codex-default-a", { ...VALID_CODEX_SPEC, app_default: true }],
      ["codex-default-b", { ...VALID_CODEX_SPEC, codex_profile: "reviewer", app_default: true }]
    ]),
    /multiple app_default models for app codex/
  );
});

test("app/model vocabulary overlap is a hard registry load error", () => {
  assert.throws(
    () => buildModelRegistry([
      ["codex", VALID_CODEX_SPEC]
    ]),
    /model name codex collides with app vocabulary/
  );
});

test("resolution has no fallback model when a model or app default is absent", () => {
  assert.equal(resolveModel("not-in-registry"), null);
  assert.equal(appDefault("agy"), null);
});

test("default_effort must be in the neutral effort enum", () => {
  assert.throws(
    () => buildModelRegistry([
      ["gpt-invalid-effort", { ...VALID_CODEX_SPEC, default_effort: "default" }]
    ]),
    /default_effort default is not in low\|medium\|high\|xhigh\|max/
  );
});

test("registry exports the array source and model-name set used by the DEC-0114 scan", () => {
  assert.ok(Array.isArray(MODEL_REGISTRY));
  assert.deepEqual(
    [...MODEL_NAME_SET].sort(),
    [
      "codex-5.3-spark",
      "fable",
      "gpt-5.3-codex",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.4-pro",
      "gpt-5.5",
      "gpt-5.5-pro",
      "haiku",
      "opus",
      "sonnet"
    ].sort()
  );
});
