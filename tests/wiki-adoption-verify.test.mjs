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
  ADOPTION_VERIFY_REQUIRED_CHECK_IDS
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
          filesystem_mcp_backend_default: "local",
          filesystem_mcp_backends: {
            local: {
              command: "agent-launch-filesystem-mcp-backend"
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

test("runAdoptionVerify exposes the required-check ids in deterministic order", () => {
  assert.deepEqual([...ADOPTION_VERIFY_REQUIRED_CHECK_IDS], REQUIRED_IDS);
});

test("runAdoptionVerify returns the adoption-verify.v1 envelope with all five required checks in order on a bootstrapped repo", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-ready" });
    await writeFirstRunLauncherSetup(tempDir);

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

test("WK-1396 runAdoptionVerify blocks a bare bootstrapped repo on operator first-run setup, not implementation-slice bookkeeping", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-bookkeeping" });

    const blocked = await runAdoptionVerify({ dir: tempDir });
    assert.equal(blocked.verdict, "blocked", "a bare bootstrapped repo must not be ready");
    assert.equal(blocked.agent_operable, false);

    const workRecords = blocked.checks.find((check) => check.check === "work-records");
    assert.equal(workRecords.status, "pass", "review-only WK-0001 must validate without implementation bookkeeping");
    assert.deepEqual(workRecords.evidence.implementation_slices, []);
    assert.deepEqual(
      workRecords.evidence.review_slices.map((slice) => slice.id),
      ["adoption-verify"]
    );

    const dispatchPreflight = blocked.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(dispatchPreflight.status, "fail", "dispatch-preflight must fail on missing operator setup");
    assert.equal(dispatchPreflight.blocker.code, "operator_first_run_prerequisites_missing");
    assert.match(
      `${dispatchPreflight.blocker.code}: ${dispatchPreflight.blocker.message}`,
      /operator_first_run_prerequisites_missing: .*AGENTS\.md/,
      "missing root AGENTS.md must be surfaced as an operator-owned first-run prerequisite"
    );
    assert.equal(dispatchPreflight.evidence.agents_md.present, false);
    assert.equal(dispatchPreflight.evidence.launcher_toml.present, false);
    assert.equal(dispatchPreflight.evidence.launcher_init_config.registry_present, false);
    assert.equal(dispatchPreflight.evidence.launcher_init_config.role_guard_secret_present, false);
    assert.match(dispatchPreflight.remediation, /AGENTS\.md/);
    assert.match(dispatchPreflight.remediation, /agent-launch\.toml/);

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
  });
});

test("WK-1396 distributed WK-0001 is review-only and carries no implementation-slice bookkeeping evidence", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-blocked-slice" });
    await writeFirstRunLauncherSetup(tempDir);

    const result = await runAdoptionVerify({ dir: tempDir });
    const workRecords = result.checks.find((check) => check.check === "work-records");
    assert.equal(workRecords.status, "pass");
    assert.equal(workRecords.evidence.work_kind, "review");
    assert.equal(workRecords.evidence.write_scope_count, 0);
    assert.deepEqual(workRecords.evidence.implementation_slices, []);
    assert.deepEqual(
      workRecords.evidence.review_slices,
      [{ id: "adoption-verify", status: "todo" }]
    );
    assert.equal(result.verdict, "ready");
  });
});

test("WK-0795 adoption-verify reports the bootstrap-seeded docs/adoption.md as a non-gating informational pass", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-doc" });

    const result = await runAdoptionVerify({ dir: tempDir });

    const adoptionDoc = result.checks.find((check) => check.check === "adoption-doc");
    assert.ok(adoptionDoc, "adoption-verify must report an adoption-doc informational check");
    assert.equal(adoptionDoc.required, false, "adoption-doc must be a non-required informational check");
    assert.equal(adoptionDoc.kind, "operator-owned");
    assert.equal(adoptionDoc.status, "pass", "bootstrap-seeded docs/adoption.md must pass the presence/validity check");
    assert.equal(adoptionDoc.evidence.present, true);
    assert.equal(adoptionDoc.evidence.has_heading, true);
    assert.equal(adoptionDoc.blocker, null, "the informational adoption-doc check must never carry a blocker");

    const requiredEntries = result.checks.filter((check) => check.required);
    assert.deepEqual(
      requiredEntries.map((check) => check.check),
      REQUIRED_IDS,
      "the five required checks are unchanged by adding the adoption-doc informational check"
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
  const wkPath = path.join(tempDir, "wiki", "work-records", "WK-0001.json");
  const record = JSON.parse(await readFile(wkPath, "utf8"));
  record.work_kind = "implementation";
  record.slices = [];
  record.dispatch_intent = {
    intended_agent_role: "worker",
    target_unit: "record",
    requires_graph_impact: false,
    requires_escalation: false
  };

  record.write_scope = [
    "packages/a/src/one.mjs",
    "packages/b/src/two.mjs",
    "docs/three.md",
    "tests/four.test.mjs"
  ];
  await writeFile(wkPath, JSON.stringify(record, null, 2));
}

test("runAdoptionVerify is blocked (agent_operable:false) when WK-0001 is non-dispatchable (missing_graph_impact), even though validate-dispatch returns a structured decision", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-nondispatchable" });
    await writeFirstRunLauncherSetup(tempDir);
    await makeWk0001NonDispatchableImplementation(tempDir);

    const result = await runAdoptionVerify({ dir: tempDir });

    assert.equal(result.verdict, "blocked");
    assert.equal(result.agent_operable, false);

    const dispatchPreflight = result.checks.find((check) => check.check === "dispatch-preflight");
    assert.equal(dispatchPreflight.status, "fail", "dispatch-preflight must fail when WK-0001 is non-dispatchable");
    assert.equal(dispatchPreflight.evidence.dispatchable, false);
    assert.equal(dispatchPreflight.evidence.decision_code, "missing_graph_impact");
    assert.ok(
      Array.isArray(dispatchPreflight.evidence.reasons) && dispatchPreflight.evidence.reasons.length > 0,
      "the failing dispatch-preflight must surface the decision reasons"
    );
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
    assert.equal(dispatchPreflight.evidence.dispatchable, false);
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
