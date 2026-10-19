

import path from "node:path";
import { FIXTURE_DIRECTORY_NAMES } from "./discovery.mjs";
import { readDenoConfig } from "./deno-config.mjs";
import { npmManifestFacts } from "./npm-workspace.mjs";
import { nativeTestEvidence } from "./native-test-evidence.mjs";

const TEST_FAMILY = /^test(?:$|[:-].+)/u;
const EVIDENCE_LIMIT = 8;
const at = (project, file) => project === "." ? file : `${project}/${file}`;
const contains = (project, file) => project === "." || file.startsWith(`${project}/`);

function invalid(file, message) {
  throw Object.assign(new Error(`${file}: ${message}`), {
    code: "test_runtime_manifest_invalid", detail: { manifest: file, error: message }
  });
}

function requiredText(readFile, file) {
  const text = readFile(file);
  if (typeof text !== "string") invalid(file, "repository evidence could not be read");
  return text;
}

function ownsSource(environment, file) {
  const roots = [environment.project, ...environment.members.map((member) => at(environment.project, member))]
    .filter((project) => contains(project, file)).sort((a, b) => b.length - a.length);
  const relative = roots[0] === "." ? file : file.slice(roots[0].length + 1);
  return !relative.split("/").slice(0, -1).some((part) => FIXTURE_DIRECTORY_NAMES.includes(part));
}

function sourceOwner(environments, ecosystem, file) {
  const owner = environments.filter((entry) => entry.ecosystem === ecosystem && contains(entry.project, file))
    .sort((a, b) => b.project.length - a.project.length)[0];
  return owner !== undefined && ownsSource(owner, file) ? owner : null;
}

function denoEvidence(text, file) {
  const config = readDenoConfig(text, file);
  const evidence = [];
  if (config.test !== undefined) {
    if (config.test === null || typeof config.test !== "object" || Array.isArray(config.test)) {
      invalid(file, "Deno test configuration must be an object");
    }
    evidence.push({ kind: "deno_test_configuration", path: file });
  }
  const tasks = config.tasks === undefined ? {} : config.tasks;
  if (tasks === null || typeof tasks !== "object" || Array.isArray(tasks)) invalid(file, "Deno tasks must be an object");
  const declarations = new Map();
  for (const [name, task] of Object.entries(tasks)) {
    const object = task !== null && typeof task === "object" && !Array.isArray(task);
    if (typeof task !== "string" && !object) invalid(file, `Deno task ${name} must be a string or object`);
    const command = typeof task === "string" ? task : task.command === undefined ? "" : task.command;
    const dependencies = object && task.dependencies !== undefined ? task.dependencies : [];
    if (object && task.command === undefined && task.dependencies === undefined) {
      invalid(file, `Deno task ${name} declares neither command nor dependencies`);
    }
    if (typeof command !== "string" || !Array.isArray(dependencies) ||
        dependencies.some((name) => typeof name !== "string")) invalid(file, `invalid Deno task ${name}`);
    const edges = [...dependencies];
    let native = false;
    for (const match of command.matchAll(/^\s*deno\s+(?:(?:-q|--quiet)\s+)*(test\b|task\s+(?:(?:-q|--quiet)\s+)*["']?([\w:.-]+))/gu)) {
      if (match[1] === "test") native = true;
      else edges.push(match[2]);
    }
    declarations.set(name, { native, edges, nonempty: command.trim() !== "" || edges.length > 0 });
  }
  const resolved = new Map();
  const reachesTest = (name, visiting = new Set()) => {
    if (resolved.has(name)) return resolved.get(name);
    const declaration = declarations.get(name);
    if (declaration === undefined) invalid(file, `Deno task alias names undeclared task ${name}`);
    if (visiting.has(name)) invalid(file, `Deno task alias cycle at ${name}`);
    const next = new Set([...visiting, name]);
    const referenced = declaration.edges.map((edge) => reachesTest(edge, next));
    const found = declaration.native || (TEST_FAMILY.test(name) && declaration.nonempty) || referenced.some(Boolean);
    resolved.set(name, found);
    return found;
  };
  for (const name of declarations.keys()) {
    if (reachesTest(name)) evidence.push({ kind: "deno_test_task", path: file, name: name.slice(0, 128) });
  }
  return evidence;
}

export function selectAutomaticTestEnvironments({ inventory, testSources = [], readFile }) {
  const environments = inventory.environments;
  const facts = new Map(environments.map(({ id }) => [id, []]));
  for (const environment of environments) {
    if (environment.ecosystem !== "npm") continue;
    const manifests = [...environment.evidence, ...inventory.excluded
      .filter((entry) => entry.environment === environment.id).map(({ path }) => path)]
      .filter((file) => path.posix.basename(file) === "package.json");
    for (const file of [...new Set(manifests)]) {
      const manifest = npmManifestFacts(requiredText(readFile, file));
      if (!manifest.valid || !manifest.scriptsValid || !manifest.dependenciesValid) {
        invalid(file, "package.json must be an object with string-valued script and dependency tables");
      }
      facts.get(environment.id).push(...manifest.testScripts.map((name) =>
        ({ kind: "test_script", path: file, name: name.slice(0, 128) })),
      ...manifest.runners.filter((runner) => environment.runners.includes(runner)).map((name) =>
        ({ kind: "test_framework_dependency", path: file, name })));
    }
  }
  for (const file of [...testSources].sort()) {
    const npm = sourceOwner(environments, "npm", file);
    const deno = sourceOwner(environments, "deno", file);
    if (npm === null && deno === null) continue;
    const native = nativeTestEvidence(requiredText(readFile, file));
    if (npm !== null && native.node) facts.get(npm.id).push({ kind: "native_node_test", path: file });
    if (deno !== null && native.deno) facts.get(deno.id).push({ kind: "native_deno_test", path: file });
  }
  const npmTestProjects = new Set(environments.filter((entry) => entry.ecosystem === "npm" &&
    facts.get(entry.id).length > 0).flatMap((entry) => [entry.project,
    ...entry.members.map((member) => at(entry.project, member))]));
  const decisions = environments.map((environment) => {
    const evidence = facts.get(environment.id);
    let selected = environment.runners.length > 0;
    let reason = selected ? "existing_ecosystem" : "no_test_runner_declared";
    if (environment.ecosystem === "npm") {
      selected = evidence.length > 0;
      reason = selected ? "npm_test_evidence" : "no_test_evidence";
    } else if (environment.ecosystem === "deno") {
      for (const project of [environment.project, ...environment.members.map((member) => at(environment.project, member))]) {
        const primary = at(project, "deno.json");
        const alternate = at(project, "deno.jsonc");
        const file = environment.evidence.includes(primary) ? primary
          : environment.evidence.includes(alternate) ? alternate : null;
        if (file !== null) evidence.push(...denoEvidence(requiredText(readFile, file), file));
      }
      selected = evidence.length > 0 || !npmTestProjects.has(environment.project);
      reason = evidence.length > 0 ? "deno_test_evidence" : selected ? "deno_without_npm_tests"
        : "colocated_deno_without_test_evidence";
    }
    const reported = evidence.length > 0 ? evidence : environment.evidence.map((file) =>
      ({ kind: "manifest", path: file }));
    return { environment: environment.id, selected, reason,
      evidence: reported.slice(0, EVIDENCE_LIMIT), evidence_count: reported.length };
  });
  const chosen = new Set(decisions.filter(({ selected }) => selected).map(({ environment }) => environment));
  return { environments: environments.filter(({ id }) => chosen.has(id)), decisions,
    excluded: decisions.filter(({ selected }) => !selected).map(({ environment, reason, evidence }) =>
      ({ path: evidence[0]?.path ?? environment, reason, environment })) };
}
