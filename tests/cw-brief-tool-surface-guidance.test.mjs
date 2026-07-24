import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  computeWorkRecordSourceDigest,
  renderWorkRecordAgentBriefById,
  validateWorkRecordDispatch
} from "../packages/wiki-core/src/index.mjs";
import {
  evaluateWorkRecordWrapperGate
} from "../packages/agent-launch-core/src/index.mjs";
import {
  LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES,
  classifyLauncherRoleContractShape
} from "../packages/agent-launch-cli/src/lib/codex-role-prompts.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(os.tmpdir(), "agent-chassis-cw-brief-tool-surface-guidance");
const sliceId = "cw-brief-tool-surface-guidance-test";
const unitAddress = `WK-0764#${sliceId}`;

function fixturePath(...segments) {
  return path.join(repoRoot, ...segments);
}

async function withTempRepo(fn) {
  await mkdir(tempRoot, { recursive: true });
  const tempDir = await mkdtemp(path.join(tempRoot, "repo-"));
  try {
    await mkdir(path.join(tempDir, "docs"), { recursive: true });
    await mkdir(path.join(tempDir, "wiki", "work-records"), { recursive: true });
    await writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS\n", "utf8");
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function installWorkRecord(tempDir, relativePath) {
  const record = JSON.parse(await readFile(fixturePath(relativePath), "utf8"));
  const targetPath = path.join(tempDir, "wiki", "work-records", `${record.id}.json`);
  await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function buildWorkerAdmissionAllow() {
  return {
    schema_version: "worker-admission-decision-local.v1",
    decision_kind: "work_unit_atomicity",
    decision: "allow",
    allowed: true,
    decision_code: "admission_allowed",
    decision_codes: ["admission_allowed"],
    effect: "allows",
    reasons: ["fixture reason"],
    matched_rules: ["within_profile_thresholds"],
    backend_identity: {
      policy_backend: "portfolio-local",
      policy_backend_version: "0.2.0"
    },
    profile_id: "fixture-profile",
    profile_version: "fixture-profile.v1",
    mode: "local",
    input_digest: "sha256:fixture",
    supplied_thresholds: {},
    evidence: {},
    request: {},
    authority: "portfolio_local_reference"
  };
}

function buildCanonicalSummary(record, readiness, selectedSliceId) {
  const selectedSlice = Array.isArray(record.slices)
    ? record.slices.find((slice) => slice && slice.id === selectedSliceId) || null
    : null;

  assert.ok(selectedSlice, `selected slice ${selectedSliceId} must exist in the WK-0764 record`);

  return {
    record_id: record.id,
    repo: record.repo,
    title: record.title,
    docs: Array.isArray(selectedSlice.docs) ? selectedSlice.docs : [],
    repo_paths: Array.isArray(selectedSlice.repo_paths) ? selectedSlice.repo_paths : [],
    write_scope: Array.isArray(selectedSlice.write_scope) ? selectedSlice.write_scope : [],
    acceptance_criteria: Array.isArray(selectedSlice.acceptance?.criteria)
      ? selectedSlice.acceptance.criteria
      : [],
    validation_commands: Array.isArray(selectedSlice.acceptance?.validation)
      ? selectedSlice.acceptance.validation
      : [],
    dispatch_intent: selectedSlice.dispatch_intent || null,
    selected_unit: {
      id: selectedSlice.id,
      title: selectedSlice.title,
      work_kind: selectedSlice.work_kind,
      status: selectedSlice.status,
      docs: Array.isArray(selectedSlice.docs) ? selectedSlice.docs : [],
      repo_paths: Array.isArray(selectedSlice.repo_paths) ? selectedSlice.repo_paths : [],
      write_scope: Array.isArray(selectedSlice.write_scope) ? selectedSlice.write_scope : [],
      acceptance: selectedSlice.acceptance || null,
      dispatch_intent: selectedSlice.dispatch_intent || null
    },
    accepted_escalations: Array.isArray(readiness.accepted_escalations) ? readiness.accepted_escalations : [],
    canonical_refs: Array.isArray(readiness.canonical_refs) ? readiness.canonical_refs : [],
    derived_evidence: Array.isArray(readiness.derived_evidence) ? readiness.derived_evidence : [],
    state: readiness.state || null
  };
}

test("WK-0764 CW launch packet prompt carries implementation tool-surface guidance", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installWorkRecord(tempDir, "wiki/work-records/WK-0764.json");
    const selectedSlice = record.slices.find((slice) => slice?.id === sliceId);
    assert.ok(selectedSlice, `selected slice ${sliceId} must exist`);
    selectedSlice.dispatch_intent = {
      ...selectedSlice.dispatch_intent,
      requires_graph_impact: false
    };
    await writeFile(
      path.join(tempDir, "wiki", "work-records", `${record.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8"
    );
    const readiness = await validateWorkRecordDispatch({ dir: tempDir, unitAddress });
    assert.equal(readiness.dispatchable, true, readiness.decision_code);

    const sourceDigest = computeWorkRecordSourceDigest(record);
    const agentBrief = await renderWorkRecordAgentBriefById({
      dir: tempDir,
      id: record.id,
      sliceId
    });

    const gate = evaluateWorkRecordWrapperGate({
      role: "worker",
      unitAddress,
      readiness,
      sourceDigest,
      canonicalSummary: buildCanonicalSummary(record, readiness, sliceId),
      agentBrief,

      remoteWorkerAdmission: {
        disposition: "structural_remote",
        effect: "admit",
        pack_backed: true,
        node_engine_backed_success: true,
        node_engine_binding_ratified: true,
        node_engine_binding_status: "node_engine_authority_v1_bound.2026.05",
        outcome: "pack_backed_result",
        reason_code: "remote_admit"
      }
    });

    assert.equal(
      gate.allowed,
      true,
      `wrapper gate must admit the implementation worker slice: ${JSON.stringify(gate)}`
    );
    assert.ok(gate.launch_packet && typeof gate.launch_packet.prompt === "string");

    const prompt = gate.launch_packet.prompt;
    assert.equal(
      classifyLauncherRoleContractShape(prompt),
      LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES.worker,
      "launch packet prompt must remain implementation-shaped"
    );
    assert.equal(
      prompt.includes("Findings only. Do not modify files."),
      false,
      "launch packet prompt must not collapse into the findings-only contract"
    );
    assert.ok(
      prompt.includes(
        "Codex may invoke its actual exec_command tool"
      ),
      "launch packet prompt must authorize the actual command tool"
    );
    assert.match(
      prompt,
      /apply_patch remains available as one editing option/i,
      "launch packet prompt must keep apply_patch optional"
    );
    assert.doesNotMatch(prompt, /check the exact apply_patch entry|Filtering ALL_TOOLS/u);
    assert.match(prompt, /## Canonical Record/);
    assert.match(prompt, /## Dispatch Readiness/);
    assert.match(prompt, /## Agent Brief/);
    assert.match(prompt, /### Selected Unit/);
    assert.match(prompt, /Role: implementation worker for WK-0764#cw-brief-tool-surface-guidance-test\./);
  });
});
