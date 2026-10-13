

import assert from "node:assert/strict";
import test from "node:test";

import { TEST_RUNTIME_RUNNER_CATALOG } from
  "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import {
  EXCLUSION_REASONS,
  MANIFEST_NAMES,
  discoverRuntimeEnvironments,
  manifestDeclaration,
  environmentsForLanguage,
  environmentsWithRunners,
  pyprojectRequirements
} from "../../packages/agent-launch-cli/src/lib/test-runtime-setup/discovery.mjs";
import {
  enclosingPackage,
  npmLockFacts,
  pnpmLockFacts,
  pnpmWorkspacePatterns,
  resolveNpmWorkspace,
  runnerDeclaringPackage
} from "../../packages/agent-launch-cli/src/lib/test-runtime-setup/npm-workspace.mjs";

const RUNNERS = TEST_RUNTIME_RUNNER_CATALOG.runners;

const discover = (files) => discoverRuntimeEnvironments({
  manifests: Object.keys(files).filter((relative) => manifestDeclaration(relative) !== null),
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
    [{ id: "python@.", members: [], runners: [] }], "inventoried, but no runner is invented");

  const bare = discover({ "pyproject.toml": "[tool.codespell]\nskip = \".git\"\n" });
  assert.deepEqual([bare.environments, bare.excluded],
    [[], [{ path: "pyproject.toml", reason: EXCLUSION_REASONS.NO_INPUTS }]]);

  const declared = discover({ "pyproject.toml": "[project]\nname = \"x\"\n" });
  assert.deepEqual([rows(declared), declared.excluded], [[{ id: "python@.", members: [], runners: [] }], []]);
  assert.deepEqual(environmentsWithRunners(declared.environments), { environments: [],
    excluded: [{ path: "pyproject.toml", reason: EXCLUSION_REASONS.NO_RUNNER }] });

  assert.deepEqual(rows(discover({ "pyproject.toml": "[project.optional-dependencies]\ntest = [\"pytest\"]\n" })),
    [{ id: "python@.", members: [], runners: ["pytest"] }]);
});

const SETUPTOOLS_LAYOUT = Object.freeze({
  "pyproject.toml": "[tool.codespell]\nskip = \".git\"\n\n[tool.coverage.run]\nbranch = true\n",
  "setup.py": "import setuptools\nsetuptools.setup(name=\"svc\", tests_require=open(\"requirements/test.txt\").read())\n",
  "setup.cfg": "[tool:pytest]\ntestpaths = t/unit\n\n[flake8]\nmax-line-length = 117\n",
  "requirements/test.txt": "hypothesis<7\npytest>=8\n-r extras/yaml.txt\n",
  "requirements/extras/yaml.txt": "PyYAML>=3.10\n",
  "requirements/docs.txt": "sphinx\n"
});

test("root packaging and a requirements directory declare the project root, never a requirements project", () => {
  const found = discover(SETUPTOOLS_LAYOUT);
  assert.deepEqual([rows(found), found.excluded], [[{ id: "python@.", members: [], runners: ["pytest"] }], []]);
  assert.deepEqual(found.environments[0].evidence,
    ["pyproject.toml", "requirements/test.txt", "setup.cfg", "setup.py"]);
  assert.deepEqual(manifestDeclaration("svc/requirements/test.txt"),
    { manifest: "requirements/test.txt", ecosystem: "python", language: "python", project: "svc" });
  assert.equal(manifestDeclaration("requirements/docs.txt"), null);
  assert.equal(manifestDeclaration("test.txt"), null);

  for (const file of ["setup.py", "setup.cfg", "requirements/test.txt"]) {
    assert.deepEqual(rows(discover({ "svc/pyproject.toml": SETUPTOOLS_LAYOUT["pyproject.toml"],
      [`svc/${file}`]: SETUPTOOLS_LAYOUT[file] })).map(({ id }) => id), ["python@svc"], file);
  }
});

test("a Python project is owned without runner evidence; automatic setup still sets it aside", () => {

  const found = discover({ "pyproject.toml": SETUPTOOLS_LAYOUT["pyproject.toml"],
    "setup.py": "import setuptools\nsetuptools.setup(name=\"svc\")\n",
    "requirements/test.txt": "-r extras/runner.txt\n",
    "docs/setup.cfg": "[build_sphinx]\nsource-dir = .\n" });
  assert.deepEqual([rows(found), found.excluded], [[{ id: "python@.", members: [], runners: [] },
    { id: "python@docs", members: [], runners: [] }], []]);
  assert.deepEqual(environmentsWithRunners(found.environments), { environments: [], excluded: [
    { path: "pyproject.toml", reason: EXCLUSION_REASONS.NO_RUNNER },
    { path: "requirements/test.txt", reason: EXCLUSION_REASONS.NO_RUNNER },
    { path: "setup.py", reason: EXCLUSION_REASONS.NO_RUNNER },
    { path: "docs/setup.cfg", reason: EXCLUSION_REASONS.NO_RUNNER }] });

  assert.deepEqual(discover({ "tests/fixtures/pkg/setup.py": "" }), { environments: [],
    excluded: [{ path: "tests/fixtures/pkg/setup.py", reason: EXCLUSION_REASONS.FIXTURE }] });
});

const PYPROJECT = `# a project file in the shapes packaging tools write
[build-system]
requires = ["setuptools>=68"]

[project]
name = "svc"
version = "1.0"
dependencies = [
  "requests[socks]>=2.31",  # extras and a trailing comment
  'attrs ; python_version >= "3.9"',
  "Typing_Extensions",
]
optional-dependencies = { docs = ["sphinx"] }

[project.optional-dependencies]
test = ["pytest>=8", "tool @ https://example.invalid/tool.whl#sha256=abc"]

[dependency-groups]
dev = [{ include-group = "lint" }, "stestr"]
lint = ["ruff"]

[tool.poetry.dependencies]
django = "^5"
`;

test("a pyproject.toml requires its project dependencies and no optional or group dependency", () => {

  assert.deepEqual(pyprojectRequirements(PYPROJECT), [
    { name: "Typing_Extensions", requirement: "Typing_Extensions" },
    { name: "attrs", requirement: "attrs ; python_version >= \"3.9\"" },
    { name: "requests", requirement: "requests[socks]>=2.31" }]);
  assert.deepEqual(pyprojectRequirements(
    "[project.optional-dependencies]\ndocs = [\"sphinx\"]\n[dependency-groups]\ntest = [\"pytest\"]\n"), []);
  assert.deepEqual(pyprojectRequirements("project.dependencies = [\"flask\"]\n"),
    [{ name: "flask", requirement: "flask" }]);

  assert.deepEqual(pyprojectRequirements("[project]\ndependencies = [\"numpy>=2; python_version>='3.9'\", " +
    "\"numpy<2; python_version<'3.9'\", \"numpy<2; python_version<'3.9'\"]\n").map(({ requirement }) => requirement),
  ["numpy<2; python_version<'3.9'", "numpy>=2; python_version>='3.9'"]);
  assert.deepEqual(pyprojectRequirements("[project]\nname = \"x\"\ndynamic = [\"dependencies\"]\n"), []);
  assert.deepEqual(pyprojectRequirements(null), []);

  assert.deepEqual(pyprojectRequirements("[project\ndependencies = [\"unterminated\n= = ]]\n{"), []);
});

test("runner evidence in a pyproject.toml does not depend on what setup requires", () => {
  assert.deepEqual(rows(discover({ "svc/pyproject.toml": PYPROJECT })),
    [{ id: "python@svc", members: [], runners: ["pytest", "stestr"] }]);

  for (const text of ["[tool.pytest.ini_options]\naddopts = \"-q\"\n",
    "[tool.poetry.group.dev.dependencies]\npytest = \"^8\"\n",
    "[dependency-groups]\ntest = [\"pytest\"]\n"]) {
    assert.deepEqual(rows(discover({ "pyproject.toml": text })),
      [{ id: "python@.", members: [], runners: ["pytest"] }], text);
  }
});

test("a requirement-file project keeps the runner evidence of its pyproject.toml", () => {
  assert.deepEqual(rows(discover({ "requirements.txt": "flask\n",
    "pyproject.toml": "[tool.pytest.ini_options]\naddopts = \"-q\"\n" })),
  [{ id: "python@.", members: [], runners: ["pytest"] }]);
});

test("automatic setup prepares only the environments that have a runner", () => {
  const found = discover({
    "requirements.txt": "pytest==8.0.0\n",
    "docs/requirements.txt": "sphinx==7.4.7\n",
    "docs/requirements-dev.txt": "sphinx-autobuild\n",
    "site/package.json": pkg({ name: "site", dependencies: { marked: "12" } }),
    "site/package-lock.json": LOCK
  });
  assert.deepEqual(rows(found), [
    { id: "npm@site", members: [], runners: ["node-test"] },
    { id: "python@.", members: [], runners: ["pytest"] },
    { id: "python@docs", members: [], runners: [] }
  ]);
  const testable = environmentsWithRunners(found.environments);

  assert.deepEqual(rows(testable), [
    { id: "npm@site", members: [], runners: ["node-test"] },
    { id: "python@.", members: [], runners: ["pytest"] }
  ]);
  assert.deepEqual(testable.excluded, [
    { path: "docs/requirements-dev.txt", reason: EXCLUSION_REASONS.NO_RUNNER },
    { path: "docs/requirements.txt", reason: EXCLUSION_REASONS.NO_RUNNER }
  ]);

  assert.deepEqual(rows(environmentsWithRunners(discover({ "docs/requirements.txt": "sphinx\npytest\n" })
    .environments)), [{ id: "python@docs", members: [], runners: ["pytest"] }]);
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
      "requirements-dev.txt", "requirements.txt", "requirements/test.txt", "setup.cfg", "setup.py",
      "test-requirements.txt"]);
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

test("npm and pnpm workspace ownership follows declarations and existing locks", () => {
  const PNPM_LOCK = ["lockfileVersion: '9.0'", "importers:", "  .:", "    devDependencies:",
    "      vitest:", "        specifier: 3.0.0", "        version: 3.0.0",
    "  packages/core:", "    dependencies:",
    "      '@ws/util':", "        specifier: workspace:*", "        version: link:../util",
    "      injected:", "        specifier: file:../../vendor/injected", "        version: file:vendor/injected",
    "      archive:", "        specifier: file:../../vendor/archive.tgz", "        version: file:vendor/archive.tgz",
    "  packages/util: {}", "  packages/group/nested/deep: {}", "  vendor/undeclared: {}", "  ../outside: {}",
    ""].join("\n");
  const pnpm = {
    "package.json": pkg({ name: "root", packageManager: "pnpm@9.15.0",

      workspaces: ["vendor/*"], devDependencies: { vitest: "3.0.0" } }),
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - packages/group/nested/*\n  - '!packages/excluded'\n" +
      "catalog:\n  left-pad: 1.3.0\n",
    "pnpm-lock.yaml": PNPM_LOCK,
    "packages/core/package.json": pkg({ name: "@ws/core", dependencies: { "@ws/util": "workspace:*" },
      devDependencies: { mocha: "11" } }),
    "packages/util/package.json": pkg({ name: "@ws/util", devDependencies: { ava: "6" } }),
    "packages/group/nested/deep/package.json": pkg({ name: "@ws/deep", devDependencies: { jest: "30" } }),

    "packages/excluded/package.json": pkg({ name: "excluded", dependencies: { ms: "2" } }),
    "packages/excluded/package-lock.json": LOCK,

    "vendor/undeclared/package.json": pkg({ name: "undeclared", dependencies: { ms: "2" } }),

    "tools/standalone/package.json": pkg({ name: "standalone", dependencies: { ms: "2" } }),
    "tools/standalone/package-lock.json": LOCK
  };

  const walked = Object.keys(pnpm).filter((relative) => relative.endsWith("package.json") &&
    !relative.startsWith("packages/group/"));
  const found = discoverRuntimeEnvironments({ manifests: walked, runners: RUNNERS,
    readFile: (relative) => pnpm[relative] ?? null });
  assert.deepEqual(rows(found), [
    { id: "npm@.", members: ["packages/core", "packages/group/nested/deep", "packages/util"],
      runners: ["ava", "jest", "mocha", "node-test", "vitest"] },
    { id: "npm@packages/excluded", members: [], runners: ["node-test"] },
    { id: "npm@tools/standalone", members: [], runners: ["node-test"] },
    { id: "npm@vendor/undeclared", members: [], runners: ["node-test"] }]);
  assert.ok(found.environments[0].evidence.includes("packages/group/nested/deep/package.json"));
  const read = (files) => (relative) => files[relative] ?? null;
  const root = resolveNpmWorkspace(".", read(pnpm));
  assert.deepEqual([root.manager, root.lock, [...root.inputs], [...root.ambiguous], [...root.patterns]],
    ["pnpm", "pnpm-lock.yaml", ["pnpm-lock.yaml", "pnpm-workspace.yaml"], [],
      ["packages/*", "packages/group/nested/*", "!packages/excluded"]]);

  const member = resolveNpmWorkspace("packages/core", read(pnpm));
  assert.deepEqual([member.lock, [...member.inputs], [...member.patterns]], [null, [], []]);

  assert.deepEqual([...root.localCopies],
    [{ owner: "packages/core", package: "injected", directory: "vendor/injected" }]);
  assert.deepEqual([...pnpmLockFacts(PNPM_LOCK).directories],
    ["packages/core", "packages/group/nested/deep", "packages/util", "vendor/undeclared"],
    "an importer that leaves the lock's directory is not one of its packages");

  assert.deepEqual([
    [...pnpmLockFacts("importers:\n\n  packages/a: {}\n\npackages:\n  x: [unterminated\n").directories],
    [...pnpmLockFacts("lockfileVersion: 5.4\ndependencies:\n  a: 1.0.0\n").directories],
    [...pnpmLockFacts("importers: { packages/a: {} }\n").directories],
    typeof pnpmLockFacts("importers:\n  packages/a: [unterminated\n").error
  ], [["packages/a"], [], ["packages/a"], "string"]);

  const { "pnpm-lock.yaml": _lock, ...unlockedPnpm } = pnpm;
  const npm = { ...unlockedPnpm,
    "package.json": pkg({ name: "root", workspaces: ["packages/*"], devDependencies: { vitest: "3.0.0" } }),
    "package-lock.json": LOCK };
  const underNpm = resolveNpmWorkspace(".", read(npm));
  assert.deepEqual([underNpm.manager, underNpm.lock, [...underNpm.patterns], [...underNpm.inputs]],
    ["npm", "package-lock.json", ["packages/*"], ["package-lock.json"]]);
  assert.deepEqual(rows(discover(npm)).find(({ id }) => id === "npm@.").members,
    ["packages/core", "packages/excluded", "packages/util"]);

  const both = { "package.json": pkg({ name: "x", dependencies: { ms: "2" } }), "package-lock.json": LOCK,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" };
  const undecided = resolveNpmWorkspace(".", read(both));
  assert.deepEqual([undecided.lock, [...undecided.ambiguous], [...undecided.inputs]],
    [null, ["package-lock.json", "pnpm-lock.yaml"], ["package-lock.json", "pnpm-lock.yaml"]]);
  const decided = (extra) => resolveNpmWorkspace(".", read({ ...both, ...extra }));
  assert.equal(decided({ "package.json": pkg({ name: "x", packageManager: "npm@11.0.0" }) }).lock,
    "package-lock.json");
  assert.equal(decided({ "pnpm-workspace.yaml": "packages: []\n" }).lock, "pnpm-lock.yaml");
  assert.equal(decided({ "node_modules/.modules.yaml": "layoutVersion: 5\n" }).lock, "pnpm-lock.yaml");
  assert.equal(decided({ "node_modules/.package-lock.json": LOCK }).lock, "package-lock.json");
  assert.deepEqual([...decided({ "node_modules/.modules.yaml": "x: 1\n", "node_modules/.package-lock.json": LOCK })
    .ambiguous], ["package-lock.json", "pnpm-lock.yaml"], "both managers' metadata decides nothing");

  const unlocked = resolveNpmWorkspace(".", read({ "package.json": pkg({ name: "x", packageManager: "pnpm@9.0.0" }) }));
  assert.deepEqual([unlocked.manager, unlocked.lock, unlocked.install], ["pnpm", null, "pnpm install --frozen-lockfile"]);

  const covered = discover({ "package.json": pkg({ name: "root", dependencies: { ms: "2" } }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "tools/gen/package.json": pkg({ name: "gen" }) });
  assert.deepEqual(covered.excluded, [{ path: "tools/gen/package.json",
    reason: EXCLUSION_REASONS.COVERED, environment: "npm@." }]);

  assert.deepEqual([...pnpmWorkspacePatterns("# members\npackages: [ \"apps/*\", 'libs/**', !!str tools ]\n").patterns],
    ["apps/*", "libs/**", "tools"]);
  assert.deepEqual([...pnpmWorkspacePatterns("shared: &all [a/*]\npackages: *all\n").patterns], ["a/*"]);
  assert.deepEqual([...pnpmWorkspacePatterns("onlyBuiltDependencies:\n  - esbuild\n").patterns], []);
  const unreadable = pnpmWorkspacePatterns("packages: [unterminated\n");
  assert.deepEqual([[...unreadable.patterns], typeof unreadable.error], [[], "string"]);
  assert.equal(resolveNpmWorkspace(".", read({ ...pnpm, "pnpm-workspace.yaml": "packages: [unterminated\n" }))
    .errors[0].file, "pnpm-workspace.yaml");

  assert.deepEqual([...npmLockFacts(pkg({ packages: {
    "": {}, "packages/a": {}, "node_modules/a": { resolved: "packages/a", link: true },
    "node_modules/copied": { resolved: "file:vendor/copied" },
    "packages/a/node_modules/copied": { resolved: "file:vendor/copied" },
    "node_modules/x/node_modules/nested": { resolved: "file:vendor/nested" },
    "node_modules/packed": { resolved: "file:vendor/packed-1.0.0.tgz" } } })).localCopies],
  [{ owner: ".", package: "copied", directory: "vendor/copied" },
    { owner: "packages/a", package: "copied", directory: "vendor/copied" }]);

  const facts = new Map([[".", root.manifest], ["packages/core", member.manifest],
    ["packages/util", resolveNpmWorkspace("packages/util", read(pnpm)).manifest]]);
  assert.deepEqual(["vitest", "mocha", "ava", "jest", "node-test"].map((runner) =>
    runnerDeclaringPackage(facts, runner)), [".", "packages/core", "packages/util", ".", "."]);
  const members = ["packages/core", "packages/core/nested", "packages/util"];
  assert.deepEqual(["packages/core/test/a.spec.js", "packages/core/nested/b.spec.js", "packages/corelib/c.js",
    "test/root.spec.js"].map((file) => enclosingPackage(members, file)),
  ["packages/core", "packages/core/nested", ".", "."]);
});
