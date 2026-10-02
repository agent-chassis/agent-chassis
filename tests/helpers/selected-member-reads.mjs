

import assert from "node:assert/strict";

const pathKey = (path) => JSON.stringify(path);

function createAccumulator(fragment) {
  return { kind: fragment.kind, path: fragment.path, text: "", rows: [], childCalls: [], value: undefined };
}

function accumulate(entry, fragment) {
  assert.equal(fragment.kind, entry.kind, `selection ${pathKey(entry.path)} keeps its kind across pages`);
  if (fragment.kind === "string") entry.text += fragment.value;
  else if (fragment.kind === "object" || fragment.kind === "array") {
    for (const row of fragment.members) {
      assert.equal(Object.hasOwn(row, "next_call"), false, "a container row carries no per-row call envelope");
      assert.equal(Object.hasOwn(row, "value"), false, "a container row carries no descendant value");
      entry.rows.push(row);
    }
    entry.childCalls.push(...(fragment.child_calls ?? []));
  } else entry.value = fragment.value;
}

export async function collectSelectedMember(call, first, { maxCalls = 10_000 } = {}) {
  let calls = 0;
  const pages = [];
  const invoke = async (request) => {
    calls += 1;
    assert.ok(calls <= maxCalls, `member traversal exceeded its ${maxCalls}-call bound`);
    const page = await call(request.tool, request.arguments);
    assert.equal(page?.ok, true, JSON.stringify(page));
    assert.ok(Array.isArray(page.next_calls) && page.next_calls.length <= 1, "at most one continuation per page");
    pages.push(page);
    return page;
  };

  const readBatch = async (request) => {
    const selections = new Map();
    let page = await invoke(request);
    for (;;) {
      assert.equal(page.diagnostics, undefined, JSON.stringify(page.diagnostics));
      const requested = page.selections;
      assert.equal(requested.requested, requested.completed + requested.failed + requested.remaining,
        "batch counts account for every requested selection");
      for (const fragment of page.members) {
        const key = pathKey(fragment.path);
        if (!selections.has(key)) selections.set(key, createAccumulator(fragment));
        accumulate(selections.get(key), fragment);
      }
      if (page.next_calls.length === 0) break;
      assert.ok(Array.isArray(page.next_calls[0].arguments.members), "a batch continues as a batch");
      page = await invoke(page.next_calls[0]);
    }
    for (const entry of selections.values()) entry.result = await finish(entry);
    return selections;
  };

  const finish = async (entry) => {
    if (entry.kind === "string") return entry.text;
    if (entry.kind !== "object" && entry.kind !== "array") return entry.value;
    const children = new Map();
    for (const childCall of entry.childCalls) {
      for (const [key, child] of await readBatch(childCall)) children.set(key, child.result);
    }
    const value = entry.kind === "array" ? [] : {};
    for (const row of entry.rows) {
      const segment = entry.kind === "array" ? row.index : row.key;
      const key = pathKey([...entry.path, segment]);
      assert.ok(children.has(key), `child ${key} is addressed by an emitted batch call`);
      Object.defineProperty(value, String(segment), { value: children.get(key), enumerable: true, writable: true,
        configurable: true });
    }
    return value;
  };

  const readSingle = async (request) => {
    let page = await invoke(request);
    const entry = createAccumulator(page.member);
    for (;;) {
      accumulate(entry, page.member);
      if (page.next_calls.length === 0) break;
      page = await invoke(page.next_calls[0]);
    }
    return finish(entry);
  };

  const value = Array.isArray(first.arguments?.members)
    ? Object.fromEntries([...(await readBatch(first)).values()].map((entry) => [pathKey(entry.path), entry.result]))
    : await readSingle(first);
  return { value, calls, pages };
}
