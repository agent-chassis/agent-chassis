

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEPENDENCY_ECOSYSTEMS } from "../../packages/agent-launch-cli/src/lib/test-runtime-setup/ecosystems.mjs";
import { GO_WORKSPACE_REFERENCE_REASONS, selectGoWorkspace } from
  "../../packages/agent-launch-cli/src/lib/test-runtime-setup/go-workspace.mjs";
import { measureProjectInputs } from "../../packages/agent-launch-cli/src/lib/test-runtime-setup/readiness.mjs";
import { createTestFixture } from "../helpers/test-fixture.mjs";

const fixture = await createTestFixture({ prefix: "test-runtime-go-workspace-selection-" });
test.after(() => fixture.dispose());

const MODULE = (name, extra = "") => `module example.com/${name}\n\ngo 1.26\n${extra}`;

const WORKSPACE = Object.freeze({
  "go.work": "go 1.26\n\nuse (\n\t./app\n\t./lib\n)\n\nreplace example.com/patched => ./third_party/patched\n",
  "go.work.sum": "example.com/remote v1.0.0/go.mod h1:workspace\n",
  "app/go.mod": MODULE("app", "\nrequire example.com/lib v0.0.0\n"),
  "app/go.sum": "example.com/remote v1.0.0/go.mod h1:app\n",
  "lib/go.mod": MODULE("lib", "\nreplace example.com/forked => ../forks/forked\n"),
  "third_party/patched/go.mod": MODULE("patched"),
  "forks/forked/go.mod": MODULE("forked"),

  "tools/go.mod": MODULE("tools")
});

async function checkout(name, files = WORKSPACE) {
  const root = await fixture.childPath(name);
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
  return root;
}

const go = DEPENDENCY_ECOSYSTEMS.go_modules;
const inputsOf = (root, project) => measureProjectInputs("go_modules", path.join(root, project),
  { checkoutRoot: root });
const goworkOf = (root, project) => go.runtimeBinding({ dependency: { status: "none" },
  projectHostDir: path.join(root, project), checkoutRoot: root }).env.GOWORK;

test("a workspace member's inputs are the workspace files, every used module and each local replacement",
  async () => {
    const root = await checkout("member");
    const app = inputsOf(root, "app");
    assert.equal(app.status, "present");
    assert.deepEqual(Object.keys(app.files).sort(), ["../forks/forked/go.mod", "../go.work", "../go.work.sum",
      "../lib/go.mod", "../third_party/patched/go.mod", "go.mod", "go.sum"]);
    assert.equal(app.files["../lib/go.mod"], path.join(root, "lib/go.mod"));

    assert.deepEqual(Object.keys(inputsOf(root, "lib").files).sort(), ["../app/go.mod", "../app/go.sum",
      "../forks/forked/go.mod", "../go.work", "../go.work.sum", "../third_party/patched/go.mod", "go.mod"]);
    assert.deepEqual(selectGoWorkspace(path.join(root, "app"), root).invalid, []);

    assert.equal(goworkOf(root, "app"), path.join(root, "go.work"));
    assert.equal(goworkOf(root, "lib"), path.join(root, "go.work"));
  });

test("a module no workspace uses keeps its own go.mod and go.sum and runs with the workspace off", async () => {
  const root = await checkout("standalone", { "svc/go.mod": MODULE("svc"), "svc/go.sum": "sum\n" });
  const standalone = inputsOf(root, "svc");
  assert.deepEqual(Object.keys(standalone.files).sort(), ["go.mod", "go.sum"]);

  assert.equal(standalone.inputs_digest, measureProjectInputs("go_modules", path.join(root, "svc")).inputs_digest);
  assert.equal(goworkOf(root, "svc"), "off");

  writeFileSync(path.join(root, "go.work"), "go 1.26\n\nuse ./nested/svc\n");
  const nested = await checkout("standalone/nested", { "svc/go.mod": MODULE("svc"), "svc/go.sum": "sum\n" });
  assert.deepEqual(Object.keys(inputsOf(nested, "svc").files).sort(), ["go.mod", "go.sum"]);
  assert.equal(goworkOf(nested, "svc"), "off");

  const mixed = await checkout("unused");
  assert.deepEqual(Object.keys(inputsOf(mixed, "tools").files), ["go.mod"]);
  assert.equal(selectGoWorkspace(path.join(mixed, "tools"), mixed).file, null);
  assert.equal(goworkOf(mixed, "tools"), "off");

  assert.equal(go.runtimeBinding({ dependency: { status: "none" } }).env.GOWORK, "off");
});

test("a change to any workspace input changes the member's measured identity", async () => {
  const root = await checkout("identity");
  let previous = inputsOf(root, "app").inputs_digest;
  const changed = (label, mutate) => {
    mutate();
    const current = inputsOf(root, "app").inputs_digest;
    assert.notEqual(current, previous, label);
    previous = current;
  };
  changed("go.work", () => appendFileSync(path.join(root, "go.work"), "// edited\n"));
  changed("go.work.sum", () => appendFileSync(path.join(root, "go.work.sum"), "example.com/more v1.0.0 h1:x\n"));
  changed("a sibling member's go.mod", () => appendFileSync(path.join(root, "lib/go.mod"), "// edited\n"));
  changed("a sibling member gaining go.sum", () => writeFileSync(path.join(root, "lib/go.sum"), "sum\n"));
  changed("a workspace replacement's go.mod",
    () => appendFileSync(path.join(root, "third_party/patched/go.mod"), "// edited\n"));
  changed("a member replacement's go.mod",
    () => appendFileSync(path.join(root, "forks/forked/go.mod"), "// edited\n"));
  changed("a member leaving the checkout", () => rmSync(path.join(root, "lib"), { recursive: true }));

  changed("the module no longer being used",
    () => writeFileSync(path.join(root, "go.work"), "go 1.26\n\nuse ./lib\n"));
  assert.deepEqual(Object.keys(inputsOf(root, "app").files).sort(), ["go.mod", "go.sum"]);

  const tools = await checkout("identity-unused");
  const before = inputsOf(tools, "tools").inputs_digest;
  appendFileSync(path.join(tools, "go.work"), "// edited\n");
  assert.equal(inputsOf(tools, "tools").inputs_digest, before);
});

test("a reference that names no module of the checkout is reported and the workspace stays selected",
  async () => {
    const root = await checkout("invalid", { ...WORKSPACE,
      "go.work": "go 1.26\n\nuse (\n\t./app\n\t./gone\n\t../outside\n)\n\nreplace example.com/patched => ./absent\n",
      "app/go.mod": MODULE("app", "\nreplace example.com/forked => /elsewhere/forked\n") });
    const workFile = path.join(root, "go.work");
    const selected = selectGoWorkspace(path.join(root, "app"), root);
    assert.equal(selected.file, workFile);
    assert.deepEqual(selected.invalid, [
      { reference: "/elsewhere/forked", declared_in: path.join(root, "app/go.mod"),
        directory: "/elsewhere/forked", reason: GO_WORKSPACE_REFERENCE_REASONS.OUTSIDE_CHECKOUT },
      { reference: "./gone", declared_in: workFile, directory: path.join(root, "gone"),
        reason: GO_WORKSPACE_REFERENCE_REASONS.MODULE_MISSING },
      { reference: "../outside", declared_in: workFile, directory: path.resolve(root, "../outside"),
        reason: GO_WORKSPACE_REFERENCE_REASONS.OUTSIDE_CHECKOUT },
      { reference: "./absent", declared_in: workFile, directory: path.join(root, "absent"),
        reason: GO_WORKSPACE_REFERENCE_REASONS.MODULE_MISSING }]);

    assert.deepEqual(Object.keys(inputsOf(root, "app").files).sort(),
      ["../go.work", "../go.work.sum", "go.mod", "go.sum"]);
    assert.equal(goworkOf(root, "app"), workFile);
  });
