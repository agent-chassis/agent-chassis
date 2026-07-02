import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import {
  ROLE_GUARD_LAUNCHER_AUTHORITY,
  loadRoleGuardConfig,
  parseIssueFrontmatter,
  resolveAgentRole,
  validateRoleGuardConfig
} from "../packages/agent-launch-core/src/index.mjs";
import {
  baseConfig,
  installFixtureEnvGuard,
  launcherProvenance,
  withTempRepo
} from "./agent-role-guard-test-helpers.mjs";

installFixtureEnvGuard();

test("issue frontmatter parser ignores YAML comments", () => {
  const frontmatter = parseIssueFrontmatter([
    "---",
    "id: IN-0011",
    "title: Machine-readable work records and dispatch readiness pipeline",
    "docs: [docs/agent-role-guard.md]",
    "# Retrieval facets are inferred from path/template by default.",
    "# Add overrides only when needed:",
    "# lifecycle: active",
    "---",
    "# Initiative"
  ].join("\n"));
  assert.equal(frontmatter.id, "IN-0011");
  assert.equal(frontmatter.title, "Machine-readable work records and dispatch readiness pipeline");
  assert.deepEqual(frontmatter.docs, ["docs/agent-role-guard.md"]);
});

test("v1 config schema is closed and normalizes redteam through reviewer", () => {
  const config = validateRoleGuardConfig(baseConfig());
  assert.equal(config.roles.aliases.redteam, "reviewer");

  assert.throws(
    () => validateRoleGuardConfig(baseConfig({ schema_version: 2 })),
    /Unsupported role guard schema_version/
  );
  assert.throws(
    () => validateRoleGuardConfig(baseConfig({ roles: { aliases: { redteam: "operator" } } })),
    /redteam/
  );
  assert.throws(
    () => validateRoleGuardConfig(baseConfig({ ...baseConfig(), policies: { ...baseConfig().policies, redteam: { write: {}, commands: {} } } })),
    /policies.redteam/
  );
  assert.throws(
    () => validateRoleGuardConfig(baseConfig({
      command_policy: {
        ...baseConfig().command_policy,
        patterns: [{ argv: ["git", "st*"], category: "read_only" }]
      }
    })),
    /substring wildcards/
  );
});

test("config loading rejects missing production config and accepts explicit test fixture", async () => {
  await withTempRepo(async (repoRoot) => {
    const loaded = await loadRoleGuardConfig({ repoRoot });
    assert.equal(loaded.schema_version, 1);

    await rm(path.join(repoRoot, ".agent-role-guard.json"));
    await assert.rejects(
      () => loadRoleGuardConfig({ repoRoot }),
      /role guard config is missing/
    );
    await assert.rejects(
      () => loadRoleGuardConfig({ repoRoot, fixtureConfig: baseConfig() }),
      /test-only/
    );
    const fixture = await loadRoleGuardConfig({ repoRoot, fixtureConfig: baseConfig(), allowTestFixture: true });
    assert.equal(fixture.command_policy.default_category, "denied");
  });
});

test("role resolution enforces provenance authority and ambiguity rejection", () => {
  const config = baseConfig();
  const resolved = resolveAgentRole({ config, provenance: launcherProvenance("redteam", "WK-0098") });
  assert.equal(resolved.role, "redteam");
  assert.equal(resolved.effective_role, "reviewer");

  assert.throws(
    () => resolveAgentRole({
      config,
      provenance: {
        caller: "shell_wrapper",
        role: { value: "operator", source: "ambient_env" }
      }
    }),
    /may not grant role/
  );
  assert.throws(
    () => resolveAgentRole({
      config,
      provenance: {
        caller: "agent_launch",
        [ROLE_GUARD_LAUNCHER_AUTHORITY]: true,
        session_name: { value: "Implement WK-0098 Review", source: "session_name", trusted: true }
      }
    }),
    /ambiguous/
  );

  const unknown = resolveAgentRole({
    config,
    provenance: { caller: "shell_wrapper", wk: { value: "WK-0098", source: "ambient_env" } }
  });
  assert.equal(unknown.effective_role, "unknown");

  assert.throws(
    () => resolveAgentRole({
      config,
      provenance: {
        caller: "agent_launch",
        launcher_context_verified: true,
        launcher_capability: true,
        role: { value: "worker", source: "launcher_metadata" },
        wk: { value: "WK-0098", source: "launcher_env" }
      }
    }),
    /may not grant role/
  );
});
