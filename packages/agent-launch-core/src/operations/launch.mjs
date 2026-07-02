import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { loadRegistry, resolveAgentConfig } from "../lib/registry.mjs";
import { loadAndVerifyToken, moveToken } from "../lib/token.mjs";
import { assertAgentRunsNotTracked, findRepoRoot } from "../lib/git.mjs";
import { createRunId, getReviewDir, getRunDir } from "../lib/paths.mjs";
import { copyTree, ensureDirectory, fileExists, readJson, sha256, sha256File, writeJsonAtomic } from "../lib/filesystem.mjs";

const DEFAULT_STALE_PROCESS_POLL_MS = 1_000;

export const REVIEWED_BLACKBOARD_DEACTIVATED_DIAGNOSTIC_CODE =
  "REVIEWED_BLACKBOARD_DEACTIVATED";

const REVIEWED_BLACKBOARD_DEACTIVATED_LAUNCH_MESSAGE =
  "Reviewed blackboard handoff launch is deactivated. " +
  "The launcher will not spawn a child agent for reviewed bundles. " +
  "Use direct role dispatch or your configured orchestration backend instead. " +
  "[agent-launch:reviewed-blackboard-deactivated]";

function throwReviewedBlackboardDeactivated() {
  const error = new Error(REVIEWED_BLACKBOARD_DEACTIVATED_LAUNCH_MESSAGE);
  error.code = REVIEWED_BLACKBOARD_DEACTIVATED_DIAGNOSTIC_CODE;
  throw error;
}

function compareTokenToReview(tokenPayload, review) {
  for (const key of [
    "review_id",
    "handoff_id",
    "agent",
    "mode",
    "repo_root",
    "input_manifest_hash",
    "registry_hash",
    "expires_at"
  ]) {
    if (String(tokenPayload[key]) !== String(review[key])) {
      throw new Error(`Token/review mismatch for ${key}`);
    }
  }
}

function parseTrustedImplementSubject(subject, repoRoot) {
  const repoName = path.basename(repoRoot);
  const match = String(subject ?? "").match(/^([^:\s]+):(WK-[0-9]+)$/);
  if (!match) {
    throw new Error("implement launch requires subject in exact repo-qualified WK form");
  }
  const [, subjectRepo, wk] = match;
  if (subjectRepo !== repoName) {
    throw new Error(`implement launch subject repo ${subjectRepo} does not match ${repoName}`);
  }
  return wk;
}

function buildLauncherRoleContext({ review, manifest }) {
  if (review.mode === "redteam" || review.mode === "code_review") {
    return {
      role: "reviewer",
      effective_role: "reviewer",
      role_source: "launcher_metadata",
      wk: null,
      wk_source: "absent"
    };
  }
  if (review.mode === "implement") {
    const wk = parseTrustedImplementSubject(manifest.subject, review.repo_root);
    return {
      role: "worker",
      effective_role: "worker",
      role_source: "launcher_metadata",
      wk,
      wk_source: "launcher_metadata"
    };
  }
  throw new Error(`Unknown launcher mode: ${review.mode}`);
}

function sanitizeAbsoluteArg(value, placeholders) {
  for (const [actual, token] of placeholders) {
    if (value === actual) {
      return token;
    }
  }
  if (path.isAbsolute(value)) {
    return "<abs_path>";
  }
  return value;
}

function guessMediaKind(filePath) {
  if (typeof filePath !== "string") {
    return "text/plain";
  }
  if (filePath.endsWith(".json")) {
    return "application/json";
  }
  if (filePath.endsWith(".md")) {
    return "text/markdown";
  }
  return "text/plain";
}

function guessSensitivityClass(filePath) {
  if (typeof filePath !== "string") {
    return "routine";
  }
  if (filePath.endsWith("stderr.log") || filePath.endsWith("stdout.log")) {
    return "sensitive";
  }
  return "routine";
}

async function describeArtifact(filePath, { mediaKind = guessMediaKind(filePath), sensitivityClass = guessSensitivityClass(filePath) } = {}) {
  if (!filePath) {
    return null;
  }
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      return {
        path: filePath,
        exists: false,
        media_kind: mediaKind,
        sensitivity_class: sensitivityClass
      };
    }
    const bytes = await readFile(filePath);
    return {
      path: filePath,
      exists: true,
      byte_count: metadata.size,
      sha256: sha256(bytes),
      media_kind: mediaKind,
      sensitivity_class: sensitivityClass
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      media_kind: mediaKind,
      sensitivity_class: sensitivityClass
    };
  }
}

function stripLeadingFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function normalizeResponseContent(content, frontmatter) {
  const stripped = stripLeadingFrontmatter(content);
  const header = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    header.push(`${key}: ${value}`);
  }
  header.push("---", "", stripped.trimStart());
  return `${header.join("\n").trimEnd()}\n`;
}

function buildEmptyBodyDiagnostic(transportKind) {
  const transportLabel =
    transportKind === "stdout_capture" ? "captured nothing on child stdout" : "received no bytes in the launcher-owned response file";
  return [
    "# Launcher diagnostic",
    "",
    "The adapter exited without producing a response body.",
    `The launcher ${transportLabel} and is failing closed rather than reporting a silent completed run.`,
    "",
    "Likely causes:",
    "- the adapter's non-interactive mode suppresses the final answer (for example, Claude Code with `--permission-mode plan` submits its plan through a tool call that is not streamed to stdout in `--output-format text`)",
    "- the adapter crashed after opening the response target without writing to it",
    "- the selected wrapper/mode combination caused the model to terminate with only tool-call output",
    "",
    "Inspect `metadata/stderr.log` and `metadata/stdout.log` (when present) to diagnose.",
    ""
  ].join("\n");
}

async function buildReviewedLauncherProvenance({
  review,
  reviewId,
  runId,
  runDir,
  startedAt,
  completedAt,
  finalStatus,
  finalExitCode,
  finalSignal,
  roleContext,
  argv,
  placeholders,
  reviewPath,
  manifestPath,
  launchPath,
  statePath,
  metaPath,
  responsePath,
  stdoutPath,
  stderrPath
}) {
  const runReviewPath = path.join(runDir, "metadata", "review.json");
  const runManifestPath = path.join(runDir, "metadata", "input-manifest.json");
  const response = await describeArtifact(responsePath, {
    mediaKind: "text/markdown",
    sensitivityClass: "routine"
  });
  const meta = await describeArtifact(metaPath, {
    mediaKind: "application/json",
    sensitivityClass: "routine"
  });

  return {
    schema_version: "agent-run-provenance.v1",
    run_id: runId,
    wrapper: "agent-launch",
    role: roleContext.role,
    effective_role: roleContext.effective_role,
    review_id: reviewId,
    handoff_id: review.handoff_id,
    subject: `${review.repo_root}:${review.handoff_id}`,
    selected_agent: review.agent,
    argv_redacted: argv.map((value) => sanitizeAbsoluteArg(value, placeholders)),
    source_context: {
      review_json: await describeArtifact(runReviewPath, {
        mediaKind: "application/json",
        sensitivityClass: "routine"
      }),
      input_manifest_json: await describeArtifact(runManifestPath, {
        mediaKind: "application/json",
        sensitivityClass: "routine"
      }),
      graph_impact_checkpoint: review.graph_impact_checkpoint ?? null
    },
    authority: {
      trusted_binding: { kind: "review", id: reviewId },
      agent_role: roleContext.role,
      repo_root: review.repo_root,
      runtime_home: process.env.CODEX_HOME ?? null,
      runtime_base: path.dirname(path.dirname(runDir)),
      workspace_root: review.repo_root
    },
    runtime: {
      cwd: path.join(runDir, "agent-visible"),
      started_at: startedAt,
      completed_at: completedAt,
      started_at_epoch: Date.parse(startedAt),
      completed_at_epoch: Date.parse(completedAt),
      status: finalStatus,
      exit_status: finalExitCode,
      signal: finalSignal,
      child_pid: roleContext.child_pid ?? null
    },
    artifacts: {
      launch_json: await describeArtifact(launchPath, {
        mediaKind: "application/json",
        sensitivityClass: "routine"
      }),
      state_json: await describeArtifact(statePath, {
        mediaKind: "application/json",
        sensitivityClass: "routine"
      }),
      meta_json: meta,
      response_md: response,
      stdout_log: await describeArtifact(stdoutPath, {
        mediaKind: "text/plain",
        sensitivityClass: "sensitive"
      }),
      stderr_log: await describeArtifact(stderrPath, {
        mediaKind: "text/plain",
        sensitivityClass: "sensitive"
      })
    },
    response_digest: response?.sha256 ?? null,
    terminal_status: finalStatus,
    graph_checkpoint_disposition: review.graph_impact_checkpoint ?? null,
    cleanup: {
      retained: true,
      run_dir: runDir
    }
  };
}

function staleProcessPollMs() {
  const raw = process.env.AGENT_LAUNCH_STALE_PROCESS_POLL_MS;
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_STALE_PROCESS_POLL_MS;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_STALE_PROCESS_POLL_MS;
}

function isAlive(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

function signalChildProcessGroup(child, signal) {
  if (!child?.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
    return;
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        process.kill(child.pid, signal);
      } catch {}
      return;
    }
  }
  try {
    process.kill(child.pid, signal);
  } catch {}
}

function buildAgentEnvironment({
  review,
  roleContext,
  reviewId,
  runId,
  runDir,
  agentVisibleDir,
  handoffPath,
  contextPath,
  responsePath
}) {
  const passthrough = [
    "HOME",
    "PATH",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "COLORTERM",
    "NO_COLOR",
    "FORCE_COLOR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME"
  ];
  const env = {};
  for (const key of passthrough) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  env.AGENT_BLACKBOARD_REPO_ROOT = review.repo_root;
  env.AGENT_BLACKBOARD_RUN_DIR = runDir;
  env.AGENT_BLACKBOARD_AGENT_VISIBLE_DIR = agentVisibleDir;
  env.AGENT_BLACKBOARD_HANDOFF_PATH = handoffPath;
  env.AGENT_BLACKBOARD_CONTEXT_DIR = contextPath;
  env.AGENT_BLACKBOARD_RESPONSE_PATH = responsePath;
  env.AGENT_BLACKBOARD_REVIEW_ID = reviewId;
  env.AGENT_BLACKBOARD_RUN_ID = runId;
  env.AGENT_ROLE = roleContext.role;
  if (roleContext.wk) {
    env.AGENT_WK = roleContext.wk;
  }
  return env;
}

async function verifyReviewedBundle(reviewDir, manifest) {
  const expectedFiles = [
    {
      relativePath: manifest.wrapper.path,
      sha256: manifest.wrapper.sha256
    },
    {
      relativePath: manifest.handoff_snapshot.path,
      sha256: manifest.handoff_snapshot.sha256
    },
    ...manifest.context_files.map((file) => ({
      relativePath: file.snapshot_path,
      sha256: file.sha256
    }))
  ];

  for (const file of expectedFiles) {
    const absolutePath = path.join(reviewDir, file.relativePath);
    if (!(await fileExists(absolutePath))) {
      throw new Error(`Review bundle file missing: ${file.relativePath}`);
    }
    if (await sha256File(absolutePath) !== file.sha256) {
      throw new Error(`Review bundle file hash mismatch: ${file.relativePath}`);
    }
  }
}

export async function launchReview({ reviewId }) {
  throwReviewedBlackboardDeactivated();
  if (!reviewId) {
    throw new Error("launch requires a review id");
  }

  const cwdRepoRoot = await findRepoRoot(process.cwd());
  await assertAgentRunsNotTracked(cwdRepoRoot);
  const { token } = await loadAndVerifyToken(reviewId, "pending");
  const reviewDir = getReviewDir(cwdRepoRoot, reviewId);
  const reviewPath = path.join(reviewDir, "metadata", "review.json");
  const review = await readJson(reviewPath);
  compareTokenToReview(token.payload, review);
  if (review.repo_root !== cwdRepoRoot) {
    throw new Error("Current repo root does not match the reviewed repo root");
  }

  const manifestPath = path.join(reviewDir, "metadata", "input-manifest.json");
  const manifest = await readJson(manifestPath);
  if (sha256(JSON.stringify(manifest, null, 2) + "\n") !== review.input_manifest_hash) {
    throw new Error("Review bundle hash mismatch");
  }
  await verifyReviewedBundle(reviewDir, manifest);

  const registry = await loadRegistry();
  if (registry.hash !== review.registry_hash) {
    throw new Error("Launcher registry hash mismatch");
  }
  const agentConfig = resolveAgentConfig(registry, review.agent, review.mode);
  const roleContext = buildLauncherRoleContext({ review, manifest });

  await moveToken(reviewId, "pending", "launching");
  const runId = createRunId();
  const runDir = getRunDir(cwdRepoRoot, review.handoff_id, runId);
  const agentVisibleDir = path.join(runDir, "agent-visible");
  const metadataDir = path.join(runDir, "metadata");
  await ensureDirectory(agentVisibleDir);
  await ensureDirectory(metadataDir);

  await copyTree(path.join(reviewDir, "agent-visible"), agentVisibleDir);
  await writeJsonAtomic(path.join(metadataDir, "input-manifest.json"), manifest);
  await writeJsonAtomic(path.join(metadataDir, "review.json"), review);
  await writeJsonAtomic(path.join(metadataDir, "launch.json"), {
    schema_version: 1,
    review_id: reviewId,
    run_id: runId,
    role_context: roleContext,
    token_state: "launching",
    started_at: new Date().toISOString()
  });

  const responsePath = path.join(runDir, "response.md");
  const stderrPath = path.join(metadataDir, "stderr.log");
  const stdoutPath = path.join(metadataDir, "stdout.log");
  const wrapperPath = path.join(agentVisibleDir, "wrapper.md");
  const handoffPath = path.join(agentVisibleDir, "handoff.snapshot.md");
  const contextPath = path.join(agentVisibleDir, "context");
  const wrapperContent = await readFile(wrapperPath, "utf8");

  const placeholders = new Map([
    [review.repo_root, "<repo_root>"],
    [wrapperPath, "<wrapper_path>"],
    [responsePath, "<response_path>"],
    [wrapperContent, "<wrapper_content>"]
  ]);

  const argv = [
    ...agentConfig.base_argv,
    ...agentConfig.noninteractive_argv,
    ...(agentConfig.wrapper_arg ?? []),
    ...(agentConfig.response_transport.kind === "file" ? agentConfig.response_arg : []),
    ...(review.mode === "redteam" || review.mode === "code_review" ? agentConfig.read_only.argv_suffix : [])
  ].map((value) =>
    String(value)
      .replace("{repo_root}", review.repo_root)
      .replace("{wrapper_path}", wrapperPath)
      .replace("{wrapper_content}", wrapperContent)
      .replace("{response_path}", responsePath)
  );

  const stdoutStream = createWriteStream(
    agentConfig.response_transport.kind === "stdout_capture" ? responsePath : stdoutPath,
    { flags: "w" }
  );
  const stderrStream = createWriteStream(stderrPath, { flags: "w" });

  let terminalStatus = null;
  let requestedStatus = null;
  let terminalExitCode = null;
  let terminalSignal = null;
  let child;
  let timeoutId;
  let killTimeoutId;
  let heartbeatId;
  let staleProcessPollId;
  let confirmedStart = false;
  const startedAt = new Date().toISOString();

  const finalize = async (status) => {
    if (terminalStatus) {
      return;
    }
    clearTimeout(timeoutId);
    clearTimeout(killTimeoutId);
    clearInterval(heartbeatId);
    clearInterval(staleProcessPollId);

    const rawBody = (await fileExists(responsePath)) ? await readFile(responsePath, "utf8") : "";
    const bodyWithoutFrontmatter = stripLeadingFrontmatter(rawBody).trim();
    let finalStatus = status;
    let finalBody = rawBody;
    if (bodyWithoutFrontmatter === "") {
      if (finalStatus === "completed") {
        finalStatus = "failed";
      }
      finalBody = buildEmptyBodyDiagnostic(agentConfig.response_transport.kind);
    }
    terminalStatus = finalStatus;

    const normalized = normalizeResponseContent(finalBody, {
      schema_version: 1,
      run_id: runId,
      handoff_id: review.handoff_id,
      agent: review.agent,
      input_manifest_hash: review.input_manifest_hash,
      status: finalStatus,
      created_at: new Date().toISOString()
    });
    await writeFile(responsePath, normalized, "utf8");

    const completedAt = new Date().toISOString();
    const launchPath = path.join(metadataDir, "launch.json");
    const statePath = path.join(metadataDir, "state.json");
    const metaPath = path.join(metadataDir, "meta.json");

    await writeJsonAtomic(path.join(metadataDir, "meta.json"), {
      schema_version: 1,
      run_id: runId,
      handoff_id: review.handoff_id,
      agent: review.agent,
      mode: review.mode,
      operator_id: process.env.USER || os.userInfo().username,
      review_id: reviewId,
      input_manifest_hash: review.input_manifest_hash,
      registry_hash: review.registry_hash,
      response_sha256: await sha256File(responsePath),
      started_at: startedAt,
      completed_at: completedAt,
      status: finalStatus,
      launcher_version: "1.0.0",
      argv_redacted: argv.map((value) => sanitizeAbsoluteArg(value, placeholders)),
      timeout_seconds: agentConfig.timeout_seconds
    });

    if (child?.pid) {
      await writeJsonAtomic(statePath, {
        schema_version: 1,
        run_id: runId,
        status: finalStatus,
        pid: child.pid,
        pgid: child.pid,
        started_at: startedAt,
        heartbeat_at: completedAt
      });
    }

    const provenancePath = path.join(metadataDir, "provenance.json");
    try {
      const provenance = await buildReviewedLauncherProvenance({
        review,
        reviewId,
        runId,
        runDir,
        startedAt,
        completedAt,
        finalStatus,
        finalExitCode: terminalExitCode,
        finalSignal: terminalSignal,
        roleContext: {
          ...roleContext,
          child_pid: child?.pid ?? null
        },
        argv,
        placeholders,
        reviewPath,
        manifestPath,
        launchPath,
        statePath,
        metaPath,
        responsePath,
        stdoutPath,
        stderrPath
      });
      await writeJsonAtomic(provenancePath, provenance);
    } catch (error) {
      try {
        await writeJsonAtomic(provenancePath, {
          schema_version: "agent-run-provenance.v1",
          run_id: runId,
          wrapper: "agent-launch",
          role: roleContext.role,
          effective_role: roleContext.effective_role,
          review_id: reviewId,
          handoff_id: review.handoff_id,
          selected_agent: review.agent,
          terminal_status: finalStatus,
          provenance_error: {
            name: error?.name ?? "Error",
            code: error?.code ?? null,
            message: error?.message ?? String(error)
          }
        });
      } catch {}
    }
  };

  const requestTermination = (status) => {
    if (!child?.pid || terminalStatus) {
      return;
    }
    requestedStatus ??= status;
    signalChildProcessGroup(child, "SIGTERM");
    if (!killTimeoutId) {
      killTimeoutId = setTimeout(() => {
        signalChildProcessGroup(child, "SIGKILL");
      }, 30_000);
      killTimeoutId.unref();
    }
  };

  const cancelRun = async () => {
    requestTermination("cancelled");
  };

  process.once("SIGINT", cancelRun);
  process.once("SIGTERM", cancelRun);
  process.once("SIGHUP", cancelRun);

  try {
    child = spawn(argv[0], argv.slice(1), {
      cwd: agentVisibleDir,
      detached: true,
      env: buildAgentEnvironment({
        review,
        roleContext,
        reviewId,
        runId,
        runDir,
        agentVisibleDir,
        handoffPath,
        contextPath,
        responsePath
      }),
      stdio: [
        agentConfig.instruction_transport.kind === "stdin" ? "pipe" : "ignore",
        "pipe",
        "pipe"
      ]
    });
    let childError = null;
    let closeResolve;
    const closePromise = new Promise((resolve) => {
      closeResolve = resolve;
    });
    let staleResolve;
    const staleProcessPromise = new Promise((resolve) => {
      staleResolve = resolve;
    });
    let spawnResolve;
    let spawnReject;
    const spawnedPromise = new Promise((resolve, reject) => {
      spawnResolve = resolve;
      spawnReject = reject;
    });
    spawnedPromise.catch(() => {});
    child.on("error", (error) => {
      if (!childError) {
        childError = error;
        spawnReject(error);
        closeResolve([null, null]);
      }
    });
    child.once("spawn", spawnResolve);
    child.once("close", (code, signal) => closeResolve([code, signal]));
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);
    await writeJsonAtomic(path.join(metadataDir, "state.json"), {
      schema_version: 1,
      run_id: runId,
      status: "launching",
      pid: child.pid,
      pgid: child.pid,
      started_at: startedAt,
      heartbeat_at: startedAt
    });

    if (agentConfig.instruction_transport.kind === "stdin") {
      child.stdin.end(wrapperContent);
    }

    await spawnedPromise;
    confirmedStart = true;

    heartbeatId = setInterval(async () => {
      if (!terminalStatus && child?.pid && isAlive(child.pid)) {
        await writeJsonAtomic(path.join(metadataDir, "state.json"), {
          schema_version: 1,
          run_id: runId,
          status: "launching",
          pid: child.pid,
          pgid: child.pid,
          started_at: startedAt,
          heartbeat_at: new Date().toISOString()
        });
      }
    }, 100_000);
    heartbeatId.unref();

    staleProcessPollId = setInterval(() => {
      if (!terminalStatus && child?.pid && !isAlive(child.pid)) {
        staleResolve({ type: "stale_process" });
      }
    }, staleProcessPollMs());
    staleProcessPollId.unref();

    await moveToken(reviewId, "launching", "consumed");
    await writeJsonAtomic(path.join(metadataDir, "launch.json"), {
      schema_version: 1,
      review_id: reviewId,
      run_id: runId,
      role_context: roleContext,
      token_state: "consumed",
      started_at: startedAt
    });

    timeoutId = setTimeout(async () => {
      if (terminalStatus || !child?.pid) {
        return;
      }
      requestTermination("timed_out");
    }, agentConfig.timeout_seconds * 1000);

    const outcome = await Promise.race([
      closePromise.then(([exitCode, signal]) => ({ type: "close", exitCode, signal })),
      staleProcessPromise
    ]);
    if (childError) {
      throw childError;
    }
    if (outcome.type === "close") {
      terminalExitCode = outcome.exitCode;
      terminalSignal = outcome.signal;
    }
    if (!terminalStatus) {
      if (outcome.type === "stale_process") {
        requestTermination("failed");
        await finalize("failed");
      } else {
        await finalize(requestedStatus ?? (outcome.signal ? "failed" : outcome.exitCode === 0 ? "completed" : "failed"));
      }
    }

    return {
      runId,
      runDir,
      status: terminalStatus,
      responsePath,
      provenancePath: path.join(metadataDir, "provenance.json")
    };
  } catch (error) {
    if (!confirmedStart) {
      try {
        await moveToken(reviewId, "launching", "rejected");
      } catch {}
      try {
        await writeJsonAtomic(path.join(metadataDir, "launch.json"), {
          schema_version: 1,
          review_id: reviewId,
          run_id: runId,
          token_state: "rejected",
          started_at: startedAt
        });
      } catch {}
    }
    if (!terminalStatus) {
      await finalize(confirmedStart ? "failed" : "rejected");
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", cancelRun);
    process.removeListener("SIGTERM", cancelRun);
    process.removeListener("SIGHUP", cancelRun);
    stdoutStream.end();
    stderrStream.end();
  }
}
