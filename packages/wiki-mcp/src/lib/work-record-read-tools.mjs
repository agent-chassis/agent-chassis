

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  getWorkRecordSummary,
  readWorkRecordById,
  validateDocsPolicyOperation,
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";
import { runWorkRecordSummaryWithCompactGate } from "./work-record-compact-read-gate.mjs";

const NODE_TEST_STEP_TIMEOUT_MS = 30000;
const NODE_TEST_OUTPUT_CAP_BYTES = 65536;

const NODE_TEST_FORBIDDEN_CALLER_FIELDS = [
  "snapshot",
  "authoritySnapshot",
  "validation_authority",
  "authority",
  "runtime_policy",
  "runtimePolicy",
  "launcherRuntimePolicy",
  "policy",
  "env",
  "runtime_env",
  "runtimeDirs",
  "runtime_dirs",
  "node_binary",
  "nodeBinary",
  "workspace_identity",
  "source_digest",
  "timeout",
  "outputCap",
  "cwd",
  "workspaceRoot",
  "args"
];

const RUN_VALIDATION_REFUSAL_SCHEMA_VERSION = "workspace-run-validation-refusal.v1";
const RUN_VALIDATION_TARGET_NOT_AUTHORIZED_CODE =
  "workspace_run_validation.target_not_authorized.v1";
const RUN_VALIDATION_TARGET_NOT_AUTHORIZED_NEXT_ACTION =
  "Pick a target from authorized_targets, or add this target to the unit's " +
  "sections.structured_validation.allowed[] with command node_test, then resubmit.";

function buildRunValidationTargetNotAuthorizedError({ address, requestedTarget, authorizedTargets }) {
  const message =
    `workspace_run_validation target is not authorized by the work contract for ${address}: ` +
    `${requestedTarget} is not a node_test entry in sections.structured_validation.allowed[].`;
  const error = new Error(message);
  error.envelope = {
    schema_version: RUN_VALIDATION_REFUSAL_SCHEMA_VERSION,
    tool: "workspace_run_validation",
    accepted: false,
    refusal_code: RUN_VALIDATION_TARGET_NOT_AUTHORIZED_CODE,
    refusal_message: message,
    unit: address,
    requested_target: requestedTarget,
    authorized_targets: [...authorizedTargets].sort(),
    next_action: RUN_VALIDATION_TARGET_NOT_AUTHORIZED_NEXT_ACTION
  };
  return error;
}

function toPosixRelative(value) {

  return String(value).split(path.sep).join("/").split("\\").join("/");
}

function parseNodeTestUnitAddress(unitInput) {
  const raw = typeof unitInput === "string" ? unitInput.trim() : "";
  if (!raw) {
    throw new Error("workspace_run_validation requires a non-empty unit address");
  }
  const hashIndex = raw.indexOf("#");
  if (hashIndex < 0) {
    return { address: raw, recordId: raw, sliceId: null };
  }
  const recordId = raw.slice(0, hashIndex).trim();
  const sliceId = raw.slice(hashIndex + 1).trim();
  if (!recordId || !sliceId) {
    throw new Error(`workspace_run_validation could not parse unit address: ${raw}`);
  }
  return { address: `${recordId}#${sliceId}`, recordId, sliceId };
}

function resolveNodeTestUnitSections(record, sliceId) {
  if (!sliceId) {
    return record && typeof record.sections === "object" ? record.sections : null;
  }
  const slices = Array.isArray(record && record.slices) ? record.slices : [];
  const slice = slices.find(
    (entry) =>
      entry &&
      typeof entry.id === "string" &&
      entry.id.toUpperCase() === sliceId.toUpperCase()
  );
  if (!slice) {
    return null;
  }
  return typeof slice.sections === "object" ? slice.sections : null;
}

function collectAuthorizedNodeTestTargets(sections) {
  const structured = sections && typeof sections.structured_validation === "object"
    ? sections.structured_validation
    : null;
  const allowed = structured && Array.isArray(structured.allowed) ? structured.allowed : [];
  const targets = new Set();
  for (const entry of allowed) {
    if (entry && entry.command === "node_test" && typeof entry.target === "string") {
      targets.add(toPosixRelative(entry.target));
    }
  }
  return targets;
}

function resolveNodeTestTarget(workspaceDir, targetInput) {
  if (typeof targetInput !== "string" || targetInput.length === 0) {
    throw new Error("workspace_run_validation requires a non-empty target");
  }
  if (targetInput.includes("\0") || /[\r\n]/.test(targetInput)) {
    throw new Error("workspace_run_validation target contains invalid characters");
  }
  if (path.isAbsolute(targetInput)) {
    throw new Error("workspace_run_validation target must be repo-relative");
  }
  const absolute = path.resolve(workspaceDir, targetInput);
  const relative = path.relative(workspaceDir, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("workspace_run_validation target escapes the workspace repo");
  }
  const extension = path.extname(absolute).toLowerCase();
  if (extension !== ".js" && extension !== ".mjs") {
    throw new Error("workspace_run_validation target must be a .js or .mjs file");
  }
  let realTarget;
  try {
    realTarget = fs.realpathSync(absolute);
  } catch {
    throw new Error(`workspace_run_validation target does not exist: ${toPosixRelative(relative)}`);
  }
  const realRoot = fs.realpathSync(workspaceDir);
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("workspace_run_validation target resolves outside the workspace repo");
  }
  if (!fs.statSync(realTarget).isFile()) {
    throw new Error("workspace_run_validation target is not a regular file");
  }
  return { absolute, posixRelative: toPosixRelative(relative) };
}

function buildNodeTestChildEnv() {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  for (const key of Object.keys(childEnv)) {
    if (
      key.startsWith("WIKI_MCP_") ||
      key.startsWith("AGENT_LAUNCH_") ||
      key.startsWith("NODE_ENGINE_")
    ) {
      delete childEnv[key];
    }
  }
  return childEnv;
}

function boundNodeTestOutput(value) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (Buffer.byteLength(text, "utf8") <= NODE_TEST_OUTPUT_CAP_BYTES) {
    return { text, truncated: false };
  }
  return {
    text: Buffer.from(text, "utf8").subarray(0, NODE_TEST_OUTPUT_CAP_BYTES).toString("utf8"),
    truncated: true
  };
}

function runNodeTestStep({ workspaceDir, flag, absoluteTarget, posixRelative }) {
  const result = spawnSync(process.execPath, [flag, absoluteTarget], {
    cwd: workspaceDir,
    shell: false,
    encoding: "utf8",
    env: buildNodeTestChildEnv(),
    timeout: NODE_TEST_STEP_TIMEOUT_MS,
    maxBuffer: NODE_TEST_OUTPUT_CAP_BYTES
  });
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const outputOverflow = Boolean(result.error && result.error.code === "ENOBUFS");
  const spawnError = result.error && !timedOut && !outputOverflow
    ? String(result.error.code || result.error.message || result.error)
    : null;
  const exitCode = typeof result.status === "number" ? result.status : null;
  const stdout = boundNodeTestOutput(result.stdout);
  const stderr = boundNodeTestOutput(result.stderr);
  return {
    step: `node ${flag}`,
    command: "node_test",
    argv: ["node", flag, posixRelative],
    target: posixRelative,
    ran: true,
    skipped: false,
    exit_code: exitCode,
    signal: result.signal ?? null,
    timed_out: timedOut,
    output_truncated: stdout.truncated || stderr.truncated || outputOverflow,
    spawn_error: spawnError,
    stdout: stdout.text,
    stderr: stderr.text,
    ok: !result.error && exitCode === 0
  };
}

export function registerWorkRecordReadTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  createCompactValidateDispatchResponse,

  registeredTier = "paid_cce"
}) {
  const isPaidTier = registeredTier !== "free_local";
  registerTool(
    "workspace_docs_policy_validate",
    {
      description:
        "Validate agent-facing docs for non-MCP role-dispatch authority drift; operator/internal sections are audience-scoped and do not automatically fail. Compact by default; pass verbose:true or include_all_findings:true for the full diagnostics payload.",
      inputSchema: {
        repo: z.string().optional(),
        paths: z.array(z.string()).optional(),
        verbose: z.boolean().optional(),
        include_all_findings: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await validateDocsPolicyOperation({
          dir: workspace.dir,
          paths: Array.isArray(args.paths) && args.paths.length > 0 ? args.paths : null,
          verbose: Boolean(args.verbose),
          include_all_findings: Boolean(args.include_all_findings)
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_summary",
    {
      description:
        "Return a compact selected-unit work-record summary. Select the unit by id, unit, or path. For tracker WK-level summaries, compact/default output is the first step: detailed done, cancelled, and parked slice bodies are intentionally omitted, and record/slice agent note bodies are omitted. For more detail, rerun the compact call or select a slice unit such as WK-0001#slice-id for bounded details and notes. Expensive verbose:true or include_full_summary:true reads are gated behind a recent compact_read_token or selected slice unit.",
      inputSchema: {
        repo: z.string().optional(),
        id: z.string().optional(),
        unit: z.string().optional(),
        path: z.string().optional(),
        verbose: z.boolean().optional(),
        include_full_summary: z.boolean().optional(),
        compact_read_token: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        if (!args.id && !args.unit && !args.path) {
          throw new Error("workspace_work_record_summary requires id, unit, or path");
        }
        const result = await runWorkRecordSummaryWithCompactGate({
          workspaceRepo: workspace.repo,
          workspaceDir: workspace.dir,
          args,
          getWorkRecordSummary,
          readWorkRecordById
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_work_record_validate",
    {
      description:
        "Validate a canonical JSON work record in a configured workspace repository. Read-only: returns structured diagnostics and never writes generated views, caches, or records.",
      inputSchema: {
        repo: z.string().optional(),
        id: z.string()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await readWorkRecordById({
          dir: workspace.dir,
          id: args.id
        });
        return jsonContent({
          workspaceRepo: workspace.repo,
          record_id: result.record_id,
          source_path_relative: result.source_path_relative,
          source_digest: result.source_digest,
          valid: result.valid,
          diagnostics: result.diagnostics
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_validate_dispatch",
    {
      description: isPaidTier
        ? "Validate dispatch readiness for a WK or slice in a configured workspace repository. Read-only: returns the structured dispatch-readiness envelope without touching the record. Compact by default; pass verbose:true for the full readiness envelope under the 'readiness' key. Set node_engine_admissibility:true to evaluate Chassis Control Engine-exclusive implementation admissibility for a structurally dispatchable implementation unit; the allow/deny decision is sourced only from the Chassis Control Engine pack path using launcher-minted env. A confirmed no-Chassis-Control-Engine config (no service URL / API key -> deterministic local_only_fail_open) no-ops the Chassis-Control-Engine-exclusive admissibility axis, so a structurally dispatchable unit stays dispatchable (records local_only / enforced=false), including an over-threshold large existing file because large-file/LOC admission is Chassis-Control-Engine-only. A configured-but-not-granting posture (down/unreachable, unratified, needs_review, reject) and a genuinely unprocessable enforcement signal stay non-launchable; only the Chassis Control Engine pack can return an admit when configured; there is no local admit fallback. The paid admissibility detail is reported as Node-Engine-returned judgments over the raw measured carrier facts; the local layer renders no threshold verdict of its own (DEC-0125)."
        : "Validate dispatch readiness for a WK or slice in a configured workspace repository. Read-only: returns the structured dispatch-readiness envelope without touching the record. Compact by default; pass verbose:true for the full readiness envelope under the 'readiness' key. Free/local readiness covers only the structural runnability floor (write_scope, acceptance, validation present, a supported role, a resolvable subject, a fresh source digest). Per DEC-0123/DEC-0125 a confirmed no-Node-Engine posture renders no local admissibility judgment, so admissibility threshold analysis is not part of free-tier readiness guidance.",
      inputSchema: {
        repo: z.string().optional(),
        unit: z.string(),
        dispatch_role: z.enum(["implementation", "read_only"]).optional(),
        mode: z.enum(["strict", "report-only"]).optional(),
        node_engine_admissibility: z.boolean().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await validateWorkRecordDispatch({
          dir: workspace.dir,
          unitAddress: args.unit,
          dispatch_role: args.dispatch_role ?? "implementation",
          mode: args.mode ?? "strict",

          node_engine_admissibility: args.node_engine_admissibility === true ? true : null
        });
        if (args.verbose === true) {
          return jsonContent({ workspaceRepo: workspace.repo, readiness: result });
        }
        return jsonContent(
          createCompactValidateDispatchResponse(workspace.repo, result, registeredTier)
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_run_validation",
    {
      description:
        "Run declared Node test validation for an implementation unit without raw shell or raw exec. Side effect: process_spawn. The only command is the fixed enum `node_test`; caller input is exactly `{ unit, target }`. The handler loads the canonical work record/slice for `unit` itself and authorizes `target` solely from that unit's sections.structured_validation.allowed[] entries with command `node_test`. It then runs `node --check <target>` and, only if check passes, `node --test <target>` using argv arrays with shell:false. Node binary, cwd, env, per-step timeout, and output caps are internal server constants and cannot be supplied or overridden by the caller. Caller-supplied authority-shaped fields (snapshot, runtime/env policy, node binary, cwd/workspace root, timeout, output cap, source digest, extra args) are rejected. Returns structured per-step evidence; `node --test` is reported as skipped when `node --check` fails.",
      inputSchema: {
        repo: z.string().optional(),
        unit: z.string(),
        target: z.string()
      }
    },
    async (args) => {
      try {
        const suppliedArgs = args && typeof args === "object" ? args : {};
        const forbidden = NODE_TEST_FORBIDDEN_CALLER_FIELDS.filter((field) =>
          Object.prototype.hasOwnProperty.call(suppliedArgs, field)
        );
        if (forbidden.length > 0) {
          throw new Error(
            `workspace_run_validation rejects caller-supplied authority fields: ${forbidden.join(", ")}. ` +
              "The command, node binary, cwd, env, timeouts, and output caps are fixed server facts; " +
              "targets are authorized only from the unit's work contract."
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const { address, recordId, sliceId } = parseNodeTestUnitAddress(args.unit);

        const loaded = await readWorkRecordById({ dir: workspace.dir, id: recordId });
        if (!loaded || !loaded.record) {
          throw new Error(`workspace_run_validation could not load canonical work record: ${recordId}`);
        }

        const sections = resolveNodeTestUnitSections(loaded.record, sliceId);
        if (!sections) {
          throw new Error(`workspace_run_validation could not resolve unit: ${address}`);
        }

        const authorizedTargets = collectAuthorizedNodeTestTargets(sections);
        const { absolute, posixRelative } = resolveNodeTestTarget(workspace.dir, args.target);
        if (!authorizedTargets.has(posixRelative)) {
          throw buildRunValidationTargetNotAuthorizedError({
            address,
            requestedTarget: posixRelative,
            authorizedTargets
          });
        }

        const checkStep = runNodeTestStep({
          workspaceDir: workspace.dir,
          flag: "--check",
          absoluteTarget: absolute,
          posixRelative
        });

        let testStep;
        if (checkStep.ok) {
          testStep = runNodeTestStep({
            workspaceDir: workspace.dir,
            flag: "--test",
            absoluteTarget: absolute,
            posixRelative
          });
        } else {
          testStep = {
            step: "node --test",
            command: "node_test",
            argv: ["node", "--test", posixRelative],
            target: posixRelative,
            ran: false,
            skipped: true,
            skipped_reason: "node --check failed; node --test not run",
            exit_code: null,
            signal: null,
            timed_out: false,
            output_truncated: false,
            spawn_error: null,
            stdout: "",
            stderr: "",
            ok: false
          };
        }

        return jsonContent({
          workspaceRepo: workspace.repo,
          tool: "workspace_run_validation",
          command: "node_test",
          unit: address,
          target: posixRelative,
          ok: checkStep.ok && testStep.ok,
          steps: [checkStep, testStep]
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
