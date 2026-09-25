

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE,
  EXECUTION_OBSERVATION_OWNER
} from "../../packages/controlled-contract/current.mjs";
import {
  createControlledContractCarrierOperation,
  patchControlledContractCarrierOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import { readControlledContractCarrierFile } from
  "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-tools.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WK_ID = "WK-2024";

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk2519-authored-observation-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  const contract = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/examples/minimal-controlled-acceptance-contract.v1.json"),
  "utf8"));
  await writeFile(path.join(contracts, `${WK_ID}.controlled-acceptance.json`),
    `${JSON.stringify(contract, null, 2)}\n`);
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  const record = JSON.parse(await readFile(
    path.join(ROOT, "wiki/work-records", `${WK_ID}.json`), "utf8"));
  record.acceptance.validation = [];
  record.slices = [];
  await writeFile(path.join(repoRoot, "wiki/work-records", `${WK_ID}.json`),
    `${JSON.stringify(record, null, 2)}\n`);
  return { repoRoot, contracts };
}

async function witnessBearingInput() {
  const input = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/profiles/proof.verification.test-validity/11.0.0/evaluation-input.template.json"),
  "utf8"));
  input.reference_bindings = [
    { role: "component", reference_ids: ["ref-component"] },
    { role: "suite", reference_ids: ["ref-suite"] }
  ];
  return input;
}

function declarativeInput(input) {
  return { ...structuredClone(input), stable_evaluation: {} };
}

function assertTypedRefusal(error, pointer) {
  assert.equal(error.code, AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE, error?.stack);
  assert.equal(error.details.execution_owner, EXECUTION_OBSERVATION_OWNER);
  assert.equal(error.details.pointer, pointer);
  assert.equal(error.details.diagnostics.total_count, 1);
  assert.equal(error.details.diagnostics.diagnostics[0].code,
    AUTHORED_EXECUTION_OBSERVATION_REFUSAL_CODE);
  return true;
}

test("carrier create refuses an authored observation before any write, then accepts the declarative input",
  async (t) => {
    const { repoRoot, contracts } = await fixture(t);
    const witness = await witnessBearingInput();
    const before = (await readdir(contracts)).sort();
    await assert.rejects(createControlledContractCarrierOperation({
      repoRoot, wkId: WK_ID, focus: null, carrierKind: "evaluation_input",
      expectedContentDigest: null, content: witness
    }), (error) => {
      assertTypedRefusal(error, "/stable_evaluation/test_validity");
      assert.equal(error.details.changed, false);
      return true;
    });
    assert.deepEqual((await readdir(contracts)).sort(), before,
      "refusal precedes every write");

    const created = await createControlledContractCarrierOperation({
      repoRoot, wkId: WK_ID, focus: null, carrierKind: "evaluation_input",
      expectedContentDigest: null, content: declarativeInput(witness)
    });
    assert.match(created.content_digest, /^sha256:[a-f0-9]{64}$/u);
    const published = await readControlledContractCarrierFile({
      repoRoot, wkId: WK_ID, focus: null, carrierKind: "evaluation_input"
    });
    assert.equal(published.content_digest, created.content_digest);
    assert.equal(Object.hasOwn(published.content.stable_evaluation, "test_validity"), false);

    await assert.rejects(patchControlledContractCarrierOperation({
      repoRoot, wkId: WK_ID, focus: null, carrierKind: "evaluation_input",
      expectedContentDigest: created.content_digest,
      operations: [{ op: "upsert", target: "stable_evaluation", id: "test_validity",
        value: witness.stable_evaluation.test_validity }]
    }), (error) => typeof error.code === "string" &&
      error.code !== "mcp_response.handler_exception.v1");
    const unchanged = await readControlledContractCarrierFile({
      repoRoot, wkId: WK_ID, focus: null, carrierKind: "evaluation_input"
    });
    assert.equal(unchanged.content_digest, created.content_digest);
    assert.deepEqual(unchanged.content, published.content);
  });
