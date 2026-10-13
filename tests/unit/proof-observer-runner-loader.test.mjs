

import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createTestFixture } from "../helpers/test-fixture.mjs";

const { importRunnerModule, runnerRequire } = createRequire(import.meta.url)(
  "../../packages/agent-launch-cli/src/lib/test-execution/observers/native-channel.cjs");

const json = (value) => `${JSON.stringify(value)}\n`;

function write(root, files) {
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
}

function installation(instance) {
  return {
    "node_modules/modern/package.json": json({ name: "modern", version: "1.0.0",
      exports: { ".": { import: "./index.mjs", require: "./index.cjs" }, "./node": "./node.cjs",
        "./package.json": "./package.json" } }),
    "node_modules/modern/index.cjs": `module.exports = { instance: ${JSON.stringify(instance)}, format: "require" };\n`,
    "node_modules/modern/index.mjs": `export const instance = ${JSON.stringify(instance)};\nexport const format = "import";\n`,
    "node_modules/modern/node.cjs":
      `module.exports = { instance: ${JSON.stringify(instance)}, dependency: require("shared-dep") };\n`,
    "node_modules/classic/package.json": json({ name: "classic", version: "1.0.0", main: "lib/main.js" }),
    "node_modules/classic/lib/main.js": `module.exports = { instance: ${JSON.stringify(instance)} };\n`,
    "node_modules/shared-dep/package.json": json({ name: "shared-dep", version: "1.0.0", main: "index.js" }),
    "node_modules/shared-dep/index.js": `module.exports = ${JSON.stringify(`shared-dep@${instance}`)};\n`
  };
}

async function workspace(t) {
  const fixture = await createTestFixture({ prefix: "proof-observer-runner-loader-" });
  t.after(() => fixture.dispose());
  const root = path.join(fixture.rootPath, "project");
  const member = path.join(root, "packages/core");
  write(root, installation("root"));
  write(member, installation("member"));

  const config = (owner, name) => ({ project_directory: root, runner_package: path.join(owner, "node_modules", name) });
  return { root, member, config };
}

test("the selected runner package is the instance loaded, with its own exports and dependencies", async (t) => {
  const { root, member, config } = await workspace(t);
  for (const [label, owner] of [["member", member], ["root", root]]) {
    const modern = runnerRequire(config(owner, "modern"));
    assert.deepEqual(modern("modern"), { instance: label, format: "require" }, `${label}: require condition`);
    assert.deepEqual(modern("modern/node"), { instance: label, dependency: `shared-dep@${label}` },
      `${label}: an exported subpath, with the dependency of that installation`);
    assert.equal(modern.resolve("modern/package.json"), path.join(owner, "node_modules/modern/package.json"));
    const imported = await importRunnerModule(config(owner, "modern"), "modern");
    assert.deepEqual([imported.instance, imported.format], [label, "import"], `${label}: import condition`);
    assert.deepEqual(runnerRequire(config(owner, "classic"))("classic"), { instance: label },
      `${label}: a package without exports`);
  }

  assert.throws(() => runnerRequire(config(member, "modern")).resolve("modern/index.cjs"),
    { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
});

test("a pnpm-style linked package is loaded where it really is installed", async (t) => {
  const { root, member, config } = await workspace(t);
  const store = path.join(root, "node_modules/.pnpm/modern@2.0.0/node_modules");
  write(path.dirname(store), Object.fromEntries(Object.entries(installation("store"))
    .filter(([relative]) => !relative.startsWith("node_modules/classic/"))));
  rmSync(path.join(member, "node_modules/modern"), { recursive: true });
  symlinkSync(path.join(store, "modern"), path.join(member, "node_modules/modern"));
  const modern = runnerRequire(config(member, "modern"));

  assert.deepEqual(modern("modern/node"), { instance: "store", dependency: "shared-dep@store" });
  assert.equal((await importRunnerModule(config(member, "modern"), "modern")).instance, "store");
});

test("a selected package that is absent or incomplete is that failure, never another installation", async (t) => {
  const { root, member, config } = await workspace(t);

  rmSync(path.join(member, "node_modules/modern"), { recursive: true });
  const absent = config(member, "modern");
  assert.throws(() => runnerRequire(absent), { code: "ENOENT", path: absent.runner_package });
  assert.throws(() => importRunnerModule(absent, "modern"), { code: "ENOENT", path: absent.runner_package });

  symlinkSync(path.join(member, "node_modules/.gone/modern"), path.join(member, "node_modules/modern"));
  assert.throws(() => runnerRequire(absent), { code: "ENOENT", path: absent.runner_package });
  rmSync(path.join(member, "node_modules/modern"));

  write(member, { "node_modules/modern/package.json": json({ name: "modern", version: "1.0.0",
    exports: { ".": "./index.cjs", "./node": "./node.cjs" } }) });
  assert.throws(() => runnerRequire(absent).resolve("modern/node"), { code: "MODULE_NOT_FOUND",
    message: `Cannot find module '${path.join(member, "node_modules/modern/node.cjs")}'` });
  await assert.rejects(() => importRunnerModule(absent, "modern"), { code: "ERR_MODULE_NOT_FOUND" });

  rmSync(path.join(member, "node_modules/classic/lib"), { recursive: true });
  const classic = config(member, "classic");
  assert.throws(() => runnerRequire(classic)("classic"), { code: "MODULE_NOT_FOUND",
    path: path.join(classic.runner_package, "package.json") });

  write(root, { "node_modules/bare/package.json": json({ name: "bare", version: "1.0.0" }),
    "node_modules/bare/index.js": "module.exports = { instance: 'root' };\n" });
  write(member, { "node_modules/bare/package.json": json({ name: "bare", version: "1.0.0" }) });
  const bare = config(member, "bare");
  assert.equal(createRequire(path.join(bare.runner_package, "x.cjs")).resolve("bare"),
    path.join(root, "node_modules/bare/index.js"), "Node itself falls through to the root installation");
  assert.throws(() => runnerRequire(bare)("bare"), (error) => {
    assert.match(error.message, /does not supply bare; Node resolved it to another installation/u);
    assert.ok(error.message.includes(bare.runner_package), error.message);
    return true;
  });
  assert.throws(() => runnerRequire(bare).resolve("bare"), /another installation/u);

  assert.throws(() => runnerRequire({ project_directory: root }), /names no selected runner package/u);
  assert.throws(() => importRunnerModule({ project_directory: root }, "modern"),
    /names no selected runner package/u);
});
