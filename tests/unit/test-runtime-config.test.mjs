

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
    environments: {}
  });

  const minimal = parse({ runners: [{ runner: "pytest" }, { runner: "go-test", project: "svc/api" }] });
  assert.deepEqual(minimal, {
    runners: [{ runner: "pytest", project: "." }, { runner: "go-test", project: "svc/api" }],
    toolchains: {},
    environments: {}
  });

  const unversioned = parse({ runners: [{ runner: "deno" }],
    toolchains: { deno: { executable: "/opt/deno/deno" } } });
  assert.deepEqual(unversioned.toolchains, { deno: { executable: "/opt/deno/deno", version: null } });
});

test("toolchain locations alone are a complete document: the inventory decides the environments", () => {
  assert.deepEqual(parse({ toolchains: { go: { executable: "/opt/go/bin/go", version: "1.27.1" } } }),
    { runners: [], toolchains: { go: { executable: "/opt/go/bin/go", version: "1.27.1" } }, environments: {} });
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
  refuses({}, /the configuration must name runners, toolchains or environments/u);
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
    toolchains: { go: { executable: "/usr/local/go/bin/go", version: null } }, environments: {} };
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
    { runners: [{ runner: "pytest", project: "." }], toolchains: {}, environments: {} });

  const located = serializeTestRuntimeConfig({ runners: [],
    toolchains: { node: { executable: "/usr/bin/node", version: null } } });
  assert.equal(located, '{\n  "toolchains": {\n    "node": {\n      "executable": "/usr/bin/node"\n    }\n  }\n}\n');
  assert.deepEqual(parseTestRuntimeConfig(located, { source: "runtime.json" }),
    { runners: [], toolchains: { node: { executable: "/usr/bin/node", version: null } }, environments: {} });
});
