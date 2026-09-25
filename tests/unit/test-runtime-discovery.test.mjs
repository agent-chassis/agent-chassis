

import assert from "node:assert/strict";
import test from "node:test";

import { TEST_RUNTIME_RUNNER_CATALOG } from
  "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import {
  EXCLUSION_REASONS,
  MANIFEST_NAMES,
  discoverRuntimeEnvironments,
  environmentsForLanguage
} from "../../packages/core/scripts/test-runtime-setup/discovery.mjs";

const RUNNERS = TEST_RUNTIME_RUNNER_CATALOG.runners;

const discover = (files) => discoverRuntimeEnvironments({
  manifests: Object.keys(files).filter((relative) =>
    MANIFEST_NAMES.includes(relative.split("/").at(-1))),
  runners: RUNNERS,
  readFile: (relative) => files[relative] ?? null });
const pkg = (body) => JSON.stringify(body);
const rows = ({ environments }) => environments.map(({ id, members, runners }) => ({ id, members, runners }));
const LOCK = pkg({ lockfileVersion: 3 });

test("a toolchain-provided runner is identified by its manifest alone", () => {
  assert.deepEqual(rows(discover({ "go.mod": "module example.com/x\n\ngo 1.26\n" })),
    [{ id: "go_modules@.", members: [], runners: ["go-test"] }]);
  assert.deepEqual(rows(discover({ "crates/core/Cargo.toml": "[package]\n" })),
    [{ id: "cargo@crates/core", members: [], runners: ["cargo-test"] }]);
  for (const manifest of ["deno.json", "deno.jsonc"]) {
    assert.deepEqual(rows(discover({ [manifest]: "{}" })),
      [{ id: "deno@.", members: [], runners: ["deno"] }]);
  }
});

test("an npm environment without framework evidence has node:test only, never the catalog", () => {

  for (const script of ["node scripts/run-suite.mjs unit", "make check", undefined]) {
    const found = discover({ "package.json": pkg({ name: "x", scripts: script === undefined ? {} : { test: script } }) });
    assert.deepEqual(rows(found), [{ id: "npm@.", members: [], runners: ["node-test"] }], String(script));
  }

  assert.deepEqual(rows(discover({ "package.json": "{ not json" })),
    [{ id: "npm@.", members: [], runners: ["node-test"] }]);
});

test("declared frameworks coexist with node:test in one environment", () => {
  assert.deepEqual(rows(discover({ "package.json": pkg({ devDependencies: { jest: "29", vitest: "1" } }),
    "package-lock.json": LOCK })), [{ id: "npm@.", members: [], runners: ["jest", "node-test", "vitest"] }]);
  for (const [dependency, runner] of [["mocha", "mocha"], ["ava", "ava"], ["lib0", "lib0-testing"]]) {
    assert.deepEqual(discover({ "web/package.json": pkg({ dependencies: { [dependency]: "1" } }) })
      .environments[0].runners, [runner, "node-test"].sort(), dependency);
  }
});

test("a workspace is one installation: members fold in, uncovered packages run in it, fixtures are excluded", () => {
  const found = discover({
    "package.json": pkg({ name: "root", private: true, workspaces: ["packages/*"],
      scripts: { test: "node tests/run-all.mjs unit" } }),
    "package-lock.json": LOCK,
    "packages/api/package.json": pkg({ name: "@x/api", dependencies: { "@x/util": "*" } }),
    "packages/util/package.json": pkg({ name: "@x/util", devDependencies: { mocha: "10" } }),
    "packages/docs/package.json": pkg({ name: "@x/docs" }),

    "tools/bench/package.json": pkg({ name: "bench", private: true }),

    "tests/fixtures/app/package.json": pkg({ name: "fixture", dependencies: { ava: "6" } }),
    "tests/fixtures/app/package-lock.json": LOCK,
    "examples/demo/package.json": pkg({ name: "demo" }),
    "tools/testdata/go.mod": "module example.com/testdata\n"
  });

  assert.deepEqual(rows(found), [{ id: "npm@.", members: ["packages/api", "packages/docs", "packages/util"],
    runners: ["mocha", "node-test"] }]);
  assert.deepEqual(found.environments[0].evidence, ["package.json", "packages/api/package.json",
    "packages/docs/package.json", "packages/util/package.json"]);
  assert.deepEqual(found.excluded, [
    { path: "examples/demo/package.json", reason: EXCLUSION_REASONS.FIXTURE },
    { path: "tests/fixtures/app/package.json", reason: EXCLUSION_REASONS.FIXTURE },
    { path: "tools/bench/package.json", reason: EXCLUSION_REASONS.COVERED, environment: "npm@." },
    { path: "tools/testdata/go.mod", reason: EXCLUSION_REASONS.FIXTURE }
  ]);
});

test("a workspace declaration keeps a member whose directory name resembles a fixture", () => {
  const found = discover({
    "package.json": pkg({ workspaces: { packages: ["examples/*", "!examples/skip", "libs/**"] } }),
    "package-lock.json": LOCK,
    "examples/app/package.json": pkg({ name: "app" }),
    "examples/skip/package.json": pkg({ name: "skip" }),
    "libs/a/b/package.json": pkg({ name: "deep", devDependencies: { ava: "6" } })
  });
  assert.deepEqual(rows(found), [{ id: "npm@.", members: ["examples/app", "libs/a/b"],
    runners: ["ava", "node-test"] }]);
  assert.deepEqual(found.excluded, [{ path: "examples/skip/package.json", reason: EXCLUSION_REASONS.FIXTURE }]);
});

test("independent installations of one language are separate environments", () => {
  const found = discover({
    "package.json": pkg({ name: "root" }),
    "services/web/package.json": pkg({ name: "web", devDependencies: { jest: "29" } }),
    "services/web/package-lock.json": LOCK,
    "services/api/requirements.txt": "pytest==8.0.0\n",
    "tools/lint/requirements.txt": "flake8==7.0.0\n",
    "tools/lint/test-requirements.txt": "stestr>=4\n"
  });
  assert.deepEqual(rows(found), [
    { id: "npm@.", members: [], runners: ["node-test"] },
    { id: "npm@services/web", members: [], runners: ["jest", "node-test"] },
    { id: "python@services/api", members: [], runners: ["pytest"] },
    { id: "python@tools/lint", members: [], runners: ["stestr"] }
  ]);
  assert.deepEqual(found.environments.find(({ id }) => id === "python@tools/lint").evidence,
    ["tools/lint/requirements.txt", "tools/lint/test-requirements.txt"]);
});

test("a Python environment lists only the runners its requirements declare", () => {
  assert.deepEqual(rows(discover({ "requirements.txt": "flask\n" })),
    [{ id: "python@.", members: [], runners: [] }], "prepared, but no runner is invented");

  const bare = discover({ "pyproject.toml": "[project]\nname = \"x\"\n" });
  assert.deepEqual([bare.environments, bare.excluded],
    [[], [{ path: "pyproject.toml", reason: EXCLUSION_REASONS.NO_INPUTS }]]);

  assert.deepEqual(rows(discover({ "pyproject.toml": "[project.optional-dependencies]\ntest = [\"pytest\"]\n" })),
    [{ id: "python@.", members: [], runners: ["pytest"] }]);
});

test("a Cargo workspace is one vendored installation", () => {
  const found = discover({
    "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]\n",
    "crates/core/Cargo.toml": "[package]\nname = \"core\"\n",
    "crates/cli/Cargo.toml": "[package]\nname = \"cli\"\n"
  });
  assert.deepEqual(rows(found), [{ id: "cargo@.", members: ["crates/cli", "crates/core"],
    runners: ["cargo-test"] }]);
});

test("a multilingual repository prepares every language at once; --language narrows", () => {
  const found = discover({ "go.mod": "module x\n", "web/package.json": pkg({ devDependencies: { jest: "29" } }),
    "web/package-lock.json": LOCK, "py/requirements.txt": "pytest\n", "edge/deno.json": "{}" });
  assert.deepEqual(found.environments.map(({ id, language }) => `${id}:${language}`),
    ["deno@edge:typescript", "go_modules@.:go", "npm@web:javascript", "python@py:python"]);
  assert.deepEqual(environmentsForLanguage(found.environments, "go", RUNNERS).map(({ id }) => id),
    ["go_modules@."]);

  assert.deepEqual(environmentsForLanguage(found.environments, "typescript", RUNNERS).map(({ id }) => id),
    ["deno@edge", "npm@web"]);
  assert.equal(environmentsForLanguage(found.environments, null, RUNNERS), found.environments);
});

test("only repository project manifests are evidence", () => {
  assert.deepEqual([...MANIFEST_NAMES].sort(),
    ["Cargo.toml", "deno.json", "deno.jsonc", "go.mod", "package.json", "pyproject.toml",
      "requirements-dev.txt", "requirements.txt", "test-requirements.txt"]);
  assert.deepEqual(discover({ "README.md": "# x", "Makefile": "check:\n" }),
    { environments: [], excluded: [] });
});

test("a declared workspace member below the bounded walk is found through the root lock", () => {
  const files = {
    "package.json": pkg({ name: "root", workspaces: ["packages/**"] }),
    "package-lock.json": pkg({ lockfileVersion: 3, packages: {
      "": { name: "root", workspaces: ["packages/**"] },
      "packages/group/sub/pkg": { name: "deep", version: "1.0.0" },
      "node_modules/deep": { resolved: "packages/group/sub/pkg", link: true },

      "vendor/local": { name: "local", version: "1.0.0" },
      "node_modules/local": { resolved: "vendor/local", link: true },

      "packages/gone": { name: "gone", version: "1.0.0" }
    } }),
    "packages/group/sub/pkg/package.json": pkg({ name: "deep", devDependencies: { vitest: "3" } }),
    "vendor/local/package.json": pkg({ name: "local" })
  };

  const found = discoverRuntimeEnvironments({ manifests: ["package.json"], runners: RUNNERS,
    readFile: (relative) => files[relative] ?? null });
  assert.deepEqual(rows(found), [{ id: "npm@.", members: ["packages/group/sub/pkg"],
    runners: ["node-test", "vitest"] }]);
  assert.deepEqual(found.environments[0].evidence, ["package.json", "packages/group/sub/pkg/package.json"]);
});
