

import { randomUUID } from "node:crypto";
import {
  closeSync, constants as fsConstants, openSync, readFileSync, renameSync, writeSync
} from "node:fs";
import { chmod, mkdir, mkdtemp, realpath } from "node:fs/promises";
import path from "node:path";

import { isContained, partialRealpath } from "./test-path-containment.mjs";
import { inspectPrivateDirectory, runnerOwnedRootContaining } from "./test-runner-roots.mjs";
import {
  TEST_RUN_COMPONENTS_DIR, TEST_RUN_METADATA_FILE, readTestRunContext
} from "./test-run-context.mjs";
import { TEST_TIMING_CODES, timingFailure } from "./test-timing-diagnostics.mjs";

export const TEST_RUN_METADATA_SCHEMA = "test-run.v1";
const RUN_DIRECTORY_PREFIX = "agent-chassis-test-run-";
const NESTED_DIRECTORY = "nested";
const MAX_RUN_METADATA_BYTES = 1024 * 1024;

function createFailure(message, detail) {
  return timingFailure(TEST_TIMING_CODES.ARTIFACT_CREATE_FAILED, message, detail);
}

async function refuseDisposable(candidate, currentRoots, label) {
  const resolved = await partialRealpath(candidate);
  const inherited = runnerOwnedRootContaining(resolved) ?? runnerOwnedRootContaining(candidate);
  if (inherited !== null) {
    throw createFailure(`${label} ${candidate} is inside the disposable runner root ${inherited}`,
      { path: candidate, forbidden_root: inherited });
  }
  const current = currentRoots.find((root) => isContained(resolved, root));
  if (current !== undefined) {
    throw createFailure(`${label} ${candidate} is inside this run's disposable root ${current}`,
      { path: candidate, forbidden_root: current });
  }
  return resolved;
}

function readRunMetadata(runDir) {
  const fd = openSync(path.join(runDir, TEST_RUN_METADATA_FILE),
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const text = readFileSync(fd, "utf8");
    if (Buffer.byteLength(text) > MAX_RUN_METADATA_BYTES) throw new Error("run metadata is oversized");
    return JSON.parse(text);
  } finally {
    closeSync(fd);
  }
}

async function inheritedParent(problemOrContext, currentRoots) {
  if (problemOrContext.problem) {
    throw createFailure(`inherited run context is unusable: ${problemOrContext.problem}`, {});
  }
  const { runId, runDir } = problemOrContext.context;
  const problem = inspectPrivateDirectory(runDir);
  if (problem !== null) {
    throw createFailure(`inherited run directory ${runDir} is ${problem}`, { path: runDir });
  }
  if (await realpath(runDir) !== runDir) {
    throw createFailure(`inherited run directory ${runDir} does not resolve to itself`, { path: runDir });
  }
  await refuseDisposable(runDir, currentRoots, "inherited run directory");
  let metadata;
  try {
    metadata = readRunMetadata(runDir);
  } catch (error) {
    throw createFailure(`inherited run directory ${runDir} has no readable run.json: ${error.message}`,
      { path: runDir });
  }
  if (metadata?.schema_version !== TEST_RUN_METADATA_SCHEMA || metadata.run_id !== runId) {
    throw createFailure(`inherited run directory ${runDir} does not belong to run ${runId}`,
      { path: runDir });
  }
  const nested = path.join(runDir, NESTED_DIRECTORY);
  await mkdir(nested, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const nestedProblem = inspectPrivateDirectory(nested);
  if (nestedProblem !== null) {
    throw createFailure(`nested run parent ${nested} is ${nestedProblem}`, { path: nested });
  }
  return { base: nested, parent: Object.freeze({ run_id: runId, run_dir: runDir }) };
}

export async function allocateTestRunArtifacts({
  explicitBase = null, env = process.env, defaultBase, currentRoots = [], cwd = process.cwd()
}) {
  const inherited = readTestRunContext(env);
  let base;
  let baseSource;
  let parent = null;
  try {
    if (explicitBase !== null) {
      base = path.resolve(cwd, explicitBase);
      baseSource = "explicit";
      await refuseDisposable(base, currentRoots, "--test-artifacts-dir");
      await mkdir(base, { recursive: true, mode: 0o700 });
      if (inherited?.context) parent = Object.freeze({ run_id: inherited.context.runId,
        run_dir: inherited.context.runDir });
    } else if (inherited !== null) {
      ({ base, parent } = await inheritedParent(inherited, currentRoots));
      baseSource = "inherited";
    } else {
      if (typeof defaultBase !== "string" || !path.isAbsolute(defaultBase)) {
        throw createFailure("no absolute caller temporary directory was captured", {});
      }
      base = path.resolve(defaultBase);
      baseSource = "default";
      await refuseDisposable(base, currentRoots, "artifact base");
    }
    const runDir = await mkdtemp(path.join(base, RUN_DIRECTORY_PREFIX));
    await chmod(runDir, 0o700);
    const problem = inspectPrivateDirectory(runDir);
    if (problem !== null) throw createFailure(`allocated run directory ${runDir} is ${problem}`, { path: runDir });
    await mkdir(path.join(runDir, TEST_RUN_COMPONENTS_DIR), { mode: 0o700 });
    return Object.freeze({ runId: randomUUID(), runDir, base, baseSource, parent });
  } catch (error) {
    if (error?.code === TEST_TIMING_CODES.ARTIFACT_CREATE_FAILED) throw error;
    throw createFailure(`artifact directory could not be created under ${base}: ${error.message}`,
      { path: base ?? null, errno: error?.code ?? null });
  }
}

export function writeRunMetadata(runDir, metadata) {
  const target = path.join(runDir, TEST_RUN_METADATA_FILE);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const bytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const fd = openSync(temporary,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
  try {
    for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, target);
}

export function openRunLogFile(runDir, name) {
  return openSync(path.join(runDir, name),
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
    fsConstants.O_APPEND | fsConstants.O_NOFOLLOW, 0o600);
}
