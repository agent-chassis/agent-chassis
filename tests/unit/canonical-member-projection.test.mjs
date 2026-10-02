import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSelectedRecordMemberCall,
  projectSelectedRecordMember,
  projectSelectedRecordMembers,
  selectedRecordMemberSelectorIssues,
  selectedRecordMembersSelectorIssues
} from "../../packages/wiki-core/src/lib/work-record-selected-unit-projection.mjs";
import { unresolvedArgumentNames } from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";

const DIGEST = "a".repeat(16);
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

const buildCall = (selection) => buildSelectedRecordMemberCall({
  tool: "workspace_read_page",
  repository: "current",
  identity: { path: "wiki/work-records/WK-0001.json" },
  selection
});

function project(value, member, { sourceDigest = DIGEST } = {}) {
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
  for (const row of member.members) assert.equal(Object.hasOwn(row, "next_call"), false, "rows repeat no envelope");

  assert.deepEqual(member.child_calls.map((call) => call.arguments), [{ repo: "current",
    path: "wiki/work-records/WK-0001.json", members: Object.keys(record).map((key) => ({ path: [key] })),
    expected_source_digest: DIGEST }]);
  const serialized = JSON.stringify(projected.result);
  assert.equal(serialized.includes("nested body"), false, "descendant values are not embedded");
  assert.equal(serialized.includes("deeper body"), false);
  assert.equal(serialized.includes("content_reference"), false, "no whole-value reference stands in for selection");

  const array = project(record, { path: ["a"] }).result.member;
  assert.deepEqual(array.members.map((row) => [row.index, row.kind]), [[0, "string"], [1, "object"]]);
  assert.deepEqual(array.child_calls[0].arguments.members, [{ path: ["a", 0] }, { path: ["a", 1] }]);
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

  for (const page of pages) {
    assert.ok(page.member.child_calls.every((call) => call.arguments.members.length <= 16));
    assert.deepEqual(page.member.child_calls.flatMap((call) => call.arguments.members.map(({ path }) => path[0])),
      page.member.members.map((row) => row.key));
  }

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

const ENVELOPE = { ok: true, record_id: "WK-0001", source_digest: DIGEST };
const batch = (value, members, sourceDigest = DIGEST) =>
  projectSelectedRecordMembers({ value, members, sourceDigest, envelope: ENVELOPE, buildCall });

function walkBatch(value, members) {
  const pages = [];
  const delivered = new Map();
  let selections = members;
  while (selections) {
    const projected = batch(value, selections);
    assert.equal(projected.ok, true, JSON.stringify(projected));
    const page = projected.result;
    pages.push(page);
    for (const fragment of page.members) {
      const key = JSON.stringify(fragment.path);
      const prior = delivered.get(key);
      if (fragment.kind === "string") delivered.set(key, (prior ?? "") + fragment.value);
      else if (fragment.kind === "object" || fragment.kind === "array") {
        delivered.set(key, [...(prior ?? []), ...fragment.members.map((row) => row.key ?? row.index)]);
      } else delivered.set(key, fragment.value);
    }
    assert.ok(page.next_calls.length <= 1, "a batch without diagnostics has at most its one continuation");
    assert.equal(page.next_calls.length, page.selections.remaining > 0 ? 1 : 0,
      "unfinished selections always carry exactly one continuation");
    selections = page.next_calls[0]?.arguments.members ?? null;
    if (selections) assert.equal(page.next_calls[0].arguments.expected_source_digest, DIGEST);
  }
  return { pages, delivered };
}

test("a batch answers ordered selections from one value under one envelope and one budget", () => {
  const criteria = ["first λ criterion", "second \u{1f680} criterion", "third \"quoted\" criterion", "fourth é"];
  const record = { acceptance: { criteria, validation: ["node --test a"] }, sections: { notes: "n".repeat(50) },
    slices: [{ id: "SLICE-001", sections: { tasks: [{ text: "task text", status: "todo" }] } }] };
  const projected = batch(record, criteria.map((_, index) => ({ path: ["acceptance", "criteria", index] })));
  assert.equal(projected.ok, true);
  const page = projected.result;
  assert.deepEqual(page.members.map((fragment) => [fragment.selection, fragment.path, fragment.value]),
    criteria.map((text, index) => [index, ["acceptance", "criteria", index], text]));
  assert.deepEqual(page.selections, { requested: 4, completed: 4, failed: 0, remaining: 0 });
  assert.deepEqual(page.next_calls, []);
  assert.equal(page.source_digest, DIGEST);
  for (const fragment of page.members) {
    for (const repeated of ["repo", "source_digest", "record_id", "tool", "next_calls"]) {
      assert.equal(Object.hasOwn(fragment, repeated), false, `a fragment repeats no ${repeated}`);
    }
  }
  const serialized = JSON.stringify(page);
  for (const unrequested of ["node --test a", "nnnn", "task text"]) {
    assert.equal(serialized.includes(unrequested), false, `no unrequested ${unrequested}`);
  }

  const container = batch(record, [{ path: ["slices", 0] }, { path: ["slices", 0, "sections", "tasks", 0, "text"] }]).result;
  assert.deepEqual(container.members[0].members.map((row) => row.key), ["id", "sections"]);
  assert.equal(JSON.stringify(container.members[0]).includes("task text"), false);
  assert.equal(container.members[1].value, "task text");
});

test("sixteen explicit maximum selections stay within the one hard bound and continue losslessly", () => {
  const long = `λ\u{1f680}́"\\${"東".repeat(9000)}`;
  const record = { a: { b: { c: [long, `${long}!`] } }, t: long, list: Array.from({ length: 80 }, (_, index) => index) };
  const members = [
    ...Array.from({ length: 12 }, (_, index) => ({ path: index % 3 === 0 ? ["t"] : ["a", "b", "c", index % 3 - 1],
      length: 8192 })),
    { path: ["list"], limit: 50 }, { path: ["a", "b"] }, { path: ["list", 79] }, { path: ["t"], offset: 3, length: 4000 }
  ];
  assert.equal(members.length, 16);
  const pages = [];
  let selections = members;
  const perSelection = new Map(members.map((_, index) => [index, []]));

  let origin = members.map((_, index) => index);
  while (selections) {
    const projected = batch(record, selections);
    assert.equal(projected.ok, true, JSON.stringify(projected));
    const page = projected.result;
    pages.push(page);
    assert.ok(bytes(page) <= 8192, `a batch page is ${bytes(page)} bytes`);
    const indexes = page.members.map((fragment) => fragment.selection);
    assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right), "fragments keep request order");
    const { requested, completed, failed, remaining } = page.selections;
    assert.deepEqual([requested, failed, completed + remaining <= requested], [selections.length, 0, true]);
    for (const fragment of page.members) perSelection.get(origin[fragment.selection]).push(fragment);
    const next = page.next_calls[0]?.arguments.members ?? null;
    if (next) {

      const finished = new Set(page.members.filter((fragment) => {
        const end = fragment.kind === "string" ? fragment.offset + fragment.length
          : fragment.kind === "array" || fragment.kind === "object" ? fragment.offset + fragment.returned_count : null;
        const total = fragment.kind === "string" ? fragment.total : fragment.total_count;
        return end === null || end >= total;
      }).map((fragment) => fragment.selection));
      origin = origin.filter((_, index) => !finished.has(index));
      assert.equal(next.length, origin.length);
    }
    selections = next;
  }
  assert.ok(pages.length > 1, "maximum explicit lengths spill into exact continuations");
  const text = (index) => perSelection.get(index).map((fragment) => fragment.value).join("");
  for (const [index, member] of members.entries()) {
    if (member.path[0] === "t" && member.offset === undefined) assert.equal(text(index), long);
    if (member.path[0] === "a" && member.path.length === 4) assert.equal(text(index), record.a.b.c[member.path[3]]);
  }

  assert.equal(text(15), Array.from(long).slice(3).join(""));
  assert.deepEqual(perSelection.get(12).flatMap((fragment) => fragment.members.map((row) => row.index)),
    Array.from({ length: 80 }, (_, index) => index));
  assert.deepEqual(perSelection.get(13).flatMap((fragment) => fragment.members.map((row) => row.key)), ["c"]);
  assert.deepEqual(perSelection.get(14).map((fragment) => fragment.value), [79]);
});

test("each string selection reassembles exactly once through emitted batch continuations", () => {
  const texts = { x: `x${"é".repeat(3000)}`, y: `y${"\u{1f680}".repeat(700)}`, z: "short" };
  const { delivered, pages } = walkBatch(texts, [{ path: ["x"] }, { path: ["y"], length: 100 }, { path: ["z"] }]);
  for (const [key, value] of Object.entries(texts)) assert.equal(delivered.get(JSON.stringify([key])), value);
  for (const page of pages) assert.ok(bytes(page) <= 8192);
});

test("bad paths and ranges are ordered selection diagnostics that keep the valid selections", () => {
  const record = { list: ["zero"], map: { a: "alpha" } };
  const projected = batch(record, [{ path: ["map", "a"] }, { path: ["map", "missing"] }, { path: ["list"], offset: 9 },
    { path: ["list", 0] }]);
  assert.equal(projected.ok, true);
  const page = projected.result;
  assert.deepEqual(page.members.map((fragment) => [fragment.selection, fragment.value]), [[0, "alpha"], [3, "zero"]]);
  assert.deepEqual(page.diagnostics.map((diagnostic) => [diagnostic.selection, diagnostic.code, diagnostic.path]), [
    [1, "record_member_path_missing", "members[1].path[1]"],
    [2, "record_member_range_invalid", "members[2].offset"]]);
  assert.deepEqual(page.selections, { requested: 4, completed: 2, failed: 2, remaining: 0 });

  assert.deepEqual(page.next_calls.map((call) => call.arguments.members), [[{ path: ["map"] }, { path: ["list"] }]]);
  assert.equal(page.next_calls[0].arguments.expected_source_digest, DIGEST);

  const none = batch(record, [{ path: ["absent"] }]);
  assert.equal(none.ok, false);
  assert.deepEqual(none.diagnostics.map((diagnostic) => diagnostic.code), ["record_member_path_missing"]);
  assert.deepEqual(none.next_calls[0].arguments.members, [{ path: [] }]);
});

test("a batch whose smallest progress exceeds the hard bound refuses with a narrowed call", () => {
  const key = "k".repeat(1200);
  const record = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`${key}${index}`, index]));
  const members = Object.keys(record).map((name) => ({ path: [name] }));
  const refused = batch(record, members);
  assert.equal(refused.ok, false);
  assert.equal(refused.diagnostics[0].code, "record_member_batch_too_large");
  assert.equal(refused.diagnostics[0].authority_limb, "mechanical");
  assert.deepEqual(refused.next_calls.map((call) => call.arguments.members), [[members[0]]]);
  const narrowed = batch(record, refused.next_calls[0].arguments.members);
  assert.equal(narrowed.ok, true);
  assert.ok(bytes(narrowed.result) <= 8192);
});

test("members selector validation bounds the batch and keeps the pin at call level", () => {
  assert.deepEqual(selectedRecordMembersSelectorIssues([{ path: [] }]), []);
  assert.deepEqual(selectedRecordMembersSelectorIssues(Array.from({ length: 16 }, () => ({ path: ["a"], length: 1 }))), []);
  for (const members of [[], Array.from({ length: 17 }, () => ({ path: [] })), [{ path: [], expected_source_digest: DIGEST }],
    [{ path: "a" }], null, [{}]]) {
    assert.ok(selectedRecordMembersSelectorIssues(members).length > 0, JSON.stringify(members));
  }
  assert.ok(selectedRecordMemberSelectorIssues({ path: [], expected_source_digest: `sha256:${"a".repeat(64)}` }).length > 0,
    "the single member pin accepts only the 16-hex wire value");
});
