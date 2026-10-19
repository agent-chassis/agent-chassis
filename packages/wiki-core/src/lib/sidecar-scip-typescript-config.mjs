

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export function resolveTypescriptConfig(ts, root, config) {
  return ts.resolveProjectReferencePath({ path: path.resolve(root, config) });
}

export function readTypescriptConfig(ts, file, host = ts.sys) {
  return ts.getParsedCommandLineOfConfigFile(file, {}, {
    ...host, onUnRecoverableConfigFileDiagnostic: host.onUnRecoverableConfigFileDiagnostic ??
      ((diagnostic) => { throw new Error(ts.formatDiagnostics([diagnostic], ts.createCompilerHost({}))); })
  });
}

export function observeTypescriptConfiguration(ts, file, host = ts.sys) {
  const absent = new Set();
  const diagnostics = [];
  const parsed = readTypescriptConfig(ts, file, { ...host,
    readFile: input => {
      const text = (host.readFile === ts.sys.readFile ? readTypescriptConfigInput(ts, input) : host.readFile(input));
      if (text === undefined) absent.add(path.resolve(input));
      return text;
    }, onUnRecoverableConfigFileDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  diagnostics.push(...(parsed?.errors ?? []));
  const errors = diagnostics.filter(({ code }) => code !== 18002 && code !== 18003);
  const missing = errors.filter(diagnostic => diagnostic.code === 6053 ||
    (diagnostic.code === 5083 && absent.size > 0));
  const invalid = errors.filter(diagnostic => !missing.includes(diagnostic));
  const state = invalid.length > 0 ? "configuration_error" : missing.length > 0 ? "configuration_unavailable"
    : !parsed ? "configuration_error" : parsed.fileNames.length === 0 ? "empty_project" : "ready";
  const describe = values => values.map(diagnostic => ({ code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") }));
  return { parsed, state, diagnostics: describe(errors), missing: describe(missing), invalid: describe(invalid) };
}

export function readTypescriptConfigInput(ts, file) {
  const text = ts.sys.readFile(file);
  if (text !== undefined) return text;

  try { readFileSync(file); }
  catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return undefined;
  }
  throw new Error(`TypeScript could not read configuration input ${file}, although the filesystem read succeeded`);
}

export function isEmptyTypescriptFiles(ts, files) {
  for (const file of files) {
    const text = readTypescriptConfigInput(ts, file);
    if (text === undefined) return false;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length > 0) return false;
    let identifier = false;
    const visit = (node) => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) identifier = true;
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (identifier) return false;
  }
  return true;
}

export function isEmptyTypescriptProject({ indexerPath, checkoutRoot, configPath }) {
  const ts = createRequire(indexerPath)("typescript");
  const seen = new Set();
  function empty(config) {
    if (seen.has(config)) return true;
    seen.add(config);
    const { parsed, state } = observeTypescriptConfiguration(ts, config);
    if (!parsed || !["ready", "empty_project"].includes(state)) return false;
    if (!isEmptyTypescriptFiles(ts, parsed.fileNames)) return false;
    return (parsed.projectReferences ?? []).every((reference) => empty(ts.resolveProjectReferencePath(reference)));
  }
  return empty(path.join(checkoutRoot, configPath));
}

export function typescriptConfigPopulation({ repoRoot, configPath, trackedPaths, indexerPath }) {
  if (!indexerPath) return { state: "indexer_unavailable", population: [], missing: [] };
  const require = createRequire(indexerPath);
  let compiler;
  try { compiler = require.resolve("typescript"); }
  catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    return { state: "compiler_unavailable", message: error.message, population: [], missing: [] };
  }
  const ts = require(compiler);
  const root = path.resolve(repoRoot);
  const tracked = new Set(trackedPaths.map((file) => path.join(root, file)));
  const consumed = new Set();
  const configurations = [];
  const outcomes = [];
  const seen = new Set();
  const stat = (file) => {
    try { return statSync(file); }
    catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    }
  };
  const host = {
    ...ts.sys,
    fileExists: (file) => stat(file)?.isFile() ?? false,
    directoryExists: (file) => stat(file)?.isDirectory() ?? false,
    readFile: (file) => {
      const text = readTypescriptConfigInput(ts, file);
      if (text !== undefined) {
        consumed.add(path.resolve(file));
        return text;
      }
      return undefined;
    }
  };
  function visit(file) {
    file = resolveTypescriptConfig(ts, root, file);
    if (seen.has(file)) return;
    seen.add(file);
    const observed = observeTypescriptConfiguration(ts, file, host);
    const { parsed } = observed;
    configurations.push(path.relative(root, file).split(path.sep).join("/"));
    outcomes.push({ configuration: path.relative(root, file).split(path.sep).join("/"),
      state: observed.state, diagnostics: observed.diagnostics, missing: observed.missing, invalid: observed.invalid });
    if (!parsed) return;
    for (const reference of parsed.projectReferences ?? []) visit(ts.resolveProjectReferencePath(reference));
  }
  visit(path.join(root, configPath));

  const missing = [...new Set(outcomes.flatMap(outcome => outcome.missing.map(d => `TS${d.code}: ${d.message}`)))].sort();
  const invalid = [...new Set(outcomes.flatMap(outcome => outcome.invalid.map(d => `TS${d.code}: ${d.message}`)))].sort();

  const population = new Set([path.dirname(require.resolve("typescript/package.json"))]);
  for (const file of consumed) {

    const relative = path.relative(root, file);
    const segments = relative.split(path.sep);
    const modules = segments.lastIndexOf("node_modules");
    if (!relative.startsWith(`..${path.sep}`) && modules !== -1) {
      const end = modules + (segments[modules + 1]?.startsWith("@") ? 3 : 2);
      const packageRoot = path.join(root, ...segments.slice(0, end));
      if (!trackedPaths.some((value) => path.join(root, value).startsWith(`${packageRoot}${path.sep}`))) {
        population.add(packageRoot);
        continue;
      }
    }
    if (!tracked.has(file)) population.add(file);
  }
  return { state: "observed", population: [...population].sort(), missing, invalid, outcomes,
    configurations: configurations.sort() };
}
