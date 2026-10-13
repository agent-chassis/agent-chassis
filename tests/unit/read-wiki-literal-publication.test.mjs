import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { z } from "zod";
import { SESSION_ROLE_TOOL_ACCESS_POLICY_PATH } from "../../packages/wiki-core/src/lib/tool-discovery/gating.mjs";
import { createReadWikiInputSchema } from "../../packages/wiki-mcp/src/lib/task-read-wiki-schema.mjs";
import { createReadWikiGrants } from "../../packages/wiki-mcp/src/lib/task-read-wiki-selection.mjs";
import { publishedReadWikiInputSchema } from "../../packages/wiki-mcp/src/lib/task-read-wiki-selection-forms.mjs";

const policy = JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
const literals = (node, location = "$", found = []) => {
  if (node === null || typeof node !== "object") return found;
  if (Object.hasOwn(node, "const")) found.push({ location, type: node.type, const: node.const });
  for (const [key, child] of Object.entries(node)) literals(child, `${location}.${key}`, found);
  return found;
};

test("the published reader preserves all nine owner-typed boolean literals", () => {
  const validator = createReadWikiInputSchema(z, createReadWikiGrants(policy, "orchestrator"));
  const converted = toJsonSchemaCompat(validator._def.schema, { strictUnions: true, pipeStrategy: "input" });
  const published = publishedReadWikiInputSchema(converted);
  const declared = literals(published);
  assert.deepEqual(declared.map(({ location }) => location), [
    "$.properties.subject.anyOf.1.properties.repository",
    "$.properties.subject.anyOf.2.properties.contract",
    "$.properties.subject.anyOf.4.properties.requirement_guidance",
    "$.properties.search.properties.inventory",
    "$.properties.select.properties.context",
    "$.properties.select.properties.history",
    "$.properties.select.properties.integrity",
    "$.properties.select.properties.currentness",
    "$.properties.select.properties.parameters"
  ]);
  for (const literal of declared) assert.deepEqual([literal.type, literal.const], ["boolean", true], literal.location);
  assert.equal(published.properties.select.anyOf, undefined, "selection remains compact");
  assert.deepEqual(Object.keys(published.properties.select.properties),
    [...new Set(converted.properties.select.anyOf.flatMap(form => Object.keys(form.properties)))]);
});

test("the authoritative reader validator still refuses false and string true in literal fields", () => {
  for (const role of ["orchestrator", "worker", "reviewer", "redteam", "operator"]) {
    const validator = createReadWikiInputSchema(z, createReadWikiGrants(policy, role));
    const converted = toJsonSchemaCompat(validator._def.schema, { strictUnions: true, pipeStrategy: "input" });
    const requests = converted.properties.subject
      ? [{ subject: { repository: true } }, { subject: { contract: true } }] : [];
    if (converted.properties.search) requests.push({ search: { query: "schema", inventory: true } });
    if (converted.properties.assignment) requests.push({ assignment: true });
    if (converted.properties.subject && JSON.stringify(converted.properties.subject).includes("requirement_guidance")) {
      requests.push({ subject: { requirement_guidance: true } });
    }
    for (const key of ["context", "history", "integrity", "currentness", "parameters"]) {
      for (const form of converted.properties.select.anyOf.filter(form => form.properties[key]?.const === true)) {
        const select = Object.fromEntries(Object.entries(form.properties).map(([name, node]) =>
          [name, node.const ?? (name === "entry" ? 1 : "OBL-001")]));
        requests.push({ reference: { ref_id: "abcdefgh" }, select });
      }
    }
    for (const request of requests) {
      assert.equal(validator.safeParse(request).success, true, `${role}: ${JSON.stringify(request)}`);
      for (const replacement of [false, "true"]) {
        const invalid = JSON.parse(JSON.stringify(request), (_key, value) => value === true ? replacement : value);
        assert.equal(validator.safeParse(invalid).success, false, `${role}: ${JSON.stringify(invalid)}`);
      }
    }
  }
});

test("publication retains declared types on every literal without inventing types", () => {
  const values = { yes: { type: "boolean", const: true }, no: { type: "boolean", const: false },
    text: { type: "string", const: "true" }, count: { type: "integer", const: 1 }, empty: { type: "null", const: null },
    untyped: { const: true } };
  const source = { type: "object", properties: { nested: { anyOf: Object.values(values) },
    select: { anyOf: Object.entries(values).map(([key, node]) => ({ type: "object", properties: { [key]: node } })) } } };
  const before = structuredClone(source);
  const published = publishedReadWikiInputSchema(source);
  assert.deepEqual(published.properties.nested, source.properties.nested);
  assert.deepEqual(published.properties.select.properties, values);
  assert.deepEqual(source, before, "publication does not mutate owner declarations");
  const noSelect = { type: "object", properties: { nested: source.properties.nested } };
  assert.deepEqual(publishedReadWikiInputSchema(noSelect), noSelect);
});

test("compact literal publication keeps malformed requests outside the authoritative reader language", () => {
  const validator = createReadWikiInputSchema(z, createReadWikiGrants(policy, "orchestrator"));
  for (const request of [
    {}, { subject: {} }, { subject: { repository: true, contract: true } },
    { subject: { repository: true, unknown: true } }, { subject: { repository: true }, unknown: true },
    { subject: { repository: true }, reference: { ref_id: "abcdefgh" } },
    { reference: { ref_id: "abcdefgh" }, select: { context: true, unknown: true } },
    { reference: { ref_id: "abcdefgh" }, select: { history: true, entry: "1" } }
  ]) assert.equal(validator.safeParse(request).success, false, JSON.stringify(request));
});
