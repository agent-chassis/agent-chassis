

import assert from "node:assert/strict";
import test from "node:test";

import {
  REPOSITORY_RUNTIME_CONFIG_FILE,
  parseTestRuntimeConfig,
  serializeTestRuntimeConfig
} from "../../packages/core/scripts/test-runtime-setup/config.mjs";

const parse = (document) => parseTestRuntimeConfig(JSON.stringify(document), { source: "runtime.json" });
const refuses = (document, pattern) =>
  assert.throws(() => parse(document), (error) => {
    assert.match(error.message, /^invalid runtime configuration runtime\.json: /u);
    assert.match(error.message, pattern);
    return true;
  });

test("the closed shape carries the selection and any explicit toolchain locations", () => {
  assert.deepEqual(parse({
    runners: [{ runner: "go-test", project: "." }],
    toolchains: { go: { executable: "/opt/go/bin/go", version: "1.27.1" } }
  }), {
    runners: [{ runner: "go-test", project: "." }],
    toolchains: { go: { executable: "/opt/go/bin/go", version: "1.27.1" } },
    environments: {},
    test_entrypoints: []
  });

  const minimal = parse({ runners: [{ runner: "pytest" }, { runner: "go-test", project: "svc/api" }] });
  assert.deepEqual(minimal, {
    runners: [{ runner: "pytest", project: "." }, { runner: "go-test", project: "svc/api" }],
    toolchains: {},
    environments: {},
    test_entrypoints: []
  });

  const unversioned = parse({ runners: [{ runner: "deno" }],
    toolchains: { deno: { executable: "/opt/deno/deno" } } });
  assert.deepEqual(unversioned.toolchains, { deno: { executable: "/opt/deno/deno", version: null } });
});

test("toolchain locations alone are a complete document: the inventory decides the environments", () => {
  assert.deepEqual(parse({ toolchains: { go: { executable: "/opt/go/bin/go", version: "1.27.1" } } }),
    { runners: [], toolchains: { go: { executable: "/opt/go/bin/go", version: "1.27.1" } }, environments: {},
      test_entrypoints: [] });
});

test("an explicitly selected Python virtual environment is a closed, absolute, per-environment choice", () => {
  assert.deepEqual(parse({ environments: { "python@.": { virtual_environment: "/srv/app/.venv" },
    "python@services/api": { virtual_environment: "/opt/venvs/api" } } }).environments,
  { "python@.": { virtual_environment: "/srv/app/.venv" },
    "python@services/api": { virtual_environment: "/opt/venvs/api" } });
  refuses({ environments: [] }, /environments must be an object/u);
  refuses({ environments: { "npm@.": { virtual_environment: "/x" } } },
    /environments\.npm@\. must name a python@<project> environment/u);
  refuses({ environments: { "python@.": { virtual_environment: ".venv" } } },
    /environments\.python@\.\.virtual_environment must be the absolute path/u);
  refuses({ environments: { "python@.": { interpreter: "/usr/bin/python3" } } },
    /environments\.python@\. has unknown field interpreter/u);
  const text = serializeTestRuntimeConfig({ runners: [], toolchains: {},
    environments: { "python@.": { virtual_environment: "/srv/app/.venv" } } });
  assert.deepEqual(parseTestRuntimeConfig(text, { source: "runtime.json" }).environments,
    { "python@.": { virtual_environment: "/srv/app/.venv" } });
});

test("malformed documents are refused rather than partially applied", () => {
  assert.throws(() => parseTestRuntimeConfig("{not json", { source: "runtime.json" }),
    /invalid runtime configuration runtime\.json: not valid JSON/u);
  for (const document of [[], "runners", 42, null]) {
    assert.throws(() => parseTestRuntimeConfig(JSON.stringify(document), { source: "runtime.json" }),
      /the configuration must be an object/u);
  }
  refuses({ runners: [{ runner: "go-test" }], extra: true }, /unknown field extra/u);
  refuses({}, /the configuration must name runners, toolchains, environments or test_entrypoints/u);
  refuses({ runners: [] }, /runners must be a nonempty array/u);
  refuses({ runners: {} }, /runners must be a nonempty array/u);
});

test("selections are closed, well typed and unambiguous", () => {
  refuses({ runners: ["go-test"] }, /runners\[0\] must be an object/u);
  refuses({ runners: [{ runner: "go-test", runners: [] }] }, /runners\[0\] has unknown field runners/u);
  refuses({ runners: [{ project: "." }] }, /runners\[0\]\.runner must be a runner name/u);
  refuses({ runners: [{ runner: "Go-Test" }] }, /runners\[0\]\.runner must be a runner name/u);
  refuses({ runners: [{ runner: 7 }] }, /runners\[0\]\.runner must be a runner name/u);
  refuses({ runners: [{ runner: "go-test", project: 7 }] },
    /runners\[0\]\.project must be a repository-relative directory/u);
  refuses({ runners: [{ runner: "go-test", project: "" }] },
    /runners\[0\]\.project must be a repository-relative directory/u);
  refuses({ runners: [{ runner: "go-test" }, { runner: "go-test", project: "." }] },
    /runners selects go-test@\. more than once/u);
  refuses({ runners: [{ runner: "go-test", project: "svc" }, { runner: "go-test", project: "svc" }] },
    /runners selects go-test@svc more than once/u);

  assert.equal(parse({ runners: [{ runner: "go-test", project: "a" },
    { runner: "go-test", project: "b" }, { runner: "deno", project: "a" }] }).runners.length, 3);
});

test("explicit toolchain locations must be absolute paths with an exact version", () => {
  refuses({ runners: [{ runner: "go-test" }], toolchains: [] }, /toolchains must be an object/u);
  refuses({ runners: [{ runner: "go-test" }], toolchains: { go: "/opt/go/bin/go" } },
    /toolchains\.go must be an object/u);
  refuses({ runners: [{ runner: "go-test" }], toolchains: { go: { path: "/opt/go/bin/go" } } },
    /toolchains\.go has unknown field path/u);
  refuses({ runners: [{ runner: "go-test" }], toolchains: { go: { version: "1.27.1" } } },
    /toolchains\.go\.executable must be an absolute path/u);
  refuses({ runners: [{ runner: "go-test" }], toolchains: { go: { executable: "bin/go" } } },
    /toolchains\.go\.executable must be an absolute path/u);
  refuses({ runners: [{ runner: "go-test" }], toolchains: { go: { executable: 7 } } },
    /toolchains\.go\.executable must be an absolute path/u);
  for (const version of ["1.27", "go1.27.1", "latest", "", 1, null]) {
    refuses({ runners: [{ runner: "go-test" }],
      toolchains: { go: { executable: "/opt/go/bin/go", version } } },
    /toolchains\.go\.version must be an exact <x\.y\.z> version/u);
  }
});

test("the parser resolves nothing: unknown names reach the launcher-owned setup", () => {

  const config = parse({ runners: [{ runner: "no-such-runner", project: "svc" }],
    toolchains: { ruby: { executable: "/opt/ruby/bin/ruby" } } });
  assert.deepEqual(config.runners, [{ runner: "no-such-runner", project: "svc" }]);
  assert.deepEqual(config.toolchains, { ruby: { executable: "/opt/ruby/bin/ruby", version: null } });
});

test("what setup saves is exactly what it reads back", () => {
  assert.equal(REPOSITORY_RUNTIME_CONFIG_FILE, "agent-chassis-runtime.json");
  const resolved = { runners: [{ runner: "go-test", project: "go" }],
    toolchains: { go: { executable: "/usr/local/go/bin/go", version: null } }, environments: {},
    test_entrypoints: [] };
  const text = serializeTestRuntimeConfig(resolved);
  assert.equal(text, `{
  "runners": [
    {
      "runner": "go-test",
      "project": "go"
    }
  ],
  "toolchains": {
    "go": {
      "executable": "/usr/local/go/bin/go"
    }
  }
}
`);
  assert.deepEqual(parseTestRuntimeConfig(text, { source: "runtime.json" }), resolved);

  const pinned = serializeTestRuntimeConfig({ runners: [{ runner: "deno", project: "." }],
    toolchains: { deno: { executable: "/opt/deno/deno", version: "2.9.6" } } });
  assert.deepEqual(parseTestRuntimeConfig(pinned, { source: "runtime.json" }).toolchains,
    { deno: { executable: "/opt/deno/deno", version: "2.9.6" } });
  const bare = serializeTestRuntimeConfig({ runners: [{ runner: "pytest", project: "." }],
    toolchains: {} });
  assert.deepEqual(parseTestRuntimeConfig(bare, { source: "runtime.json" }),
    { runners: [{ runner: "pytest", project: "." }], toolchains: {}, environments: {}, test_entrypoints: [] });

  const located = serializeTestRuntimeConfig({ runners: [],
    toolchains: { node: { executable: "/usr/bin/node", version: null } } });
  assert.equal(located, '{\n  "toolchains": {\n    "node": {\n      "executable": "/usr/bin/node"\n    }\n  }\n}\n');
  assert.deepEqual(parseTestRuntimeConfig(located, { source: "runtime.json" }),
    { runners: [], toolchains: { node: { executable: "/usr/bin/node", version: null } }, environments: {},
      test_entrypoints: [] });
});

test("runtime entrypoint associations validate and round-trip", () => {
  const lib0 = { runner: "lib0-testing", project: ".", target: "test/example.test.mjs",
    entrypoint: "test/run-tests.mjs" };
  const wrapper = { runner: "node-test", project: ".", adapter: "node-test-wrapper",
    entrypoint: "tests/run-tests.mjs" };

  const associationsOnly = parse({ test_entrypoints: [lib0, wrapper] });
  assert.deepEqual(associationsOnly,
    { runners: [], toolchains: {}, environments: {}, test_entrypoints: [lib0, wrapper] });
  const associationsOnlyText = serializeTestRuntimeConfig(associationsOnly);
  assert.deepEqual(JSON.parse(associationsOnlyText), { test_entrypoints: [lib0, wrapper] });
  assert.deepEqual(parseTestRuntimeConfig(associationsOnlyText, { source: "runtime.json" }), associationsOnly);

  assert.deepEqual(parse({ runners: [{ runner: "node-test" }] }).test_entrypoints, []);
  assert.equal(serializeTestRuntimeConfig({ runners: [{ runner: "node-test", project: "." }], toolchains: {},
    test_entrypoints: [] }), '{\n  "runners": [\n    {\n      "runner": "node-test",\n      "project": "."\n    }\n  ]\n}\n');

  const full = {
    runners: [{ runner: "go-test", project: "go" }],
    toolchains: { go: { executable: "/usr/local/go/bin/go", version: "1.27.1" },
      node: { executable: "/usr/bin/node", version: null } },
    environments: { "python@.": { virtual_environment: "/srv/app/.venv" } },
    test_entrypoints: [wrapper, lib0]
  };
  const fullText = serializeTestRuntimeConfig(full);
  assert.deepEqual(parseTestRuntimeConfig(fullText, { source: "runtime.json" }), full);
  assert.deepEqual(Object.keys(JSON.parse(fullText)), ["runners", "toolchains", "environments", "test_entrypoints"]);

  const reordered = parse({ test_entrypoints: [{ entrypoint: "t/run.mjs", target: "t/a.test.mjs",
    project: "pkg", runner: "lib0-testing" }] });
  assert.equal(serializeTestRuntimeConfig(reordered).replace(/\s+/gu, ""),
    '{"test_entrypoints":[{"runner":"lib0-testing","project":"pkg","target":"t/a.test.mjs","entrypoint":"t/run.mjs"}]}');

  const shared = parse({ test_entrypoints: [lib0,
    { ...lib0, target: "test/other.test.mjs" },
    { ...lib0, project: "packages/a" },
    { ...lib0, project: "packages/a/nested" },
    wrapper,
    { ...wrapper, project: "packages/a" },
    { ...wrapper, project: "packages/a/nested", entrypoint: "packages/a/nested/run.mjs" }] });
  assert.equal(shared.test_entrypoints.length, 7);
  assert.deepEqual(shared.test_entrypoints.map(({ project }) => project),
    [".", ".", "packages/a", "packages/a/nested", ".", "packages/a", "packages/a/nested"]);

  refuses({ test_entrypoints: [lib0, { ...lib0, entrypoint: "test/other-runner.mjs" }] },
    /test_entrypoints associates lib0-testing \. test\/example\.test\.mjs more than once/u);
  refuses({ test_entrypoints: [wrapper, { ...wrapper, entrypoint: "scripts/run.mjs" }] },
    /test_entrypoints associates node-test \. more than once/u);

  refuses({ test_entrypoints: [] }, /test_entrypoints must be a nonempty array/u);
  refuses({ test_entrypoints: {} }, /test_entrypoints must be a nonempty array/u);
  refuses({ test_entrypoints: lib0 }, /test_entrypoints must be a nonempty array/u);
  refuses({ test_entrypoints: [null] }, /test_entrypoints\[0\] must be an object/u);
  refuses({ test_entrypoints: ["lib0-testing"] }, /test_entrypoints\[0\] must be an object/u);
  refuses({ test_entrypoints: [[lib0]] }, /test_entrypoints\[0\] must be an object/u);

  for (const runner of ["jest", "node-test-wrapper", "Lib0-testing", "toString", 7, null, undefined,
    ["lib0-testing"], ["node-test"], [["lib0-testing"]], { toString: () => "lib0-testing" }]) {
    refuses({ test_entrypoints: [{ ...lib0, runner }] },
      /test_entrypoints\[0\]\.runner must be one of lib0-testing, node-test/u);
  }
  for (const adapter of ["node-test", "tap", "", 7, null]) {
    refuses({ test_entrypoints: [{ ...wrapper, adapter }] },
      /test_entrypoints\[0\]\.adapter must be one of node-test-wrapper/u);
  }
  refuses({ test_entrypoints: [{ ...lib0, adapter: "node-test-wrapper" }] },
    /test_entrypoints\[0\] has unknown field adapter/u);
  refuses({ test_entrypoints: [{ ...wrapper, target: "tests/a.test.mjs" }] },
    /test_entrypoints\[0\] has unknown field target/u);
  refuses({ test_entrypoints: [{ ...wrapper, mode: "auto" }] },
    /test_entrypoints\[0\] has unknown field mode/u);
  for (const field of ["project", "target", "entrypoint"]) {
    const { [field]: _omitted, ...rest } = lib0;
    refuses({ test_entrypoints: [rest] }, new RegExp(`test_entrypoints\\[0\\]\\.${field} is required`, "u"));
  }
  for (const field of ["project", "adapter", "entrypoint"]) {
    const { [field]: _omitted, ...rest } = wrapper;
    refuses({ test_entrypoints: [rest] }, new RegExp(`test_entrypoints\\[0\\]\\.${field} is required`, "u"));
  }

  const rejected = [
    [7, "it is not a string"], [null, "it is not a string"], [["a"], "it is not a string"],
    [{}, "it is not a string"], [true, "it is not a string"],
    ["", "it is empty"],
    ["a\0b", "it contains NUL"],
    ["a\\b", "it contains a backslash"], ["\\\\server\\share", "it contains a backslash"],
    ["/abs/path", "it is absolute"], ["//server/share", "it is absolute"],
    ["C:/x", "it names a drive"], ["c:x", "it names a drive"],
    ["a/*.mjs", "it contains a glob character"], ["a/?.mjs", "it contains a glob character"],
    ["a/[ab].mjs", "it contains a glob character"], ["a/{b,c}.mjs", "it contains a glob character"],
    ["a//b", "it has an empty segment"], ["a/", "it has an empty segment"],
    ["./a", "it has a \\. segment"], ["a/./b", "it has a \\. segment"],
    ["../a", "it has a \\.\\. segment"], ["a/..", "it has a \\.\\. segment"]
  ];
  for (const [base, fields] of [[lib0, ["project", "target", "entrypoint"]],
    [wrapper, ["project", "entrypoint"]]]) {
    for (const field of fields) {
      for (const [value, reason] of rejected) {
        refuses({ test_entrypoints: [{ ...base, [field]: value }] }, new RegExp(
          `test_entrypoints\\[0\\]\\.${field} must be a canonical repository-relative path: ${reason}`, "u"));
      }
      if (field !== "project") {
        refuses({ test_entrypoints: [{ ...base, [field]: "." }] }, new RegExp(
          `test_entrypoints\\[0\\]\\.${field} must be a canonical repository-relative path: ` +
          "it names the repository root, not a file", "u"));
      }
    }
  }

  assert.deepEqual(parse({ test_entrypoints: [{ ...lib0, project: "no/such/project",
    target: "no/such.test.mjs", entrypoint: "no/such-runner.mjs" }] }).test_entrypoints,
  [{ runner: "lib0-testing", project: "no/such/project", target: "no/such.test.mjs",
    entrypoint: "no/such-runner.mjs" }]);
});
