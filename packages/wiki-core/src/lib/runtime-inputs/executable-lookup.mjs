
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";

function failed(code, operation, subject, errno, message, correction, cause) {
  return { status: "failed", code, operation, path: subject, errno, message, correction,
    ...(cause === undefined ? {} : { cause }) };
}

function invalid(operation, subject, reason, correction) {
  return failed("runtime_input_executable_invalid", operation, subject, null,
    `${operation} for ${subject}: ${reason}`, correction);
}

function observeCandidate(candidate) {
  let operation = "realpath";
  try {
    const resolved = realpathSync(candidate);
    operation = "stat";
    const stat = statSync(resolved);
    if (!stat.isFile()) {
      return invalid(operation, candidate, "resolved path is not a regular file",
        `replace executable path ${candidate} with an executable regular file`);
    }
    operation = "access";
    accessSync(resolved, constants.X_OK);
    return { status: "found", requested_path: candidate, resolved_path: resolved,
      identity: { dev: stat.dev, ino: stat.ino, size: stat.size,
        mtime_ms: stat.mtimeMs, ctime_ms: stat.ctimeMs } };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    return failed("runtime_input_executable_lookup_failed", operation, candidate,
      error?.code ?? null, `${operation} for executable ${candidate} failed: ${error.message}`,
      `repair executable path ${candidate} so ${operation} succeeds`, error);
  }
}

export function observeExecutable(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return invalid("input", "executable lookup input", "expected one lookup selector",
      "supply either { command, searchPath } or { executable }");
  }
  const keys = Object.keys(input);
  const configured = keys.length === 1 && keys[0] === "executable";
  const onPath = keys.includes("command") && keys.every((key) =>
    key === "command" || key === "searchPath");
  if (!configured && !onPath) {
    return invalid("input", "executable lookup input", "ambiguous or unsupported selector",
      "supply exactly { command, searchPath } or { executable }");
  }
  if (configured) {
    const executable = input.executable;
    if (typeof executable !== "string" || executable.length === 0 || !path.isAbsolute(executable)) {
      return invalid("input", String(executable), "configured executable must be an absolute path",
        `set executable to an absolute path instead of ${String(executable)}`);
    }
    return observeCandidate(executable) ?? { status: "absent", searched_paths: [executable] };
  }
  const { command, searchPath } = input;
  if (typeof command !== "string" || !command || command === "." || command === ".." ||
      command.includes("/") || command.includes("\\")) {
    return invalid("input", String(command), "command must be a nonempty basename",
      `set command to an executable basename instead of ${String(command)}`);
  }
  if (searchPath !== undefined && typeof searchPath !== "string") {
    return invalid("input", "searchPath", "PATH must be a string or undefined",
      "set searchPath to a PATH string or leave it undefined");
  }
  const searched_paths = [];
  for (const directory of (searchPath ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, command);
    searched_paths.push(candidate);
    const observed = observeCandidate(candidate);
    if (observed !== null) return observed;
  }
  return { status: "absent", searched_paths };
}
