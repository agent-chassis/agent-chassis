import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ControlledContractAssessmentRecoveryError,
  buildControlledContractAssessmentRecovery
} from "../current.mjs";
import * as implementation from "../lib/assessment-recovery.mjs";
import * as subpath from "@agent-chassis/controlled-contract/assessment-recovery";

const DIGEST = `sha256:${"a".repeat(64)}`;
const STALE_DIGEST = `sha256:${"b".repeat(64)}`;

test("runtime, declarations, root, subpath, and publication stay aligned", async () => {
  assert.deepEqual(Object.keys(subpath).sort(), [
    "ControlledContractAssessmentRecoveryError",
    "buildControlledContractAssessmentRecovery"
  ]);
  assert.equal(subpath.ControlledContractAssessmentRecoveryError,
    ControlledContractAssessmentRecoveryError);
  assert.equal(subpath.buildControlledContractAssessmentRecovery,
    buildControlledContractAssessmentRecovery);
  assert.equal(subpath.ControlledContractAssessmentRecoveryError,
    implementation.ControlledContractAssessmentRecoveryError);
  assert.equal(subpath.buildControlledContractAssessmentRecovery,
    implementation.buildControlledContractAssessmentRecovery);

  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.deepEqual(manifest.exports["./assessment-recovery"], {
    types: "./lib/assessment-recovery.d.mts",
    default: "./lib/assessment-recovery.mjs"
  });
  for (const file of [
    "lib/assessment-recovery.d.mts",
    "lib/assessment-recovery.mjs"
  ]) assert.equal(manifest.files.includes(file), true, file);

  const rootDeclaration = await readFile(new URL("../current.d.mts", import.meta.url), "utf8");
  const subpathDeclaration = await readFile(
    new URL("../lib/assessment-recovery.d.mts", import.meta.url), "utf8");
  assert.match(rootDeclaration, /from "\.\/lib\/assessment-recovery\.mjs";/u);
  for (const name of Object.keys(subpath)) {
    assert.match(subpathDeclaration, new RegExp(`\\b${name}\\b`, "u"), name);
  }
});

function identity(focus) {
  return {
    carrier_kind: "contract",
    wk_id: "WK-2012",
    focus,
    content_digest: DIGEST
  };
}

test("package preserves exact root and focused missing-plan capability failure", () => {
  for (const focus of [null, "focused-slice"]) {
    const actual = buildControlledContractAssessmentRecovery({
      reasonCode: "controlled_contract_proof_plan_missing",
      contractIdentity: identity(focus)
    });
    assert.deepEqual(actual, {
      status: "capability-incomplete",
      reason_code: "controlled_contract_proof_plan_missing",
      contract_identity: identity(focus),
      next_calls: [],
      recovery: null,
      missing_carrier: "proof_plan",
      expected_content_digest: null
    });
    assert.equal(Object.isFrozen(actual), true);
  }
});

test("package owns exact stale-plan digest recovery", () => {
  const actual = buildControlledContractAssessmentRecovery({
    reasonCode: "controlled_contract_proof_plan_stale",
    contractIdentity: identity("focused-slice"),
    staleContentDigest: STALE_DIGEST
  });
  assert.equal(actual.stale_carrier, "proof_plan");
  assert.equal(actual.expected_content_digest, STALE_DIGEST);
  assert.deepEqual(actual.next_calls, []);
  assert.equal(actual.recovery, null);
});

test("package owns request and evaluation recovery without invented CAS state", () => {
  for (const [reasonCode, carrierKind] of [
    ["controlled_contract_proof_plan_request_missing", "proof_plan_request"],
    ["controlled_contract_evaluation_input_missing", "evaluation_input"]
  ]) {
    const actual = buildControlledContractAssessmentRecovery({
      reasonCode,
      contractIdentity: identity(null)
    });
    assert.equal(actual.missing_carrier, carrierKind);
    assert.deepEqual(actual.next_calls, []);
    assert.equal(actual.recovery, null);
    assert.equal(Object.hasOwn(actual, "expected_content_digest"), false);
  }
});

test("package refuses incomplete or cross-state recovery input", () => {
  assert.throws(() => buildControlledContractAssessmentRecovery({
    reasonCode: "controlled_contract_proof_plan_stale",
    contractIdentity: identity(null)
  }), (error) => error instanceof ControlledContractAssessmentRecoveryError);
  assert.throws(() => buildControlledContractAssessmentRecovery({
    reasonCode: "controlled_contract_proof_plan_missing",
    contractIdentity: identity(null),
    staleContentDigest: STALE_DIGEST
  }), (error) => error instanceof ControlledContractAssessmentRecoveryError);
});
