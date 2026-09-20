

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProofPackAdequacyError, staticModuleSpecifiers } from
  "../support/proof-pack-adequacy.mjs";
import { executableDependencyClosure } from
  "../support/executable-dependency-closure.mjs";

const declaredPath = "packages/controlled-contract/lib/subject.mjs";

function refusal(source) {
  try {
    staticModuleSpecifiers(source, declaredPath);
  } catch (error) {
    assert.ok(error instanceof ProofPackAdequacyError, error?.message);
    return error;
  }
  return null;
}

test("a literal dynamic import is a declarable edge the verifier admits", () => {
  assert.deepEqual(
    staticModuleSpecifiers('await import("./validator-population.mjs");', declaredPath),
    ["./validator-population.mjs"]
  );

  assert.deepEqual(
    staticModuleSpecifiers('const ajv = await import("ajv/dist/2020.js");', declaredPath),
    ["ajv/dist/2020.js"]
  );

  assert.deepEqual(
    staticModuleSpecifiers(
      'import { a } from "./a.mjs";\nawait import("./b.mjs");', declaredPath
    ),
    ["./a.mjs", "./b.mjs"]
  );
});

test("a computed dynamic import specifier is refused as undeclarable", () => {
  for (const source of [
    "await import(specifier);",
    "await import(`./${name}.mjs`);",
    'await import("./a" + suffix);',
    "await import(POPULATION[0]);"
  ]) {
    const error = refusal(source);
    assert.ok(error, source);
    assert.equal(error.code, "executable_dynamic_import_unsupported", source);
  }
});

test("a template literal carrying import text is data, not a module edge", () => {

  const bootstrap = "const BOOTSTRAP = `\n" +
    'import("node:worker_threads").then(({ workerData, parentPort }) =>\n' +
    "  import(workerData.moduleUrl)\n" +
    "    .then((module) => module.__run(workerData.request)));\n`;\n";
  assert.deepEqual(staticModuleSpecifiers(bootstrap, declaredPath), []);
});

test("a template literal embedding a local specifier is refused", () => {

  const error = refusal('const SOURCE = `await import("./unpinned.mjs");`;');
  assert.ok(error);
  assert.equal(error.code, "executable_dynamic_import_unsupported");
  assert.match(error.message, /embed a local dynamic import specifier/u);
});

test("the closure builder declares the literal dynamic edge it resolves", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "closure-dynamic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = path.join(root, "packages", "controlled-contract");
  await rm(packages, { recursive: true, force: true });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(packages, { recursive: true });
  await writeFile(path.join(packages, "entry.mjs"),
    'import { s } from "./static.mjs";\nawait import("./dynamic.mjs");\nexport { s };\n');
  await writeFile(path.join(packages, "static.mjs"), "export const s = 1;\n");
  await writeFile(path.join(packages, "dynamic.mjs"), "export const d = 2;\n");
  const closure = await executableDependencyClosure(
    root, "packages/controlled-contract/entry.mjs"
  );
  assert.deepEqual(closure.map(({ path: member }) => member), [
    "packages/controlled-contract/dynamic.mjs",
    "packages/controlled-contract/static.mjs"
  ]);
  assert.ok(closure.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)));
});
