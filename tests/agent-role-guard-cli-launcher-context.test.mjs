import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  buildLauncherContextActionBinding,
  computeActionPayloadHash,
  mintLauncherContext
} from "../packages/agent-launch-core/src/index.mjs";
import {
  executionProof,
  installFixtureEnvGuard,
  parseStdoutJson,
  runAgentLaunch,
  withTempRepo,
  writeJson
} from "./agent-role-guard-test-helpers.mjs";

installFixtureEnvGuard();

async function withLauncherFixture(repoRoot, fn) {
  const secretPath = path.join(repoRoot, "launcher-secret.key");
  const nonceDir = path.join(repoRoot, "launcher-nonces");
  await writeFile(secretPath, "fixture-launcher-secret-1234567890abcdef", { mode: 0o600 });
  await mkdir(nonceDir, { recursive: true });
  await fn({ secretPath, nonceDir });
}

function reviewedMetadataFor(repoRoot, role = "worker", wk = "WK-0098") {
  return {
    review_id: "RV-launcher",
    run_id: "RUN-launcher",
    handoff_id: "HO-0001",
    mode: "implement",
    repo_root: repoRoot,
    input_manifest_hash: "sha256:manifest",
    registry_hash: "sha256:registry",
    role_context: { role, wk }
  };
}

async function mintCheckWriteContext({ secret, repoRoot, paths, role = "worker", wk = "WK-0098", overrides = {}, ttlSeconds = 60, now = new Date() }) {
  const normalized = paths.map((p) => p).sort();
  const actionBinding = buildLauncherContextActionBinding({
    actionType: "check-write",
    repoRoot,
    configPath: ".agent-role-guard.json",
    role,
    wk,
    targetHash: computeActionPayloadHash(normalized)
  });
  return mintLauncherContext({
    secret,
    reviewedMetadata: reviewedMetadataFor(repoRoot, role, wk),
    actionBinding: { ...actionBinding, ...overrides },
    ttlSeconds,
    now
  });
}


test("role-guard CLI verifies --launcher-context for check-write", async () => {
  await withTempRepo(async (repoRoot) => {
    await withLauncherFixture(repoRoot, async ({ secretPath, nonceDir }) => {
      const secret = (await readFile(secretPath, "utf8")).trim();
      const context = await mintCheckWriteContext({
        secret,
        repoRoot,
        paths: ["packages/feature/src/index.mjs"]
      });
      const contextPath = await writeJson(repoRoot, "launcher-context.json", context);
      const allowed = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        contextPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs"
      ]);
      assert.equal(allowed.code, 0, allowed.stderr);
      const payload = parseStdoutJson(allowed);
      assert.equal(payload.allowed, true);
      assert.equal(payload.role, "worker");
      assert.equal(payload.role_source, "launcher_metadata");

      const replay = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        contextPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs"
      ]);
      assert.equal(replay.code, 1);
      assert.equal(parseStdoutJson(replay).decision_code, "launcher_context_replay");
    });
  });
});

test("role-guard CLI verifies reviewer launcher-context without WK", async () => {
  await withTempRepo(async (repoRoot) => {
    await withLauncherFixture(repoRoot, async ({ secretPath, nonceDir }) => {
      const secret = (await readFile(secretPath, "utf8")).trim();
      const context = await mintCheckWriteContext({
        secret,
        repoRoot,
        role: "reviewer",
        wk: null,
        paths: ["packages/feature/src/index.mjs"]
      });
      const contextPath = await writeJson(repoRoot, "reviewer-context.json", context);
      const denied = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        contextPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs"
      ]);
      assert.equal(denied.code, 1);
      const payload = parseStdoutJson(denied);
      assert.equal(payload.role, "reviewer");
      assert.equal(payload.decision_code, "role_read_only");
    });
  });
});

test("role-guard CLI rejects launcher-context with action-binding rebind", async () => {
  await withTempRepo(async (repoRoot) => {
    await withLauncherFixture(repoRoot, async ({ secretPath, nonceDir }) => {
      const secret = (await readFile(secretPath, "utf8")).trim();
      const context = await mintCheckWriteContext({
        secret,
        repoRoot,
        paths: ["packages/feature/src/index.mjs"]
      });
      const contextPath = await writeJson(repoRoot, "launcher-context.json", context);
      const rebound = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        contextPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs",
        "--path",
        "packages/feature/src/extra.mjs"
      ]);
      assert.equal(rebound.code, 1);
      assert.equal(parseStdoutJson(rebound).decision_code, "launcher_context_action_mismatch");
    });
  });
});

test("role-guard CLI rejects launcher-context with bad HMAC and expired context", async () => {
  await withTempRepo(async (repoRoot) => {
    await withLauncherFixture(repoRoot, async ({ secretPath, nonceDir }) => {
      const secret = (await readFile(secretPath, "utf8")).trim();
      const context = await mintCheckWriteContext({
        secret,
        repoRoot,
        paths: ["packages/feature/src/index.mjs"]
      });

      const tampered = { ...context, integrity: "hmac-sha256:bad" };
      const tamperedPath = await writeJson(repoRoot, "tampered-context.json", tampered);
      const tamperedRun = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        tamperedPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs"
      ]);
      assert.equal(tamperedRun.code, 1);
      assert.equal(parseStdoutJson(tamperedRun).decision_code, "launcher_context_bad_integrity");

      const stale = await mintCheckWriteContext({
        secret,
        repoRoot,
        paths: ["packages/feature/src/index.mjs"],
        ttlSeconds: 1,
        now: new Date(Date.now() - 60_000)
      });
      const stalePath = await writeJson(repoRoot, "stale-context.json", stale);
      const staleRun = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        stalePath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs"
      ]);
      assert.equal(staleRun.code, 1);
      assert.equal(parseStdoutJson(staleRun).decision_code, "launcher_context_expired");
    });
  });
});

test("role-guard CLI rejects launcher-context with malformed JSON and missing secret", async () => {
  await withTempRepo(async (repoRoot) => {
    await withLauncherFixture(repoRoot, async ({ secretPath, nonceDir }) => {
      const malformedPath = path.join(repoRoot, "malformed-context.json");
      await writeFile(malformedPath, "{not json", "utf8");
      const malformed = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        malformedPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs"
      ]);
      assert.equal(malformed.code, 1);
      assert.equal(parseStdoutJson(malformed).decision_code, "json_payload_malformed");

      const secret = (await readFile(secretPath, "utf8")).trim();
      const context = await mintCheckWriteContext({
        secret,
        repoRoot,
        paths: ["packages/feature/src/index.mjs"]
      });
      const contextPath = await writeJson(repoRoot, "launcher-context.json", context);
      const missingSecret = await runAgentLaunch([
        "role-guard",
        "check-write",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        contextPath,
        "--launcher-context-secret-path",
        path.join(repoRoot, "missing-secret.key"),
        "--launcher-context-nonce-dir",
        nonceDir,
        "--path",
        "packages/feature/src/index.mjs"
      ]);
      assert.equal(missingSecret.code, 1);
      assert.equal(parseStdoutJson(missingSecret).decision_code, "launcher_context_secret_missing");
    });
  });
});

test("role-guard CLI verifies launcher-context for check-command argv binding", async () => {
  await withTempRepo(async (repoRoot) => {
    await withLauncherFixture(repoRoot, async ({ secretPath, nonceDir }) => {
      const secret = (await readFile(secretPath, "utf8")).trim();
      const argv = ["git", "status"];
      const actionBinding = buildLauncherContextActionBinding({
        actionType: "check-command",
        repoRoot,
        configPath: ".agent-role-guard.json",
        role: "operator",
        wk: "WK-0098",
        rawArgv: argv
      });
      const context = await mintLauncherContext({
        secret,
        reviewedMetadata: reviewedMetadataFor(repoRoot, "operator", "WK-0098"),
        actionBinding
      });
      const contextPath = await writeJson(repoRoot, "command-context.json", context);
      const proofPath = await writeJson(repoRoot, "proof.json", executionProof(argv));

      const allowed = await runAgentLaunch([
        "role-guard",
        "check-command",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        contextPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--execution-proof-json",
        proofPath,
        "--",
        ...argv
      ]);
      assert.equal(allowed.code, 0, allowed.stderr);
      const payload = parseStdoutJson(allowed);
      assert.equal(payload.decision_code, "command_allowed");
      assert.equal(payload.role, "operator");

      const reboundArgv = ["./git", "status"];
      const reboundProofPath = await writeJson(repoRoot, "rebound-proof.json", executionProof(reboundArgv));
      const reboundContext = await mintLauncherContext({
        secret,
        reviewedMetadata: reviewedMetadataFor(repoRoot, "operator", "WK-0098"),
        actionBinding
      });
      const reboundContextPath = await writeJson(repoRoot, "rebound-context.json", reboundContext);
      const rebound = await runAgentLaunch([
        "role-guard",
        "check-command",
        "--repo-root",
        repoRoot,
        "--json",
        "--allow-test-fixture",
        "--launcher-context",
        reboundContextPath,
        "--launcher-context-secret-path",
        secretPath,
        "--launcher-context-nonce-dir",
        nonceDir,
        "--execution-proof-json",
        reboundProofPath,
        "--",
        ...reboundArgv
      ]);
      assert.equal(rebound.code, 1);
      assert.equal(parseStdoutJson(rebound).decision_code, "launcher_context_action_mismatch");
    });
  });
});
