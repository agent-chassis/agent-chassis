import { readFile, lstat, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { parseArgs } from "../lib/cli.mjs";

const HELP_TEXT = `agent-launch install-drift-check [--target-dir <path>] [--json]

Read-only drift reporter. Compares the @agent-chassis/agent-launch-cli package
\`bin\` map against an operator PATH directory and reports any installed
command that does not resolve to its package-owned source via symlink or
matching content.

Options:
  --target-dir <path>   Operator PATH directory to inspect.
                        Default: \${XDG_DATA_HOME:-\$HOME/.local}/bin
  --json                Emit machine-readable JSON

Drift kinds reported (exit code 1 on any of these):
  missing                       Declared in package \`bin\` but absent from
                                target dir
  dangling-symlink              Target is a symlink whose resolved path does
                                not exist
  stale-symlink                 Target is a symlink but resolves outside this
                                package's canonical bin file for that name
  hand-copied                   Target is a regular file whose bytes do not
                                match the package wrapper byte-for-byte
  non-executable-package-bin    Declared package bin file under \`./bin/\` is
                                missing the user-executable mode bit (the
                                Node entrypoint \`agent-launch\` itself is
                                exempt; npm's bin shim handles its +x)
  non-executable-target         Installed target does not have user-execute
                                permission (either a non-executable regular
                                file, or a symlink whose resolved file is not
                                executable)

The command does not mutate operator state. Files in the target directory
that are not declared in the package \`bin\` map are ignored (orphan source-
bin disposition is tracked separately).

Remediation: re-install with \`npm link @agent-chassis/agent-launch-cli\` from a
consuming repo, or replace the drifted file with a symlink into
\`packages/agent-launch-cli/bin/<name>\` (or \`./src/index.mjs\` for the
\`agent-launch\` entrypoint).
`;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(MODULE_DIR, "..", "..");
const PACKAGE_JSON_PATH = join(PACKAGE_DIR, "package.json");

export async function runInstallDriftCheck(argv = [], seam = {}) {
  if (argv.some((token) => token === "--help" || token === "-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const { options } = parseArgs(argv);
  const targetDir = resolveTargetDir(options["target-dir"]);

  const packageDir =
    typeof seam.packageDir === "string" && seam.packageDir.length > 0
      ? resolve(seam.packageDir)
      : PACKAGE_DIR;
  const packageJsonPath =
    packageDir === PACKAGE_DIR ? PACKAGE_JSON_PATH : join(packageDir, "package.json");

  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    const output = {
      ok: false,
      target_dir: targetDir,
      package_dir: packageDir,
      error: {
        code: "package_json_unreadable",
        path: packageJsonPath,
        message: error.message
      },
      entries: [],
      drift_count: 0
    };
    emit(output, booleanFlag(options, "json"));
    process.exitCode = 1;
    return;
  }

  const binMap = packageJson.bin ?? {};
  const entries = [];

  for (const name of Object.keys(binMap).sort()) {
    const packageBinPath = resolve(packageDir, binMap[name]);
    const targetPath = join(targetDir, name);

    const requiresExecutableBit = isUnderBinDir(packageBinPath, packageDir);
    entries.push(
      await inspectEntry({
        name,
        packageBinPath,
        targetPath,
        requiresExecutableBit
      })
    );
  }

  const drifts = entries.filter((entry) => entry.drift_kind !== null);

  const output = {
    ok: drifts.length === 0,
    target_dir: targetDir,
    package_dir: packageDir,
    entries,
    drift_count: drifts.length
  };

  emit(output, booleanFlag(options, "json"));

  if (drifts.length > 0) {
    process.exitCode = 1;
  }
}

function resolveTargetDir(override) {
  if (typeof override === "string" && override.length > 0) {
    return resolve(override);
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local");
  return join(base, "bin");
}

async function inspectEntry({ name, packageBinPath, targetPath, requiresExecutableBit }) {

  if (requiresExecutableBit) {
    const packageBinExec = await readExecutableMode(packageBinPath);
    if (packageBinExec.exists && !packageBinExec.executable) {
      return makeEntry({
        name,
        packageBinPath,
        targetPath,
        driftKind: "non-executable-package-bin",
        detail: {
          mode: packageBinExec.mode,
          message:
            "declared package bin file is missing the user-executable mode " +
            "bit; operator symlinks into PATH will fail with Permission denied"
        }
      });
    }
  }

  let targetStat;
  try {
    targetStat = await lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return makeEntry({
        name,
        packageBinPath,
        targetPath,
        driftKind: "missing",
        detail: { message: "declared in package bin map but absent from target directory" }
      });
    }
    return makeEntry({
      name,
      packageBinPath,
      targetPath,
      driftKind: "unreadable",
      detail: { code: error.code ?? "unknown", message: error.message }
    });
  }

  if (targetStat.isSymbolicLink()) {
    return inspectSymlink({ name, packageBinPath, targetPath, requiresExecutableBit });
  }

  if (targetStat.isFile()) {
    return inspectRegularFile({
      name,
      packageBinPath,
      targetPath,
      targetMode: targetStat.mode,
      requiresExecutableBit
    });
  }

  return makeEntry({
    name,
    packageBinPath,
    targetPath,
    driftKind: "hand-copied",
    detail: {
      message: "target path exists but is neither a symlink nor a regular file"
    }
  });
}

async function inspectSymlink({ name, packageBinPath, targetPath, requiresExecutableBit }) {
  const linkTarget = await readlink(targetPath);
  const resolvedLinkTarget = isAbsolute(linkTarget)
    ? linkTarget
    : resolve(dirname(targetPath), linkTarget);

  let realTarget;
  try {
    realTarget = await realpath(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return makeEntry({
        name,
        packageBinPath,
        targetPath,
        driftKind: "dangling-symlink",
        detail: {
          link_target: linkTarget,
          resolved_link_target: resolvedLinkTarget,
          message: "symlink resolves to a path that does not exist"
        }
      });
    }
    return makeEntry({
      name,
      packageBinPath,
      targetPath,
      driftKind: "dangling-symlink",
      detail: {
        link_target: linkTarget,
        resolved_link_target: resolvedLinkTarget,
        code: error.code ?? "unknown",
        message: error.message
      }
    });
  }

  let realPackage;
  try {
    realPackage = await realpath(packageBinPath);
  } catch (error) {
    return makeEntry({
      name,
      packageBinPath,
      targetPath,
      driftKind: "package_bin_missing",
      detail: {
        link_target: linkTarget,
        resolved_link_target: resolvedLinkTarget,
        real_target: realTarget,
        code: error.code ?? "unknown",
        message: `package bin source is missing or unreadable: ${error.message}`
      }
    });
  }

  if (realTarget !== realPackage) {
    return makeEntry({
      name,
      packageBinPath,
      targetPath,
      driftKind: "stale-symlink",
      detail: {
        link_target: linkTarget,
        resolved_link_target: resolvedLinkTarget,
        real_target: realTarget,
        expected_real_target: realPackage,
        message:
          "symlink does not resolve to the package wrapper for this name " +
          "(operator may have linked to an old checkout or a sibling file)"
      }
    });
  }

  if (requiresExecutableBit) {
    const realExec = await readExecutableMode(realTarget);
    if (realExec.exists && !realExec.executable) {
      return makeEntry({
        name,
        packageBinPath,
        targetPath,
        driftKind: "non-executable-target",
        detail: {
          link_target: linkTarget,
          resolved_link_target: resolvedLinkTarget,
          real_target: realTarget,
          mode: realExec.mode,
          message:
            "symlink resolves to the package wrapper but the resolved file " +
            "is not executable; operator invocation will fail with " +
            "Permission denied"
        }
      });
    }
  }

  return makeEntry({
    name,
    packageBinPath,
    targetPath,
    driftKind: null,
    detail: {
      link_target: linkTarget,
      resolved_link_target: resolvedLinkTarget,
      real_target: realTarget,
      message: "symlink resolves to the package wrapper"
    }
  });
}

async function inspectRegularFile({ name, packageBinPath, targetPath, targetMode, requiresExecutableBit }) {
  let packageBytes;
  try {
    packageBytes = await readFile(packageBinPath);
  } catch (error) {
    return makeEntry({
      name,
      packageBinPath,
      targetPath,
      driftKind: "package_bin_missing",
      detail: {
        code: error.code ?? "unknown",
        message: `package bin source is missing or unreadable: ${error.message}`
      }
    });
  }

  let targetBytes;
  try {
    targetBytes = await readFile(targetPath);
  } catch (error) {
    return makeEntry({
      name,
      packageBinPath,
      targetPath,
      driftKind: "unreadable",
      detail: {
        code: error.code ?? "unknown",
        message: `target file is unreadable: ${error.message}`
      }
    });
  }

  if (Buffer.compare(packageBytes, targetBytes) === 0) {
    if (requiresExecutableBit && !modeIsExecutable(targetMode)) {
      return makeEntry({
        name,
        packageBinPath,
        targetPath,
        driftKind: "non-executable-target",
        detail: {
          mode: targetMode,
          message:
            "regular file matches the package wrapper byte-for-byte but is " +
            "not executable; operator invocation will fail with Permission " +
            "denied"
        }
      });
    }
    return makeEntry({
      name,
      packageBinPath,
      targetPath,
      driftKind: null,
      detail: {
        message:
          "regular file (not a symlink); bytes match the package wrapper. " +
          "Re-linking via `npm link` is still preferred."
      }
    });
  }

  return makeEntry({
    name,
    packageBinPath,
    targetPath,
    driftKind: "hand-copied",
    detail: {
      package_bin_bytes: packageBytes.length,
      target_bytes: targetBytes.length,
      message:
        "regular file does not match the package wrapper byte-for-byte; " +
        "operator is running a hand-copied or stale shim"
    }
  });
}

function modeIsExecutable(mode) {
  if (typeof mode !== "number") return false;

  return (mode & 0o100) !== 0;
}

function isUnderBinDir(absolutePath, packageDir = PACKAGE_DIR) {
  const binDir = join(packageDir, "bin");
  const rel = relative(binDir, absolutePath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function readExecutableMode(path) {
  try {
    const s = await stat(path);
    return { exists: true, executable: modeIsExecutable(s.mode), mode: s.mode };
  } catch (error) {
    return {
      exists: false,
      executable: false,
      mode: null,
      code: error.code ?? "unknown",
      message: error.message
    };
  }
}

function makeEntry({ name, packageBinPath, targetPath, driftKind, detail }) {
  return {
    name,
    package_bin_path: packageBinPath,
    target_path: targetPath,
    drift_kind: driftKind,
    detail
  };
}

function booleanFlag(options, key) {
  const value = options[key];
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

function emit(output, asJson) {
  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  writeHuman(output);
}

function writeHuman(output) {
  console.log(`install-drift-check`);
  console.log(`  target dir : ${output.target_dir}`);
  console.log(`  package    : ${output.package_dir}`);
  if (output.error) {
    console.log(`  error      : ${output.error.code}: ${output.error.message}`);
    return;
  }
  console.log(`  entries    : ${output.entries.length}`);
  console.log(`  drift      : ${output.drift_count}`);
  console.log("");

  const drifts = output.entries.filter((entry) => entry.drift_kind !== null);
  const clean = output.entries.filter((entry) => entry.drift_kind === null);

  if (drifts.length > 0) {
    console.log("Drifted entries:");
    for (const entry of drifts) {
      console.log(`  - ${entry.name} [${entry.drift_kind}]`);
      console.log(`      target : ${entry.target_path}`);
      console.log(`      expects: ${entry.package_bin_path}`);
      if (entry.detail?.message) {
        console.log(`      note   : ${entry.detail.message}`);
      }
      if (entry.detail?.link_target) {
        console.log(`      link   : ${entry.detail.link_target}`);
      }
      if (entry.detail?.real_target) {
        console.log(`      real   : ${entry.detail.real_target}`);
      }
    }
    console.log("");
    console.log(
      "Remediation: from a consuming repo run " +
        "`npm link @agent-chassis/agent-launch-cli`, or replace the drifted file " +
        "with a symlink into `packages/agent-launch-cli/bin/<name>`."
    );
    return;
  }

  console.log("OK: every declared bin resolves to its package wrapper.");
  if (clean.length > 0) {
    for (const entry of clean) {
      console.log(`  - ${entry.name}`);
    }
  }
}
