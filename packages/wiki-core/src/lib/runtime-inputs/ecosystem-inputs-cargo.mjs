

import os from "node:os";
import path from "node:path";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

export const CARGO_OFFLINE_ENV = Object.freeze({ CARGO_NET_OFFLINE: "true", CARGO_TERM_COLOR: "never" });

const absoluteOrNull = (value) => typeof value === "string" && path.isAbsolute(value) ? value : null;

export function cargoHomeFromEnvironment(env) {
  return absoluteOrNull(env.CARGO_HOME) ?? path.join(absoluteOrNull(env.HOME) ?? os.homedir(), ".cargo");
}

export function cargoToolchainEnv(rustc) {
  return { RUSTC: rustc, RUSTDOC: path.join(path.dirname(rustc), "rustdoc") };
}

export function cargoConfigFiles(projectDir, cargoHome, { exists = existsSync } = {}) {
  const files = [];
  const home = ["config", "config.toml"].map((name) => path.join(cargoHome, name)).find(exists);
  for (let directory = projectDir; ; directory = path.dirname(directory)) {
    const found = ["config", "config.toml"].map((name) => path.join(directory, ".cargo", name)).find(exists);
    if (found !== undefined) files.push({ file: found, base: directory, scope: found === home ? "cargo_home"
      : directory === projectDir ? "project" : "ancestor" });
    if (path.dirname(directory) === directory) break;
  }
  if (home !== undefined && !files.some(({ file }) => file === home)) {
    files.push({ file: home, base: path.dirname(cargoHome), scope: "cargo_home" });
  }
  return files;
}

function configurationError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

function resolvedLocation(file) {
  try { return realpathSync(file); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    let entry;
    try { entry = lstatSync(file); }
    catch (cause) { if (cause.code !== "ENOENT") throw cause; }
    if (entry?.isSymbolicLink()) return resolvedLocation(path.resolve(path.dirname(file), readlinkSync(file)));
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(resolvedLocation(parent), path.basename(file));
  }
}

export function observeCargoOptionalAbsences(inputs) {
  return inputs.flatMap(({ file }) => {
    const resolved = resolvedLocation(file);
    try { statSync(file); return []; }
    catch (error) { if (error.code === "ENOENT") return [{ file, resolved }]; throw error; }
  });
}

export function cargoConfigurationInputs({ projectDir, checkoutRoot, cargoHome }) {
  const files = new Map();
  const missing = [];
  const optionalAbsent = [];
  const active = new Set();
  const seen = new Set();
  try {
    const repository = realpathSync(checkoutRoot);
    const home = resolvedLocation(path.resolve(cargoHome));

    const roots = cargoConfigFiles(projectDir, cargoHome, { exists: (file) => {
      try { statSync(file); return true; }
      catch (error) { if (error.code === "ENOENT") return false; throw error; }
    } });
    function visit(file, root, scope, declaring = null, optional = false) {
      const resolved = resolvedLocation(file);
      if (!within(root, resolved) || !within(path.resolve(scope === "cargo_home" ? cargoHome : checkoutRoot), file)) throw configurationError("scip_rust_config_unsupported",
        `Cargo configuration ${declaring ?? file} uses ${file}, outside ${root}; keep includes within the repository or their selected Cargo home`);
      let text;
      try { text = readFileSync(file, "utf8"); }
      catch (error) {
        if (error.code !== "ENOENT" || declaring === null) throw error;
        if (optional) optionalAbsent.push({ file, resolved });
        else missing.push({ config: declaring, target: file });
        return;
      }
      files.set(file, { file, resolved, scope });
      if (active.has(resolved)) throw configurationError("scip_rust_config_cycle",
        `Cargo configuration include cycle: ${declaring} includes ${file}`);
      if (seen.has(file)) return;
      active.add(resolved);
      let config;
      try { config = parseToml(text); }
      catch (cause) { throw configurationError("scip_rust_config_invalid", `Cargo configuration ${file}: ${cause.message}`, cause); }
      const includes = config.include ?? [];
      if (!Array.isArray(includes)) throw configurationError("scip_rust_config_invalid",
        `Cargo configuration ${file}: include must be an array of strings or tables`);
      for (const entry of includes) {
        const target = typeof entry === "string" ? entry : entry?.path;
        const optional = typeof entry === "string" ? false : entry?.optional ?? false;
        if (typeof target !== "string" || !target.endsWith(".toml") || typeof optional !== "boolean") {
          throw configurationError("scip_rust_config_invalid",
            `Cargo configuration ${file}: each include needs a .toml path and an optional boolean`);
        }
        visit(path.resolve(path.dirname(file), target), root, scope, file, optional);
      }
      active.delete(resolved);
      seen.add(file);
    }
    for (const { file, scope } of roots) {
      visit(file, scope === "cargo_home" ? home : repository, scope);
    }
    return { files: [...files.values()], missing,
      optional_absent: [...new Map(optionalAbsent.map((entry) => [entry.file, entry])).values()]
        .sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0), refusal: null };
  } catch (error) {
    return { files: [...files.values()], missing: [], optional_absent: [], refusal: {
      code: error.code ?? "scip_rust_config_read_failed", message: `Cargo configuration for ${projectDir}: ${error.message}`
    } };
  }
}
