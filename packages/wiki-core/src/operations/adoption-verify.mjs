

import path from "node:path";
import { readFile, access } from "node:fs/promises";
import { lintRepo } from "./lint.mjs";
import { searchRepo } from "./search.mjs";
import { getWikiRecord, readWikiPage } from "./read.mjs";
import { readWorkRecordById } from "./work-records-store-io.mjs";
import { validateWorkRecordDispatch } from "./validate-dispatch.mjs";
import { getSidecarIndexStatus } from "../lib/sidecar-status.mjs";
import { getSidecarImpactPaths } from "../lib/sidecar-impact.mjs";

export const ADOPTION_VERIFY_SCHEMA_VERSION = "adoption-verify.v1";

const ADOPTION_TRACKER_ID = "WK-0001";
const ADOPTION_INITIATIVE_ID = "IN-0001";
const ADOPTION_INITIATIVE_PAGE = "wiki/initiatives/IN-0001.md";
const RETRIEVAL_PROBE_QUERY = "adoption";

const GRAPH_IMPACT_PROBE_PATH = "wiki/.wiki-contract.json";
const WIKI_MCP_DECLARATION_PATH = "wiki/.wiki-mcp.json";

const ADOPTION_DOC_PATH = "docs/adoption.md";

export const ADOPTION_VERIFY_REQUIRED_CHECK_IDS = Object.freeze([
  "wiki-retrieval",
  "work-records",
  "generate-lint",
  "graph-impact",
  "dispatch-preflight"
]);

const CHECK_STATUS_VALUES = Object.freeze(["pass", "fail", "skipped"]);

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeSelectedChecks(checks) {
  if (checks === null || checks === undefined) {
    return null;
  }
  const list = Array.isArray(checks)
    ? checks
    : String(checks)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  if (list.length === 0) {
    return null;
  }
  return new Set(list);
}

async function runWikiRetrievalCheck(targetDir) {
  const search = await searchRepo({ dir: targetDir, query: RETRIEVAL_PROBE_QUERY });
  const searchHits = Number(search?.result_count ?? 0);
  const searchOk = searchHits >= 1;

  let readResolved = false;
  let readError = null;
  try {
    await readWikiPage({ dir: targetDir, path: ADOPTION_INITIATIVE_PAGE });
    readResolved = true;
  } catch (error) {
    readError = error.message;
  }

  let recordResolved = false;
  let recordError = null;
  try {
    await getWikiRecord({ dir: targetDir, id: ADOPTION_INITIATIVE_ID });
    recordResolved = true;
  } catch (error) {
    recordError = error.message;
  }

  const pass = searchOk && readResolved && recordResolved;
  return {
    status: pass ? "pass" : "fail",
    detail: pass
      ? `Search returned ${searchHits} hit(s) for "${RETRIEVAL_PROBE_QUERY}"; read resolved ${ADOPTION_INITIATIVE_PAGE}; get-record resolved ${ADOPTION_INITIATIVE_ID}.`
      : `Retrieval incomplete: search hits=${searchHits} (need >=1), read=${readResolved}, get-record=${recordResolved}.`,
    evidence: {
      query: RETRIEVAL_PROBE_QUERY,
      search_result_count: searchHits,
      read_path: ADOPTION_INITIATIVE_PAGE,
      read_resolved: readResolved,
      read_error: readError,
      record_id: ADOPTION_INITIATIVE_ID,
      record_resolved: recordResolved,
      record_error: recordError
    },
    blocker: pass
      ? null
      : {
          code: "wiki_retrieval_incomplete",
          message:
            "canonical wiki retrieval (search + read + get-record) did not fully resolve"
        },
    remediation: pass
      ? null
      : 'Run `npx -p @agent-chassis/wiki-cli wiki bootstrap --dir "$PWD"` then `npx -p @agent-chassis/wiki-cli wiki build-search-index --dir "$PWD"`, and confirm IN-0001 was seeded into wiki/initiatives/.'
  };
}

const RECORDED_IMPLEMENTATION_SLICE_STATUSES = Object.freeze(new Set(["done", "blocked"]));

async function runWorkRecordsCheck(targetDir) {
  const loaded = await readWorkRecordById({ dir: targetDir, id: ADOPTION_TRACKER_ID });
  const diagnostics = Array.isArray(loaded?.diagnostics) ? loaded.diagnostics : [];
  const valid = loaded?.valid === true;

  if (!valid) {
    return {
      status: "fail",
      detail: `Work record ${ADOPTION_TRACKER_ID} did not validate (${diagnostics.length} diagnostic(s)).`,
      evidence: {
        record_id: ADOPTION_TRACKER_ID,
        valid: false,
        diagnostics_count: diagnostics.length,
        diagnostics: diagnostics.slice(0, 5)
      },
      blocker: {
        code: "work_record_invalid",
        message: `${ADOPTION_TRACKER_ID} is missing or failed canonical work-record validation`
      },
      remediation:
        'Re-run `npx -p @agent-chassis/wiki-cli wiki bootstrap --dir "$PWD"` to reseed WK-0001, then inspect with `npx -p @agent-chassis/wiki-cli wiki work-records validate --id WK-0001 --json --dir "$PWD"`.'
    };
  }

  const slices = Array.isArray(loaded?.record?.slices) ? loaded.record.slices : [];
  const implementationSlices = slices.filter((slice) => slice?.work_kind === "implementation");
  const unrecorded = implementationSlices.filter(
    (slice) => !RECORDED_IMPLEMENTATION_SLICE_STATUSES.has(slice?.status)
  );
  const sliceStatusOk = unrecorded.length === 0;

  const baseEvidence = {
    record_id: ADOPTION_TRACKER_ID,
    valid: true,
    diagnostics_count: diagnostics.length,
    diagnostics: diagnostics.slice(0, 5),
    implementation_slices: implementationSlices.map((slice) => ({
      id: slice.id,
      status: slice.status
    })),
    unrecorded_implementation_slices: unrecorded.map((slice) => ({
      id: slice.id,
      status: slice.status
    }))
  };

  if (!sliceStatusOk) {
    const names = unrecorded.map((slice) => `${slice.id}=${slice.status}`).join(", ");
    return {
      status: "fail",
      detail: `Work record ${ADOPTION_TRACKER_ID} validated, but ${unrecorded.length} implementation slice(s) still carry unrecorded first-run status (${names}); a bare bootstrapped repo is not ready until each is recorded done/blocked.`,
      evidence: baseEvidence,
      blocker: {
        code: "adoption_status_bookkeeping_incomplete",
        message: `${unrecorded.length} ${ADOPTION_TRACKER_ID} implementation slice(s) are not recorded done/blocked: ${unrecorded
          .map((slice) => slice.id)
          .join(", ")}`
      },
      remediation:
        'After the adoption workers finish, record each WK-0001 implementation slice done (or blocked with a concrete blocker) through structured work-record tools (set-status / set-closure), then re-run `npx -p @agent-chassis/wiki-cli wiki adoption verify --dir "$PWD" --json`.'
    };
  }

  return {
    status: "pass",
    detail: `Work record ${ADOPTION_TRACKER_ID} loaded and validated (0 errors); all ${implementationSlices.length} implementation slice(s) are recorded done/blocked.`,
    evidence: baseEvidence,
    blocker: null,
    remediation: null
  };
}

async function runGenerateLintCheck(targetDir) {

  const lint = await lintRepo({ dir: targetDir });
  const errorCount = Number(lint?.error_count ?? 0);
  const warningCount = Number(lint?.warning_count ?? 0);
  const pass = lint?.ok === true && errorCount === 0;
  return {
    status: pass ? "pass" : "fail",
    detail: pass
      ? `Generate/lint validation passed (${warningCount} warning(s), 0 error(s)).`
      : `Generate/lint validation reported ${errorCount} error(s).`,
    evidence: {
      error_count: errorCount,
      warning_count: warningCount,
      problems: Array.isArray(lint?.problems) ? lint.problems.slice(0, 5) : []
    },
    blocker: pass
      ? null
      : {
          code: "generate_lint_failed",
          message: `lint reported ${errorCount} error(s)`
        },
    remediation: pass
      ? null
      : 'Run `npx -p @agent-chassis/wiki-cli wiki generate --dir "$PWD"` then `npx -p @agent-chassis/wiki-cli wiki lint --dir "$PWD"` and resolve the reported problems (commonly stale generated views).'
  };
}

async function runGraphImpactCheck(targetDir, graphImpactPath) {

  const status = await getSidecarIndexStatus({ dir: targetDir });
  const impact = await getSidecarImpactPaths({ dir: targetDir, paths: [graphImpactPath] });
  const statusOk = status && typeof status === "object" && typeof status.dirty_state === "string";
  const impactOk = impact && typeof impact === "object" && impact.query_kind === "impact_paths";
  const pass = Boolean(statusOk && impactOk);
  const validatedPaths = Array.isArray(impact?.validated_paths) ? impact.validated_paths : [];

  const probeResolved = validatedPaths.includes(graphImpactPath);
  return {
    status: pass ? "pass" : "fail",
    detail: pass
      ? `Code-index status and impact-paths returned structured envelopes read-only (dirty_state=${status.dirty_state}, staleness=${status.staleness}); the check is availability-only and tolerates an absent probe path; no evidence was persisted.`
      : "Code-index status/impact-paths did not return the expected structured envelope.",
    evidence: {
      code_index_state: {
        dirty_state: status?.dirty_state ?? null,
        staleness: status?.staleness ?? null
      },
      query_kind: impact?.query_kind ?? null,
      input_path: graphImpactPath,
      probe_path_resolved: probeResolved,
      validated_paths: validatedPaths,
      persisted_evidence: false
    },
    blocker: pass
      ? null
      : {
          code: "graph_impact_unavailable",
          message: "code-index status/impact-paths did not return a structured envelope"
        },
    remediation: pass
      ? null
      : "Confirm the repo-code-index cache path (.cache/repo-code-index/) is gitignored; the read-only impact surface tolerates a missing or stale index."
  };
}

async function runDispatchPreflightCheck(targetDir) {
  const result = await validateWorkRecordDispatch({
    dir: targetDir,
    unitAddress: ADOPTION_TRACKER_ID
  });
  const decisionCode = typeof result?.decision_code === "string" ? result.decision_code : null;
  const reasons = Array.isArray(result?.reasons) ? result.reasons : [];

  const dispatchable = result?.dispatchable === true;
  const pass = dispatchable;
  return {
    status: pass ? "pass" : "fail",
    detail: pass
      ? `Dispatch-readiness confirms ${ADOPTION_TRACKER_ID} is dispatchable (decision_code=${decisionCode}). MCP coordination preflight has no CLI surface and is operator/runtime-owned.`
      : `${ADOPTION_TRACKER_ID} is not dispatchable (decision_code=${decisionCode ?? "none"}${
          reasons.length ? `: ${reasons.slice(0, 3).join("; ")}` : ""
        }).`,
    evidence: {
      unit: ADOPTION_TRACKER_ID,
      decision_code: decisionCode,
      dispatchable,
      reasons: reasons.slice(0, 5),
      coordination_preflight: "operator/runtime-owned (no CLI surface)"
    },
    blocker: pass
      ? null
      : {
          code: "dispatch_not_ready",
          message: `WK-0001 is not dispatchable (decision_code=${decisionCode ?? "none"})${
            reasons.length ? `: ${reasons.slice(0, 3).join("; ")}` : ""
          }`
        },
    remediation: pass
      ? null
      : 'Resolve the WK-0001 dispatch blocker (e.g. split a multi-cluster write_scope into per-slice work, add acceptance.validation, or set a non-empty write_scope), then re-run `npx -p @agent-chassis/wiki-cli wiki validate-dispatch --unit WK-0001 --json --dir "$PWD"`.'
  };
}

async function runAgentsMdInfo(targetDir) {
  const present = await pathExists(path.join(targetDir, "AGENTS.md"));
  return {
    status: present ? "pass" : "skipped",
    detail: present
      ? "AGENTS.md is present (repo-local operating authority)."
      : "AGENTS.md is not present. Bootstrap never generates it; authoring it is operator-owned and does not gate agent-operability.",
    evidence: { path: "AGENTS.md", present },
    blocker: null,
    remediation: present
      ? null
      : "Author AGENTS.md from the seeded wiki/templates/AGENTS.md.boilerplate.md helper (operator-owned; does not block this check)."
  };
}

async function runAdoptionDocInfo(targetDir) {

  const docPath = path.join(targetDir, ADOPTION_DOC_PATH);
  let present = false;
  let content = "";
  try {
    content = await readFile(docPath, "utf8");
    present = true;
  } catch {
    present = false;
  }
  const hasHeading = /^#\s+\S/m.test(content);
  const valid = present && content.trim().length >= 50 && hasHeading;
  return {
    status: valid ? "pass" : "skipped",
    detail: valid
      ? `Bootstrap-seeded ${ADOPTION_DOC_PATH} is present and valid (Markdown with a top-level heading).`
      : present
        ? `${ADOPTION_DOC_PATH} is present but looks empty/placeholder (no top-level heading or too short); customizing it is operator-owned and does not gate agent-operability.`
        : `${ADOPTION_DOC_PATH} is not present. Bootstrap seeds it from a template; re-run bootstrap to restore it. Authoring/customizing it is operator-owned and does not gate agent-operability.`,
    evidence: { path: ADOPTION_DOC_PATH, present, has_heading: hasHeading, length: content.length },
    blocker: null,
    remediation: valid
      ? null
      : 'Re-run `npx -p @agent-chassis/wiki-cli wiki bootstrap --dir "$PWD"` to seed docs/adoption.md from the package template, then customize it for this repo (operator-owned; does not block this check).'
  };
}

async function runWikiMcpAliasInfo(targetDir) {
  const declarationPath = path.join(targetDir, WIKI_MCP_DECLARATION_PATH);
  let alias = null;
  let present = false;
  try {
    const parsed = JSON.parse(await readFile(declarationPath, "utf8"));
    present = true;
    alias =
      parsed && typeof parsed === "object" && parsed.current && typeof parsed.current === "object"
        ? parsed.current.alias ?? null
        : null;
  } catch {
    present = false;
  }
  const resolved = present && typeof alias === "string" && alias.length > 0;
  return {
    status: resolved ? "pass" : "skipped",
    detail: resolved
      ? `Bootstrap-generated wiki/.wiki-mcp.json declares workspace alias "${alias}".`
      : "Bootstrap-generated wiki/.wiki-mcp.json alias is not set; selecting a deliberate operator alias is operator-owned and does not gate agent-operability.",
    evidence: { path: WIKI_MCP_DECLARATION_PATH, present, alias },
    blocker: null,
    remediation: resolved
      ? null
      : 'Run `npx -p @agent-chassis/wiki-cli wiki bootstrap --dir "$PWD"` to generate wiki/.wiki-mcp.json, then set a deliberate current.alias if the default is not what you want (operator-owned).'
  };
}

function checkDescriptors(graphImpactPath) {
  return [
    {
      id: "wiki-retrieval",
      title: "Wiki retrieval (search + read + get-record)",
      required: true,
      kind: "verification",
      run: (dir) => runWikiRetrievalCheck(dir)
    },
    {
      id: "work-records",
      title: "Work-record load and validation",
      required: true,
      kind: "verification",
      run: (dir) => runWorkRecordsCheck(dir)
    },
    {
      id: "generate-lint",
      title: "Generate/lint validation",
      required: true,
      kind: "verification",
      run: (dir) => runGenerateLintCheck(dir)
    },
    {
      id: "graph-impact",
      title: "Graph-impact (read-only code-index)",
      required: true,
      kind: "verification",
      run: (dir) => runGraphImpactCheck(dir, graphImpactPath)
    },
    {
      id: "dispatch-preflight",
      title: "Dispatch readiness / preflight",
      required: true,
      kind: "verification",
      run: (dir) => runDispatchPreflightCheck(dir)
    },
    {
      id: "agents-md",
      title: "AGENTS.md presence (operator-owned)",
      required: false,
      kind: "operator-owned",
      run: (dir) => runAgentsMdInfo(dir)
    },
    {
      id: "adoption-doc",
      title: "docs/adoption.md presence + basic validity (operator-owned)",
      required: false,
      kind: "operator-owned",
      run: (dir) => runAdoptionDocInfo(dir)
    },
    {
      id: "wiki-mcp-alias",
      title: "Repo-local wiki/.wiki-mcp.json alias (operator-owned)",
      required: false,
      kind: "operator-owned",
      run: (dir) => runWikiMcpAliasInfo(dir)
    }
  ];
}

function normalizeOutcome(descriptor, outcome) {
  const status = CHECK_STATUS_VALUES.includes(outcome?.status) ? outcome.status : "fail";
  return {
    check: descriptor.id,
    title: descriptor.title,
    status,
    required: descriptor.required,
    kind: descriptor.kind,
    detail: typeof outcome?.detail === "string" ? outcome.detail : "",
    evidence: outcome?.evidence ?? null,
    blocker: outcome?.blocker ?? null,
    remediation: outcome?.remediation ?? null
  };
}

function skippedBySelection(descriptor) {
  return normalizeOutcome(descriptor, {
    status: "skipped",
    detail: `Not selected by the --checks filter; this check did not run.`,
    evidence: { selected: false },
    blocker: descriptor.required
      ? {
          code: "check_not_selected",
          message: `required check "${descriptor.id}" was excluded by --checks and counts as not passing`
        }
      : null,
    remediation: descriptor.required
      ? "Re-run `wiki adoption verify` without --checks (or include this id) to run every required check."
      : null
  });
}

function errorOutcome(descriptor, error) {
  return normalizeOutcome(descriptor, {
    status: "fail",
    detail: `${descriptor.title} could not run: ${error.message}`,
    evidence: { error: error.message },
    blocker: {
      code: `${descriptor.id}_check_error`,
      message: error.message
    },
    remediation:
      'Ensure the target directory is a bootstrapped wiki repo (run `npx -p @agent-chassis/wiki-cli wiki bootstrap --dir "$PWD"`) and re-run the check.'
  });
}

function summarizeChecks(checks) {
  const summary = { total: checks.length, pass: 0, fail: 0, skipped: 0 };
  for (const check of checks) {
    summary[check.status] += 1;
  }
  return summary;
}

export async function runAdoptionVerify({
  dir = ".",
  repo = null,
  checks = null,
  graphImpactPath = GRAPH_IMPACT_PROBE_PATH
} = {}) {
  const targetDir = path.resolve(String(dir));
  const selected = normalizeSelectedChecks(checks);
  const descriptors = checkDescriptors(graphImpactPath);

  const results = [];
  for (const descriptor of descriptors) {
    if (selected && !selected.has(descriptor.id)) {
      results.push(skippedBySelection(descriptor));
      continue;
    }

    try {
      const outcome = await descriptor.run(targetDir);
      results.push(normalizeOutcome(descriptor, outcome));
    } catch (error) {
      results.push(errorOutcome(descriptor, error));
    }
  }

  const summary = summarizeChecks(results);
  const agentOperable = results
    .filter((check) => check.required)
    .every((check) => check.status === "pass");
  const verdict = agentOperable ? "ready" : "blocked";

  return {
    schema: ADOPTION_VERIFY_SCHEMA_VERSION,
    repo: repo ?? null,
    dir: targetDir,
    checks: results,
    summary,
    agent_operable: agentOperable,
    verdict,
    persisted_evidence: false
  };
}
