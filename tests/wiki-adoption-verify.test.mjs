import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readdir, access, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  bootstrapRepo,
  runAdoptionVerify,
  ADOPTION_VERIFY_REQUIRED_CHECK_IDS,
  validateWorkRecordDispatch
} from "../packages/wiki-core/src/index.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = path.join(repoRoot, "packages", "wiki-cli", "src", "index.mjs");

const REQUIRED_IDS = ["wiki-retrieval", "work-records", "generate-lint", "graph-impact", "dispatch-preflight"];

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-adoption-verify-test-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeFirstRunLauncherSetup(tempDir) {
  await writeFile(
    path.join(tempDir, "AGENTS.md"),
    [
      "# AGENTS.md",
      "",
      "Repo-adapted operating contract for adoption verify tests.",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(tempDir, "agent-launch.toml"),
    [
      "[roles.orchestrator]",
      'model = "codex-test-orchestrator"',
      "",
      "[roles.worker]",
      'model = "codex-test-worker"',
      "",
      "[roles.reviewer]",
      'model = "codex-test-reviewer"',
      "",
      "[roles.redteam]",
      'model = "codex-test-redteam"',
      ""
    ].join("\n")
  );
  await mkdir(path.join(tempDir, ".agent-launch"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".agent-launch", "launchers.v1.json"),
    JSON.stringify(
      {
        schema_version: "agent-launchers.v1",
        data: {
          agents: {
            codex: {
              base_argv: ["codex", "exec"]
            },
            claude: {
              base_argv: ["claude", "--print"]
            }
          }
        }
      },
      null,
      2
    )
  );
  await writeFile(path.join(tempDir, ".agent-launch", "role-guard-secret.key"), "test-secret\n");
}

async function listAllFiles(rootDir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.push(path.relative(rootDir, full).replaceAll(path.sep, "/"));
      }
    }
  }
  await walk(rootDir);
  return out.sort();
}

async function updateWk0001(tempDir, update) {
  const wkPath = path.join(tempDir, "wiki", "work-records", "WK-0001.json");
  const record = JSON.parse(await readFile(wkPath, "utf8"));
  await update(record);
  await writeFile(wkPath, `${JSON.stringify(record, null, 2)}\n`);
}

async function setSeededSliceStatus(tempDir, status) {
  await updateWk0001(tempDir, (record) => {
    const seededSlice = record.slices.find((slice) => slice.id === "SLICE-001");
    assert.ok(seededSlice, "bootstrap must seed WK-0001#SLICE-001");
    seededSlice.status = status;
  });
}

test("runAdoptionVerify exposes the required-check ids in deterministic order", () => {
  assert.deepEqual([...ADOPTION_VERIFY_REQUIRED_CHECK_IDS], REQUIRED_IDS);
});

test("runAdoptionVerify returns the adoption-verify.v1 envelope with all five required checks in order on a bootstrapped repo", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-ready" });
    await writeFirstRunLauncherSetup(tempDir);

    const parentReadiness = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: "WK-0001"
    });
    assert.equal(
      parentReadiness.dispatchable,
      false,
      "the role-less parent is deliberately not a dispatchable substitute for its seeded slice"
    );

    const result = await runAdoptionVerify({ dir: tempDir, repo: "agent-chassis/adoption-verify-ready" });

    assert.equal(result.schema, "adoption-verify.v1");
    assert.equal(result.repo, "agent-chassis/adoption-verify-ready");
    assert.equal(result.dir, path.resolve(tempDir));
    assert.equal(result.persisted_evidence, false);

    const requiredEntries = result.checks.filter((check) => check.required);
    assert.deepEqual(
      requiredEntries.map((check) => check.check),
      REQUIRED_IDS,
      "expected exactly the five required checks in deterministic order"
    );
    assert.deepEqual(
      result.checks.slice(0, 5).map((check) => check.check),
      REQUIRED_IDS,
      "expected the five required checks to lead the checks[] array in order"
    );

    for (const check of result.checks) {
      assert.equal(typeof check.check, "string");
      assert.equal(typeof check.title, "string");
      assert.ok(["pass", "fail", "skipped"].includes(check.status), `bad status: ${check.status}`);
      assert.equal(typeof check.required, "boolean");
      assert.ok(["verification", "operator-owned"].includes(check.kind), `bad kind: ${check.kind}`);
      assert.equal(typeof check.detail, "string");
      assert.ok("evidence" in check);
      assert.ok("blocker" in check);
      assert.ok("remediation" in check);
    }

    for (const check of requiredEntries) {
      assert.equal(check.status, "pass", `expected required check ${check.check} to pass`);
      assert.equal(check.kind, "verification");
    }
    assert.equal(result.agent_operable, true);
    assert.equal(result.verdict, "ready");
    const dispatchPreflight = result.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(dispatchPreflight.evidence.unit, "WK-0001#SLICE-001");
    assert.equal(dispatchPreflight.evidence.tracker_unit, "WK-0001");
    assert.equal(dispatchPreflight.evidence.tracker_mode, "pre-dispatch");
    assert.equal(dispatchPreflight.evidence.dispatch_target, true);
    assert.equal(dispatchPreflight.evidence.dispatchable, true);
    assert.doesNotMatch(dispatchPreflight.detail, /review-only/);

    assert.equal(result.summary.total, result.checks.length);
    const recomputed = { pass: 0, fail: 0, skipped: 0 };
    for (const check of result.checks) {
      recomputed[check.status] += 1;
    }
    assert.equal(result.summary.pass, recomputed.pass);
    assert.equal(result.summary.fail, recomputed.fail);
    assert.equal(result.summary.skipped, recomputed.skipped);
  });
});

test("runAdoptionVerify is read-only: it writes no evidence sidecar or any repo file", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-readonly" });

    const before = await listAllFiles(tempDir);
    const result = await runAdoptionVerify({ dir: tempDir });
    const after = await listAllFiles(tempDir);

    assert.equal(result.persisted_evidence, false);
    assert.deepEqual(after, before, "adoption verify must not create, remove, or rename any repo file");

    await assert.rejects(
      access(path.join(tempDir, "wiki", "work-records", "evidence")),
      /ENOENT/,
      "adoption verify must not create the work-record evidence sidecar directory"
    );
    const graphImpactCheck = result.checks.find((check) => check.check === "graph-impact");
    assert.equal(graphImpactCheck.evidence.persisted_evidence, false);
  });
});

test("runAdoptionVerify blocks (agent_operable:false) when a required check fails but still reports all five checks", async () => {
  await withTempDir(async (tempDir) => {

    const result = await runAdoptionVerify({ dir: tempDir });

    assert.equal(result.verdict, "blocked");
    assert.equal(result.agent_operable, false);

    const requiredEntries = result.checks.filter((check) => check.required);
    assert.deepEqual(
      requiredEntries.map((check) => check.check),
      REQUIRED_IDS,
      "all five required checks must still be represented when blocked"
    );

    const workRecords = result.checks.find((check) => check.check === "work-records");
    assert.equal(workRecords.status, "fail");
    assert.ok(workRecords.blocker && typeof workRecords.blocker.code === "string");
    assert.ok(workRecords.remediation, "a failing required check must carry remediation");

    assert.ok(requiredEntries.some((check) => check.status !== "pass"));
  });
});

test("WK-1747 runAdoptionVerify reports the seeded implementation slice and no review slice while operator setup is missing", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-bookkeeping" });

    const blocked = await runAdoptionVerify({ dir: tempDir });
    assert.equal(blocked.verdict, "blocked", "a bare bootstrapped repo must not be ready");
    assert.equal(blocked.agent_operable, false);

    const workRecords = blocked.checks.find((check) => check.check === "work-records");
    assert.equal(workRecords.status, "pass", "seeded WK-0001 must validate before operator setup");
    assert.deepEqual(workRecords.evidence.implementation_slices, [{ id: "SLICE-001", status: "todo" }]);

    assert.deepEqual(
      workRecords.evidence.review_slices,
      [],
      "WK-0001 must seed no review slice; adoption verification is coordinator-owned read-only work"
    );

    const dispatchPreflight = blocked.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(dispatchPreflight.status, "fail", "dispatch-preflight must fail on missing operator setup");
    assert.equal(dispatchPreflight.blocker.code, "operator_first_run_prerequisites_missing");
    assert.match(
      `${dispatchPreflight.blocker.code}: ${dispatchPreflight.blocker.message}`,
      /operator_first_run_prerequisites_missing: .*agent-launch\.toml/,
      "missing launcher config must be surfaced as an operator-owned first-run prerequisite"
    );
    assert.equal(dispatchPreflight.evidence.agents_md.present, false);
    assert.equal(dispatchPreflight.evidence.launcher_toml.present, false);
    assert.equal(dispatchPreflight.evidence.launcher_init_config.registry_present, false);
    assert.equal(dispatchPreflight.evidence.launcher_init_config.role_guard_secret_present, false);
    assert.match(dispatchPreflight.remediation, /agent-launch\.toml/);

    assert.doesNotMatch(
      dispatchPreflight.remediation,
      /AGENTS\.md/,
      "a missing root AGENTS.md must not be framed as a dispatch-preflight remediation step"
    );
    const agentsMdInfo = blocked.checks.find((check) => check.check === "agents-md");
    assert.ok(agentsMdInfo, "AGENTS.md readiness must still be reported by an informational check");
    assert.equal(agentsMdInfo.required, false, "the agents-md check must be non-gating");
    assert.equal(agentsMdInfo.kind, "operator-owned");
    assert.equal(agentsMdInfo.blocker, null, "the informational agents-md check must never carry a blocker");

    for (const check of blocked.checks.filter(
      (entry) => entry.required && entry.check !== "dispatch-preflight"
    )) {
      assert.equal(check.status, "pass", `expected required check ${check.check} to pass`);
    }

    await writeFirstRunLauncherSetup(tempDir);
    const ready = await runAdoptionVerify({ dir: tempDir });
    assert.equal(ready.verdict, "ready", "operator first-run setup must unblock the repo");
    assert.equal(ready.agent_operable, true);
    const readyDispatchPreflight = ready.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(readyDispatchPreflight.status, "pass");
    assert.equal(readyDispatchPreflight.evidence.unit, "WK-0001#SLICE-001");
    assert.equal(readyDispatchPreflight.evidence.tracker_mode, "pre-dispatch");
  });
});

test("WK-1747 distributed WK-0001 carries only its seeded implementation work", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-blocked-slice" });
    await writeFirstRunLauncherSetup(tempDir);

    const result = await runAdoptionVerify({ dir: tempDir });
    const workRecords = result.checks.find((check) => check.check === "work-records");
    assert.equal(workRecords.status, "pass");
    assert.equal(workRecords.evidence.work_kind, "implementation");
    assert.equal(workRecords.evidence.write_scope_count, 1);
    assert.deepEqual(workRecords.evidence.implementation_slices, [{ id: "SLICE-001", status: "todo" }]);
    assert.doesNotMatch(
      workRecords.detail,
      /review-only/,
      "current seeded implementation topology must not be described as review-only"
    );

    assert.deepEqual(
      workRecords.evidence.review_slices,
      [],
      "the distributed WK-0001 must carry no review slice"
    );
    assert.equal(result.verdict, "ready");
  });
});

test("WK-1994 adoption-verify never checks or reports a consumer-local docs/adoption.md", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-doc" });

    const result = await runAdoptionVerify({ dir: tempDir });

    assert.equal(
      result.checks.find((check) => /adoption-doc|adoption-guide/.test(check.check)),
      undefined,
      "adoption-verify must report no consumer adoption-guide check"
    );
    assert.ok(
      !JSON.stringify(result).includes("docs/adoption.md"),
      "no adoption-verify check, detail, evidence, or remediation may name docs/adoption.md"
    );

    const requiredEntries = result.checks.filter((check) => check.required);
    assert.deepEqual(
      requiredEntries.map((check) => check.check),
      REQUIRED_IDS,
      "removing the adoption-guide informational check must not disturb the five required checks"
    );
  });
});

test("WK-1994 a consumer-authored docs/adoption.md does not reintroduce an adoption-guide check", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-authored-doc" });

    await mkdir(path.join(tempDir, "docs"), { recursive: true });
    await writeFile(
      path.join(tempDir, "docs", "adoption.md"),
      "# Our own adoption notes\n\nRepo-specific operating notes.\n",
      "utf8"
    );

    const result = await runAdoptionVerify({ dir: tempDir });

    assert.equal(
      result.checks.find((check) => /adoption-doc|adoption-guide/.test(check.check)),
      undefined,
      "a consumer-authored adoption guide must not create an adoption-guide check"
    );
    assert.ok(
      !JSON.stringify(result).includes("docs/adoption.md"),
      "adoption-verify must not report a consumer-authored docs/adoption.md"
    );
  });
});

test("runAdoptionVerify remediation strings are package-portable (npx -p @agent-chassis/wiki-cli wiki, no `npm run wiki`)", async () => {
  await withTempDir(async (tempDir) => {

    const result = await runAdoptionVerify({ dir: tempDir });

    const remediations = result.checks
      .map((check) => check.remediation)
      .filter((text) => typeof text === "string" && text.length > 0);
    assert.ok(remediations.length > 0, "expected failing checks to surface remediation strings");

    for (const remediation of remediations) {
      assert.ok(
        !/npm run wiki/.test(remediation),
        `remediation must not require the non-portable npm-script form: ${remediation}`
      );
    }

    const cliRemediations = remediations.filter((text) =>
      /\b(bootstrap|build-search-index|generate|lint|validate-dispatch|work-records)\b/.test(text)
    );
    assert.ok(cliRemediations.length > 0, "expected at least one wiki CLI remediation command");
    for (const remediation of cliRemediations) {
      assert.match(
        remediation,
        /npx -p @agent-chassis\/wiki-cli wiki /,
        `remediation must be package-qualified with the explicit bin: ${remediation}`
      );
      assert.match(
        remediation,
        /--dir "\$PWD"/,
        `remediation must pass an explicit --dir "$PWD": ${remediation}`
      );
    }
  });
});

test("runAdoptionVerify --checks selects a subset and skips the rest (still all five required present)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-subset" });

    const result = await runAdoptionVerify({ dir: tempDir, checks: ["wiki-retrieval"] });

    const wikiRetrieval = result.checks.find((check) => check.check === "wiki-retrieval");
    assert.equal(wikiRetrieval.status, "pass");

    for (const id of REQUIRED_IDS.filter((value) => value !== "wiki-retrieval")) {
      const entry = result.checks.find((check) => check.check === id);
      assert.equal(entry.status, "skipped", `expected unselected required check ${id} to be skipped`);
    }

    assert.equal(result.verdict, "blocked");
    assert.equal(result.agent_operable, false);

    assert.deepEqual(
      result.checks.filter((check) => check.required).map((check) => check.check),
      REQUIRED_IDS
    );
  });
});

test("adoption verify CLI exits 0 with --json on a ready repo and nonzero when blocked", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-exit" });
    await writeFirstRunLauncherSetup(tempDir);

    const ready = await execFileAsync(process.execPath, [
      entrypoint,
      "adoption",
      "verify",
      "--dir",
      tempDir,
      "--json"
    ]);
    const readyEnvelope = JSON.parse(ready.stdout);
    assert.equal(readyEnvelope.schema, "adoption-verify.v1");
    assert.equal(readyEnvelope.verdict, "ready");
    assert.equal(readyEnvelope.agent_operable, true);

    assert.equal(ready.stderr, "");
  });

  await withTempDir(async (tempDir) => {

    let caught;
    try {
      await execFileAsync(process.execPath, [
        entrypoint,
        "adoption",
        "verify",
        "--dir",
        tempDir,
        "--json"
      ]);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "expected nonzero exit when blocked");
    assert.notEqual(caught.code, 0);
    const envelope = JSON.parse(caught.stdout);
    assert.equal(envelope.verdict, "blocked");
    assert.equal(envelope.agent_operable, false);
  });
});

test("adoption verify CLI blocked text output uses no success/agent-operable language", async () => {
  await withTempDir(async (tempDir) => {
    let caught;
    try {
      await execFileAsync(process.execPath, [entrypoint, "adoption", "verify", "--dir", tempDir]);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "expected nonzero exit on blocked text run");
    assert.match(caught.stdout, /BLOCKED/);
    assert.match(caught.stdout, /NOT confirmed agent-operable/);
    assert.doesNotMatch(
      caught.stdout,
      /READY\.|All \d+ required adoption checks passed/,
      "blocked output must not use ready/success language"
    );
  });
});

async function makeWk0001NonDispatchableImplementation(tempDir) {
  await updateWk0001(tempDir, (record) => {
    const seededSlice = record.slices.find((slice) => slice.id === "SLICE-001");
    assert.ok(seededSlice, "bootstrap must seed WK-0001#SLICE-001");
    seededSlice.dispatch_intent = {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    };

    seededSlice.write_scope = [
      "packages/a/src/one.mjs",
      "packages/b/src/two.mjs",
      "docs/three.md",
      "tests/four.test.mjs"
    ];
    seededSlice.repo_paths = [...seededSlice.write_scope];
    record.write_scope = [...seededSlice.write_scope];
    record.repo_paths = [...seededSlice.repo_paths];
  });
}

test("runAdoptionVerify is blocked (agent_operable:false) when WK-0001 is non-dispatchable (missing_graph_impact), even though validate-dispatch returns a structured decision", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-nondispatchable" });
    await writeFirstRunLauncherSetup(tempDir);
    await makeWk0001NonDispatchableImplementation(tempDir);

    const exactReadiness = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: "WK-0001#SLICE-001"
    });
    assert.equal(exactReadiness.dispatchable, false);
    assert.equal(exactReadiness.decision_code, "missing_graph_impact");

    const result = await runAdoptionVerify({ dir: tempDir });

    assert.equal(result.verdict, "blocked");
    assert.equal(result.agent_operable, false);

    const dispatchPreflight = result.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(dispatchPreflight.status, "fail", "dispatch-preflight must fail when WK-0001 is non-dispatchable");
    assert.equal(dispatchPreflight.evidence.unit, "WK-0001#SLICE-001");
    assert.equal(dispatchPreflight.evidence.dispatchable, false);
    assert.equal(dispatchPreflight.evidence.decision_code, exactReadiness.decision_code);
    assert.deepEqual(dispatchPreflight.evidence.reasons, exactReadiness.reasons);
    assert.ok(
      dispatchPreflight.blocker && typeof dispatchPreflight.blocker.code === "string",
      "a failing dispatch-preflight must carry a structured blocker"
    );
    assert.match(
      dispatchPreflight.blocker.message,
      /missing_graph_impact/,
      "the blocker message must name the non-dispatchable decision code"
    );
    assert.ok(dispatchPreflight.remediation, "a failing dispatch-preflight must carry remediation");

    for (const check of result.checks.filter((entry) => entry.required && entry.check !== "dispatch-preflight")) {
      assert.equal(check.status, "pass", `expected required check ${check.check} to still pass`);
    }

    assert.deepEqual(
      result.checks.filter((check) => check.required).map((check) => check.check),
      REQUIRED_IDS
    );
  });
});

test("adoption verify CLI exits nonzero when WK-0001 is non-dispatchable (missing_graph_impact)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-nondispatchable-cli" });
    await writeFirstRunLauncherSetup(tempDir);
    await makeWk0001NonDispatchableImplementation(tempDir);

    let caught;
    try {
      await execFileAsync(process.execPath, [entrypoint, "adoption", "verify", "--dir", tempDir, "--json"]);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "expected nonzero exit when WK-0001 is non-dispatchable");
    assert.notEqual(caught.code, 0);
    const envelope = JSON.parse(caught.stdout);
    assert.equal(envelope.verdict, "blocked");
    assert.equal(envelope.agent_operable, false);
    const dispatchPreflight = envelope.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(dispatchPreflight.status, "fail");
    assert.equal(dispatchPreflight.evidence.unit, "WK-0001#SLICE-001");
    assert.equal(dispatchPreflight.evidence.dispatchable, false);
  });
});

test("WK-1995 post-dispatch active, review, and done states skip dispatch validation while launcher prerequisites still gate", async () => {
  for (const status of ["active", "review", "done"]) {
    await withTempDir(async (tempDir) => {
      await bootstrapRepo({ dir: tempDir, repo: `agent-chassis/adoption-verify-${status}` });
      await setSeededSliceStatus(tempDir, status);
      await makeWk0001NonDispatchableImplementation(tempDir);

      const directReadiness = await validateWorkRecordDispatch({
        dir: tempDir,
        unitAddress: "WK-0001#SLICE-001"
      });
      assert.equal(
        directReadiness.dispatchable,
        false,
        `${status} must be non-dispatchable if validate-dispatch is called directly`
      );

      const prerequisitesMissing = await runAdoptionVerify({ dir: tempDir });
      const blockedPreflight = prerequisitesMissing.checks.find(
        (check) => check.check === "dispatch-preflight"
      );
      assert.equal(blockedPreflight.status, "fail");
      assert.equal(blockedPreflight.blocker.code, "operator_first_run_prerequisites_missing");
      assert.equal(blockedPreflight.evidence.tracker_mode, "post-dispatch");
      assert.equal(blockedPreflight.evidence.observed_status, status);
      assert.equal(blockedPreflight.evidence.dispatch_target, false);
      assert.equal("dispatchable" in blockedPreflight.evidence, false);

      await writeFirstRunLauncherSetup(tempDir);
      const ready = await runAdoptionVerify({ dir: tempDir });
      const readyPreflight = ready.checks.find((check) => check.check === "dispatch-preflight");
      assert.equal(ready.verdict, "ready");
      assert.equal(readyPreflight.status, "pass");
      assert.equal(readyPreflight.evidence.initial_dispatch_gate, "crossed");
      assert.equal(readyPreflight.evidence.observed_status, status);
      assert.equal("decision_code" in readyPreflight.evidence, false);
      assert.equal("reasons" in readyPreflight.evidence, false);
    });
  }
});

test("WK-1995 invalid or unloadable WK-0001 returns the stable adoption lifecycle blocker", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-invalid-record" });
    await writeFirstRunLauncherSetup(tempDir);
    await writeFile(
      path.join(tempDir, "wiki", "work-records", "WK-0001.json"),
      "{ invalid JSON\n"
    );

    const result = await runAdoptionVerify({ dir: tempDir });
    const dispatchPreflight = result.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(result.verdict, "blocked");
    assert.equal(result.agent_operable, false);
    assert.equal(dispatchPreflight.status, "fail");
    assert.equal(dispatchPreflight.blocker.code, "adoption_lifecycle_blocked");
    assert.equal(dispatchPreflight.evidence.tracker_mode, "invalid");
    assert.equal(dispatchPreflight.evidence.tracker_valid, false);
    assert.equal(dispatchPreflight.evidence.dispatch_target, undefined);
  });
});

test("WK-1995 missing SLICE-001 in the current topology refuses without parent fallback", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-missing-slice" });
    await writeFirstRunLauncherSetup(tempDir);
    await updateWk0001(tempDir, (record) => {
      record.slices = [];
    });

    const result = await runAdoptionVerify({ dir: tempDir });
    const dispatchPreflight = result.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(result.verdict, "blocked");
    assert.equal(dispatchPreflight.status, "fail");
    assert.equal(dispatchPreflight.blocker.code, "adoption_lifecycle_blocked");
    assert.equal(dispatchPreflight.evidence.tracker_mode, "missing-seeded-slice");
    assert.equal(dispatchPreflight.evidence.unit, "WK-0001#SLICE-001");
    assert.equal(dispatchPreflight.evidence.dispatch_target, undefined);
    assert.equal("dispatchable" in dispatchPreflight.evidence, false);
  });
});

test("WK-1995 inbox, blocked, parked, and cancelled slice states return typed lifecycle refusals", async () => {
  for (const status of ["inbox", "blocked", "parked", "cancelled"]) {
    await withTempDir(async (tempDir) => {
      await bootstrapRepo({ dir: tempDir, repo: `agent-chassis/adoption-verify-refused-${status}` });
      await writeFirstRunLauncherSetup(tempDir);
      await setSeededSliceStatus(tempDir, status);

      const result = await runAdoptionVerify({ dir: tempDir });
      const dispatchPreflight = result.checks.find(
        (check) => check.check === "dispatch-preflight"
      );
      assert.equal(result.verdict, "blocked", `${status} must not report adoption ready`);
      assert.equal(result.agent_operable, false);
      assert.equal(dispatchPreflight.status, "fail");
      assert.equal(dispatchPreflight.blocker.code, "adoption_lifecycle_blocked");
      assert.equal(dispatchPreflight.evidence.tracker_mode, "lifecycle-refused");
      assert.equal(dispatchPreflight.evidence.observed_status, status);
      assert.equal(dispatchPreflight.evidence.dispatch_target, undefined);
      assert.equal("dispatchable" in dispatchPreflight.evidence, false);
    });
  }
});

test("WK-1995 adoption verification has no terminal candidate publication dependency", async () => {
  const source = await readFile(
    path.join(repoRoot, "packages", "wiki-core", "src", "operations", "adoption-verify.mjs"),
    "utf8"
  );
  const importLines = source
    .split("\n")
    .filter((line) => line.startsWith("import "))
    .join("\n");
  assert.doesNotMatch(importLines, /forge|handoff|candidate|publication|publish/);

  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-no-publication-gate" });
    await writeFirstRunLauncherSetup(tempDir);
    const result = await runAdoptionVerify({ dir: tempDir });
    assert.equal(result.verdict, "ready");
    assert.equal(
      result.checks.some((check) => /forge|handoff|candidate|publication|publish/.test(check.check)),
      false
    );
  });
});

test("graph-impact does not fail or rely on a agent-chassis package-source path absent in consuming repos", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-graph-probe" });

    const pwtSourcePath = "packages/wiki-core/src/operations/adoption-verify.mjs";
    await assert.rejects(
      access(path.join(tempDir, pwtSourcePath)),
      /ENOENT/,
      "the agent-chassis package source path must be absent in a fresh bootstrapped repo"
    );

    const result = await runAdoptionVerify({ dir: tempDir });

    const graphImpact = result.checks.find((check) => check.check === "graph-impact");
    assert.equal(
      graphImpact.status,
      "pass",
      "graph-impact must pass even though the agent-chassis source path is missing"
    );

    assert.notEqual(
      graphImpact.evidence.input_path,
      pwtSourcePath,
      "graph-impact must not probe the agent-chassis package source path"
    );
    assert.equal(result.persisted_evidence, false);
    assert.equal(graphImpact.evidence.persisted_evidence, false);
  });
});
