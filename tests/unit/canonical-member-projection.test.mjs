import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSelectedRecordMemberCall,
  projectSelectedRecordMember,
  selectedRecordMemberSelectorIssues
} from "../../packages/wiki-core/src/lib/work-record-selected-unit-projection.mjs";
import { unresolvedArgumentNames } from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

function project(value, member, { sourceDigest = DIGEST } = {}) {
  const buildCall = (selector) => buildSelectedRecordMemberCall({
    tool: "workspace_read_page",
    repository: "current",
    identity: { path: "wiki/work-records/WK-0001.json" },
    member: selector
  });
  return projectSelectedRecordMember({
    value,
    member,
    sourceDigest,
    envelope: { ok: true, record_id: "WK-0001", source_digest: sourceDigest },
    buildCall
  });
}

function walk(value, first) {
  const pages = [];
  let member = first;
  while (member) {
    const projected = project(value, member);
    assert.equal(projected.ok, true, JSON.stringify(projected));
    pages.push(projected.result);
    const next = projected.result.next_calls[0];
    assert.ok(projected.result.next_calls.length <= 1);
    member = next?.arguments.member ?? null;
  }
  return pages;
}

test("a container page carries immediate descriptors only, in canonical key order, with pinned calls", () => {
  const record = { b: { secret: "nested body" }, a: ["x", { deep: "deeper body" }], 2: "two", c: null };
  const projected = project(record, { path: [] });
  assert.equal(projected.ok, true);
  const { member, next_calls: nextCalls } = projected.result;
  assert.deepEqual(member.members.map((row) => row.key), Object.keys(record));
  assert.deepEqual(member.members.map((row) => [row.kind, row.length ?? row.count ?? null]),
    [["string", 3], ["object", 1], ["array", 2], ["null", null]]);
  assert.equal(member.total_count, 4);
  assert.equal(member.returned_count, 4);
  assert.deepEqual(nextCalls, []);
  for (const row of member.members) {
    assert.deepEqual(row.next_call.arguments.member, { path: [row.key], expected_source_digest: DIGEST });
  }
  const serialized = JSON.stringify(projected.result);
  assert.equal(serialized.includes("nested body"), false, "descendant values are not embedded");
  assert.equal(serialized.includes("deeper body"), false);
  assert.equal(serialized.includes("content_reference"), false, "no whole-value reference stands in for selection");

  const array = project(record, { path: ["a"] }).result.member;
  assert.deepEqual(array.members.map((row) => [row.index, row.kind]), [[0, "string"], [1, "object"]]);
  assert.deepEqual(array.members[1].next_call.arguments.member.path, ["a", 1]);
});

test("container pages are bounded and their continuations recover every immediate member exactly once", () => {
  const record = Object.fromEntries(Array.from({ length: 173 }, (_, index) =>
    [`member-${String(index).padStart(3, "0")}-${"\u{1f680}".repeat(index % 7)}`, { index }]));
  const pages = walk(record, { path: [] });
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.ok(bytes(page) <= 2048 || page.member.returned_count === 1, `default page is ${bytes(page)} bytes`);
    assert.ok(page.member.returned_count <= 25);
    assert.equal(page.member.total_count, 173);
  }
  assert.deepEqual(pages.flatMap((page) => page.member.members.map((row) => row.key)), Object.keys(record));

  const explicit = walk(record, { path: [], limit: 50 });
  for (const page of explicit) {
    assert.ok(bytes(page) <= 8192, `explicit page is ${bytes(page)} bytes`);
    assert.ok(page.member.returned_count <= 50);
    for (const call of page.next_calls) assert.equal(call.arguments.member.limit, 50);
  }
  assert.deepEqual(explicit.flatMap((page) => page.member.members.map((row) => row.key)), Object.keys(record));
  assert.ok(explicit.length < pages.length, "an explicit limit uses the larger compact bound");
});

test("string members page exact Unicode scalars, preserving astral, combining and escaped text", () => {
  const text = `a\u{1f680}é東京"\\\n\t\u0000${"λ".repeat(9000)}`;
  const record = { sections: { summary: text } };
  for (const first of [{ path: ["sections", "summary"], length: 7 }, { path: ["sections", "summary"] },
    { path: ["sections", "summary"], length: 8192 }]) {
    const pages = walk(record, first);
    assert.equal(pages.map((page) => page.member.value).join(""), text, JSON.stringify(first));
    let offset = 0;
    for (const page of pages) {
      assert.equal(page.member.offset, offset);
      assert.equal(page.member.total, Array.from(text).length);
      assert.ok(page.member.length > 0);
      assert.ok(bytes(page) <= (first.length === undefined ? 2048 : 8192), `page is ${bytes(page)} bytes`);
      offset += page.member.length;
      for (const call of page.next_calls) {
        assert.equal(call.arguments.member.expected_source_digest, DIGEST);
        assert.equal(call.arguments.member.offset, offset);
        assert.equal(call.arguments.member.length, first.length);
      }
    }
  }
  const end = project(record, { path: ["sections", "summary"], offset: Array.from(text).length }).result;
  assert.deepEqual([end.member.value, end.member.length, end.next_calls], ["", 0, []]);
});

test("primitive members are returned whole and refuse paging selectors", () => {
  const record = { count: 3, flag: false, empty: null, list: [] };
  for (const [key, expected] of [["count", 3], ["flag", false], ["empty", null]]) {
    const projected = project(record, { path: [key] });
    assert.equal(projected.ok, true);
    assert.deepEqual(projected.result.member, { path: [key], kind: key === "empty" ? "null" : typeof expected, value: expected });
    assert.deepEqual(projected.result.next_calls, []);
  }
  for (const [member, code] of [
    [{ path: ["count"], offset: 0 }, "record_member_selector_invalid"],
    [{ path: ["list"], length: 1 }, "record_member_selector_invalid"],
    [{ path: ["count"], limit: 1 }, "record_member_selector_invalid"],
    [{ path: ["list"], offset: 1 }, "record_member_range_invalid"]
  ]) {
    assert.equal(project(record, member).diagnostic.code, code, JSON.stringify(member));
  }
  assert.equal(project({ text: "abc" }, { path: ["text"], limit: 1 }).diagnostic.code, "record_member_selector_invalid");
  assert.equal(project({ text: "abc" }, { path: ["text"], offset: 4 }).diagnostic.code, "record_member_range_invalid");
});

test("path traversal follows exact own members only and names the containing member for recovery", () => {
  // eslint-disable-next-line no-proto
  const record = JSON.parse('{"__proto__":{"own":true},"list":["zero"],"map":{"a.b":1},"":{"empty":1}}');
  assert.equal(project(record, { path: ["__proto__", "own"] }).result.member.value, true);
  assert.equal(project(record, { path: ["map", "a.b"] }).result.member.value, 1, "no dotted-path parsing");
  assert.equal(project(record, { path: ["", "empty"] }).result.member.value, 1);
  for (const [path, code, recovery] of [
    [["toString"], "record_member_path_missing", []],
    [["map", "a"], "record_member_path_missing", ["map"]],
    [["list", 1], "record_member_path_missing", ["list"]],
    [["list", "length"], "record_member_path_type_mismatch", ["list"]],
    [["map", 0], "record_member_path_type_mismatch", ["map"]],
    [["list", 0, "x"], "record_member_path_type_mismatch", ["list", 0]]
  ]) {
    const refused = project(record, { path });
    assert.equal(refused.ok, false);
    assert.equal(refused.diagnostic.code, code, JSON.stringify(path));
    assert.deepEqual(refused.diagnostic.recovery_member_path, recovery, JSON.stringify(path));
    assert.equal(refused.diagnostic.authority_limb, "mechanical");
  }
});

test("member selector validation refuses every malformed shape", () => {
  assert.deepEqual(selectedRecordMemberSelectorIssues({ path: [] }), []);
  assert.deepEqual(selectedRecordMemberSelectorIssues({ path: ["sections", 0], offset: 0, limit: 50,
    length: 8192, expected_source_digest: DIGEST }), []);
  for (const member of [
    null, [], "path", {}, { path: "sections" }, { path: [-1] }, { path: [1.5] }, { path: [true] },
    { path: Array.from({ length: 65 }, () => "a") }, { path: [], offset: -1 }, { path: [], limit: 0 },
    { path: [], limit: 51 }, { path: [], length: 8193 }, { path: [], expected_source_digest: "sha256:bad" },
    { path: [], surprise: true }
  ]) {
    assert.ok(selectedRecordMemberSelectorIssues(member).length > 0, JSON.stringify(member));
  }
});

test("member calls publish authored keys that resemble placeholders without widening the placeholder rule", () => {
  for (const key of ["$schema", "", "TODO", "<angle>"]) {
    const call = buildSelectedRecordMemberCall({ tool: "workspace_get_record", identity: { id: "DEC-0001" },
      member: { path: ["sections", key] } });
    assert.deepEqual(call.arguments.member.path, ["sections", key]);
  }
  assert.deepEqual(unresolvedArgumentNames({ member: { path: ["$schema"], offset: 0 } }), []);
  assert.deepEqual(unresolvedArgumentNames({ member: { path: ["a"], expected_source_digest: "" } }), ["member"]);
  assert.deepEqual(unresolvedArgumentNames({ member: { path: ["a"], unexpected: "$x" } }), ["member"]);
  assert.deepEqual(unresolvedArgumentNames({ other: { path: ["$schema"] } }), ["other"]);
});
