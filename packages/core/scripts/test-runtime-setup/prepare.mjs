

import { resolveSetupParameters } from "./parameter-resolution.mjs";
import readline from "node:readline/promises";
import { ensureAgentChassisGitignore } from "@agent-chassis/wiki-core/src/lib/local-state-ignores.mjs";

import { renderTestRuntimeSetupResult } from "./cli.mjs";
import {
  REPOSITORY_RUNTIME_CONFIG_FILE,
  readRepositoryRuntimeConfig,
  writeRepositoryRuntimeConfig
} from "@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/config.mjs";
import {
  collectRepositoryManifests,
  discoverRuntimeEnvironments,
  environmentsForLanguage,
  repositoryManifestReader
} from "@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/discovery.mjs";
import { selectAutomaticTestEnvironments } from
  "@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/automatic-selection.mjs";

const SETUP_MODULE = "@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/index.mjs";

async function ask(input, output, question) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function unattended(output, lines, failure) {
  for (const line of lines) output.write(`${line}\n`);
  return { ok: false, status: "unresolved", phase: "toolchain", failure,
    correction: failure.detail.correction };
}

async function resolveMissingExecutable({ adapter, input, output, interactive, invocation }) {
  const { parameter: name, command, option: flag, example, environment, environmentExample, prompt } = adapter;
  const option = `${flag} ${example}`;
  const failure = { code: "test_runtime_toolchain_not_found",
    message: `No ${command} was found on PATH, so the ${name} toolchain cannot be located.`,
    detail: { toolchain: name, command,
      correction: `agent-chassis ${invocation} ${option} or ${environment}=${environmentExample}` } };
  if (!interactive) {
    return unattended(output, [
      `No ${command} was found on PATH, so the ${name} toolchain cannot be located.`,
      "Rerun setup with its location, for example:",
      failure.detail.correction
    ], failure);
  }
  output.write(`No ${command} was found on PATH for the ${name} toolchain.\n`);
  const answer = await ask(input, output, prompt);
  if (answer === "") {
    return unattended(output, [`Set it later with: agent-chassis ${invocation} ${option}`], failure);
  }
  return { ok: true, executable: answer, source: "your answer" };
}

function environmentLine({ id, language, members, runners, evidence }) {
  const facts = [language,
    members.length > 0 ? `members ${members.join(", ")}` : null,
    `runners ${runners.length > 0 ? runners.join(", ") : "none declared"}`,
    evidence === undefined ? null : `from ${evidence.join(", ")}`].filter(Boolean);
  return `  ${id} (${facts.join("; ")})`;
}

function reportEnvironments({ output, environments, excluded, source, automaticSelection = [] }) {
  output.write(`Test environments (from ${source}):\n`);
  for (const environment of environments) output.write(`${environmentLine(environment)}\n`);
  if (excluded.length > 0) {
    output.write("Not detected:\n");
    for (const { path: file, reason, environment } of excluded) {
      output.write(`  ${file} (${reason.replaceAll("_", " ")}${environment ? ` ${environment}` : ""})\n`);
    }
  }
  for (const decision of automaticSelection) {
    output.write(`  automatic ${decision.selected ? "selected" : "omitted"}: ${decision.environment} ` +
      `(${decision.reason}; ${decision.evidence.map(({ kind, path }) => `${kind}: ${path}`).join(", ")}; ` +
      `${decision.evidence_count} evidence item(s))\n`);
  }
}

function progressLine({ phase, toolchain, environment, check }) {
  if (phase === "toolchain") return `  ... toolchain ${toolchain}: resolving`;
  if (phase === "dependencies") return `  ... ${environment}: detecting installed dependencies`;
  if (phase === "sandbox_plan") return `  ... ${environment}: planning sandbox checks`;
  return `  ... ${environment}: sandbox check ${check}`;
}

function correctionFor(component, { configPath }) {
  if (component === undefined) return null;
  const { code, detail = {} } = component;
  if (code === "test_runtime_version_mismatch") {
    return `The ${detail.toolchain} at ${detail.executable} reports ${detail.reported ?? "no usable version"}, ` +
      `but this project selects ${detail.selected}. Install a matching toolchain and rerun setup with ` +
      `--executable ${detail.toolchain}=<path to ${detail.selected}>; setup never substitutes another installation.`;
  }
  if (code === "test_runtime_toolchain_executable_invalid" ||
      code === "test_runtime_toolchain_executable_unavailable" ||
      code === "test_runtime_toolchain_incomplete") {
    return `Correct the ${detail.toolchain} location with ` +
      `--executable ${detail.toolchain}=<absolute path>, or edit ${configPath}.`;
  }
  return null;
}

export function explicitRunnerEnvironments(setup, runners, inventory) {
  const catalog = setup.testRuntimeRunners();
  const unknown = runners.filter(({ runner }) => !catalog.some(({ name }) => name === runner));
  if (unknown.length > 0) {
    throw new Error(`Unknown runner: ${unknown.map(({ runner }) => runner).join(", ")} ` +
      `(known: ${catalog.map(({ name }) => name).join(", ")})`);
  }
  return setup.environmentsFromRunnerSelection(runners).map((environment) => {
    const known = inventory.find((entry) => entry.ecosystem === environment.ecosystem &&
      entry.project === environment.project);
    return { ...environment, id: `${environment.ecosystem}@${environment.project}`,
      language: known?.language ?? null, members: known?.members ?? [],
      ...(known === undefined ? {} : { evidence: known.evidence }) };
  });
}

export async function prepareRepositoryTestRuntimes(options = {}) {
  const setup = await import(SETUP_MODULE);
  const context = { phase: "selection" };
  try {
    return await prepareRuntimes(options, context);
  } catch (error) {
    if (!(error instanceof setup.TestRuntimeSetupError) || options.locatePathToolchains === false) throw error;
    (options.output ?? process.stdout).write(`${error.message}\n`);
    return { ok: false, status: "failed", ...context,
      failure: { code: error.code, message: error.message, detail: error.detail },
      correction: error.detail.correction ?? null };
  }
}

async function prepareRuntimes({
  repositoryRoot,
  runners = [],
  language = null,
  parameters,
  toolchainVersions = {},
  runtimeConfig = null,
  locatePathToolchains = true,
  command = { invocation: "setup" },
  interactive = null,
  dryRun = false,
  input = process.stdin,
  output = process.stdout,
  progressOutput = output,
  env = process.env
} = {}, context) {
  const setup = await import(SETUP_MODULE);
  const asking = interactive === null ? input.isTTY === true : interactive;
  const catalog = setup.testRuntimeRunners();
  const ecosystems = setup.testRuntimeEcosystems();
  if (language !== null && !catalog.some(({ languages }) => languages.includes(language))) {
    const available = [...new Set(catalog.flatMap(({ languages }) => languages))].sort();
    throw new Error(`Unsupported --language value: ${language} (known: ${available.join(", ")})`);
  }
  const saved = runtimeConfig === null ? readRepositoryRuntimeConfig(repositoryRoot)
    : { present: true, ...runtimeConfig };
  const named = runners.length > 0 ? runners
    : saved.present && saved.runners.length > 0 && language === null ? saved.runners : [];
  const collected = collectRepositoryManifests(repositoryRoot, { includeTestSources: named.length === 0 });
  const readFile = repositoryManifestReader(repositoryRoot);
  const inventory = discoverRuntimeEnvironments({ manifests: collected.manifests, runners: catalog,
    readFile });

  let environments;
  let source;
  let excluded = [];
  let automaticSelection = [];
  if (named.length > 0) {
    environments = explicitRunnerEnvironments(setup, named, inventory.environments);
    source = runners.length > 0 ? "command line"
      : runtimeConfig === null ? "saved repository configuration" : "--runtime-config";
  } else {
    const testable = selectAutomaticTestEnvironments({ inventory: { ...inventory,
      environments: environmentsForLanguage(inventory.environments, language, catalog) },
    testSources: collected.testSources, readFile });
    environments = testable.environments;
    automaticSelection = testable.decisions;
    source = `repository evidence${language === null ? "" : ` for ${language}`}`;
    excluded = [...collected.excluded, ...inventory.excluded, ...testable.excluded]
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  context.environments = environments;
  context.automatic_selection = automaticSelection;

  if (!dryRun) await ensureAgentChassisGitignore(repositoryRoot);

  if (environments.length === 0) {
    output.write("No test environment was found in this repository's own manifests " +
      "(go.mod, Cargo.toml, package.json, deno.json, pyproject.toml, requirements*.txt).\n");
    reportEnvironments({ output, environments, excluded, source, automaticSelection });
    output.write(`Add one and rerun \`agent-chassis ${command.invocation}\`, or name a runner ` +
      "directly with --runner <name>[@<project>].\n");
    return { ok: true, status: "no_test_project", phase: "selection", environments: [], excluded,
      automatic_selection: automaticSelection };
  }
  reportEnvironments({ output, environments, excluded, source, automaticSelection });

  const required = [...new Set(environments.flatMap((environment) => [
    ...ecosystems[environment.ecosystem].toolchains,
    ...environment.runners.flatMap((runner) => catalog.find(({ name }) => name === runner).toolchains)
  ]))].sort();
  const resolved = await resolveSetupParameters({ required, parameters, saved, runtimeConfig,
    locatePathToolchains, findOnPath: setup.findOnPath, env, output, context,
    prompt: (adapter) => resolveMissingExecutable({ adapter, input, output,
      interactive: asking, invocation: command.invocation }) });
  if (!resolved.ok) return { ...resolved, environments, excluded, automatic_selection: automaticSelection };
  const { toolchains, environments: environmentSelections } = resolved;
  context.phase = "selection";
  delete context.toolchain;
  const result = await setup.runTestRuntimeSetup({ repositoryRoot, env, environmentSelections,
    environments: environments.map(({ ecosystem, project, members, runners: names }) =>
      ({ ecosystem, project, members, runners: names })),
    toolchainExecutables: Object.fromEntries(Object.entries(toolchains)
      .map(([name, { executable }]) => [name, executable])),

    toolchainVersions: { ...Object.fromEntries(Object.entries(toolchains)
      .filter(([, { version }]) => version !== null).map(([name, { version }]) => [name, version])),
    ...toolchainVersions },
    dryRun,
    progress: (event) => {
      Object.assign(context, { phase: event.phase, toolchain: event.toolchain,
        environment: event.environment, check: event.check });
      progressOutput.write(`${progressLine(event)}\n`);
    } });

  const components = result.components ?? [];

  const toolchainComponents = components.filter(({ kind }) => kind === "toolchain");
  const located = toolchainComponents.length > 0 && toolchainComponents
    .every(({ status }) => status === "ready");
  const savedRunners = runners.length > 0 ? runners
    : saved.present && runtimeConfig === null ? saved.runners : [];

  const savedTestEntrypoints = saved.present && runtimeConfig === null ? saved.test_entrypoints : [];
  let configPath = saved.path;
  if (!dryRun && located && runtimeConfig === null &&
      (savedRunners.length > 0 || Object.keys(toolchains).length > 0 ||
        Object.keys(environmentSelections).length > 0)) {
    const written = writeRepositoryRuntimeConfig(repositoryRoot, { runners: savedRunners, toolchains: resolved.savedToolchains,
      environments: environmentSelections, test_entrypoints: savedTestEntrypoints });
    configPath = written.path;
    output.write(`${written.written ? "Saved" : "Unchanged"} runtime configuration: ` +
      `${REPOSITORY_RUNTIME_CONFIG_FILE}\n`);
  }
  output.write(renderTestRuntimeSetupResult(result));
  if (result.dependency_preparations?.length > 0) {
    output.write("Native dependency preparation descriptions are available in dependency_preparations " +
      "in the setup API result and JSON report. The operator or image builder executes them with network " +
      "access, then reruns setup; setup never executes them or retries automatically.\n");
  }

  const failedComponent = components.find(({ status }) => status === "failed");
  const correction = correctionFor(failedComponent, { configPath }) ??
    failedComponent?.detail?.correction ?? result.failure?.detail?.correction ?? null;
  if (result.status === "ready") {
    const versions = components.filter(({ kind }) => kind === "toolchain")
      .map(({ name, version, source: toolchainSource }) => `${name} ${version} ` +
        (toolchains[name] === undefined ? `(${toolchainSource})` : `at ${toolchains[name].executable}`));
    output.write(`Local test runtimes are ready for ${result.environments.map(({ id }) => id).join(", ")} ` +
      `using ${versions.join(", ")}.\n`);
  } else if (result.status === "detected") {
    output.write("Dry run: everything was detected and validated; nothing was proved in the sandbox, saved or published.\n");
  } else {
    if (correction !== null) output.write(`${correction}\n`);
    output.write("Local test runtimes are NOT ready; install or repair what failed above yourself and rerun " +
      "setup. Nothing was installed and no usable runtime was published.\n");
  }
  const failedCheck = result.verification?.find(({ ok }) => !ok);
  let phase = context.phase;
  if (result.status === "ready") phase = "completed";
  else if (failedComponent) phase = failedComponent.kind;
  else if (failedCheck) phase = failedCheck.check === "runtime_inputs" ? "sandbox_plan" : "sandbox_check";
  return { ok: result.ok, status: result.status, phase, failure: result.failure ?? null,
    correction, result, environments, excluded, toolchains, automatic_selection: automaticSelection,
    selection: result.selection, configPath };
}

export const TEST_RUNTIME_REPORT_SCHEMA = "setup-test-runtime-report.v1";

function diagnosticFact(fact) {
  if (fact == null) return null;
  const fields = ["kind", "name", "status", "ok", "code", "message", "environment",
    "ecosystem", "project", "toolchain", "check", "provider_id", "version", "source",
    "observed_version", "expected_version"];
  const projected = Object.fromEntries(fields.filter((key) => fact[key] !== undefined)
    .map((key) => [key, fact[key]]));

  if (typeof fact.diagnostic === "string") projected.diagnostic = fact.diagnostic.slice(0, 4000);
  if (fact.detail) {
    const detail = fact.detail;
    const keys = ["parameter", "source", "toolchain", "command", "executable", "root", "project", "environment",
      "selected", "reported", "required", "correction", "valid_choices", "available_runners",
      "available_toolchains", "module_cache", "workspace", "virtual_environment"];
    projected.detail = Object.fromEntries(keys.filter((key) => detail[key] !== undefined)
      .map((key) => [key, detail[key]]));
    if (typeof detail.diagnostic === "string") projected.detail.diagnostic = detail.diagnostic.slice(0, 4000);
    if (Array.isArray(detail.missing)) projected.detail.missing = detail.missing.map((item) =>
      typeof item === "string" ? item : Object.fromEntries(["executable", "path"]
        .filter((key) => item[key] !== undefined).map((key) => [key, item[key]])));
  }
  return projected;
}

export function testRuntimePreparationReport(prepared) {
  return { schema_version: TEST_RUNTIME_REPORT_SCHEMA, ok: prepared.ok,
    status: prepared.status, phase: prepared.phase,
    ...(prepared.toolchain === undefined ? {} : { toolchain: prepared.toolchain }),
    ...(prepared.environment === undefined ? {} : { environment: prepared.environment }),
    ...(prepared.check === undefined ? {} : { check: prepared.check }),
    environments: (prepared.environments ?? []).map(({ id, ecosystem, project, members, runners }) =>
      ({ id, ecosystem, project, members, runners })),
    automatic_selection: prepared.automatic_selection ?? [],
    failure: diagnosticFact(prepared.failure), correction: prepared.correction ?? null,
    components: (prepared.result?.components ?? []).map(diagnosticFact),
    dependency_preparations: prepared.result?.dependency_preparations ?? [],
    checks: (prepared.result?.verification ?? []).map(diagnosticFact) };
}
