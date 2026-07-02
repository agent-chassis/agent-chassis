import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createMcpSession as createBoundedMcpSession } from "./fixtures/mcp-stdio-session.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

function childNodeEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
  }
  return env;
}

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-interface-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["packages/wiki-cli/src/index.mjs", ...args], {
      cwd: REPO_ROOT,
      env: childNodeEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        const error = new Error(stderr || `CLI exited with code ${code}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function git(dir, args) {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout.trim();
}

const SCIP_PROVIDER = {
  name: "scip-typescript",
  version: "0.4.0",
  scip_protocol_version: "0.8.1",
  cache_key: "scip-typescript@0.4.0:scip@0.8.1"
};
const SCIP_SYMBOL_CORE = "scip-typescript npm app 1.0.0 `packages/app/src/core.mjs`/handleGraphState().";
const SCIP_SYMBOL_RUN = "scip-typescript npm app 1.0.0 `packages/app-cli/src/run.mjs`/run().";

async function readCodeIndexArtifact(tempDir) {
  return JSON.parse(
    await readFile(path.join(tempDir, ".cache", "repo-code-index", "index.json"), "utf8")
  );
}

async function writeCodeIndexArtifact(tempDir, artifact) {
  await writeFile(
    path.join(tempDir, ".cache", "repo-code-index", "index.json"),
    JSON.stringify(artifact, null, 2),
    "utf8"
  );
}

async function attachMcpScipOverlay(tempDir, overrides = {}) {
  const artifact = await readCodeIndexArtifact(tempDir);
  artifact.scip_overlay = {
    graph_schema_version: "repo-code-graph.v1",
    scip_available: true,
    graph_available: true,
    call_graph_available: true,
    status_reason: "scip_extracted",
    graph_nodes: [
      {
        id: `symbol:${SCIP_SYMBOL_CORE}`,
        kind: "symbol",
        symbol: SCIP_SYMBOL_CORE,
        display_name: "handleGraphState",
        scheme: "scip-typescript",
        resolution: { state: "resolved", dynamic_boundary: false },
        coverage: { language: "typescript", status: "resolved" },
        provider_descriptor: SCIP_PROVIDER,
        provenance: { source_kind: "scip", canonicality: "derived", evidence_basis: "scip" }
      },
      {
        id: `symbol:${SCIP_SYMBOL_RUN}`,
        kind: "symbol",
        symbol: SCIP_SYMBOL_RUN,
        display_name: "run",
        scheme: "scip-typescript",
        resolution: { state: "resolved", dynamic_boundary: false },
        coverage: { language: "typescript", status: "resolved" },
        provider_descriptor: SCIP_PROVIDER,
        provenance: { source_kind: "scip", canonicality: "derived", evidence_basis: "scip" }
      }
    ],
    graph_edges: [
      {
        id: `edge:defines_symbol:file:packages/app/src/core.mjs->symbol:${SCIP_SYMBOL_CORE}`,
        kind: "defines_symbol",
        from_node_id: "file:packages/app/src/core.mjs",
        to_node_id: `symbol:${SCIP_SYMBOL_CORE}`,
        path: "packages/app/src/core.mjs",
        line: 1,
        resolution: { state: "resolved", dynamic_boundary: false },
        provider_descriptor: SCIP_PROVIDER,
        provenance: {
          source_kind: "scip",
          canonicality: "derived",
          evidence_basis: "scip",
          path: "packages/app/src/core.mjs"
        }
      },
      {
        id: `edge:defines_symbol:file:packages/app-cli/src/run.mjs->symbol:${SCIP_SYMBOL_RUN}`,
        kind: "defines_symbol",
        from_node_id: "file:packages/app-cli/src/run.mjs",
        to_node_id: `symbol:${SCIP_SYMBOL_RUN}`,
        path: "packages/app-cli/src/run.mjs",
        line: 2,
        resolution: { state: "resolved", dynamic_boundary: false },
        provider_descriptor: SCIP_PROVIDER,
        provenance: {
          source_kind: "scip",
          canonicality: "derived",
          evidence_basis: "scip",
          path: "packages/app-cli/src/run.mjs"
        }
      },
      {
        id: `edge:references_symbol:file:packages/app-cli/src/run.mjs->symbol:${SCIP_SYMBOL_CORE}`,
        kind: "references_symbol",
        from_node_id: "file:packages/app-cli/src/run.mjs",
        to_node_id: `symbol:${SCIP_SYMBOL_CORE}`,
        path: "packages/app-cli/src/run.mjs",
        line: 6,
        resolution: { state: "resolved", dynamic_boundary: false },
        provider_descriptor: SCIP_PROVIDER,
        provenance: {
          source_kind: "scip",
          canonicality: "derived",
          evidence_basis: "scip",
          path: "packages/app-cli/src/run.mjs"
        }
      },
      {
        id: `edge:calls_symbol:symbol:${SCIP_SYMBOL_RUN}->symbol:${SCIP_SYMBOL_CORE}`,
        kind: "calls_symbol",
        from_node_id: `symbol:${SCIP_SYMBOL_RUN}`,
        to_node_id: `symbol:${SCIP_SYMBOL_CORE}`,
        occurrence_count: 1,
        lines: [6],
        resolution: { state: "resolved", dynamic_boundary: false },
        provider_descriptor: SCIP_PROVIDER,
        provenance: {
          source_kind: "scip",
          canonicality: "derived",
          evidence_basis: "scip"
        }
      }
    ],
    provider_descriptors: [SCIP_PROVIDER],
    coverage: {
      indexers: ["scip-typescript"],
      document_count: 2,
      covered_document_count: 2,
      symbol_count: 2,
      edge_count: 4,
      caller_edge_count: 1,
      call_graph_available: true,
      call_graph_status_reason: "scip_call_graph_extracted",
      unresolved_symbol_count: 0,
      uncovered_documents: []
    },
    ...overrides
  };
  artifact.cache_metadata.scip_overlay = {
    scip_available: artifact.scip_overlay.scip_available,
    status_reason: artifact.scip_overlay.status_reason,
    symbol_node_count: artifact.scip_overlay.graph_nodes.length,
    symbol_edge_count: artifact.scip_overlay.graph_edges.length
  };
  await writeCodeIndexArtifact(tempDir, artifact);
}

function withoutWorkspaceRepo(envelope) {
  const { workspaceRepo, ...rest } = envelope;
  return rest;
}

async function initSidecarStatusRepo(tempDir) {
  await git(tempDir, ["init"]);
  await git(tempDir, ["config", "user.email", "sidecar-interface@example.invalid"]);
  await git(tempDir, ["config", "user.name", "Sidecar Interface Test"]);
  await writeFile(
    path.join(tempDir, ".gitignore"),
    [
      ".cache/",
      ".codex",
      ".codex/",
      "**/.codex",
      "**/.codex/",
      ".claude",
      ".claude/",
      "**/.claude",
      "**/.claude/",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(tempDir, "README.md"), "# Test repo\n", "utf8");
  await git(tempDir, ["add", ".gitignore", "README.md"]);
  await git(tempDir, ["commit", "-m", "Initial commit"]);
  return {
    head: await git(tempDir, ["rev-parse", "HEAD"]),
    tree: await git(tempDir, ["rev-parse", "HEAD^{tree}"])
  };
}

async function initSidecarImpactRepo(tempDir) {
  await initSidecarStatusRepo(tempDir);
  await mkdir(path.join(tempDir, "docs", "architecture"), { recursive: true });
  await mkdir(path.join(tempDir, "packages", "app", "src"), { recursive: true });
  await mkdir(path.join(tempDir, "wiki", "decisions"), { recursive: true });
  await mkdir(path.join(tempDir, "wiki", "issues"), { recursive: true });
  await writeFile(
    path.join(tempDir, "packages", "app", "src", "service.mjs"),
    "export const service = true;\n",
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "packages", "app", "src", "service.test.mjs"),
    "import './service.mjs';\n",
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "docs", "architecture", "service.md"),
    "# Service Architecture\n",
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "wiki", "issues", "WK-9001.md"),
    [
      "---",
      "id: WK-9001",
      "title: Implement service path",
      "type: task",
      "status: todo",
      "priority: high",
      "owner: codex",
      "created: 2026-04-28",
      "updated: 2026-04-28",
      "docs:",
      "  - docs/architecture/service.md",
      "write_scope:",
      "  - packages/app/src/",
      "related:",
      "  - DEC-9001",
      "---",
      "",
      "# Implement service path"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "wiki", "decisions", "DEC-9001.md"),
    [
      "---",
      "id: DEC-9001",
      "title: Service path decision",
      "status: accepted",
      "date: 2026-04-28",
      "updated: 2026-04-28",
      "related:",
      "  - WK-9001",
      "---",
      "",
      "# Service path decision"
    ].join("\n"),
    "utf8"
  );
  await git(tempDir, ["add", "."]);
  await git(tempDir, ["commit", "-m", "Add sidecar impact fixtures"]);
}

async function initSidecarGraphCliRepo(tempDir) {
  await initSidecarStatusRepo(tempDir);
  await mkdir(path.join(tempDir, "docs", "contracts"), { recursive: true });
  await mkdir(path.join(tempDir, "packages", "app", "src"), { recursive: true });
  await mkdir(path.join(tempDir, "packages", "app-cli", "src"), { recursive: true });
  await mkdir(path.join(tempDir, "packages", "app-mcp", "src"), { recursive: true });
  await mkdir(path.join(tempDir, "tests"), { recursive: true });
  await mkdir(path.join(tempDir, "wiki", "issues"), { recursive: true });

  await writeFile(
    path.join(tempDir, "packages", "app", "src", "core.mjs"),
    [
      "export function handleGraphState() {",
      "  return 'graph_state';",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "packages", "app-cli", "src", "run.mjs"),
    [
      "import { handleGraphState } from '../../app/src/core.mjs';",
      "export async function run(argv) {",
      "  const [command] = argv;",
      "  switch (command) {",
      "    case 'serve':",
      "      return handleGraphState();",
      "    default:",
      "      throw new Error(`Unknown command: ${command}`);",
      "  }",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "packages", "app-mcp", "src", "server.mjs"),
    [
      "import { handleGraphState } from '../../app/src/core.mjs';",
      "export function registerTools(server) {",
      "  server.registerTool('serve_tool', { description: 'Serve' }, async () => handleGraphState());",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "tests", "core.test.mjs"),
    "import '../packages/app/src/core.mjs';\n",
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "docs", "contracts", "app.md"),
    "# App Contract\n\n`packages/app/src/core.mjs` owns `graph_state`.\n",
    "utf8"
  );
  await writeFile(
    path.join(tempDir, "wiki", "issues", "WK-9300.md"),
    [
      "---",
      "id: WK-9300",
      "title: Own graph impact CLI fixture",
      "type: task",
      "status: todo",
      "priority: high",
      "owner: codex",
      "created: 2026-04-30",
      "updated: 2026-04-30",
      "docs:",
      "  - docs/contracts/app.md",
      "write_scope:",
      "  - packages/app/src/core.mjs",
      "---",
      "",
      "# Own graph impact CLI fixture"
    ].join("\n"),
    "utf8"
  );

  await git(tempDir, ["add", "."]);
  await git(tempDir, ["commit", "-m", "Add graph impact CLI fixtures"]);
}

function attachDefaultWorkspaceRepo(env) {
  if (
    !env.WIKI_MCP_DEFAULT_REPO ||
    env.WIKI_MCP_WORKSPACE_ALIAS ||
    env.WIKI_MCP_WORKSPACE_DIR
  ) {
    return env;
  }

  let repos;
  try {
    repos = JSON.parse(env.WIKI_MCP_REPOS || "{}");
  } catch {
    return env;
  }

  const workspaceDir = repos?.[env.WIKI_MCP_DEFAULT_REPO];
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0) {
    return env;
  }

  return {
    ...env,
    WIKI_MCP_WORKSPACE_ALIAS: env.WIKI_MCP_DEFAULT_REPO,
    WIKI_MCP_WORKSPACE_DIR: workspaceDir
  };
}

function createMcpSession({ env = {}, prelude = "" } = {}) {
  return createBoundedMcpSession({
    env: childNodeEnv(attachDefaultWorkspaceRepo(env)),
    prelude,
    repoRoot: REPO_ROOT,
    baseEnv: {}
  });
}

test("MCP workspace code index tools use configured repo aliases", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await initSidecarImpactRepo(tempDir);

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const tools = await session.request(2, "tools/list");
      const workspaceToolNames = [
        "workspace_code_index_build",
        "workspace_code_index_rebuild",
        "workspace_code_index_status",
        "workspace_code_index_impact_paths",
        "workspace_code_index_graph_impact_paths",
        "workspace_code_index_graph_impact_diff",
        "workspace_code_index_find_references",
        "workspace_code_index_definition",
        "workspace_code_index_callers",
        "workspace_code_index_callees",
        "workspace_code_index_context_for_path"
      ];
      for (const name of workspaceToolNames) {
        const tool = tools.tools.find((candidate) => candidate.name === name);
        assert.ok(tool, `${name} should be registered`);
        assert.equal(
          JSON.stringify(tool.inputSchema).includes("dir"),
          false,
          `${name} must not expose a caller-supplied dir argument`
        );
      }

      const built = await session.request(3, "tools/call", {
        name: "workspace_code_index_build",
        arguments: {}
      });
      const status = await session.request(4, "tools/call", {
        name: "workspace_code_index_status",
        arguments: {}
      });
      const impact = await session.request(5, "tools/call", {
        name: "workspace_code_index_impact_paths",
        arguments: { paths: ["packages/app/src/service.mjs"] }
      });
      const graphImpact = await session.request(6, "tools/call", {
        name: "workspace_code_index_graph_impact_paths",
        arguments: { paths: ["packages/app/src/service.mjs"] }
      });
      const graphImpactDiff = await session.request(7, "tools/call", {
        name: "workspace_code_index_graph_impact_diff",
        arguments: {
          diffRecords: [
            {
              changeKind: "modified",
              oldPath: "packages/app/src/service.mjs",
              newPath: "packages/app/src/service.mjs"
            }
          ]
        }
      });
      const symbolReferences = await session.request(8, "tools/call", {
        name: "workspace_code_index_find_references",
        arguments: { symbol: SCIP_SYMBOL_CORE }
      });
      const symbolDefinition = await session.request(9, "tools/call", {
        name: "workspace_code_index_definition",
        arguments: { symbol: SCIP_SYMBOL_CORE }
      });
      const symbolCallers = await session.request(10, "tools/call", {
        name: "workspace_code_index_callers",
        arguments: { symbol: SCIP_SYMBOL_CORE }
      });
      const symbolCallees = await session.request(11, "tools/call", {
        name: "workspace_code_index_callees",
        arguments: { symbol: SCIP_SYMBOL_RUN }
      });
      const context = await session.request(12, "tools/call", {
        name: "workspace_code_index_context_for_path",
        arguments: { repo: "demo", path: "packages/app/src/service.mjs" }
      });
      const rebuilt = await session.request(13, "tools/call", {
        name: "workspace_code_index_rebuild",
        arguments: { repo: "demo" }
      });
      const unknownAlias = await session.request(14, "tools/call", {
        name: "workspace_code_index_status",
        arguments: { repo: "missing" }
      });

      assert.equal(built.structuredContent.workspaceRepo, "demo");
      assert.equal(status.structuredContent.workspaceRepo, "demo");
      assert.equal(impact.structuredContent.workspaceRepo, "demo");
      assert.equal(graphImpact.structuredContent.workspaceRepo, "demo");
      assert.equal(graphImpactDiff.structuredContent.workspaceRepo, "demo");
      assert.equal(symbolReferences.structuredContent.workspaceRepo, "demo");
      assert.equal(symbolDefinition.structuredContent.workspaceRepo, "demo");
      assert.equal(symbolCallers.structuredContent.workspaceRepo, "demo");
      assert.equal(symbolCallees.structuredContent.workspaceRepo, "demo");
      assert.equal(context.structuredContent.workspaceRepo, "demo");
      assert.equal(rebuilt.structuredContent.workspaceRepo, "demo");
      assert.equal(built.structuredContent.staleness, "fresh");
      assert.equal(status.structuredContent.staleness, "fresh");
      assert.equal(impact.structuredContent.verbose, false);

      for (const mirrored of [
        "dirty_state",
        "staleness",
        "input_path_count",
        "validated_path_count",
        "invalid_path_count",
        "canonical_ref_count"
      ]) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(impact.structuredContent, mirrored),
          false,
          `compact impact response must not mirror ${mirrored} at the top level`
        );
      }
      assert.equal(typeof impact.structuredContent.graph_impact_summary.graph_quality.dirty_state, "string");
      assert.equal(typeof impact.structuredContent.graph_impact_summary.graph_quality.staleness, "string");
      assert.equal(typeof impact.structuredContent.graph_impact_summary.counts.validated_paths, "number");
      assert.ok(
        impact.structuredContent.graph_impact_summary,
        "compact impact response must include graph_impact_summary"
      );
      assert.ok(
        impact.structuredContent.graph_impact_summary_ref,
        "compact impact response must include graph_impact_summary_ref"
      );
      assert.ok(
        impact.structuredContent.likely_test_count > 0,
        "compact impact response should surface likely test hints"
      );
      assert.ok(Array.isArray(impact.structuredContent.likely_tests));
      assert.ok(
        impact.structuredContent.likely_tests.length <= 5,
        "compact impact response must bound likely_tests to daily-use hints"
      );
      assert.ok(
        impact.structuredContent.likely_tests.includes("packages/app/src/service.test.mjs")
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(impact.structuredContent, "graph_impact"),
        false,
        "compact impact response must not expose verbose-only graph_impact payload"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(impact.structuredContent, "graph_state"),
        false,
        "compact impact response must not expose verbose-only graph_state"
      );
      if (impact.structuredContent.related_code_path_count > 0) {
        assert.ok(Array.isArray(impact.structuredContent.related_code_paths));
        assert.ok(
          impact.structuredContent.related_code_paths.length <= 5,
          "compact impact response must bound related_code_paths to daily-use hints"
        );
      }
      assert.equal(graphImpact.structuredContent.query_kind, "graph_impact_paths");
      assert.equal(graphImpact.structuredContent.verbose, false);

      assert.equal(
        Object.prototype.hasOwnProperty.call(graphImpact.structuredContent, "dirty_state"),
        false,
        "compact graph_impact_paths response must not mirror dirty_state at the top level"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(graphImpact.structuredContent, "staleness"),
        false,
        "compact graph_impact_paths response must not mirror staleness at the top level"
      );
      assert.ok(graphImpact.structuredContent.graph_impact_summary, "compact MCP response must include graph_impact_summary");
      assert.equal(graphImpact.structuredContent.graph_impact_summary.counts.validated_paths, 1);
      assert.equal(graphImpact.structuredContent.graph_impact_summary.graph_state.graph_available, true);
      assert.equal(typeof graphImpact.structuredContent.graph_impact_summary.graph_state.dirty_state, "string");
      assert.ok(graphImpact.structuredContent.graph_impact_summary_ref, "compact MCP response must include graph_impact_summary_ref");
      assert.ok(/^sha256:[0-9a-f]{64}$/.test(graphImpact.structuredContent.graph_impact_summary_ref.raw_evidence_digest ?? ""), "compact ref must carry a sha256 raw_evidence_digest");
      assert.equal(graphImpactDiff.structuredContent.query_kind, "graph_impact_diff");
      assert.equal(graphImpactDiff.structuredContent.graph_impact_summary.graph_state.graph_available, true);
      assert.equal(symbolReferences.structuredContent.query_kind, "find_references");
      assert.equal(symbolReferences.structuredContent.scip_state.scip_available, false);
      assert.equal(symbolReferences.structuredContent.scip_state.status_reason, "scip_not_configured");
      assert.equal(symbolDefinition.structuredContent.query_kind, "definition");
      assert.equal(symbolDefinition.structuredContent.scip_state.graph_available, false);
      assert.equal(symbolCallers.structuredContent.query_kind, "symbol_callers");
      assert.equal(symbolCallers.structuredContent.scip_state.scip_available, false);
      assert.equal(symbolCallers.structuredContent.scip_state.call_graph_available, false);
      assert.equal(symbolCallers.structuredContent.scip_state.status_reason, "scip_not_configured");
      assert.deepEqual(symbolCallers.structuredContent.callers, []);
      assert.equal(symbolCallees.structuredContent.query_kind, "symbol_callees");
      assert.equal(symbolCallees.structuredContent.scip_state.scip_available, false);
      assert.equal(symbolCallees.structuredContent.scip_state.call_graph_available, false);
      assert.equal(symbolCallees.structuredContent.scip_state.status_reason, "scip_not_configured");
      assert.deepEqual(symbolCallees.structuredContent.callees, []);

      assert.equal(context.structuredContent.path, "packages/app/src/service.mjs");
      assert.equal(
        Object.prototype.hasOwnProperty.call(context.structuredContent, "context"),
        false,
        "compact context_for_path response must not echo the nested context object"
      );
      assert.equal(rebuilt.structuredContent.build_action, "rebuild");
      assert.equal(unknownAlias.isError, true);
      assert.match(unknownAlias.content[0].text, /Unknown workspace repo alias/);
    } finally {
      await session.close();
    }
  });
});

test("MCP workspace code index graph impact matches CLI JSON envelope", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await initSidecarGraphCliRepo(tempDir);
    await runCli(["code-index", "build", "--json", "--dir", tempDir]);

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const tools = await session.request(2, "tools/list");
      const tool = tools.tools.find(
        (candidate) => candidate.name === "workspace_code_index_graph_impact_paths"
      );
      assert.ok(tool, "workspace_code_index_graph_impact_paths should be registered");
      assert.equal(
        JSON.stringify(tool.inputSchema).includes("dir"),
        false,
        "workspace_code_index_graph_impact_paths must not expose a caller-supplied dir argument"
      );

      await runCli([
        "code-index",
        "graph-impact-paths",
        "--json",
        "--dir",
        tempDir,
        "--paths",
        "packages/app/src/core.mjs"
      ]);
      const mcp = await session.request(3, "tools/call", {
        name: "workspace_code_index_graph_impact_paths",
        arguments: { paths: ["packages/app/src/core.mjs"] }
      });
      const mcpVerbose = await session.request(4, "tools/call", {
        name: "workspace_code_index_graph_impact_paths",
        arguments: { paths: ["packages/app/src/core.mjs"], verbose: true }
      });
      const invalid = await session.request(5, "tools/call", {
        name: "workspace_code_index_graph_impact_paths",
        arguments: { paths: ["../escape.mjs"] }
      });
      const invalidVerbose = await session.request(6, "tools/call", {
        name: "workspace_code_index_graph_impact_paths",
        arguments: { paths: ["../escape.mjs"], verbose: true }
      });

      assert.equal(mcp.structuredContent.workspaceRepo, "demo");
      assert.equal(mcp.structuredContent.query_kind, "graph_impact_paths");
      assert.equal(mcp.structuredContent.verbose, false);
      assert.ok(mcp.structuredContent.graph_impact_summary, "compact response must include graph_impact_summary");
      assert.equal(mcp.structuredContent.graph_impact_summary.graph_state.graph_available, true);
      assert.ok(mcp.structuredContent.graph_impact_summary.counts.structural_impacts > 0, "compact summary must report structural_impacts count");
      assert.ok(mcp.structuredContent.graph_impact_summary_ref, "compact response must include graph_impact_summary_ref");
      assert.ok(/^sha256:[0-9a-f]{64}$/.test(mcp.structuredContent.graph_impact_summary_ref.raw_evidence_digest ?? ""), "compact ref must carry a sha256 raw_evidence_digest");
      assert.equal(Object.prototype.hasOwnProperty.call(mcp.structuredContent, "graph_state"), false, "compact response must not expose graph_state at top level");
      assert.equal(Object.prototype.hasOwnProperty.call(mcp.structuredContent, "validated_paths"), false, "compact response must not expose validated_paths at top level");

      assert.equal(mcpVerbose.structuredContent.verbose, true);
      assert.equal(mcpVerbose.structuredContent.graph_state.graph_available, true);
      assert.ok(mcpVerbose.structuredContent.graph_impact_raw, "verbose response must include graph_impact_raw");
      assert.ok(
        mcpVerbose.structuredContent.graph_impact_raw.structural_impacts.some(
          (entry) => entry.kind === "downstream_mcp_tool"
        ),
        "verbose graph_impact_raw must include the full structural_impacts array"
      );

      assert.equal(invalid.structuredContent.workspaceRepo, "demo");
      assert.equal(invalid.structuredContent.graph_impact_summary.counts.validated_paths, 0);
      assert.equal(invalid.structuredContent.graph_impact_summary.counts.invalid_paths, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(invalid.structuredContent, "validated_paths"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(invalid.structuredContent, "invalid_paths"), false);

      assert.deepEqual(invalidVerbose.structuredContent.validated_paths, []);
      assert.deepEqual(invalidVerbose.structuredContent.invalid_paths, ["../escape.mjs"]);
      assert.ok(
        invalidVerbose.structuredContent.validation_hints.some(
          (entry) => entry.valid === false && entry.input_path === "../escape.mjs"
        )
      );
    } finally {
      await session.close();
    }
  });
});

test("MCP workspace code index symbol navigation matches CLI JSON envelope", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await initSidecarGraphCliRepo(tempDir);
    await runCli(["code-index", "build", "--json", "--dir", tempDir]);
    await attachMcpScipOverlay(tempDir);

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const tools = await session.request(2, "tools/list");
      for (const name of [
        "workspace_code_index_find_references",
        "workspace_code_index_definition",
        "workspace_code_index_callers",
        "workspace_code_index_callees"
      ]) {
        const tool = tools.tools.find((candidate) => candidate.name === name);
        assert.ok(tool, `${name} should be registered`);
        assert.equal(
          JSON.stringify(tool.inputSchema).includes("dir"),
          false,
          `${name} must not expose a caller-supplied dir argument`
        );
      }

      const cliReferences = JSON.parse(
        (await runCli([
          "code-index",
          "find-references",
          "--json",
          "--dir",
          tempDir,
          "--symbol",
          SCIP_SYMBOL_CORE
        ])).stdout
      );
      const mcpReferences = await session.request(3, "tools/call", {
        name: "workspace_code_index_find_references",
        arguments: { symbol: SCIP_SYMBOL_CORE }
      });
      assert.deepEqual(withoutWorkspaceRepo(mcpReferences.structuredContent), cliReferences);

      const cliDefinition = JSON.parse(
        (await runCli([
          "code-index",
          "definition",
          "--json",
          "--dir",
          tempDir,
          "--path",
          "packages/app-cli/src/run.mjs",
          "--line",
          "6"
        ])).stdout
      );
      const mcpDefinition = await session.request(4, "tools/call", {
        name: "workspace_code_index_definition",
        arguments: { path: "packages/app-cli/src/run.mjs", line: 6 }
      });
      assert.deepEqual(withoutWorkspaceRepo(mcpDefinition.structuredContent), cliDefinition);

      const cliCallers = JSON.parse(
        (await runCli([
          "code-index",
          "callers",
          "--json",
          "--dir",
          tempDir,
          "--symbol",
          SCIP_SYMBOL_CORE
        ])).stdout
      );
      const mcpCallers = await session.request(5, "tools/call", {
        name: "workspace_code_index_callers",
        arguments: { symbol: SCIP_SYMBOL_CORE }
      });
      assert.deepEqual(withoutWorkspaceRepo(mcpCallers.structuredContent), cliCallers);
      assert.equal(mcpCallers.structuredContent.query_kind, "symbol_callers");
      assert.equal(mcpCallers.structuredContent.scip_state.call_graph_available, true);
      assert.equal(mcpCallers.structuredContent.callers.length, 1);
      assert.equal(mcpCallers.structuredContent.callers[0].caller_symbol, SCIP_SYMBOL_RUN);
      assert.equal(mcpCallers.structuredContent.callers[0].callee_symbol, SCIP_SYMBOL_CORE);
      assert.equal(mcpCallers.structuredContent.callers[0].occurrence_count, 1);
      assert.deepEqual(mcpCallers.structuredContent.callers[0].lines, [6]);
      assert.equal(
        Object.prototype.hasOwnProperty.call(mcpCallers.structuredContent.callers[0], "line"),
        false,
        "callers entries must not expose scalar line"
      );

      const cliCallees = JSON.parse(
        (await runCli([
          "code-index",
          "callees",
          "--json",
          "--dir",
          tempDir,
          "--path",
          "packages/app-cli/src/run.mjs",
          "--line",
          "2"
        ])).stdout
      );
      const mcpCallees = await session.request(6, "tools/call", {
        name: "workspace_code_index_callees",
        arguments: { path: "packages/app-cli/src/run.mjs", line: 2 }
      });
      assert.deepEqual(withoutWorkspaceRepo(mcpCallees.structuredContent), cliCallees);
      assert.equal(mcpCallees.structuredContent.query_kind, "symbol_callees");
      assert.equal(mcpCallees.structuredContent.scip_state.call_graph_available, true);
      assert.equal(mcpCallees.structuredContent.callees.length, 1);
      assert.equal(mcpCallees.structuredContent.callees[0].caller_symbol, SCIP_SYMBOL_RUN);
      assert.equal(mcpCallees.structuredContent.callees[0].callee_symbol, SCIP_SYMBOL_CORE);

      const artifact = await readCodeIndexArtifact(tempDir);
      artifact.scip_overlay = {
        graph_schema_version: "repo-code-graph.v1",
        scip_available: false,
        graph_available: false,
        status_reason: "scip_indexer_unavailable",
        graph_nodes: [],
        graph_edges: [],
        coverage: {
          indexers: ["scip-typescript"],
          document_count: 0,
          covered_document_count: 0,
          symbol_count: 0,
          uncovered_documents: []
        }
      };
      await writeCodeIndexArtifact(tempDir, artifact);

      const degraded = await session.request(7, "tools/call", {
        name: "workspace_code_index_find_references",
        arguments: { symbol: SCIP_SYMBOL_CORE }
      });
      assert.equal(degraded.structuredContent.scip_state.scip_available, false);
      assert.equal(degraded.structuredContent.scip_state.graph_available, false);
      assert.equal(degraded.structuredContent.scip_state.status_reason, "scip_indexer_unavailable");
      assert.deepEqual(degraded.structuredContent.references, []);
      const degradedCallers = await session.request(8, "tools/call", {
        name: "workspace_code_index_callers",
        arguments: { symbol: SCIP_SYMBOL_CORE }
      });
      assert.equal(degradedCallers.structuredContent.scip_state.scip_available, false);
      assert.equal(degradedCallers.structuredContent.scip_state.call_graph_available, false);
      assert.equal(
        degradedCallers.structuredContent.scip_state.status_reason,
        "scip_indexer_unavailable"
      );
      assert.deepEqual(degradedCallers.structuredContent.callers, []);
      const degradedCallees = await session.request(9, "tools/call", {
        name: "workspace_code_index_callees",
        arguments: { symbol: SCIP_SYMBOL_RUN }
      });
      assert.equal(degradedCallees.structuredContent.scip_state.scip_available, false);
      assert.equal(degradedCallees.structuredContent.scip_state.call_graph_available, false);
      assert.equal(
        degradedCallees.structuredContent.scip_state.status_reason,
        "scip_indexer_unavailable"
      );
      assert.deepEqual(degradedCallees.structuredContent.callees, []);
    } finally {
      await session.close();
    }
  });
});

test("MCP workspace code index graph impact diff matches CLI JSON envelope", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await initSidecarGraphCliRepo(tempDir);
    await runCli(["code-index", "build", "--json", "--dir", tempDir]);

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const tools = await session.request(2, "tools/list");
      const tool = tools.tools.find(
        (candidate) => candidate.name === "workspace_code_index_graph_impact_diff"
      );
      assert.ok(tool, "workspace_code_index_graph_impact_diff should be registered");
      assert.equal(
        JSON.stringify(tool.inputSchema).includes("dir"),
        false,
        "workspace_code_index_graph_impact_diff must not expose a caller-supplied dir argument"
      );

      const diffRecords = [
        {
          changeKind: "modified",
          oldPath: "packages/app/src/core.mjs",
          newPath: "packages/app/src/core.mjs"
        },
        { changeKind: "added", oldPath: null, newPath: "packages/app/src/added.mjs" },
        { changeKind: "deleted", oldPath: "packages/app/src/deleted.mjs", newPath: null },
        {
          changeKind: "renamed",
          oldPath: "packages/app/src/core.mjs",
          newPath: "packages/app/src/core-renamed.mjs"
        },
        {
          changeKind: "copied",
          oldPath: "packages/app/src/core.mjs",
          newPath: "packages/app/src/core-copy.mjs"
        },
        {
          changeKind: "mode_changed",
          oldPath: "packages/app/src/core.mjs",
          newPath: "packages/app/src/core.mjs"
        },
        { changeKind: "added", oldPath: null, newPath: "wiki/catalog.md" }
      ];
      await runCli([
        "code-index",
        "graph-impact-diff",
        "--json",
        "--dir",
        tempDir,
        "--diff-records-json",
        JSON.stringify(diffRecords)
      ]);
      const mcp = await session.request(3, "tools/call", {
        name: "workspace_code_index_graph_impact_diff",
        arguments: { diffRecords }
      });
      const mcpVerbose = await session.request(4, "tools/call", {
        name: "workspace_code_index_graph_impact_diff",
        arguments: { diffRecords, verbose: true }
      });

      assert.equal(mcp.structuredContent.workspaceRepo, "demo");
      assert.equal(mcp.structuredContent.query_kind, "graph_impact_diff");
      assert.equal(mcp.structuredContent.verbose, false);
      assert.ok(mcp.structuredContent.graph_impact_summary, "compact response must include graph_impact_summary");
      assert.ok(mcp.structuredContent.graph_impact_summary_ref, "compact response must include graph_impact_summary_ref");
      assert.equal(Object.prototype.hasOwnProperty.call(mcp.structuredContent, "graph_state"), false, "compact response must not expose graph_state at top level");
      assert.equal(Object.prototype.hasOwnProperty.call(mcp.structuredContent, "invalid_diff_records"), false, "compact response must not expose invalid_diff_records at top level");

      assert.equal(mcpVerbose.structuredContent.verbose, true);
      assert.ok(mcpVerbose.structuredContent.graph_state.diff_path_states.length > 0);
      assert.equal(mcpVerbose.structuredContent.invalid_diff_records[0].code, "forbidden_path");

      assert.notEqual(
        mcpVerbose.structuredContent.schema_version,
        "wiki-mcp-spilled-response.v1",
        "verbose response must not collapse into a spilled descriptor"
      );
      assert.notEqual(
        mcpVerbose.structuredContent.schema_version,
        "wiki-mcp-inline-structured-response.v1",
        "verbose structuredContent must be the payload, not the display-text descriptor"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(mcpVerbose.structuredContent, "response_spilled"),
        false,
        "verbose structuredContent must not be a spill envelope"
      );

      const rawPatch = [
        "diff --git a/packages/app/src/raw-added.mjs b/packages/app/src/raw-added.mjs",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/packages/app/src/raw-added.mjs",
        "@@ -0,0 +1 @@",
        "+export const rawAdded = true;"
      ].join("\n");
      await runCli([
        "code-index",
        "graph-impact-diff",
        "--json",
        "--dir",
        tempDir,
        "--patch",
        rawPatch
      ]);
      const rawMcp = await session.request(5, "tools/call", {
        name: "workspace_code_index_graph_impact_diff",
        arguments: { patchText: rawPatch }
      });
      const rawMcpVerbose = await session.request(6, "tools/call", {
        name: "workspace_code_index_graph_impact_diff",
        arguments: { patchText: rawPatch, verbose: true }
      });

      assert.equal(rawMcp.structuredContent.verbose, false);
      assert.ok(rawMcp.structuredContent.graph_impact_summary);
      assert.equal(Object.prototype.hasOwnProperty.call(rawMcp.structuredContent, "new_paths"), false);

      assert.deepEqual(rawMcpVerbose.structuredContent.new_paths, ["packages/app/src/raw-added.mjs"]);

      await writeFile(
        path.join(tempDir, "packages", "app", "src", "core.mjs"),
        [
          "export function handleGraphState() {",
          "  return 'graph_state live_git';",
          "}",
          ""
        ].join("\n"),
        "utf8"
      );
      await runCli([
        "code-index",
        "graph-impact-diff",
        "--json",
        "--dir",
        tempDir,
        "--live-git"
      ]);
      const liveMcp = await session.request(7, "tools/call", {
        name: "workspace_code_index_graph_impact_diff",
        arguments: { liveGit: true }
      });
      const liveMcpVerbose = await session.request(8, "tools/call", {
        name: "workspace_code_index_graph_impact_diff",
        arguments: { liveGit: true, verbose: true }
      });

      assert.equal(
        Object.prototype.hasOwnProperty.call(liveMcp.structuredContent, "dirty_state"),
        false,
        "compact graph_impact_diff response must not mirror dirty_state at the top level"
      );
      assert.equal(liveMcp.structuredContent.graph_impact_summary.graph_state.dirty_state, "dirty_worktree");
      assert.equal(Object.prototype.hasOwnProperty.call(liveMcp.structuredContent, "affected_paths"), false, "compact response must not expose affected_paths");

      assert.ok(liveMcpVerbose.structuredContent.affected_paths.includes("packages/app/src/core.mjs"));
    } finally {
      await session.close();
    }
  });
});

test("MCP workspace code index context uses dirty overlay when no artifact exists", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await initSidecarImpactRepo(tempDir);
    await writeFile(
      path.join(tempDir, "packages", "app", "src", "dirty-overlay.mjs"),
      "export const dirtyOverlay = true;\n",
      "utf8"
    );
    await writeFile(
      path.join(tempDir, "packages", "app", "src", "dirty-overlay.test.mjs"),
      "import './dirty-overlay.mjs';\n",
      "utf8"
    );

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const status = await session.request(2, "tools/call", {
        name: "workspace_code_index_status",
        arguments: {}
      });

      const context = await session.request(3, "tools/call", {
        name: "workspace_code_index_context_for_path",
        arguments: { path: "packages/app/src/dirty-overlay.mjs", verbose: true }
      });

      assert.equal(status.structuredContent.workspaceRepo, "demo");
      assert.equal(status.structuredContent.dirty_state, "dirty_worktree");
      assert.equal(status.structuredContent.staleness, "missing");
      assert.equal(context.structuredContent.workspaceRepo, "demo");
      assert.equal(context.structuredContent.dirty_state, "dirty_worktree");
      assert.equal(context.structuredContent.staleness, "missing");
      assert.equal(context.structuredContent.overlay_state, "included");
      assert.equal(context.structuredContent.context.path, "packages/app/src/dirty-overlay.mjs");
      assert.ok(
        context.structuredContent.context.likely_tests.includes(
          "packages/app/src/dirty-overlay.test.mjs"
        )
      );
      assert.ok(
        context.structuredContent.derived_evidence.some(
          (entry) =>
            entry.kind === "sidecar_dirty_worktree_overlay" &&
            entry.overlay_state === "included"
        )
      );
    } finally {
      await session.close();
    }
  });
});
