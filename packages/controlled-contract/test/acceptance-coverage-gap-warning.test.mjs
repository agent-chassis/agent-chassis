import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(packageRoot, "schema", "acceptance-coverage-gap-warning.v1.schema.json");
const declarationPath = join(packageRoot, "current.d.mts");
const packageJsonPath = join(packageRoot, "package.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));

const expected = {
  code: "acceptance_coverage_incomplete",
  severity: "advisory",
  message: "Acceptance coverage has unresolved gaps.",
  payload: "acceptance-coverage-gap-warning.v1"
};

test("acceptance-coverage gap warning schema has the exact published shape", () => {
  assert.deepEqual(schema.required, Object.keys(expected));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(schema.properties).map(([name, definition]) => [name, definition.const])),
    expected
  );
});

test("representative warnings validate and malformed warnings are rejected", () => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validate(expected), true);

  for (const invalid of [
    { ...expected, severity: "warning" },
    { ...expected, message: "Coverage is incomplete." },
    { ...expected, payload: "acceptance-coverage-gap-warning.v0" },
    { code: expected.code, severity: expected.severity, message: expected.message },
    { ...expected, extra: true }
  ]) {
    assert.equal(validate(invalid), false, JSON.stringify(invalid));
  }
});

test("the declaration is parity-bound to the schema and the schema is published", async () => {
  const declaration = await readFile(declarationPath, "utf8");
  const declarationMatch = declaration.match(
    /export interface AcceptanceCoverageGapWarning \{([\s\S]*?)\n\}/u
  );
  assert.ok(declarationMatch, "AcceptanceCoverageGapWarning must be exported");
  const members = [...declarationMatch[1].matchAll(/^\s+(\w+): ([^;]+);$/gmu)]
    .map(([, field, value]) => [field, value]);
  assert.deepEqual(members, Object.entries(expected).map(([field, value]) => [
    field,
    JSON.stringify(value)
  ]));

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  assert.equal(packageJson.exports["./schema/*"], "./schema/*");
  assert.equal(
    packageJson.files.includes("schema/acceptance-coverage-gap-warning.v1.schema.json"),
    true
  );
  assert.equal(packageJson.files.some((entry) => entry === "schema/*"), false);
});
