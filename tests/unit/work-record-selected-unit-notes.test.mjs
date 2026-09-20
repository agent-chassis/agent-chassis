import test from "node:test";
import assert from "node:assert/strict";

import { projectSelectedWorkRecordUnit } from "../../packages/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

const BASE = Object.freeze({
  id: "SLICE-007",
  title: "Selected notes",
  status: "active",
  priority: "high",
  owner: "unassigned",
  work_kind: "implementation"
});

test("selected notes emit identical bodies once", () => {
  const longNote = `  λ🙂 ${"body ".repeat(3000)}\n`;
  for (const notes of ["", "same", " same ", "e\u0301", "é", longNote, [], [""], ["λ", "🙂", " tail "]]) {
    const projected = projectSelectedWorkRecordUnit({
      ...BASE,
      agent_notes: notes,
      sections: { agent_notes: Array.isArray(notes) ? [...notes] : notes }
    });

    assert.notEqual(projected, null);
    assert.deepEqual(projected.agent_notes, notes);
    assert.deepEqual(projected.sections, {});
    assert.equal(Object.hasOwn(projected, "agent_notes_bytes"), false);
  }

  for (const notes of ["sections only", ["one", "two"], "", []]) {
    const projected = projectSelectedWorkRecordUnit({
      ...BASE,
      sections: { agent_notes: notes }
    });
    assert.deepEqual(projected.agent_notes, notes);
    assert.deepEqual(projected.sections, {});
  }
});

test("selected notes preserve distinct and single-source values", () => {
  const cases = [
    { direct: "same", nested: "same " },
    { direct: "é", nested: "e\u0301" },
    { direct: ["one", "two"], nested: ["two", "one"] },
    { direct: ["one"], nested: ["one", "two"] },
    { direct: "", nested: [] },
    { direct: [], nested: "" },
    { direct: "one", nested: ["one"] }
  ];

  for (const { direct, nested } of cases) {
    const projected = projectSelectedWorkRecordUnit({
      ...BASE,
      agent_notes: direct,
      sections: { agent_notes: nested }
    });
    assert.deepEqual(projected.agent_notes, direct);
    assert.deepEqual(projected.sections, { agent_notes: nested });
  }

  const directOnly = projectSelectedWorkRecordUnit({ ...BASE, agent_notes: ["direct", "only"] });
  assert.deepEqual(directOnly.agent_notes, ["direct", "only"]);
  assert.equal(Object.hasOwn(directOnly, "sections"), false);

  const absent = projectSelectedWorkRecordUnit({ ...BASE, sections: {} });
  assert.equal(Object.hasOwn(absent, "agent_notes"), false);
  assert.deepEqual(absent.sections, {});

  const noNotesOrSections = projectSelectedWorkRecordUnit(BASE);
  assert.equal(Object.hasOwn(noNotesOrSections, "agent_notes"), false);
  assert.equal(Object.hasOwn(noNotesOrSections, "sections"), false);
});

test("selected notes preserve projection invariants", () => {
  const source = {
    ...BASE,
    read_scope: ["AGENTS.md", "docs/example.md"],
    repo_paths: ["packages/example.mjs"],
    write_scope: ["packages/example.mjs"],
    depends_on: ["WK-0001#SLICE-001"],
    acceptance: { criteria: ["Keep notes lossless"], validation: ["git diff --check"] },
    expected_changed_line_budget: 0,
    dispatch_intent: { intended_agent_role: "worker", target_unit: "slice" },
    agent_notes: [" exact ", "🙂"],
    sections: { agent_notes: [" exact ", "🙂"], closure: { hidden: true } }
  };
  const sourceSnapshot = structuredClone(source);

  const first = projectSelectedWorkRecordUnit(source);
  const second = projectSelectedWorkRecordUnit(first);

  assert.deepEqual(source, sourceSnapshot);
  assert.deepEqual(second, first);
  assert.notEqual(first, source);
  assert.notEqual(first.agent_notes, source.agent_notes);
  assert.deepEqual(first.sections, {});
  assert.deepEqual(first.agent_notes, [" exact ", "🙂"]);
  assert.deepEqual(first.read_scope, source.read_scope);
  assert.deepEqual(first.repo_paths, source.repo_paths);
  assert.deepEqual(first.write_scope, source.write_scope);
  assert.deepEqual(first.depends_on, source.depends_on);
  assert.deepEqual(first.acceptance, source.acceptance);
  assert.deepEqual(first.dispatch_intent, source.dispatch_intent);
  assert.equal(first.expected_changed_line_budget, 0);
  assert.equal(Object.hasOwn(first, "agent_notes_bytes"), false);

  first.agent_notes[0] = "mutated";
  assert.deepEqual(source.agent_notes, [" exact ", "🙂"]);
  assert.deepEqual(second.agent_notes, [" exact ", "🙂"]);
});

test("selected notes preserve data-only refusals", () => {
  for (const value of [
    null,
    [],
    { ...BASE, agent_notes: {} },
    { ...BASE, agent_notes: ["valid", 1] },
    { ...BASE, sections: { agent_notes: {} } },
    { ...BASE, sections: { agent_notes: ["valid", null] } },
    { ...BASE, sections: { structured_validation: [] } }
  ]) {
    assert.equal(projectSelectedWorkRecordUnit(value), null);
  }

  let getterCalls = 0;
  const accessor = { ...BASE, sections: {} };
  Object.defineProperty(accessor.sections, "agent_notes", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must not execute";
    }
  });
  assert.equal(projectSelectedWorkRecordUnit(accessor), null);
  assert.equal(getterCalls, 0);

  const directAccessor = { ...BASE };
  Object.defineProperty(directAccessor, "agent_notes", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must not execute";
    }
  });
  assert.equal(projectSelectedWorkRecordUnit(directAccessor), null);
  assert.equal(getterCalls, 0);

  let trapCalls = 0;
  const hostileNotes = new Proxy(["must not inspect"], {
    get() {
      trapCalls += 1;
      throw new Error("proxy trap executed");
    },
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error("proxy trap executed");
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error("proxy trap executed");
    }
  });
  assert.equal(
    projectSelectedWorkRecordUnit({ ...BASE, sections: { agent_notes: hostileNotes } }),
    null
  );
  assert.equal(trapCalls, 0);

  const hostileUnit = new Proxy({ ...BASE }, {
    get() {
      trapCalls += 1;
      throw new Error("proxy trap executed");
    },
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error("proxy trap executed");
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error("proxy trap executed");
    }
  });
  assert.equal(projectSelectedWorkRecordUnit(hostileUnit), null);
  assert.equal(trapCalls, 0);

  const cyclic = { ...BASE, expected: {} };
  cyclic.expected.self = cyclic.expected;
  assert.equal(projectSelectedWorkRecordUnit(cyclic), null);
});
