

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const REPOSITORY_RUNTIME_CONFIG_FILE = "agent-chassis-runtime.json";

export const TEST_RUNTIME_CONFIG_FIELDS = Object.freeze(["runners", "toolchains"]);
const RUNNER_FIELDS = Object.freeze(["runner", "project"]);
const TOOLCHAIN_FIELDS = Object.freeze(["executable", "version"]);
const RUNNER_NAME = /^[a-z][a-z0-9-]*$/u;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closedObject(fail, label, value, allowed) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`${label} has unknown field ${key} (allowed: ${allowed.join(", ")})`);
    }
  }
  return value;
}

export function parseTestRuntimeConfig(text, { source = "<runtime config>" } = {}) {
  const fail = (detail) => {
    throw new Error(`invalid runtime configuration ${source}: ${detail}`);
  };
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    fail(`not valid JSON (${error.message})`);
  }
  closedObject(fail, "the configuration", document, TEST_RUNTIME_CONFIG_FIELDS);
  if (!Array.isArray(document.runners) || document.runners.length === 0) {
    fail("runners must be a nonempty array of {runner, project} selections");
  }
  const runners = [];
  for (const [index, entry] of document.runners.entries()) {
    const label = `runners[${index}]`;
    closedObject(fail, label, entry, RUNNER_FIELDS);
    if (typeof entry.runner !== "string" || !RUNNER_NAME.test(entry.runner)) {
      fail(`${label}.runner must be a runner name`);
    }
    if (Object.hasOwn(entry, "project") &&
        (typeof entry.project !== "string" || entry.project.length === 0)) {
      fail(`${label}.project must be a repository-relative directory`);
    }
    const project = Object.hasOwn(entry, "project") ? entry.project : ".";
    if (runners.some((selected) => selected.runner === entry.runner && selected.project === project)) {
      fail(`runners selects ${entry.runner}@${project} more than once`);
    }
    runners.push({ runner: entry.runner, project });
  }
  const toolchains = {};
  if (Object.hasOwn(document, "toolchains")) {
    if (!isPlainObject(document.toolchains)) fail("toolchains must be an object");
    for (const [name, entry] of Object.entries(document.toolchains)) {
      const label = `toolchains.${name}`;
      closedObject(fail, label, entry, TOOLCHAIN_FIELDS);
      if (typeof entry.executable !== "string" || !path.isAbsolute(entry.executable)) {
        fail(`${label}.executable must be an absolute path to the installed executable`);
      }
      if (Object.hasOwn(entry, "version") &&
          (typeof entry.version !== "string" || !EXACT_VERSION.test(entry.version))) {
        fail(`${label}.version must be an exact <x.y.z> version`);
      }
      toolchains[name] = { executable: entry.executable,
        version: Object.hasOwn(entry, "version") ? entry.version : null };
    }
  }
  return { runners, toolchains };
}

export function loadTestRuntimeConfig(file, { cwd = process.cwd() } = {}) {
  const resolved = path.resolve(cwd, file);
  let text;
  try {
    text = readFileSync(resolved, "utf8");
  } catch (error) {
    throw new Error(`--runtime-config ${file} is unreadable: ${error.code ?? error.message}`);
  }
  return { ...parseTestRuntimeConfig(text, { source: file }), path: resolved };
}

export function configuredToolchainVersions({ toolchains }) {
  return Object.fromEntries(Object.entries(toolchains)
    .filter(([, { version }]) => version !== null).map(([name, { version }]) => [name, version]));
}

export function configuredToolchainExecutables({ toolchains }) {
  return Object.fromEntries(Object.entries(toolchains)
    .map(([name, { executable }]) => [name, executable]));
}

export function repositoryRuntimeConfigPath(repositoryRoot) {
  return path.join(repositoryRoot, REPOSITORY_RUNTIME_CONFIG_FILE);
}

export function serializeTestRuntimeConfig({ runners, toolchains }) {
  const document = { runners: runners.map(({ runner, project }) => ({ runner, project })) };
  const names = Object.keys(toolchains ?? {}).sort();
  if (names.length > 0) {
    document.toolchains = Object.fromEntries(names.map((name) => [name, {
      executable: toolchains[name].executable,
      ...(toolchains[name].version ? { version: toolchains[name].version } : {})
    }]));
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function readRepositoryRuntimeConfig(repositoryRoot) {
  const file = repositoryRuntimeConfigPath(repositoryRoot);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false, path: file };
    throw new Error(`${REPOSITORY_RUNTIME_CONFIG_FILE} is unreadable: ${error.code ?? error.message}`);
  }
  return { present: true, path: file,
    ...parseTestRuntimeConfig(text, { source: REPOSITORY_RUNTIME_CONFIG_FILE }) };
}

export function writeRepositoryRuntimeConfig(repositoryRoot, config) {
  const file = repositoryRuntimeConfigPath(repositoryRoot);
  const text = serializeTestRuntimeConfig(config);
  let existing = null;
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    existing = null;
  }
  if (existing === text) return { path: file, written: false };
  writeFileSync(file, text);
  return { path: file, written: true };
}
