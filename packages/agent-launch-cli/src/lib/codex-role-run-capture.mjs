

import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, stat, realpath, writeFile } from "node:fs/promises";

import { reviewPromptSubjectPath } from "./codex-role-prompts.mjs";
import { isNonEmptyStringInternal, writeStderr } from "./codex-role-io.mjs";
import { readDispatchArtifactStats } from "./workspace-agent-dispatch-provenance.mjs";

export const AGENT_RUN_PROVENANCE_SCHEMA_VERSION = "agent-run-provenance.v1";
const AGENT_RUN_HEARTBEAT_INTERVAL_ENV_VAR = "AGENT_RUN_HEARTBEAT_INTERVAL";
const AGENT_RUN_DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const DIRECT_LAUNCH_SELECTED_AGENT = "codex";

export function resolveHeartbeatIntervalSeconds(env) {
  const raw = env && typeof env[AGENT_RUN_HEARTBEAT_INTERVAL_ENV_VAR] === "string"
    ? env[AGENT_RUN_HEARTBEAT_INTERVAL_ENV_VAR]
    : "";
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed >= 1) {
    return parsed;
  }
  return AGENT_RUN_DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
}

export async function recordHeartbeatTick({ io, plan, startedAtEpoch, heartbeatTimeline }) {
  const elapsed = Math.floor(Date.now() / 1000) - startedAtEpoch;
  let logBytes = 0;
  try {
    logBytes = (await stat(plan.logPath)).size;
  } catch {
    logBytes = 0;
  }
  const previous = heartbeatTimeline[heartbeatTimeline.length - 1];
  const note = previous && previous.log_bytes === logBytes ? "no log change" : "log updated";
  heartbeatTimeline.push({
    at: new Date().toISOString(),
    elapsed_seconds: elapsed,
    log_bytes: logBytes,
    note
  });
  writeStderr(
    io.stderr,
    `${plan.logPrefix}: still running after ${formatHeartbeatElapsed(elapsed)}; ${note}; log: ${plan.logPath}\n`
  );
}

function formatHeartbeatElapsed(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

export async function writeHeartbeatLog(heartbeatPath, heartbeatTimeline) {
  const lines = heartbeatTimeline.map(
    (entry) => `${entry.at}\t${entry.elapsed_seconds}\t${entry.log_bytes}\t${entry.note ?? ""}`
  );
  const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  try {
    await writeFile(heartbeatPath, body, "utf8");
  } catch {

  }
}

export async function writeDirectLaunchProvenance(plan, {
  startedAt,
  startedAtEpoch,
  completedAt,
  completedAtEpoch,
  status,
  childPid,
  heartbeatPath,
  heartbeatTimeline,
  moduleDir
}) {
  if (typeof plan.runDir !== "string" || plan.runDir.length === 0) {
    return;
  }
  const inputs = plan.provenanceInputs && typeof plan.provenanceInputs === "object"
    ? plan.provenanceInputs
    : {};
  const env = plan.env && typeof plan.env === "object" ? plan.env : {};
  const wrapper = isNonEmptyStringInternal(plan.logPrefix) ? plan.logPrefix : null;
  const role = isNonEmptyStringInternal(env.AGENT_ROLE) ? env.AGENT_ROLE : (plan.role ?? null);
  const wkId = isNonEmptyStringInternal(env.AGENT_WK) ? env.AGENT_WK : null;
  const inId = isNonEmptyStringInternal(env.AGENT_IN) ? env.AGENT_IN : null;
  const promptArgs = Array.isArray(inputs.promptArgs) ? inputs.promptArgs : [];
  const promptText = promptArgs.join(" ");
  const subjectAddress = isNonEmptyStringInternal(plan.subject) ? plan.subject : null;
  const subjectPath = subjectAddress ? reviewPromptSubjectPath(subjectAddress) : "";
  const subjectAbsolute = isNonEmptyStringInternal(subjectPath)
    ? path.join(plan.repo, subjectPath)
    : null;
  const runtimeHome = isNonEmptyStringInternal(env.CODEX_HOME) ? env.CODEX_HOME : null;
  const runtimeBase = runtimeHome ? path.join(runtimeHome, "tmp") : null;
  let workspaceRoot;
  try {
    workspaceRoot = await realpath(plan.repo);
  } catch {
    workspaceRoot = plan.repo;
  }

  const argvRedacted = [];
  if (wrapper) argvRedacted.push(wrapper);
  if (subjectAddress) argvRedacted.push(subjectAddress);
  for (const _arg of promptArgs) {
    argvRedacted.push("[prompt redacted]");
  }

  const envelope = {
    schema_version: AGENT_RUN_PROVENANCE_SCHEMA_VERSION,
    run_id: path.basename(plan.runDir),
    wrapper,
    role,

    subject: isNonEmptyStringInternal(env.AGENT_SUBJECT) ? env.AGENT_SUBJECT : subjectAddress,
    wk_id: wkId,
    in_id: inId,
    entrypoint: wrapper ? path.resolve(moduleDir, "..", "..", "bin", wrapper) : null,
    selected_agent: DIRECT_LAUNCH_SELECTED_AGENT,
    profile: firstArgValue(plan.args, "-p"),
    model: firstArgValue(plan.args, "-m"),
    argv_redacted: argvRedacted,
    source_context: {
      subject: await describeProvenanceFile(
        subjectAbsolute,
        isNonEmptyStringInternal(subjectPath) ? subjectPath : null,
        guessProvenanceMediaKind(subjectPath),
        "routine"
      ),
      prompt_digest: promptArgs.length > 0
        ? createHash("sha256").update(promptText).digest("hex")
        : null,
      prompt_source: promptArgs.length > 0 ? "cli_args" : "generated_default"
    },
    authority: {
      trusted_binding: wkId
        ? { kind: "wk", id: wkId }
        : inId
          ? { kind: "in", id: inId }
          : null,
      agent_role: role,
      runtime_base: runtimeBase,
      runtime_home: runtimeHome,
      workspace_root: workspaceRoot
    },
    runtime: {
      cwd: workspaceRoot,
      started_at: startedAt,
      completed_at: completedAt,
      started_at_epoch: startedAtEpoch,
      completed_at_epoch: completedAtEpoch,
      status: status === 0 ? "completed" : "failed",
      exit_status: typeof status === "number" ? status : null,
      child_pid: childPid,
      heartbeat_timeline: Array.isArray(heartbeatTimeline) ? heartbeatTimeline : []
    },
    artifacts: {
      final_response: await describeProvenanceFile(plan.finalPath, plan.finalPath, "text/markdown", "routine"),
      stderr_log: await describeProvenanceFile(plan.logPath, plan.logPath, "text/plain", "sensitive"),
      heartbeat_log: await describeProvenanceFile(heartbeatPath, heartbeatPath, "text/plain", "sensitive")
    },
    cleanup: {
      retained: true,
      run_dir: plan.runDir
    }
  };

  const metadataDir = path.join(plan.runDir, "metadata");
  await mkdir(metadataDir, { recursive: true });
  await writeFile(
    path.join(metadataDir, "provenance.json"),
    `${JSON.stringify(envelope, null, 2)}\n`,
    "utf8"
  );
}

function firstArgValue(args, flag) {
  if (!Array.isArray(args)) return null;
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === flag) {
      const value = args[i + 1];
      return typeof value === "string" && value.length > 0 ? value : null;
    }
  }
  return null;
}

function guessProvenanceMediaKind(filePath) {
  if (typeof filePath !== "string") return "text/plain";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

async function describeProvenanceFile(absolutePath, displayPath, mediaKind, sensitivityClass) {
  if (!isNonEmptyStringInternal(absolutePath)) {
    return null;
  }
  const recordedPath = isNonEmptyStringInternal(displayPath) ? displayPath : absolutePath;

  const fileStats = await readDispatchArtifactStats(absolutePath);
  if (!fileStats || !fileStats.exists) {
    return {
      path: recordedPath,
      exists: false,
      media_kind: mediaKind,
      sensitivity_class: sensitivityClass
    };
  }
  return {
    path: recordedPath,
    exists: true,
    byte_count: fileStats.byte_count,
    sha256: fileStats.sha256,
    media_kind: mediaKind,
    sensitivity_class: sensitivityClass
  };
}
