

import path from "node:path";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync
} from "node:fs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  GLOB_CHARACTERS,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString
} from "./launch-isolation-errors.mjs";

export const DEFAULT_SYSTEM_READ_ONLY_ROOTS = Object.freeze([
  "/usr",
  "/etc",
  "/opt",
  "/lib",
  "/lib64",
  "/bin",
  "/sbin",
  "/var/lib/dpkg"
]);

export const DEFAULT_FAMILY_SYSTEM_READ_ONLY_ROOTS = Object.freeze([
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/resolv.conf",
  "/etc/ssl/certs",
  "/etc/ca-certificates"
]);

const PACKAGE_INDICATOR_FILES = Object.freeze([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "setup.py"
]);

const PACKAGE_CONTAINER_MAX_WALK = 6;

export function resolverPathFromEnv(envInput) {
  if (
    envInput
    && typeof envInput === "object"
    && !Array.isArray(envInput)
    && isNonEmptyString(envInput.PATH)
  ) {
    return envInput.PATH;
  }
  if (typeof process.env.PATH === "string" && process.env.PATH.length > 0) {
    return process.env.PATH;
  }
  return "/usr/bin:/bin";
}

export function resolveBasenameOnPath(name, pathEnv) {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    if (!path.isAbsolute(dir)) continue;
    if (GLOB_CHARACTERS.test(dir)) continue;
    const candidate = path.join(dir, name);
    let st;
    try {
      st = statSync(candidate);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function readShebangLine(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(256);
    let bytesRead;
    try {
      bytesRead = readSync(fd, buf, 0, 256, 0);
    } catch {
      return null;
    }
    if (bytesRead < 2 || buf[0] !== 0x23 || buf[1] !== 0x21) return null;
    const segment = buf.subarray(2, bytesRead);
    const nlIdx = segment.indexOf(0x0a);
    const lineEnd = nlIdx === -1 ? segment.length : nlIdx;
    const line = segment.subarray(0, lineEnd).toString("utf8").trim();
    if (line.length === 0) return null;
    const tokens = line.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return null;
    const interpreterPath = tokens[0];
    if (!path.isAbsolute(interpreterPath)) return null;
    let envInterpreterName = null;
    if (path.basename(interpreterPath) === "env") {
      for (let i = 1; i < tokens.length; i += 1) {
        const t = tokens[i];
        if (t.startsWith("-")) continue;
        if (t.includes("=")) continue;
        envInterpreterName = t;
        break;
      }
    }
    return { interpreterPath, envInterpreterName };
  } finally {
    try { closeSync(fd); } catch {   }
  }
}

function unquoteTomlString(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < 2) return null;
  const quote = trimmed[0];
  if ((quote !== "\"" && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }
  const inner = trimmed.slice(1, -1);
  if (quote === "'") return inner;
  try {
    return JSON.parse(trimmed);
  } catch {
    return inner.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
}

function parseTomlStringArray(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const out = [];
  const body = trimmed.slice(1, -1);
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i += 1;
    if (i >= body.length) break;
    const quote = body[i];
    if (quote !== "\"" && quote !== "'") break;
    let j = i + 1;
    let escaped = false;
    while (j < body.length) {
      const ch = body[j];
      if (!escaped && ch === quote) break;
      escaped = !escaped && quote === "\"" && ch === "\\";
      if (ch !== "\\") escaped = false;
      j += 1;
    }
    if (j >= body.length) break;
    const parsed = unquoteTomlString(body.slice(i, j + 1));
    if (parsed !== null) out.push(parsed);
    i = j + 1;
  }
  return out;
}

export function readCodexConfigText(env) {
  const view = env && typeof env === "object" ? env : {};
  const codexHome = isNonEmptyString(view.CODEX_HOME)
    ? view.CODEX_HOME
    : isNonEmptyString(view.HOME)
      ? path.join(view.HOME, ".codex")
      : null;
  if (!codexHome || !path.isAbsolute(codexHome)) return null;
  const configPath = path.join(codexHome, "config.toml");
  try {
    return readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
}

export function parseCodexMcpConfig(configText) {
  const servers = [];
  let current = null;
  let currentEnv = null;
  for (const rawLine of String(configText || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const section = line.match(/^\[mcp_servers\.([^\].]+)(?:\.env)?\]$/);
    if (section) {
      const isEnv = line.endsWith(".env]");
      if (!isEnv) {
        current = { name: section[1], command: null, args: [], env: {} };
        servers.push(current);
        currentEnv = null;
      } else {
        currentEnv = servers.find((server) => server.name === section[1]) ?? null;
        current = currentEnv;
      }
      continue;
    }
    if (!current || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (currentEnv && key) {
      const parsed = unquoteTomlString(value);
      if (parsed !== null) currentEnv.env[key] = parsed;
      continue;
    }
    if (key === "command") {
      current.command = unquoteTomlString(value);
    } else if (key === "args") {
      current.args = parseTomlStringArray(value);
    }
  }
  return servers;
}

function existingDirectoryReadOnlyRoot(candidate, label) {
  const lexical = assertAbsoluteSafePath(candidate, label);
  let real;
  try {
    real = realpathSync(lexical);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} could not be resolved: ${lexical}`,
      { errno: err?.code ?? null }
    );
  }
  let st;
  try {
    st = statSync(real);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
      `${label} stat failed: ${real}`,
      { errno: err?.code ?? null }
    );
  }
  if (!st.isDirectory()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `${label} must resolve to a directory: ${real}`
    );
  }
  return real;
}

function addReadOnlyRootIfNeeded(out, candidate, label, isCoveredBy) {
  if (!isNonEmptyString(candidate) || !path.isAbsolute(candidate)) return;
  const real = existingDirectoryReadOnlyRoot(candidate, label);
  if (!isCoveredBy(real)) out.add(real);
}

export function collectCodexMcpReadOnlyRoots({ env, pathEnv, systemRoots, repoReal }) {
  const configText = readCodexConfigText(env);
  if (!configText) return [];
  const isCoveredBy = makeCoverageChecker(systemRoots, repoReal);
  const roots = new Set();
  for (const server of parseCodexMcpConfig(configText)) {
    if (isNonEmptyString(server.command)) {
      if (path.isAbsolute(server.command)) {
        const resolved = resolveExecutableForPlan({
          command: server.command,
          pathEnv,
          systemRoots,
          repoReal
        });
        for (const root of resolved.extraReadOnlyRoots) {
          addReadOnlyRootIfNeeded(roots, root, `mcp_servers.${server.name}.command`, isCoveredBy);
        }
      } else if (!server.command.includes("/") && !server.command.includes(path.sep)) {
        const resolved = resolveExecutableForPlan({
          command: server.command,
          pathEnv,
          systemRoots,
          repoReal
        });
        for (const root of resolved.extraReadOnlyRoots) {
          addReadOnlyRootIfNeeded(roots, root, `mcp_servers.${server.name}.command`, isCoveredBy);
        }
      }
    }
    for (let i = 0; i < server.args.length; i += 1) {
      const arg = server.args[i];
      if (!isNonEmptyString(arg) || !path.isAbsolute(arg)) continue;
      let realArg;
      try {
        realArg = realpathSync(arg);
      } catch (err) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
          `mcp_servers.${server.name}.args[${i}] could not be resolved: ${arg}`,
          { errno: err?.code ?? null }
        );
      }
      if (isCoveredBy(realArg)) continue;
      const container = findPackageContainer(realArg) ?? path.dirname(realArg);
      addReadOnlyRootIfNeeded(roots, container, `mcp_servers.${server.name}.args[${i}]`, isCoveredBy);
    }
    if (isNonEmptyString(server.env.WIKI_MCP_REPOS)) {
      let repos;
      try {
        repos = JSON.parse(server.env.WIKI_MCP_REPOS);
      } catch (err) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_INVALID,
          `mcp_servers.${server.name}.env.WIKI_MCP_REPOS must be valid JSON`,
          { message: err?.message ?? null }
        );
      }
      if (repos && typeof repos === "object" && !Array.isArray(repos)) {

        for (const [repoName, repoPath] of Object.entries(repos)) {
          if (!isNonEmptyString(repoPath)) continue;
          const label = `mcp_servers.${server.name}.env.WIKI_MCP_REPOS.${repoName}`;
          const realRepoPath = existingDirectoryReadOnlyRoot(repoPath, label);
          if (!isCoveredBy(realRepoPath)) roots.add(realRepoPath);
        }
      }
    }
  }
  return [...roots];
}

function findPackageContainer(filePath) {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  for (let i = 0; i < PACKAGE_CONTAINER_MAX_WALK; i += 1) {
    for (const indicator of PACKAGE_INDICATOR_FILES) {
      const candidate = path.join(dir, indicator);
      let st;
      try {
        st = statSync(candidate);
      } catch {
        continue;
      }
      if (st.isFile()) return dir;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function makeCoverageChecker(systemRoots, repoReal) {
  return function isCoveredBy(target) {
    if (!isNonEmptyString(target)) return false;
    for (const root of systemRoots) {
      if (target === root) return true;
      if (target.startsWith(root + path.sep)) return true;
    }
    if (target === repoReal) return true;
    if (target.startsWith(repoReal + path.sep)) return true;
    return false;
  };
}

export function resolveExecutableForPlan({ command, pathEnv, systemRoots, repoReal }) {
  if (!isNonEmptyString(command)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
      "command must be a non-empty string"
    );
  }
  if (GLOB_CHARACTERS.test(command)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
      `command must not contain glob characters: ${command}`
    );
  }
  for (const seg of command.split(/[\\/]/)) {
    if (seg === "..") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
        `command must not contain ".." segments: ${command}`
      );
    }
  }

  const inputIsAbsolute = path.isAbsolute(command);
  let pathEntry;
  if (inputIsAbsolute) {
    pathEntry = command;
  } else if (command.includes("/") || command.includes(path.sep)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
      `command must be a basename or absolute path (got relative path with separator): ${command}`
    );
  } else {
    const found = resolveBasenameOnPath(command, pathEnv);
    if (!found) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
        `command not found on PATH: ${command}`,
        { path_env: pathEnv }
      );
    }
    pathEntry = found;
  }

  let st;
  try {
    st = statSync(pathEntry);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
      `command path stat failed: ${pathEntry}`,
      { errno: err?.code ?? null }
    );
  }
  if (!st.isFile()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
      `command path is not a regular file: ${pathEntry}`
    );
  }
  try {
    accessSync(pathEntry, fsConstants.X_OK);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
      `command is not executable: ${pathEntry}`,
      { errno: err?.code ?? null }
    );
  }

  let realPath;
  try {
    realPath = realpathSync(pathEntry);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
      `command realpath failed: ${pathEntry}`,
      { errno: err?.code ?? null }
    );
  }

  const isCoveredBy = makeCoverageChecker(systemRoots, repoReal);
  const extraRoots = new Set();
  const addRoot = (candidate) => {
    if (!isNonEmptyString(candidate)) return;
    if (!path.isAbsolute(candidate)) return;
    if (isCoveredBy(candidate)) return;
    extraRoots.add(candidate);
  };

  if (!isCoveredBy(realPath)) {
    const container = findPackageContainer(realPath) ?? path.dirname(realPath);
    addRoot(container);
  }

  const shebang = readShebangLine(realPath);
  if (shebang) {
    if (!isCoveredBy(shebang.interpreterPath)) {

      addRoot(path.dirname(shebang.interpreterPath));
    }
    if (shebang.envInterpreterName) {
      const interp = resolveBasenameOnPath(shebang.envInterpreterName, pathEnv);
      if (interp) {

        if (!isCoveredBy(interp)) {
          addRoot(path.dirname(interp));
        }
        let interpReal = interp;
        try {
          interpReal = realpathSync(interp);
        } catch {
          interpReal = interp;
        }
        if (!isCoveredBy(interpReal)) {
          const interpContainer = findPackageContainer(interpReal) ?? path.dirname(interpReal);
          addRoot(interpContainer);
        }
      }
    }
  }

  const symlinkEscapesCoverage = realPath !== pathEntry && !isCoveredBy(realPath);
  const argvCommand = (!inputIsAbsolute || symlinkEscapesCoverage) ? realPath : pathEntry;

  return {
    argvCommand,
    extraReadOnlyRoots: [...extraRoots]
  };
}
