

import assert from "node:assert/strict";
import test from "node:test";

import { TEST_RUNTIME_RUNNER_CATALOG } from
  "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import {
  MANIFEST_NAMES,
  chooseRuntimeSelection,
  discoverRuntimeProjects,
  runtimeSelectionCandidates
} from "../../packages/core/scripts/test-runtime-setup/discovery.mjs";

const RUNNERS = TEST_RUNTIME_RUNNER_CATALOG.runners;
const discover = (files) => discoverRuntimeProjects({
  manifests: Object.keys(files), runners: RUNNERS,
  readFile: (relative) => files[relative] ?? null });
const npmPackage = (body) => JSON.stringify(body);

test("a single-runner ecosystem is identified by its manifest alone", () => {
  assert.deepEqual(discover({ "go.mod": "module example.com/x\n\ngo 1.26\n" })
    .map(({ project, language, ecosystem, runners, identified }) =>
      [project, language, ecosystem, runners, identified]),
  [[".", "go", "go_modules", ["go-test"], true]]);

  assert.deepEqual(discover({ "crates/core/Cargo.toml": "[package]\n" })
    .map(({ project, language, runners, identified, evidence }) =>
      [project, language, runners, identified, evidence]),
  [["crates/core", "rust", ["cargo-test"], true, ["crates/core/Cargo.toml"]]]);

  for (const manifest of ["deno.json", "deno.jsonc"]) {
    assert.deepEqual(discover({ [manifest]: "{}" }).map(({ runners, identified }) =>
      [runners, identified]), [[["deno"], true]]);
  }
});

test("an npm project names its runner through a declared dependency", () => {
  for (const [dependency, runner] of [["jest", "jest"], ["vitest", "vitest"],
    ["mocha", "mocha"], ["ava", "ava"], ["lib0", "lib0-testing"]]) {
    const found = discover({ "package.json": npmPackage({ devDependencies: { [dependency]: "1" } }) });
    assert.deepEqual(found.map(({ runners, identified }) => [runners, identified]),
      [[[runner], true]], dependency);
  }

  assert.deepEqual(discover({ "web/package.json": npmPackage({ dependencies: { vitest: "1" } }) })
    .map(({ project, runners }) => [project, runners]), [["web", ["vitest"]]]);
});

test("an npm project with no framework dependency needs its own test script", () => {
  const withScript = discover({ "package.json":
    npmPackage({ scripts: { test: "node --test tests/" } }) });
  assert.deepEqual(withScript.map(({ runners, identified }) => [runners, identified]),
    [[["node-test"], true]]);

  const bare = discover({ "package.json": npmPackage({ name: "x", scripts: { test: "make check" } }) });
  assert.equal(bare[0].identified, false);
  assert.deepEqual(bare[0].runners, ["ava", "jest", "lib0-testing", "mocha", "node-test", "vitest"]);

  assert.equal(discoverRuntimeProjects({ manifests: ["package.json"], runners: RUNNERS,
    readFile: () => "{ not json" })[0].identified, false);
});

test("two declared frameworks stay ambiguous", () => {
  const found = discover({ "package.json":
    npmPackage({ devDependencies: { jest: "29", vitest: "1" } }) });
  assert.deepEqual([found[0].runners, found[0].identified], [["jest", "vitest"], true]);
  const chosen = chooseRuntimeSelection({ discovered: found, runners: RUNNERS });
  assert.equal(chosen.status, "ambiguous");
  assert.deepEqual(chosen.candidates.map(({ runner, project }) => `${runner}@${project}`),
    ["jest@.", "vitest@."]);
});

test("a python project names its runner through its declared requirements", () => {
  assert.deepEqual(discover({ "requirements.txt": "pytest==8.0.0\n" })
    .map(({ language, runners, identified }) => [language, runners, identified]),
  [["python", ["pytest"], true]]);
  assert.deepEqual(discover({ "test-requirements.txt": "stestr>=4\n" })
    .map(({ runners }) => runners), [["stestr"]]);

  const combined = discover({ "requirements.txt": "flask\n", "requirements-dev.txt": "pytest\n" });
  assert.deepEqual([combined.length, combined[0].evidence, combined[0].runners],
    [1, ["requirements-dev.txt", "requirements.txt"], ["pytest"]]);

  const neither = discover({ "pyproject.toml": "[project]\nname = \"x\"\n" });
  assert.deepEqual([neither[0].runners, neither[0].identified], [["pytest", "stestr"], false]);
});

test("several projects are all reported and are a choice, not a guess", () => {
  const found = discover({ "go.mod": "module x\n", "web/package.json":
    npmPackage({ devDependencies: { jest: "29" } }) });
  assert.deepEqual(found.map(({ project, runners }) => [project, runners]),
    [[".", ["go-test"]], ["web", ["jest"]]]);
  const chosen = chooseRuntimeSelection({ discovered: found, runners: RUNNERS });
  assert.equal(chosen.status, "ambiguous");
  assert.deepEqual(chosen.candidates.map(({ runner, project }) => `${runner}@${project}`),
    ["go-test@.", "jest@web"]);

  const narrowed = chooseRuntimeSelection({ discovered: found, language: "go", runners: RUNNERS });
  assert.equal(narrowed.status, "resolved");
  assert.deepEqual(narrowed.selection, [{ runner: "go-test", project: "." }]);
  assert.match(narrowed.source, /^repository evidence \(go\.mod\)$/u);
  assert.deepEqual(runtimeSelectionCandidates(found, { language: "javascript", runners: RUNNERS })
    .map(({ runner }) => runner), ["jest"]);
});

test("selections resolve as explicit choices, then saved configuration, then discovery", () => {
  const discovered = discover({ "go.mod": "module x\n" });
  const saved = [{ runner: "pytest", project: "services" }];
  const explicit = [{ runner: "deno", project: "edge" }];

  assert.deepEqual(chooseRuntimeSelection({ explicit, saved, discovered, runners: RUNNERS }),
    { status: "resolved", source: "command line", selection: explicit });
  const fromSaved = chooseRuntimeSelection({ saved, discovered, runners: RUNNERS });
  assert.deepEqual([fromSaved.status, fromSaved.selection, fromSaved.source],
    ["resolved", saved, "saved repository configuration"]);
  assert.equal(chooseRuntimeSelection({ discovered, runners: RUNNERS }).source,
    "repository evidence (go.mod)");

  assert.deepEqual(chooseRuntimeSelection({ discovered: [], runners: RUNNERS }),
    { status: "none", language: null });
});

test("only repository-owned manifests are evidence", () => {
  assert.deepEqual([...MANIFEST_NAMES].sort(),
    ["Cargo.toml", "deno.json", "deno.jsonc", "go.mod", "package.json", "pyproject.toml",
      "requirements-dev.txt", "requirements.txt", "test-requirements.txt"]);

  assert.deepEqual(discover({ "README.md": "# x", "Makefile": "check:\n" }), []);
});
