import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  classifyCommand,
  evaluateRoleGuardAction,
  loadRoleGuardConfig,
  validateRoleGuardConfig
} from "../packages/agent-launch-core/src/index.mjs";
import {
  baseConfig,
  executionProof,
  installFixtureEnvGuard,
  launcherProvenance,
  operatorProvenance,
  trustedTargetProof,
  withTempRepo
} from "./agent-role-guard-test-helpers.mjs";

installFixtureEnvGuard();

test("command classifier uses exact argv grammar and rejects ambiguous overlap", () => {
  const config = validateRoleGuardConfig(baseConfig());
  const roleContext = { effective_role: "operator" };
  const classified = classifyCommand({ config, roleContext, argv: ["/usr/bin/git", "status"] });
  assert.equal(classified.category, "read_only");
  assert.deepEqual(classified.normalized_argv, ["git", "status"]);

  const ambiguousConfig = validateRoleGuardConfig(baseConfig({
    command_policy: {
      ...baseConfig().command_policy,
      patterns: [
        { argv: ["git", "status"], category: "read_only" },
        { argv: ["git", "*"], category: "runtime" }
      ]
    }
  }));
  assert.throws(
    () => classifyCommand({ config: ambiguousConfig, roleContext, argv: ["git", "status"] }),
    /ambiguous/
  );
});

test("command evaluation requires executable, spawn, env, and trusted-target proof", async () => {
  await withTempRepo(async (repoRoot) => {
    const config = await loadRoleGuardConfig({ repoRoot });
    const argv = ["npm", "run", "wiki", "--", "generate"];
    const missingProof = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("operator", "WK-0098"),
      action: { type: "check-command", argv }
    });
    assert.equal(missingProof.allowed, false);
    assert.equal(missingProof.decision_code, "schema_invalid");

    const userTargets = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: operatorProvenance(["wiki/**"]),
      action: {
        type: "check-command",
        argv,
        execution_proof: executionProof(argv),
        target_payload: {
          target_source: "user_supplied",
          targets: [{ change_kind: "modify", new_path: "wiki/catalog.md" }]
        }
      }
    });
    assert.equal(userTargets.allowed, false);
    assert.equal(userTargets.decision_code, "target_source_untrusted");

    const allowed = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: operatorProvenance(["wiki/**"]),
      action: {
        type: "check-command",
        argv,
        execution_proof: executionProof(argv),
        target_payload: {
          target_source: "adapter_observed",
          trusted_target_proof: trustedTargetProof(),
          targets: [{ change_kind: "modify", new_path: "wiki/catalog.md" }]
        }
      }
    });
    assert.equal(allowed.allowed, true);

    const missingScope = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("operator", "WK-0098"),
      action: {
        type: "check-command",
        argv,
        execution_proof: executionProof(argv),
        target_payload: {
          target_source: "adapter_observed",
          trusted_target_proof: {
            adapter_id: "wiki-cli",
            capability_id: "bounded-generate",
            containment_mode: "write_ledger",
            ledger_digest: "sha256:ledger",
            observed_write_set: ["wiki/catalog.md"]
          },
          targets: [{ change_kind: "modify", new_path: "wiki/catalog.md" }]
        }
      }
    });
    assert.equal(missingScope.allowed, false);
    assert.equal(missingScope.decision_code, "operator_scope_untrusted");
  });
});

test("worker runtime frontmatter policy must match the command argv", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeFile(
      path.join(repoRoot, "wiki", "issues", "WK-0098.md"),
      [
        "---",
        "id: WK-0098",
        "write_scope:",
        "  - packages/feature/**",
        "runtime_command_policy:",
        "  - docker ps",
        "---",
        "# Work"
      ].join("\n"),
      "utf8"
    );
    const config = await loadRoleGuardConfig({ repoRoot });
    const allowedArgv = ["docker", "ps"];
    const allowed = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: {
        type: "check-command",
        argv: allowedArgv,
        execution_proof: executionProof(allowedArgv)
      }
    });
    assert.equal(allowed.allowed, true);

    const deniedArgv = ["docker", "run"];
    const denied = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: {
        type: "check-command",
        argv: deniedArgv,
        execution_proof: executionProof(deniedArgv)
      }
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.decision_code, "command_denied");

    const nonMatchingRuntime = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: {
        type: "check-command",
        argv: allowedArgv,
        execution_proof: executionProof(allowedArgv)
      },
      workerScope: {
        wk_id: "WK-0098",
        issue_path: "wiki/issues/WK-0098.md",
        write_scope: ["packages/feature/**"],
        runtime_command_policy: "allow-docker",
        frontmatter: {}
      }
    });
    assert.equal(nonMatchingRuntime.allowed, false);
    assert.equal(nonMatchingRuntime.decision_code, "wk_runtime_policy_denied");
  });
});

test("command environment rejects unpinned behavior-affecting variables", async () => {
  await withTempRepo(async (repoRoot) => {
    const config = await loadRoleGuardConfig({ repoRoot });
    const argv = ["git", "status"];
    const denied = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: operatorProvenance(["wiki/**"]),
      action: {
        type: "check-command",
        argv,
        execution_proof: executionProof(argv, { PYTHONPATH: "/tmp/inject" })
      }
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.decision_code, "environment_variable_unpinned");

    const allowed = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: operatorProvenance(["wiki/**"]),
      action: {
        type: "check-command",
        argv,
        execution_proof: executionProof(argv, { NODE_OPTIONS: "--experimental-vm-modules" })
      }
    });
    assert.equal(allowed.allowed, true);
  });
});
