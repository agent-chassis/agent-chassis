

export const EXPLICIT_BASE_MERGE_TREE_CAPABILITY =
  "git_merge_tree_write_tree_explicit_merge_base";
export const EXPLICIT_BASE_MERGE_TREE_CORRECTION_CONDITION =
  "explicit_base_merge_tree_capability_changed";

const DIAGNOSTIC_SCHEMA_VERSION = "agent-launch.explicit-base-merge-tree-diagnostic.v1";
const CAPABILITY_CORRECTIONS = new WeakMap();
const MAX_TEXT_BYTES = 8192;
export const EXPLICIT_BASE_MERGE_TREE_PROBE_TIMEOUT_MS = 5000;
const EXPLICIT_BASE_MERGE_TREE_PROBE_MAX_BUFFER = 16 * 1024;

function boundedText(value) {
  if (value === null || value === undefined) return Object.freeze({ value: null, truncated: false });
  const input = typeof value === "string" ? value : String(value);
  const bytes = Buffer.from(input, "utf8");
  if (bytes.length <= MAX_TEXT_BYTES) return Object.freeze({ value: input, truncated: false });
  let end = MAX_TEXT_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return Object.freeze({
    value: bytes.subarray(0, end).toString("utf8"),
    truncated: true
  });
}

function processError(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) {
    return Object.freeze({
      name: boundedText(value.name).value,
      message: boundedText(value.message).value,
      code: typeof value.code === "string" ? boundedText(value.code).value : null
    });
  }
  return Object.freeze({ name: null, message: boundedText(value).value, code: null });
}

function processEvidence(result) {
  const stdout = boundedText(result?.stdout);
  const stderr = boundedText(result?.stderr);
  const runnerReportsBytes = typeof result === "object" && result !== null &&
    Object.hasOwn(result, "stderr_bytes");
  const stderrBytes = runnerReportsBytes
    ? (Number.isSafeInteger(result.stderr_bytes) ? result.stderr_bytes : null)
    : typeof result?.stderr === "string" ? Buffer.byteLength(result.stderr, "utf8") : null;
  return Object.freeze({
    ok: result?.ok === true,
    status: Number.isInteger(result?.status) ? result.status : null,
    signal: typeof result?.signal === "string" ? boundedText(result.signal).value : null,
    error: processError(result?.error),
    timed_out: result?.timed_out === true,
    stdout: stdout.value,
    stdout_truncated: stdout.truncated,
    stderr: stderr.value,
    stderr_truncated: stderr.truncated || result?.stderr_truncated === true,
    stderr_bytes: stderrBytes
  });
}

function helpText(result) {
  return `${String(result?.stdout ?? "")}\n${String(result?.stderr ?? "")}`;
}

function advertisesExplicitMergeBase(text) {
  return /^\s*--(?:\[no-\])?merge-base(?:\s|$)/mu.test(text);
}

function isPositiveUnsupportedResult(result) {
  if (result?.status !== 129 || result?.signal !== null && result?.signal !== undefined ||
      result?.error !== null && result?.error !== undefined) return false;
  const text = helpText(result);
  const firstLine = text.split(/\r?\n/u).find((line) => line.length > 0) ?? "";
  const exactUnknownOption = firstLine === "error: unknown option `merge-base'" ||
    firstLine === "error: unknown option 'merge-base'" ||
    firstLine === "error: unknown option ‘merge-base’";
  return exactUnknownOption && /usage:\s+git merge-tree\b/u.test(text) &&
    !advertisesExplicitMergeBase(text);
}

export function explicitBaseMergeTreeArgs({
  baseSha,
  currentSha,
  incomingSha,
  noReplaceObjects = false
}) {
  return Object.freeze([
    ...(noReplaceObjects ? ["--no-replace-objects"] : []),
    "merge-tree", "--write-tree", "--no-messages",
    "--merge-base", baseSha,
    currentSha,
    incomingSha
  ]);
}

function diagnostic({ operation, repo, args, baseSha, currentSha, incomingSha, result, capability }) {
  const repository = boundedText(repo);
  return Object.freeze({
    schema_version: DIAGNOSTIC_SCHEMA_VERSION,
    operation,
    argv: Object.freeze([...args]),
    repository: repository.value,
    repository_truncated: repository.truncated,
    identities: Object.freeze({
      base_sha: baseSha,
      current_sha: currentSha,
      incoming_sha: incomingSha
    }),
    process: processEvidence(result),
    capability: Object.freeze({
      name: EXPLICIT_BASE_MERGE_TREE_CAPABILITY,
      state: capability,
      executable_path: null,
      git_version: null
    })
  });
}

export function classifyExplicitBaseMergeTreeResult({
  operation,
  repo,
  args,
  baseSha,
  currentSha,
  incomingSha,
  result
}) {
  if (result?.ok === true) return Object.freeze({ kind: "success", result });
  const unsupported = isPositiveUnsupportedResult(result);
  const conflict = !unsupported && result?.status === 1 &&
    (result?.signal === null || result?.signal === undefined) &&
    (result?.error === null || result?.error === undefined);
  const kind = unsupported
    ? "required_capability_unavailable"
    : conflict
      ? "content_conflict"
      : "execution_failure";
  return Object.freeze({
    kind,
    diagnostic: diagnostic({
      operation, repo, args, baseSha, currentSha, incomingSha, result,
      capability: unsupported ? "unsupported" : "unknown"
    })
  });
}

export function registerExplicitBaseMergeTreeCapabilityCorrection(error, { repo, diagnostic: evidence }) {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) return error;
  CAPABILITY_CORRECTIONS.set(error, Object.freeze({
    condition: EXPLICIT_BASE_MERGE_TREE_CORRECTION_CONDITION,
    reason: "required_git_capability_unavailable",
    decision_inputs: Object.freeze({
      repository: repo,
      capability: EXPLICIT_BASE_MERGE_TREE_CAPABILITY,
      state: "unsupported"
    }),
    evidence
  }));
  return error;
}

export function explicitBaseMergeTreeCapabilityCorrection(value) {
  return CAPABILITY_CORRECTIONS.get(value) ?? null;
}

export async function assessExplicitBaseMergeTreeCapability({
  runGit,
  repo,
  timeoutMs = EXPLICIT_BASE_MERGE_TREE_PROBE_TIMEOUT_MS
}) {
  const args = Object.freeze(["merge-tree", "-h"]);
  let result;
  try {
    result = await runGit({
      repo,
      args,
      timeoutMs,
      maxBuffer: EXPLICIT_BASE_MERGE_TREE_PROBE_MAX_BUFFER
    });
  } catch (error) {
    result = { ok: false, status: null, signal: null, error, stdout: "", stderr: "" };
  }
  const text = helpText(result);
  const recognizable = /usage:\s+git merge-tree\b/u.test(text) &&
    result?.timed_out !== true &&
    (result?.signal === null || result?.signal === undefined) &&
    (result?.error === null || result?.error === undefined);
  const state = recognizable
    ? (advertisesExplicitMergeBase(text) ? "supported" : "unsupported")
    : "indeterminate";
  return Object.freeze({
    state,
    diagnostic: diagnostic({
      operation: "probe_explicit_base_merge_tree_capability",
      repo,
      args,
      baseSha: null,
      currentSha: null,
      incomingSha: null,
      result,
      capability: state
    })
  });
}
