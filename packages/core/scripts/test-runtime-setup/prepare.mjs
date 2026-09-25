

import readline from "node:readline/promises";

import { renderTestRuntimeSetupResult } from "./cli.mjs";
import {
  REPOSITORY_RUNTIME_CONFIG_FILE,
  readRepositoryRuntimeConfig,
  writeRepositoryRuntimeConfig
} from "./config.mjs";
import {
  collectRepositoryManifests,
  discoverRuntimeEnvironments,
  environmentsForLanguage,
  repositoryManifestReader
} from "./discovery.mjs";

const SETUP_MODULE = "@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/index.mjs";

async function ask(input, output, question) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function unattended(output, lines) {
  for (const line of lines) output.write(`${line}\n`);
  return { ok: false, status: "unresolved" };
}

async function resolveMissingExecutable({ name, command, input, output, interactive, invocation }) {
  const option = `--executable ${name}=/absolute/path/to/${command}`;
  if (!interactive) {
    return unattended(output, [
      `No ${command} was found on PATH, so the ${name} toolchain cannot be located.`,
      "Rerun setup with its location, for example:",
      `  agent-chassis ${invocation} ${option}`
    ]);
  }
  output.write(`No ${command} was found on PATH for the ${name} toolchain.\n`);
  const answer = await ask(input, output, `Absolute path to ${command} (blank to abort): `);
  if (answer === "") {
    return unattended(output, [`Set it later with: agent-chassis ${invocation} ${option}`]);
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

function reportEnvironments({ output, environments, excluded, source }) {
  output.write(`Test environments (from ${source}):\n`);
  for (const environment of environments) output.write(`${environmentLine(environment)}\n`);
  if (excluded.length > 0) {
    output.write("Not detected:\n");
    for (const { path: file, reason, environment } of excluded) {
      output.write(`  ${file} (${reason.replaceAll("_", " ")}${environment ? ` ${environment}` : ""})\n`);
    }
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

function explicitEnvironments(setup, runners, inventory) {
  return setup.environmentsFromRunnerSelection(runners).map((environment) => {
    const known = inventory.find((entry) => entry.ecosystem === environment.ecosystem &&
      entry.project === environment.project);
    return { ...environment, id: `${environment.ecosystem}@${environment.project}`,
      language: known?.language ?? null, members: known?.members ?? [],
      ...(known === undefined ? {} : { evidence: known.evidence }) };
  });
}

export async function prepareRepositoryTestRuntimes({
  repositoryRoot,
  runners = [],
  language = null,
  executables = {},
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
} = {}) {
  const setup = await import(SETUP_MODULE);
  const asking = interactive === null ? input.isTTY === true : interactive;
  const catalog = setup.testRuntimeRunners();
  const ecosystems = setup.testRuntimeEcosystems();
  const commands = setup.testRuntimeToolchainCommands();
  if (language !== null && !catalog.some(({ languages }) => languages.includes(language))) {
    const available = [...new Set(catalog.flatMap(({ languages }) => languages))].sort();
    throw new Error(`Unsupported --language value: ${language} (known: ${available.join(", ")})`);
  }
  const saved = runtimeConfig === null ? readRepositoryRuntimeConfig(repositoryRoot)
    : { present: true, ...runtimeConfig };
  const collected = collectRepositoryManifests(repositoryRoot);
  const inventory = discoverRuntimeEnvironments({ manifests: collected.manifests, runners: catalog,
    readFile: repositoryManifestReader(repositoryRoot) });

  let environments;
  let source;
  let excluded = [];
  const named = runners.length > 0 ? runners
    : saved.present && saved.runners.length > 0 && language === null ? saved.runners : [];
  const unknown = named.filter(({ runner }) => !catalog.some(({ name }) => name === runner));
  if (unknown.length > 0) {
    throw new Error(`Unknown runner: ${unknown.map(({ runner }) => runner).join(", ")} ` +
      `(known: ${catalog.map(({ name }) => name).join(", ")})`);
  }
  if (runners.length > 0) {
    environments = explicitEnvironments(setup, runners, inventory.environments);
    source = "command line";
  } else if (named.length > 0) {
    environments = explicitEnvironments(setup, named, inventory.environments);
    source = runtimeConfig === null ? "saved repository configuration" : "--runtime-config";
  } else {
    environments = environmentsForLanguage(inventory.environments, language, catalog);
    source = `repository evidence${language === null ? "" : ` for ${language}`}`;
    excluded = [...collected.excluded, ...inventory.excluded];
  }

  if (environments.length === 0) {
    output.write("No test environment was found in this repository's own manifests " +
      "(go.mod, Cargo.toml, package.json, deno.json, pyproject.toml, requirements*.txt).\n");
    if (excluded.length > 0) reportEnvironments({ output, environments, excluded, source });
    output.write(`Add one and rerun \`agent-chassis ${command.invocation}\`, or name a runner ` +
      "directly with --runner <name>[@<project>].\n");
    return { ok: true, status: "no_test_project", environments: [], excluded };
  }
  reportEnvironments({ output, environments, excluded, source });

  const required = [...new Set(environments.flatMap((environment) => [
    ...ecosystems[environment.ecosystem].toolchains,
    ...environment.runners.flatMap((runner) => catalog.find(({ name }) => name === runner).toolchains)
  ]))].sort();
  const toolchains = {};
  for (const name of required) {
    const toolchainCommand = commands[name];
    let executable = executables[name] ?? null;
    let executableSource = "--executable";
    if (executable === null && saved.present && saved.toolchains[name]) {
      executable = saved.toolchains[name].executable;
      executableSource = runtimeConfig === null ? REPOSITORY_RUNTIME_CONFIG_FILE : "--runtime-config";
    }
    if (executable === null && locatePathToolchains) {
      const located = setup.findOnPath(toolchainCommand, env.PATH);
      if (located !== null) {
        executable = located.real;
        executableSource = "PATH";
      }
    }
    if (executable === null && !locatePathToolchains) {

      continue;
    }
    if (executable === null) {
      const answered = await resolveMissingExecutable({ name, command: toolchainCommand, input, output,
        interactive: asking, invocation: command.invocation });
      if (!answered.ok) return answered;
      executable = answered.executable;
      executableSource = answered.source;
    }
    toolchains[name] = { executable, version: saved.present
      ? saved.toolchains[name]?.version ?? null : null };
    output.write(`Toolchain ${name}: ${executable} (${executableSource})\n`);
  }

  for (const [name, entry] of Object.entries(runtimeConfig?.toolchains ?? {})) {
    if (toolchains[name] === undefined) toolchains[name] = { ...entry };
  }

  const environmentSelections = saved.present ? saved.environments ?? {} : {};
  const result = await setup.runTestRuntimeSetup({ repositoryRoot, env, environmentSelections,
    environments: environments.map(({ ecosystem, project, members, runners: names }) =>
      ({ ecosystem, project, members, runners: names })),
    toolchainExecutables: Object.fromEntries(Object.entries(toolchains)
      .map(([name, { executable }]) => [name, executable])),

    toolchainVersions: { ...Object.fromEntries(Object.entries(toolchains)
      .filter(([, { version }]) => version !== null).map(([name, { version }]) => [name, version])),
    ...toolchainVersions },
    dryRun,
    progress: (event) => progressOutput.write(`${progressLine(event)}\n`) });

  const components = result.components ?? [];
  const located = components.filter(({ kind }) => kind === "toolchain")
    .every(({ status }) => status === "ready");
  const savedRunners = runners.length > 0 ? runners
    : saved.present && runtimeConfig === null ? saved.runners : [];
  let configPath = saved.path;
  if (!dryRun && located && runtimeConfig === null &&
      (savedRunners.length > 0 || Object.keys(toolchains).length > 0 ||
        Object.keys(environmentSelections).length > 0)) {
    const written = writeRepositoryRuntimeConfig(repositoryRoot, { runners: savedRunners, toolchains,
      environments: environmentSelections });
    configPath = written.path;
    output.write(`${written.written ? "Saved" : "Unchanged"} runtime configuration: ` +
      `${REPOSITORY_RUNTIME_CONFIG_FILE}\n`);
  }
  output.write(renderTestRuntimeSetupResult(result));

  if (result.status === "ready") {
    const versions = components.filter(({ kind }) => kind === "toolchain")
      .map(({ name, version, source: toolchainSource }) => `${name} ${version} ` +
        (toolchains[name] === undefined ? `(${toolchainSource})` : `at ${toolchains[name].executable}`));
    output.write(`Local test runtimes are ready for ${result.environments.map(({ id }) => id).join(", ")} ` +
      `using ${versions.join(", ")}.\n`);
  } else if (result.status === "detected") {
    output.write("Dry run: everything was detected and validated; nothing was proved in the sandbox, saved or published.\n");
  } else {
    const correction = correctionFor(
      components.find(({ status }) => status === "failed"), { configPath });
    if (correction !== null) output.write(`${correction}\n`);
    output.write("Local test runtimes are NOT ready; install or repair what failed above yourself and rerun " +
      "setup. Nothing was installed and no usable runtime was published.\n");
  }
  return { ok: result.ok, status: result.status, result, environments, excluded, toolchains,
    selection: result.selection, configPath };
}
