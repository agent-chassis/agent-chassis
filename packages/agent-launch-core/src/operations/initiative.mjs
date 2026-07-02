import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  validateTemporalHandoffEnvelope,
  validateTemporalLaunchRecord
} from "../lib/temporal-contracts.mjs";

const execFileAsync = promisify(execFile);

const IN_PATTERN = /^IN-\d{4}$/;
const WK_PATTERN = /^WK-\d{4}$/;
const ATTEMPT_PATTERN = /^A\d{3,}$/;
const CLOSED_STATUSES = new Set(["done", "closed", "superseded", "duplicate", "deprecated"]);
const ACTIVE_STATUSES = new Set(["todo", "in_progress", "review"]);
const TEMPORAL_WORKFLOW_NAME = "agentLaunchTemporalWorkflow";
const DEFAULT_NAMESPACE = "agent-launch";
const DEFAULT_TARGET_BRANCH = "main";
const DEFAULT_AGENT = "codex";
const DEFAULT_ATTEMPT_ID = "A001";

export class InitiativeCommandError extends Error {
  constructor(message, { code, errors = [] } = {}) {
    super(message);
    this.name = "InitiativeCommandError";
    this.code = code;
    this.errors = errors;
  }
}

export async function planInitiativeCommand({
  repoRoot = process.cwd(),
  action,
  initiativeId,
  dispatch = false,
  json = false,
  executionMode = "smoke",
  attemptId = DEFAULT_ATTEMPT_ID,
  targetBranch = DEFAULT_TARGET_BRANCH,
  temporalClient = null,
  env = process.env,
  now = () => new Date(),
  git = gitRevParseHead,
  temporalClientFactory = createTemporalClientFromEnv
} = {}) {
  assertAction(action);
  assertInitiativeId(initiativeId);
  assertAttemptId(attemptId);

  const repo = path.resolve(repoRoot);
  const state = await loadInitiativeState(repo, initiativeId);
  const liveExecution = liveExecutionState(state);
  if (executionMode === "live" && !liveExecution.available) {
    throw new InitiativeCommandError(`Live agent execution is unavailable because ${liveExecution.blocked_by} is still open`, {
      code: "live_execution_unavailable",
      errors: [{ path: "execution_mode", code: `blocked_by_${String(liveExecution.blocked_by).toLowerCase().replace("-", "_")}`, message: liveExecution.reason }]
    });
  }

  const selected = selectImplementationCandidates(state);
  const basePlan = {
    schema_version: 1,
    command: `initiative ${action}`,
    action,
    json: Boolean(json),
    dispatch_requested: Boolean(dispatch),
    dispatch_mode: dispatch ? executionMode : "plan",
    initiative: initiativeSummary(state.initiative),
    live_execution: liveExecution,
    implementation_candidates: selected.candidates.map(candidateSummary),
    active_redteam_candidates: [],
    active_redteam_reason: "no canonical findings-only redteam WK is currently dispatchable for this initiative",
    skipped: selected.skipped,
    temporal: dispatch ? temporalConfigSummary(env) : null,
    workflows: [],
    parallel_dispatchable: true,
    dispatch_blockers: []
  };
  const candidateErrors = validateImplementationDispatchPlan(basePlan.implementation_candidates);
  const overlap = findWriteScopeOverlap(basePlan.implementation_candidates);
  const dispatchBlockers = [...candidateErrors, ...(overlap ? [overlap] : [])];
  if (dispatchBlockers.length > 0) {
    basePlan.parallel_dispatchable = false;
    basePlan.dispatch_blockers = dispatchBlockers;
  }

  if (action === "status") {
    if (dispatch) {
      throw new InitiativeCommandError("initiative status is read-only and does not support --dispatch", {
        code: "status_dispatch_not_supported"
      });
    }
    return basePlan;
  }

  if (action === "redteam") {
    return planRedteam({ basePlan, state, dispatch });
  }

  if (dispatch && dispatchBlockers.length > 0) {
    throw new InitiativeCommandError("Selected implementation WK write scopes overlap; refusing parallel dispatch", {
      code: overlap ? "write_scope_overlap" : "implementation_candidates_invalid",
      errors: dispatchBlockers
    });
  }

  if (!dispatch) {
    return basePlan;
  }

  const client = temporalClient ?? await temporalClientFactory({ env });
  const baseSha = await git(repo);
  const wrapper = requiredWrapperFromEnv(env);
  const workflows = [];
  for (const candidate of basePlan.implementation_candidates) {
    const workflowInput = buildWorkflowInput({
      initiative: basePlan.initiative,
      candidate,
      attemptId,
      baseSha,
      targetBranch,
      wrapper,
      executionMode
    });
    assertWorkflowInput(workflowInput);
    const workflowId = `agent-launch-${initiativeId}-${candidate.id}-${attemptId}`;
    const startResult = await client.startWorkflow({
      workflowName: TEMPORAL_WORKFLOW_NAME,
      workflowId,
      taskQueue: requiredEnv(env, "TEMPORAL_TASK_QUEUE"),
      input: workflowInput
    });
    workflows.push({
      wk_id: candidate.id,
      workflow_name: TEMPORAL_WORKFLOW_NAME,
      workflow_id: startResult.workflowId ?? workflowId,
      run_id: startResult.runId ?? null,
      dispatch_idempotency_key: workflowInput.handoff.dispatch_idempotency_key,
      dispatch_mode: executionMode,
      execution_backend: "kubernetes_job",
      input: workflowInput
    });
  }

  return {
    ...basePlan,
    workflows
  };
}

export async function createTemporalClientFromEnv({ env = process.env, importer = (specifier) => import(specifier) } = {}) {
  const address = requiredEnv(env, "TEMPORAL_ADDRESS");
  const namespace = requiredEnv(env, "TEMPORAL_NAMESPACE");
  requiredEnv(env, "TEMPORAL_TASK_QUEUE");
  let temporal;
  try {
    temporal = await importer("@temporalio/client");
  } catch (error) {
    throw new InitiativeCommandError("Temporal client package is required for --dispatch", {
      code: "temporal_client_missing",
      errors: [{ path: "dependencies.@temporalio/client", code: "module_missing", message: error.message }]
    });
  }
  const { Connection, Client } = temporal;
  const connectionOptions = {
    address,
    metadata: env.TEMPORAL_API_KEY ? { authorization: `Bearer ${env.TEMPORAL_API_KEY}` } : undefined
  };
  if (String(env.TEMPORAL_TLS_ENABLED ?? "false").toLowerCase() === "true") {
    connectionOptions.tls = env.TEMPORAL_SERVER_NAME_OVERRIDE
      ? { serverNameOverride: env.TEMPORAL_SERVER_NAME_OVERRIDE }
      : {};
  }
  const connection = await Connection.connect(connectionOptions);
  const client = new Client({ connection, namespace });
  return {
    async startWorkflow({ workflowName, workflowId, taskQueue, input }) {
      const handle = await client.workflow.start(workflowName, {
        workflowId,
        taskQueue,
        args: [input]
      });
      return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId ?? handle.runId ?? null };
    }
  };
}

function planRedteam({ basePlan, state, dispatch }) {
  const docs = asStringList(state.initiative.frontmatter.docs);
  const reason = "redteam dispatch needs a canonical findings-only WK or reviewed handoff owner before Temporal dispatch";
  return {
    ...basePlan,
    dispatch_mode: "plan",
    parallel_dispatchable: false,
    dispatch_blockers: [{
      path: "redteam_plan",
      code: "not_implemented",
      message: reason
    }],
    redteam_plan: {
      mode: "findings_only",
      dispatchable: false,
      not_implemented: true,
      reason,
      read_first: [
        state.initiative.relativePath,
        ...docs
      ],
      constraints: ["Findings only", "Do not modify files"]
    },
    dispatch_requested: false,
    dispatch_blocked_reason: dispatch ? "not_implemented" : null
  };
}

function assertWorkflowInput(input) {
  const handoff = validateTemporalHandoffEnvelope(input.handoff);
  const launch = validateTemporalLaunchRecord(input.launchRecord);
  const errors = [
    ...handoff.errors.map((item) => ({ ...item, path: `handoff.${item.path}` })),
    ...launch.errors.map((item) => ({ ...item, path: `launchRecord.${item.path}` }))
  ];
  if (errors.length > 0) {
    throw new InitiativeCommandError("Generated Temporal workflow input failed contract validation", {
      code: "workflow_input_invalid",
      errors
    });
  }
}

function buildWorkflowInput({
  initiative,
  candidate,
  attemptId,
  baseSha,
  targetBranch,
  wrapper,
  executionMode
}) {
  const dispatchKey = `${initiative.id}/${candidate.id}/${attemptId}`;
  const launchRef = `refs/heads/agent-launch/${dispatchKey}`;
  const outputBranch = `agent/${dispatchKey}`;
  const jobName = buildKubernetesJobName(dispatchKey);
  const execution = {
    backend: "kubernetes_job",
    job_name: jobName,
    namespace: DEFAULT_NAMESPACE,
    mode: executionMode
  };
  const handoff = {
    schema_version: 1,
    initiative_id: initiative.id,
    wk_id: candidate.id,
    attempt_id: attemptId,
    dispatch_idempotency_key: dispatchKey,
    base_sha: baseSha,
    target_branch: targetBranch,
    launch_ref: launchRef,
    output_branch: outputBranch,
    agent: DEFAULT_AGENT,
    execution,
    handoff: {
      goal: `Smoke ${executionMode} dispatch for ${candidate.id}: ${candidate.title}`,
      read_first: Array.from(new Set([candidate.path, ...candidate.docs])),
      constraints: [
        executionMode === "live"
          ? "Run live Codex/Claude execution and trusted finalization through the direct Kubernetes Job wrapper"
          : "Dispatch mode is smoke; live Codex/Claude execution is not requested",
        "Do not merge or integrate worker output from this command"
      ],
      allowed_paths: candidate.write_scope
    },
    output_contract: {
      response_path: "agent-output/response.md",
      agent_report_path: "agent-output/agent-report.json",
      status_path: "agent-output/status.json",
      require_commit: true
    }
  };
  const launchRecord = {
    schema_version: 1,
    dispatch_idempotency_key: dispatchKey,
    initiative_id: initiative.id,
    wk_id: candidate.id,
    attempt_id: attemptId,
    launch_ref: launchRef,
    launch_sha: baseSha,
    base_sha: baseSha,
    output_branch: outputBranch,
    wrapper,
    execution,
    handoff
  };
  return { handoff, launchRecord };
}

function validateImplementationDispatchPlan(candidates) {
  if (candidates.length === 0) {
    return [{
      path: "implementation_candidates",
      code: "no_dispatchable_implementation_work",
      message: "No active implementation WKs are dispatchable for this initiative"
    }];
  }
  const errors = [];
  for (const candidate of candidates) {
    if (candidate.write_scope.length === 0) {
      errors.push({
        path: `${candidate.id}.write_scope`,
        code: "missing_write_scope",
        message: "Implementation dispatch requires explicit write_scope"
      });
    }
  }
  return errors;
}

function selectImplementationCandidates(state) {
  const candidates = [];
  const skipped = [];
  for (const issue of state.relatedIssues) {
    const status = normalizedStatus(issue.frontmatter.status);
    const id = String(issue.frontmatter.id);
    if (CLOSED_STATUSES.has(status)) {
      skipped.push({ id, title: issueTitle(issue), reason: "closed", status });
      continue;
    }
    if (!ACTIVE_STATUSES.has(status)) {
      skipped.push({ id, title: issueTitle(issue), reason: "status_not_dispatchable", status });
      continue;
    }
    if (isRedteamIssue(issue)) {
      skipped.push({ id, title: issueTitle(issue), reason: "redteam_issue_not_implementation", status });
      continue;
    }
    candidates.push(issue);
  }
  candidates.sort(issueSort);
  skipped.sort((left, right) => left.id.localeCompare(right.id));
  return { candidates, skipped };
}

function candidateSummary(issue) {
  return {
    id: String(issue.frontmatter.id),
    title: issueTitle(issue),
    status: normalizedStatus(issue.frontmatter.status),
    path: issue.relativePath,
    docs: asStringList(issue.frontmatter.docs),
    write_scope: asStringList(issue.frontmatter.write_scope)
  };
}

function initiativeSummary(issue) {
  return {
    id: String(issue.frontmatter.id),
    title: issueTitle(issue),
    status: normalizedStatus(issue.frontmatter.status),
    path: issue.relativePath,
    docs: asStringList(issue.frontmatter.docs)
  };
}

function liveExecutionState(state) {
  const requiredBlockers = ["WK-0070", "WK-0071"];
  for (const id of requiredBlockers) {
    const issue = state.issues.find((record) => record.frontmatter.id === id);
    if (!issue) {
      return {
        available: false,
        blocked_by: id,
        reason: `${id} canonical issue record is missing; live direct Kubernetes Job execution fails closed`
      };
    }
    if (!CLOSED_STATUSES.has(normalizedStatus(issue.frontmatter.status))) {
      return {
        available: false,
        blocked_by: id,
        reason: `${id} is open; live direct Kubernetes Job execution is not finalized end to end`
      };
    }
  }
  return {
    available: true,
    blocked_by: null,
    reason: "WK-0070 and WK-0071 are closed; live execution may be available subject to runtime configuration"
  };
}

async function loadInitiativeState(repoRoot, initiativeId) {
  const [initiatives, issues] = await Promise.all([
    loadRecordsFromDir(path.join(repoRoot, "wiki", "initiatives")),
    loadRecordsFromDir(path.join(repoRoot, "wiki", "issues"))
  ]);
  const matches = initiatives.filter((page) => page.frontmatter.id === initiativeId);
  if (matches.length !== 1) {
    throw new InitiativeCommandError(`Expected exactly one canonical initiative record for ${initiativeId}`, {
      code: "ambiguous_initiative_state",
      errors: [{ path: "wiki/initiatives", code: "expected_single_record", message: `Found ${matches.length} records` }]
    });
  }
  const activeWorkIds = activeWorkIdsFromInitiative(matches[0].body);
  const relatedIssues = activeWorkIds.length > 0
    ? issues.filter((issue) => activeWorkIds.includes(String(issue.frontmatter.id)))
    : issues.filter((issue) => String(issue.frontmatter.initiative ?? "") === initiativeId);
  return { initiative: matches[0], issues, relatedIssues };
}

async function loadRecordsFromDir(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const absolutePath = path.join(dir, entry.name);
    const markdown = await readFile(absolutePath, "utf8");
    const frontmatter = parseFrontmatter(markdown);
    if (!frontmatter?.id) continue;
    records.push({
      absolutePath,
      relativePath: path.relative(path.resolve(dir, "..", ".."), absolutePath).replaceAll(path.sep, "/"),
      frontmatter,
      body: markdown.replace(/^---\n[\s\S]*?\n---\n?/, ""),
      title: headingTitle(markdown) ?? String(frontmatter.title ?? frontmatter.id)
    });
  }
  return records;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const result = {};
  let currentArrayKey = null;
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (line.trim() === "") continue;
    const itemMatch = line.match(/^\s+-\s*(.*)$/);
    if (itemMatch && currentArrayKey) {
      result[currentArrayKey].push(parseScalar(itemMatch[1]));
      continue;
    }
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!fieldMatch) continue;
    const [, key, rawValue = ""] = fieldMatch;
    if (rawValue.trim() === "") {
      result[key] = [];
      currentArrayKey = key;
      continue;
    }
    result[key] = parseScalar(rawValue);
    currentArrayKey = null;
  }
  return result;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((item) => parseScalar(item));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function findWriteScopeOverlap(candidates) {
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      for (const leftPath of left.write_scope) {
        for (const rightPath of right.write_scope) {
          if (pathsOverlap(leftPath, rightPath)) {
            return {
              path: "write_scope",
              code: "write_scope_overlap",
              message: `${left.id} and ${right.id} both cover ${leftPath} / ${rightPath}`,
              left: left.id,
              right: right.id,
              left_path: leftPath,
              right_path: rightPath
            };
          }
        }
      }
    }
  }
  return null;
}

function pathsOverlap(left, right) {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizeScope(value) {
  return String(value).trim().replace(/\/+$/g, "");
}

function requiredWrapperFromEnv(env) {
  return {
    name: env.AGENT_WORKER_WRAPPER_NAME || "agent-job-wrapper",
    version: env.AGENT_WORKER_WRAPPER_VERSION || "1",
    source: requiredEnv(env, "AGENT_WORKER_WRAPPER_SOURCE"),
    digest: requiredEnv(env, "AGENT_WORKER_WRAPPER_DIGEST")
  };
}

function requiredEnv(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new InitiativeCommandError(`Missing required ${name}`, {
      code: "temporal_config_missing",
      errors: [{ path: name, code: "required", message: `${name} is required` }]
    });
  }
  return value.trim();
}

function temporalConfigSummary(env) {
  return {
    address_configured: hasEnv(env, "TEMPORAL_ADDRESS"),
    namespace_configured: hasEnv(env, "TEMPORAL_NAMESPACE"),
    task_queue_configured: hasEnv(env, "TEMPORAL_TASK_QUEUE")
  };
}

function hasEnv(env, name) {
  return typeof env?.[name] === "string" && env[name].trim() !== "";
}

function asStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function issueTitle(issue) {
  return String(issue.frontmatter.title ?? issue.title ?? issue.frontmatter.id);
}

function normalizedStatus(value) {
  return String(value ?? "").toLowerCase();
}

function isRedteamIssue(issue) {
  const tags = asStringList(issue.frontmatter.tags).map((tag) => tag.toLowerCase());
  return tags.includes("redteam") || tags.includes("final-redteam");
}

function issueSort(left, right) {
  const priority = (issue) => priorityRank(issue.frontmatter.priority);
  return priority(left) - priority(right) || String(left.frontmatter.id).localeCompare(String(right.frontmatter.id));
}

function priorityRank(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[String(value ?? "").toLowerCase()] ?? 4;
}

function buildKubernetesJobName(dispatchKey) {
  return `agent-worker-${dispatchKey.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+$/g, "");
}

function headingTitle(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function activeWorkIdsFromInitiative(body) {
  const lines = String(body ?? "").split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Active Pivot Work");
  if (start === -1) return [];
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    section.push(line);
  }
  return Array.from(section.join("\n").matchAll(/\b(WK-\d{4})\b/g)).map((item) => item[1]);
}

function assertAction(action) {
  if (!["status", "start", "redteam"].includes(action)) {
    throw new InitiativeCommandError(`Unknown initiative action: ${action}`, { code: "unknown_initiative_action" });
  }
}

function assertInitiativeId(value) {
  if (!IN_PATTERN.test(String(value ?? ""))) {
    throw new InitiativeCommandError("Expected initiative id like IN-0001", { code: "invalid_initiative_id" });
  }
}

function assertAttemptId(value) {
  if (!ATTEMPT_PATTERN.test(String(value ?? ""))) {
    throw new InitiativeCommandError("Expected attempt id like A001", { code: "invalid_attempt_id" });
  }
}

async function gitRevParseHead(repoRoot) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return stdout.trim();
}
