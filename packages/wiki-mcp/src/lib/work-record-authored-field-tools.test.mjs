import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import { WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { baseSlice } from "../../../../tests/fixtures/work-record-admission.mjs";
import { canonicalRecord, createToolRegistry, parseStructuredResponse, readRecord, WORKSPACE_REPO } from
  "../../../../tests/fixtures/work-record-write-tools-harness.mjs";
import { WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME, createWorkRecordEditInputSchema } from
  "./work-record-authored-field-tools.mjs";
async function withWorkspace(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "authored-field-tools-"));
  try {
    const value = canonicalRecord();
    value.sections.tasks = [{ text: "Original task", status: "todo" }];
    value.tags = [];
    const slice = baseSlice({ id: "SLICE-001", docs: ["docs/slice-original.md"] });
    slice.read_scope = [...slice.docs];
    delete slice.docs;
    value.slices = [slice];
    const target = path.join(dir, "wiki", "work-records", `${value.id}.json`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fn({ dir, value });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("general edit schema is a closed mechanical projection of every facade entry", () => {
  const schema = createWorkRecordEditInputSchema(z);
  for (const entry of WORK_RECORD_EDIT_FIELD_REGISTRY.filter(({ facade }) => facade)) {
    for (const action of entry.actions) {
      const request = { unit: "WK-2287", kind: entry.kind, field: entry.field, action };
      if (entry.kind === "scalar") {
        request.value = entry.field === "priority" ? "high" : "value";
      } else if (entry.kind === "list") {
        request.value = action === "append" ? "value" : ["value"];
      } else if (action === "append_todo") {
        request.value = "value";
      } else {
        request.index = 0;
        if (action === "replace_text") request.value = "value";
      }
      assert.equal(schema.safeParse(request).success, true, entry.id);
    }
  }
  for (const field of WORK_RECORD_EDIT_SPECIALIZED_FIELD_OWNERS.flatMap(
    ({ prefixes }) => prefixes
  )) {
    assert.equal(schema.safeParse({
      unit: "WK-2287", kind: "scalar", field, action: "replace", value: "refusal probe"
    }).success, true, field);
  }
  for (const rejected of [
    { unit: "WK-2287", kind: "scalar", field: "title", action: "replace", value: "x", dir: "/tmp" },
    { unit: "WK-2287", kind: "scalar", field: "/title", action: "replace", value: "x" },
    { unit: "WK-2287", kind: "scalar", field: "sections", action: "replace", value: {} },
    { unit: "WK-2287", kind: "scalar", field: "status.value", action: "replace", value: "done" },
    { unit: "WK-2287", kind: "scalar", field: "status", action: "merge", value: "done" }
  ]) assert.equal(schema.safeParse(rejected).success, false);
});
test("registered facade routes scalar, list, and task requests to canonical owners", async () => {
  await withWorkspace(async ({ dir, value }) => {
    const tool = createToolRegistry(dir).get(WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME);
    assert.ok(tool);
    const call = async (request) => {
      const parsed = tool.config.inputSchema.safeParse({ repo: WORKSPACE_REPO, unit: value.id, ...request });
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues ?? []));
      return parseStructuredResponse(await tool.handler(parsed.data));
    };
    const scalar = await call({ kind: "scalar", field: "title",
      action: "replace", value: "New title" });
    assert.equal(scalar.written, true);
    assert.ok(scalar.changed_fields.includes("title"));
    const list = await call({ kind: "list", field: "tags", action: "append", value: "new" });
    assert.equal(list.written, true);
    const task = await call({ kind: "task", field: "sections.tasks",
      action: "replace_text", index: 0, value: "New task" });
    assert.equal(task.written, true);
    assert.equal(task.task.status, "todo");
    const replay = await call({ kind: "task", field: "sections.tasks",
      action: "replace_text", index: 0, value: "New task" });
    assert.equal(replay.no_op, true);
  });
});
test("compatibility task and list tools remain registered beside the general facade", () => {
  const tools = createToolRegistry(process.cwd());
  assert.ok(tools.has("workspace_work_record_set_task"));
  assert.ok(tools.has("workspace_work_record_set_list_field"));
  assert.ok(tools.has(WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME));
  assert.equal(tools.has("workspace_work_record_set_scalar"), false);
});

test("docs alias behavior agrees through the general facade and list compatibility adapter", async () => {
  await withWorkspace(async ({ dir, value }) => {
    const tools = createToolRegistry(dir);
    const general = tools.get(WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME);
    const compatibility = tools.get("workspace_work_record_set_list_field");
    const call = async (tool, request) => {
      const parsed = tool.config.inputSchema.safeParse({
        repo: WORKSPACE_REPO,
        unit: value.id,
        ...request
      });
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues ?? []));
      return parseStructuredResponse(await tool.handler(parsed.data));
    };
    const replaced = await call(general, {
      kind: "list", field: "docs", action: "replace", value: ["docs/replacement.md"]
    });
    assert.equal(replaced.written, true);
    assert.ok(replaced.changed_fields.includes("read_scope"));
    assert.equal(replaced.changed_fields.includes("docs"), false);

    const duplicate = await call(compatibility, {
      field: "docs", values: ["docs/replacement.md"], mode: "append",
      expected_source_digest: replaced.source_digest
    });
    assert.equal(duplicate.no_op, true);
    assert.equal(duplicate.source_digest, replaced.source_digest);
    assert.deepEqual(duplicate.changed_fields, []);

    const appended = await call(compatibility, {
      field: "docs", values: ["docs/new.md"], mode: "append",
      expected_source_digest: duplicate.source_digest
    });
    assert.equal(appended.written, true);
    assert.equal(appended.changed_fields.filter((field) => field === "read_scope").length, 1);

    const slice = await call(general, {
      unit: `${value.id}#SLICE-001`, kind: "list", field: "docs",
      action: "append", value: "docs/slice-new.md"
    });
    assert.equal(slice.written, true);
    assert.ok(slice.changed_fields.includes("slices[SLICE-001].read_scope"));

    const persisted = await readRecord(path.join(dir, "wiki", "work-records", `${value.id}.json`));
    assert.deepEqual(persisted.read_scope, ["docs/replacement.md", "docs/new.md"]);
    assert.deepEqual(persisted.slices[0].read_scope,
      ["docs/slice-original.md", "docs/slice-new.md"]);
    assert.equal(Object.hasOwn(persisted, "docs"), false);
    assert.equal(Object.hasOwn(persisted.slices[0], "docs"), false);
  });
});

test("known semantic fields reach exact core owner refusals and cannot mutate", async () => {
  await withWorkspace(async ({ dir, value }) => {
    const tool = createToolRegistry(dir).get(WORKSPACE_WORK_RECORD_EDIT_TOOL_NAME);
    const recordPath = path.join(dir, "wiki", "work-records", `${value.id}.json`);
    const before = await readRecord(recordPath);
    for (const [field, owner] of [
      ["status", "workspace_work_record_set_status"],
      ["acceptance", "workspace_work_record_set_acceptance"]
    ]) {
      const parsed = tool.config.inputSchema.safeParse({
        repo: WORKSPACE_REPO,
        unit: value.id,
        kind: "scalar",
        field,
        action: "replace",
        value: "attempted mutation"
      });
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues ?? []));
      const result = parseStructuredResponse(await tool.handler(parsed.data));
      assert.equal(result.written, false);
      assert.equal(result.no_op, false);
      assert.equal(result.diagnostics[0].code, "field_owner_mismatch");
      assert.equal(result.diagnostics[0].message,
        `${field} is not generally editable; use ${owner}`);
    }
    assert.deepEqual(await readRecord(recordPath), before);
  });
});
