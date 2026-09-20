import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_REPAIR_ROLE_BINDINGS,
  CONTROLLED_CONTRACT_REPAIR_SEMANTIC_OWNERS,
  ControlledContractRepairCensusError,
  censusControlledContractRepairParticipants,
  enumerateControlledContractRepairRoles,
  projectControlledContractRepairParticipantCensus
} from
  "../../packages/wiki-core/src/operations/controlled-contract/repair-participant-registry.mjs";
import {
  CONTROLLED_CONTRACT_CARRIER_KINDS
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  CONTROLLED_CONTRACT_COVERAGE_FAMILIES
} from
  "../../packages/wiki-core/src/operations/controlled-contract/acceptance-coverage-operations.mjs";

const REGISTRY_PATH = new URL(
  "../../packages/wiki-core/src/operations/controlled-contract/repair-participant-registry.mjs",
  import.meta.url);

test("every repair-relevant role is enumerated from a current schema source", () => {
  const roles = enumerateControlledContractRepairRoles();
  const sources = new Set(roles.map(({ source }) => source));

  for (const kind of CONTROLLED_CONTRACT_CARRIER_KINDS) {
    assert.ok(roles.some(({ role_id: id }) => id === `carrier:${kind}`),
      `carrier kind ${kind} must produce a repair role`);
  }
  for (const family of CONTROLLED_CONTRACT_COVERAGE_FAMILIES) {
    assert.ok(roles.some(({ role_id: id }) => id === `coverage:${family}`),
      `coverage family ${family} must produce a repair role`);
  }
  assert.ok(sources.has("CONTROLLED_CONTRACT_CARRIER_KINDS"));
  assert.ok(sources.has("CONTROLLED_CONTRACT_COVERAGE_FAMILIES"));
  assert.ok(sources.has("CONTROLLED_CONTRACT_PROSPECTIVE_COMPILATION_ROLES"));
  for (const role of roles) {
    assert.equal(role.role_id, `${role.family}:${role.name}`);
  }
});

test("the shipped registry binds every role to one incumbent owner or a reason", () => {
  const census = censusControlledContractRepairParticipants();
  assert.equal(census.role_count,
    census.mutable_role_count + census.non_repairable_role_count);
  assert.equal(census.role_count, enumerateControlledContractRepairRoles().length);
  for (const role of census.roles) {
    if (role.mutable) {
      assert.equal(typeof role.prepare_owner, "string");
      assert.equal(typeof role.settlement_participant, "string");
      assert.equal(role.non_repairable_reason, null);
    } else {
      assert.equal(role.prepare_owner, null);
      assert.equal(role.settlement_participant, null);
      assert.equal(typeof role.non_repairable_reason, "string");
    }
  }

  for (const roleId of ["carrier:contract", "carrier:proof_plan",
    "coverage:obligation", "coverage:acceptance", "embedded:test_proofs",
    "embedded:proof_pack_bindings", "verification:runtime_inventory",
    "manifest:carrier_set"]) {
    const row = census.roles.find(({ role_id: id }) => id === roleId);
    assert.ok(row, `${roleId} must be in the census`);
    assert.equal(row.mutable, true, `${roleId} must be repairable`);
  }
});

test("a new mutable role with no participant fails the census", () => {
  const roles = [...enumerateControlledContractRepairRoles(),
    Object.freeze({ family: "carrier", name: "newly_added_kind",
      role_id: "carrier:newly_added_kind", source: "CONTROLLED_CONTRACT_CARRIER_KINDS" })];
  assert.throws(() => censusControlledContractRepairParticipants({ roles }),
    (error) => error instanceof ControlledContractRepairCensusError &&
      error.code === "controlled_contract_repair_role_unclassified" &&
      error.details.role_ids.includes("carrier:newly_added_kind"));
});

test("a binding for a role no schema produces fails the census", () => {
  const bindings = { ...CONTROLLED_CONTRACT_REPAIR_ROLE_BINDINGS,
    "carrier:retired_kind": { mutable: true, prepare_owner: "owner",
      settlement_participant: "canonical_generation" } };
  assert.throws(() => censusControlledContractRepairParticipants({ bindings }),
    (error) => error.code === "controlled_contract_repair_role_unknown" &&
      error.details.role_ids.includes("carrier:retired_kind"));
});

test("a mutable binding missing its owner or participant fails the census", () => {
  const bindings = { ...CONTROLLED_CONTRACT_REPAIR_ROLE_BINDINGS,
    "carrier:contract": { mutable: true, prepare_owner: "owner" } };
  assert.throws(() => censusControlledContractRepairParticipants({ bindings }),
    (error) => error.code === "controlled_contract_repair_role_incomplete" &&
      error.details.role_id === "carrier:contract");
});

test("a non-repairable binding without an explicit reason fails the census", () => {
  const bindings = { ...CONTROLLED_CONTRACT_REPAIR_ROLE_BINDINGS,
    "derived:workbench_manifest": { mutable: false } };
  assert.throws(() => censusControlledContractRepairParticipants({ bindings }),
    (error) => error.code === "controlled_contract_repair_role_incomplete");
});

test("a semantic owner may only claim roles the schemas produce", () => {
  const owners = { ...CONTROLLED_CONTRACT_REPAIR_SEMANTIC_OWNERS };
  assert.ok(Object.values(owners).flat().every((roleId) =>
    enumerateControlledContractRepairRoles().some(({ role_id: id }) => id === roleId)),
  "every claimed role must exist in the enumerated population");
});

test("the registry contains no WK identity, cardinality, or repository path", async () => {
  const source = await readFile(REGISTRY_PATH, "utf8");

  assert.equal(/\bWK-\d{3,}\b/u.test(source), false,
    "the registry must not name a work record");
  assert.equal(/\bfocus\s*[:=]\s*"/u.test(source), false,
    "the registry must not pin a focus value");
  assert.equal(/\bwiki\/(?:contracts|work-records)\b/u.test(source), false,
    "the registry must not name a repository path");
});

test("the public census projection is compact and carries exact denominators", () => {
  const census = censusControlledContractRepairParticipants();
  const projected = projectControlledContractRepairParticipantCensus(census);
  assert.deepEqual(Object.keys(projected).sort(), [
    "mutable_role_count", "non_repairable_role_count", "role_count",
    "role_ids", "schema_version", "settlement_participants"
  ]);
  assert.equal(projected.role_count, census.role_count);
  assert.equal(projected.role_ids.length, census.role_count);

  assert.equal(JSON.stringify(projected).includes("prepare_owner"), false);
});
