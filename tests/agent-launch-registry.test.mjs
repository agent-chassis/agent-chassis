import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";

import {
  createDefaultRegistry,
  DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND,
  initializeDefaultRegistry,
  loadRegistry,
  resolveAgentConfig,
  resolveFilesystemMcpBackend
} from "../packages/agent-launch-core/src/lib/registry.mjs";
import {
  LAUNCHER_CONFIG_DIRNAME,
  WORKER_FAMILY_OPERATOR_CONFIG_REFUSAL_REASON,
  WORKER_FAMILY_OPERATOR_CONFIG_RELATIVE_REFUSAL_REASON,
  getLauncherRegistryPath,
  getWorkerFamilyTrustedLauncherConfigDir,
  getWorkerFamilyTrustedLauncherRegistryPath,
  resolveLauncherRegistryPath,
  resolveWorkerFamilyLauncherRegistryPath
} from "../packages/agent-launch-core/src/lib/config.mjs";

const TMP_ROOT = path.join(os.tmpdir(), "agent-launch-registry-tests");

async function withTempWorkspace(fn) {
  await mkdir(TMP_ROOT, { recursive: true });
  const workspaceDir = await mkdtemp(path.join(TMP_ROOT, "workspace-"));
  try {
    return await fn(workspaceDir);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

async function writeRegistryToTempPath(registry) {
  await mkdir(TMP_ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(TMP_ROOT, "registry-"));
  const registryPath = path.join(dir, "launchers.v1.json");
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return { dir, registryPath };
}

function cloneDefaultRegistry() {
  return JSON.parse(JSON.stringify(createDefaultRegistry()));
}

test("createDefaultRegistry seeds claude and codex adapter defaults", () => {
  const registry = createDefaultRegistry();
  assert.equal(registry.schema_version, 1);
  assert.deepEqual(registry.agents.claude.base_argv, ["claude"]);
  assert.deepEqual(registry.agents.claude.instruction_transport, { kind: "argv_content" });
  assert.deepEqual(registry.agents.claude.response_transport, { kind: "stdout_capture" });
  assert.deepEqual(registry.agents.claude.read_only.argv_suffix, [
    "--permission-mode",
    "default",
    "--disallowedTools",
    "Edit Write NotebookEdit Bash"
  ]);
  assert.deepEqual(registry.agents.codex.base_argv, ["codex", "exec"]);
  assert.deepEqual(registry.agents.codex.response_arg, ["-o", "{response_path}"]);
  assert.deepEqual(registry.agents.codex.read_only.argv_suffix, ["--sandbox", "read-only"]);
});

test("createDefaultRegistry seeds an advisory filesystem-MCP backend", () => {
  const registry = createDefaultRegistry();
  assert.equal(typeof registry.filesystem_mcp_backend_default, "string");
  assert.ok(registry.filesystem_mcp_backend_default.length > 0);

  const entry = registry.filesystem_mcp_backends[registry.filesystem_mcp_backend_default];
  assert.ok(entry, "default backend entry must exist");
  assert.equal(entry.mode, "advisory");
  assert.equal(typeof entry.backend_id, "string");
  assert.ok(entry.backend_id.length > 0);
  assert.equal(typeof entry.backend_version, "string");
  assert.ok(entry.backend_version.length > 0);
  assert.equal(entry.endpoint.kind, "spawn");
  assert.ok(Array.isArray(entry.endpoint.argv) && entry.endpoint.argv.length > 0);
  assert.equal(entry.handshake_source.kind, "spawn_stdout");
  assert.ok(Array.isArray(entry.supported_profiles) && entry.supported_profiles.length > 0);
  for (const row of entry.supported_profiles) {
    assert.ok(["claude", "codex", "gemini"].includes(row.agent_family));
    assert.equal(typeof row.profile, "string");
    assert.ok(row.profile.length > 0);
    assert.ok(Array.isArray(row.roles) && row.roles.length > 0);
    for (const role of row.roles) {
      assert.ok(["worker", "code_review", "redteam"].includes(role));
    }
  }
});

test("default filesystem_mcp backend names the repo-owned spawn_stdout endpoint command (WK-0424)", () => {

  const registry = createDefaultRegistry();
  const defaultKey = registry.filesystem_mcp_backend_default;
  const entry = registry.filesystem_mcp_backends[defaultKey];
  assert.equal(entry.endpoint.kind, "spawn");
  assert.deepEqual(entry.endpoint.argv, [
    DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND
  ]);
  assert.equal(entry.handshake_source.kind, "spawn_stdout");
  assert.equal(entry.mode, "advisory");
  assert.equal(entry.backend_id, "agent-launch.filesystem-mcp.default");
});

test("DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND is a non-empty stable string", () => {
  assert.equal(typeof DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND, "string");
  assert.ok(DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND.length > 0);

  assert.equal(
    DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND,
    "agent-launch-filesystem-mcp-backend"
  );
});

test("resolveFilesystemMcpBackend on the default registry returns the repo-owned spawn endpoint", () => {
  const registry = { data: createDefaultRegistry() };
  const resolved = resolveFilesystemMcpBackend(registry);
  assert.equal(resolved.entry.endpoint.kind, "spawn");
  assert.deepEqual(resolved.entry.endpoint.argv, [
    DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND
  ]);
  assert.equal(resolved.entry.handshake_source.kind, "spawn_stdout");
  assert.equal(resolved.entry.mode, "advisory");
});

test("loadRegistry refuses a default backend with an empty spawn argv (advisory or unsafe endpoint refused downstream)", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends.default.endpoint = {
    kind: "spawn",
    argv: []
  };
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /endpoint\.argv must be a non-empty array for spawn endpoints/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry refuses a missing filesystem_mcp_backends map (advisory/missing endpoint refused downstream)", async () => {
  const registry = cloneDefaultRegistry();
  delete registry.filesystem_mcp_backends;
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /filesystem_mcp_backends must be an object map/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveAgentConfig still accepts the default claude/codex entries", () => {
  const registry = { data: createDefaultRegistry() };
  const claude = resolveAgentConfig(registry, "claude", "implement");
  assert.deepEqual(claude.base_argv, ["claude"]);
  const codex = resolveAgentConfig(registry, "codex", "redteam");
  assert.deepEqual(codex.base_argv, ["codex", "exec"]);
});

test("initializeDefaultRegistry writes the workspace-local registry and is idempotent under --force", async () => {
  await withTempWorkspace(async (workspaceDir) => {
    const registryPath = await initializeDefaultRegistry({ workspaceDir });
    assert.equal(
      registryPath,
      path.join(workspaceDir, LAUNCHER_CONFIG_DIRNAME, "launchers.v1.json")
    );
    const initial = JSON.parse(await readFile(registryPath, "utf8"));
    assert.equal(initial.schema_version, 1);
    assert.ok(initial.filesystem_mcp_backends);
    assert.equal(
      initial.filesystem_mcp_backends[initial.filesystem_mcp_backend_default].mode,
      "advisory"
    );

    await assert.rejects(
      () => initializeDefaultRegistry({ workspaceDir }),
      /Launcher registry already exists/
    );

    await initializeDefaultRegistry({ force: true, workspaceDir });
    const reinitialized = JSON.parse(await readFile(registryPath, "utf8"));
    assert.deepEqual(reinitialized, createDefaultRegistry());
  });
});

test("init-config --force round-trips an operator-defined filesystem-MCP backend without dropping it", async () => {
  await withTempWorkspace(async (workspaceDir) => {
    const registryPath = await initializeDefaultRegistry({ workspaceDir });
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    registry.filesystem_mcp_backends["operator-prod"] = {
      backend_id: "operator.filesystem-mcp.prod",
      backend_version: "1.4.2",
      mode: "enforced",
      endpoint: { kind: "unix_socket", path: "/run/agent-launch/fs-mcp.sock" },
      supported_profiles: [
        { agent_family: "claude", profile: "operator-prod", roles: ["worker"] }
      ],
      handshake_source: { kind: "unix_socket_reply" }
    };
    registry.filesystem_mcp_backend_default = "operator-prod";
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

    const loaded = await loadRegistry({ registryPath });
    assert.equal(loaded.data.filesystem_mcp_backend_default, "operator-prod");
    const resolved = resolveFilesystemMcpBackend(loaded);
    assert.equal(resolved.key, "operator-prod");
    assert.equal(resolved.entry.mode, "enforced");
    assert.equal(resolved.entry.endpoint.kind, "unix_socket");

    const explicitDefault = resolveFilesystemMcpBackend(loaded, { key: "default" });
    assert.equal(explicitDefault.entry.mode, "advisory");
  });
});

test("loadRegistry rejects an unsupported schema_version", async () => {
  const { registryPath, dir } = await writeRegistryToTempPath({
    ...createDefaultRegistry(),
    schema_version: 99
  });
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /Unsupported launcher registry schema_version/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects an unknown filesystem_mcp_backend_default key", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backend_default = "does-not-exist";
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /filesystem_mcp_backend_default references unknown backend does-not-exist/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects a backend entry with an invalid mode", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends.default.mode = "permissive";
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /filesystem_mcp_backends\.default\.mode must be one of: advisory, enforced/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects an unsupported endpoint kind", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends.default.endpoint = { kind: "http", url: "http://example/" };
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /endpoint\.kind must be one of: spawn, unix_socket/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects a spawn endpoint with empty argv", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends.default.endpoint = { kind: "spawn", argv: [] };
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /endpoint\.argv must be a non-empty array for spawn endpoints/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects an unsupported handshake_source kind", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends.default.handshake_source = { kind: "env_path" };
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /handshake_source\.kind must be one of: spawn_stdout, unix_socket_reply/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects handshake_source that does not match the endpoint kind", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends.default.endpoint = { kind: "spawn", argv: ["fs-mcp"] };
  registry.filesystem_mcp_backends.default.handshake_source = { kind: "unix_socket_reply" };
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /handshake_source\.kind unix_socket_reply is not compatible with endpoint\.kind spawn/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects malformed supported_profiles rows", async () => {
  for (const [mutate, pattern] of [
    [
      (entry) => {
        entry.supported_profiles = [];
      },
      /supported_profiles must be a non-empty array/
    ],
    [
      (entry) => {
        entry.supported_profiles = [{ agent_family: "ferret", profile: "p", roles: ["worker"] }];
      },
      /agent_family must be one of/
    ],
    [
      (entry) => {
        entry.supported_profiles = [{ agent_family: "claude", profile: "", roles: ["worker"] }];
      },
      /profile must be a non-empty string/
    ],
    [
      (entry) => {
        entry.supported_profiles = [{ agent_family: "claude", profile: "p", roles: [] }];
      },
      /roles must be a non-empty array/
    ],
    [
      (entry) => {
        entry.supported_profiles = [{ agent_family: "claude", profile: "p", roles: ["mascot"] }];
      },
      /roles entries must be one of: worker, code_review, redteam/
    ],
    [
      (entry) => {
        entry.supported_profiles = [
          { agent_family: "claude", profile: "shared", roles: ["worker"] },
          { agent_family: "claude", profile: "shared", roles: ["redteam"] }
        ];
      },
      /duplicate \(agent_family, profile\) tuple/
    ]
  ]) {
    const registry = cloneDefaultRegistry();
    mutate(registry.filesystem_mcp_backends.default);
    const { registryPath, dir } = await writeRegistryToTempPath(registry);
    try {
      await assert.rejects(() => loadRegistry({ registryPath }), pattern);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("loadRegistry rejects backend entries missing required identity fields", async () => {
  for (const [mutate, pattern] of [
    [
      (entry) => {
        delete entry.backend_id;
      },
      /backend_id must be a non-empty string/
    ],
    [
      (entry) => {
        entry.backend_version = "";
      },
      /backend_version must be a non-empty string/
    ]
  ]) {
    const registry = cloneDefaultRegistry();
    mutate(registry.filesystem_mcp_backends.default);
    const { registryPath, dir } = await writeRegistryToTempPath(registry);
    try {
      await assert.rejects(() => loadRegistry({ registryPath }), pattern);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("loadRegistry rejects an empty filesystem_mcp_backends map", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends = {};
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /filesystem_mcp_backends must declare at least one entry/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadRegistry rejects a non-object filesystem_mcp_backends value", async () => {
  const registry = cloneDefaultRegistry();
  registry.filesystem_mcp_backends = ["nope"];
  const { registryPath, dir } = await writeRegistryToTempPath(registry);
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /filesystem_mcp_backends must be an object map/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveFilesystemMcpBackend rejects an unknown explicit key", () => {
  const data = createDefaultRegistry();
  const registry = { data };
  assert.throws(
    () => resolveFilesystemMcpBackend(registry, { key: "missing" }),
    /filesystem_mcp_backends has no entry for missing/
  );
});

test("resolveLauncherRegistryPath rejects an empty override path", () => {
  assert.throws(
    () => resolveLauncherRegistryPath(""),
    /Launcher registry override path must be a non-empty string/
  );
});

test("resolveLauncherRegistryPath returns the workspace-local path when no override is provided", async () => {
  await withTempWorkspace(async (workspaceDir) => {
    assert.equal(
      resolveLauncherRegistryPath(undefined, { workspaceDir }),
      path.join(workspaceDir, LAUNCHER_CONFIG_DIRNAME, "launchers.v1.json")
    );
    assert.equal(
      resolveLauncherRegistryPath(undefined, { workspaceDir }),
      getLauncherRegistryPath(workspaceDir)
    );
  });
});

test("loadRegistry rejects when registry file is missing at the explicit path", async () => {
  const dir = await mkdtemp(path.join(TMP_ROOT, "missing-"));
  const registryPath = path.join(dir, "no-such-file.json");
  try {
    await assert.rejects(
      () => loadRegistry({ registryPath }),
      /Launcher registry not found at .*no-such-file\.json/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getWorkerFamilyTrustedLauncherConfigDir/RegistryPath resolve workspace-local under an explicit workspace dir", () => {
  const workspaceDir = "/tmp/wf-workspace-explicit";
  assert.equal(
    getWorkerFamilyTrustedLauncherConfigDir(workspaceDir),
    path.join(workspaceDir, LAUNCHER_CONFIG_DIRNAME)
  );
  assert.equal(
    getWorkerFamilyTrustedLauncherRegistryPath(workspaceDir),
    path.join(workspaceDir, LAUNCHER_CONFIG_DIRNAME, "launchers.v1.json")
  );
});

test("getWorkerFamilyTrustedLauncherRegistryPath under an explicit workspace dir never consults HOME/XDG/AGENT_LAUNCH_* env", () => {
  const workspaceDir = "/tmp/wf-workspace-env-isolated";
  const expected = path.join(workspaceDir, LAUNCHER_CONFIG_DIRNAME, "launchers.v1.json");
  const forged = {
    HOME: "/tmp/fake-home",
    XDG_CONFIG_HOME: "/tmp/fake-xdg-config",
    XDG_STATE_HOME: "/tmp/fake-xdg-state",
    TMPDIR: "/tmp/fake-tmpdir",
    TMP: "/tmp/fake-tmp",
    TEMP: "/tmp/fake-temp",
    BASH_ENV: "/tmp/fake-bash-env",
    NODE_OPTIONS: "--require /tmp/fake-preload.js",
    AGENT_LAUNCH_CONFIG_DIR: "/tmp/fake-agent-launch-config",
    AGENT_LAUNCH_REGISTRY_PATH: "/tmp/fake-registry.json",
    AGENT_LAUNCH_HOME: "/tmp/fake-agent-launch-home"
  };
  const restorers = Object.entries(forged).map(([key, value]) => {
    const previous = process.env[key];
    process.env[key] = value;
    return () => {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    };
  });
  try {
    assert.equal(getWorkerFamilyTrustedLauncherRegistryPath(workspaceDir), expected);
  } finally {
    for (const restore of restorers) restore();
  }
});

test("resolveWorkerFamilyLauncherRegistryPath returns the workspace-local trusted path when no override is supplied", () => {
  const workspaceDir = "/tmp/wf-workspace-resolve";
  const result = resolveWorkerFamilyLauncherRegistryPath(null, { workspaceDir });
  assert.equal(result.ok, true);
  assert.equal(result.path, getWorkerFamilyTrustedLauncherRegistryPath(workspaceDir));
});

test("resolveWorkerFamilyLauncherRegistryPath returns the trusted path for null/empty overrides", () => {
  assert.equal(resolveWorkerFamilyLauncherRegistryPath(null).ok, true);
  assert.equal(resolveWorkerFamilyLauncherRegistryPath(undefined).ok, true);

  const empty = resolveWorkerFamilyLauncherRegistryPath("");
  assert.equal(empty.ok, false);
  assert.equal(empty.kind, "invalid");
});

test("resolveWorkerFamilyLauncherRegistryPath refuses any absolute operator-config override with the unauthorized reason", () => {
  const result = resolveWorkerFamilyLauncherRegistryPath("/tmp/poison/launchers.v1.json");
  assert.equal(result.ok, false);
  assert.equal(result.kind, "override_unauthorized");
  assert.equal(result.reason, WORKER_FAMILY_OPERATOR_CONFIG_REFUSAL_REASON);
});

test("resolveWorkerFamilyLauncherRegistryPath refuses cwd-relative operator-config overrides separately from the unauthorized reason", () => {
  const result = resolveWorkerFamilyLauncherRegistryPath("./poison/launchers.v1.json");
  assert.equal(result.ok, false);
  assert.equal(result.kind, "relative");
  assert.equal(result.reason, WORKER_FAMILY_OPERATOR_CONFIG_RELATIVE_REFUSAL_REASON);
});

test("resolveWorkerFamilyLauncherRegistryPath refuses bare-name and parent-directory operator-config overrides as relative", () => {
  for (const candidate of ["launchers.v1.json", "../launchers.v1.json", "registry/launchers.v1.json"]) {
    const result = resolveWorkerFamilyLauncherRegistryPath(candidate);
    assert.equal(result.ok, false, `expected refusal for relative override ${candidate}`);
    assert.equal(result.kind, "relative", `expected relative refusal for ${candidate}`);
  }
});

test("resolveWorkerFamilyLauncherRegistryPath refuses non-string overrides", () => {
  for (const bad of [0, false, [], {}, Buffer.from("x")]) {
    const result = resolveWorkerFamilyLauncherRegistryPath(bad);
    assert.equal(result.ok, false);
    assert.equal(result.kind, "invalid");
  }
});

test("resolveWorkerFamilyLauncherRegistryPath does not consult process.cwd() when refusing relative overrides", () => {
  const originalCwd = process.cwd();

  try {
    process.chdir(os.tmpdir());
    const result = resolveWorkerFamilyLauncherRegistryPath("launchers.v1.json");
    assert.equal(result.ok, false);
    assert.equal(result.kind, "relative");
    assert.ok(!("path" in result), "refusal must not leak a resolved path");
  } finally {
    process.chdir(originalCwd);
  }
});

test("resolveLauncherRegistryPath (operator path) resolves workspace-local by default and remains permissive for absolute overrides", async () => {
  await withTempWorkspace(async (workspaceDir) => {

    assert.equal(
      resolveLauncherRegistryPath(undefined, { workspaceDir }),
      path.join(workspaceDir, LAUNCHER_CONFIG_DIRNAME, "launchers.v1.json")
    );

    assert.equal(
      resolveLauncherRegistryPath("/etc/somewhere/launchers.v1.json"),
      "/etc/somewhere/launchers.v1.json"
    );
  });
});
