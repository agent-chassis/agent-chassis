import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveLauncherProfile } from "../packages/agent-launch-cli/src/lib/agent-launch-profiles.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CODEX_ADAPTER_PATH = path.join(
  REPO_ROOT,
  "packages/agent-launch-cli/src/lib/codex-role-adapter-isolation.mjs"
);
const CODEX_PRESET_PATHS = [
  path.join(REPO_ROOT, "agent-launch.codex.toml"),
  path.join(REPO_ROOT, "packages/core/templates/agent-launch.codex.toml")
];

const LUNA_MODEL = "gpt-5.6-luna";
const SOL_MODEL = "gpt-5.6-sol";
const MINI_MODEL = "gpt-5.4-mini";

const EXPECTED_CODEX_ROLES = {
  worker: { model: LUNA_MODEL, effort: "medium" },
  reviewer: { model: SOL_MODEL, effort: "high" },
  orchestrator: { model: SOL_MODEL, effort: "high" },
  redteam: { model: SOL_MODEL, effort: "high" },
};

function parseRoleMatrix(presetText) {
  return Object.fromEntries(
    Object.entries(EXPECTED_CODEX_ROLES).map(([role]) => {
      const section = presetText
        .split(/\r?\n(?=\[)/)
        .find((candidate) => candidate.startsWith(`[roles.${role}]`));
      assert.ok(section, `shipped Codex preset must declare [roles.${role}]`);
      const model = section.match(/^model = "([^"]+)"$/m)?.[1];
      const effort = section.match(/^effort = "([^"]+)"$/m)?.[1];
      return [role, { model, effort }];
    })
  );
}

test("Codex model authority has no baked Mini default", async (t) => {
  const adapterSource = await readFile(CODEX_ADAPTER_PATH, "utf8");
  assert.doesNotMatch(adapterSource, /\bdefaultModel\b/);
  assert.doesNotMatch(adapterSource, new RegExp(MINI_MODEL.replaceAll(".", "\\.")));

  const [shippedPreset, templatePreset] = await Promise.all(
    CODEX_PRESET_PATHS.map((filePath) => readFile(filePath))
  );
  assert.deepEqual(templatePreset, shippedPreset);

  const presetText = shippedPreset.toString("utf8");
  assert.deepEqual(parseRoleMatrix(presetText), EXPECTED_CODEX_ROLES);
  assert.doesNotMatch(presetText, new RegExp(MINI_MODEL.replaceAll(".", "\\.")));

  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-launch-model-default-neutrality-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    path.join(dir, "agent-launch.toml"),
    `[roles.worker]\nmodel = "${LUNA_MODEL}"\neffort = "medium"\n`,
    "utf8"
  );

  const resolved = resolveLauncherProfile({
    role: "worker",
    env: {},
    dir,
    readWorkspaceEnvValue: () => null
  });
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.equal(resolved.value.model, LUNA_MODEL);
  assert.notEqual(resolved.value.model, MINI_MODEL);
  assert.equal(resolved.value.effort, "medium");
  assert.equal(resolved.value.model_source, "role_config");
});
