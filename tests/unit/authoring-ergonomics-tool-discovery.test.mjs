

import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeToolDiscoveryTools,
  loadToolDiscoveryDescriptor,
  queryToolDiscoveryDescriptor,
  resolveToolTierVisibility,
  validateToolDiscoveryDescriptor
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import {
  AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH,
  AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS,
  AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS,
  AUTHORING_ERGONOMICS_ROUTING_STATES
} from "../../packages/wiki-core/src/operations/authoring-ergonomics.mjs";
import {
  AUTHORING_ERGONOMICS_REPORT_FIRST_CALL_EXAMPLES,
  AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME,
  AUTHORING_ERGONOMICS_REPORT_TOOL_NAME
} from "../../packages/wiki-mcp/src/lib/authoring-ergonomics-tools.mjs";
import { shouldExposeTool } from "../../packages/wiki-mcp/src/lib/tool-profile.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FRAGMENT_RELATIVE_PATH = "packages/wiki-core/data/tool-discovery/mcp-tools.json";
const MANIFEST_RELATIVE_PATH = "packages/wiki-core/data/tool-discovery/manifest.json";
const SERVER_RELATIVE_PATH = "packages/wiki-mcp/src/server.mjs";

const REQUIRED_SOURCE_FILES = Object.freeze([
  "packages/wiki-core/src/operations/authoring-ergonomics.mjs",
  "packages/wiki-mcp/src/lib/authoring-ergonomics-tools.mjs",
  "packages/wiki-mcp/src/server.mjs"
]);

const DOC_RELATIVE_PATHS = Object.freeze([
  "docs/mcp-operation-reference.md",
  "docs/mcp-integration.md",
  "docs/tool-discovery.md"
]);
const QUERY_DOC_RELATIVE_PATHS = Object.freeze([
  ...DOC_RELATIVE_PATHS,
  "docs/agent-tool-compliance-and-surface-rationalization.md"
]);

async function readRepoFile(relativePath) {
  return readFile(path.join(REPO_ROOT, relativePath), "utf8");
}

async function readRepoJson(relativePath) {
  return JSON.parse(await readRepoFile(relativePath));
}

async function descriptorEntry(toolName = AUTHORING_ERGONOMICS_REPORT_TOOL_NAME) {
  const descriptor = await loadToolDiscoveryDescriptor();
  const entry = descriptor.tools.find((tool) => tool.tool_name === toolName);
  assert.ok(entry, `${toolName} must be in the assembled descriptor`);
  return { descriptor, entry };
}

test("the report tool is a rich, installed, supported, free/local read-only descriptor entry", async () => {
  const { descriptor, entry } = await descriptorEntry();

  assert.equal(validateToolDiscoveryDescriptor(descriptor).valid, true);
  assert.equal(entry.kind, "mcp_tool");
  assert.equal(entry.entrypoint, AUTHORING_ERGONOMICS_REPORT_TOOL_NAME);
  assert.equal(entry.install_state, "installed");
  assert.equal(entry.runtime_posture, "supported");
  assert.equal(entry.recommended_route, "mcp");
  assert.ok(typeof entry.display_name === "string" && entry.display_name.length > 0);
  assert.ok(Number.isInteger(entry.priority) && entry.priority >= 0);

  assert.deepEqual(entry.side_effects, ["read_only"]);
  assert.ok(resolveToolTierVisibility(entry).includes("free_local"));
  assert.ok(entry.authority.length > 0);
});

test("the descriptor advertises source and durable-document references that exist", async () => {
  const { entry } = await descriptorEntry();

  for (const required of REQUIRED_SOURCE_FILES) {
    assert.ok(
      entry.source_files.includes(required),
      `${required} must be advertised so ownership routing can resolve it`
    );
  }

  for (const relativePath of [...entry.source_files, ...entry.docs_refs]) {
    await access(path.join(REPO_ROOT, relativePath));
  }
  for (const doc of DOC_RELATIVE_PATHS) {
    assert.ok(entry.docs_refs.includes(doc), `${doc} must be advertised as a durable reference`);
  }
});

test("the descriptor makes a first call executable without a diagnostic round trip", async () => {
  const { entry } = await descriptorEntry();
  const text = [entry.summary ?? "", entry.notes ?? "", JSON.stringify(entry.recommended_first_call ?? {})].join(" ");

  assert.ok(text.includes(JSON.stringify(
    AUTHORING_ERGONOMICS_REPORT_FIRST_CALL_EXAMPLES.workspace_errors_log
  ).replace(/^\{|\}$/g, "")));
  assert.equal(entry.recommended_first_call.arguments.source_kind, "workspace_errors_log");
  assert.equal(entry.recommended_first_call.omit_null_arguments, true);
  for (const kind of AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS) {
    assert.ok(text.includes(kind), `the descriptor must name the ${kind} source form`);
  }
  assert.ok(text.includes(AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH));
  for (const state of AUTHORING_ERGONOMICS_ROUTING_STATES) {
    assert.ok(text.includes(state), `the descriptor must name the ${state} routing state`);
  }
  assert.ok(/no caller path|no path/i.test(text), "the descriptor must state that no caller path is accepted");
});

test("the discovery read surfaces return the entry", async () => {
  const { descriptor } = await descriptorEntry();

  const described = describeToolDiscoveryTools(descriptor, {
    tool_name: AUTHORING_ERGONOMICS_REPORT_TOOL_NAME,
    verbose: true
  });
  assert.equal(described.length, 1);
  assert.equal(described[0].tool_name, AUTHORING_ERGONOMICS_REPORT_TOOL_NAME);
  assert.equal(described[0].runtime_posture, "supported");
  assert.ok(described[0].summary.length > 0, "the describe projection must carry a summary");

  const queried = queryToolDiscoveryDescriptor(descriptor, {
    tool_name: AUTHORING_ERGONOMICS_REPORT_TOOL_NAME
  });
  assert.equal(queried.length, 1);
  assert.equal(queried[0].tool_name, AUTHORING_ERGONOMICS_REPORT_TOOL_NAME);
});

test("the companion query publishes the complete current-contract retrieval surface", async () => {
  const { entry } = await descriptorEntry(AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME);
  assert.equal(entry.kind, "mcp_tool");
  assert.equal(entry.install_state, "installed");
  assert.equal(entry.runtime_posture, "supported");
  assert.deepEqual(entry.side_effects, ["read_only"]);
  const text = [entry.summary, entry.notes, JSON.stringify(entry.recommended_first_call),
    JSON.stringify(entry.use_when), JSON.stringify(entry.do_not_use_when)]
    .join(" ");
  assert.equal(AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS.length, 10);
  assert.equal(entry.recommended_first_call.operation, AUTHORING_ERGONOMICS_REPORT_TOOL_NAME);
  assert.deepEqual(entry.recommended_first_call.arguments,
    AUTHORING_ERGONOMICS_REPORT_FIRST_CALL_EXAMPLES.workspace_errors_log);
  assert.equal(text.includes("<identity-from-report>"), false);
  assert.match(text, /authenticated immutable/i);
  assert.match(text, /exact/i);
  assert.match(text, /expired/i);
});

test("the fragment manifest counts agree with the checked-in fragment", async () => {
  const fragment = await readRepoJson(FRAGMENT_RELATIVE_PATH);
  const manifest = await readRepoJson(MANIFEST_RELATIVE_PATH);

  assert.equal(fragment.tool_count, fragment.tools.length);
  assert.ok(
    fragment.tools.some((tool) => tool.tool_name === AUTHORING_ERGONOMICS_REPORT_TOOL_NAME),
    "the fragment must own the entry"
  );
  assert.ok(fragment.tools.some(
    (tool) => tool.tool_name === AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME
  ));

  const declared = manifest.fragments.find((entry) => entry.file === "mcp-tools.json");
  assert.ok(declared);
  assert.equal(declared.tool_count, fragment.tool_count);
  assert.equal(
    manifest.expected_tool_count,
    manifest.fragments.reduce((total, entry) => total + entry.tool_count, 0)
  );
});

test("exactly one fragment owns the tool name", async () => {
  const manifest = await readRepoJson(MANIFEST_RELATIVE_PATH);
  let owners = 0;
  for (const declared of manifest.fragments) {
    const fragment = await readRepoJson(`packages/wiki-core/data/tool-discovery/${declared.file}`);
    if (fragment.tools.some((tool) => tool.tool_name === AUTHORING_ERGONOMICS_REPORT_TOOL_NAME)) owners += 1;
  }
  assert.equal(owners, 1);

  let queryOwners = 0;
  for (const declared of manifest.fragments) {
    const fragment = await readRepoJson(`packages/wiki-core/data/tool-discovery/${declared.file}`);
    if (fragment.tools.some(
      (tool) => tool.tool_name === AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME
    )) queryOwners += 1;
  }
  assert.equal(queryOwners, 1);
});

test("the central role policy grants the tool to the advisory reading roles", async () => {
  const policy = await readRepoJson(
    "packages/wiki-core/data/tool-discovery/session-role-tool-access.json"
  );
  const granted = policy.access[AUTHORING_ERGONOMICS_REPORT_TOOL_NAME];

  assert.ok(Array.isArray(granted), "the registered tool must be keyed in the central access policy");
  assert.deepEqual([...granted].sort(), ["operator", "orchestrator", "redteam", "reviewer"]);

  assert.equal(granted.includes("worker"), false, "the closed-input delivery role gets no evidence read");

  for (const role of ["orchestrator", "reviewer", "redteam", "operator"]) {
    assert.equal(
      shouldExposeTool(role, AUTHORING_ERGONOMICS_REPORT_TOOL_NAME),
      true,
      `${role} must see the tool at the runtime gate`
    );
  }
  assert.equal(shouldExposeTool("worker", AUTHORING_ERGONOMICS_REPORT_TOOL_NAME), false);

  const queryGranted = policy.access[AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME];
  assert.deepEqual([...queryGranted].sort(), [...granted].sort());
  for (const role of granted) {
    assert.equal(shouldExposeTool(role, AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME), true);
  }
  assert.equal(shouldExposeTool("worker", AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME), false);
});

test("the composition root imports and invokes the registrar", async () => {
  const server = await readRepoFile(SERVER_RELATIVE_PATH);

  assert.ok(
    server.includes('from "./lib/authoring-ergonomics-tools.mjs"'),
    "server.mjs must import the registrar from its own module"
  );
  assert.ok(
    server.includes("registerAuthoringErgonomicsTools({"),
    "server.mjs must invoke the registrar"
  );

  assert.equal(
    server.includes(AUTHORING_ERGONOMICS_REPORT_TOOL_NAME),
    false,
    "server.mjs must not restate the tool name; registration lives in the registrar"
  );
  assert.equal(
    server.includes("buildAuthoringErgonomicsReport"),
    false,
    "server.mjs must not reach past the registrar into the operation"
  );
});

test("the durable docs document the tool, both source forms, and the routing states", async () => {
  const reference = await readRepoFile("docs/mcp-operation-reference.md");

  assert.ok(reference.includes(AUTHORING_ERGONOMICS_REPORT_TOOL_NAME));
  for (const kind of AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS) {
    assert.ok(reference.includes(kind), `the reference must document the ${kind} source form`);
  }
  for (const state of AUTHORING_ERGONOMICS_ROUTING_STATES) {
    assert.ok(reference.includes(state), `the reference must document the ${state} routing state`);
  }

  assert.ok(reference.includes('{ "source_kind": "workspace_errors_log" }'));
  assert.ok(reference.includes('"schema_version": "authoring-ergonomics-retained-smoke.v1"'));

  assert.ok(/unevaluable_missing_coverage/.test(reference));
  assert.ok(/advisory evidence/i.test(reference));
  assert.ok(/lookup_degraded/.test(reference));
  assert.ok(/read-only/i.test(reference));
  assert.ok(reference.includes(AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH));

  const { AUTHORING_ERGONOMICS_REPORT_REFUSAL_CODES } = await import(
    "../../packages/wiki-core/src/operations/authoring-ergonomics.mjs"
  );
  for (const code of AUTHORING_ERGONOMICS_REPORT_REFUSAL_CODES) {
    assert.ok(reference.includes(code), `the reference must document the ${code} refusal`);
  }
});

test("every advertised durable document carries the tool and its WK backlink", async () => {
  for (const doc of DOC_RELATIVE_PATHS) {
    const text = await readRepoFile(doc);
    assert.ok(
      text.includes(AUTHORING_ERGONOMICS_REPORT_TOOL_NAME),
      `${doc} is advertised as a durable reference and must name the tool`
    );
    assert.ok(
      text.includes("<!-- wiki: id=WK-2146 relation=tracks -->"),
      `${doc} must carry the canonical backlink for the WK that changed it`
    );
  }
  for (const doc of QUERY_DOC_RELATIVE_PATHS) {
    const text = await readRepoFile(doc);
    assert.ok(text.includes(AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME));
    assert.ok(text.includes("<!-- wiki: id=WK-2477 relation=tracks -->"));
  }
});

test("the integration and discovery pages agree with the descriptor", async () => {
  const integration = await readRepoFile("docs/mcp-integration.md");
  const discovery = await readRepoFile("docs/tool-discovery.md");

  assert.ok(/failure_only|failure journal/.test(integration));
  assert.ok(integration.includes("unevaluable_missing_coverage"));
  assert.ok(integration.includes("lookup_degraded"));

  assert.ok(discovery.includes("source_files"));
  assert.ok(discovery.includes("owner_unresolved"));
  assert.ok(discovery.includes("lookup_degraded"));
});
