import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { TOOLCHAIN_DESCRIPTIONS } from
  "../../packages/wiki-core/src/lib/runtime-inputs/toolchain-descriptions.mjs";
import { currentPlatformKey, isVersionRequirement, readProjectToolchainPins,
  TOOLCHAIN_NAMES, TOOLCHAIN_RECIPES, versionSatisfies } from
  "../../packages/agent-launch-cli/src/lib/test-runtime-setup/recipes.mjs";
import { withTestFixture } from "../helpers/test-fixture.mjs";

test("shared toolchain descriptions preserve installed-tool facts", () => {
  assert.deepEqual(Object.keys(TOOLCHAIN_DESCRIPTIONS), ["node", "python", "go", "rust", "deno"]);
  assert.ok(Object.isFrozen(TOOLCHAIN_DESCRIPTIONS));
  const expected = {
    node: { command: "node", roles: { node: "bin/node" }, population: ["bin/node"],
      probe: ["node", ["--version"], "v20.1.2", "20.1.2", "20.1"] },
    python: { command: "python3", roles: { python: "bin/python3" }, population: null,
      probe: ["python", ["--version"], "Python 3.12.1", "3.12.1", "Python 3.12"] },
    go: { command: "go", roles: { go: "bin/go", gofmt: "bin/gofmt" }, population: ["."],
      probe: ["go", ["version"], "go version go1.23.4 linux/amd64", "1.23.4", "go1.23.4"] },
    rust: { command: "rustc", roles: { cargo: "bin/cargo", rustc: "bin/rustc" }, population: ["."],
      probe: ["cargo", ["--version"], "cargo 1.84.0 (hash)", "1.84.0", "rustc 1.84.0"] },
    deno: { command: "deno", roles: { deno: "deno" }, population: ["deno"],
      probe: ["deno", ["--version"], "deno 2.1.0 (stable)", "2.1.0", "deno 2.1"] }
  };
  for (const [name, facts] of Object.entries(expected)) {
    const description = TOOLCHAIN_DESCRIPTIONS[name];
    assert.equal(description.name, name);
    assert.equal(description.host_command, facts.command);
    assert.deepEqual(description.executables, facts.roles);
    assert.deepEqual(description.population ?? null, facts.population);
    assert.deepEqual([description.probe.executable, description.probe.args], facts.probe.slice(0, 2));
    assert.equal(description.probe.version(facts.probe[2]), facts.probe[3]);
    assert.equal(description.probe.version(facts.probe[4]), null);
    for (const value of [description, description.executables, description.probe,
      description.probe.args, description.population, description.host_root_probe]) {
      if (value !== undefined) assert.ok(Object.isFrozen(value), `${name} nested fact is frozen`);
    }
    for (const policy of ["pins", "native_prerequisites", "readiness", "cache", "process"]) {
      assert.equal(Object.hasOwn(description, policy), false, `${name} has no ${policy} policy`);
    }
  }
  assert.equal(TOOLCHAIN_DESCRIPTIONS.node.hostRoot("/opt/node/bin/node"), "/opt/node");
  assert.equal(TOOLCHAIN_DESCRIPTIONS.go.hostRoot("/opt/go/bin/go"), "/opt/go");
  assert.equal(TOOLCHAIN_DESCRIPTIONS.deno.hostRoot("/opt/deno"), "/opt");
  assert.deepEqual(TOOLCHAIN_DESCRIPTIONS.rust.host_root_probe, ["--print", "sysroot"]);
  assert.equal(Object.hasOwn(TOOLCHAIN_DESCRIPTIONS.rust, "hostRoot"), false);
  assert.equal(Object.hasOwn(TOOLCHAIN_DESCRIPTIONS.python, "hostRoot"), false);
  assert.equal(Object.hasOwn(TOOLCHAIN_DESCRIPTIONS.python, "population"), false);
});

test("launcher recipes add policy without copying installation facts", async () => {
  assert.deepEqual(TOOLCHAIN_NAMES, ["node", "python", "go", "rust", "deno"]);
  assert.ok(Object.isFrozen(TOOLCHAIN_RECIPES));
  const expectedPins = {
    node: [".nvmrc", ".node-version"], python: [".python-version"], go: ["go.mod"],
    rust: ["rust-toolchain.toml", "rust-toolchain"], deno: [".dvmrc"]
  };
  for (const [name, description] of Object.entries(TOOLCHAIN_DESCRIPTIONS)) {
    const recipe = TOOLCHAIN_RECIPES[name];
    assert.ok(Object.isFrozen(recipe));
    assert.ok(Object.isFrozen(recipe.pins));
    assert.deepEqual(recipe.pins.map(({ file }) => file), expectedPins[name]);
    assert.strictEqual(recipe.executables, description.executables);
    assert.strictEqual(recipe.probe, description.probe);
    if (description.population) assert.strictEqual(recipe.population, description.population);
    if (description.hostRoot) assert.strictEqual(recipe.hostRoot, description.hostRoot);
    if (description.host_root_probe) assert.strictEqual(recipe.host_root_probe, description.host_root_probe);
    assert.equal(Object.hasOwn(recipe, "native_prerequisites"), name === "rust");
  }
  assert.deepEqual(TOOLCHAIN_RECIPES.rust.native_prerequisites, ["cc"]);
  assert.equal(currentPlatformKey({ platform: "linux", arch: "x64" }), "linux-x64");
  for (const value of ["1", "1.2", "1.2.3"]) assert.equal(isVersionRequirement(value), true);
  for (const value of ["v1", "1.2.3.4", "latest"]) assert.equal(isVersionRequirement(value), false);
  assert.equal(versionSatisfies("1.2", "1.2.3"), true);
  assert.equal(versionSatisfies("1.2", "1.20.3"), false);
  await withTestFixture(({ rootPath }) => {
    const files = {
      ".nvmrc": "# comment\nv20.1.2\n", ".node-version": "v20.2.0\n",
      ".python-version": "3.12.1\n", "go.mod": "module example.org/x\ngo 1.23\ntoolchain go1.23.4\n",
      "rust-toolchain.toml": "[toolchain]\nchannel = \"1.84.0\"\n",
      "rust-toolchain": "1.85.0\n", ".dvmrc": "v2.1.0\n"
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(rootPath, name), body);
    assert.deepEqual(Object.fromEntries(TOOLCHAIN_NAMES.map((name) => [name,
      readProjectToolchainPins(TOOLCHAIN_RECIPES[name], rootPath)])), {
      node: [{ file: ".nvmrc", version: "20.1.2" }, { file: ".node-version", version: "20.2.0" }],
      python: [{ file: ".python-version", version: "3.12.1" }],
      go: [{ file: "go.mod", version: "1.23.4" }],
      rust: [{ file: "rust-toolchain.toml", version: "1.84.0" },
        { file: "rust-toolchain", version: "1.85.0" }],
      deno: [{ file: ".dvmrc", version: "2.1.0" }]
    });
  });
});
