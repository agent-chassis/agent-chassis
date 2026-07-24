

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
const ROOT_AGENTS_PATH = "AGENTS.md";
const LAUNCHER_TOML_PATH = "agent-launch.toml";
const LAUNCHER_CONFIG_DIR = ".agent-launch";
const LAUNCHER_REGISTRY_PATH = `${LAUNCHER_CONFIG_DIR}/launchers.v1.json`;
const LAUNCHER_ROLE_GUARD_SECRET_PATH = `${LAUNCHER_CONFIG_DIR}/role-guard-secret.key`;
const LAUNCHER_REQUIRED_ROLES = Object.freeze(["orchestrator", "worker", "reviewer", "redteam"]);

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

async function readTextIfPresent(filePath) {
  try {
    return {
      present: true,
      content: await readFile(filePath, "utf8"),
      error: null
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { present: false, content: "", error: null };
    }
    return { present: false, content: "", error: error.message };
  }
}

function parseLauncherRoleModels(toml) {
  const roleModels = new Map();
  let currentRole = null;

  for (const rawLine of String(toml).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const section = line.match(/^\[roles\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$/);
    if (section) {
      currentRole = section[1];
      if (!roleModels.has(currentRole)) {
        roleModels.set(currentRole, null);
      }
      continue;
    }

    if (!currentRole) {
      continue;
    }

    const model = line.match(/^model\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
    if (model && model[1].trim().length > 0) {
      roleModels.set(currentRole, model[1].trim());
    }
  }

  return roleModels;
}

function inspectLauncherToml(content) {
  const roleModels = parseLauncherRoleModels(content);
  const roles = Object.fromEntries(
    LAUNCHER_REQUIRED_ROLES.map((role) => [role, roleModels.get(role) ?? null])
  );
  const missingRoleModels = LAUNCHER_REQUIRED_ROLES.filter(
    (role) => typeof roleModels.get(role) !== "string" || roleModels.get(role).length === 0
  );
  return {
    roles,
    missing_role_models: missingRoleModels,
    valid: missingRoleModels.length === 0
  };
}

async function inspectLauncherRegistry(targetDir) {
  const registry = await readTextIfPresent(path.join(targetDir, LAUNCHER_REGISTRY_PATH));
  if (!registry.present) {
    return {
      present: false,
      valid: false,
      error: registry.error,
      agent_count: 0,
      supported_agents: []
    };
  }

  try {
    const parsed = JSON.parse(registry.content);
    const data = parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object"
      ? parsed.data
      : parsed;
    const agents =
      data && typeof data === "object" && data.agents && typeof data.agents === "object"
        ? data.agents
        : null;
    const supportedAgents = agents
      ? ["codex", "claude"].filter((family) => {
          const baseArgv = agents[family]?.base_argv;
          return Array.isArray(baseArgv) && baseArgv.length > 0;
        })
      : [];
    return {
      present: true,
      valid: supportedAgents.length === 2,
      error: null,
      agent_count: supportedAgents.length,
      supported_agents: supportedAgents
    };
  } catch (error) {
    return {
      present: true,
      valid: false,
      error: error.message,
      agent_count: 0,
      supported_agents: []
    };
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
  const implementationSlices = slices
    .filter((slice) => slice?.work_kind === "implementation")
    .map((slice) => ({ id: slice.id, status: slice.status }));
  const reviewSlices = slices
    .filter((slice) => slice?.work_kind === "review")
    .map((slice) => ({ id: slice.id, status: slice.status }));

  return {
    status: "pass",
    detail: `Work record ${ADOPTION_TRACKER_ID} loaded and validated (0 errors); review-only adoption tracker is not treated as an implementation dispatch target.`,
    evidence: {
      record_id: ADOPTION_TRACKER_ID,
      valid: true,
      diagnostics_count: diagnostics.length,
      diagnostics: diagnostics.slice(0, 5),
      work_kind: loaded?.record?.work_kind ?? null,
      write_scope_count: Array.isArray(loaded?.record?.write_scope) ? loaded.record.write_scope.length : null,
      review_slices: reviewSlices,
      implementation_slices: implementationSlices
    },
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
  const loadedTracker = await readWorkRecordById({ dir: targetDir, id: ADOPTION_TRACKER_ID });
  const tracker = loadedTracker?.valid === true ? loadedTracker.record : null;
  const trackerSlices = Array.isArray(tracker?.slices) ? tracker.slices : [];
  const implementationSlices = trackerSlices.filter((slice) => slice?.work_kind === "implementation");
  const reviewSlices = trackerSlices.filter((slice) => slice?.work_kind === "review");
  const reviewOnlyTracker =
    tracker?.work_kind === "review" &&
    implementationSlices.length === 0 &&
    (Array.isArray(tracker?.write_scope) ? tracker.write_scope.length === 0 : true);

  const agentsPresent = await pathExists(path.join(targetDir, ROOT_AGENTS_PATH));
  const launcherToml = await readTextIfPresent(path.join(targetDir, LAUNCHER_TOML_PATH));
  const launcherTomlInspection = launcherToml.present
    ? inspectLauncherToml(launcherToml.content)
    : { roles: {}, missing_role_models: [...LAUNCHER_REQUIRED_ROLES], valid: false };
  const launcherRegistry = await inspectLauncherRegistry(targetDir);
  const roleGuardSecretPresent = await pathExists(path.join(targetDir, LAUNCHER_ROLE_GUARD_SECRET_PATH));

  const missing = [];
  if (!launcherToml.present) {
    missing.push(LAUNCHER_TOML_PATH);
  } else if (!launcherTomlInspection.valid) {
    missing.push(`${LAUNCHER_TOML_PATH} role model defaults`);
  }
  if (!launcherRegistry.valid) {
    missing.push(LAUNCHER_REGISTRY_PATH);
  }
  if (!roleGuardSecretPresent) {
    missing.push(LAUNCHER_ROLE_GUARD_SECRET_PATH);
  }

  const operatorPrerequisites = {
    agents_md: {
      path: ROOT_AGENTS_PATH,
      present: agentsPresent
    },
    launcher_toml: {
      path: LAUNCHER_TOML_PATH,
      present: launcherToml.present,
      read_error: launcherToml.error,
      required_roles: LAUNCHER_REQUIRED_ROLES,
      roles: launcherTomlInspection.roles,
      missing_role_models: launcherTomlInspection.missing_role_models
    },
    launcher_init_config: {
      registry_path: LAUNCHER_REGISTRY_PATH,
      registry_present: launcherRegistry.present,
      registry_valid: launcherRegistry.valid,
      registry_error: launcherRegistry.error,
      agent_count: launcherRegistry.agent_count,
      supported_agents: launcherRegistry.supported_agents,
      role_guard_secret_path: LAUNCHER_ROLE_GUARD_SECRET_PATH,
      role_guard_secret_present: roleGuardSecretPresent
    }
  };

  if (tracker && !reviewOnlyTracker) {
    const readiness = await validateWorkRecordDispatch({
      dir: targetDir,
      unitAddress: ADOPTION_TRACKER_ID
    });
    const dispatchable = readiness?.dispatchable === true;
    const reasons = Array.isArray(readiness?.reasons) ? readiness.reasons : [];
    const decisionCode =
      typeof readiness?.decision_code === "string" ? readiness.decision_code : "unknown";
    const pass = missing.length === 0 && dispatchable;
    const blockers = [];
    if (missing.length > 0) {
      blockers.push(`launcher first-run prerequisites are incomplete: ${missing.join(", ")}`);
    }
    if (!dispatchable) {
      blockers.push(`validate-dispatch reported ${decisionCode}`);
    }
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `${ADOPTION_TRACKER_ID} is not review-only, so validate-dispatch was evaluated and reported dispatchable; launcher first-run prerequisites are present.`
        : `${ADOPTION_TRACKER_ID} is not review-only, so validate-dispatch was evaluated before treating the repo as ready: ${blockers.join("; ")}.`,
      evidence: {
        unit: ADOPTION_TRACKER_ID,
        tracker_mode: "dispatch-target",
        dispatch_target: true,
        dispatchable,
        decision_code: decisionCode,
        reasons,
        review_slices: reviewSlices.map((slice) => ({ id: slice.id, status: slice.status })),
        implementation_slices: implementationSlices.map((slice) => ({
          id: slice.id,
          status: slice.status
        })),
        ...operatorPrerequisites,
        coordination_preflight:
          "non-review-only WK-0001 must pass validate-dispatch and launcher first-run setup before orchestration; AGENTS.md is advisory context"
      },
      blocker: pass
        ? null
        : {
            code: dispatchable
              ? "operator_first_run_prerequisites_missing"
              : "tracker_validate_dispatch_failed",
            message: dispatchable
              ? `launcher first-run prerequisites are incomplete before orchestration: ${missing.join(", ")}`
              : `${ADOPTION_TRACKER_ID} validate-dispatch failed with ${decisionCode}`
          },
      remediation: pass
        ? null
        : dispatchable
          ? 'Follow the first-run launcher guidance: copy/review the detected agent-launch.<claude-or-codex>.toml template to agent-launch.toml, run `npx agent-launch init-config`, review/commit those setup surfaces, then re-run `npx -p @agent-chassis/wiki-cli wiki adoption verify --dir "$PWD" --json`.'
          : 'Run `npx -p @agent-chassis/wiki-cli wiki validate-dispatch --unit WK-0001 --dir "$PWD" --json` and resolve the reported dispatch-readiness blockers before treating WK-0001 as an implementation dispatch target.'
    };
  }

  const pass = missing.length === 0;
  return {
    status: pass ? "pass" : "fail",
    detail: pass
      ? "Launcher first-run prerequisites for orchestration are present: agent-launch.toml role defaults and launcher init-config local config surfaces."
      : `Launcher first-run prerequisites for orchestration are incomplete: ${missing.join(", ")}.`,
    evidence: {
      unit: ADOPTION_TRACKER_ID,
      tracker_mode: "review-only",
      dispatch_target: false,
      ...operatorPrerequisites,
      coordination_preflight:
        "launcher first-run setup must be completed before orchestrator dispatch; AGENTS.md is advisory context"
    },
    blocker: pass
      ? null
      : {
          code: "operator_first_run_prerequisites_missing",
          message: `launcher first-run prerequisites are incomplete before orchestration: ${missing.join(", ")}`
        },
    remediation: pass
      ? null
      : 'Follow the first-run launcher guidance: copy/review the detected agent-launch.<claude-or-codex>.toml template to agent-launch.toml, run `npx agent-launch init-config`, review/commit those setup surfaces, then re-run `npx -p @agent-chassis/wiki-cli wiki adoption verify --dir "$PWD" --json`.'
  };
}

async function runAgentsMdInfo(targetDir) {
  const present = await pathExists(path.join(targetDir, "AGENTS.md"));
  return {
    status: present ? "pass" : "skipped",
    detail: present
      ? "AGENTS.md is present (repo-local operating authority); this check is advisory and does not gate agent-operability."
      : "AGENTS.md is not present. Bootstrap never generates it; authoring it is operator-owned advisory context and does not gate agent-operability by itself.",
    evidence: { path: "AGENTS.md", present },
    blocker: null,
    remediation: present
      ? null
      : "Add or adapt AGENTS.md from the seeded wiki/templates/AGENTS.md.boilerplate.md helper for durable repo-local agent guidance."
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
