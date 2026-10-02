

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH,
  AUTHORING_ERGONOMICS_LOOKUP_ROUTES,
  AUTHORING_ERGONOMICS_REPORT_AUTHORITY,
  AUTHORING_ERGONOMICS_REPORT_OPERATION_SCHEMA_VERSION,
  AUTHORING_ERGONOMICS_REPORT_REFUSAL_CODES,
  AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS,
  AUTHORING_ERGONOMICS_ROUTING_DEGRADATION_REASONS,
  AUTHORING_ERGONOMICS_ROUTING_STATES,
  AuthoringErgonomicsReportError,
  assertAuthoringErgonomicsProjectionInventory,
  buildAuthoringErgonomicsReport,
  loadAuthoringErgonomicsCanonicalEvidence,
  loadAuthoringErgonomicsCodeIndexEvidence,
  loadAuthoringErgonomicsDiscoveryEvidence,
  parseAuthoringErgonomicsReportRequest,
  projectAuthoringErgonomicsCompactReport,
  projectAuthoringErgonomicsReportPage,
  projectAuthoringErgonomicsReportPageContext,
  routeAuthoringErgonomicsClusters
} from "../../packages/wiki-core/src/operations/authoring-ergonomics.mjs";
import {
  AUTHORING_ERGONOMICS_RETAINED_SMOKE_SCHEMA_VERSION
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-adapters.mjs";
import {
  AUTHORING_ERGONOMICS_AXES
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-trace.mjs";
import {
  AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES
} from "../../packages/wiki-core/src/lib/authoring-ergonomics-conformance.mjs";

const THIS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(THIS_DIR, "..");
const MODULE_PATH = path.join(REPO_ROOT, "packages/wiki-core/src/operations/authoring-ergonomics.mjs");

const EFFECT_GATE = "authoring-ergonomics.zero-normal-success-without-verified-effect.v1";
const NEXT_CALL_GATE = "authoring-ergonomics.zero-advertised-nonexecutable-next-call.v1";
const PUBLIC_CONTINUATION_GATE = "authoring-ergonomics.zero-unreachable-public-continuation.v1";

const ABSTRACT_BOUNDARY_TOOL = "abstract_authoring_tool";

function journalSection(token, tool, request, failure) {
  return [
    `=== ${token}: ${tool} ===`,
    "REQUEST:",
    JSON.stringify(request, null, 2),
    "FAILURE:",
    JSON.stringify(failure, null, 2),
    ""
  ].join("\n");
}

function typedRefusalWithoutRoute(reasonCode) {
  return {
    content: [{ type: "text", text: JSON.stringify({ reason_code: reasonCode }) }],
    structuredContent: {
      schema_version: "abstract-contract-mcp-refusal.v1",
      ok: false,
      warning: {
        code: "abstract_request_refused",
        severity: "blocking",
        payload: {
          schema_version: "abstract-refusal-payload.v1",
          reason_code: reasonCode,
          details: { contract_family: "abstract-contract.v1", stage: "contract_required" }
        }
      }
    },
    isError: true
  };
}

function abstractJournal(tool = ABSTRACT_BOUNDARY_TOOL) {
  return [
    journalSection("RUN-1", tool, { repo: "abstract", unit: "WK-0001" },
      typedRefusalWithoutRoute("abstract_stage_required")),
    journalSection("RUN-1", tool, { repo: "abstract", unit: "WK-0001" },
      typedRefusalWithoutRoute("abstract_stage_required"))
  ].join("\n");
}

const GEN = {
  identity_kind: "carrier_generation",
  identity_value: "GEN-1",
  descriptor_digest: "sha256:gen-1"
};
const COMPLETE_FAMILIES = [
  "tool_discovery",
  "tool_call",
  "continuation",
  "persistence_receipt",
  "authoritative_ref_observation"
];

function retainedEnvelope(captureOverrides = {}) {
  return {
    schema_version: AUTHORING_ERGONOMICS_RETAINED_SMOKE_SCHEMA_VERSION,
    trace_id: "RETAINED-ABSTRACT",
    retained_source: {
      source_kind: "retained_smoke",
      source_locator: "retained://abstract",
      source_digest: "sha256:abstract",
      source_ordinal: 0
    },
    workload_label: "abstract",
    observed_identities: { repository: "abstract-repo", records: ["WK-0001"], focus: null },
    sessions: [{ session_token: "RUN-1", source_ordinal: 0 }],
    capture: {
      declarations: [
        {
          event_families: COMPLETE_FAMILIES,
          capture_mode: "all_calls",
          captured_record_count: 3,
          total_record_count: 3,
          ...captureOverrides
        }
      ]
    },
    observations: [
      {
        kind: "mcp_call",
        session_token: "RUN-1",
        tool: ABSTRACT_BOUNDARY_TOOL,
        diagnostic: false,
        target: { target_kind: "work_record", target_id: "WK-0001" },
        authoritative_identity: GEN,
        response: {
          transport_status: "ok",
          application_status: "normal",
          producer_family: "abstract-contract.v1",
          route_present: true,
          replacement_call: {
            tool: "abstract_next_tool",
            ingress: "mcp",
            named_tool_available: true,
            structural_only: false
          }
        },
        receipt: { receipt_state: "present", receipt_id: "RCPT-1" },
        claimed_effects: [{ effect_kind: "carrier_persisted", effect_target: "CS-1" }]
      },
      {
        kind: "carrier_observation",
        session_token: "RUN-1",
        carrier_id: "CS-1",
        lifecycle_stage: "wk_ref",
        presence: "present",
        content_identity: "sha256:cs-1",
        authoritative_identity: GEN
      }
    ]
  };
}

function failureOnlyRetainedEnvelope() {
  const envelope = retainedEnvelope();
  envelope.capture.declarations = [
    { event_families: COMPLETE_FAMILIES, capture_mode: "failures_only" }
  ];
  return envelope;
}

async function makeFixtureRepo(t, { journal = abstractJournal(), records = [] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "authoring-ergonomics-op-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "wiki", "work-records"), { recursive: true });
  if (journal !== null) {
    await writeFile(path.join(dir, AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH), journal, "utf8");
  }
  for (const record of records) {
    await writeFile(
      path.join(dir, "wiki", "work-records", `${record.id}.json`),
      typeof record.body === "string" ? record.body : JSON.stringify(record.body, null, 2),
      "utf8"
    );
  }
  return dir;
}

async function snapshotTree(dir) {
  const entries = [];
  async function walk(current, prefix) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      const absolute = path.join(current, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        entries.push(`dir:${relative}`);
        await walk(absolute, relative);
        continue;
      }
      const digest = createHash("sha256").update(await readFile(absolute)).digest("hex");
      entries.push(`file:${relative}:${digest}`);
    }
  }
  await walk(dir, "");
  return entries;
}

function gateOf(report, identity) {
  const gate = report.conformance.evaluation.gates.find((entry) => entry.identity === identity);
  assert.ok(gate, `${identity} must be evaluated`);
  return gate;
}

async function expectRefusal(promiseOrThunk, code) {
  await assert.rejects(
    async () => (typeof promiseOrThunk === "function" ? promiseOrThunk() : promiseOrThunk),
    (error) => {
      assert.ok(
        error instanceof AuthoringErgonomicsReportError,
        `expected a typed report refusal, received ${error?.name}: ${error?.message}`
      );
      assert.equal(error.code, code, `expected refusal code ${code}, received ${error.code}`);
      assert.ok(
        AUTHORING_ERGONOMICS_REPORT_REFUSAL_CODES.includes(error.code),
        `${error.code} must be in the closed refusal vocabulary`
      );
      assert.equal(error.envelope.ok, false);
      assert.equal(error.envelope.refusal.code, code);
      assert.equal(
        error.envelope.schema_version,
        AUTHORING_ERGONOMICS_REPORT_OPERATION_SCHEMA_VERSION
      );
      return true;
    }
  );
}

const MODULE_CODE = readFileSync(MODULE_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const ALLOWED_IMPORT_SPECIFIERS = Object.freeze([
  "@agent-chassis/controlled-contract",
  "node:fs/promises",
  "node:path",
  "../lib/authoring-ergonomics-adapters.mjs",
  "../lib/authoring-ergonomics-trace.mjs",
  "../lib/authoring-ergonomics-conformance.mjs",
  "../lib/authoring-ergonomics-code-index.mjs",
  "../lib/tool-discovery.mjs",
  "../lib/work-record-store.mjs"
]);

function moduleImportSpecifiers() {
  return [...MODULE_CODE.matchAll(/^\s*import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((match) => match[1]);
}

test("the operation carries no static tool-to-record, tool-to-source, or workload table", () => {

  for (const prefix of ["WK", "DEC", "IN", "SRC"]) {
    assert.equal(
      new RegExp(`\\b${prefix}-\\d{3,}`).test(MODULE_CODE),
      false,
      `no ${prefix}-* identifier may appear in the operation code`
    );
  }

  const ownVocabulary = new Set([
    ...AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS,
    ...AUTHORING_ERGONOMICS_REPORT_REFUSAL_CODES,
    "workspace_dir"
  ]);
  for (const token of new Set([...MODULE_CODE.matchAll(/\bworkspace_[a-z_]+/g)].map((m) => m[0]))) {
    assert.ok(
      ownVocabulary.has(token),
      `${token} is not part of this operation's own vocabulary; ownership must never be keyed off a tool name`
    );
  }

  assert.equal(/synthetic/i.test(MODULE_CODE), false);
});

test("the operation delegates only derived-index recovery and binds no direct writer", () => {

  for (const specifier of moduleImportSpecifiers()) {
    assert.ok(
      ALLOWED_IMPORT_SPECIFIERS.includes(specifier),
      `${specifier} is not an allowed read-only dependency of this operation`
    );
  }

  const [, bindings = ""] = /import\s+\{([^}]*)\}\s+from\s+"node:fs\/promises";/.exec(MODULE_CODE) ?? [];
  assert.deepEqual(
    bindings.split(",").map((name) => name.trim()).filter(Boolean).sort(),
    ["readFile", "readdir", "stat"],
    "the operation binds only read-only filesystem primitives"
  );

  for (const forbidden of ["writeFile", "mkdir", "rename", "unlink", "rmdir", "appendFile", "copyFile"]) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`).test(MODULE_CODE),
      false,
      `${forbidden} must not appear: the operation performs no write`
    );
  }
  for (const forbidden of ["child_process", "spawn(", "execFile"]) {
    assert.equal(
      MODULE_CODE.includes(forbidden),
      false,
      `${forbidden} must not appear: the operation spawns no process`
    );
  }
  assert.equal(/process\s*\.\s*env/.test(MODULE_CODE), false, "the operation reads no ambient environment");
});

test("a report leaves the workspace byte-for-byte unchanged", async (t) => {
  const dir = await makeFixtureRepo(t);
  const before = await snapshotTree(dir);
  await buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" });
  assert.deepEqual(await snapshotTree(dir), before, "the report must write nothing into the workspace");
});

test("the request schema is closed and its source selection is mutually exclusive", () => {
  assert.deepEqual(AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS, [
    "workspace_errors_log",
    "retained_smoke_evidence"
  ]);

  const parsed = parseAuthoringErgonomicsReportRequest({
    dir: "/anything",
    source_kind: "workspace_errors_log"
  });
  assert.equal(parsed.source_kind, "workspace_errors_log");
  assert.equal(parsed.retained_smoke_evidence, null);

  assert.throws(
    () => parseAuthoringErgonomicsReportRequest({ dir: "/x" }),
    (error) => error.code === "source_selection_missing"
  );
  assert.throws(
    () => parseAuthoringErgonomicsReportRequest({ dir: "/x", source_kind: "anything_else" }),
    (error) => error.code === "unsupported_source_kind"
  );
  assert.throws(
    () =>
      parseAuthoringErgonomicsReportRequest({
        dir: "/x",
        source_kind: "workspace_errors_log",
        retained_smoke_evidence: retainedEnvelope()
      }),
    (error) => error.code === "source_selection_ambiguous"
  );
  assert.throws(
    () => parseAuthoringErgonomicsReportRequest({ dir: "/x", source_kind: "retained_smoke_evidence" }),
    (error) => error.code === "retained_evidence_missing"
  );
  assert.throws(
    () =>
      parseAuthoringErgonomicsReportRequest({
        dir: "/x",
        source_kind: "retained_smoke_evidence",
        retained_smoke_evidence: "not-an-envelope"
      }),
    (error) => error.code === "retained_evidence_invalid_type"
  );
  assert.throws(
    () => parseAuthoringErgonomicsReportRequest({ dir: "/x", source_kind: "workspace_errors_log", verbose: true }),
    (error) => error.code === "unknown_request_field"
  );
  assert.throws(
    () => parseAuthoringErgonomicsReportRequest("not-an-object"),
    (error) => error.code === "request_invalid"
  );
});

test("arbitrary paths, alternate sources, and carried authority are refused with one stable code", () => {
  for (const field of [
    "path",
    "source_path",
    "errors_log_path",
    "errors_log",
    "filename",
    "root",
    "repo_root",
    "workspace_dir",
    "home",
    "cache_dir",
    "installation_root",
    "env",
    "api_key",
    "token",
    "credential",
    "secret",
    "policy",
    "authority",
    "registered_tier",
    "session_role"
  ]) {
    assert.throws(
      () =>
        parseAuthoringErgonomicsReportRequest({
          dir: "/x",
          source_kind: "workspace_errors_log",
          [field]: "/etc/passwd"
        }),
      (error) => {
        assert.equal(
          error.code,
          "caller_supplied_path_or_authority_rejected",
          `${field} must be refused as a path or authority carrier, not as a generic unknown field`
        );
        return true;
      },
      `${field} must be refused`
    );
  }
});

test("the journal source resolves only the repository's own fixed errors.log", async (t) => {
  assert.equal(AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH, "errors.log");

  const dir = await makeFixtureRepo(t, { journal: null });
  await writeFile(path.join(dir, "somewhere-else.log"), abstractJournal(), "utf8");

  await expectRefusal(
    buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" }),
    "errors_log_unavailable"
  );

  await expectRefusal(
    buildAuthoringErgonomicsReport({ source_kind: "workspace_errors_log" }),
    "workspace_root_unresolved"
  );
});

test("a fixed-workspace errors.log report carries every report dimension", async (t) => {
  const dir = await makeFixtureRepo(t);
  const report = await buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" });

  assert.equal(report.schema_version, AUTHORING_ERGONOMICS_REPORT_OPERATION_SCHEMA_VERSION);
  assert.deepEqual(report.authority, AUTHORING_ERGONOMICS_REPORT_AUTHORITY);
  assert.deepEqual(report.authority.confers, []);
  assert.deepEqual(report.side_effects, ["read_only"]);

  assert.equal(report.source.source_kind, "workspace_errors_log");
  assert.equal(report.source.adapter, "errors_log");
  assert.equal(report.source.locator, AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH);

  assert.equal(report.denominators.raw_event_count, 2);
  assert.equal(report.denominators.tool_call_event_count, 2);
  assert.equal(report.denominators.workflow_count, 1);
  assert.ok(report.denominators.episode_count >= 1);
  assert.ok(report.denominators.cluster_count >= 1);
  for (const entry of report.metrics.entries) {
    assert.ok(entry.eligible_population, `${entry.metric} must carry its eligible population`);
  }
  assert.ok(report.metrics.metric_names.includes("refusal_count"));

  assert.equal(report.workflows.length, 1);
  assert.ok(Array.isArray(report.episodes) && report.episodes.length >= 1);
  assert.ok(report.findings.observations.some((observation) => observation.observation_id.startsWith("ERG-")));
  assert.ok(report.findings.clusters.length >= 1);
  assert.ok(report.findings.detectors.length >= 1);

  assert.deepEqual(Object.keys(report.axes.by_axis).sort(), [...AUTHORING_ERGONOMICS_AXES].sort());
  for (const axis of AUTHORING_ERGONOMICS_AXES) {
    assert.equal(report.axes.by_axis[axis].axis, axis);
    assert.equal(typeof report.axes.by_axis[axis].observed, "boolean");
  }
  for (const axis of ["producer", "consumer", "record_quality", "persistence_lifecycle", "workload"]) {
    assert.ok(AUTHORING_ERGONOMICS_AXES.includes(axis));
  }

  assert.deepEqual(report.conformance.identities, AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES);
  assert.equal(report.conformance.evaluation.gates.length, 4);

  assert.equal(report.routing.results.length, report.findings.clusters.length);
  for (const result of report.routing.results) {
    assert.ok(AUTHORING_ERGONOMICS_ROUTING_STATES.includes(result.routing_state));
  }
  assert.deepEqual(report.routing.lookup_routes, AUTHORING_ERGONOMICS_LOOKUP_ROUTES);
});

test("the operation reads the configured repository's own fixed errors.log", async (t) => {
  const dir = await makeFixtureRepo(t);
  const report = await buildAuthoringErgonomicsReport({
    dir,
    source_kind: "workspace_errors_log"
  });
  assert.equal(report.source.source_kind, "workspace_errors_log");
  assert.equal(report.source.locator, AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH);
  assert.ok(report.denominators.raw_event_count > 0, "the repository journal must produce events");
  assert.equal(report.coverage.normal_success_population_complete, false);
});

test("a retained source with complete normal-success coverage evaluates the checks", async (t) => {
  const dir = await makeFixtureRepo(t, { journal: null });
  const report = await buildAuthoringErgonomicsReport({
    dir,
    source_kind: "retained_smoke_evidence",
    retained_smoke_evidence: retainedEnvelope()
  });

  assert.equal(report.source.source_kind, "retained_smoke_evidence");
  assert.equal(report.source.adapter, "retained_smoke");
  assert.equal(report.coverage.normal_success_population_complete, true);
  assert.equal(report.coverage.declarations[0].population_class, "normal_and_failure");

  for (const identity of [EFFECT_GATE, NEXT_CALL_GATE, PUBLIC_CONTINUATION_GATE]) {
    const gate = gateOf(report, identity);
    assert.equal(gate.outcome, "pass", `${identity} must be evaluated and satisfied`);
    assert.equal(gate.reason_code, "authoring_ergonomics.conformance.satisfied.v1");
  }
  assert.ok(report.conformance.evaluation.evaluated_gate_count >= 3);
});

test("failure-only evidence leaves every normal-success check unevaluable", async (t) => {
  const dir = await makeFixtureRepo(t);

  for (const call of [
    { source_kind: "workspace_errors_log" },
    { source_kind: "retained_smoke_evidence", retained_smoke_evidence: failureOnlyRetainedEnvelope() }
  ]) {
    const report = await buildAuthoringErgonomicsReport({ dir, ...call });

    assert.notEqual(
      report.coverage.normal_success_population_complete,
      true,
      `${call.source_kind} must not claim a complete normal-success population`
    );

    const effect = gateOf(report, EFFECT_GATE);
    assert.equal(effect.outcome, "unevaluable_missing_coverage");
    assert.ok(
      [
        "authoring_ergonomics.conformance.population_class_failure_only.v1",
        "authoring_ergonomics.conformance.normal_success_population_incomplete.v1",
        "authoring_ergonomics.conformance.coverage_declaration_absent.v1"
      ].includes(effect.reason_code),
      `a failure-biased population must be the stated reason, not a verdict (${effect.reason_code})`
    );

    for (const gate of report.conformance.evaluation.gates) {
      assert.notEqual(gate.outcome, "pass", `${gate.identity} must not pass on failure-only evidence`);
    }
    assert.equal(report.conformance.evaluation.outcome_counts.pass, 0);
  }
});

test("a metric whose population is undeclared stays unknown rather than becoming zero", async (t) => {
  const dir = await makeFixtureRepo(t);
  const report = await buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" });

  const unavailable = report.metrics.entries.filter((entry) => entry.evidence_state === "unavailable");
  assert.ok(unavailable.length > 0, "a failure journal cannot cover every metric population");
  for (const entry of unavailable) {
    assert.equal(entry.value, null, `${entry.metric} must stay unknown rather than zero`);
  }
  assert.ok(report.unknown_evidence.report.length > 0, "unavailable populations stay explicit unknown evidence");
});

test("malformed, oversized, unsupported-version, and partial evidence receive stable typed outcomes", async (t) => {
  const dir = await makeFixtureRepo(t, { journal: null });

  await writeFile(
    path.join(dir, AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH),
    "this journal has content but no section header at all\n",
    "utf8"
  );
  await assert.rejects(
    buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" }),
    (error) => {
      assert.equal(error.code, "adapter_refused");

      assert.equal(error.source_refusal.owner, "authoring-ergonomics-adapters");
      assert.equal(error.source_refusal.code, "no_recognizable_sections");
      return true;
    }
  );

  const wrongVersion = retainedEnvelope();
  wrongVersion.schema_version = "authoring-ergonomics-retained-smoke.v99";
  await assert.rejects(
    buildAuthoringErgonomicsReport({
      dir,
      source_kind: "retained_smoke_evidence",
      retained_smoke_evidence: wrongVersion
    }),
    (error) => {
      assert.equal(error.code, "adapter_refused");
      assert.equal(error.source_refusal.code, "unsupported_retained_schema_version");
      return true;
    }
  );

  const unknownField = retainedEnvelope();
  unknownField.run_directory = "/runs/latest";
  await assert.rejects(
    buildAuthoringErgonomicsReport({
      dir,
      source_kind: "retained_smoke_evidence",
      retained_smoke_evidence: unknownField
    }),
    (error) => {
      assert.equal(error.code, "adapter_refused");
      assert.equal(error.source_refusal.code, "unknown_field");
      assert.equal(error.source_refusal.path, "retained_smoke.run_directory");
      return true;
    }
  );

  const oversized = retainedEnvelope();
  oversized.observations[0].tool = "t".repeat(4096);
  await assert.rejects(
    buildAuthoringErgonomicsReport({
      dir,
      source_kind: "retained_smoke_evidence",
      retained_smoke_evidence: oversized
    }),
    (error) => {
      assert.equal(error.code, "adapter_refused");
      assert.equal(error.source_refusal.code, "value_too_long");
      return true;
    }
  );

  const partial = retainedEnvelope();
  delete partial.capture;
  const partialReport = await buildAuthoringErgonomicsReport({
    dir,
    source_kind: "retained_smoke_evidence",
    retained_smoke_evidence: partial
  });
  assert.equal(partialReport.coverage.normal_success_population_complete, null);
  assert.equal(partialReport.conformance.evaluation.outcome_counts.pass, 0);
  assert.ok(
    partialReport.unknown_evidence.adapter.some((entry) => entry.kind === "absent_capture_declaration"),
    "an absent capture declaration must stay explicit unknown evidence"
  );
});

const ERRORS_LOG_BOUND_BYTES = 8_000_000;

test("a journal past the read bound is refused whole rather than partially read", async (t) => {
  const dir = await makeFixtureRepo(t, { journal: null });
  const journalPath = path.join(dir, AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH);

  const header = `${abstractJournal()}\n`;
  const padding = Buffer.alloc(ERRORS_LOG_BOUND_BYTES + 1 - Buffer.byteLength(header), 0x0a);
  await writeFile(journalPath, Buffer.concat([Buffer.from(header, "utf8"), padding]));

  const { size } = await stat(journalPath);
  assert.ok(
    size > ERRORS_LOG_BOUND_BYTES,
    `the fixture must genuinely exceed the ${ERRORS_LOG_BOUND_BYTES} byte bound, it is ${size} bytes`
  );

  await expectRefusal(
    buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" }),
    "errors_log_too_large"
  );
});

test("an unreadable journal location degrades to a typed refusal rather than an empty report", async (t) => {
  const dir = await makeFixtureRepo(t, { journal: null });

  await mkdir(path.join(dir, AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH), { recursive: true });
  await expectRefusal(
    buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" }),
    "errors_log_unavailable"
  );
});

const ROUTED_CLUSTER = Object.freeze({
  cluster_id: "CL-001",
  axis: "producer",
  detectors: ["unusable_continuation"],
  producer_boundary: { boundary_kind: "mcp_tool", boundary_id: "abstract_boundary", producer_family: null }
});

function discoveryEvidence({ state = "complete", sourceFiles = ["pkg/a.mjs", "pkg/b.mjs"] } = {}) {
  return {
    route: "tool_discovery",
    state,
    required_for_authority: true,
    degradation_reason: state === "complete" ? null : "tool_discovery_unavailable",
    detail: null,
    entries: {
      abstract_boundary: {
        tool_name: "abstract_boundary",
        source_files: sourceFiles,
        docs_refs: ["docs/abstract.md"]
      }
    }
  };
}

function canonicalEvidence({ state = "complete", records = [] } = {}) {
  return {
    route: "canonical_work_record_search",
    state,
    required_for_authority: true,
    degradation_reason:
      state === "complete"
        ? null
        : state === "incomplete"
          ? "canonical_work_record_search_incomplete"
          : "canonical_work_record_search_unavailable",
    detail: null,
    scanned_record_count: records.length,
    unreadable_record_count: state === "incomplete" ? 1 : 0,
    records
  };
}

function codeIndexEvidence({ state = "complete", freshness = "fresh" } = {}) {
  return {
    route: "code_index",
    state,
    required_for_authority: false,
    degradation_reason:
      state === "complete" ? null : state === "stale" ? "code_index_stale" : "code_index_unavailable",
    detail: null,
    freshness,
    artifact_exists: state !== "unavailable",
    dirty_state: "clean"
  };
}

function ownerRecord(id, writeScope, acceptance = []) {
  return {
    record_id: id,
    repo: "abstract/repo",
    status: "todo",
    units: [{ unit: id, write_scope: writeScope, repo_paths: [], acceptance_criteria: acceptance }]
  };
}

test("an exact write-scope owner resolves through discovery and canonical search", () => {
  const routing = routeAuthoringErgonomicsClusters([ROUTED_CLUSTER], {
    discovery: discoveryEvidence(),
    canonical: canonicalEvidence({ records: [ownerRecord("WK-0100", ["pkg/a.mjs", "pkg/b.mjs", "pkg/c.mjs"])] }),
    code_index: codeIndexEvidence()
  });

  const result = routing.results[0];
  assert.equal(result.routing_state, "owner_resolved");
  assert.equal(result.owner.record_id, "WK-0100");
  assert.deepEqual(result.owner.units, ["WK-0100"]);
  assert.deepEqual(result.owner.matched_source_files, ["pkg/a.mjs", "pkg/b.mjs"]);
  assert.deepEqual(result.degradation_reasons, []);
  assert.deepEqual(result.advertised_references.source_files, ["pkg/a.mjs", "pkg/b.mjs"]);
  assert.deepEqual(result.advertised_references.docs_refs, ["docs/abstract.md"]);
  assert.equal(routing.state_counts.owner_resolved, 1);
  assert.equal(routing.resolution_mode, "dynamic_per_call_lookup");
});

test("a complete lookup that finds no covering record returns owner_unresolved", () => {
  const routing = routeAuthoringErgonomicsClusters([ROUTED_CLUSTER], {
    discovery: discoveryEvidence(),
    canonical: canonicalEvidence({ records: [ownerRecord("WK-0200", ["pkg/unrelated.mjs"])] }),
    code_index: codeIndexEvidence()
  });

  const result = routing.results[0];
  assert.equal(result.routing_state, "owner_unresolved");
  assert.equal(result.owner, null);
  assert.deepEqual(result.degradation_reasons, []);
  assert.equal(routing.state_counts.owner_unresolved, 1);
});

test("ambiguous coverage is never silently selected", () => {
  const routing = routeAuthoringErgonomicsClusters([ROUTED_CLUSTER], {
    discovery: discoveryEvidence(),
    canonical: canonicalEvidence({
      records: [
        ownerRecord("WK-0300", ["pkg/a.mjs", "pkg/b.mjs"]),
        ownerRecord("WK-0301", ["pkg/a.mjs", "pkg/b.mjs"])
      ]
    }),
    code_index: codeIndexEvidence()
  });

  const result = routing.results[0];
  assert.equal(result.routing_state, "owner_unresolved");
  assert.equal(result.owner, null);

  assert.deepEqual(
    result.candidate_owners.map((candidate) => candidate.record_id),
    ["WK-0300", "WK-0301"]
  );
});

test("partial coverage and an acceptance mention stay advisory candidates, never an owner", () => {
  const routing = routeAuthoringErgonomicsClusters([ROUTED_CLUSTER], {
    discovery: discoveryEvidence(),
    canonical: canonicalEvidence({
      records: [
        ownerRecord("WK-0400", ["pkg/a.mjs"]),
        ownerRecord("WK-0401", [], ["abstract_boundary must return a typed refusal"])
      ]
    }),
    code_index: codeIndexEvidence()
  });

  const result = routing.results[0];
  assert.equal(result.routing_state, "owner_unresolved");
  assert.equal(result.owner, null);
  const bases = new Map(result.candidate_owners.map((candidate) => [candidate.record_id, candidate.bases]));
  assert.deepEqual(bases.get("WK-0400"), ["write_scope_covers_advertised_source_file"]);
  assert.deepEqual(bases.get("WK-0401"), ["acceptance_names_boundary"]);
});

test("a degraded or stale lookup can never establish an ownership gap", () => {
  const covering = [ownerRecord("WK-0500", ["pkg/unrelated.mjs"])];

  for (const [label, evidence, expectedReason] of [
    [
      "discovery unavailable",
      {
        discovery: discoveryEvidence({ state: "unavailable" }),
        canonical: canonicalEvidence({ records: covering }),
        code_index: codeIndexEvidence()
      },
      "tool_discovery_unavailable"
    ],
    [
      "canonical search unavailable",
      {
        discovery: discoveryEvidence(),
        canonical: canonicalEvidence({ state: "unavailable" }),
        code_index: codeIndexEvidence()
      },
      "canonical_work_record_search_unavailable"
    ],
    [
      "canonical search incomplete",
      {
        discovery: discoveryEvidence(),
        canonical: canonicalEvidence({ state: "incomplete", records: covering }),
        code_index: codeIndexEvidence()
      },
      "canonical_work_record_search_incomplete"
    ],
    [
      "code index stale",
      {
        discovery: discoveryEvidence(),
        canonical: canonicalEvidence({ records: covering }),
        code_index: codeIndexEvidence({ state: "stale", freshness: "stale" })
      },
      "code_index_stale"
    ],
    [
      "code index unavailable",
      {
        discovery: discoveryEvidence(),
        canonical: canonicalEvidence({ records: covering }),
        code_index: codeIndexEvidence({ state: "unavailable", freshness: "missing" })
      },
      "code_index_unavailable"
    ]
  ]) {
    const result = routeAuthoringErgonomicsClusters([ROUTED_CLUSTER], evidence).results[0];
    assert.equal(result.routing_state, "lookup_degraded", `${label} must degrade`);
    assert.notEqual(result.routing_state, "owner_unresolved", `${label} must not claim an ownership gap`);
    assert.ok(
      result.degradation_reasons.includes(expectedReason),
      `${label} must record ${expectedReason} (got ${result.degradation_reasons.join(", ")})`
    );
    for (const reason of result.degradation_reasons) {
      assert.ok(
        AUTHORING_ERGONOMICS_ROUTING_DEGRADATION_REASONS.includes(reason),
        `${reason} must be in the closed degradation vocabulary`
      );
    }
  }
});

test("an exact owner still resolves while the code index is stale", () => {
  const result = routeAuthoringErgonomicsClusters([ROUTED_CLUSTER], {
    discovery: discoveryEvidence(),
    canonical: canonicalEvidence({ records: [ownerRecord("WK-0600", ["pkg/a.mjs", "pkg/b.mjs"])] }),
    code_index: codeIndexEvidence({ state: "stale", freshness: "stale" })
  }).results[0];

  assert.equal(result.routing_state, "owner_resolved");
  assert.equal(result.owner.record_id, "WK-0600");
  assert.deepEqual(result.degradation_reasons, ["code_index_stale"]);
});

test("a cluster with no producer-boundary identity degrades rather than reporting no owner", () => {
  const result = routeAuthoringErgonomicsClusters(
    [{ cluster_id: "CL-009", axis: "workload", detectors: ["false_green_workload"], producer_boundary: null }],
    {
      discovery: discoveryEvidence(),
      canonical: canonicalEvidence({ records: [] }),
      code_index: codeIndexEvidence()
    }
  ).results[0];

  assert.equal(result.routing_state, "lookup_degraded");
  assert.deepEqual(result.degradation_reasons, ["cluster_subject_absent"]);
  assert.equal(result.subject, null);
});

test("clusters beyond the routing bound stay explicitly unrouted instead of fabricating degradation", () => {
  const clusters = Array.from({ length: 1001 }, (_, index) => ({
    ...ROUTED_CLUSTER,
    cluster_id: `CL-${String(index + 1).padStart(4, "0")}`,
    observation_ids: [`ERG-${String(index + 1).padStart(4, "0")}`],
    raw_event_orders: [index]
  }));
  const routing = routeAuthoringErgonomicsClusters(clusters, {
    discovery: discoveryEvidence(),
    canonical: canonicalEvidence({ records: [] }),
    code_index: codeIndexEvidence()
  });
  assert.equal(routing.routed_cluster_count, 1000);
  assert.equal(routing.unrouted_cluster_count, 1);
  assert.equal(routing.state_counts.lookup_degraded, 0);

  const report = JSON.parse(readFileSync(path.join(
    REPO_ROOT, "tests/fixtures/authoring-ergonomics/wk-2477-complete-report.json"
  ), "utf8"));
  report.findings.clusters = clusters;
  report.findings.observations = clusters.map((cluster, index) => ({
    observation_id: cluster.observation_ids[0],
    detector: "unverified_effect_response",
    axis: cluster.axis,
    severity: "medium",
    category: cluster.axis,
    finding: true,
    outcome: "fixture",
    episode_id: null,
    event_orders: [index],
    producer_boundary: cluster.producer_boundary,
    evidence: { fixture: true }
  }));
  report.routing = routing;
  const page = projectAuthoringErgonomicsReportPage({
    report,
    collection: "finding_observations",
    selector: { id: "ERG-1001:1001" }
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].owner_routing_state, null);
  assert.equal(page.items[0].owner_routing_performed, false);
  assert.equal(page.items[0].resolved_owner, null);
});

test("projection inventory covers nested report objects and exposes full conformance context", async (t) => {
  const dir = await makeFixtureRepo(t, { journal: null });
  const report = await buildAuthoringErgonomicsReport({
    dir,
    source_kind: "retained_smoke_evidence",
    retained_smoke_evidence: retainedEnvelope()
  });
  assert.equal(assertAuthoringErgonomicsProjectionInventory(report), true);

  const page = projectAuthoringErgonomicsReportPage({
    report,
    collection: "conformance_evaluations"
  });
  const pageContext = projectAuthoringErgonomicsReportPageContext({
    report,
    collection: "conformance_evaluations"
  });
  const expectedContextFields = Object.keys(report.conformance.evaluation)
    .filter((field) => field !== "gates").sort();
  for (const row of page.items) {
    assert.equal(Object.hasOwn(row, "evaluation_context"), false);
  }
  assert.deepEqual(Object.keys(pageContext.evaluation_context).sort(), expectedContextFields);

  const compact = projectAuthoringErgonomicsCompactReport(report, {
    snapshot: {
      identity: "fixture-snapshot",
      current: true,
      created_at: "2026-09-02T00:00:00.000Z",
      expires_at: "2026-09-02T00:15:00.000Z"
    },
    nextCalls: [{ tool: "workspace_authoring_ergonomics_report_query", arguments: {} }]
  });
  assert.ok(compact.completeness.complete_in_place.includes("source.redactions"));
  assert.ok(compact.completeness.complete_in_place.includes(
    "conformance_summary.outcome_counts"
  ));
  assert.equal(compact.completeness.complete_in_place.includes("source"), false);
  assert.equal(compact.completeness.complete_in_place.includes("conformance_summary"), false);
  assert.deepEqual(compact.completeness.omitted.find(
    ({ path: path_ }) => path_ === "conformance.evaluation"
  ), {
    path: "conformance.evaluation",
    query_collection: "conformance_evaluations"
  });

  const mutant = structuredClone(report);
  mutant.conformance.evaluation.unassigned_nested_field = true;
  assert.throws(() => assertAuthoringErgonomicsProjectionInventory(mutant),
    /incomplete at conformance\.evaluation/u);
});

test("shape-conformant finding rows join only to their exact five-part cluster identity", () => {
  const report = JSON.parse(readFileSync(path.join(
    REPO_ROOT, "tests/fixtures/authoring-ergonomics/wk-2477-complete-report.json"
  ), "utf8"));
  assert.equal(assertAuthoringErgonomicsProjectionInventory(report), true);
  for (const observation of report.findings.observations) {
    assert.equal(Object.hasOwn(observation, "severity"), false);
    assert.equal(Object.hasOwn(observation, "category"), false);
  }

  const colliding = report.findings.observations.filter(
    ({ observation_id: observationId }) => observationId === "ERG-001"
  );
  assert.equal(colliding.length, 2);
  assert.equal(colliding[0].axis, colliding[1].axis);
  assert.deepEqual(colliding[0].producer_boundary, colliding[1].producer_boundary);
  assert.deepEqual(colliding[0].target_identity, colliding[1].target_identity);
  assert.equal(colliding[0].episode_id, colliding[1].episode_id);
  assert.deepEqual(colliding[0].event_orders, colliding[1].event_orders);
  assert.notEqual(colliding[0].invariant_family, colliding[1].invariant_family);

  for (const clusters of [report.findings.clusters, [...report.findings.clusters].reverse()]) {
    const candidate = structuredClone(report);
    candidate.findings.clusters = clusters;
    const first = projectAuthoringErgonomicsReportPage({
      report: candidate,
      collection: "finding_observations",
      selector: { id: "ERG-001:0001" }
    }).items[0];
    const second = projectAuthoringErgonomicsReportPage({
      report: candidate,
      collection: "finding_observations",
      selector: { id: "ERG-001:0006" }
    }).items[0];
    assert.deepEqual({
      cluster_id: first.evidence_selectors.cluster_id,
      routing_state: first.owner_routing_state
    }, { cluster_id: "CL-001", routing_state: "owner_resolved" });
    assert.deepEqual({
      cluster_id: second.evidence_selectors.cluster_id,
      routing_state: second.owner_routing_state
    }, { cluster_id: "CL-006", routing_state: "lookup_degraded" });
  }

  const missing = structuredClone(report);
  delete missing.findings.observations[0].identity_scope_key;
  assert.throws(() => assertAuthoringErgonomicsProjectionInventory(missing),
    /row inventory is invalid/u);
  const invented = structuredClone(report);
  invented.findings.clusters[0].severity = "high";
  assert.throws(() => assertAuthoringErgonomicsProjectionInventory(invented),
    /row inventory is invalid/u);
});

test("structured discovery supplies the advertised source and durable-document references", async () => {
  const discovery = await loadAuthoringErgonomicsDiscoveryEvidence();
  assert.equal(discovery.state, "complete");
  assert.ok(discovery.tool_count > 0);
  const entry = discovery.entries.workspace_authoring_ergonomics_report;
  assert.ok(entry, "the report tool must be discoverable through the live descriptor");
  assert.ok(entry.source_files.length > 0);
  assert.ok(entry.docs_refs.length > 0);
});

test("an absent canonical corpus is unavailable evidence, not an empty corpus", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "authoring-ergonomics-empty-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const canonical = await loadAuthoringErgonomicsCanonicalEvidence({ dir });
  assert.equal(canonical.state, "unavailable");
  assert.equal(canonical.degradation_reason, "canonical_work_record_search_unavailable");
  assert.equal(canonical.scanned_record_count, null);
});

test("an unparseable canonical record leaves the corpus incomplete rather than skipped", async (t) => {
  const dir = await makeFixtureRepo(t, {
    journal: null,
    records: [
      { id: "WK-0700", body: { id: "WK-0700", write_scope: ["pkg/a.mjs"] } },
      { id: "WK-0701", body: "{ this is not json" }
    ]
  });

  const canonical = await loadAuthoringErgonomicsCanonicalEvidence({ dir });
  assert.equal(canonical.state, "incomplete");
  assert.equal(canonical.degradation_reason, "canonical_work_record_search_incomplete");
  assert.equal(canonical.scanned_record_count, 1);
  assert.equal(canonical.unreadable_record_count, 1);
});

test("code-index availability and freshness are labelled on their own axis", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "authoring-ergonomics-index-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const codeIndex = await loadAuthoringErgonomicsCodeIndexEvidence({ dir });
  assert.equal(codeIndex.route, "code_index");
  assert.equal(codeIndex.required_for_authority, false, "the index is never canonical ownership authority");
  assert.ok(["stale", "unavailable", "complete"].includes(codeIndex.state));
  assert.equal(typeof codeIndex.freshness, "string");
});

test("code-index evidence reports shared reuse, rebuild and exact ensure failures", async () => {
  for (const action of ["reused", "rebuilt"]) {
    const evidence = await loadAuthoringErgonomicsCodeIndexEvidence({ dir: "/repo" }, {
      ensureIndex: async () => ({ action, captured_head: "a".repeat(40), status: {
        staleness: "fresh", artifact_exists: true, dirty_state: "dirty_worktree"
      } })
    });
    assert.equal(evidence.state, "complete");
    assert.equal(evidence.ensure_action, action);
    assert.equal(evidence.captured_head, "a".repeat(40));
    assert.equal(evidence.dirty_state, "dirty_worktree");
  }
  const failed = await loadAuthoringErgonomicsCodeIndexEvidence({ dir: "/repo" }, {
    ensureIndex: async () => { const error = new Error("disk full");
      error.code = "ENOSPC"; error.envelope = { code: "sidecar_index_rebuild_failed",
        cause_code: "ENOSPC", recovery: { automatic_rebuild_on_retry: true } }; throw error; }
  });
  assert.equal(failed.state, "unavailable");
  assert.equal(failed.degradation_reason, "code_index_rebuild_failed");
  assert.equal(failed.ensure_failure.cause_code, "ENOSPC");
  assert.equal(failed.ensure_failure.recovery.automatic_rebuild_on_retry, true);
});

test("an end-to-end report resolves an exact owner from the live descriptor and a canonical record", async (t) => {
  const discovery = await loadAuthoringErgonomicsDiscoveryEvidence();
  const entry = discovery.entries.workspace_authoring_ergonomics_report;
  assert.ok(entry && entry.source_files.length > 0);

  const dir = await makeFixtureRepo(t, {
    journal: abstractJournal("workspace_authoring_ergonomics_report"),
    records: [
      {
        id: "WK-0800",
        body: {
          id: "WK-0800",
          repo: "abstract/repo",
          status: "todo",

          write_scope: [...entry.source_files, "docs/abstract.md"],
          slices: []
        }
      },
      {
        id: "WK-0801",
        body: { id: "WK-0801", repo: "abstract/repo", status: "todo", write_scope: [entry.source_files[0]] }
      }
    ]
  });

  const report = await buildAuthoringErgonomicsReport({ dir, source_kind: "workspace_errors_log" });
  const routed = report.routing.results.find(
    (result) => result.subject?.boundary_id === "workspace_authoring_ergonomics_report"
  );
  assert.ok(routed, "the journal's boundary must be routed");
  assert.equal(routed.routing_state, "owner_resolved");
  assert.equal(routed.owner.record_id, "WK-0800");

  assert.ok(routed.candidate_owners.some((candidate) => candidate.record_id === "WK-0801"));
});
