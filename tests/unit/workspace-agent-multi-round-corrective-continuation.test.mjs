import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { appendCorrectiveIntegrationHop } from
  "../../packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs";
import {
  correctionPopulationFromTargets,
  createIntegratedCorrectiveRemainingScopeTransition,
  validateCurrentCorrectionSelection
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-scope.mjs";

const oid = (character) => character.repeat(40);
const SUBJECT = "WK-2286#SLICE-004";
const GENERATION = `sha256:${"a".repeat(64)}`;
const SLICE_REF = "refs/heads/slice/IN-0039/WK-2286/SLICE-004";
const target = (file, name) =>
  ({ path: file, name, kind: "function", operation: "modify" });
const integration = (pre, delivery, post) => ({
  previous_wk_sha: pre,
  slice_ref: SLICE_REF,
  delivery_sha: delivery,
  slice_sha: post,
  wk_sha: post
});

test("canonical contract edits alone advance multi-round implementation scope", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "wk-2286-contract-scope-"));
  const recordDir = path.join(repo, "wiki", "work-records");
  mkdirSync(recordDir, { recursive: true });
  const targets = [
    target("packages/a.mjs", "a"),
    target("packages/b.mjs", "b"),
    target("packages/c.mjs", "c")
  ];
  const population = correctionPopulationFromTargets(
    targets,
    ["C-001", "C-002", "C-003"],
    targets.map((entry) => entry.path)
  );
  const sliceFor = (index) => ({
    id: "SLICE-004",
    current_correction_ids: [population[index].correction_id],
    correction_population: population,
    expected_edit_targets: [targets[index]],
    write_scope: [targets[index].path],
    repo_paths: [targets[index].path]
  });
  const writeSlice = (slice) => writeFileSync(
    path.join(recordDir, "WK-2286.json"),
    `${JSON.stringify({ id: "WK-2286", slices: [slice] }, null, 2)}\n`
  );

  try {
    writeSlice(sliceFor(0));
    const root = appendCorrectiveIntegrationHop({
      priorState: null,
      subject: SUBJECT,
      generation: GENERATION,
      integration: integration(oid("1"), oid("2"), oid("3"))
    });
    const first = appendCorrectiveIntegrationHop({
      priorState: { chain: root.chain, remaining_scope_transition: null },
      subject: SUBJECT,
      generation: GENERATION,
      integration: integration(oid("3"), oid("4"), oid("5"))
    });
    const firstTransition = createIntegratedCorrectiveRemainingScopeTransition({
      mainRepo: repo,
      subject: SUBJECT,
      controlledContractGeneration: GENERATION,
      integrationChain: first.chain,
      integrationHop: first.hop
    });
    assert.deepEqual(firstTransition.before, population);
    assert.deepEqual(firstTransition.after.map((entry) => entry.correction_id),
      ["C-002", "C-003"]);

    writeSlice(sliceFor(1));
    assert.deepEqual(
      validateCurrentCorrectionSelection(sliceFor(1), firstTransition).correction_ids,
      ["C-002"]
    );

    const second = appendCorrectiveIntegrationHop({
      priorState: {
        chain: first.chain,
        remaining_scope_transition: firstTransition
      },
      subject: SUBJECT,
      generation: GENERATION,
      integration: integration(oid("5"), oid("6"), oid("7"))
    });
    const secondTransition = createIntegratedCorrectiveRemainingScopeTransition({
      mainRepo: repo,
      subject: SUBJECT,
      controlledContractGeneration: GENERATION,
      integrationChain: second.chain,
      integrationHop: second.hop,
      priorTransition: firstTransition
    });
    assert.deepEqual(secondTransition.after.map((entry) => entry.correction_id), ["C-003"]);
    assert.equal(JSON.stringify(secondTransition).includes("finding"), false);
    assert.equal(JSON.stringify(secondTransition).includes("receipt"), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
