import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  executionProof,
  installFixtureEnvGuard,
  parseStdoutJson,
  runAgentLaunch,
  withTempRepo,
  writeJson
} from "./agent-role-guard-test-helpers.mjs";

installFixtureEnvGuard();

function testWorkerProvenance(wk = "WK-0098") {
  return {
    caller: "test_fixture",
    role: { value: "worker", source: "test_fixture" },
    wk: { value: wk, source: "test_fixture" },
    config: { path: ".agent-role-guard.json", source: "repo_config" },
    session_name: { value: null, source: "absent", trusted: false }
  };
}

function testOperatorProvenance(scope = ["wiki/**"]) {
  return {
    caller: "test_fixture",
    role: { value: "operator", source: "test_fixture" },
    wk: { value: "WK-0098", source: "test_fixture" },
    operator_write_scope: { value: scope, source: "operator_config" },
    config: { path: ".agent-role-guard.json", source: "repo_config" },
    session_name: { value: null, source: "absent", trusted: false }
  };
}

test("role-guard CLI check-write emits stable JSON and exit codes", async () => {
  await withTempRepo(async (repoRoot) => {
    const provenancePath = await writeJson(repoRoot, "worker-provenance.json", testWorkerProvenance());
    const allowed = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      provenancePath,
      "--path",
      "packages/feature/src/index.mjs"
    ]);
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.deepEqual(parseStdoutJson(allowed), {
      schema_version: 1,
      allowed: true,
      decision_code: "write_allowed",
      category: "denied",
      role: "worker",
      role_source: "test_fixture",
      action: "check-write",
      config_source: ".agent-role-guard.json",
      targets: [
        {
          path: "packages/feature/src/index.mjs",
          allowed: true,
          matched_rules: ["packages/feature/**"]
        }
      ],
      reason: null
    });

    const denied = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      provenancePath,
      "--path",
      "packages/other/src/index.mjs"
    ]);
    assert.equal(denied.code, 1);
    assert.equal(parseStdoutJson(denied).decision_code, "write_scope_denied");

    const mixedPaths = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      provenancePath,
      "--path",
      "packages/feature/src/index.mjs",
      "--path",
      "packages/other/src/index.mjs"
    ]);
    const mixed = parseStdoutJson(mixedPaths);
    assert.equal(mixedPaths.code, 1);
    assert.equal(mixed.decision_code, "write_scope_denied");
    assert.deepEqual(mixed.targets.map((target) => target.path), [
      "packages/feature/src/index.mjs",
      "packages/other/src/index.mjs"
    ]);
  });
});

test("role-guard CLI rejects malformed options, JSON, and untrusted provenance", async () => {
  await withTempRepo(async (repoRoot) => {
    const ambientPath = await writeJson(repoRoot, "ambient-provenance.json", {
      caller: "shell_wrapper",
      role: { value: "worker", source: "ambient_env" },
      wk: { value: "WK-0098", source: "ambient_env" }
    });
    const unknownOption = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--json",
      "--bogus"
    ]);
    assert.equal(unknownOption.code, 1);
    assert.equal(parseStdoutJson(unknownOption).decision_code, "option_unknown");

    const productionFixtureRejected = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--provenance-json",
      await writeJson(repoRoot, "test-provenance.json", testWorkerProvenance()),
      "--path",
      "packages/feature/src/index.mjs"
    ]);
    assert.equal(productionFixtureRejected.code, 1);
    assert.equal(parseStdoutJson(productionFixtureRejected).decision_code, "test_fixture_rejected");

    const ambientDenied = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--provenance-json",
      ambientPath,
      "--path",
      "packages/feature/src/index.mjs"
    ]);
    assert.equal(ambientDenied.code, 1);
    assert.equal(parseStdoutJson(ambientDenied).decision_code, "role_source_untrusted");

    const malformedJsonPath = path.join(repoRoot, "malformed.json");
    await writeFile(malformedJsonPath, "{", "utf8");
    const malformed = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--provenance-json",
      malformedJsonPath,
      "--path",
      "packages/feature/src/index.mjs"
    ]);
    assert.equal(malformed.code, 1);
    assert.equal(parseStdoutJson(malformed).decision_code, "json_payload_malformed");

    const launcherContext = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--launcher-context",
      path.join(repoRoot, "context.json"),
      "--provenance-json",
      ambientPath,
      "--path",
      "packages/feature/src/index.mjs"
    ]);
    assert.equal(launcherContext.code, 1);
    assert.equal(parseStdoutJson(launcherContext).decision_code, "option_conflict");

    const selfAssertedLauncherPath = await writeJson(repoRoot, "self-asserted-launcher.json", {
      caller: "agent_launch",
      launcher_context_verified: true,
      launcher_capability: true,
      role: { value: "worker", source: "launcher_metadata" },
      wk: { value: "WK-0098", source: "launcher_env" }
    });
    const selfAssertedLauncher = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--repo-root",
      repoRoot,
      "--json",
      "--provenance-json",
      selfAssertedLauncherPath,
      "--path",
      "packages/feature/src/index.mjs"
    ]);
    assert.equal(selfAssertedLauncher.code, 1);
    assert.equal(parseStdoutJson(selfAssertedLauncher).decision_code, "launcher_authority_unverified");

    const jsonFlagMalformed = await runAgentLaunch([
      "role-guard",
      "check-write",
      "--json=true"
    ]);
    assert.equal(jsonFlagMalformed.code, 1);
    assert.equal(parseStdoutJson(jsonFlagMalformed).decision_code, "option_value_invalid");
  });
});

test("role-guard CLI check-diff validates structured target payloads", async () => {
  await withTempRepo(async (repoRoot) => {
    const provenancePath = await writeJson(repoRoot, "worker-provenance.json", testWorkerProvenance());
    const targetsPath = await writeJson(repoRoot, "targets.json", {
      target_source: "adapter_observed",
      targets: [{ change_kind: "create", new_path: "packages/feature/src/new.mjs" }]
    });
    const allowed = await runAgentLaunch([
      "role-guard",
      "check-diff",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      provenancePath,
      "--targets-json",
      targetsPath
    ]);
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.equal(parseStdoutJson(allowed).decision_code, "write_allowed");

    const badTargetsPath = await writeJson(repoRoot, "bad-targets.json", {
      target_source: "adapter_observed",
      targets: [{ change_kind: "rename", new_path: "packages/feature/src/new.mjs" }]
    });
    const badTargets = await runAgentLaunch([
      "role-guard",
      "check-diff",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      provenancePath,
      "--targets-json",
      badTargetsPath
    ]);
    assert.equal(badTargets.code, 1);
    assert.equal(parseStdoutJson(badTargets).decision_code, "target_endpoint_missing");
  });
});

test("role-guard CLI check-command rejects ambiguity and target-proof gaps", async () => {
  await withTempRepo(async (repoRoot) => {
    const operatorPath = await writeJson(repoRoot, "operator-provenance.json", testOperatorProvenance(["wiki/**"]));
    const proofPath = await writeJson(repoRoot, "proof.json", executionProof(["git", "status"]));
    const explain = await runAgentLaunch(["role-guard", "explain", "--json"], { cwd: repoRoot });
    assert.equal(explain.code, 0, explain.stderr);
    const explainJson = parseStdoutJson(explain);
    assert.equal(explainJson.launcher_context_supported, true);
    assert.ok(explainJson.guarded_launcher_operations.some((entry) => entry.includes("code_review")));
    assert.ok(explainJson.hook_only_or_unguarded_surfaces.some((entry) => entry.includes("Codex hooks")));

    const allowed = await runAgentLaunch([
      "role-guard",
      "check-command",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      operatorPath,
      "--execution-proof-json",
      proofPath,
      "--",
      "git",
      "status"
    ]);
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.equal(parseStdoutJson(allowed).decision_code, "command_allowed");

    const missingArgv = await runAgentLaunch([
      "role-guard",
      "check-command",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      operatorPath,
      "--execution-proof-json",
      proofPath
    ]);
    assert.equal(missingArgv.code, 1);
    assert.equal(parseStdoutJson(missingArgv).decision_code, "command_argv_missing");

    const shellString = await runAgentLaunch([
      "role-guard",
      "check-command",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      operatorPath,
      "--execution-proof-json",
      proofPath,
      "--",
      "git status"
    ]);
    assert.equal(shellString.code, 1);
    assert.equal(parseStdoutJson(shellString).decision_code, "command_shell_string_rejected");

    const mutatingArgv = ["npm", "run", "wiki", "--", "generate"];
    const mutatingProofPath = await writeJson(repoRoot, "mutating-proof.json", executionProof(mutatingArgv));
    const missingTargets = await runAgentLaunch([
      "role-guard",
      "check-command",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      operatorPath,
      "--execution-proof-json",
      mutatingProofPath,
      "--",
      ...mutatingArgv
    ]);
    assert.equal(missingTargets.code, 1);
    assert.equal(parseStdoutJson(missingTargets).decision_code, "schema_invalid");

    const userTargetsPath = await writeJson(repoRoot, "user-targets.json", {
      target_source: "user_supplied",
      targets: [{ change_kind: "modify", new_path: "wiki/catalog.md" }]
    });
    const userTargets = await runAgentLaunch([
      "role-guard",
      "check-command",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      operatorPath,
      "--execution-proof-json",
      mutatingProofPath,
      "--targets-json",
      userTargetsPath,
      "--",
      ...mutatingArgv
    ]);
    assert.equal(userTargets.code, 1);
    assert.equal(parseStdoutJson(userTargets).decision_code, "target_source_untrusted");

    const noProofTargetsPath = await writeJson(repoRoot, "no-proof-targets.json", {
      target_source: "adapter_observed",
      targets: [{ change_kind: "modify", new_path: "wiki/catalog.md" }]
    });
    const noProof = await runAgentLaunch([
      "role-guard",
      "check-command",
      "--repo-root",
      repoRoot,
      "--json",
      "--allow-test-fixture",
      "--provenance-json",
      operatorPath,
      "--execution-proof-json",
      mutatingProofPath,
      "--targets-json",
      noProofTargetsPath,
      "--",
      ...mutatingArgv
    ]);
    assert.equal(noProof.code, 1);
    assert.equal(parseStdoutJson(noProof).decision_code, "schema_invalid");
  });
});
