import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "../../packages/wiki-core/src/lib/work-record-contract-edit.mjs";
import { createWorkRecordEditFieldInventory } from
  "../../packages/wiki-core/src/lib/work-record-edit-input-guidance.mjs";
import { createWorkRecordEditInputRequestFacts } from
  "../../packages/wiki-mcp/src/lib/work-record-edit-input-contract.mjs";
const discoveryDir = "packages/wiki-core/data/tool-discovery";
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const projectionHeader =
  "| Registry entry | Kind | Scope | Actions | Value | Owning planner |";

function durableValueConstraint(entry) {
  const schema = entry.value_schema;
  if (entry.kind === "task") return schema.replace_text?.entry_content
    ? "bounded task union; text values use exact content"
    : "bounded task union";
  if (schema.entry_content && Number.isInteger(schema.max_utf8_bytes)) {
    const bound = String(schema.max_utf8_bytes).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
    return `exact content, destination at most ${bound} UTF-8 bytes`;
  }
  if (schema.entry_content) return "exact content";
  if (schema.type === "array" && schema.items?.type === "string") {
    return "string array / one string";
  }
  if (schema.type === "array" && schema.items?.shape === "acceptance_criterion") {
    return "criterion string or `{text, verification_method?, evidence_target?, facet_provenance?}` array / one criterion";
  }
  if (schema.type === "array" && schema.items?.shape === "acceptance_note") {
    return "note string or `{note, verification_ids}` array / one note";
  }
  if (schema.type === "array" && schema.items?.type === "object") {
    assert.deepEqual(Object.keys(schema.items.properties ?? {}), ["ref"],
      `unprojected reference-object members for ${entry.id}`);
    assert.deepEqual(schema.items.required, ["ref"], `unprojected reference requirement for ${entry.id}`);
    assert.equal(schema.items.additional_properties, false, `unprojected reference closure for ${entry.id}`);
    assert.ok(Number.isInteger(schema.max_items), `unprojected reference bound for ${entry.id}`);
    return `\`{ref}\` object array, at most ${schema.max_items} / one \`{ref}\` object`;
  }
  if (schema.type === "string" && Array.isArray(schema.enum)) {
    return `\`${schema.enum.join("\\|")}\``;
  }
  if (schema.type === "string" && schema.format === "local_branch_name") {
    return "non-empty local branch name";
  }
  if (schema.type === "string" && schema.trim === true && schema.min_length === 1) {
    return "trimmed non-empty string";
  }
  if (schema.type === "string" && Number.isInteger(schema.max_utf8_bytes)) {
    const bound = String(schema.max_utf8_bytes).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
    return `string, at most ${bound} UTF-8 bytes`;
  }
  assert.equal(schema.type, "string", `unprojected value schema for ${entry.id}`);
  return "string";
}

function parseDurableRegistryProjection(markdown) {
  const start = markdown.indexOf(projectionHeader);
  assert.notEqual(start, -1, "durable registry projection table is missing");
  assert.equal(markdown.indexOf(projectionHeader, start + 1), -1,
    "durable registry projection table must have one owner");
  const lines = markdown.slice(start).split("\n");
  assert.match(lines[1], /^\|(?:\s*---\s*\|){6}$/u,
    "durable registry projection separator is malformed");
  const rows = [];
  for (const line of lines.slice(2)) {
    if (!line.startsWith("|")) break;
    const cells = [];
    let cell = "";
    for (let index = 1; index < line.length - 1; index += 1) {
      const character = line[index];
      if (character === "|" && line[index - 1] !== "\\") {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell.trim());
    assert.equal(cells.length, 6, `malformed durable projection row: ${line}`);
    rows.push(cells);
  }
  return rows;
}

function expectedDurableRegistryProjection() {
  return WORK_RECORD_EDIT_FIELD_REGISTRY.map((entry) => [
    `\`${entry.field}\`${entry.facade ? "" : " (compatibility only)"}`,
    entry.kind,
    entry.applicability.join(", "),
    entry.actions.join(", "),
    durableValueConstraint(entry),
    `\`${entry.owner}\``
  ]);
}

function assertDurableRegistryProjection(markdown) {
  const actual = parseDurableRegistryProjection(markdown);
  const expected = expectedDurableRegistryProjection();
  assert.equal(actual.length, expected.length, "durable registry projection row count");
  const byIdentity = (left, right) => `${left[0]}\u0000${left[2]}`
    .localeCompare(`${right[0]}\u0000${right[2]}`);
  assert.deepEqual([...actual].sort(byIdentity), [...expected].sort(byIdentity));
}

function mutateDurableRegistryProjection(markdown, from, to) {
  const start = markdown.indexOf(projectionHeader);
  const projection = markdown.slice(start);
  const changed = projection.replace(from, to);
  assert.notEqual(changed, projection, `projection mutation fixture not found: ${from}`);
  return `${markdown.slice(0, start)}${changed}`;
}

test("general editor descriptor, manifest, and role policy agree exactly", async () => {
  const [fragment, manifest, policy] = await Promise.all([
    readJson(`${discoveryDir}/work-record-edit-mcp-tools.json`),
    readJson(`${discoveryDir}/manifest.json`),
    readJson(`${discoveryDir}/session-role-tool-access.json`)
  ]);
  const rows = fragment.tools.filter(({ tool_name }) => tool_name === "workspace_work_record_edit");
  assert.equal(rows.length, 1);
  assert.equal(fragment.tool_count, fragment.tools.length);
  assert.equal(
    manifest.fragments.find(({ file }) => file === "work-record-edit-mcp-tools.json").tool_count,
    fragment.tool_count
  );
  assert.equal(
    manifest.expected_tool_count,
    manifest.fragments.reduce((sum, entry) => sum + entry.tool_count, 0)
  );
  assert.deepEqual(policy.access.workspace_work_record_edit, ["orchestrator", "operator"]);
  for (const denied of ["reviewer", "worker", "redteam"]) {
    assert.equal(policy.access.workspace_work_record_edit.includes(denied), false);
  }
  assert.equal(Object.hasOwn(rows[0], "fields"), false, "descriptor must not copy the registry inventory");
  assert.match(JSON.stringify(rows[0].authoritative_for), /WORK_RECORD_EDIT_FIELD_REGISTRY/);
  assert.match(rows[0].do_not_use_when.join(" "), /read-only context/i);
});
test("durable registry projection covers every registry entry without a parallel discovery table", async () => {
  const docs = await readFile("docs/mcp-operation-reference.md", "utf8");
  const toolRegistry = await readFile("docs/mcp-tool-registry-reference.md", "utf8");
  const discovery = await readFile("docs/tool-discovery.md", "utf8");
  const guidanceSource = await readFile(
    "packages/wiki-core/src/lib/work-record-edit-input-guidance.mjs",
    "utf8"
  );
  const inventory = createWorkRecordEditFieldInventory({
    requestFacts: createWorkRecordEditInputRequestFacts(z)
  });
  assertDurableRegistryProjection(docs);
  const mismatches = [
    ["field", "| `title` | scalar |", "| `wrong_title` | scalar |"],
    ["kind", "| `title` | scalar |", "| `title` | list |"],
    ["scope", "| `title` | scalar | record |", "| `title` | scalar | slice |"],
    ["actions", "| `title` | scalar | record | replace |",
      "| `title` | scalar | record | append |"],
    ["value", "| replace | trimmed non-empty string | `editWorkRecordByUnit` |",
      "| replace | string | `editWorkRecordByUnit` |"],
    ["planner", "| replace | trimmed non-empty string | `editWorkRecordByUnit` |",
      "| replace | trimmed non-empty string | `upsertSlice` |"],
    ["notes UTF-8 bound", "at most 8,192 UTF-8 bytes", "at most 8,191 UTF-8 bytes"],
    ["material_refs value", "`{ref}` object array, at most 16", "string array, at most 16"],
    ["material_refs scope", "| `sections.material_refs` | list | record, slice |",
      "| `sections.material_refs` | list | record |"],
    ["row count", "| `title` | scalar | record | replace | trimmed non-empty string | " +
      "`editWorkRecordByUnit` |\n", ""]
  ];
  for (const [label, from, to] of mismatches) {
    const mismatch = mutateDurableRegistryProjection(docs, from, to);
    assert.throws(() => assertDurableRegistryProjection(mismatch), undefined, label);
  }
  assert.match(toolRegistry, /reviewer, worker, and redteam sessions are denied/i);
  assert.match(discovery, /orchestrator and operator/);
  assert.match(discovery, /no CLI parity/);
  assert.deepEqual(
    inventory.fields.map(({ field }) => field),
    [...new Set(WORK_RECORD_EDIT_FIELD_REGISTRY
      .filter(({ facade }) => facade).map(({ field }) => field))]
  );
  assert.match(docs, /work-record-edit-input-contract\.mjs/);
  assert.match(docs, /work-record-edit-input-guidance\.mjs/);
  assert.doesNotMatch(guidanceSource, /wiki-mcp|zod-request-contract-projection/);
});
