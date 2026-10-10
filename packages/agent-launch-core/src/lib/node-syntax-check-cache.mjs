import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const SCHEMA = "node-syntax-check.v1";
const EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const digest = (value) => createHash("sha256").update(value).digest("hex");

function runtimeDigest(nodePath) {
  const hash = createHash("sha256");
  const fd = fs.openSync(nodePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function runtimeStamp(nodePath) {
  const stat = fs.statSync(nodePath, { bigint: true });
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
}

function captureInput(file) {
  const absolute = fs.realpathSync(file);
  const extension = path.extname(absolute);
  if (!EXTENSIONS.has(extension)) {
    throw new Error(`syntax cache requires .js, .mjs or .cjs: ${file}`);
  }
  const bytes = fs.readFileSync(absolute);
  let directory = path.dirname(absolute);
  let manifest = null;
  let manifestPath = null;

  while (path.basename(directory) !== "node_modules") {
    const candidate = path.join(directory, "package.json");
    try {
      manifest = fs.readFileSync(candidate);
      manifestPath = candidate;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const inNodeModules = absolute.split(path.sep).includes("node_modules");
  const identity = {
    source: digest(bytes),
    extension,
    package: manifest === null ? null : digest(manifest),
    inNodeModules,
  };
  return { absolute, bytes, manifest, manifestPath, identity };
}

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error(`syntax cache must be an owned private directory: ${directory}`);
  }
}

function readEntry(entry, key, kind = "syntax") {
  let fd;
  try {
    fd = fs.openSync(entry, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 512 || (stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new Error(`unsafe syntax cache entry: ${entry}`);
    }
    let record;
    try {
      record = JSON.parse(fs.readFileSync(fd, "utf8"));
    } catch (error) {
      throw new Error(`corrupt syntax cache entry: ${entry}`, { cause: error });
    }
    if (record?.schema !== SCHEMA || record.key !== key || record.kind !== kind ||
        (kind === "syntax" ? record.ok !== true : !/^[a-f0-9]{64}$/.test(record.runtime))) {
      throw new Error(`corrupt syntax cache entry: ${entry}`);
    }
    return record;
  } finally {
    fs.closeSync(fd);
  }
}

function publishRecord(root, entry, record) {
  const temporary = path.join(root, `.publish-${randomUUID()}.json`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, entry);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function createNodeSyntaxChecker({ cacheDir, fresh = false,
  nodePath = process.execPath, env = process.env } = {}) {
  if (typeof cacheDir !== "string" || cacheDir.length === 0) {
    throw new TypeError("syntax checker requires cacheDir");
  }
  const root = path.resolve(cacheDir);
  env = { ...env };

  const uncachedReason = fresh ? "fresh" : Object.entries(env).some(([name, value]) =>
    value && (name === "NODE_OPTIONS" || name.startsWith("LD_") || name.startsWith("DYLD_")))
    ? "runtime_environment" : null;
  const stats = { hits: 0, misses: 0, nativeChecks: 0, runtimeHashes: 0, hashMs: 0, checkMs: 0 };
  let runtime;
  let stamp;
  const assertRuntime = () => {
    if (runtimeStamp(nodePath) !== stamp) {
      throw new Error(`syntax check runtime moved during verification: ${nodePath}`);
    }
  };
  const check = (file) => {
    const native = (target) => {
      stats.nativeChecks += 1;
      const start = performance.now();
      const result = spawnSync(nodePath, ["--check", target], {
        encoding: "utf8", env, timeout: 30_000, maxBuffer: 1024 * 1024,
      });
      stats.checkMs += performance.now() - start;
      return result;
    };
    if (uncachedReason) {
      return { ...native(path.resolve(file)), cacheOutcome: "uncached", uncachedReason };
    }
    const start = performance.now();
    const input = captureInput(file);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(root);
    if (runtime === undefined) {
      stamp = runtimeStamp(nodePath);
      const runtimeKey = digest(JSON.stringify({ schema: SCHEMA, implementation: IMPLEMENTATION,
        node: fs.realpathSync(nodePath), stamp }));
      const runtimeEntry = path.join(root, `runtime-${runtimeKey}.json`);
      const existing = readEntry(runtimeEntry, runtimeKey, "runtime");
      if (existing) runtime = existing.runtime;
      else {
        runtime = runtimeDigest(nodePath);
        stats.runtimeHashes += 1;
        assertRuntime();
        publishRecord(root, runtimeEntry, { schema: SCHEMA, key: runtimeKey,
          kind: "runtime", runtime });
      }
    }
    assertRuntime();
    const key = digest(JSON.stringify({ schema: SCHEMA, implementation: IMPLEMENTATION, runtime,
      platform: process.platform, architecture: process.arch, ...input.identity }));
    stats.hashMs += performance.now() - start;
    const entry = path.join(root, `${key}.json`);
    if (readEntry(entry, key)) {
      stats.hits += 1;
      return { status: 0, signal: null, error: undefined, stdout: "", stderr: "",
        cacheOutcome: "hit", key };
    }
    stats.misses += 1;
    const work = fs.mkdtempSync(path.join(root, ".capture-"));
    try {
      const scope = input.identity.inNodeModules
        ? path.join(work, "node_modules", "capture") : work;
      fs.mkdirSync(scope, { recursive: true });

      fs.writeFileSync(path.join(scope, "package.json"), input.manifest ?? "{}", { mode: 0o600 });
      const captured = path.join(scope, `source${input.identity.extension}`);
      fs.writeFileSync(captured, input.bytes, { mode: 0o600 });
      const result = native(captured);
      assertRuntime();
      const after = captureInput(file);
      if (JSON.stringify(after.identity) !== JSON.stringify(input.identity) ||
          after.absolute !== input.absolute) {
        throw new Error(`syntax check input moved during verification: ${file}`);
      }

      if (!result.error && result.status === 0 && result.signal === null &&
          !result.stdout && !result.stderr) {
        publishRecord(root, entry, { schema: SCHEMA, key, kind: "syntax", ok: true });
      }
      const restorePaths = (text) => text?.replaceAll(captured, input.absolute)
        .replaceAll(path.join(scope, "package.json"),
          input.manifestPath ?? path.join(path.dirname(input.absolute), "package.json"));
      return { ...result,
        stdout: restorePaths(result.stdout),
        stderr: restorePaths(result.stderr),
        cacheOutcome: "miss", key };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  };
  return Object.freeze({ check, stats });
}

const IMPLEMENTATION = digest([digest, runtimeDigest, runtimeStamp, captureInput,
  assertPrivateDirectory, readEntry, publishRecord, createNodeSyntaxChecker].map(String).join("\n"));
