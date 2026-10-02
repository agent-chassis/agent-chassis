

import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, utimesSync,
  writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { runConfinedInvocation } from
  "../../packages/agent-launch-cli/src/lib/test-execution/confined-invocation.mjs";
import { copySelectedSource } from "../../packages/agent-launch-cli/src/lib/test-execution/source-copy.mjs";
import { NATIVE_COMPILER_CACHE_RELATIVE_PATH, nativeCompilerCachePath, openNativeCompilerCache } from
  "../../packages/agent-launch-cli/src/lib/test-execution/runtime-inputs.mjs";
import goTest from "../../packages/agent-launch-cli/src/lib/test-execution/runner-integrations/go-test.mjs";
import cargoTest from
  "../../packages/agent-launch-cli/src/lib/test-execution/runner-integrations/cargo-test.mjs";
import vitestIntegration from
  "../../packages/agent-launch-cli/src/lib/test-execution/runner-integrations/vitest.mjs";
import vitestProvider from "../../packages/agent-launch-cli/src/lib/test-execution/proof-providers/vitest.mjs";
import { DEPENDENCY_ECOSYSTEMS } from "../../packages/agent-launch-cli/src/lib/test-runtime-setup/ecosystems.mjs";
import { createTestFixture } from "../helpers/test-fixture.mjs";

const ignoredGit = () => ({ ok: true, status: 0, stdout: "", stderr: "" });

async function repository(t) {
  const fixture = await createTestFixture({ prefix: "native-compiler-cache-" });
  t.after(() => fixture.dispose());
  const repo = path.join(fixture.rootPath, "repo");
  mkdirSync(repo);
  return { root: fixture.rootPath, repo };
}

test("the launcher selects and creates one real cache directory per native cache", async (t) => {
  const { repo } = await repository(t);
  const directory = nativeCompilerCachePath(repo, "go-build");
  assert.equal(directory, path.join(repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH, "go-build"));
  assert.equal(openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: repo, directory }), directory);
  assert.ok(lstatSync(directory).isDirectory());

  writeFileSync(path.join(directory, "entry-a"), "compiler state");
  assert.equal(openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: repo, directory }), directory);
  assert.equal(readFileSync(path.join(directory, "entry-a"), "utf8"), "compiler state");
  for (const name of ["", "../escape", "Go", "a/b", ".hidden"]) {
    assert.throws(() => nativeCompilerCachePath(repo, name), /invalid native compiler cache name/u);
  }
});

test("a cache Git does not ignore is refused before it is created, with setup as its recovery", async (t) => {
  const { repo } = await repository(t);
  const asked = [];
  const notIgnored = (repository, args) => { asked.push([repository, args]); return { ok: false, status: 1 }; };
  const directory = nativeCompilerCachePath(repo, "cargo-target");
  assert.throws(() => openNativeCompilerCache({ repositoryRoot: repo, directory, runGit: notIgnored }),
    (error) => error.code === "test_proof_native_compiler_cache_not_excluded" &&
      /rerun local test-runtime setup/u.test(error.detail.recovery));
  assert.deepEqual(asked, [[repo, ["check-ignore", "-q", "--", ".cache/test-proof-native/cargo-target/"]]]);
  assert.equal(existsSync(path.join(repo, ".cache")), false, "nothing is created");
});

test("a redirected, escaping or non-directory cache location is refused, never followed", async (t) => {
  const refused = { code: "test_proof_native_compiler_cache_unavailable" };
  const redirectedRoot = await repository(t);
  const outside = path.join(redirectedRoot.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(redirectedRoot.repo, ".cache"));
  assert.throws(() => openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: redirectedRoot.repo,
    directory: nativeCompilerCachePath(redirectedRoot.repo, "go-build") }), refused);
  assert.equal(existsSync(path.join(outside, "test-proof-native")), false, "nothing is created through the link");

  const redirectedLeaf = await repository(t);
  mkdirSync(path.join(redirectedLeaf.repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH), { recursive: true });
  symlinkSync(outside, path.join(redirectedLeaf.repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH, "cargo-target"));
  assert.throws(() => openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: redirectedLeaf.repo,
    directory: nativeCompilerCachePath(redirectedLeaf.repo, "cargo-target") }), refused);

  const occupied = await repository(t);
  mkdirSync(path.join(occupied.repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH), { recursive: true });
  writeFileSync(path.join(occupied.repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH, "deno-dir"), "");
  assert.throws(() => openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: occupied.repo,
    directory: nativeCompilerCachePath(occupied.repo, "deno-dir") }), refused);

  for (const directory of [path.join(occupied.repo, ".cache", "elsewhere"), outside,
    path.join(occupied.repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH, "go-build", "nested")]) {
    assert.throws(() => openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: occupied.repo, directory }), refused);
  }
});

test("Deno's dependency stores are linked into its persistent DENO_DIR and re-pointed when changed", async (t) => {
  const { root, repo } = await repository(t);
  const { deno: ecosystem } = DEPENDENCY_ECOSYSTEMS;
  assert.equal(ecosystem.compilerCacheEnv, "DENO_DIR");
  const operator = path.join(root, "operator-deno");
  const dependency = { status: "present", source: "deno_dir", dir: operator,
    population: [`${operator}/remote`, `${operator}/npm`] };
  const name = ecosystem.compilerCacheName(dependency);
  assert.match(name, /^deno-dir-[0-9a-f]{16}$/u, "one directory per operator dependency cache");
  assert.notEqual(name, ecosystem.compilerCacheName({ ...dependency, dir: `${operator}-other` }));
  const directory = nativeCompilerCachePath(repo, name);
  const bound = ecosystem.runtimeBinding({ dependency, compilerCache: directory });

  assert.deepEqual(bound.binds, dependency.population.map((store) => ({ src: store, dst: store })));
  assert.deepEqual(bound.env, { DENO_DIR: directory, DENO_NO_UPDATE_CHECK: "1", NO_COLOR: "1" });
  assert.deepEqual(bound.cacheLinks, [{ path: path.join(directory, "remote"), target: `${operator}/remote` },
    { path: path.join(directory, "npm"), target: `${operator}/npm` }]);
  openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: repo, directory, links: bound.cacheLinks });
  assert.equal(readlinkSync(path.join(directory, "remote")), `${operator}/remote`);

  const npm = path.join(directory, "npm");
  rmSync(npm);
  mkdirSync(npm);
  openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: repo, directory, links: bound.cacheLinks });
  assert.equal(readlinkSync(npm), `${operator}/npm`);

  const ordinary = ecosystem.runtimeBinding({ scratchRoot: "/tmp/proof/stage", dependency });
  assert.deepEqual([ordinary.binds, ordinary.env.DENO_DIR], [[{ src: operator, dst: operator }], operator]);
  const free = ecosystem.runtimeBinding({ scratchRoot: "/tmp/proof/stage", dependency: { status: "none" } });
  assert.deepEqual([free.binds, free.env.DENO_DIR], [[], "/tmp/proof/stage/deno-dir"]);
});

test("each caching ecosystem names its native cache; runner commands keep fresh test execution", () => {
  assert.equal(DEPENDENCY_ECOSYSTEMS.go_modules.compilerCacheEnv, "GOCACHE");
  assert.equal(DEPENDENCY_ECOSYSTEMS.go_modules.compilerCacheName(), "go-build");
  assert.equal(DEPENDENCY_ECOSYSTEMS.cargo.compilerCacheEnv, "CARGO_TARGET_DIR");
  assert.equal(DEPENDENCY_ECOSYSTEMS.cargo.compilerCacheName(), "cargo-target");
  assert.equal(DEPENDENCY_ECOSYSTEMS.npm.compilerCacheEnv, undefined, "npm runners name their own cache");
  assert.equal(vitestIntegration.compilerCache, "vitest-module-cache");
  const runtime = { executables: { go: "/toolchain/go/bin/go", cargo: "/toolchain/rust/bin/cargo",
    rustc: "/toolchain/rust/bin/rustc" } };
  const go = goTest.invocation({ runtime, projectDir: "/work/go", packagePath: "./calc", testName: "TestAnswer" });
  assert.deepEqual(go.args.slice(0, 2), ["test", "-count=1"], "Go never reuses a cached test result");
  const cargo = cargoTest.invocation({ runtime, projectDir: "/work/rust", target: { kind: "lib" },
    exactName: "returns_42" });
  assert.ok(cargo.args.includes("--message-format=json"), "Cargo reports its per-unit freshness natively");
  for (const integration of [goTest, cargoTest, vitestIntegration]) {
    assert.equal(integration.compileOnly, undefined, "no separate compile-only seed build");
  }
});

test("a working copy gets fresh timestamps", async (t) => {
  const { root } = await repository(t);
  const source = path.join(root, "source");
  mkdirSync(source);
  writeFileSync(path.join(source, "lib.rs"), "pub fn answer() -> u32 { 42 }\n");
  const old = new Date("2001-01-01T00:00:00Z");
  utimesSync(path.join(source, "lib.rs"), old, old);
  copySelectedSource({ from: source, to: path.join(root, "copy"), entries: ["lib.rs"] });
  assert.notEqual(statSync(path.join(root, "copy", "lib.rs")).mtime.getTime(), old.getTime());
});

test("the confined invocation adds exactly the selected cache as a writable runtime root", async (t) => {
  const { repo } = await repository(t);
  mkdirSync(path.join(repo, ".agent-launch"));
  const directory = openNativeCompilerCache({ runGit: ignoredGit, repositoryRoot: repo,
    directory: nativeCompilerCachePath(repo, "go-build") });
  const planned = [];
  const planner = (options) => {
    planned.push(options);
    throw Object.assign(new Error("planned"), { code: "planner_recorded" });
  };
  const invoke = (invocation) => runConfinedInvocation({ checkout: repo,
    runtime: { env: { PATH: "/usr/bin" }, binds: [] },
    invocation: { command: "/bin/true", args: [], cwd: "/", ...invocation },
    timeoutMs: 1000, buildBubblewrapLaunchPlan: planner });
  const cached = await invoke({ writableCache: directory });
  assert.equal(cached.status, "plan_failed");
  assert.equal(cached.error.code, "planner_recorded", "the injected planner received the plan");
  assert.deepEqual(planned[0].runtimeRoots, [directory]);
  assert.equal(planned[0].shareNet, false, "the network stays denied");
  assert.deepEqual(planned[0].maskTmpfsDirs, [path.join(repo, ".agent-launch")], "the secret masks stay");
  const plain = await invoke({});
  assert.equal(plain.status, "plan_failed");
  assert.equal(planned[1].runtimeRoots, undefined, "no cache, no additional writable root");

  const linked = path.join(repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH, "linked");
  symlinkSync(directory, linked);
  for (const writableCache of [linked, path.join(repo, NATIVE_COMPILER_CACHE_RELATIVE_PATH, "absent"), repo,
    `${directory}/../go-build`, 42]) {
    const refused = await invoke({ writableCache });
    assert.deepEqual([refused.status, refused.code], ["plan_failed", "validation_plan_build_failed"],
      JSON.stringify(writableCache));
  }
  assert.equal(planned.length, 2);
});

test("the Vitest assets are the loaded package's observers and cover their own import closure", () => {
  const { assets } = vitestProvider.describe();
  const observers = path.dirname(assets[0]);
  assert.equal(observers, path.resolve(import.meta.dirname,
    "../../packages/agent-launch-cli/src/lib/test-execution/observers"), "resolved from the loaded package");
  for (const name of ["vitest-entry.mjs", "vitest-config.mjs", "vitest-runner.mjs", "native-channel.cjs"]) {
    assert.ok(assets.includes(path.join(observers, name)), `${name} is a mounted, digested provider asset`);
  }

  for (const asset of assets.filter((file) => path.dirname(file) === observers)) {
    for (const [, relative] of readFileSync(asset, "utf8").matchAll(/["'](\.\/[^"']+\.(?:mjs|cjs|js))["']/gu)) {
      assert.ok(assets.includes(path.join(observers, relative)), `${path.basename(asset)} loads ${relative}`);
    }
  }
});
