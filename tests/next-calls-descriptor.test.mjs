

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNextCall,
  renderNextCall,
  validateNextCalls,
  pickDoThisNext,
  projectNextActionScalar
} from "../packages/wiki-core/src/lib/next-calls-descriptor.mjs";

test("buildNextCall normalizes tool, arguments, and flags", () => {
  const entry = buildNextCall({
    tool: "workspace_work_record_load",
    arguments: { id: "WK-1510" },
    recommended: true
  });
  assert.equal(entry.tool, "workspace_work_record_load");
  assert.deepEqual(entry.arguments, { id: "WK-1510" });
  assert.equal(entry.recommended, true);
  assert.equal(entry.disallowed, undefined);
});

test("buildNextCall clones arguments so the spec cannot be mutated through the entry", () => {
  const args = { id: "WK-1510" };
  const entry = buildNextCall({ tool: "workspace_work_record_load", arguments: args });
  entry.arguments.id = "WK-9999";
  assert.equal(args.id, "WK-1510");
});

test("buildNextCall preserves negative-set payload on a disallowed entry", () => {
  const entry = buildNextCall({
    tool: "workspace_agent_dispatch",
    disallowed: true,
    reason: "not ready",
    use_instead: "workspace_work_record_validate"
  });
  assert.equal(entry.disallowed, true);
  assert.equal(entry.reason, "not ready");
  assert.equal(entry.use_instead, "workspace_work_record_validate");
});

test("buildNextCall omits flags that are not set true (name-only allowed entry)", () => {
  const entry = buildNextCall({ tool: "workspace_wiki_search" });
  assert.deepEqual(entry, { tool: "workspace_wiki_search" });
});

test("buildNextCall rejects a non-object spec", () => {
  assert.throws(() => buildNextCall(null), TypeError);
  assert.throws(() => buildNextCall([]), TypeError);
});

test("buildNextCall rejects a missing or empty tool", () => {
  assert.throws(() => buildNextCall({}), TypeError);
  assert.throws(() => buildNextCall({ tool: "" }), TypeError);
  assert.throws(() => buildNextCall({ tool: "   " }), TypeError);
});

test("buildNextCall rejects non-boolean flags", () => {
  assert.throws(() => buildNextCall({ tool: "t", recommended: "yes" }), TypeError);
  assert.throws(() => buildNextCall({ tool: "t", disallowed: 1 }), TypeError);
});

test("buildNextCall rejects an entry that is both recommended and disallowed", () => {
  assert.throws(
    () => buildNextCall({ tool: "t", recommended: true, disallowed: true }),
    TypeError
  );
});

test("buildNextCall rejects non-object arguments", () => {
  assert.throws(() => buildNextCall({ tool: "t", arguments: "id=1" }), TypeError);
  assert.throws(() => buildNextCall({ tool: "t", arguments: ["id"] }), TypeError);
});

test("renderNextCall renders an argument-bearing call string and a bare name", () => {
  assert.equal(
    renderNextCall({ tool: "workspace_work_record_load", arguments: { id: "WK-1510" } }),
    'workspace_work_record_load({id:"WK-1510"})'
  );
  assert.equal(renderNextCall({ tool: "workspace_wiki_search" }), "workspace_wiki_search");
  assert.equal(renderNextCall({ tool: "t", arguments: {} }), "t");
});

test("validateNextCalls accepts a well-formed list", () => {
  const list = [
    buildNextCall({ tool: "a", recommended: true }),
    buildNextCall({ tool: "b" }),
    buildNextCall({ tool: "c", disallowed: true })
  ];
  const result = validateNextCalls(list);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateNextCalls rejects a non-array list", () => {
  const result = validateNextCalls(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validateNextCalls rejects a recommended entry that is not an allowed subset member", () => {

  const list = [{ tool: "a", recommended: true, disallowed: true }];
  const result = validateNextCalls(list);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /recommended/.test(e) && /disallowed/.test(e)));
});

test("validateNextCalls rejects invalid flag types", () => {
  const result = validateNextCalls([
    { tool: "a", recommended: "true" },
    { tool: "b", disallowed: 0 }
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /recommended must be a boolean/.test(e)));
  assert.ok(result.errors.some((e) => /disallowed must be a boolean/.test(e)));
});

test("validateNextCalls rejects a malformed entry and a missing tool", () => {
  const result = validateNextCalls([null, { tool: "" }, "nope"]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
});

test("validateNextCalls rejects non-object arguments", () => {
  const result = validateNextCalls([{ tool: "a", arguments: ["x"] }]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /arguments must be a plain object/.test(e)));
});

test("validateNextCalls rejects an unregistered tool when knownTools is supplied", () => {
  const known = ["a", "b"];
  const ok = validateNextCalls([{ tool: "a" }, { tool: "b" }], { knownTools: known });
  assert.equal(ok.valid, true);

  const bad = validateNextCalls([{ tool: "a" }, { tool: "zzz" }], { knownTools: known });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /unregistered tool "zzz"/.test(e)));
});

test("validateNextCalls accepts knownTools as a Set or predicate", () => {
  const set = validateNextCalls([{ tool: "a" }], { knownTools: new Set(["a"]) });
  assert.equal(set.valid, true);
  const pred = validateNextCalls([{ tool: "a" }], { knownTools: (t) => t === "a" });
  assert.equal(pred.valid, true);
});

test("validateNextCalls does not check tool registration when knownTools is omitted", () => {
  const result = validateNextCalls([{ tool: "some-unregistered-tool" }]);
  assert.equal(result.valid, true);
});

test("pickDoThisNext returns the FIRST recommended entry by array order", () => {
  const first = buildNextCall({ tool: "a", recommended: true });
  const second = buildNextCall({ tool: "b", recommended: true });
  const list = [buildNextCall({ tool: "z" }), first, second];
  assert.equal(pickDoThisNext(list), first);
});

test("pickDoThisNext returns null when nothing is recommended", () => {
  assert.equal(pickDoThisNext([buildNextCall({ tool: "a" }), buildNextCall({ tool: "b" })]), null);
  assert.equal(pickDoThisNext([]), null);
  assert.equal(pickDoThisNext(null), null);
});

function sampleList() {
  return [
    buildNextCall({ tool: "load", arguments: { id: "WK-1510" }, recommended: true }),
    buildNextCall({ tool: "validate", arguments: { id: "WK-1510" }, recommended: true }),
    buildNextCall({ tool: "search" }),
    buildNextCall({
      tool: "dispatch",
      disallowed: true,
      reason: "not ready",
      use_instead: "validate"
    })
  ];
}

test("projectNextActionScalar is the do-this-next remedy string", () => {
  assert.equal(projectNextActionScalar(sampleList()), 'load({id:"WK-1510"})');
  assert.equal(projectNextActionScalar([buildNextCall({ tool: "a" })]), null);
});

test("projectNextActionScalar does not mutate the canonical list or its entries", () => {
  const list = sampleList();
  const snapshot = JSON.parse(JSON.stringify(list));

  projectNextActionScalar(list);

  assert.deepEqual(list, snapshot);
});

test("projectNextActionScalar tolerates a non-array input", () => {
  assert.equal(projectNextActionScalar(null), null);
});
