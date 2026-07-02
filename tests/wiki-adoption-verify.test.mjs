import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readdir, stat, access, readFile, writeFile } from "node:fs/promises";

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

async function recordImplementationSlicesDone(tempDir, status = "done") {
  const wkPath = path.join(tempDir, "wiki", "work-records", "WK-0001.json");
  const record = JSON.parse(await readFile(wkPath, "utf8"));
  const moved = [];
  for (const slice of record.slices ?? []) {
    if (slice.work_kind === "implementation") {
      slice.status = status;
      moved.push(slice.id);
    }
  }
  await writeFile(wkPath, JSON.stringify(record, null, 2));
  return moved;
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

    await recordImplementationSlicesDone(tempDir);

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

test("WK-1375 runAdoptionVerify blocks a bare bootstrapped repo with adoption_status_bookkeeping_incomplete until implementation slices are recorded", async () => {
  await withTempDir(async (tempDir) => {

    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-bookkeeping" });

    const blocked = await runAdoptionVerify({ dir: tempDir });
    assert.equal(blocked.verdict, "blocked", "a bare bootstrapped repo must not be ready");
    assert.equal(blocked.agent_operable, false);

    const workRecords = blocked.checks.find((check) => check.check === "work-records");
    assert.equal(workRecords.status, "fail", "work-records must fail on unrecorded slice status");
    assert.equal(
      workRecords.blocker.code,
      "adoption_status_bookkeeping_incomplete",
      "the work-records blocker must be the status-bookkeeping code"
    );

    const unrecorded = workRecords.evidence.unrecorded_implementation_slices.map((s) => s.id).sort();
    assert.deepEqual(unrecorded, ["launcher-config", "repo-local-agents"]);
    assert.ok(
      !unrecorded.includes("adoption-verify"),
      "the review slice must not gate the status-bookkeeping check"
    );
    assert.ok(workRecords.remediation, "the status-bookkeeping failure must carry remediation");

    for (const check of blocked.checks.filter(
      (entry) => entry.required && entry.check !== "work-records"
    )) {
      assert.equal(check.status, "pass", `expected required check ${check.check} to pass`);
    }

    const moved = await recordImplementationSlicesDone(tempDir);
    assert.deepEqual(moved.sort(), ["launcher-config", "repo-local-agents"]);
    const ready = await runAdoptionVerify({ dir: tempDir });
    assert.equal(ready.verdict, "ready", "recording slice statuses done must unblock the repo");
    assert.equal(ready.agent_operable, true);
    const readyWorkRecords = ready.checks.find((check) => check.check === "work-records");
    assert.equal(readyWorkRecords.status, "pass");
  });
});

test("WK-1375 a blocked WK-0001 implementation slice also satisfies status bookkeeping only when all implementation slices are accounted for", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/adoption-verify-blocked-slice" });

    const wkPath = path.join(tempDir, "wiki", "work-records", "WK-0001.json");
    const record = JSON.parse(await readFile(wkPath, "utf8"));
    const impl = record.slices
      .filter((slice) => slice.work_kind === "implementation")
      .sort((left, right) => left.id.localeCompare(right.id));
    assert.deepEqual(
      impl.map((slice) => slice.id),
      ["launcher-config", "repo-local-agents"],
      "expected the current WK-0001 implementation slices"
    );
    impl.find((slice) => slice.id === "repo-local-agents").status = "blocked";
    await writeFile(wkPath, JSON.stringify(record, null, 2));

    const partiallyRecorded = await runAdoptionVerify({ dir: tempDir });
    const partialWorkRecords = partiallyRecorded.checks.find((check) => check.check === "work-records");
    assert.equal(
      partialWorkRecords.status,
      "fail",
      "one blocked implementation slice is not enough when another remains unrecorded"
    );
    assert.deepEqual(
      partialWorkRecords.evidence.unrecorded_implementation_slices.map((slice) => slice.id),
      ["launcher-config"]
    );

    impl.find((slice) => slice.id === "launcher-config").status = "blocked";
    await writeFile(wkPath, JSON.stringify(record, null, 2));

    const result = await runAdoptionVerify({ dir: tempDir });
    const workRecords = result.checks.find((check) => check.check === "work-records");
    assert.equal(
      workRecords.status,
      "pass",
      "blocked implementation slices count as recorded bookkeeping when all are accounted for"
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

    await recordImplementationSlicesDone(tempDir);

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

async function makeWk0001NonDispatchableMultiCluster(tempDir) {
  const wkPath = path.join(tempDir, "wiki", "work-records", "WK-0001.json");
  const record = JSON.parse(await readFile(wkPath, "utf8"));
  record.slices = [];
  record.dispatch_intent = {
    intended_agent_role: "worker",
    target_unit: "none",
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
    await makeWk0001NonDispatchableMultiCluster(tempDir);

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
    await makeWk0001NonDispatchableMultiCluster(tempDir);

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
