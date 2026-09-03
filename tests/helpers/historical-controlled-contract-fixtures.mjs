

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../packages/controlled-contract/lib/stable-v1-migration.mjs";

const CATALOG_PATH = path.resolve(import.meta.dirname,
  "../../packages/controlled-contract/profiles/catalog.json");

let admittedVersions = null;

async function admittedPackVersions() {
  if (admittedVersions === null) {
    const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    admittedVersions = new Map(catalog.packs.map(
      ({ profile_id: profileId, profile_version: profileVersion }) =>
        [profileId, profileVersion]));
  }
  return admittedVersions;
}

export async function admittedPackVersion(profileId) {
  return (await admittedPackVersions()).get(profileId) ?? null;
}

export function stableTestProofsFor(contract) {
  const referenceId = contract.references[0].reference_id;
  const propositionId = contract.propositions[0].proposition_id;
  return contract.claims.filter(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution"
  ).map(({ claim_id: claimId }, index) => ({
    test_proof_id: `test-proof-${claimId}`,
    verification_claim_id: claimId,
    system_under_test_boundary: { boundary_id: `sut-boundary-${index}`, kind: "module",
      runtime_module_path: "packages/controlled-contract/current.mjs",
      subject_reference_ids: [referenceId] },
    observable_result: { observable_id: `observable-${index}`, kind: "return_value",
      proposition_id: propositionId },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: `falsifier-${index}`, strategy: "dependency_failure",
      proposition_id: propositionId, expected_outcome: "verification_fails",
      mutation: { mutation_id: `mutation-${index}`, mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/current.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    coverage_disposition: { baseline_id: `coverage-baseline-${index}`,
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: `test-${index}`, disposition: "preserved" }] },
    prohibited_shortcuts: ["source_text_inspection"]
  }));
}

export function stabilizeHistoricalContract(contract) {
  return migrateControlledAcceptanceContractV02ToV1({
    contract, testProofs: stableTestProofsFor(contract)
  });
}

export function stabilizeEvaluationInput(input) {
  return { ...input, input_version: "controlled-contract-verification-profile-input.v1",
    stable_evaluation: {} };
}

export async function stabilizeProofPlanRequest(request) {
  const versions = await admittedPackVersions();
  return { ...request, selected_packs: (request.selected_packs ?? []).map((pack) => ({
    ...pack,
    profile_version: versions.get(pack.profile_id) ?? pack.profile_version
  })) };
}

export async function stabilizeHistoricalCarrier(filename, content) {
  if (filename.includes(".controlled-acceptance.")) {
    return stabilizeHistoricalContract(content);
  }
  if (filename.includes(".evaluation-input.")) return stabilizeEvaluationInput(content);
  if (filename.includes(".proof-plan-request.")) {
    return stabilizeProofPlanRequest(content);
  }
  return content;
}

export async function writeCanonicalWorkRecord(root, wkId) {
  const directory = path.join(root, "wiki", "work-records");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${wkId}.json`), `${JSON.stringify({
    schema_version: "work-record.v1", id: wkId,
    repo: "agent-chassis/agent-chassis", title: "controlled-contract MCP fixture",
    record_kind: "work_item", work_kind: "implementation", status: "active",
    priority: "high", owner: "unassigned", created: "2026-08-17", updated: "2026-08-17",
    read_scope: ["docs/mcp-integration.md"],
    repo_paths: ["packages/controlled-contract/current.mjs"],
    write_scope: ["packages/controlled-contract/current.mjs"],
    depends_on: [], blocks: [], related: [],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "record",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["The registered route round-trips."], validation: [] },
    sections: { summary: "Exercise the registered controlled-contract routes.",
      why_it_matters: "Registration parity is checked against live routes.",
      scope: { items: ["Drive the registered routes."], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null },
    children: [], slices: [], escalations: [], projections: [], migration: null,
    derived_evidence: [], initiative: "IN-0001"
  }, null, 2)}\n`);
}
