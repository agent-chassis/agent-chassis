

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { run } from "../../packages/wiki-cli/src/run.mjs";
import {
  createTestFixture,
  resolveTestFixtureRoot,
  withTestFixture
} from "../helpers/test-fixture.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const tempDirPrefix = "agent-chassis-test-";

export async function resolveWikiCoreTempRoot(root) {
  try {
    return root === undefined
      ? await resolveTestFixtureRoot()
      : await resolveTestFixtureRoot(root);
  } catch (error) {
    throw new Error(`wiki-core test temp root rejected: ${error.message}`, { cause: error });
  }
}

export async function withTempDir(fn, { root } = {}) {
  const options = root === undefined
    ? { prefix: tempDirPrefix }
    : { root, prefix: tempDirPrefix };
  return withTestFixture(({ rootPath }) => fn(rootPath), options);
}

export async function captureConsoleLog(fn) {
  const originalConsoleLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };

  try {
    await fn();
  } finally {
    console.log = originalConsoleLog;
  }

  return lines.join("\n");
}

export function createMarkdownGraphImpactProvider({
  graphAvailable = true,
  dirtyState = "dirty_worktree",
  staleness = "fresh",
  edgeSource = graphAvailable ? "dirty_overlay" : "unavailable",
  dirtyGraphMode = graphAvailable ? "overlay_parsed" : "unavailable",
  statusReason = graphAvailable ? "dirty_overlay_graph_extracted" : "graph_absent"
} = {}) {
  const calls = [];
  const provider = async ({ dir, paths }) => {
    const inputPaths = [...new Set((Array.isArray(paths) ? paths : []).map((value) => String(value)))]
      .sort((left, right) => left.localeCompare(right));
    calls.push({ dir, paths: inputPaths });
    return {
      schema_version: "repo-code-index.v1",
      source_kind: "code_index",
      canonicality: "derived",
      evidence_basis: graphAvailable ? "path_match" : "unknown",
      index_head: "sha256:graph-impact-fixture-head",
      index_tree: "sha256:graph-impact-fixture-tree",
      dirty_state: dirtyState,
      staleness,
      graph_state: {
        graph_available: graphAvailable,
        edge_source: edgeSource,
        dirty_graph_mode: dirtyGraphMode,
        graph_schema_version: graphAvailable ? "repo-code-graph.v1" : null,
        status_reason: statusReason
      },
      input_paths: inputPaths,
      validated_paths: inputPaths,
      invalid_paths: [],
      validation_hints: [],
      graph_nodes: [],
      graph_edges: [],
      structural_impacts: [],
      missing_update_hints: []
    };
  };
  provider.calls = calls;
  return provider;
}

export function expectedMarkdownGraphProvenance({
  graphAvailable = true,
  dirtyState = "dirty_worktree",
  staleness = "fresh",
  edgeSource = graphAvailable ? "dirty_overlay" : "unavailable",
  dirtyGraphMode = graphAvailable ? "overlay_parsed" : "unavailable",
  statusReason = graphAvailable ? "dirty_overlay_graph_extracted" : "graph_absent",
  inputPaths = []
} = {}) {
  const provenance = {
    dirty_state: dirtyState,
    staleness,
    graph_available: graphAvailable,
    edge_source: edgeSource,
    dirty_graph_mode: dirtyGraphMode
  };
  if (statusReason) {
    provenance.status_reason = statusReason;
  }
  if (inputPaths.length > 0) {
    provenance.input_paths = [...new Set(inputPaths.map((value) => String(value)))].sort((left, right) =>
      left.localeCompare(right)
    );
  }
  if (graphAvailable) {
    provenance.graph_schema_version = "repo-code-graph.v1";
  }
  return provenance;
}

export function buildMinimalWorkRecordJson({ id, title, status, ...overrides } = {}) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/app-demo",
    title,
    record_kind: "work_item",
    work_kind: "implementation",
    status,
    priority: "medium",
    owner: "codex",
    created: "2026-04-13",
    updated: "2026-04-13",
    initiative: null,
    area: null,
    resolution: "unresolved",
    severity: null,
    target: null,
    started: null,
    completed: null,
    tags: [],
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    assignees: [],
    agents: [],
    reviewers: [],
    children: [],
    slices: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: [],
      validation: []
    },
    sections: {
      summary: "",
      why_it_matters: "",
      scope: {
        items: [],
        out_of_scope: []
      },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    escalations: [],
    projections: [],
    migration: null,
    ...overrides
  };
}

export function buildDispatchReadinessForWorkRecord(id) {
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: id,
    unit: {
      kind: "work_item",
      address: id,
      record_id: id,
      slice_id: null
    },
    decision_code: "dispatchable",
    dispatchable: true,
    clusters: [],
    state: {
      graph_available: false,
      dirty_state: "clean",
      staleness: "fresh",
      graph_state: {
        graph_available: false,
        edge_source: "unavailable",
        dirty_graph_mode: "unavailable",
        unavailable_paths: []
      }
    },
    reasons: [],
    accepted_escalations: [],
    blast_radius: {
      level: "low",
      reasons: [],
      accepted_escalation_id: null
    }
  };
}

export async function writeMinimalWorkRecordJson(tempDir, { id, title, status }) {
  const jsonPath = path.join(tempDir, "wiki", "work-records", `${id}.json`);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(buildMinimalWorkRecordJson({ id, title, status }), null, 2)}\n`, "utf8");
  return jsonPath;
}

export function issueMarkdownRelativeFile(id) {
  return path.join("wiki", "issues", `${id}.md`);
}

export function buildValidChildReference(id, relation) {
  return {
    repo: "agent-chassis/app-demo",
    id,
    relation,
    title: `${id} child`,
    work_kind: "implementation",
    status: "todo",
    cluster_expectation: {
      expected_cluster_count: 1,
      reason: "child reference fixture"
    },
    sequencing: {
      after: [],
      before: [],
      parallel_group: null
    },
    dispatch_unit_ref: `${id}#slice`
  };
}

export function buildValidSlice(id, title = `${id} slice`) {
  return {
    id,
    title,
    work_kind: "implementation",
    status: "todo",
    write_scope: [],
    repo_paths: [],
    read_scope: [],
    depends_on: [],
    acceptance: {
      criteria: [],
      validation: []
    },
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    }
  };
}

export function getCount(summary, type) {
  const line = summary
    .split("\n")
    .find((entry) => entry.startsWith(`| ${type} |`));
  assert.ok(line, `missing summary row for ${type}`);
  return Number.parseInt(line.split("|")[3].trim(), 10);
}

export async function runWorkRecordsCli(args, { dir, extraArgs = [] } = {}) {
  const lines = [];
  const originalConsoleLog = console.log;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  console.log = (...values) => {
    lines.push(values.map((value) => String(value)).join(" "));
  };

  try {
    await run([...args, "--dir", dir, ...extraArgs]);
  } finally {
    console.log = originalConsoleLog;
  }

  const stdout = lines.join("\n");
  const status = process.exitCode ? Number(process.exitCode) : 0;
  if (originalExitCode === undefined) {
    process.exitCode = undefined;
  } else {
    process.exitCode = originalExitCode;
  }
  return { status, stdout };
}

export function cloneJsonForTest(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function writeMinimalWorkRecordJsonWithSlice(tempDir, { id, title, status, sliceId }) {
  const record = buildMinimalWorkRecordJson({ id, title, status });
  record.slices = [
    {
      ...buildValidSlice(sliceId, `${sliceId} slice`),
      sections: {
        summary: "",
        scope: { items: [], out_of_scope: [] },
        tasks: [{ text: "Slice pending task", status: "todo" }],
        closure: null
      }
    }
  ];
  const jsonPath = path.join(tempDir, "wiki", "work-records", `${id}.json`);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return jsonPath;
}

async function assertTempRootRejected(root) {
  await assert.rejects(
    async () => resolveWikiCoreTempRoot(root),
    /wiki-core test temp root/,
    `expected temp root rejection for ${root}`
  );
}

async function runWikiCoreHelperSelfTest() {
  const originalEnv = {
    HOME: process.env.HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME
  };
  const selfTestFixture = await createTestFixture({ prefix: "agent-chassis-helper-selftest-" });
  const selfTestRoot = selfTestFixture.rootPath;

  try {
    await withTempDir(async (tempDir) => {
      assert.ok(path.basename(tempDir).startsWith(tempDirPrefix));
    });

    const xdgRoot = path.join(selfTestRoot, "xdg-cache");
    await mkdir(xdgRoot, { recursive: true });
    process.env.XDG_CACHE_HOME = xdgRoot;

    const rejectionRoots = [
      repoRoot,
      path.join(repoRoot, "tests"),
      path.join(repoRoot, "docs"),
      path.join(repoRoot, "wiki"),
      process.env.HOME,
      process.env.XDG_CACHE_HOME
    ].filter(Boolean);
    for (const root of rejectionRoots) {
      await assertTempRootRejected(root);
    }

    const symlinkCases = [
      ["repo-link", repoRoot],
      ["home-link", process.env.HOME],
      ["xdg-link", process.env.XDG_CACHE_HOME]
    ].filter(([, target]) => Boolean(target));
    for (const [name, target] of symlinkCases) {
      const linkPath = path.join(selfTestRoot, name);
      await symlink(target, linkPath);
      await assertTempRootRejected(linkPath);
    }
  } finally {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await selfTestFixture.dispose();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runWikiCoreHelperSelfTest();
}
