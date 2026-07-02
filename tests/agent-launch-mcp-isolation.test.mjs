

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  buildBubblewrapLaunchPlan
} from "../packages/agent-launch-cli/src/lib/launch-isolation.mjs";
import {
  MCP_SANDBOX_CAPABILITIES,
  MCP_SANDBOX_PATH_CLASSES,
  MCP_SANDBOX_RUNTIME_BLOCKER_CODES,
  McpSandboxProfileError,
  assertMcpSandboxWriteAllowed,
  buildMcpSandboxProfileMountPlan,
  buildOrchestratorMcpSandboxProfileRequest,
  classifyMcpSandboxWriteFailure
} from "../packages/agent-launch-cli/src/lib/mcp-sandbox-profile.mjs";

const CODES = BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES;
const GENERATED_PACKAGE_README_FILES = Object.freeze([
  "packages/agent-launch-cli/README.md",
  "packages/agent-launch-core/README.md",
  "packages/wiki-cli/README.md",
  "packages/wiki-core/README.md",
  "packages/wiki-core/data/README.md",
  "packages/wiki-mcp/README.md"
]);

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "agent-launch-mcp-"));
  const repo = path.join(root, "agent-chassis");
  const wikiMcp = path.join(repo, "packages", "wiki-mcp", "src");
  const externalRepo = path.join(root, "node-engine");
  const codexHome = path.join(root, "codex-home");
  mkdirSync(wikiMcp, { recursive: true });
  mkdirSync(path.join(externalRepo, "wiki"), { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(path.join(repo, "package.json"), "{}\n");
  writeFileSync(path.join(wikiMcp, "server.mjs"), "console.log('wiki mcp');\n");
  writeFileSync(path.join(externalRepo, "wiki", "catalog.md"), "# node-engine\n");
  return { root, repo, externalRepo, codexHome, wikiMcpServer: path.join(wikiMcp, "server.mjs") };
}

function writeCodexConfig(codexHome, text) {
  writeFileSync(path.join(codexHome, "config.toml"), text);
}

function planFor(fixture, extraEnv = {}) {
  return buildBubblewrapLaunchPlan({
    repo: fixture.repo,
    command: "/bin/sh",
    args: ["-lc", "true"],
    cwd: fixture.repo,
    env: {
      HOME: path.dirname(fixture.codexHome),
      CODEX_HOME: fixture.codexHome,
      PATH: process.env.PATH || "/usr/bin:/bin",
      ...extraEnv
    },
    writableRoots: [],
    runtimeRoots: [],
    readOnlyRoots: [],
    homePolicy: null
  });
}

function writeGeneratedPackageReadmes(repo) {
  for (const repoRelativePath of GENERATED_PACKAGE_README_FILES) {
    const absolutePath = path.join(repo, repoRelativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, "# generated\n");
  }
}

function writeMcpCacheDirs(repo) {
  mkdirSync(path.join(repo, ".cache", "wiki-search"), { recursive: true });
  mkdirSync(path.join(repo, ".cache", "repo-code-index"), { recursive: true });
}

function buildCompleteOrchestratorMcpPlan(repo) {
  return buildBubblewrapLaunchPlan({
    repo,
    command: "/bin/sh",
    args: ["-lc", "true"],
    cwd: repo,
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin"
    },
    writableRoots: [],
    runtimeRoots: [],
    readOnlyRoots: [],
    mcpSandboxProfile: {
      launcherRole: "orchestrator",
      capabilities: [
        MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
        MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
        MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
      ]
    },
    homePolicy: null
  });
}

function assertRoBind(plan, hostPath) {
  const real = realpathSync(hostPath);
  assert.ok(
    plan.bwrapArgs.some((arg, idx, arr) =>
      arg === "--ro-bind" && arr[idx + 1] === real && arr[idx + 2] === real
    ),
    `expected --ro-bind ${real} ${real}`
  );
}

function assertNoBindPrefix(plan, prefix) {
  const realPrefix = realpathSync(prefix);
  for (let i = 0; i < plan.bwrapArgs.length; i += 1) {
    const flag = plan.bwrapArgs[i];
    if (flag !== "--bind" && flag !== "--ro-bind" && flag !== "--ro-bind-try") continue;
    const src = plan.bwrapArgs[i + 1];
    assert.notEqual(src, realPrefix, `must not bind broad path ${realPrefix}`);
  }
}

function assertRwBind(plan, hostPath) {
  const real = realpathSync(hostPath);
  assert.ok(
    plan.bwrapArgs.some((arg, idx, arr) =>
      arg === "--bind" && arr[idx + 1] === real && arr[idx + 2] === real
    ),
    `expected --bind ${real} ${real}`
  );
}

function assertNoRwBind(plan, hostPath) {
  const real = realpathSync(hostPath);
  assert.ok(
    !plan.bwrapArgs.some((arg, idx, arr) =>
      arg === "--bind" && arr[idx + 1] === real && arr[idx + 2] === real
    ),
    `must not --bind ${real} ${real}`
  );
}

function expectIsolationError(fn, expectedCode) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof BubblewrapIsolationError, `unexpected error: ${err?.stack || err}`);
    assert.equal(err.code, expectedCode);
    return err;
  }
  assert.fail(`expected BubblewrapIsolationError ${expectedCode}`);
  return null;
}

function expectProfileDenial(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof McpSandboxProfileError, `unexpected error: ${err?.stack || err}`);
    assert.equal(err.code, MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL);
    assert.equal(
      err.detail.runtime_blocker_code,
      MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL
    );
    return err;
  }
  assert.fail("expected McpSandboxProfileError sandbox_write_denial");
  return null;
}

function pathClassesForMissingCapabilities(missingCapabilities) {
  return missingCapabilities.flatMap((capability) => ({
    [MCP_SANDBOX_CAPABILITIES.CACHE_WRITE]: [
      MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
      MCP_SANDBOX_PATH_CLASSES.REPO_CODE_INDEX_CACHE
    ],
    [MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE]: [
      MCP_SANDBOX_PATH_CLASSES.MCP_RUNTIME_STATE
    ],
    [MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE]: [
      MCP_SANDBOX_PATH_CLASSES.GENERATED_PACKAGE_README_PROJECTIONS
    ]
  })[capability] ?? []);
}

function assertMissingCapabilityContext(err, missingCapabilities) {
  const missingPathClasses = pathClassesForMissingCapabilities(missingCapabilities);
  assert.equal(err.detail.reason, "missing_capability");
  assert.equal(err.detail.launcher_role, "orchestrator");
  assert.equal(err.detail.capability, missingCapabilities[0]);
  assert.equal(err.detail.path_class, missingPathClasses[0]);
  assert.deepEqual([...err.detail.required_capabilities], [
    MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
    MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
    MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
  ]);
  assert.deepEqual([...err.detail.missing_capabilities], missingCapabilities);
  assert.deepEqual([...err.detail.missing_path_classes], missingPathClasses);
}

function assertAllCapabilitiesMissingContext(err) {
  assert.equal(err.detail.reason, "missing_capability");
  assert.equal(err.detail.launcher_role, "orchestrator");
  assert.equal(err.detail.capability, MCP_SANDBOX_CAPABILITIES.CACHE_WRITE);
  assert.equal(err.detail.path_class, MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE);
  assert.deepEqual([...err.detail.required_capabilities], [
    MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
    MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
    MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
  ]);
  assert.deepEqual([...err.detail.requested_capabilities], []);
  assert.deepEqual([...err.detail.missing_capabilities], [
    MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
    MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
    MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
  ]);
  assert.deepEqual([...err.detail.missing_path_classes], [
    MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
    MCP_SANDBOX_PATH_CLASSES.REPO_CODE_INDEX_CACHE,
    MCP_SANDBOX_PATH_CLASSES.MCP_RUNTIME_STATE,
    MCP_SANDBOX_PATH_CLASSES.GENERATED_PACKAGE_README_PROJECTIONS
  ]);
}

test("Codex MCP WIKI_MCP_REPOS entries are exposed as explicit read-only roots", () => {
  const fixture = makeFixture();
  try {
    writeCodexConfig(fixture.codexHome, `
[mcp_servers.wiki]
command = "node"
args = ["${fixture.wikiMcpServer}"]

[mcp_servers.wiki.env]
WIKI_MCP_REPOS = "{\\"node-engine\\":\\"${fixture.externalRepo}\\",\\"agent-chassis\\":\\"${fixture.repo}\\"}"
`);
    const plan = planFor(fixture);
    assertRoBind(plan, fixture.externalRepo);
    assert.ok(!plan.readOnlyRoots.some((entry) => entry.src === realpathSync(fixture.repo)));
    assert.equal(plan.writableRoots.length, 0);
    assert.equal(plan.runtimeRoots.length, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Codex MCP absolute command outside system roots exposes its package root read-only", () => {
  const fixture = makeFixture();
  try {
    const packageRoot = path.join(fixture.root, "mcp-package");
    const binDir = path.join(packageRoot, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(packageRoot, "package.json"), "{}\n");
    const command = path.join(binDir, "server.js");
    writeFileSync(command, "#!/usr/bin/env node\nconsole.log('mcp');\n");
    chmodSync(command, 0o755);
    writeCodexConfig(fixture.codexHome, `
[mcp_servers.local]
command = "${command}"
`);
    const plan = planFor(fixture);
    assertRoBind(plan, packageRoot);
    assertNoBindPrefix(plan, fixture.codexHome);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Codex MCP config with stale repo path refuses fail-closed", () => {
  const fixture = makeFixture();
  try {
    const missing = path.join(fixture.root, "missing-repo");
    writeCodexConfig(fixture.codexHome, `
[mcp_servers.wiki]
command = "node"

[mcp_servers.wiki.env]
WIKI_MCP_REPOS = "{\\"missing\\":\\"${missing}\\"}"
`);
    expectIsolationError(() => planFor(fixture), CODES.PATH_MISSING_PARENT);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Codex MCP config with malformed WIKI_MCP_REPOS refuses fail-closed", () => {
  const fixture = makeFixture();
  try {
    writeCodexConfig(fixture.codexHome, `
[mcp_servers.wiki]
command = "node"

[mcp_servers.wiki.env]
WIKI_MCP_REPOS = "{not-json"
`);
    expectIsolationError(() => planFor(fixture), CODES.ENV_INVALID);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-0743 isolation accepts current repo omitted from WIKI_MCP_REPOS", () => {

  const fixture = makeFixture();
  try {

    writeCodexConfig(fixture.codexHome, `
[mcp_servers.wiki]
command = "node"
args = ["${fixture.wikiMcpServer}"]

[mcp_servers.wiki.env]
WIKI_MCP_REPOS = "{\\"node-engine\\":\\"${fixture.externalRepo}\\"}"
`);
    const plan = planFor(fixture);
    assertRoBind(plan, fixture.externalRepo);

    assert.ok(
      !plan.readOnlyRoots.some((entry) => entry.src === realpathSync(fixture.repo)),
      "current repo must not be added as an extra MCP read-only root"
    );

    writeCodexConfig(fixture.codexHome, `
[mcp_servers.wiki]
command = "node"

[mcp_servers.wiki.env]
WIKI_MCP_REPOS = "not-valid-json"
`);
    expectIsolationError(() => planFor(fixture), CODES.ENV_INVALID);

    const missing = path.join(fixture.root, "does-not-exist");
    writeCodexConfig(fixture.codexHome, `
[mcp_servers.wiki]
command = "node"

[mcp_servers.wiki.env]
WIKI_MCP_REPOS = "{\\"missing\\":\\"${missing}\\"}"
`);
    expectIsolationError(() => planFor(fixture), CODES.PATH_MISSING_PARENT);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1128/WK-1308 complete orchestrator MCP sandbox capabilities grant only declared path classes", () => {
  const fixture = makeFixture();
  try {
    const cacheDir = path.join(fixture.repo, ".cache");
    const wikiSearchDir = path.join(cacheDir, "wiki-search");
    const repoCodeIndexDir = path.join(cacheDir, "repo-code-index");
    const otherCacheDir = path.join(cacheDir, "other");
    const docsDir = path.join(fixture.repo, "docs");
    const wikiDir = path.join(fixture.repo, "wiki");
    mkdirSync(wikiSearchDir, { recursive: true });
    mkdirSync(repoCodeIndexDir, { recursive: true });
    mkdirSync(otherCacheDir, { recursive: true });
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(wikiDir, { recursive: true });
    writeGeneratedPackageReadmes(fixture.repo);
    writeFileSync(path.join(fixture.repo, "packages", "wiki-core", "package.json"), "{}\n");

    const plan = buildBubblewrapLaunchPlan({
      repo: fixture.repo,
      command: "/bin/sh",
      args: ["-lc", "true"],
      cwd: fixture.repo,
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin"
      },
      writableRoots: [],
      runtimeRoots: [],
      readOnlyRoots: [],
      mcpSandboxProfile: {
        launcherRole: "orchestrator",
        capabilities: [
          MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
          MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
          MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
        ]
      },
      homePolicy: null
    });

    assert.deepEqual([...plan.mcpSandboxProfile.grantedCapabilities], [
      MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
      MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
    ]);
    assert.deepEqual([...plan.mcpSandboxProfile.requestedCapabilities], [
      MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
      MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
    ]);
    assert.deepEqual([...plan.mcpSandboxProfile.fixedPathClasses], [
      MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
      MCP_SANDBOX_PATH_CLASSES.REPO_CODE_INDEX_CACHE
    ]);
    assert.deepEqual([...plan.mcpSandboxProfile.exactFilePathClasses], [
      MCP_SANDBOX_PATH_CLASSES.GENERATED_PACKAGE_README_PROJECTIONS
    ]);
    assert.deepEqual([...plan.mcpSandboxProfile.runtimePathClasses], [
      MCP_SANDBOX_PATH_CLASSES.MCP_RUNTIME_STATE
    ]);
    assert.deepEqual([...plan.writableRoots], [wikiSearchDir, repoCodeIndexDir]);
    assertRwBind(plan, wikiSearchDir);
    assertRwBind(plan, repoCodeIndexDir);
    const expectedReadmeFiles = GENERATED_PACKAGE_README_FILES.map((repoRelativePath) =>
      realpathSync(path.join(fixture.repo, repoRelativePath))
    );
    assert.deepEqual([...plan.mcpSandboxProfile.writableFiles].sort(), expectedReadmeFiles.sort());
    assert.deepEqual(plan.writableFiles.map((entry) => entry.real).sort(), expectedReadmeFiles.sort());
    for (const readmePath of expectedReadmeFiles) {
      assertRwBind(plan, readmePath);
    }
    for (const packageDir of [...new Set(
      GENERATED_PACKAGE_README_FILES.map((repoRelativePath) => path.dirname(repoRelativePath))
    )]) {
      assertNoRwBind(plan, path.join(fixture.repo, packageDir));
    }
    assertNoBindPrefix(plan, cacheDir);
    assertNoRwBind(plan, otherCacheDir);
    assertNoRwBind(plan, docsDir);
    assertNoRwBind(plan, wikiDir);
    assertNoRwBind(plan, path.join(fixture.repo, "packages", "wiki-core", "package.json"));
    for (const candidatePath of [
      "packages/wiki-core/package.json",
      "packages/wiki-core/data/README.generated.md",
      "packages/wiki-mcp"
    ]) {
      assert.throws(
        () => assertMcpSandboxWriteAllowed({
          launcherRole: "orchestrator",
          capability: MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE,
          pathClass: MCP_SANDBOX_PATH_CLASSES.GENERATED_PACKAGE_README_PROJECTIONS,
          repo: fixture.repo,
          candidatePath
        }),
        (err) => {
          assert.ok(err instanceof McpSandboxProfileError, `${candidatePath}: expected McpSandboxProfileError`);
          assert.equal(err.code, MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL);
          assert.equal(err.detail.reason, "path_outside_class");
          return true;
        },
        `${candidatePath} must be denied`
      );
    }
    assert.deepEqual([...plan.runtimeRoots], []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1308 remediation omits generated package README binds when portfolio package parents are absent", () => {
  const fixture = makeFixture();
  try {
    writeMcpCacheDirs(fixture.externalRepo);

    let plan = null;
    assert.doesNotThrow(() => {
      plan = buildCompleteOrchestratorMcpPlan(fixture.externalRepo);
    });

    assert.deepEqual([...plan.mcpSandboxProfile.exactFilePathClasses], [
      MCP_SANDBOX_PATH_CLASSES.GENERATED_PACKAGE_README_PROJECTIONS
    ]);
    assert.deepEqual([...plan.mcpSandboxProfile.writableFiles], []);
    assert.deepEqual([...plan.writableFiles], []);
    assert.deepEqual([...plan.writableRoots], [
      path.join(fixture.externalRepo, ".cache", "wiki-search"),
      path.join(fixture.externalRepo, ".cache", "repo-code-index")
    ]);
    assert.ok(
      !plan.bwrapArgs.some((arg) => arg.includes("/packages/agent-launch-cli/README.md")),
      "must not emit a missing generated package README bind"
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1308 remediation emits only generated package README files whose parents exist", () => {
  const fixture = makeFixture();
  try {
    writeMcpCacheDirs(fixture.externalRepo);
    const packagesDir = path.join(fixture.externalRepo, "packages");
    const wikiCoreDir = path.join(packagesDir, "wiki-core");
    const wikiCoreDataDir = path.join(wikiCoreDir, "data");
    mkdirSync(wikiCoreDataDir, { recursive: true });
    writeFileSync(path.join(wikiCoreDir, "package.json"), "{}\n");

    const plan = buildCompleteOrchestratorMcpPlan(fixture.externalRepo);
    const expectedReadmeFiles = [
      path.join(wikiCoreDir, "README.md"),
      path.join(wikiCoreDataDir, "README.md")
    ];

    assert.deepEqual([...plan.mcpSandboxProfile.writableFiles].sort(), expectedReadmeFiles.sort());
    assert.deepEqual(plan.writableFiles.map((entry) => entry.real).sort(), expectedReadmeFiles.sort());
    assert.deepEqual(
      plan.writableFiles.map((entry) => entry.precreated),
      [true, true]
    );
    for (const readmePath of expectedReadmeFiles) {
      assertRwBind(plan, readmePath);
    }
    assertNoRwBind(plan, packagesDir);
    assertNoRwBind(plan, wikiCoreDir);
    assertNoRwBind(plan, wikiCoreDataDir);
    assertNoRwBind(plan, path.join(wikiCoreDir, "package.json"));
    assert.ok(
      !plan.mcpSandboxProfile.writableFiles.some((file) =>
        file.includes("/packages/agent-launch-cli/README.md") ||
        file.includes("/packages/wiki-mcp/README.md")
      ),
      "must not emit generated package README binds for absent package parents"
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1128 SLICE-008 partial mcp_cache_write capability fails closed with sandbox_write_denial", () => {
  const fixture = makeFixture();
  try {
    const err = expectProfileDenial(() => buildMcpSandboxProfileMountPlan({
      repo: fixture.repo,
      launcherRole: "orchestrator",
      capabilities: [MCP_SANDBOX_CAPABILITIES.CACHE_WRITE]
    }));
    assertMissingCapabilityContext(err, [
      MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
      MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
    ]);
    assert.deepEqual([...err.detail.requested_capabilities], [
      MCP_SANDBOX_CAPABILITIES.CACHE_WRITE
    ]);

    const isolationErr = expectIsolationError(
      () => buildBubblewrapLaunchPlan({
        repo: fixture.repo,
        command: "/bin/sh",
        args: ["-lc", "true"],
        env: { PATH: process.env.PATH || "/usr/bin:/bin" },
        mcpSandboxProfile: {
          launcherRole: "orchestrator",
          capabilities: [MCP_SANDBOX_CAPABILITIES.CACHE_WRITE]
        }
      }),
      CODES.SANDBOX_WRITE_DENIAL
    );
    assertMissingCapabilityContext(isolationErr, [
      MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
      MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1128 SLICE-008 partial mcp_runtime_state_write capability fails closed with sandbox_write_denial", () => {
  const fixture = makeFixture();
  try {
    const err = expectProfileDenial(() => buildMcpSandboxProfileMountPlan({
      repo: fixture.repo,
      launcherRole: "orchestrator",
      capabilities: [MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE]
    }));
    assertMissingCapabilityContext(err, [
      MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
    ]);
    assert.deepEqual([...err.detail.requested_capabilities], [
      MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE
    ]);

    const isolationErr = expectIsolationError(
      () => buildBubblewrapLaunchPlan({
        repo: fixture.repo,
        command: "/bin/sh",
        args: ["-lc", "true"],
        env: { PATH: process.env.PATH || "/usr/bin:/bin" },
        mcpSandboxProfile: {
          launcherRole: "orchestrator",
          capabilities: [MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE]
        }
      }),
      CODES.SANDBOX_WRITE_DENIAL
    );
    assertMissingCapabilityContext(isolationErr, [
      MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1128 SLICE-008 omitted capability, null, and empty capabilities fail closed with sandbox_write_denial", () => {
  const fixture = makeFixture();
  try {
    for (const entry of [
      { label: "omitted", request: { launcherRole: "orchestrator" } },
      { label: "null", request: { launcherRole: "orchestrator", capabilities: null } },
      { label: "undefined", request: { launcherRole: "orchestrator", capabilities: undefined } },
      { label: "empty", request: { launcherRole: "orchestrator", capabilities: [] } }
    ]) {
      const profileErr = expectProfileDenial(() => buildMcpSandboxProfileMountPlan({
        repo: fixture.repo,
        ...entry.request
      }));
      assertAllCapabilitiesMissingContext(profileErr);
    }

    const err = expectIsolationError(
      () => buildBubblewrapLaunchPlan({
        repo: fixture.repo,
        command: "/bin/sh",
        args: ["-lc", "true"],
        env: { PATH: process.env.PATH || "/usr/bin:/bin" },
        mcpSandboxProfile: {
          launcherRole: "orchestrator"
        }
      }),
      CODES.SANDBOX_WRITE_DENIAL
    );
    assert.equal(
      err.detail.runtime_blocker_code,
      MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL
    );
    assertAllCapabilitiesMissingContext(err);

    const request = buildOrchestratorMcpSandboxProfileRequest();
    assert.deepEqual([...request.capabilities], [
      MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
      MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1128 SLICE-004 caller cacheDir, .cache/other, generated views, and durable docs/wiki paths fail closed outside declared path classes", () => {
  const fixture = makeFixture();
  try {
    const allowedWikiSearch = assertMcpSandboxWriteAllowed({
      launcherRole: "orchestrator",
      capability: MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      pathClass: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
      repo: fixture.repo,
      candidatePath: ".cache/wiki-search/index.json"
    });
    assert.equal(
      allowedWikiSearch.repo_relative_path,
      ".cache/wiki-search/index.json"
    );
    const allowedRepoCodeIndex = assertMcpSandboxWriteAllowed({
      launcherRole: "orchestrator",
      capability: MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      pathClass: MCP_SANDBOX_PATH_CLASSES.REPO_CODE_INDEX_CACHE,
      repo: fixture.repo,
      candidatePath: ".cache/repo-code-index/graph.json"
    });
    assert.equal(
      allowedRepoCodeIndex.repo_relative_path,
      ".cache/repo-code-index/graph.json"
    );

    const denied = [
      {
        label: ".cache/other/**",
        pathClass: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
        candidatePath: ".cache/other/index.json"
      },
      {
        label: "caller-selected code-index cacheDir",
        pathClass: MCP_SANDBOX_PATH_CLASSES.REPO_CODE_INDEX_CACHE,
        candidatePath: ".cache/caller-selected-code-index/graph.json"
      },
      {
        label: "generated wiki view",
        pathClass: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
        candidatePath: "wiki/catalog.md"
      },
      {
        label: "durable wiki source",
        pathClass: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
        candidatePath: "wiki/work-records/WK-1128.json"
      },
      {
        label: "durable docs source",
        pathClass: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
        candidatePath: "docs/mcp-integration.md"
      }
    ];
    for (const entry of denied) {
      assert.throws(
        () => assertMcpSandboxWriteAllowed({
          launcherRole: "orchestrator",
          capability: MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
          pathClass: entry.pathClass,
          repo: fixture.repo,
          candidatePath: entry.candidatePath
        }),
        (err) => {
          assert.ok(err instanceof McpSandboxProfileError, `${entry.label}: expected McpSandboxProfileError`);
          assert.equal(err.code, MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL);
          assert.equal(err.detail.runtime_blocker_code, MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL);
          assert.equal(err.detail.reason, "path_outside_class");
          assert.equal(err.detail.path_class, entry.pathClass);
          return true;
        },
        `${entry.label} must be denied`
      );
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1128 SLICE-004 missing role or missing capability maps to sandbox_write_denial with structured path-class context", () => {
  const fixture = makeFixture();
  try {
    mkdirSync(path.join(fixture.repo, ".cache", "wiki-search"), { recursive: true });
    const roleErr = expectIsolationError(
      () => buildBubblewrapLaunchPlan({
        repo: fixture.repo,
        command: "/bin/sh",
        args: ["-lc", "true"],
        env: { PATH: process.env.PATH || "/usr/bin:/bin" },
        mcpSandboxProfile: {
          launcherRole: "worker",
          capabilities: [MCP_SANDBOX_CAPABILITIES.CACHE_WRITE]
        }
      }),
      CODES.SANDBOX_WRITE_DENIAL
    );
    assert.equal(roleErr.detail.runtime_blocker_code, MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL);
    assert.equal(roleErr.detail.reason, "missing_role");
    assert.equal(roleErr.detail.launcher_role, "worker");

    const capabilityErr = expectIsolationError(
      () => buildBubblewrapLaunchPlan({
        repo: fixture.repo,
        command: "/bin/sh",
        args: ["-lc", "true"],
        env: { PATH: process.env.PATH || "/usr/bin:/bin" },
        mcpSandboxProfile: {
          launcherRole: "orchestrator",
          capabilities: ["mcp_coordination_write"]
        }
      }),
      CODES.SANDBOX_WRITE_DENIAL
    );
    assert.equal(
      capabilityErr.detail.runtime_blocker_code,
      MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL
    );
    assert.equal(capabilityErr.detail.reason, "missing_capability");
    assert.equal(capabilityErr.detail.capability, "mcp_coordination_write");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("WK-1128 SLICE-004 read-only mount failures on expected writable cache paths map to read_only_mount", () => {
  const failedPath = "/repo/.cache/wiki-search/index.json";
  const mapped = classifyMcpSandboxWriteFailure({
    error: { code: "EROFS" },
    failedPath,
    expectedCapability: MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
    pathClass: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE
  });
  assert.deepEqual(mapped, {
    code: MCP_SANDBOX_RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT,
    failed_path: failedPath,
    expected_capability: MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
    path_class: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE
  });
  assert.equal(
    classifyMcpSandboxWriteFailure({
      error: { code: "EACCES" },
      failedPath,
      expectedCapability: MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
      pathClass: MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE
    }),
    null
  );
});
