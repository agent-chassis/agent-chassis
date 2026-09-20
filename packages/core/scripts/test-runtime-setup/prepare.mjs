

import readline from "node:readline/promises";

import { renderTestRuntimeSetupResult } from "./cli.mjs";
import {
  REPOSITORY_RUNTIME_CONFIG_FILE,
  readRepositoryRuntimeConfig,
  writeRepositoryRuntimeConfig
} from "./config.mjs";
import {
  chooseRuntimeSelection,
  collectRepositoryManifests,
  discoverRuntimeProjects,
  repositoryManifestReader
} from "./discovery.mjs";

const SETUP_MODULE = "@agent-chassis/agent-launch-cli/src/lib/test-runtime-setup/index.mjs";

function selector({ runner, project }) {
  return project === "." ? runner : `${runner}@${project}`;
}

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

async function resolveAmbiguity({ candidates, input, output }) {
  const listed = candidates.map((candidate) =>
    `  ${selector(candidate)}  (${candidate.language}, from ${candidate.evidence.join(", ")})`);
  if (input.isTTY !== true) {
    return unattended(output, [
      `This repository has ${candidates.length} plausible test runtime selections:`,
      ...listed,
      "Rerun setup with the one to prepare, for example:",
      `  agent-chassis setup --runner ${selector(candidates[0])}`,
      "Narrow by language instead with --language <name>."
    ]);
  }
  output.write(`This repository has ${candidates.length} plausible test runtime selections:\n`);
  candidates.forEach((candidate, index) => {
    output.write(`  ${index + 1}. ${selector(candidate)} (${candidate.language}, from ${candidate.evidence.join(", ")})\n`);
  });
  const answer = await ask(input, output, "Select the test runtime to prepare [1]: ");
  const index = answer === "" ? 0 : Number.parseInt(answer, 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
    throw new Error(`Invalid selection: ${answer}`);
  }
  const chosen = candidates[index];
  return { ok: true, selection: [{ runner: chosen.runner, project: chosen.project }],
    source: "your selection" };
}

async function resolveMissingExecutable({ name, command, input, output }) {
  const option = `--executable ${name}=/absolute/path/to/${command}`;
  if (input.isTTY !== true) {
    return unattended(output, [
      `No ${command} was found on PATH, so the ${name} toolchain cannot be located.`,
      "Rerun setup with its location, for example:",
      `  agent-chassis setup ${option}`
    ]);
  }
  output.write(`No ${command} was found on PATH for the ${name} toolchain.\n`);
  const answer = await ask(input, output, `Absolute path to ${command} (blank to abort): `);
  if (answer === "") {
    return unattended(output, [`Set it later with: agent-chassis setup ${option}`]);
  }
  return { ok: true, executable: answer, source: "your answer" };
}

function reportSelection({ output, selection, source, project }) {
  if (project !== undefined) {
    output.write(`Test project: ${project.project} (${project.language}, from ${project.evidence.join(", ")})\n`);
  }
  output.write(`Runner selection: ${selection.map(selector).join(", ")} (from ${source})\n`);
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

export async function prepareRepositoryTestRuntimes({
  repositoryRoot,
  runners = [],
  language = null,
  executables = {},
  dryRun = false,
  input = process.stdin,
  output = process.stdout,
  env = process.env
} = {}) {
  const setup = await import(SETUP_MODULE);
  const catalog = setup.testRuntimeRunners();
  const commands = setup.testRuntimeToolchainCommands();
  if (language !== null && !catalog.some(({ languages }) => languages.includes(language))) {
    const available = [...new Set(catalog.flatMap(({ languages }) => languages))].sort();
    throw new Error(`Unsupported --language value: ${language} (known: ${available.join(", ")})`);
  }

  const saved = readRepositoryRuntimeConfig(repositoryRoot);
  const savedRunners = saved.present && language === null ? saved.runners : null;
  const discovered = runners.length > 0 || savedRunners !== null ? [] : discoverRuntimeProjects({
    manifests: collectRepositoryManifests(repositoryRoot),
    runners: catalog,
    readFile: repositoryManifestReader(repositoryRoot)
  });
  const chosen = chooseRuntimeSelection({ explicit: runners, saved: savedRunners, discovered,
    language, runners: catalog });

  if (chosen.status === "none") {
    output.write("No test project was found in this repository's own manifests " +
      "(go.mod, Cargo.toml, package.json, deno.json, pyproject.toml, requirements*.txt).\n");
    output.write("Add one and rerun setup, or name the runner directly with " +
      "--runner <name>[@<project>].\n");
    return { ok: true, status: "no_test_project" };
  }
  let selection = chosen.selection;
  let selectionSource = chosen.source;
  if (chosen.status === "ambiguous") {
    const answered = await resolveAmbiguity({ candidates: chosen.candidates, input, output });
    if (!answered.ok) return answered;
    selection = answered.selection;
    selectionSource = answered.source;
  }
  reportSelection({ output, selection, source: selectionSource, project: chosen.discovered });

  const unknown = selection.filter(({ runner }) => !catalog.some(({ name }) => name === runner));
  if (unknown.length > 0) {
    throw new Error(`Unknown runner: ${unknown.map(({ runner }) => runner).join(", ")} ` +
      `(known: ${catalog.map(({ name }) => name).join(", ")})`);
  }

  const required = [...new Set(selection.flatMap(({ runner }) =>
    catalog.find(({ name }) => name === runner).toolchains))].sort();
  const toolchains = {};
  for (const name of required) {
    const command = commands[name];
    let executable = executables[name] ?? null;
    let source = "--executable";
    if (executable === null && saved.present && saved.toolchains[name]) {
      executable = saved.toolchains[name].executable;
      source = REPOSITORY_RUNTIME_CONFIG_FILE;
    }
    if (executable === null) {
      const located = setup.findOnPath(command, env.PATH);
      if (located !== null) {
        executable = located.real;
        source = "PATH";
      }
    }
    if (executable === null) {
      const answered = await resolveMissingExecutable({ name, command, input, output });
      if (!answered.ok) return answered;
      executable = answered.executable;
      source = answered.source;
    }
    toolchains[name] = { executable, version: saved.present
      ? saved.toolchains[name]?.version ?? null : null };
    output.write(`Toolchain ${name}: ${executable} (${source})\n`);
  }

  const result = await setup.runTestRuntimeSetup({ repositoryRoot, runners: selection, env,
    toolchainExecutables: Object.fromEntries(Object.entries(toolchains)
      .map(([name, { executable }]) => [name, executable])),
    toolchainVersions: Object.fromEntries(Object.entries(toolchains)
      .filter(([, { version }]) => version !== null).map(([name, { version }]) => [name, version])),
    dryRun });

  const components = result.components ?? [];
  const located = components.filter(({ kind }) => kind === "toolchain")
    .every(({ status }) => status === "ready");
  let configPath = saved.path;
  if (!dryRun && located) {
    const written = writeRepositoryRuntimeConfig(repositoryRoot, { runners: selection, toolchains });
    configPath = written.path;
    output.write(`${written.written ? "Saved" : "Unchanged"} runtime configuration: ` +
      `${REPOSITORY_RUNTIME_CONFIG_FILE}\n`);
  }
  output.write(renderTestRuntimeSetupResult(result));

  if (result.status === "ready") {
    const versions = components.filter(({ kind }) => kind === "toolchain")
      .map(({ name, version }) => `${name} ${version} at ${toolchains[name].executable}`);
    output.write(`Local test runtimes are ready for ${selection.map(selector).join(", ")} ` +
      `using ${versions.join(", ")}.\n`);
  } else if (result.status === "planned") {
    output.write("Dry run: nothing was installed, prepared, saved or published.\n");
  } else {
    const correction = correctionFor(
      components.find(({ status }) => status === "failed"), { configPath });
    if (correction !== null) output.write(`${correction}\n`);
    output.write("Local test runtimes are NOT ready; no readiness was published.\n");
  }
  return { ok: result.ok, status: result.status, result, selection, toolchains, configPath };
}
