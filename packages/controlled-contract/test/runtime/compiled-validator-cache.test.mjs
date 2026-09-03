import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat,
  symlink, writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  CACHE_FORMAT_VERSION,
  CompiledValidatorCacheError,
  compiledValidatorCacheRoot,
  compiledValidators,
  createIsolatedCompiledValidatorCache,
  loadCompiledValidatorCache,
  prepareCompiledValidatorCache
} from "../../lib/compiled-validator-cache.mjs";
import {
  POPULATION_MODULES,
  presentPopulationModules
} from "../../lib/validator-population.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V1,
  validateAndResolveNativeContractV1
} from "../../lib/native-contract-carrier-v1.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const prepareCommand = path.join(packageRoot, "bin", "prepare-validator-cache.mjs");
const CONTRACT_GROUP = "controlled-contract.native-contract-carrier-v1";

const OBLIGATION_GROUP = "controlled-contract.obligation-coverage-carrier.v1";
const OBLIGATION_SCHEMA_FILE = "controlled-contract-obligation-coverage.v1.schema.json";

const NO_SCHEMA_LIB_MODULE = "deterministic-lexicographic-ordering.mjs";
function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function temporaryRoot(t, label) {
  const prefix = `cc-validator-cache-${label}-`;
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.notEqual(path.resolve(root), path.resolve(os.tmpdir()));
    assert.equal(path.basename(root).startsWith(prefix), true, root);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function packageSandbox(t, label) {
  const parent = path.join(repositoryRoot, ".cache", "cc-validator-cache-sandboxes");
  await mkdir(parent, { recursive: true });
  const sandbox = await mkdtemp(path.join(parent, `${label}-`));
  t.after(async () => {
    assert.equal(path.dirname(sandbox), parent);
    assert.notEqual(path.resolve(sandbox), path.resolve(parent));
    await rm(sandbox, { recursive: true, force: true });
  });
  await Promise.all([
    "lib", "schema", "vocabulary", "profiles", "proof-intents", "bin",
    "package.json", "current.mjs"
  ].map(async (entry) => {
    const source = path.join(packageRoot, entry);
    if (!existsSync(source)) return;
    await cp(source, path.join(sandbox, entry), { recursive: true });
  }));
  return sandbox;
}

async function installedPackageFixture(t, label) {
  const root = await temporaryRoot(t, `installed-${label}`);
  const writingRepository = path.join(root, "writing-repository");
  const installationRoot = path.join(root, "package-installation");
  const nodeModules = path.join(installationRoot, "node_modules");
  const installedPackage = path.join(
    nodeModules, "@agent-chassis", "controlled-contract");
  await Promise.all([
    mkdir(writingRepository, { recursive: true }),
    mkdir(path.join(writingRepository, ".git"), { recursive: true }),
    mkdir(installedPackage, { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(writingRepository, "package.json"), "{}\n"),
    writeFile(path.join(installationRoot, "installation-sentinel.txt"), "unchanged\n"),
    writeFile(path.join(nodeModules, "sibling-sentinel.txt"), "unchanged\n")
  ]);
  const retiredCacheRoot = path.join(
    installationRoot, ".cache", "controlled-contract", "validators");
  await mkdir(retiredCacheRoot, { recursive: true });
  await writeFile(path.join(retiredCacheRoot, "retired-cache-sentinel.txt"),
    "must not be read, migrated, or rewritten\n");
  await Promise.all([
    "lib", "schema", "vocabulary", "profiles", "proof-intents", "bin",
    "package.json", "current.mjs"
  ].map(async (entry) => {
    const source = path.join(packageRoot, entry);
    if (!existsSync(source)) return;
    await cp(source, path.join(installedPackage, entry), { recursive: true });
  }));
  await symlink(path.join(repositoryRoot, "node_modules", "ajv"),
    path.join(nodeModules, "ajv"), "dir");
  return {
    root,
    writingRepository,
    installationRoot,
    nodeModules,
    installedPackage,
    prepareCommand: path.join(installedPackage, "bin", "prepare-validator-cache.mjs")
  };
}

async function treeSnapshot(root) {
  const entries = new Map();
  const walk = async (directory, relative) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const key = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const stats = await lstat(child);
      if (stats.isSymbolicLink()) {
        entries.set(key, `link:${await readlink(child)}`);
      } else if (stats.isDirectory()) {
        entries.set(`${key}/`, `directory:${stats.mode & 0o777}`);
        await walk(child, key);
      } else {
        entries.set(key, `file:${stats.mode & 0o777}:${sha256(await readFile(child))}`);
      }
    }
  };
  await walk(root, "");
  return entries;
}

async function setTreeModes(root, directoryMode, fileMode) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await setTreeModes(child, directoryMode, fileMode);
      await chmod(child, directoryMode);
    } else {
      await chmod(child, fileMode);
    }
  }
  await chmod(root, directoryMode);
}

async function runInstalledPrepare(fixture, args = [], options = {}) {
  return execFileAsync(
    process.execPath,
    [fixture.prepareCommand, "--json", ...args],
    {
      cwd: fixture.writingRepository,
      maxBuffer: 8 * 1024 * 1024,
      ...options
    }
  );
}

async function runPrepare(args, options = {}) {
  return execFileAsync(process.execPath, [prepareCommand, ...args], {
    cwd: packageRoot, maxBuffer: 8 * 1024 * 1024, ...options
  });
}

async function preparedStatus(args, options = {}) {
  return JSON.parse((await runPrepare(["--json", ...args], options)).stdout);
}

async function runSandboxPrepare(sandbox, args) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(sandbox, "bin", "prepare-validator-cache.mjs"), "--json", ...args],
    { cwd: sandbox, maxBuffer: 8 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

async function artifactSnapshot(root) {
  const entries = new Map();
  const walk = async (directory, relative) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const key = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child, key);
      else entries.set(key, sha256(await readFile(child)));
    }
  };
  await walk(root, "");
  return entries;
}

function groupStatus(status, groupId) {
  const entry = status.groups.find((group) => group.group_id === groupId);
  assert.notEqual(entry, undefined, `${groupId} is present in the status record`);
  return entry;
}

test("the production cache root belongs to the writing repository", async () => {
  const root = compiledValidatorCacheRoot();
  assert.equal(root, path.join(
    repositoryRoot, ".cache", "controlled-contract", "validators"));
});

test("an external package installation writes only beneath the writing repository",
  async (t) => {
    const fixture = await installedPackageFixture(t, "writing-repository");
    const installationBefore = await treeSnapshot(fixture.installationRoot);
    const { stdout, stderr } = await runInstalledPrepare(fixture);
    const status = JSON.parse(stdout);
    const expectedRoot = path.join(
      fixture.writingRepository, ".cache", "controlled-contract", "validators");

    assert.equal(stderr, "");
    assert.equal(status.cache_root, expectedRoot);
    assert.equal(status.directory.startsWith(`${expectedRoot}${path.sep}`), true);
    assert.equal((await stat(expectedRoot)).isDirectory(), true);
    assert.deepEqual(await treeSnapshot(fixture.installationRoot), installationBefore,
      "the package tree, node_modules parent, and siblings remain byte-for-byte untouched");
    assert.equal(fixture.installedPackage.startsWith(fixture.writingRepository), false,
      "the installed package is outside the writing repository");
  });

test("a read-only external package installation uses a writable repository cache",
  async (t) => {
    const fixture = await installedPackageFixture(t, "read-only-package");
    await setTreeModes(fixture.installedPackage, 0o555, 0o444);
    const installationBefore = await treeSnapshot(fixture.installationRoot);
    let result;
    let installationAfter;
    try {
      result = await runInstalledPrepare(fixture);
      installationAfter = await treeSnapshot(fixture.installationRoot);
    } finally {
      await setTreeModes(fixture.installedPackage, 0o755, 0o644);
    }
    const status = JSON.parse(result.stdout);
    assert.equal(result.stderr, "");
    assert.equal(status.cache_root, path.join(
      fixture.writingRepository, ".cache", "controlled-contract", "validators"));
    assert.deepEqual(installationAfter, installationBefore);
  });

test("an unwritable writing-repository cache root fails loudly", async (t) => {
  const fixture = await installedPackageFixture(t, "unwritable-repository");
  const cacheParent = path.join(
    fixture.writingRepository, ".cache", "controlled-contract");
  const environmentTemp = path.join(fixture.root, "environment-temp");
  await Promise.all([
    mkdir(cacheParent, { recursive: true }),
    mkdir(environmentTemp, { recursive: true })
  ]);
  await writeFile(path.join(environmentTemp, "unrelated.txt"), "unchanged\n");
  const installationBefore = await treeSnapshot(fixture.installationRoot);

  await chmod(cacheParent, 0o500);
  let failure;
  try {
    failure = await runInstalledPrepare(fixture, [], {
      env: {
        ...process.env,
        TMPDIR: environmentTemp,
        TMP: environmentTemp,
        TEMP: environmentTemp
      }
    }).then(() => null, (error) => error);
  } finally {
    await chmod(cacheParent, 0o700);
  }

  assert.notEqual(failure, null);
  assert.equal(failure.stdout, "");
  assert.match(failure.stderr, /validator_cache_unavailable/u);
  assert.match(failure.stderr, /EACCES/u);
  assert.deepEqual(await readdir(cacheParent), []);
  assert.deepEqual(await readdir(environmentTemp), ["unrelated.txt"]);
  assert.deepEqual(await treeSnapshot(fixture.installationRoot), installationBefore);
});

test("startup resolves every declared group without constructing Ajv", async () => {
  const status = await loadCompiledValidatorCache();

  assert.equal(["hit", "miss"].includes(status.result), true, status.result);
  assert.equal(status.ajv_module_loaded, false);
  assert.equal(status.ajv_compilations, 0);
  assert.equal(await loadCompiledValidatorCache(), status, "the cache resolves once");
  assert.equal(status.group_count > 0, true);
  assert.equal(status.groups.length, status.group_count);

  assert.equal(status.identity_digest, status.toolchain_digest);
  assert.equal(path.basename(status.directory), status.toolchain_digest);
  const digests = new Set(status.groups.map(({ schema_digest }) => schema_digest));
  assert.equal(digests.size, status.group_count, "each group has its own schema identity");

  const contract = groupStatus(status, CONTRACT_GROUP);
  const manifest = JSON.parse(await readFile(
    path.join(contract.directory, "manifest.json"), "utf8"
  ));
  assert.equal(manifest.cache_format_version, CACHE_FORMAT_VERSION);
  assert.equal(manifest.group_id, CONTRACT_GROUP);
  assert.equal(manifest.schema_digest, contract.schema_digest);
  assert.equal(manifest.toolchain_digest, status.toolchain_digest);
  assert.equal(manifest.toolchain.module_format, "commonjs");
  assert.deepEqual(manifest.toolchain.ajv_options, { strict: true, allErrors: true });
  assert.deepEqual(manifest.toolchain.custom_formats, []);
  assert.deepEqual(manifest.toolchain.custom_keywords, []);
  assert.equal(manifest.toolchain.ajv_package.name, "ajv");
  assert.equal(typeof manifest.toolchain.ajv_package.version, "string");
});

test("cache identity carries the toolchain and nothing that cannot change a byte",
  async () => {
    const status = await loadCompiledValidatorCache();
    const manifest = JSON.parse(await readFile(
      path.join(groupStatus(status, CONTRACT_GROUP).directory, "manifest.json"), "utf8"
    ));
    assert.deepEqual(Object.keys(manifest.toolchain).sort(), [
      "ajv_code_options", "ajv_options", "ajv_package", "ajv_runtime",
      "cache_format_version", "custom_formats", "custom_keywords", "module_format"
    ]);

    assert.equal("source_population" in manifest.toolchain, false);
    assert.equal("package" in manifest.toolchain, false);
    assert.equal(manifest.toolchain.ajv_runtime.length > 0, true);
    for (const entry of manifest.toolchain.ajv_runtime) {
      assert.equal(entry.module.startsWith("ajv/dist/runtime/"), true, entry.module);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
    }
  });

test("the declared population covers every module this installation carries", () => {
  assert.deepEqual(new Set(POPULATION_MODULES).size, POPULATION_MODULES.length);
  assert.deepEqual(presentPopulationModules(), POPULATION_MODULES,
    "the source checkout carries the complete declared population");
});

test("every declared population module is shipped by the package", async () => {

  const { files } = JSON.parse(await readFile(
    path.join(packageRoot, "package.json"), "utf8"
  ));
  const shipped = new Set(files);
  const declared = POPULATION_MODULES.map((specifier) =>
    `lib/${specifier.replace(/^\.\//u, "")}`);
  assert.deepEqual(declared.filter((entry) => !shipped.has(entry)), [],
    "every declared population module is listed in package.json files");
});

test("an exact hit resolves no Ajv compiler in the loading process", async (t) => {
  const cacheRoot = await temporaryRoot(t, "hit-proof");
  await runPrepare(["--json", "--cache-root", cacheRoot]);
  const cacheModuleUrl = pathToFileURL(path.join(
    packageRoot, "lib", "compiled-validator-cache.mjs")).href;
  const schemaPath = path.join(
    packageRoot, "schema", "controlled-acceptance-contract.v1.schema.json");
  const probe = `
    import { readFile } from "node:fs/promises";
    import { createRequire } from "node:module";
    import path from "node:path";
    import { createIsolatedCompiledValidatorCache } from ${JSON.stringify(cacheModuleUrl)};
    const schema = JSON.parse(await readFile(${JSON.stringify(schemaPath)}, "utf8"));
    const cache = createIsolatedCompiledValidatorCache(${JSON.stringify(cacheRoot)}, {
      allowGeneration: false
    });
    const { validateSchema } = await cache.compiledValidators(
      ${JSON.stringify(CONTRACT_GROUP)}, { validators: { validateSchema: schema } });
    const segment = path.sep + "ajv" + path.sep;
    const resolved = Object.keys(createRequire(import.meta.url).cache)
      .filter((entry) => entry.includes(segment))
      .map((entry) => entry.slice(entry.lastIndexOf(segment) + segment.length))
      .sort();
    process.stdout.write(JSON.stringify({
      valid: validateSchema({}),
      result: cache.status().result,
      group_count: cache.status().group_count,
      resolved
    }));
  `;
  const { stdout, stderr } = await execFileAsync(
    process.execPath, ["--input-type=module", "--eval", probe], { cwd: packageRoot });
  const observed = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(observed.valid, false);
  assert.equal(observed.result, "hit");
  assert.equal(observed.group_count, 1,
    "binding one group resolves that group alone");

  assert.equal(observed.resolved.includes(path.join("dist", "2020.js")), false,
    `the hit process resolved the Ajv compiler: ${observed.resolved.join(", ")}`);
  assert.equal(observed.resolved.length > 0, true,
    "the executed artifact resolves Ajv runtime helpers");
});

test("cached validators keep the complete Ajv diagnostic surface", async () => {
  const { validateSchema } = await compiledValidators(CONTRACT_GROUP, {
    validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
  });
  assert.equal(validateSchema({}), false);
  const [first] = validateSchema.errors;
  for (const field of ["instancePath", "schemaPath", "keyword", "params", "message"]) {
    assert.equal(field in first, true, field);
  }
  assert.equal(first.keyword, "required");
  assert.equal(typeof first.params.missingProperty, "string");

  assert.equal(validateSchema.errors.length > 1, true);
  assert.equal(validateSchema({
    schema_version: "controlled-acceptance-contract.v1"
  }), false);
  const result = validateAndResolveNativeContractV1({});
  assert.equal(result.valid, false);
  assert.equal(result.schema_valid, false);
  assert.equal(result.schema_errors.length > 1, true);
  for (const error of result.schema_errors) {
    assert.equal(error.code, "stable_contract_schema_invalid");
    assert.equal(typeof error.keyword, "string");
    assert.equal(typeof error.message, "string");
  }
});

test("a repeated declaration returns the identical validator instances", async () => {
  const first = await compiledValidators(CONTRACT_GROUP, {
    validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
  });
  const second = await compiledValidators(CONTRACT_GROUP, {
    validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
  });
  assert.equal(first.validateSchema, second.validateSchema);
  assert.equal(Object.isFrozen(first), true);
});

test("an undeclared group and a drifted schema are typed refusals, not compilations",
  async () => {
    await assert.rejects(
      compiledValidators("controlled-contract.not-a-declared-group", {
        validators: { validateSchema: { type: "object" } }
      }),
      (error) => error instanceof CompiledValidatorCacheError &&
        error.code === "validator_cache_group_undeclared"
    );
    await assert.rejects(
      compiledValidators(CONTRACT_GROUP, {
        validators: { validateSchema: { type: "object" } }
      }),
      (error) => error instanceof CompiledValidatorCacheError &&
        error.code === "validator_cache_group_schema_mismatch"
    );
    await assert.rejects(
      compiledValidators(CONTRACT_GROUP, {
        validators: {
          validateSchema: NATIVE_CONTRACT_SCHEMA_V1,
          validateExtra: NATIVE_CONTRACT_SCHEMA_V1
        }
      }),
      (error) => error instanceof CompiledValidatorCacheError &&
        error.code === "validator_cache_group_schema_mismatch"
    );
  });

test("prepare generates once and then reports an exact hit with zero Ajv compilation",
  async (t) => {
    const cacheRoot = await temporaryRoot(t, "prepare");
    const first = await preparedStatus(["--cache-root", cacheRoot]);
    assert.equal(first.result, "miss");
    assert.equal(first.published, true);
    assert.equal(first.ajv_module_loaded, false, "the loading process never loads Ajv");
    assert.equal(first.ajv_compilations, 0);
    assert.equal(first.generation.ajv_compilations > 0, true);
    assert.equal(first.generation.groups_compiled, first.group_count);
    assert.equal(first.generation.groups_reused, 0);
    assert.equal(first.group_count > 0, true);

    const second = await preparedStatus(["--verify", "--cache-root", cacheRoot]);
    assert.equal(second.result, "hit");
    assert.equal(second.mode, "verify");
    assert.equal(second.toolchain_digest, first.toolchain_digest);
    assert.equal(second.directory, first.directory);
    assert.equal(second.group_count, first.group_count);
    assert.equal(second.generation, null, "a full hit runs no generation");
    assert.equal(second.ajv_module_loaded, false);
    assert.equal(second.ajv_compilations, 0);
    assert.deepEqual(
      second.groups.map(({ group_id, schema_digest }) => [group_id, schema_digest]),
      first.groups.map(({ group_id, schema_digest }) => [group_id, schema_digest])
    );
  });

test("verify refuses to generate when no artifact is published", async (t) => {
  const cacheRoot = await temporaryRoot(t, "verify-empty");
  await assert.rejects(
    runPrepare(["--json", "--verify", "--cache-root", cacheRoot]),
    (error) => /validator_cache_unavailable/u.test(error.stderr)
  );
  assert.deepEqual(await readdir(cacheRoot), []);
});

test("editing a lib/ module that declares no schemas is a full hit that regenerates nothing",
  async (t) => {
    const sandbox = await packageSandbox(t, "lib-edit");
    const cacheRoot = await temporaryRoot(t, "lib-edit");
    const warm = await runSandboxPrepare(sandbox, ["--cache-root", cacheRoot]);
    assert.equal(warm.result, "miss");
    assert.equal(warm.generation.groups_compiled, warm.group_count);
    const before = await artifactSnapshot(cacheRoot);

    const target = path.join(sandbox, "lib", NO_SCHEMA_LIB_MODULE);
    const original = await readFile(target, "utf8");
    assert.equal(/compiledValidators/u.test(original), false,
      `${NO_SCHEMA_LIB_MODULE} must declare no compilation group for this test to discriminate`);
    await writeFile(target, `${original}\n// an edit that declares no schema\n`);

    const verified = await runSandboxPrepare(sandbox, ["--verify", "--cache-root", cacheRoot]);
    assert.equal(verified.result, "hit");
    assert.equal(verified.generation, null, "nothing regenerated");
    assert.equal(verified.ajv_module_loaded, false, "Ajv was never loaded");
    assert.equal(verified.ajv_compilations, 0);
    assert.equal(verified.toolchain_digest, warm.toolchain_digest);
    assert.deepEqual(
      verified.groups.map(({ group_id, schema_digest, directory, result }) =>
        [group_id, schema_digest, directory, result]),
      warm.groups.map(({ group_id, schema_digest, directory }) =>
        [group_id, schema_digest, directory, "hit"])
    );

    const ensured = await runSandboxPrepare(sandbox, ["--cache-root", cacheRoot]);
    assert.equal(ensured.result, "hit");
    assert.equal(ensured.generation, null);
    assert.deepEqual([...await artifactSnapshot(cacheRoot)].sort(), [...before].sort(),
      "not one published byte changed");
  });

test("changing one group's schema recompiles that group and reuses every other",
  async (t) => {
    const sandbox = await packageSandbox(t, "schema-edit");
    const cacheRoot = await temporaryRoot(t, "schema-edit");
    const warm = await runSandboxPrepare(sandbox, ["--cache-root", cacheRoot]);
    assert.equal(warm.generation.groups_compiled, warm.group_count);
    const before = await artifactSnapshot(cacheRoot);

    const schemaPath = path.join(sandbox, "schema", OBLIGATION_SCHEMA_FILE);
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    schema.description = `${schema.description ?? ""} perturbed by the cache test`.trim();
    await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

    const second = await runSandboxPrepare(sandbox, ["--cache-root", cacheRoot]);
    assert.equal(second.result, "miss");
    assert.equal(second.group_count, warm.group_count);
    assert.equal(second.generation.groups_compiled, 1, "exactly one group recompiled");
    assert.equal(second.generation.groups_reused, warm.group_count - 1);
    assert.equal(second.toolchain_digest, warm.toolchain_digest,
      "a schema edit does not move the toolchain identity");

    const changed = groupStatus(second, OBLIGATION_GROUP);
    assert.equal(changed.result, "miss");
    assert.equal(changed.published, true);
    assert.notEqual(changed.schema_digest, groupStatus(warm, OBLIGATION_GROUP).schema_digest);
    for (const group of second.groups) {
      if (group.group_id === OBLIGATION_GROUP) continue;
      const original = groupStatus(warm, group.group_id);
      assert.equal(group.result, "hit", group.group_id);
      assert.equal(group.schema_digest, original.schema_digest, group.group_id);
      assert.equal(group.directory, original.directory, group.group_id);
    }

    const after = await artifactSnapshot(cacheRoot);
    for (const [relative, digest] of before) {
      assert.equal(after.get(relative), digest, `${relative} was rewritten`);
    }
    const addedDirectories = new Set([...after.keys()]
      .filter((relative) => !before.has(relative))
      .map((relative) => relative.split("/")[1]));
    assert.deepEqual([...addedDirectories], [path.basename(changed.directory)]);
  });

test("an invalid group artifact is never executed and is replaced atomically",
  async (t) => {
    const cacheRoot = await temporaryRoot(t, "invalid");
    const aside = await temporaryRoot(t, "invalid-aside");
    const warm = await preparedStatus(["--cache-root", cacheRoot]);
    const directory = groupStatus(warm, CONTRACT_GROUP).directory;
    const manifestPath = path.join(directory, "manifest.json");
    const pristineManifest = await readFile(manifestPath, "utf8");
    const codePath = path.join(directory, JSON.parse(pristineManifest).file);
    const pristineCode = await readFile(codePath, "utf8");

    const restore = async () => {
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      await writeFile(codePath, pristineCode);
      await writeFile(manifestPath, pristineManifest);
    };

    const forms = [
      {
        label: "a missing code file",
        code: "validator_cache_unavailable",
        selfHeals: true,
        corrupt: () => rm(codePath)
      },
      {
        label: "an unparsable manifest",
        code: "validator_cache_unavailable",
        selfHeals: true,
        corrupt: () => writeFile(manifestPath, "{ not json")
      },
      {
        label: "a foreign cache format version",
        code: "validator_cache_unavailable",
        selfHeals: true,
        corrupt: () => writeFile(manifestPath, JSON.stringify({
          ...JSON.parse(pristineManifest),
          cache_format_version: "controlled-contract-compiled-validator-cache.v0"
        }))
      },
      {
        label: "a truncated code file",
        code: "validator_cache_code_digest_mismatch",
        selfHeals: true,
        corrupt: () => writeFile(codePath, pristineCode.slice(0, pristineCode.length >> 1))
      },
      {
        label: "code appended after publication",
        code: "validator_cache_code_digest_mismatch",
        selfHeals: true,
        corrupt: () => writeFile(codePath,
          `${pristineCode}\nglobalThis.__cc_poisoned = true;\n`)
      },
      {
        label: "a manifest naming an unusable artifact file",
        code: "validator_cache_manifest_malformed",
        selfHeals: true,
        corrupt: () => writeFile(manifestPath, JSON.stringify({
          ...JSON.parse(pristineManifest), file: "../escape.cjs"
        }))
      },
      {

        label: "a symlinked group directory",
        code: "validator_cache_containment_violation",
        selfHeals: false,
        corrupt: async () => {
          const relocated = path.join(aside, path.basename(directory));
          await cp(directory, relocated, { recursive: true });
          await rm(directory, { recursive: true, force: true });
          await symlink(relocated, directory, "dir");
        }
      }
    ];

    for (const form of forms) {
      await restore();
      await form.corrupt();

      const cache = createIsolatedCompiledValidatorCache(cacheRoot,
        { allowGeneration: false });
      await assert.rejects(
        cache.compiledValidators(CONTRACT_GROUP, {
          validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
        }),
        (error) => error instanceof CompiledValidatorCacheError &&
          error.code === form.code,
        `${form.label} must refuse with ${form.code}`
      );
      assert.equal("__cc_poisoned" in globalThis, false,
        `${form.label} must never be executed`);

      if (!form.selfHeals) {
        await assert.rejects(runPrepare(["--json", "--cache-root", cacheRoot]),
          (error) => new RegExp(form.code, "u").test(error.stderr),
          `${form.label} must stay a loud refusal`);
        continue;
      }

      const repaired = await preparedStatus(["--cache-root", cacheRoot]);
      assert.equal(repaired.result, "miss", form.label);
      assert.equal(repaired.generation.groups_compiled, 1,
        `${form.label} must replace exactly the invalid group`);
      const group = groupStatus(repaired, CONTRACT_GROUP);
      assert.equal(group.published, true, form.label);
      assert.equal(group.schema_digest, groupStatus(warm, CONTRACT_GROUP).schema_digest);
      assert.deepEqual(
        (await readdir(cacheRoot)).filter((name) => name.startsWith(".")), [],
        `${form.label} left staging behind`);

      const verified = await preparedStatus(["--verify", "--cache-root", cacheRoot]);
      assert.equal(verified.result, "hit", form.label);
    }
  });

test("containment resolves the cache root rather than comparing path text", async (t) => {

  const real = await temporaryRoot(t, "contained-real");
  const linked = path.join(await temporaryRoot(t, "contained-link"), "root");
  await symlink(real, linked, "dir");
  await runPrepare(["--json", "--cache-root", real]);

  const cache = createIsolatedCompiledValidatorCache(linked, { allowGeneration: false });
  const { validateSchema } = await cache.compiledValidators(CONTRACT_GROUP, {
    validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
  });
  assert.equal(validateSchema({}), false);
  assert.equal((await cache.load()).result, "hit");
});

test("concurrent fresh-process misses converge on one winner per group", async (t) => {
  const cacheRoot = await temporaryRoot(t, "concurrent");
  const statuses = await Promise.all([0, 1, 2].map(() =>
    preparedStatus(["--cache-root", cacheRoot])));
  for (const status of statuses) {
    assert.equal(status.toolchain_digest, statuses[0].toolchain_digest);
    assert.equal(status.group_count, statuses[0].group_count);
    assert.equal(status.directory, statuses[0].directory);
    assert.equal(status.ajv_compilations, 0, "the loading process compiled nothing");
  }

  assert.equal(statuses.some((status) => status.result === "miss"), true);
  assert.equal(statuses.some((status) => status.generation?.ajv_compilations > 0), true);

  for (const { group_id } of statuses[0].groups) {
    const outcomes = statuses.map((status) => groupStatus(status, group_id));
    assert.equal(outcomes.filter(({ published }) => published).length, 1,
      `exactly one writer publishes ${group_id}`);
    for (const outcome of outcomes.filter(({ published }) => !published)) {
      assert.equal(outcome.contended || outcome.result === "hit", true,
        `a loser of ${group_id} either reused or contended`);
    }
    assert.equal(new Set(outcomes.map(({ directory }) => directory)).size, 1);
  }

  assert.deepEqual((await readdir(cacheRoot)).filter((name) => name.startsWith(".")), []);
  const toolchainRoot = statuses[0].directory;
  assert.deepEqual(
    (await readdir(toolchainRoot)).filter((name) => name.startsWith(".")), []);
  assert.equal((await readdir(toolchainRoot)).length, statuses[0].group_count);
  for (const { group_id, directory, schema_digest } of statuses[0].groups) {
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    assert.equal(manifest.group_id, group_id);
    assert.equal(manifest.schema_digest, schema_digest);
    const code = await readFile(path.join(directory, manifest.file));
    assert.equal(sha256(code), manifest.code_sha256, group_id);
    assert.equal(code.length, manifest.code_bytes, group_id);
  }

  const cache = createIsolatedCompiledValidatorCache(cacheRoot);
  const { validateSchema } = await cache.compiledValidators(CONTRACT_GROUP, {
    validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
  });
  const reference = await compiledValidators(CONTRACT_GROUP, {
    validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
  });
  for (const candidate of [{}, { schema_version: "controlled-acceptance-contract.v1" }]) {
    assert.equal(validateSchema(candidate), reference.validateSchema(candidate));
    assert.deepEqual(validateSchema.errors, reference.validateSchema.errors);
  }
});

test("an unwritable cache root fails loudly and stages nothing elsewhere", async (t) => {
  const home = await temporaryRoot(t, "readonly");
  const cacheRoot = path.join(home, "locked", "validators");
  await mkdir(path.dirname(cacheRoot), { recursive: true });

  const environmentTemp = path.join(home, "environment-temp");
  await mkdir(environmentTemp, { recursive: true });
  const sibling = path.join(environmentTemp, "unrelated.txt");
  await writeFile(sibling, "unrelated");

  await chmod(path.dirname(cacheRoot), 0o500);
  const failure = await runPrepare(["--json", "--cache-root", cacheRoot], {
    env: {
      ...process.env,
      TMPDIR: environmentTemp,
      TMP: environmentTemp,
      TEMP: environmentTemp
    }
  }).then(() => null, (error) => error);
  await chmod(path.dirname(cacheRoot), 0o700);

  assert.notEqual(failure, null, "an unpublishable artifact is never a success");
  assert.match(failure.stderr, /validator_cache_unavailable/u);

  assert.match(failure.stderr, /EACCES/u);
  assert.equal(failure.stdout, "", "no status record is emitted");

  assert.deepEqual(await readdir(environmentTemp), ["unrelated.txt"]);
  assert.equal(await readFile(sibling, "utf8"), "unrelated");
  assert.deepEqual(await readdir(path.dirname(cacheRoot)), [],
    "nothing was written into the unwritable root");

  assert.deepEqual(
    (await readdir(environmentTemp)).filter((name) =>
      name.startsWith("controlled-contract-validators-")),
    [], "no artifact is staged beneath the run's temporary root"
  );
});

test("temporary-root cleanup removes only the directory it created", async (t) => {

  const sibling = path.join(os.tmpdir(), `cc-validator-cache-sibling-${process.pid}.txt`);
  await writeFile(sibling, "unrelated");
  t.after(() => rm(sibling, { force: true }));

  const root = await mkdtemp(path.join(os.tmpdir(), "cc-validator-cache-cleanup-"));
  await writeFile(path.join(root, "inside.txt"), "inside");
  assert.equal(path.dirname(root), os.tmpdir());
  assert.notEqual(path.resolve(root), path.resolve(os.tmpdir()));
  await rm(root, { recursive: true });

  assert.equal(await stat(root).then(() => "present", () => "removed"), "removed");
  assert.equal(await readFile(sibling, "utf8"), "unrelated",
    "an unrelated sibling beneath the temporary root survives cleanup");
  assert.equal(await stat(os.tmpdir()).then((entry) => entry.isDirectory()), true,
    "the temporary root itself survives cleanup");
});

test("prepare rejects an unrecognized argument", async () => {
  await assert.rejects(runPrepare(["--wat"]),
    (error) => /unrecognized argument/u.test(error.stderr));
});

test("the isolated factory requires an explicit root", () => {
  assert.throws(() => createIsolatedCompiledValidatorCache(""),
    (error) => error instanceof CompiledValidatorCacheError &&
      error.code === "validator_cache_root_unresolved");
});

test("prepare rejects an unsupported mode", async () => {
  await assert.rejects(prepareCompiledValidatorCache({ mode: "rebuild" }),
    (error) => error instanceof CompiledValidatorCacheError &&
      error.code === "validator_cache_declaration_invalid");
});
