

import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const CARRIER_SET_FIXTURES = path.resolve(import.meta.dirname,
  "../fixtures/controlled-contract-carrier-sets");

const COVERAGE_SUFFIXES = Object.freeze([
  "obligation-coverage", "controlled-acceptance-coverage"
]);

export function carrierSetFixtureDirectory(stem) {
  return path.join(CARRIER_SET_FIXTURES, stem);
}

function isCoverageMember(stem, name) {
  return COVERAGE_SUFFIXES.some((suffix) => name === `${stem}.${suffix}.json`);
}

export function carrierSetFixtureRecordPath(stem) {
  const wkId = /^WK-\d+/u.exec(stem)?.[0];
  if (!wkId) throw new Error(`${stem} names no owning work record`);
  return path.join(CARRIER_SET_FIXTURES, wkId, `${wkId}.work-record.json`);
}

export async function readCarrierSetFixture(stem) {
  const directory = carrierSetFixtureDirectory(stem);
  const names = (await readdir(directory)).sort();
  const recordName = `${stem}.work-record.json`;
  const members = new Map();
  const coverage = new Map();
  for (const name of names) {
    if (name === recordName) continue;
    const content = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    if (isCoverageMember(stem, name)) coverage.set(name, content);
    else members.set(name, content);
  }
  const recordPath = carrierSetFixtureRecordPath(stem);
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  return { stem, wkId: record.id, directory, recordPath, members, coverage, record };
}

export async function seedCarrierSetFixture({
  repoRoot, stem, recordPath = null, coverageCarriers = true, publish = true
}) {
  const fixture = await readCarrierSetFixture(stem);
  const contracts = path.join(repoRoot, "wiki", "contracts");
  const records = path.join(repoRoot, "wiki", "work-records");
  await mkdir(contracts, { recursive: true });
  await mkdir(records, { recursive: true });
  await cp(recordPath ?? fixture.recordPath,
    path.join(records, `${fixture.wkId}.json`));
  for (const [name, content] of fixture.members) {
    await writeFile(path.join(contracts, name), `${JSON.stringify(content, null, 2)}\n`);
  }
  if (coverageCarriers) {
    for (const [name, content] of fixture.coverage) {
      await writeFile(path.join(contracts, name), `${JSON.stringify(content, null, 2)}\n`);
    }
  }
  if (!publish) return { generation: null, manifest: null, contracts, fixture };
  const { resolveCanonicalControlledContractCarrierSet } = await import(
    "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs");
  const { writeControlledContractCarrierOperation } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract.mjs");
  const focus = stem === fixture.wkId ? null : stem.slice(fixture.wkId.length + 1);
  const seeded = await resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId: fixture.wkId, focus });
  const contractBasename = [...fixture.members.keys()].find((name) =>
    name.includes(".controlled-acceptance."));
  await writeControlledContractCarrierOperation({
    repoRoot, wkId: fixture.wkId, focus, carrierKind: "contract",
    expectedContentDigest: seeded.members_by_basename[contractBasename].content_digest,
    content: seeded.members_by_basename[contractBasename].content
  });
  const manifest = JSON.parse(await readFile(
    path.join(contracts, `${stem}.carrier-set-manifest.json`), "utf8"));
  return { generation: manifest.generation.id, manifest, contracts, fixture };
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
