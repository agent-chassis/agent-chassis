

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Worker } from "node:worker_threads";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WRITING_REPOSITORY_CONTEXT = path.resolve(process.cwd());
const packageRequire = createRequire(import.meta.url);

const CACHE_FORMAT_VERSION = "controlled-contract-compiled-validator-cache.v2";
const CACHE_ROOT_SUFFIX = Object.freeze([".cache", "controlled-contract", "validators"]);
const MODULE_FORMAT = "commonjs";
const MANIFEST_FILENAME = "manifest.json";
const CODE_FILENAME = "validators.cjs";
const PUBLISH_TEMP_PREFIX = ".publish-";
const CONDEMNED_TEMP_PREFIX = ".condemned-";

const AJV_OPTIONS = Object.freeze({ strict: true, allErrors: true });
const AJV_CODE_OPTIONS = Object.freeze({ source: true, esm: false, lines: false });
const CUSTOM_FORMATS = Object.freeze({});
const CUSTOM_KEYWORDS = Object.freeze([]);

const AJV_RUNTIME_DIR_SPECIFIER = "ajv/dist/runtime";

const POPULATION_WORKER_KEY = "controlledContractCompiledValidatorCachePopulationPass";

const GENERATION_BOOTSTRAP = `
import("node:worker_threads").then(({ workerData, parentPort }) =>
  import(workerData.moduleUrl)
    .then((module) => module.__runGenerationWorker(workerData.request))
    .then((result) => parentPort.postMessage({ ok: true, result }))
    .catch((error) => parentPort.postMessage({
      ok: false,
      code: error?.code ?? null,
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      details: error?.details ?? null
    })));
`;

class CompiledValidatorCacheError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CompiledValidatorCacheError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new CompiledValidatorCacheError(code, message, details);
}

const SINGLE_ENTRY_KEY = Symbol("compiled-validator-cache.single-memo-entry");

function createEvictOnRejectionMemoStore(load) {
  const entries = new Map();

  function resolve(key, ...args) {
    const existing = entries.get(key);
    if (existing !== undefined) return existing.settled;
    const entry = { settled: null };
    let started;
    try {

      started = Promise.resolve(load(...args));
    } catch (error) {
      started = Promise.reject(error);
    }
    entry.settled = started.catch((error) => {

      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry.settled;
  }

  return { resolve, entries };
}

export function createEvictOnRejectionMemo(load) {
  const store = createEvictOnRejectionMemoStore(load);
  return (...args) => store.resolve(SINGLE_ENTRY_KEY, ...args);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function canonicalDigest(value) {
  return sha256Hex(Buffer.from(JSON.stringify(canonicalValue(value)), "utf8"));
}

function groupSlug(groupId) {
  const slug = groupId.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "").slice(0, 60);
  return slug || "group";
}

function groupMemoKey(normalized) {
  return `${normalized.groupId}\u0000${normalized.schemaDigest}`;
}

function groupDirectoryName(groupId, schemaDigest) {
  return `${groupSlug(groupId)}.${sha256Hex(groupId).slice(0, 16)}.${schemaDigest.slice(0, 16)}`;
}

function resolveWritingRepositoryRoot(workingDirectory) {
  let directory = path.resolve(workingDirectory);
  for (;;) {
    if (existsSync(path.join(directory, ".git"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) fail(
      "validator_cache_root_unresolved",
      "the writing repository root could not be resolved from the working context",
      { working_directory: path.resolve(workingDirectory) }
    );
    directory = parent;
  }
}

let writingRepositoryRoot = null;
function resolveProductionCacheRoot() {
  writingRepositoryRoot ??= resolveWritingRepositoryRoot(WRITING_REPOSITORY_CONTEXT);
  return path.join(writingRepositoryRoot, ...CACHE_ROOT_SUFFIX);
}

function describeDefinition(value) {
  if (typeof value === "function") return { kind: "function", source: value.toString() };
  if (value instanceof RegExp) return { kind: "regexp", source: value.toString() };
  if (Array.isArray(value)) return { kind: "array", items: value.map(describeDefinition) };
  if (value && typeof value === "object") return {
    kind: "object",
    entries: Object.keys(value).sort(compareCodeUnits)
      .map((key) => ({ key, value: describeDefinition(value[key]) }))
  };
  return { kind: typeof value, source: String(value) };
}

function describeCustomFormats() {
  return Object.keys(CUSTOM_FORMATS).sort(compareCodeUnits)
    .map((name) => ({ name, definition: describeDefinition(CUSTOM_FORMATS[name]) }));
}

function describeCustomKeywords() {
  return [...CUSTOM_KEYWORDS].map((keyword) => ({
    keyword: typeof keyword?.keyword === "string" ? keyword.keyword : null,
    definition: describeDefinition(keyword)
  })).sort((left, right) => compareCodeUnits(
    JSON.stringify(canonicalValue(left)), JSON.stringify(canonicalValue(right))
  ));
}

async function digestAjvRuntime() {
  const runtimeDirectory = path.dirname(
    packageRequire.resolve(`${AJV_RUNTIME_DIR_SPECIFIER}/equal`)
  );
  const listing = (await readdir(runtimeDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
  return Promise.all(listing.map(async (name) => ({
    module: `${AJV_RUNTIME_DIR_SPECIFIER}/${path.basename(name, ".js")}`,
    sha256: sha256Hex(await readFile(path.join(runtimeDirectory, name)))
  })));
}

async function readJsonFile(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function buildToolchainIdentity() {
  const [ajvManifest, ajvRuntime] = await Promise.all([
    readJsonFile(packageRequire.resolve("ajv/package.json")),
    digestAjvRuntime()
  ]);
  const toolchain = {
    cache_format_version: CACHE_FORMAT_VERSION,
    module_format: MODULE_FORMAT,
    ajv_package: { name: ajvManifest.name, version: ajvManifest.version },
    ajv_runtime: ajvRuntime,
    ajv_options: { ...AJV_OPTIONS },
    ajv_code_options: { ...AJV_CODE_OPTIONS },
    custom_formats: describeCustomFormats(),
    custom_keywords: describeCustomKeywords()
  };
  return { toolchain, toolchainDigest: canonicalDigest(toolchain) };
}

const toolchainIdentity = createEvictOnRejectionMemo(buildToolchainIdentity);

function normalizeDeclaration(groupId, declaration) {
  if (typeof groupId !== "string" || groupId.length === 0) fail(
    "validator_cache_declaration_invalid", "validator group id must be a non-empty string"
  );
  const schemas = Object.freeze([...(declaration?.schemas ?? [])]);
  const validatorEntries = Object.entries(declaration?.validators ?? {});
  if (validatorEntries.length === 0) fail(
    "validator_cache_declaration_invalid",
    "validator group declares no validators",
    { group_id: groupId }
  );
  const validators = validatorEntries.map(([name, value]) => {
    if (value && typeof value === "object" && typeof value.ref === "string" &&
        Object.keys(value).length === 1) {
      return { name, ref: value.ref, schema: null };
    }
    if (!value || typeof value !== "object") fail(
      "validator_cache_declaration_invalid",
      "validator declaration must be a schema object or a { ref } reference",
      { group_id: groupId, validator: name }
    );
    return { name, ref: null, schema: value };
  }).sort((left, right) => compareCodeUnits(left.name, right.name))
    .map((entry, index) => ({ ...entry, exportName: `v${index}` }));
  const schemaDigest = canonicalDigest({
    group_id: groupId,
    schemas: schemas.map((schema) => canonicalValue(schema)),
    validators: validators.map(({ name, ref, schema }) => ({
      name, ref, schema: schema === null ? null : canonicalValue(schema)
    }))
  });
  return Object.freeze({
    groupId,
    schemas,
    validators: Object.freeze(validators),
    names: Object.freeze(validators.map(({ name }) => name)),
    schemaDigest
  });
}

let ajvModuleLoaded = false;
let ajvCompilationCount = 0;

let activeGenerationSink = null;

async function loadAjv() {
  const [{ default: Ajv2020 }, { default: standaloneCode }] = await Promise.all([
    import("ajv/dist/2020.js"),
    import("ajv/dist/standalone/index.js")
  ]);
  ajvModuleLoaded = true;
  return { Ajv2020, standaloneCode };
}

function compileDeclarationGroup(declaration, ajv) {
  const { Ajv2020, standaloneCode } = ajv;
  const instance = new Ajv2020({ ...AJV_OPTIONS, code: { ...AJV_CODE_OPTIONS } });
  for (const [name, format] of Object.entries(CUSTOM_FORMATS)) instance.addFormat(name, format);
  for (const keyword of CUSTOM_KEYWORDS) instance.addKeyword(keyword);
  for (const schema of declaration.schemas) instance.addSchema(schema);

  const refs = {};
  for (const { exportName, ref, schema } of declaration.validators) {
    if (ref !== null) {
      refs[exportName] = ref;
      continue;
    }
    if (typeof schema.$id === "string" && instance.getSchema(schema.$id)) {
      refs[exportName] = schema.$id;
      continue;
    }
    const key = `${declaration.groupId}#${exportName}`;
    instance.addSchema(schema, key);
    refs[exportName] = key;
  }
  const resolved = {};
  for (const { name, exportName } of declaration.validators) {
    ajvCompilationCount += 1;
    const validate = instance.getSchema(refs[exportName]);
    if (typeof validate !== "function") fail(
      "validator_cache_generation_failed",
      "declared validator did not resolve to a compiled schema",
      { group_id: declaration.groupId, validator: name, ref: refs[exportName] }
    );
    resolved[name] = validate;
  }
  return { validators: Object.freeze(resolved), code: standaloneCode(instance, refs) };
}

async function writeGroupArtifact(directory, manifest, code) {
  await writeFile(path.join(directory, manifest.file), code,
    { encoding: "utf8", mode: 0o644 });
  await writeFile(path.join(directory, MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
}

async function replaceOccupiedTarget(cacheRoot, parent, target, expected, staging) {
  const occupant = await loadPublishedGroup(cacheRoot, target, expected).catch(() => null);
  if (occupant) {
    await rm(staging, { recursive: true, force: true });
    return { published: false, contended: true };
  }
  const condemned = await mkdtemp(path.join(parent, CONDEMNED_TEMP_PREFIX));
  try {
    await rename(target, path.join(condemned, "artifact"));
  } catch (error) {

    if (!["ENOENT", "EEXIST", "ENOTEMPTY", "ENOTDIR"].includes(error?.code)) {
      await rm(condemned, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  try {
    await rename(staging, target);
    return { published: true, contended: false };
  } catch (error) {
    if (!["EEXIST", "ENOTEMPTY", "ENOTDIR"].includes(error?.code)) throw error;
    await rm(staging, { recursive: true, force: true });
    return { published: false, contended: true };
  } finally {
    await rm(condemned, { recursive: true, force: true }).catch(() => {});
  }
}

async function publishGroupArtifact(cacheRoot, parent, target, expected, manifest, code) {
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, PUBLISH_TEMP_PREFIX));
  try {
    await writeGroupArtifact(staging, manifest, code);
    try {
      await rename(staging, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "ENOTDIR"].includes(error?.code)) throw error;
      return replaceOccupiedTarget(cacheRoot, parent, target, expected, staging);
    }
    return { published: true, contended: false };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function isContainedRelativePath(relative) {
  if (relative.length === 0) return false;
  if (path.isAbsolute(relative)) return false;
  if (relative === "..") return false;
  return !relative.startsWith(`..${path.sep}`);
}

async function assertContainedDirectory(cacheRoot, directory) {
  const stats = await lstat(directory).catch(() => null);
  if (stats === null) return false;
  if (stats.isSymbolicLink()) fail(
    "validator_cache_containment_violation",
    "cached validator artifact path is a symbolic link",
    { cache_root: cacheRoot, path: directory }
  );
  if (!stats.isDirectory()) fail(
    "validator_cache_file_type_invalid",
    "cached validator artifact path is not a directory",
    { cache_root: cacheRoot, path: directory }
  );
  const resolvedRoot = await realpath(cacheRoot).catch(() => null);
  if (resolvedRoot === null) fail(
    "validator_cache_containment_violation",
    "cached validator cache root could not be resolved",
    { cache_root: cacheRoot, path: directory }
  );
  const resolvedDirectory = await realpath(directory);
  if (!isContainedRelativePath(path.relative(resolvedRoot, resolvedDirectory))) fail(
    "validator_cache_containment_violation",
    "cached validator artifact escapes its cache root",
    {
      cache_root: cacheRoot,
      path: directory,
      resolved: resolvedDirectory,
      resolved_cache_root: resolvedRoot
    }
  );
  return true;
}

async function loadPublishedGroup(cacheRoot, directory, expected) {
  if (!await assertContainedDirectory(cacheRoot, directory)) return null;
  const manifestPath = path.join(directory, MANIFEST_FILENAME);
  const manifestStats = await lstat(manifestPath).catch(() => null);
  if (manifestStats === null) return null;
  if (!manifestStats.isFile()) fail(
    "validator_cache_file_type_invalid",
    "cached validator manifest is not a regular file",
    { path: manifestPath }
  );
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return null;
  }
  if (manifest?.cache_format_version !== CACHE_FORMAT_VERSION) return null;
  if (manifest.toolchain_digest !== expected.toolchainDigest) return null;
  if (canonicalDigest(manifest.toolchain) !== expected.toolchainDigest) return null;
  if (manifest.group_id !== expected.groupId) return null;
  if (manifest.schema_digest !== expected.schemaDigest) return null;

  const file = manifest.file;
  if (typeof file !== "string" || file !== path.basename(file) ||
      file.startsWith(".") || !file.endsWith(".cjs")) fail(
    "validator_cache_manifest_malformed",
    "cached validator manifest names an unusable artifact file",
    { group_id: expected.groupId, file: typeof file === "string" ? file : null }
  );
  if (!Array.isArray(manifest.validators) || manifest.validators.length === 0 ||
      typeof manifest.code_sha256 !== "string" ||
      typeof manifest.code_bytes !== "number") fail(
    "validator_cache_manifest_malformed",
    "cached validator manifest group entry is incomplete",
    { group_id: expected.groupId }
  );
  const target = path.join(directory, file);
  const stats = await lstat(target).catch(() => null);
  if (stats === null) return null;
  if (!stats.isFile()) fail(
    "validator_cache_file_type_invalid",
    "cached validator artifact entry is not a regular file",
    { group_id: expected.groupId, path: target }
  );
  const code = await readFile(target, "utf8");
  if (code.length !== manifest.code_bytes ||
      sha256Hex(Buffer.from(code, "utf8")) !== manifest.code_sha256) fail(
    "validator_cache_code_digest_mismatch",
    "cached validator code does not match its published digest",
    { group_id: expected.groupId, path: target }
  );
  return { directory, manifest, code };
}

function instantiateGroup(loaded) {
  const filename = path.join(loaded.directory, loaded.manifest.file);

  const factory = vm.compileFunction(
    loaded.code,
    ["exports", "require", "module", "__filename", "__dirname"],
    { filename }
  );
  const moduleShim = { exports: {} };
  factory(moduleShim.exports, packageRequire, moduleShim, filename, loaded.directory);
  const exported = moduleShim.exports;
  const validators = {};
  for (const { name, export: exportName } of loaded.manifest.validators) {
    const validate = exported?.[exportName];
    if (typeof validate !== "function") fail(
      "validator_cache_code_digest_mismatch",
      "cached validator artifact does not export its declared validator",
      { group_id: loaded.manifest.group_id, validator: name }
    );
    validators[name] = validate;
  }
  return Object.freeze(validators);
}

function createCompiledValidatorCache(options = {}) {
  const cacheRoot = typeof options.cacheRoot === "string" && options.cacheRoot.length > 0
    ? path.resolve(options.cacheRoot)
    : resolveProductionCacheRoot();
  const allowGeneration = options.allowGeneration !== false;

  const resolvedGroups = createEvictOnRejectionMemoStore(resolveGroupEntry);
  const groupRecords = new Map();
  let status = null;

  let populationStatusRequested = false;

  async function toolchainPaths() {
    const { toolchain, toolchainDigest } = await toolchainIdentity();
    return { toolchain, toolchainDigest, parent: path.join(cacheRoot, toolchainDigest) };
  }

  function groupExpectation(toolchainDigest, normalized) {
    return {
      toolchainDigest,
      groupId: normalized.groupId,
      schemaDigest: normalized.schemaDigest
    };
  }

  function groupDirectory(parent, normalized) {
    return path.join(parent,
      groupDirectoryName(normalized.groupId, normalized.schemaDigest));
  }

  function recordStatus(record) {
    status = Object.freeze(record);
    return status;
  }

  function groupStatusRecords() {
    return [...groupRecords.values()]
      .filter((record) => record !== null)
      .sort((left, right) => compareCodeUnits(left.group_id, right.group_id));
  }

  function refreshResolvedStatus(toolchainDigest, parent) {
    if (populationStatusRequested) return;
    const groups = groupStatusRecords();
    recordStatus({
      result: groups.every(({ result }) => result === "hit") ? "hit" : "miss",
      mode: "resolve",
      cache_root: cacheRoot,
      directory: parent,
      identity_digest: toolchainDigest,
      toolchain_digest: toolchainDigest,
      group_count: groups.length,
      groups: Object.freeze(groups.map((group) => Object.freeze({ ...group }))),
      published: groups.some(({ published }) => published),
      contended: groups.some(({ contended }) => contended),
      generation: null,
      ajv_module_loaded: ajvModuleLoaded,
      ajv_compilations: ajvCompilationCount
    });
  }

  async function runPopulationWorker(mode) {
    const worker = new Worker(GENERATION_BOOTSTRAP, {
      eval: true,
      workerData: {
        moduleUrl: import.meta.url,
        request: { [POPULATION_WORKER_KEY]: true, cacheRoot, mode }
      }
    });
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        worker.once("message", (message) => {
          settled = true;
          if (message?.ok) resolve(message.result);
          else reject(new CompiledValidatorCacheError(
            message?.code ?? "validator_cache_generation_failed",
            message?.message ?? "validator cache generation failed",
            { ...(message?.details ?? {}), worker_stack: message?.stack ?? null }
          ));
        });
        worker.once("error", reject);
        worker.once("exit", (exitCode) => {
          if (settled) return;
          reject(new CompiledValidatorCacheError(
            "validator_cache_generation_failed",
            "validator cache generation worker exited without a result",
            { exit_code: exitCode }
          ));
        });
      });
    } finally {
      await worker.terminate();
    }
  }

  const ensurePopulationPass = createEvictOnRejectionMemo(() =>
    runPopulationWorker("ensure"));

  function populationStatusRecord(pass, mode) {
    return recordStatus({
      result: pass.groups.every(({ result }) => result === "hit") ? "hit" : "miss",
      mode,
      cache_root: cacheRoot,
      directory: pass.directory,
      identity_digest: pass.toolchain_digest,
      toolchain_digest: pass.toolchain_digest,
      group_count: pass.group_count,
      groups: Object.freeze(pass.groups.map((group) => Object.freeze({ ...group }))),
      published: pass.groups.some(({ published }) => published),
      contended: pass.groups.some(({ contended }) => contended),
      generation: pass.groups_compiled === 0 ? null : Object.freeze({
        ajv_compilations: pass.ajv_compilations,
        groups_compiled: pass.groups_compiled,
        groups_reused: pass.groups_reused,
        groups_replaced_invalid: pass.groups_replaced_invalid,
        publication_error: null
      }),
      ajv_module_loaded: ajvModuleLoaded,
      ajv_compilations: ajvCompilationCount
    });
  }

  async function resolvePopulation() {
    const mode = allowGeneration ? "ensure" : "verify";
    const pass = mode === "ensure"
      ? await ensurePopulationPass()
      : await runPopulationWorker("verify");
    return populationStatusRecord(pass, mode);
  }

  const resolvePopulationStatus = createEvictOnRejectionMemo(resolvePopulation);

  function ensurePopulationStatus() {
    populationStatusRequested = true;
    return resolvePopulationStatus();
  }

  function classifyUnresolvedGroup(pass, normalized) {
    const declared = pass.groups.find(({ group_id }) => group_id === normalized.groupId);
    if (!declared) fail(
      "validator_cache_group_undeclared",
      "validator group is not part of the declared validator population",
      { group_id: normalized.groupId, toolchain_digest: pass.toolchain_digest }
    );
    if (declared.schema_digest !== normalized.schemaDigest) fail(
      "validator_cache_group_schema_mismatch",
      "requested validator group does not match the declared schema identity",
      {
        group_id: normalized.groupId,
        requested_schema_digest: normalized.schemaDigest,
        declared_schema_digest: declared.schema_digest
      }
    );
    fail(
      "validator_cache_unavailable",
      "generated compiled-validator artifact could not be loaded after publication",
      {
        cache_root: cacheRoot,
        group_id: normalized.groupId,
        schema_digest: normalized.schemaDigest,
        directory: declared.directory
      }
    );
  }

  async function resolveDeclaredGroup(normalized) {
    const { toolchainDigest, parent } = await toolchainPaths();
    const expected = groupExpectation(toolchainDigest, normalized);
    const directory = groupDirectory(parent, normalized);
    const hit = await loadPublishedGroup(cacheRoot, directory, expected);
    if (hit) {
      return {
        validators: instantiateGroup(hit),
        record: {
          group_id: normalized.groupId,
          schema_digest: normalized.schemaDigest,
          directory,
          result: "hit",
          published: false,
          contended: false,
          replaced_invalid: null
        },
        toolchainDigest,
        parent
      };
    }
    if (!allowGeneration) fail(
      "validator_cache_unavailable",
      "no valid compiled-validator artifact is published for this validator group",
      {
        cache_root: cacheRoot,
        group_id: normalized.groupId,
        schema_digest: normalized.schemaDigest,
        toolchain_digest: toolchainDigest,
        directory
      }
    );

    const pass = await ensurePopulationPass();
    const loaded = await loadPublishedGroup(cacheRoot, directory, expected);
    if (!loaded) classifyUnresolvedGroup(pass, normalized);
    const published = pass.groups.find(({ group_id }) => group_id === normalized.groupId);
    return {
      validators: instantiateGroup(loaded),
      record: {
        group_id: normalized.groupId,
        schema_digest: normalized.schemaDigest,
        directory,
        result: "miss",
        published: published?.published ?? false,
        contended: published?.contended ?? false,
        replaced_invalid: published?.replaced_invalid ?? null
      },
      toolchainDigest,
      parent
    };
  }

  async function resolveGroup(groupId, declaration) {
    const normalized = normalizeDeclaration(groupId, declaration);
    return (await resolvedGroups.resolve(
      groupMemoKey(normalized), normalized
    )).validators;
  }

  async function resolveGroupEntry(normalized) {
    const resolved = await resolveDeclaredGroup(normalized);
    groupRecords.set(groupMemoKey(normalized), resolved.record);
    refreshResolvedStatus(resolved.toolchainDigest, resolved.parent);
    return resolved;
  }

  async function runPopulationPass(mode) {
    const { toolchain, toolchainDigest, parent } = await toolchainPaths();
    const collected = new Map();
    let ajv = null;
    let compiled = 0;

    const loadForGeneration = async (directory, expected) => {
      try {
        return { loaded: await loadPublishedGroup(cacheRoot, directory, expected), invalid: null };
      } catch (error) {
        if (mode !== "ensure") throw error;
        if (!(error instanceof CompiledValidatorCacheError)) throw error;
        if (error.code === "validator_cache_containment_violation") throw error;
        return { loaded: null, invalid: error.code };
      }
    };

    const resolveForGeneration = async (normalized) => {
      const expected = groupExpectation(toolchainDigest, normalized);
      const directory = groupDirectory(parent, normalized);
      const { loaded: hit, invalid } = await loadForGeneration(directory, expected);
      if (hit) {
        return {
          validators: instantiateGroup(hit),
          record: {
            group_id: normalized.groupId,
            schema_digest: normalized.schemaDigest,
            directory,
            result: "hit",
            published: false,
            contended: false,
            replaced_invalid: null
          }
        };
      }
      if (mode !== "ensure") fail(
        "validator_cache_unavailable",
        "no valid compiled-validator artifact is published for this validator group",
        {
          cache_root: cacheRoot,
          group_id: normalized.groupId,
          schema_digest: normalized.schemaDigest,
          toolchain_digest: toolchainDigest,
          directory
        }
      );
      ajv ??= await loadAjv();
      const generated = compileDeclarationGroup(normalized, ajv);
      compiled += 1;
      const manifest = {
        cache_format_version: CACHE_FORMAT_VERSION,
        toolchain_digest: toolchainDigest,
        toolchain,
        group_id: normalized.groupId,
        schema_digest: normalized.schemaDigest,
        file: CODE_FILENAME,
        code_bytes: generated.code.length,
        code_sha256: sha256Hex(Buffer.from(generated.code, "utf8")),
        validators: normalized.validators.map(({ name, exportName }) =>
          ({ name, export: exportName }))
      };
      let outcome;
      try {
        outcome = await publishGroupArtifact(
          cacheRoot, parent, directory, expected, manifest, generated.code
        );
      } catch (error) {

        fail(
          "validator_cache_unavailable",
          "compiled-validator artifact could not be published to the cache root",
          {
            cache_root: cacheRoot,
            group_id: normalized.groupId,
            schema_digest: normalized.schemaDigest,
            directory,
            publication_error: {
              code: error?.code ?? null, message: error?.message ?? null
            }
          }
        );
      }
      return {
        validators: generated.validators,
        record: {
          group_id: normalized.groupId,
          schema_digest: normalized.schemaDigest,
          directory,
          result: "miss",
          published: outcome.published,
          contended: outcome.contended,
          replaced_invalid: invalid
        }
      };
    };

    activeGenerationSink = (normalized) => {
      const existing = collected.get(normalized.groupId);
      if (existing) {
        if (existing.schemaDigest !== normalized.schemaDigest) fail(
          "validator_cache_group_schema_mismatch",
          "validator group was declared twice with different schemas",
          { group_id: normalized.groupId }
        );
        return existing.resolved.then(({ validators }) => validators);
      }
      const entry = {
        schemaDigest: normalized.schemaDigest,
        resolved: resolveForGeneration(normalized)
      };
      collected.set(normalized.groupId, entry);
      entry.resolved.catch(() => {});
      return entry.resolved.then(({ validators }) => validators);
    };
    try {
      await import("./validator-population.mjs");
    } finally {
      activeGenerationSink = null;
    }
    if (collected.size === 0) fail(
      "validator_cache_generation_failed", "the declared validator population is empty"
    );
    const groups = await Promise.all([...collected.keys()].sort(compareCodeUnits)
      .map(async (groupId) => (await collected.get(groupId).resolved).record));
    return {
      mode,
      toolchain_digest: toolchainDigest,
      directory: parent,
      group_count: groups.length,
      groups,
      groups_compiled: compiled,
      groups_reused: groups.length - compiled,
      groups_replaced_invalid: groups.filter(({ replaced_invalid }) =>
        replaced_invalid !== null).length,
      ajv_compilations: ajvCompilationCount
    };
  }

  return Object.freeze({
    cacheRoot,
    async compiledValidators(groupId, declaration) {
      if (activeGenerationSink) {
        return activeGenerationSink(normalizeDeclaration(groupId, declaration));
      }
      return resolveGroup(groupId, declaration);
    },
    runPopulationPass,
    async load() {
      return ensurePopulationStatus();
    },
    status() {
      return status;
    }
  });
}

let productionCacheInstance = null;
function productionCache() {
  productionCacheInstance ??= createCompiledValidatorCache();
  return productionCacheInstance;
}

export async function compiledValidators(groupId, declaration) {
  if (activeGenerationSink) {
    return activeGenerationSink(normalizeDeclaration(groupId, declaration));
  }
  return productionCache().compiledValidators(groupId, declaration);
}

export async function loadCompiledValidatorCache() {
  return productionCache().load();
}

export function compiledValidatorCacheStatus() {
  return productionCache().status();
}

export function compiledValidatorCacheRoot() {
  return productionCache().cacheRoot;
}

export async function prepareCompiledValidatorCache(options = {}) {
  const mode = options.mode ?? "ensure";
  if (!["ensure", "verify"].includes(mode)) fail(
    "validator_cache_declaration_invalid", "unsupported prepare mode", { mode }
  );
  const isolated = typeof options.cacheRoot === "string" && options.cacheRoot.length > 0;
  const cache = isolated
    ? createCompiledValidatorCache({
      cacheRoot: options.cacheRoot, allowGeneration: mode === "ensure"
    })
    : mode === "ensure"
      ? productionCache()
      : createCompiledValidatorCache({ allowGeneration: false });
  const status = await cache.load();
  return Object.freeze({
    ...status,
    mode,
    isolated_cache_root: isolated,
    ajv_module_loaded: ajvModuleLoaded,
    ajv_compilations: ajvCompilationCount
  });
}

export function createIsolatedCompiledValidatorCache(cacheRoot, options = {}) {
  if (typeof cacheRoot !== "string" || cacheRoot.length === 0) fail(
    "validator_cache_root_unresolved", "an isolated cache root is required"
  );
  return createCompiledValidatorCache({ ...options, cacheRoot });
}

export async function __runGenerationWorker(request) {
  if (!request?.[POPULATION_WORKER_KEY]) fail(
    "validator_cache_generation_failed", "unrecognized generation request"
  );
  return createCompiledValidatorCache({ cacheRoot: request.cacheRoot })
    .runPopulationPass(request.mode === "verify" ? "verify" : "ensure");
}

export {
  AJV_OPTIONS,
  CACHE_FORMAT_VERSION,
  CACHE_ROOT_SUFFIX,
  CompiledValidatorCacheError
};
