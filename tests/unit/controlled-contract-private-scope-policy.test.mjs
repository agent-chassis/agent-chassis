import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyControlledContractPrivatePathEntry,
  collectControlledContractPrivateScopeIntersections,
  collectWorkRecordControlledContractPrivateScopeFacts,
  queryControlledContractPrivateScopeCensusOperation
} from "@agent-chassis/wiki-core";
import { validateWorkRecord } from
  "../../packages/wiki-core/src/lib/work-record-schema.mjs";

test("private-path classification emits structured non-authoritative policy facts", () => {
  const cases = new Map([
    ["wiki/contracts", "exact"],
    ["wiki/contracts/WK-2426.json", "directory"],
    ["wiki", "ancestor"],
    ["wiki/**", "wildcard"]
  ]);
  for (const [entry, matchKind] of cases) {
    const classification = classifyControlledContractPrivatePathEntry(entry);
    assert.equal(classification.intersects, true);
    assert.equal(classification.match_kind, matchKind);
  }
  assert.equal(classifyControlledContractPrivatePathEntry("docs").intersects, false);
  for (const entry of [
    "wiki/**", "wiki/contracts/**", "wiki/contract?", "wiki/[cd]ontracts",
    "*/contracts"
  ]) assert.equal(classifyControlledContractPrivatePathEntry(entry).intersects, true, entry);
  for (const entry of [
    "wiki/?/file", "wiki/contract/file", "docs/**", "wiki/[ab]ontracts"
  ]) assert.equal(classifyControlledContractPrivatePathEntry(entry).intersects, false, entry);
  for (const entry of ["./wiki/contracts/", "wiki", "wiki/contracts/file.json"]) {
    assert.equal(classifyControlledContractPrivatePathEntry(entry).intersects, true, entry);
  }
  assert.equal(classifyControlledContractPrivatePathEntry("wiki/[abc").valid, false);
  assert.equal(classifyControlledContractPrivatePathEntry("wiki/contracts]").valid, false);
  const facts = collectControlledContractPrivateScopeIntersections({
    status: "ready",
    read_scope: ["wiki/contracts/WK-2426.json"],
    repo_paths: ["wiki/**"],
    write_scope: ["packages/wiki-core"]
  }, { unitAddress: "WK-2426#SLICE-006" });
  assert.equal(facts.length, 2);
  assert.ok(facts.every((fact) => fact.policy_authority === "possible_cce_input"));
  assert.ok(facts.every((fact) => fact.local_refusal_authority === false));
  assert.ok(facts.every((fact) =>
    fact.authenticated_cce_decision_required_for_policy_disposition === true));

  const recordFacts = collectWorkRecordControlledContractPrivateScopeFacts({
    id: "WK-2426", status: "done", read_scope: [], repo_paths: [], write_scope: [],
    slices: [{ id: "SLICE-006", status: "active", read_scope: ["wiki/**"],
      repo_paths: [], write_scope: [] }]
  });
  assert.equal(recordFacts[0].parent_status, "done");

  const canonical = JSON.parse(readFileSync("wiki/work-records/WK-2426.json", "utf8"));
  const diagnostics = validateWorkRecord(canonical);
  assert.equal(Array.isArray(diagnostics), true);
  assert.equal(Object.hasOwn(diagnostics, "policy_facts"), false,
    "diagnostics must remain a diagnostics array rather than a hidden public envelope");

  const malformed = structuredClone(canonical);
  malformed.slices[0].read_scope = ["wiki/[contracts"];
  assert.ok(validateWorkRecord(malformed).some((diagnostic) =>
    diagnostic.code === "invalid_record" &&
    diagnostic.path === "slices[0].read_scope[0]"));
});

function writeRecord(directory, id, status, slices = []) {
  writeFileSync(path.join(directory, `${id}.json`), `${JSON.stringify({
    id, status, read_scope: [], repo_paths: [], write_scope: [], slices
  }, null, 2)}\n`);
}

test("private-scope census is exact, deterministic, ID ordered, bounded, and mutation bound", async () => {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wk2426-census-")));
  const records = path.join(repo, "wiki", "work-records");
  mkdirSync(records, { recursive: true });
  try {
    writeRecord(records, "WK-0002", "done", [{
      id: "SLICE-001", status: "done", read_scope: ["wiki/contracts"],
      repo_paths: [], write_scope: []
    }]);
    writeRecord(records, "WK-0001", "ready", Array.from({ length: 65 }, (_, index) => ({
      id: `SLICE-${String(index + 1).padStart(3, "0")}`,
      status: "ready",
      read_scope: index % 2 === 0 ? ["wiki/contracts"] : [],
      repo_paths: index % 2 === 1 ? ["wiki/**"] : [],
      write_scope: []
    })));
    const before = new Map(["WK-0001", "WK-0002"].map((id) => [
      id, readFileSync(path.join(records, `${id}.json`), "utf8")
    ]));
    const first = await queryControlledContractPrivateScopeCensusOperation({ repoRoot: repo });
    const repeated = await queryControlledContractPrivateScopeCensusOperation({ repoRoot: repo });
    assert.deepEqual(repeated, first);
    assert.equal(first.counts.records, 2);
    assert.equal(first.counts.intersections, 66);
    assert.equal(first.counts.nonterminal_intersections, 65);
    assert.equal(first.counts.terminal_intersections, 1);
    assert.equal(first.matched_count, 65);
    assert.ok(first.returned_count <= 64);
    assert.equal(first.mutation_count, 0);
    assert.equal(first.read_only, true);
    assert.ok(first.items.every((item, index, items) => index === 0 ||
      items[index - 1].unit_address.localeCompare(item.unit_address, "en") <= 0));
    assert.ok(Buffer.byteLength(`${JSON.stringify(first, null, 2)}\n`, "utf8") <= 16384);
    assert.ok(first.cursor);

    const second = await queryControlledContractPrivateScopeCensusOperation({
      repoRoot: repo, cursor: first.cursor
    });
    assert.equal(first.returned_count + second.returned_count, 65);
    await assert.rejects(queryControlledContractPrivateScopeCensusOperation({
      repoRoot: repo, cursor: `${first.cursor.slice(0, -4)}xxxx`
    }), (error) => error.code === "controlled_contract_private_scope_census_cursor_invalid");

    writeRecord(records, "WK-0003", "ready", [{
      id: "SLICE-001", status: "ready", read_scope: ["wiki/contracts/new"],
      repo_paths: [], write_scope: []
    }]);
    await assert.rejects(queryControlledContractPrivateScopeCensusOperation({
      repoRoot: repo, cursor: first.cursor
    }), (error) => error.code === "controlled_contract_private_scope_census_cursor_invalid");
    for (const [id, contents] of before) {
      assert.equal(readFileSync(path.join(records, `${id}.json`), "utf8"), contents);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
