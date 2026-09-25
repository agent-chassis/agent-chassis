import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SCHEMA_PATH,
  TOOL_VERSION_ADMITTED,
  checkContract,
  checkContractWithProofPack,
  parseArgs,
  usage
} from "../bin/check-contract.mjs";
import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../lib/native-contract-carrier-v1.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V1 as NATIVE_CONTRACT_SCHEMA
} from "../current.mjs";
import { loadStableContractSchemaV1 } from "../lib/stable-contract-schema-v1.mjs";
import { buildStableTestProofPopulation } from
  "./support/stable-v1-proof-pack-runtime.mjs";
import {
  buildFailedAttemptNonconsumptionFixture
} from "./proof-packs/failed-attempt-nonconsumption-fixture.mjs";
import {
  buildIdempotencyV2Fixture
} from "./proof-packs/idempotency-v2-test-fixture.mjs";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/check-contract.mjs", import.meta.url));
const EXAMPLE_PATH = fileURLToPath(new URL(
  "../examples/minimal-controlled-acceptance-contract.v1.json", import.meta.url));
const p4Profile = "proof.authorization.failed-attempt-nonconsumption";
const CLI_TIMEOUT_MS = 30_000;
const CLI_OUTPUT_BYTES = 16 * 1024 * 1024;

async function ownedDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stabilize(fixture) {
  const contract = {
    ...fixture.contract,
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    test_proof_version: TEST_PROOF_VERSION_V1
  };
  contract.test_proofs = buildStableTestProofPopulation(contract);
  return { contract, input: { ...fixture.input,
    input_version: "controlled-contract-verification-profile-input.v2",
    stable_evaluation: {} } };
}

async function writeFixture(directory, fixture) {
  const stable = stabilize(fixture);
  const contractPath = path.join(directory, "contract.json");
  const evaluationInputPath = path.join(directory, "evaluation-input.json");
  await Promise.all([
    writeFile(contractPath, jsonText(stable.contract)),
    writeFile(evaluationInputPath, jsonText(stable.input))
  ]);
  return { contractPath, evaluationInputPath };
}

async function runCli(args) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      maxBuffer: CLI_OUTPUT_BYTES,
      timeout: CLI_TIMEOUT_MS
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error.killed || !Number.isInteger(error.code)) throw error;
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? ""
    };
  }
}

test("the public API supplies the complete executable direct-authoring schema", async () => {
  const tracked = JSON.parse(await readFile(DEFAULT_SCHEMA_PATH, "utf8"));

  assert.equal(tracked.title, NATIVE_CONTRACT_SCHEMA.title);
  assert.deepEqual(loadStableContractSchemaV1(), NATIVE_CONTRACT_SCHEMA);
  assert.equal(typeof NATIVE_CONTRACT_SCHEMA.$defs.test_proof_binding, "object");
  assert.equal("source_text" in tracked.properties, false);
  assert.equal(tracked.properties.claims.minItems, 1);
  assert.match(tracked.properties.residue.description, /never omit/i);
  assert.match(tracked.$defs.relation.description, /depends_on/i);
});

test("minimal agent-authored contract resolves without a model", async () => {
  const result = await checkContract(EXAMPLE_PATH);
  assert.equal(result.outcome, "structurally_complete");
  assert.equal(result.structurally_complete, true);
  assert.equal(result.residue_count, 0);
  assert.deepEqual(result.validation.diagnostics, []);
  assert.deepEqual(result.decomposition.diagnostics, []);
  assert.equal(result.anonymous_planning_input.components.length, 1);
  assert.equal(result.authority.authoritative, false);
  assert.equal(result.mode, "structural");
  assert.deepEqual(result.verification_scope, {
    graph_edge_coverage: "assessed",
    proof_plan_discrimination: "not_assessed"
  });
  assert.deepEqual(result.admission, {
    kind: "unadmitted_structural",
    authoritative: false,
    proof_pack_verified: false
  });
  assert.equal(result.schema.path_role, "composition_root_member");
  assert.equal(result.schema.sha256_scope, "composed_effective_schema");
  assert.equal(result.passed, true);
});

test("missing verification coverage is reported as incomplete structure", async (t) => {
  const directory = await ownedDirectory(t, "controlled-contract-check-");
  const contract = JSON.parse(await readFile(EXAMPLE_PATH, "utf8"));
  contract.relations = [];
  const input = path.join(directory, "missing-verification.json");
  await writeFile(input, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  const result = await checkContract(input);
  assert.equal(result.outcome, "incomplete_structure");
  assert.equal(result.structurally_complete, false);
  assert.ok(result.validation.diagnostics.some(
    ({ code }) => code === "mandatory_behavior_unverified"
  ));
});

test("operative residue remains explicit and prevents a clean result", async (t) => {
  const directory = await ownedDirectory(t, "controlled-contract-check-");
  const contract = JSON.parse(await readFile(EXAMPLE_PATH, "utf8"));
  contract.residue.push({
    residue_id: "res-unexpressed-owner",
    reason: "unsupported_concept",
    text: "The exact authority owner is not represented by the controlled contract."
  });
  const input = path.join(directory, "residue.json");
  await writeFile(input, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  const result = await checkContract(input);
  assert.equal(result.outcome, "residue_present");
  assert.equal(result.structurally_complete, false);
  assert.equal(result.residue_count, 1);
});

test("CLI is self-documenting and requires paired profile inputs", () => {
  assert.deepEqual(parseArgs(["--input", "contract.json"]), {
    input: "contract.json",
    profile: null,
    evaluationInput: null,
    output: null,
    planningOutput: null,
    help: false
  });
  assert.match(usage(), /performs no prose translation/i);
  assert.match(usage(), /--profile <proof-pack-id>/i);
  assert.match(usage(), /unadmitted/i);
  assert.match(usage(), /NATIVE_CONTRACT_SCHEMA_V1/);
  assert.match(usage(), /@agent-chassis\/controlled-contract/);
  assert.throws(() => parseArgs([]), /--input is required/);
  assert.throws(
    () => parseArgs(["--input", "contract.json", "--profile", p4Profile]),
    /must be supplied together/
  );
});

test("argument parsing rejects duplicate, partial, mixed, and positional ambiguity", () => {
  const admittedFlags = [
    ["--input", "contract.json"],
    ["--profile", p4Profile],
    ["--evaluation-input", "evaluation.json"]
  ];
  const expected = {
    input: "contract.json",
    profile: p4Profile,
    evaluationInput: "evaluation.json",
    output: null,
    planningOutput: null,
    help: false
  };
  for (const order of [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ]) assert.deepEqual(
    parseArgs(order.flatMap((index) => admittedFlags[index])),
    expected
  );

  for (const flag of [
    "--input", "--profile", "--evaluation-input", "--output", "--planning-output"
  ]) {
    assert.throws(
      () => parseArgs([flag, "same", flag, "same"]),
      { message: `duplicate argument: ${flag}` }
    );
    assert.throws(
      () => parseArgs([flag, "first", flag, "second"]),
      { message: `duplicate argument: ${flag}` }
    );
  }
  assert.throws(
    () => parseArgs(["--help", "-h"]),
    { message: "duplicate argument: --help" }
  );
  assert.throws(
    () => parseArgs(["--help", "--input", "contract.json"]),
    { message: "--help cannot be combined with other arguments" }
  );
  for (const args of [
    ["--input", "contract.json", "--profile", p4Profile],
    ["--evaluation-input", "evaluation.json", "--input", "contract.json"]
  ]) assert.throws(
    () => parseArgs(args),
    { message: "--profile and --evaluation-input must be supplied together" }
  );
  assert.throws(
    () => parseArgs([
      "--input", "structural.json", "--profile", p4Profile,
      "--evaluation-input", "evaluation.json", "--input", "admitted.json"
    ]),
    { message: "duplicate argument: --input" }
  );
  assert.throws(() => parseArgs(["contract.json"]),
    { message: "unknown argument: contract.json" });
  assert.throws(() => parseArgs(["--input", "contract.json", "extra.json"]),
    { message: "unknown argument: extra.json" });
  assert.throws(() => parseArgs(["--input", "--profile"]),
    { message: "--input requires a value" });
});

test("CLI duplicate and partial-mode errors are deterministic", async () => {
  const duplicateRuns = await Promise.all([
    runCli(["--input", "same.json", "--input", "same.json"]),
    runCli(["--input", "first.json", "--input", "second.json"]),
    runCli([
      "--input", "structural.json", "--profile", p4Profile,
      "--evaluation-input", "evaluation.json", "--input", "admitted.json"
    ])
  ]);
  for (const run of duplicateRuns) {
    assert.equal(run.code, 1);
    assert.equal(run.stdout, "");
    assert.equal(run.stderr, "error: duplicate argument: --input\n");
  }
  const partialRuns = await Promise.all([
    runCli(["--input", "contract.json", "--profile", p4Profile]),
    runCli(["--profile", p4Profile, "--input", "contract.json"])
  ]);
  for (const run of partialRuns) {
    assert.equal(run.code, 1);
    assert.equal(run.stdout, "");
    assert.equal(
      run.stderr,
      "error: --profile and --evaluation-input must be supplied together\n"
    );
  }
});

test("CLI uses one release-certified built-in profile and is deterministic", async (t) => {
  const directory = await ownedDirectory(t, "check-contract-admitted-");
  const fixture = buildFailedAttemptNonconsumptionFixture();
  const { contractPath, evaluationInputPath } = await writeFixture(directory, fixture);
  const args = [
    "--input", contractPath,
    "--profile", p4Profile,
    "--evaluation-input", evaluationInputPath
  ];
  const [first, second] = await Promise.all([runCli(args), runCli(args)]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  const result = JSON.parse(first.stdout);
  assert.equal(result.tool_version, TOOL_VERSION_ADMITTED);
  assert.equal(result.mode, "proof_pack");
  assert.deepEqual(result.verification_scope, {
    graph_edge_coverage: "assessed",
    proof_plan_discrimination: "assessed_by_admitted_profile"
  });
  assert.equal(result.outcome, "proof_satisfied");
  assert.equal(result.passed, true);
  assert.equal(result.admission.kind, "local_proof_pack_admission");
  assert.equal(result.admission.adequacy_verified, true);
  assert.equal(result.proof_pack.certification.negative_fixture_count, 87);
  assert.equal(result.profile_evaluation.satisfaction, "satisfied");
  assert.equal(result.profile_evaluation.admission.kind, "unadmitted_direct");
  for (const field of [
    "contract_sha256", "evaluation_input_sha256", "profile_digest",
    "admission_digest", "guarantee_digest", "adequacy_declaration_digest",
    "adequacy_result_digest", "evaluation_result_sha256"
  ]) assert.match(result.admission[field], /^[a-f0-9]{64}$/u, field);
  assert.equal(
    result.admission.admission_digest,
    result.proof_pack.admission_digest
  );
});

test("CLI exits 2 when a structurally complete contract is inadequate for the pack", async (t) => {
  const directory = await ownedDirectory(t, "check-contract-inadequate-");
  const fixture = buildFailedAttemptNonconsumptionFixture();
  fixture.contract.claims.find(
    ({ claim_id: claimId }) => claimId === "claim-failed-input-unauthorized"
  ).modality = "SHOULD";
  const { contractPath, evaluationInputPath } = await writeFixture(directory, fixture);
  const run = await runCli([
    "--input", contractPath,
    "--profile", p4Profile,
    "--evaluation-input", evaluationInputPath
  ]);
  assert.equal(run.code, 2, run.stderr);
  assert.equal(run.stderr, "");
  const result = JSON.parse(run.stdout);
  assert.equal(result.structural_outcome, "structurally_complete");
  assert.equal(result.outcome, "proof_unsatisfied");
  assert.equal(result.profile_evaluation.satisfaction, "unsatisfied");
  assert.equal(result.passed, false);
});

test("CLI refuses unknown profiles and arbitrary pack paths", async (t) => {
  const directory = await ownedDirectory(t, "check-contract-pack-refusal-");
  const fixture = buildIdempotencyV2Fixture();
  const { contractPath, evaluationInputPath } = await writeFixture(directory, fixture);
  const baseArgs = ["--input", contractPath, "--evaluation-input", evaluationInputPath];
  const [unknown, pathAttempt] = await Promise.all([
    runCli([...baseArgs, "--profile", "proof.unknown"]),
    runCli([...baseArgs, "--profile", directory])
  ]);
  for (const result of [unknown, pathAttempt]) {
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /\[proof_pack_not_found\]/u);
  }
});

test("direct CLI structural mode is explicitly unadmitted", async () => {
  const run = await runCli(["--input", EXAMPLE_PATH]);
  assert.equal(run.code, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.mode, "structural");
  assert.equal(result.outcome, "structurally_complete");
  assert.equal(result.passed, true);
  assert.deepEqual(result.verification_scope, {
    graph_edge_coverage: "assessed",
    proof_plan_discrimination: "not_assessed"
  });
  assert.deepEqual(result.admission, {
    kind: "unadmitted_structural",
    authoritative: false,
    proof_pack_verified: false
  });
  assert.equal("profile_evaluation" in result, false);
});

test("library admission accepts profile identity, never an arbitrary directory", async (t) => {
  const directory = await ownedDirectory(t, "check-contract-admission-");
  const fixture = buildFailedAttemptNonconsumptionFixture();
  const { contractPath, evaluationInputPath } = await writeFixture(directory, fixture);
  const result = await checkContractWithProofPack({
    inputPath: contractPath,
    profileId: p4Profile,
    evaluationInputPath
  });
  assert.equal(result.passed, true);
  await assert.rejects(checkContractWithProofPack({
    inputPath: contractPath,
    profileId: directory,
    evaluationInputPath
  }), { code: "proof_pack_not_found" });
});
