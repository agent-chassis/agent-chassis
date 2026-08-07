import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { validateWorkRecordDispatchById } from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";
import { SidecarGraphIndexUnbuildableError } from "../packages/wiki-core/src/lib/sidecar-graph-impact-artifact.mjs";
import { validateWorkRecord } from "../packages/wiki-core/src/lib/work-record-schema.mjs";
import { registerWorkRecordReadTools } from "../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import { jsonContent, errorContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { createCompactValidateDispatchResponse } from "../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";

const UNIT = "WK-9002"; const exec = promisify(execFile);
const paths = ["src/a.mjs", "tests/a.test.mjs"];
const record = {
  schema_version: "work-record.v1", id: UNIT, repo: "test/fixture", title: "committed graph", record_kind: "work_item", work_kind: "implementation", status: "todo", priority: "medium", owner: "unassigned", created: "2026-08-03", updated: "2026-08-03", initiative: "IN-0001",
  read_scope: [], repo_paths: paths, write_scope: paths, depends_on: [], blocks: [], related: [], dispatch_intent: { intended_agent_role: "worker", target_unit: "record", requires_graph_impact: true, requires_escalation: false }, acceptance: { criteria: ["committed graph is used"], validation: ["node --test"] },
  sections: { summary: "fixture", why_it_matters: "fixture", scope: { items: ["graph"], out_of_scope: [] }, tasks: [], references: [], agent_notes: "", closure: null }, children: [], slices: [], escalations: [], projections: []
};
async function fixture() {
  assert.deepEqual(validateWorkRecord(record), []);
  const dir = await mkdtemp(path.join(tmpdir(), "dispatch-committed-"));
  await mkdir(path.join(dir, "wiki/work-records"), { recursive: true }); await mkdir(path.join(dir, "src")); await mkdir(path.join(dir, "tests"));
  await writeFile(path.join(dir, ".gitignore"), ".cache/\n"); await writeFile(path.join(dir, "src/a.mjs"), "export const a=1;\n"); await writeFile(path.join(dir, "tests/a.test.mjs"), "import '../src/a.mjs';\n");
  await writeFile(path.join(dir, `wiki/work-records/${UNIT}.json`), `${JSON.stringify(record)}\n`);
  await exec("git", ["init", "-q"], { cwd: dir }); await exec("git", ["add", "."], { cwd: dir }); await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"], { cwd: dir });
  return dir;
}
function store(dir, reads) { const resolve = (p) => path.isAbsolute(p) ? p : path.join(dir, p); return { capabilities: { live_worktree: true }, async pathExists(p) { try { await access(resolve(p)); return true; } catch { return false; } }, async readText(p) { reads.count += 1; return readFile(resolve(p), "utf8"); }, async listJsonPaths() { return []; } }; }
function envelope(selectedUnit, subjectPaths = paths) { return { schema_version: "committed-head-graph-impact.v1", outcome: "available", available: true, selected_unit: selectedUnit, projection: { subject_paths: subjectPaths }, input_paths: subjectPaths, validated_paths: subjectPaths, invalid_paths: [], graph_import_adjacency: [], graph_state: { graph_available: true, edge_source: "base_index", dirty_graph_mode: "base_index_only", graph_schema_version: "repo-code-graph.v1", unavailable_paths: [], dirty_state: "unknown", staleness: "fresh" } }; }
async function run(dir, action = "use", queryResult = null, builderError = null) {
  const calls = { status: 0, build: 0, query: 0, reads: { count: 0 } };
  const result = await validateWorkRecordDispatchById({ dir, unitAddress: UNIT, recordStore: store(dir, calls.reads), graph_resolver: {
    async statusReader() { calls.status += 1; return { index_action: action }; },
    async builder() { calls.build += 1; if (builderError) throw builderError; await mkdir(path.join(dir, ".cache"), { recursive: true }); await writeFile(path.join(dir, ".cache/index.json"), "cache\n"); },
    async query({ selectedUnit, subject }) { calls.query += 1; assert.deepEqual([...subject.write_scope, ...subject.repo_paths], [...paths, ...paths]); return queryResult?.(selectedUnit) ?? envelope(selectedUnit); }
  } });
  assert.equal(calls.status, 1); assert.equal(calls.query, builderError ? 0 : 1); assert.equal(calls.build, action === "rebuild" ? 1 : 0); assert.equal(calls.reads.count, 1);
  return result;
}

test("fresh reuse, rebuild states, worktree independence, and cache-only mutation", async () => {
  const dir = await fixture(); try {
    const canonical = await readFile(path.join(dir, `wiki/work-records/${UNIT}.json`));
    const clean = await run(dir); assert.equal(clean.state.graph_available, true); await assert.rejects(access(path.join(dir, ".cache/index.json")), { code: "ENOENT" });
    for (const state of ["absent", "stale", "corrupt", "incompatible"]) { const ready = await run(dir, "rebuild"); assert.equal(ready.state.graph_available, true, state); }
    await writeFile(path.join(dir, "src/a.mjs"), "export const a=2;\n"); await exec("git", ["add", "src/a.mjs"], { cwd: dir }); await rm(path.join(dir, "tests/a.test.mjs")); await writeFile(path.join(dir, "untracked.mjs"), "x\n"); await writeFile(path.join(dir, ".cache/ignored"), "x\n");
    const dirty = await run(dir); assert.equal(dirty.decision_code, clean.decision_code); assert.deepEqual(await readFile(path.join(dir, `wiki/work-records/${UNIT}.json`)), canonical); assert.match((await exec("git", ["status", "--short"], { cwd: dir })).stdout, /src\/a\.mjs|tests\/a\.test\.mjs|untracked\.mjs/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("failed build and post-build identity/projection failures are typed and bounded", async () => {
  const dir = await fixture(); try {
    const failed = await run(dir, "rebuild", null, new SidecarGraphIndexUnbuildableError("secret")); assert.equal(failed.graph_impact_failure.code, "graph_index_unbuildable"); assert.doesNotMatch(JSON.stringify(failed), /secret/);
    for (const outcome of ["base_artifact_unavailable", "base_artifact_corrupt", "base_artifact_incompatible", "repository_head_unstable"]) { const result = await run(dir, "rebuild", (unit) => ({ schema_version: "committed-head-graph-impact.v1", available: false, outcome, selected_unit: unit, graph_state: { graph_available: false } })); assert.equal(result.graph_impact_failure.code, outcome); }
    for (const substitute of [[paths[0]], [...paths, "caller.mjs"]]) { const result = await run(dir, "use", (unit) => envelope(unit, substitute)); assert.equal(result.graph_impact_failure.code, "selected_unit_projection_mismatch"); }
    await assert.rejects(validateWorkRecordDispatchById({ dir, unitAddress: UNIT, paths: [] }), { code: "invalid_dispatch_option" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("registered workspace_validate_dispatch preserves the pre-WK-1957 fail-closed route", async () => {
  const dir = await fixture(); try {
    const handlers = new Map(); registerWorkRecordReadTools({ registerTool: (name, _schema, handler) => handlers.set(name, handler), workspaceRepos: [{ repo: "test/fixture", dir }], z, jsonContent, errorContent, resolveWorkspaceRepo: (repos) => repos[0], createCompactValidateDispatchResponse });
    const payload = JSON.parse((await handlers.get("workspace_validate_dispatch")({ unit: UNIT, verbose: true })).content[0].text); assert.equal(payload.readiness.decision_code, "missing_graph_impact"); await assert.rejects(access(path.join(dir, ".cache/index.json")), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("source shape discriminates legacy overlay, duplicate build/query/read, and caller scope", async () => {
  const source = await readFile("packages/wiki-core/src/lib/work-record-dispatch.mjs", "utf8"); const body = source.split("export async function validateWorkRecordDispatchById")[1].split("\n}\n\nfunction reviewedUnitDigestForDispatch")[0];
  assert.doesNotMatch(source, /graph_resolver \?\? resolveCurrentGraphForImpact/); assert.equal(body.match(/rebuildGraphIndexAtHead/g)?.length, 1); assert.equal(body.match(/getCommittedHeadGraphImpactPaths/g)?.length, 1); assert.equal(body.match(/await loadWorkRecordById\(\{/g)?.length, 1); assert.match(body, /projectSelectedUnitGraphBearingPaths\(\{\s*selectedUnit: parsedUnit\.value,\s*subject/); assert.doesNotMatch(source.match(/VALIDATE_WORK_RECORD_DISPATCH_OPTION_KEYS = new Set\(\[([\s\S]*?)\]\)/)[1], /"paths"/);
});
