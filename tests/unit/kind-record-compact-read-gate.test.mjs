import test from "node:test";
import assert from "node:assert/strict";

import { runWorkRecordReadWithCompactGate } from "../../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
const WORKSPACE_REPO = "agent-chassis/agent-chassis";
const WORKSPACE_DIR = "/repo";
function initiativeRecord() {
  return {
    id: "IN-9001",
    record_kind: "initiative",
    title: "Compact initiative",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-08-30",
    updated: "2026-08-30",
    related: ["WK-2400"],
    sections: { summary: "Summary body.", goals: ["Goal one", "Goal two"],
      milestones: [{ title: "Milestone", status: "todo" }] }
  };
}
function decisionRecord() {
  return {
    id: "DEC-9001",
    record_kind: "decision",
    title: "Compact decision",
    status: "accepted",
    date: "2026-08-30",
    owners: ["codex"],
    docs: ["docs/operating-model.md"],
    sections: { context: "Context body.", decision: "Decision body.",
      consequences: ["Consequence one", "Consequence two"] }
  };
}
function canonicalPath(record) {
  return record.record_kind === "initiative"
    ? `wiki/initiatives/${record.id}.json`
    : `wiki/decisions/${record.id}.json`;
}
function kindReadResult(record, sourceDigest) {
  return {
    format: "json-kind-record",
    relativePath: canonicalPath(record),
    pageKind: `${record.record_kind}s`,
    id: record.id,
    record_id: record.id,
    record_kind: record.record_kind,
    title: record.title,
    source_classification: "canonical",
    canonical_record_path: canonicalPath(record),
    source_digest: sourceDigest,
    valid: true,
    classification: "loaded",
    diagnostics: [],
    record
  };
}
function gateHarness({ record, toolFamily }) {
  let sourceDigest = "sha256:kind-source-a";
  const compactCalls = [];
  const expensiveCalls = [];
  const primary = toolFamily === "workspace_read_page"
    ? { path: canonicalPath(record) }
    : { id: record.id };
  return {
    primary,
    setSourceDigest(value) { sourceDigest = value; },
    compactCalls,
    expensiveCalls,
    run(args) {
      return runWorkRecordReadWithCompactGate({
        workspaceRepo: WORKSPACE_REPO,
        workspaceDir: WORKSPACE_DIR,
        args,
        toolFamily,
        readCompact: async (readArgs) => {
          compactCalls.push(readArgs);
          return kindReadResult(record, sourceDigest);
        },
        readExpensive: async (readArgs) => {
          expensiveCalls.push(readArgs);
          return kindReadResult(record, sourceDigest);
        },
        readWorkRecordById: async () => { throw new Error("kind reads must not use the WK loader"); }
      });
    }
  };
}
function completeRecordMembers(record) {
  const topLevelMembers = Object.keys(record);
  const sectionMembers = Object.keys(record.sections ?? {}).map((member) => `sections.${member}`);
  return [...topLevelMembers, ...sectionMembers].sort();
}
function recordMemberValue(record, member) {
  if (member.startsWith("sections.")) return record.sections?.[member.slice("sections.".length)];
  return record[member];
}
function compactMemberValue(compact, member) {
  if (member === "id") return compact.record_id;
  if (member === "record_kind") return compact.record_kind;
  if (member === "title") return compact.title;
  return undefined;
}
function sortedMembers(members) {
  return [...members].sort();
}
function sameMembers(left, right) {
  return JSON.stringify(sortedMembers(left)) === JSON.stringify(sortedMembers(right));
}
function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function disclosureViolations({ source, compact, ledger, recovered }) {
  const violations = [];
  const sourceMembers = completeRecordMembers(source);
  const expectedCompactMembers = sourceMembers.filter((member) =>
    compactMemberValue(compact, member) !== undefined &&
    sameValue(compactMemberValue(compact, member), recordMemberValue(source, member)));
  const expectedCompactSet = new Set(expectedCompactMembers);
  const expectedOmittedMembers = sourceMembers.filter((member) => !expectedCompactSet.has(member));
  const compactMembers = sortedMembers(ledger.compact_members);
  const omittedMembers = sortedMembers(ledger.omitted_members);
  const accountedMembers = sortedMembers(ledger.accounted_members);
  const disclosedMembers = sortedMembers(ledger.disclosed_members);
  const recoveredMembers = sortedMembers(ledger.recovered_members);
  const actualRecoveredMembers = recovered ? completeRecordMembers(recovered) : [];
  if (!sameMembers(sourceMembers, ledger.source_members)) {
    violations.push("source_members");
  }
  if (!sameMembers(expectedCompactMembers, compactMembers)) violations.push("compact_members");
  if (!sameMembers(expectedOmittedMembers, omittedMembers)) violations.push("omitted_members");
  if (!sameMembers(sourceMembers, accountedMembers)) violations.push("accounted_members");
  if (!sameMembers(expectedCompactMembers, disclosedMembers)) violations.push("disclosed_members");
  if (!sameMembers(sourceMembers, recoveredMembers)) violations.push("recovered_members");
  if (ledger.source_member_count !== sourceMembers.length) violations.push("source_total");
  if (ledger.compact_member_count !== expectedCompactMembers.length) violations.push("compact_total");
  if (ledger.omitted_member_count !== expectedOmittedMembers.length) violations.push("omission_total");
  if (ledger.accounted_member_count !== sourceMembers.length) violations.push("accounted_total");
  if (ledger.disclosed_member_count !== expectedCompactMembers.length) violations.push("disclosed_total");
  if (ledger.recovered_member_count !== sourceMembers.length) violations.push("recovered_total");
  if (!sameMembers([...new Set([...compactMembers, ...omittedMembers])], sourceMembers)) {
    violations.push("unaccounted_source_members");
  }
  if (omittedMembers.length === 0) violations.push("zero_heavy_member_omission");
  for (const member of compactMembers) {
    if (!sameValue(compactMemberValue(compact, member), recordMemberValue(source, member))) {
      violations.push(`undisclosed_compact_member:${member}`);
    }
  }
  if (recovered) {
    if (!sameMembers(actualRecoveredMembers, sourceMembers)) violations.push("recovered_member_set");
    for (const member of sourceMembers) {
      if (!sameValue(recordMemberValue(recovered, member), recordMemberValue(source, member))) {
        violations.push(`unrecovered_member:${member}`);
      }
    }
  }
  return violations;
}
for (const record of [initiativeRecord(), decisionRecord()]) {
  test(`${record.record_kind} compact disclosure accounts for and losslessly recovers every member`, async () => {
    for (const toolFamily of ["workspace_get_record", "workspace_read_page"]) {
      const harness = gateHarness({ record, toolFamily });
      const compact = await harness.run(harness.primary);
      const ledger = compact.compact_read.member_ledger;
      const topLevelMembers = Object.keys(record).sort();
      const sectionMembers = Object.keys(record.sections).map((member) => `sections.${member}`).sort();
      const sourceMembers = [...topLevelMembers, ...sectionMembers].sort();
      const compactMembers = ["id", "record_kind", "title"];
      const compactMemberSet = new Set(compactMembers);
      const omittedMembers = sourceMembers.filter((member) => !compactMemberSet.has(member));
      const accountedMembers = [...compactMembers, ...omittedMembers].sort();
      const disclosedMembers = sourceMembers.filter((member) =>
        compactMemberValue(compact, member) !== undefined &&
        sameValue(compactMemberValue(compact, member), recordMemberValue(record, member)));
      assert.equal("record" in compact, false, "compact response must omit the heavy record");
      assert.equal(compact.record_id, record.id);
      assert.equal(compact.record_kind, record.record_kind);
      assert.equal(compact.source_classification, "canonical");
      assert.equal(compact.source_digest, "sha256:kind-source-a");
      assert.equal(compact.valid, true);
      assert.deepEqual(compact.diagnostics, []);
      assert.deepEqual(ledger.source_members, sourceMembers);
      assert.deepEqual(ledger.compact_members, compactMembers);
      assert.deepEqual(ledger.omitted_members, omittedMembers);
      assert.deepEqual(ledger.accounted_members, accountedMembers);
      assert.deepEqual(ledger.disclosed_members, disclosedMembers);
      assert.deepEqual(ledger.recovered_members, sourceMembers);
      assert.deepEqual(
        ledger.source_members.filter((member) => topLevelMembers.includes(member)),
        topLevelMembers,
        "source population must enumerate every top-level field"
      );
      assert.deepEqual(
        ledger.source_members.filter((member) => member.startsWith("sections.")),
        sectionMembers,
        "source population must enumerate every member of the complete sections map"
      );
      assert.equal(ledger.source_member_count, sourceMembers.length);
      assert.equal(ledger.compact_member_count, compactMembers.length);
      assert.equal(ledger.omitted_member_count, omittedMembers.length);
      assert.equal(ledger.accounted_member_count, accountedMembers.length);
      assert.equal(ledger.disclosed_member_count, disclosedMembers.length);
      assert.equal(ledger.recovered_member_count, sourceMembers.length);
      assert.equal(compact.compact_read.omitted_detail_counts.record_members, ledger.omitted_member_count);
      assert.deepEqual(compact.compact_read.detail_available_via, ["accept_full_read"]);
      assert.equal(compact.compact_read.next_calls.length, 1);
      assert.equal(compact.compact_read.next_calls[0].tool, toolFamily);
      assert.deepEqual(compact.compact_read.next_calls[0].arguments,
        { ...harness.primary, include_record: true, accept_full_read: true });
      const recovered = await harness.run({
        ...harness.primary,
        include_record: true,
        accept_full_read: true
      });
      assert.deepEqual(recovered.record, record);
      assert.deepEqual(recovered.record.sections, record.sections);
      assert.deepEqual(
        completeRecordMembers(recovered.record),
        sourceMembers,
        "recovery must return every source member"
      );
      assert.deepEqual(
        disclosureViolations({ source: record, compact, ledger, recovered: recovered.record }),
        []
      );
    }
  });
}
test("kind-record continuations reject tampered and stale acknowledgments on both read routes", async () => {
  for (const toolFamily of ["workspace_get_record", "workspace_read_page"]) {
    const harness = gateHarness({ record: initiativeRecord(), toolFamily });
    const compact = await harness.run(harness.primary);
    const token = compact.compact_read.compact_read_token;
    const tampered = await harness.run({
      ...harness.primary,
      include_record: true,
      compact_read_token: `${token.slice(0, -1)}!`
    });
    assert.equal(tampered.accepted, false);
    assert.equal(tampered.reason_code, "compact_read_token_malformed");
    harness.setSourceDigest("sha256:kind-source-b");
    const stale = await harness.run({
      ...harness.primary,
      include_record: true,
      compact_read_token: token
    });
    assert.equal(stale.accepted, false);
    assert.equal(stale.reason_code, "compact_read_token_stale_source_digest");
    assert.equal(harness.expensiveCalls.length, 0);
  }
});
test("mismatched kind-record compact routes bind disclosure and recovery to the requested identity", async () => {
  for (const fixture of [
    { record: initiativeRecord(), requestedId: "IN-9001", embeddedId: "IN-9002" },
    { record: decisionRecord(), requestedId: "DEC-9001", embeddedId: "DEC-9002" }
  ]) {
    fixture.record.id = fixture.embeddedId;
    const requestedPath = fixture.record.record_kind === "initiative"
      ? `wiki/initiatives/${fixture.requestedId}.json`
      : `wiki/decisions/${fixture.requestedId}.json`;
    const readResult = {
      ...kindReadResult(fixture.record, "sha256:mismatched-kind-source"),
      relativePath: requestedPath,
      id: fixture.requestedId,
      record_id: fixture.requestedId,
      canonical_record_path: requestedPath,
      valid: false,
      classification: "invalid_record",
      diagnostics: [{ code: "record_identity_mismatch", severity: "error", path: "id" }]
    };
    for (const toolFamily of ["workspace_get_record", "workspace_read_page"]) {
      const primary = toolFamily === "workspace_read_page"
        ? { path: requestedPath }
        : { id: fixture.requestedId };
      const run = (args) => runWorkRecordReadWithCompactGate({
        workspaceRepo: WORKSPACE_REPO,
        workspaceDir: WORKSPACE_DIR,
        args,
        toolFamily,
        readCompact: async () => structuredClone(readResult),
        readExpensive: async () => structuredClone(readResult),
        readWorkRecordById: async () => { throw new Error("kind reads must not use the WK loader"); }
      });
      const compact = await run(primary);
      assert.equal(compact.id, fixture.requestedId);
      assert.equal(compact.record_id, fixture.requestedId);
      assert.equal("record" in compact, false);
      assert.equal(compact.valid, false);
      assert.equal(compact.classification, "invalid_record");
      assert.equal(compact.diagnostics[0].code, "record_identity_mismatch");
      assert.equal(compact.canonical_record_path, requestedPath);
      assert.equal(compact.source_classification, "canonical");
      assert.equal(compact.source_digest, "sha256:mismatched-kind-source");
      assert.equal(compact.compact_read.selected_resources.id, fixture.requestedId);
      const token = JSON.parse(Buffer.from(
        compact.compact_read.compact_read_token,
        "base64url"
      ).toString("utf8"));
      assert.equal(token.record_id, fixture.requestedId);
      assert.equal(token.tool_family, toolFamily);
      assert.deepEqual(compact.compact_read.next_calls[0].arguments,
        { ...primary, include_record: true, accept_full_read: true });
      assert.equal(JSON.stringify(compact.compact_read.selected_resources).includes(fixture.embeddedId), false);
      assert.equal(JSON.stringify(compact.compact_read.next_calls).includes(fixture.embeddedId), false);
      const recovered = await run({ ...primary, include_record: true, accept_full_read: true });
      assert.equal(recovered.id, fixture.requestedId);
      assert.equal(recovered.record_id, fixture.requestedId);
      assert.equal(recovered.record.id, fixture.embeddedId);
    }
  }
});
test("disclosure oracle kills the six existing and every section-member falsifier", async (t) => {
  const record = decisionRecord();
  const harness = gateHarness({ record, toolFamily: "workspace_get_record" });
  const compact = await harness.run(harness.primary);
  const recovered = await harness.run({ ...harness.primary, include_record: true, accept_full_read: true });
  const baseline = compact.compact_read.member_ledger;
  const clone = () => structuredClone(baseline);
  const mutants = new Map();
  const silent = clone();
  silent.omitted_members.pop();
  mutants.set("silent omission", silent);
  const incompleteTotal = clone();
  incompleteTotal.source_member_count -= 1;
  mutants.set("incomplete totals", incompleteTotal);
  const incompleteOmissionTotal = clone();
  incompleteOmissionTotal.omitted_member_count -= 1;
  mutants.set("incomplete omission totals", incompleteOmissionTotal);
  const unaccounted = clone();
  unaccounted.omitted_members = unaccounted.omitted_members.slice(1);
  unaccounted.omitted_member_count = unaccounted.omitted_members.length;
  unaccounted.accounted_member_count -= 1;
  mutants.set("unaccounted source members", unaccounted);
  const zeroOmission = clone();
  zeroOmission.compact_members = [...zeroOmission.source_members];
  zeroOmission.compact_member_count = zeroOmission.source_member_count;
  zeroOmission.omitted_members = [];
  zeroOmission.omitted_member_count = 0;
  zeroOmission.disclosed_members = [...zeroOmission.source_members];
  zeroOmission.disclosed_member_count = zeroOmission.source_member_count;
  mutants.set("zero heavy-member omission", zeroOmission);
  for (const [label, ledger] of mutants) {
    await t.test(label, () => {
      assert.notDeepEqual(
        disclosureViolations({ source: record, compact, ledger, recovered: recovered.record }),
        [],
        label
      );
    });
  }
  const unrecoverable = structuredClone(recovered.record);
  delete unrecoverable.sections;
  await t.test("unrecoverable loss", () => {
    assert.notDeepEqual(
      disclosureViolations({ source: record, compact, ledger: baseline, recovered: unrecoverable }),
      [],
      "unrecoverable loss"
    );
  });

  const sectionMember = baseline.source_members.find((member) => member.startsWith("sections."));
  assert.ok(sectionMember, "fixture must contain a section member");
  const without = (members, member) => members.filter((candidate) => candidate !== member);
  const withMember = (members, member) => [...members, member].sort();
  const sectionMutants = new Map();

  const missingSection = clone();
  missingSection.source_members = without(missingSection.source_members, sectionMember);
  missingSection.omitted_members = without(missingSection.omitted_members, sectionMember);
  missingSection.accounted_members = without(missingSection.accounted_members, sectionMember);
  missingSection.recovered_members = without(missingSection.recovered_members, sectionMember);
  missingSection.source_member_count -= 1;
  missingSection.omitted_member_count -= 1;
  missingSection.accounted_member_count -= 1;
  missingSection.recovered_member_count -= 1;
  sectionMutants.set("missing section member", missingSection);

  const extraSection = clone();
  const extraSectionMember = "sections.unregistered_extra";
  extraSection.source_members = withMember(extraSection.source_members, extraSectionMember);
  extraSection.omitted_members = withMember(extraSection.omitted_members, extraSectionMember);
  extraSection.accounted_members = withMember(extraSection.accounted_members, extraSectionMember);
  extraSection.recovered_members = withMember(extraSection.recovered_members, extraSectionMember);
  extraSection.source_member_count += 1;
  extraSection.omitted_member_count += 1;
  extraSection.accounted_member_count += 1;
  extraSection.recovered_member_count += 1;
  sectionMutants.set("extra section member", extraSection);

  const misclassifiedSection = clone();
  misclassifiedSection.omitted_members = without(misclassifiedSection.omitted_members, sectionMember);
  misclassifiedSection.compact_members = withMember(misclassifiedSection.compact_members, sectionMember);
  misclassifiedSection.disclosed_members = withMember(misclassifiedSection.disclosed_members, sectionMember);
  misclassifiedSection.omitted_member_count -= 1;
  misclassifiedSection.compact_member_count += 1;
  misclassifiedSection.disclosed_member_count += 1;
  sectionMutants.set("misclassified section member", misclassifiedSection);

  const miscountedSection = clone();
  miscountedSection.recovered_member_count -= 1;
  sectionMutants.set("miscounted section member", miscountedSection);

  for (const [label, ledger] of sectionMutants) {
    await t.test(label, () => {
      assert.notDeepEqual(
        disclosureViolations({ source: record, compact, ledger, recovered: recovered.record }),
        [],
        label
      );
    });
  }

  const unrecoverableSection = structuredClone(recovered.record);
  delete unrecoverableSection.sections[sectionMember.slice("sections.".length)];
  await t.test("unrecoverable section member", () => {
    assert.notDeepEqual(
      disclosureViolations({
        source: record,
        compact,
        ledger: baseline,
        recovered: unrecoverableSection
      }),
      [],
      "unrecoverable section member"
    );
  });
});
