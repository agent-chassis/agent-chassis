

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const testsConfigPath = path.join(repoRoot, "tests", "tsconfig.json");
const scipRequire = createRequire(createRequire(import.meta.url).resolve("@sourcegraph/scip-typescript/package.json"));
const ts = scipRequire("typescript");

function effectiveTestsProjectFiles(host) {
  const read = ts.readConfigFile(testsConfigPath, (file) => ts.sys.readFile(file));
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, host, path.dirname(testsConfigPath));
  assert.deepEqual(parsed.errors.filter(({ code }) => code !== 18003), []);
  return new Set(parsed.fileNames.map((file) => path.relative(repoRoot, file).split(path.sep).join("/")));
}

function virtualTestsHost(relativeFiles) {
  const files = relativeFiles.map((file) => path.join(repoRoot, file));
  return {
    useCaseSensitiveFileNames: true,
    fileExists: (file) => files.includes(file) || ts.sys.fileExists(file),
    readFile: (file) => ts.sys.readFile(file),
    readDirectory: (rootDir, extensions, excludes, includes, depth) =>
      ts.matchFiles(rootDir, extensions, excludes, includes, true, repoRoot, depth, (dir) => {
        const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
        const children = files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
        return {
          files: [...new Set(children.filter((child) => !child.includes(path.sep)))],
          directories: [...new Set(children.filter((child) => child.includes(path.sep)).map((child) => child.split(path.sep)[0]))]
        };
      }, (file) => file)
  };
}

test("tests project includes committed unit, integration, helper, fixture and top-level sources", () => {
  const included = effectiveTestsProjectFiles(ts.sys);
  for (const file of [
    "tests/run-tests.mjs",
    "tests/fixtures/wiki-core-helpers.mjs",
    "tests/helpers/committed-slice-review-fixture.mjs",
    "tests/integration/managed-assignment-start-story.test.mjs",
    "tests/unit/tests-tsconfig-inclusion.test.mjs"
  ]) {
    assert.ok(included.has(file), `${file} must be an input of tests/tsconfig.json`);
  }
});

test("tests project includes nested sources under every test root without an allowlist", () => {
  const nested = [
    "tests/top-level.mjs",
    "tests/fixtures/deep/er/fixture.mjs",
    "tests/helpers/deep/er/helper.mjs",
    "tests/integration/deep/er/case.test.mjs",
    "tests/unit/deep/er/case.test.mjs"
  ];
  const included = effectiveTestsProjectFiles(virtualTestsHost(nested));
  assert.deepEqual([...included].sort(), [...nested].sort());
});
