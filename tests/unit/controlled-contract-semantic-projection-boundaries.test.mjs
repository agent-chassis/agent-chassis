import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS,
  CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY,
  PROOF_INTENT_DIGESTS,
  assessProofPlan
} from "@agent-chassis/controlled-contract";
import {
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS,
  assertControlledContractSemanticProjectionBound,
  controlledContractPrettyJsonBytes,
  projectControlledContractProofAssessmentPage,
  projectControlledContractProofAssessmentSummary
} from "@agent-chassis/wiki-core";
import {
  controlledContractAssessmentSummaryAllowance
} from "../../packages/wiki-core/src/operations/controlled-contract/semantic-projection-bounds.mjs";
import {
  createControlledContractAssessmentSnapshotRegistry
} from "../../packages/wiki-mcp/src/lib/controlled-contract-assessment-snapshots.mjs";
import {
  assertNoControlledContractRawResponse
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  materializeControlledContractAssessmentResponse
} from "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import {
  canonicalDigest,
  canonicalJson,
  normalizeContractForIdentity
} from "../../packages/controlled-contract/lib/contract-assessment.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "../../packages/controlled-contract/test/proof-packs/refusal-before-effects-fixture.mjs";
import { buildStableTestProofPopulation } from
  "../../packages/controlled-contract/test/support/stable-v1-proof-pack-runtime.mjs";

function exactBytes(size) {
  const empty = controlledContractPrettyJsonBytes({ value: "" });
  const value = { value: "x".repeat(size - empty) };
  assert.equal(controlledContractPrettyJsonBytes(value), size);
  return value;
}

function proofAssessment(count = 65, { compact = false } = {}) {
  return {
    schema_version: "controlled-contract-multi-pack-assessment.v1",
    structure: "proven",
    overall_code: "not_proven",
    per_pack: Array.from({ length: count }, (_, index) => ({
      profile_id: compact ? `p${index}` : `proof.test.${String(index).padStart(3, "0")}`,
      profile_version: compact ? "v" : "1.0.0",
      profile_discrimination: index % 2 === 0 ? "proven" : "not_proven",
      exact_binding: "not_applicable"
    })),
    diagnostics: [],
    proof_exclusions: [],
    missing_inputs: [],
    cross_carrier_integrity: {
      axis: "cross_carrier_integrity",
      state: "pass",
      package_result_digest: `sha256:${"0".repeat(64)}`,
      counts: {
        dangling_live_nodes: 0,
        orphan_verification_bindings: 0,
        absent_node_coverage_mappings: 0,
        stale_derived_carriers: 0,
        generation_identity_conflicts: 0,
        complete: 0
      },
      findings: [],
      authority: { authoritative: false, read_only: true, grants: [] }
    }
  };
}

async function realDiagnosticAssessment65() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-semantic-boundary-"));
  try {
    const fixture = structuredClone(buildRefusalBeforeEffectsFixture());
    const contract = fixture.contract;
    contract.schema_version = "controlled-acceptance-contract.v1";
    contract.profile_id = "acceptance-contract.standard.v1";
    contract.vocabulary_version = "controlled-contract-vocabulary.v1";
    contract.test_proof_version = "controlled-contract-test-proof.v1";
    contract.test_proofs = buildStableTestProofPopulation(contract);
    contract.references = Array.from({ length: 21 }, (_, index) => ({
      reference_id: `REF-${index}`
    }));
    delete contract.profile_id;
    const inputPath = path.join(root, "contract.json");
    await writeFile(inputPath, canonicalJson(contract));
    const proofPlan = {
      schema_version: "controlled-contract-proof-plan.v1",
      requested_intents: [],
      digests: {
        contract: canonicalDigest(normalizeContractForIdentity(contract)),
        catalog: PROOF_INTENT_DIGESTS.catalog,
        vocabulary: PROOF_INTENT_DIGESTS.vocabulary,
        profiles: PROOF_INTENT_DIGESTS.profiles,
        intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact
      },
      packs: []
    };
    const projected = await assessProofPlan({ inputPath, proofPlan });
    assert.equal(projected.assessment.diagnostics.length, 65);
    return {
      ...projected.assessment,
      cross_carrier_integrity: proofAssessment(0).cross_carrier_integrity
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("package descriptors own exact task-relevant populations and continuation vocabulary", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS)
      .map(([family, rows]) => [family, rows.map(({ collection }) => collection)])),
    {
      proof: [
        "per_pack_outcomes", "diagnostics", "proof_exclusions", "missing_inputs",
        "cross_carrier_integrity"
      ],
      integration_test_design: [
        "axes", "gaps", "requirement_coverage", "scenario_coverage",
        "interaction_coverage", "review_question_results", "unsupported_axes",
        "diagnostic_code_summaries"
      ]
    }
  );
  assert.deepEqual(CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY.continuation, {
    collection_rows: "typed_collection",
    structured_values: "typed_field_projection",
    scalar_values: "offset_length_total_range"
  });
  const summary = projectControlledContractProofAssessmentSummary(proofAssessment(1), {});
  assert.equal(Object.hasOwn(summary, "completeness_exemption"), false);
  assert.deepEqual(Object.keys(summary.counts),
    CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS.proof
      .map(({ collection }) => collection));
});

test("both assessment families enforce N-1, N, and N+1 at the final envelope owner", () => {
  const identity = "I".repeat(43);
  const snapshots = { put: () => identity };
  for (const family of ["proof", "integration_test_design"]) {
    const workspaceRepo = family === "proof" ? "agent-chassis" : null;
    const base = {
      ...(workspaceRepo === null ? {} : { workspaceRepo }),
      padding: "",
      assessment_identity: identity
    };
    const overhead = controlledContractPrettyJsonBytes(base);
    for (const target of [8191, 8192, 8193]) {
      const result = { padding: "x".repeat(target - overhead) };
      const invoke = () => materializeControlledContractAssessmentResponse({
        result,
        snapshot: { assessment: {}, source_identity: {} },
        family,
        workspaceRepo,
        snapshots
      });
      if (target <= 8192) {
        const materialized = invoke();
        assert.equal(controlledContractPrettyJsonBytes(materialized), target);
        assert.equal(materialized.assessment_identity, identity);
      } else {
        assert.throws(invoke,
          (error) => error.code === "controlled_contract_semantic_projection_invalid");
      }
    }
    const allowance = controlledContractAssessmentSummaryAllowance({
      ...(workspaceRepo === null ? {} : { workspaceRepo }),
      assessment_identity: identity
    });
    assert(allowance < 8192);
  }
});

test("every byte ceiling accepts N-1 and N and rejects N+1 without cutting or spilling", () => {
  for (const ceiling of [4096, 8192, 16384]) {
    for (const size of [ceiling - 1, ceiling]) {
      assert.equal(assertControlledContractSemanticProjectionBound(
        exactBytes(size), ceiling, { projection_class: "boundary_test" }
      ).value.length > 0, true);
    }
    assert.throws(() => assertControlledContractSemanticProjectionBound(
      exactBytes(ceiling + 1), ceiling, { projection_class: "boundary_test" }
    ), (error) => error.code === "controlled_contract_semantic_projection_invalid");
  }
});

test("the 64-item ceiling accepts N-1 and N, rejects N+1, and pages deterministically", () => {
  const assessment = proofAssessment(65, { compact: true });
  for (const maximumItems of [63, 64]) {
    const page = projectControlledContractProofAssessmentPage({
      assessment, collection: "per_pack_outcomes", maximumItems
    });
    assert(page.returned_count <= maximumItems);
    assert.equal(page.matched_count, 65);
    assert.equal(page.omitted_count, 65 - page.returned_count);
    assert.equal(page.item_limit, maximumItems);
  }
  assert.throws(() => projectControlledContractProofAssessmentPage({
    assessment, collection: "per_pack_outcomes", maximumItems: 65
  }), (error) => error.code === "controlled_contract_assessment_selector_invalid");
});

test("real 65-diagnostic pages budget the complete public N-1/N/N+1 envelope", async () => {
  const assessment = await realDiagnosticAssessment65();
  const summary = projectControlledContractProofAssessmentSummary(assessment, {
    work_record_id: "WK-2426"
  });
  assert.equal(summary.counts.diagnostics, 65);
  assert.equal(summary.first_actionable_gap_count + summary.omitted_actionable_gap_count, 65);
  assert(controlledContractPrettyJsonBytes(summary) <=
    CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.compact_summary_bytes);
  let boundary = null;
  for (let maximumItems = 1; maximumItems <= 64; maximumItems += 1) {
    const registry = createControlledContractAssessmentSnapshotRegistry({
      now: () => 1000, random: (size) => Buffer.alloc(size, maximumItems)
    });
    const identity = registry.put({
      family: "proof", assessment, sourceIdentity: { digest: "real-65" },
      assessOperation: "workspace_controlled_contract_assess"
    });
    const page = await registry.query({
      family: "proof", identity, collection: "diagnostics", maximumItems
    });
    assert(controlledContractPrettyJsonBytes(page) <=
      CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.detail_census_bytes);
    if (page.returned_count < maximumItems) {
      boundary = maximumItems - 1;
      break;
    }
  }
  assert(Number.isInteger(boundary) && boundary > 1);
  for (const [maximumItems, expected] of [
    [boundary - 1, boundary - 1], [boundary, boundary], [boundary + 1, boundary]
  ]) {
    const registry = createControlledContractAssessmentSnapshotRegistry({
      now: () => 1000, random: (size) => Buffer.alloc(size, maximumItems)
    });
    const identity = registry.put({
      family: "proof", assessment, sourceIdentity: { digest: "real-65" },
      assessOperation: "workspace_controlled_contract_assess"
    });
    const page = await registry.query({
      family: "proof", identity, collection: "diagnostics", maximumItems
    });
    assert.equal(page.returned_count, expected);
    assert.equal(page.omitted_count, 65 - expected);
    assert.equal(page.cursor !== null, true);
    assert(controlledContractPrettyJsonBytes(page) <= 16_384);
    assert.equal(JSON.stringify(page).includes("content_reference"), false);
    assert.equal(JSON.stringify(page).includes("spill"), false);
  }
});

test("snapshot identities, LRU/expiry, authenticated cursors, currentness, and selector partitions", async () => {
  let clock = 1000;
  let seed = 0;
  const random = (size) => Buffer.alloc(size, ++seed);
  const registry = createControlledContractAssessmentSnapshotRegistry({
    now: () => clock, random, capacity: 32, ttlMs: 30 * 60 * 1000
  });
  const assessment = await realDiagnosticAssessment65();
  const identities = [];
  for (let index = 0; index < 32; index += 1) identities.push(registry.put({
    family: "proof", assessment, sourceIdentity: { digest: `d${index}` },
    assessOperation: "workspace_controlled_contract_assess"
  }));
  assert.match(identities[0], /^[A-Za-z0-9_-]{43}$/u);
  await registry.query({
    family: "proof", identity: identities[0], collection: "diagnostics"
  });
  identities.push(registry.put({
    family: "proof", assessment, sourceIdentity: { digest: "d32" },
    assessOperation: "workspace_controlled_contract_assess"
  }));
  assert.equal(registry.size(), 32);
  await assert.rejects(registry.query({
    family: "proof", identity: identities[1], collection: "diagnostics"
  }), (error) => error.code === "controlled_contract_assessment_snapshot_unavailable" &&
    error.details.caller_correctable === true &&
    error.details.supported_next_call === "workspace_controlled_contract_assess");

  const first = await registry.query({
    family: "proof", identity: identities.at(-1), collection: "diagnostics"
  });
  assert(first.returned_count < 65);
  assert.equal(first.cursor !== null, true);
  assert.equal(JSON.stringify(first).includes("content_reference"), false);
  let returned = first.returned_count;
  let continuation = first.cursor;
  while (continuation !== null) {
    const page = await registry.query({ family: "proof", cursor: continuation });
    returned += page.returned_count;
    continuation = page.cursor;
  }
  assert.equal(returned, 65);
  const [cursorBody, cursorMac] = first.cursor.split(".");
  const replacement = cursorMac[0] === "x" ? "y" : "x";
  await assert.rejects(registry.query({
    family: "proof", cursor: `${cursorBody}.${replacement}${cursorMac.slice(1)}`
  }), (error) => error.code === "controlled_contract_assessment_snapshot_unavailable");

  await assert.rejects(registry.query({
    family: "proof", identity: identities.at(-1), collection: "diagnostics",
    selector: { state: "invalid" }, currentSourceIdentity: { digest: "mutated" }
  }), (error) => error.code === "controlled_contract_assessment_snapshot_unavailable" &&
    error.details.reason === "source_identity_changed");

  const restarted = createControlledContractAssessmentSnapshotRegistry({ random });
  await assert.rejects(restarted.query({
    family: "proof", identity: identities.at(-1), collection: "diagnostics"
  }), (error) => error.code === "controlled_contract_assessment_snapshot_unavailable");
  clock += 30 * 60 * 1000 + 1;
  await assert.rejects(registry.query({
    family: "proof", identity: identities.at(-1), collection: "diagnostics"
  }), (error) => error.code === "controlled_contract_assessment_snapshot_unavailable");
});

test("controlled response guard rejects raw fields and content-reference envelopes", () => {
  for (const mutant of [
    { raw_bytes: "secret" },
    { nested: { content_reference: { kind: "wiki_mcp_response_content_reference" } } },
    { schema_version: "wiki-mcp-spilled-response.v1" }
  ]) assert.throws(() => assertNoControlledContractRawResponse(mutant));
  assert.deepEqual(assertNoControlledContractRawResponse({ items: [{ id: "semantic" }] }),
    { items: [{ id: "semantic" }] });
});

test("controlled response guard rejects descriptor, count, and completeness mutants", () => {
  const summary = materializeControlledContractAssessmentResponse({
    result: projectControlledContractProofAssessmentSummary(proofAssessment(1), {}),
    snapshot: { assessment: proofAssessment(1), source_identity: {} },
    family: "proof",
    workspaceRepo: "agent-chassis",
    snapshots: { put: () => "I".repeat(43) }
  });
  for (const mutant of [
    { ...summary, counts: { ...summary.counts, diagnostics: -1 } },
    { ...summary, counts: { per_pack_outcomes: 1 } },
    { ...summary, assessment_identity: undefined },
    { ...summary, completeness_exemption: "complete_proof_artifact_server_private" },
    { ...summary, result_digest: `sha256:${"0".repeat(64)}` }
  ]) assert.throws(() => assertNoControlledContractRawResponse(mutant));
  const page = {
    ...projectControlledContractProofAssessmentPage({
      assessment: proofAssessment(1), collection: "per_pack_outcomes"
    }),
    assessment_identity: "I".repeat(43),
    supported_next_call: "workspace_controlled_contract_assessment_query"
  };
  for (const mutant of [
    { ...page, collection: "raw_carrier" },
    { ...page, returned_count: page.returned_count + 1 },
    { ...page, completeness_exemption: "complete_proof_artifact_server_private" }
  ]) assert.throws(() => assertNoControlledContractRawResponse(mutant));
});
