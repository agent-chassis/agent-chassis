

import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEPENDENCY_ECOSYSTEMS } from "../test-runtime-setup/ecosystems.mjs";
import {
  TEST_RUNTIME_READINESS_CODES,
  loadReadiness,
  readinessRecovery
} from "../test-runtime-setup/readiness.mjs";
import { TOOLCHAIN_RECIPES } from "../test-runtime-setup/recipes.mjs";
import { resolvePackageAssetExecutable } from "../launch-isolation-package-asset.mjs";
import { resolveEnvironmentRuntimeInputs, selectContainingProject } from "./runtime-inputs.mjs";

export const WORKER_TEST_RUNTIME_SCHEMA_VERSION = "agent-launch-worker-test-runtime.v1";

export const WORKER_TEST_RUNTIME_TABLE_MOUNT_DIR = "/agent-launch-test-runtime";
export const WORKER_TEST_RUNTIME_ENTRY_MOUNT_DIR = "/agent-launch-test-runtime-entry";
export const WORKER_TEST_RUNTIME_SCRATCH_ROOT = "/agent-launch-test-runtime-scratch";
export const WORKER_TEST_RUNTIME_ENTRY_ASSET_DIR = fileURLToPath(new URL("../test-runtime-entry", import.meta.url));
export const WORKER_TEST_RUNTIME_PUBLICATION_RELATIVE_PATH =
  path.join(".agent-launch", "test-runtimes", "worker-runtime");

export const WORKER_TEST_RUNTIME_CODES = Object.freeze({
  INPUTS_OUTSIDE_SCOPE: "test_runtime_project_inputs_outside_scope",
  TOOLCHAIN_BIND_TOO_BROAD: "test_runtime_toolchain_bind_too_broad",
  TOOLCHAIN_INCOMPLETE: "test_runtime_toolchain_incomplete",
  LOCAL_PACKAGE_UNPROVEN: "test_runtime_local_package_provenance_unavailable",
  MEMBER_SOURCE_OUTSIDE_SCOPE: "test_runtime_workspace_member_outside_scope",
  PUBLICATION_FAILED: "test_runtime_worker_table_unavailable",
  ENTRY_UNAVAILABLE: "test_runtime_worker_entry_unavailable"
});

export const WORKER_TEST_RUNTIME_PREPARATION_REFUSAL_CODE =
  "agent_launch.worker_test_runtime.preparation_unusable.v1";

export class WorkerTestRuntimePreparationError extends Error {
  constructor(readiness, { environments, repository, composedDigest = null }) {
    super(`worker test runtime unavailable: ${readiness.message}`);
    this.name = "WorkerTestRuntimePreparationError";
    this.code = WORKER_TEST_RUNTIME_PREPARATION_REFUSAL_CODE;
    this.detail = Object.freeze({
      readiness_code: readiness.code,
      repository,
      required_environments: environments,
      preparation: readiness.detail?.preparation ?? null,
      status: readiness.detail?.status ?? null,
      readiness_digest: readiness.detail?.readiness_digest ?? null,
      composed_readiness_digest: composedDigest,
      deciding: readiness.detail?.deciding ?? null,
      preparation_result: readiness.detail?.result ?? null,
      recovery: readiness.recovery ?? readinessRecovery(),
      authority_limb: "mechanical"
    });
  }
}

export function requiredPreparationEnvironments(record, workerScopeAuthority) {
  return selectedProjects(record, workerScopeAuthority).projects.map(({ environment }) => environment);
}

const composed = new WeakSet();

export function isComposedWorkerTestRuntime(value) {
  return value !== null && typeof value === "object" && composed.has(value);
}

const sha256 = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function bindSourceIdentity(src) {
  let real = src;
  let stat = null;
  try {
    real = realpathSync(src);
    stat = statSync(real);
  } catch { stat = null; }
  return Object.freeze({ src, real, dev: stat === null ? null : String(stat.dev),
    ino: stat === null ? null : String(stat.ino) });
}
const within = (root, candidate) => candidate === root || candidate.startsWith(`${root}/`);

function commandName(toolchain, role) {
  return path.basename(TOOLCHAIN_RECIPES[toolchain].executables[role]);
}

function projectCommandOwners(toolchain, role) {
  return Object.values(DEPENDENCY_ECOSYSTEMS).filter((ecosystem) =>
    ecosystem.toolchains.includes(toolchain) && Object.hasOwn(ecosystem.projectCommands, role));
}

function visibility(authority) {
  const { readable, writable } = authority.resolved_scope;
  const files = new Set([...readable.files, ...writable.files]);
  const directories = [...readable.directories, ...writable.directories];
  return {
    members: [...files, ...directories],
    visible: (relative) => files.has(relative) || directories.some((directory) =>
      directory === "." || relative === directory || relative.startsWith(`${directory}/`))
  };
}

function unavailable(code, message, { subject, condition, action, detail = {}, effects = null,
  uncertainty = null }) {
  return Object.freeze({
    code, authority_limb: "mechanical", message, subject, condition,
    effects: effects ?? "no command ran with this runtime; no host runtime was substituted",
    uncertainty: uncertainty ?? "none beyond the named condition",
    action, detail
  });
}

function readinessUnavailable(failure, subject) {
  return unavailable(failure.code, failure.message, {
    subject, condition: "the setup-published runtime for this project is not current",
    detail: failure.detail ?? {},
    action: { actor: "operator", operator_action: failure.recovery?.operator_action ?? null,
      statement: failure.recovery?.statement ?? null }
  });
}

function broadSource(source, protectedRoots) {
  let real;
  try { real = realpathSync(source); } catch { real = source; }
  for (const [kind, root] of Object.entries(protectedRoots)) {
    if (within(real, root)) return { source: real, contained_root: root, contained_kind: kind, relation: "contains" };
    if (kind === "checkout" && within(root, real)) {
      return { source: real, contained_root: root, contained_kind: kind, relation: "inside" };
    }
  }
  return null;
}

function incompleteToolchain(name, toolchain) {
  const recipe = TOOLCHAIN_RECIPES[name];
  const missing = [];
  for (const [role, relative] of Object.entries(recipe.executables)) {
    const recorded = toolchain.executables?.[role] ?? null;
    const expected = recorded ?? (toolchain.root ? path.join(toolchain.root, relative) : relative);
    if (recorded === null || !existsSync(recorded)) missing.push({ executable: role, path: expected });
  }
  return missing;
}

function localPackageLinks(nodeModules, repositories, declaredMembers = new Map()) {
  const links = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        let real;
        try { real = realpathSync(absolute); } catch { real = path.resolve(directory, readlinkSync(absolute)); }
        const name = path.relative(nodeModules, absolute).split(path.sep).join("/");
        if ((declaredMembers.get(name) ?? []).includes(real)) continue;
        if (repositories.some((root) => within(root, real))) links.push({ link: absolute, target: real });
      } else if (stat.isDirectory() && entry.startsWith("@")) {
        visit(absolute);
      }
    }
  };
  if (existsSync(nodeModules)) visit(nodeModules);
  return links;
}

function selectedProjects(record, authority) {
  const scope = visibility(authority);
  const selected = new Map();
  for (const ecosystem of new Set((record.environments ?? []).map((entry) => entry.ecosystem))) {
    const environments = record.environments.filter((entry) => entry.ecosystem === ecosystem);
    for (const member of scope.members) {
      const project = selectContainingProject(environments.map((entry) => entry.project), member);
      if (project === null) continue;
      const environment = environments.find((entry) => entry.project === project);
      const key = `${ecosystem}\0${project}`;
      if (!selected.has(key)) {
        selected.set(key, { ecosystem, project, environment: environment.id,
          members: environment.members, runners: environment.runners });
      }
    }
  }
  return { scope, projects: [...selected.values()].sort((a, b) =>
    `${a.ecosystem}/${a.project}`.localeCompare(`${b.ecosystem}/${b.project}`)) };
}

function composeProject(entry, index, context) {
  const { mainReal, checkoutReal, scope, protectedRoots } = context;
  const ecosystem = DEPENDENCY_ECOSYSTEMS[entry.ecosystem];
  const projectDir = entry.project === "." ? checkoutReal : path.join(checkoutReal, entry.project);
  const subject = { repository: mainReal, checkout: checkoutReal, project: entry.project,
    ecosystem: entry.ecosystem, environment: entry.environment, runners: entry.runners };
  const recovery = readinessRecovery();

  const manifests = ecosystem.manifests(projectDir, { members: entry.members });
  const missing = Object.values(manifests.files ?? {}).map((file) => path.relative(checkoutReal, file))
    .filter((relative) => !scope.visible(relative)).sort();
  if (missing.length > 0) {
    return { ...entry, projectDir, failure: unavailable(WORKER_TEST_RUNTIME_CODES.INPUTS_OUTSIDE_SCOPE,
      `project ${entry.project} dependency inputs are outside the worker's frozen read/write scope`, {
        subject, condition: "the prepared runtime cannot be tied to inputs this worker can see",
        detail: { missing_files: missing },
        action: { actor: "coordinator", coordinator_action: "add the named dependency input files to the unit's read scope",
          inputs: { files: missing } } }) };
  }
  const runtime = resolveEnvironmentRuntimeInputs({ repositoryRoot: mainReal, checkoutRoot: checkoutReal,
    ecosystem: entry.ecosystem, project: entry.project,
    scratchRoot: `${WORKER_TEST_RUNTIME_SCRATCH_ROOT}/${index}` });
  if (!runtime.ok) return { ...entry, projectDir, failure: readinessUnavailable(runtime, subject) };
  for (const [name, toolchain] of Object.entries(runtime.toolchains)) {
    const missingExecutables = incompleteToolchain(name, toolchain);
    if (missingExecutables.length > 0) {
      return { ...entry, projectDir, failure: unavailable(WORKER_TEST_RUNTIME_CODES.TOOLCHAIN_INCOMPLETE,
        `recorded ${name} ${toolchain.version} is missing required executables`, {
          subject: { ...subject, toolchain: name }, condition: "the selected installation is incomplete",
          detail: { toolchain: name, missing: missingExecutables },
          action: { actor: "operator", operator_action: recovery.operator_action,
            statement: "Repair or reselect the toolchain installation, then rerun explicit setup." } }) };
    }
  }
  for (const bind of [...runtime.toolchainBinds, ...runtime.dependencyBinds.filter(({ dst }) =>
    !within(checkoutReal, dst))]) {
    const broad = broadSource(bind.src, protectedRoots);
    if (broad !== null) {
      return { ...entry, projectDir, failure: unavailable(WORKER_TEST_RUNTIME_CODES.TOOLCHAIN_BIND_TOO_BROAD,
        `runtime source ${broad.source} ${broad.relation === "contains" ? "contains" : "lies inside"} the ${broad.contained_kind} root ${broad.contained_root}`, {
          subject: { ...subject, toolchain: bind.toolchain ?? null }, condition: "binding it would expose more than the runtime",
          detail: broad,
          action: { actor: "operator", operator_action: recovery.operator_action,
            statement: "Configure the toolchain as its own installation directory (not a home or repository directory), then rerun explicit setup." } }) };
    }
  }

  const memberSources = (runtime.preparation.workspace_links ?? []).map(({ package: name, member }) =>
    ({ package: name, member: entry.project === "." ? member : `${entry.project}/${member}` }));
  const hiddenMembers = memberSources.filter(({ member }) => !scope.visible(member));
  if (hiddenMembers.length > 0) {
    const directories = [...new Set(hiddenMembers.map(({ member }) => member))].sort();
    return { ...entry, projectDir, failure: unavailable(WORKER_TEST_RUNTIME_CODES.MEMBER_SOURCE_OUTSIDE_SCOPE,
      `prepared dependencies of ${entry.project} link workspace members outside the worker's frozen read/write scope`, {
        subject, condition: "a linked workspace package would resolve to checkout source this worker cannot see",
        detail: { members: hiddenMembers },
        action: { actor: "coordinator",
          coordinator_action: "add the named workspace member directories to the unit's read scope",
          inputs: { directories } } }) };
  }
  if (entry.ecosystem === "npm" && runtime.values.node_modules_source) {
    const memberDirectories = (member) => [mainReal, checkoutReal].map((root) => {
      const directory = path.join(root, entry.project === "." ? member : path.join(entry.project, member));
      try { return realpathSync(directory); } catch { return directory; }
    });
    const declaredMembers = new Map((runtime.preparation.workspace_links ?? []).map(({ package: name, member }) =>
      [name, memberDirectories(member)]));
    const links = localPackageLinks(runtime.values.node_modules_source, [mainReal, checkoutReal], declaredMembers);
    if (links.length > 0) {
      return { ...entry, projectDir, failure: unavailable(WORKER_TEST_RUNTIME_CODES.LOCAL_PACKAGE_UNPROVEN,
        `prepared dependencies of ${entry.project} link repository-local packages`, {
          subject,
          condition: "prepared dependencies link repository-local packages that are not declared workspace members of this installation",
          detail: { links, supported: "relative links to declared workspace members of the installation root" },
          action: { actor: "operator",
            operator_action: `${recovery.operator_action} after declaring the linked packages as workspace members of ${entry.project}`,
            owner: "explicit local test-runtime setup (dependency preparation)",
            inputs: { links: links.map(({ link, target }) => ({ link, target })) } } }) };
    }
  }
  return { ...entry, projectDir, runtime, index };
}

function envText(env) {
  return Object.entries(env).map(([key, value]) => {
    if (/[\n\0]/u.test(`${key}${value}`)) throw new Error(`runtime environment ${key} is not one line`);
    return `${key}=${value}\n`;
  }).join("");
}

function detailText(failure) {
  return `agent-launch test runtime unavailable: ${failure.code}: ${failure.message}\n` +
    `${JSON.stringify(failure, null, 2)}\n`;
}

function publishTable(mainReal, files, commands) {
  const body = JSON.stringify({ files, commands });
  const digest = sha256(body);
  const base = path.join(mainReal, WORKER_TEST_RUNTIME_PUBLICATION_RELATIVE_PATH);
  const published = path.join(base, digest.slice("sha256:".length));
  const matches = () => {
    try {
      return Object.entries(files).every(([relative, text]) =>
        readFileSync(path.join(published, relative), "utf8") === text) &&
        commands.every((name) => readlinkSync(path.join(published, "bin", name)) ===
          `${WORKER_TEST_RUNTIME_ENTRY_MOUNT_DIR}/entry`) &&
        readdirSync(path.join(published, "bin")).length === commands.length;
    } catch { return false; }
  };
  if (!existsSync(published)) {
    mkdirSync(base, { recursive: true });
    const staging = mkdtempSync(path.join(base, ".staging-"));
    try {
      for (const [relative, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(staging, relative)), { recursive: true });
        writeFileSync(path.join(staging, relative), text, { mode: 0o444 });
      }
      mkdirSync(path.join(staging, "bin"));
      for (const name of commands) symlinkSync(`${WORKER_TEST_RUNTIME_ENTRY_MOUNT_DIR}/entry`, path.join(staging, "bin", name));

      renameSync(staging, published);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (!existsSync(published)) throw error;
    }
  }
  if (!matches()) {
    throw Object.assign(new Error(`published worker runtime table ${published} does not match its digest`),
      { code: WORKER_TEST_RUNTIME_CODES.PUBLICATION_FAILED, detail: { published, digest } });
  }
  const stat = statSync(published);
  return { published, digest, identity: { dev: String(stat.dev), ino: String(stat.ino) } };
}

export function composeWorkerTestRuntime({ mainRepo, checkout, workerScopeAuthority,
  homeDir = os.homedir() }) {
  if (typeof mainRepo !== "string" || typeof checkout !== "string" || workerScopeAuthority == null) {
    return null;
  }

  const loaded = loadReadiness(mainRepo);
  if (!loaded.ok && loaded.code === TEST_RUNTIME_READINESS_CODES.NOT_READY) return null;
  if (!loaded.ok && (loaded.code === TEST_RUNTIME_READINESS_CODES.PREPARING ||
      loaded.code === TEST_RUNTIME_READINESS_CODES.PREPARATION_FAILED)) {
    const environments = requiredPreparationEnvironments(loaded.record, workerScopeAuthority);
    if (environments.length === 0) return null;
    throw new WorkerTestRuntimePreparationError(loaded, { environments, repository: realpathSync(mainRepo) });
  }

  resolvePackageAssetExecutable(WORKER_TEST_RUNTIME_ENTRY_ASSET_DIR, "entry", (detail) => {
    throw Object.assign(new Error(`launcher test-runtime command entry is unavailable: ${detail.asset}`),
      { code: WORKER_TEST_RUNTIME_CODES.ENTRY_UNAVAILABLE, detail: { ...detail, authority_limb: "mechanical" } });
  });
  const mainReal = realpathSync(mainRepo);
  const checkoutReal = realpathSync(checkout);
  let homeReal = path.resolve(homeDir);
  try { homeReal = realpathSync(homeReal); } catch {   }
  const protectedRoots = { home: homeReal, repository: mainReal, checkout: checkoutReal };
  const files = {};
  const rows = [];
  const detailFile = (failure) => {
    const relative = `details/${Object.keys(files).filter((name) => name.startsWith("details/")).length}`;
    files[relative] = detailText(failure);
    return `${WORKER_TEST_RUNTIME_TABLE_MOUNT_DIR}/${relative}`;
  };
  let projects = [];
  let recordFailure = null;
  if (!loaded.ok) {

    recordFailure = readinessUnavailable(loaded, { repository: mainReal, checkout: checkoutReal });
    const detail = detailFile(recordFailure);
    for (const [toolchain, recipe] of Object.entries(TOOLCHAIN_RECIPES)) {
      for (const role of Object.keys(recipe.executables)) {
        rows.push([commandName(toolchain, role), "unavailable", "-", "-", detail, "-", "-"]);
      }
    }
  } else {
    const selection = selectedProjects(loaded.record, workerScopeAuthority);
    projects = selection.projects.map((entry, index) =>
      composeProject(entry, index, { mainReal, checkoutReal, scope: selection.scope, protectedRoots }));

    const toolchains = new Map();
    for (const project of projects) {
      if (project.failure) continue;
      for (const [name, toolchain] of Object.entries(project.runtime.toolchains)) toolchains.set(name, toolchain);
    }
    for (const [name, toolchain] of toolchains) {
      for (const role of Object.keys(TOOLCHAIN_RECIPES[name].executables)) {
        if (projectCommandOwners(name, role).length === 0) {
          rows.push([commandName(name, role), "toolchain", "-", toolchain.executables[role], "-", "-", "-"]);
        }
      }
    }

    const availableCommands = new Set(rows.filter(([, kind]) => kind === "toolchain").map(([name]) => name));
    for (const project of projects) {
      const ecosystem = DEPENDENCY_ECOSYSTEMS[project.ecosystem];

      const detail = project.failure === undefined ? null : detailFile(project.failure);
      if (project.failure !== undefined) {
        for (const toolchainName of ecosystem.toolchains) {
          for (const role of Object.keys(TOOLCHAIN_RECIPES[toolchainName].executables)) {
            const name = commandName(toolchainName, role);
            if (availableCommands.has(name) || Object.hasOwn(ecosystem.projectCommands, role)) continue;
            rows.push([name, "unavailable", project.projectDir, "-", detail, "-", "-"]);
          }
        }
      }
      for (const [role, fact] of Object.entries(ecosystem.projectCommands)) {
        const [toolchainName] = ecosystem.toolchains;
        const name = commandName(toolchainName, role);
        if (project.failure !== undefined) {
          rows.push([name, "unavailable", project.projectDir, "-", detail, "-", "-"]);
          continue;
        }
        const { runtime } = project;
        const executable = fact.executableValue ? runtime.values[fact.executableValue]
          : runtime.toolchains[toolchainName].executables[role];
        const env = { ...runtime.bindingEnv,
          ...(ecosystem.toolchainEnv ? ecosystem.toolchainEnv(runtime.toolchains) : {}) };
        const envFile = `env/${project.index}`;
        files[envFile] = envText(env);
        rows.push([name, "project", project.projectDir, executable,
          `${WORKER_TEST_RUNTIME_TABLE_MOUNT_DIR}/${envFile}`, "-",
          `${WORKER_TEST_RUNTIME_SCRATCH_ROOT}/${project.index}`]);
      }
    }
  }
  for (const row of rows) {
    if (row.some((field) => /[\t\n]/u.test(field))) {
      throw Object.assign(new Error("a worker runtime table field contains a tab or newline"),
        { code: WORKER_TEST_RUNTIME_CODES.PUBLICATION_FAILED, detail: { row } });
    }
  }
  files.table = rows.map((row) => `${row.join("\t")}\n`).join("");
  const commands = [...new Set(rows.map(([name]) => name))].sort();
  const publication = publishTable(mainReal, files, commands);
  const available = projects.filter((project) => !project.failure);
  const readOnlyBinds = [];
  const seen = new Set();
  const addBind = (src, dst) => {
    const key = `${src}\0${dst}`;
    if (!seen.has(key)) { seen.add(key); readOnlyBinds.push(Object.freeze({ src, dst })); }
  };
  const dependencyMounts = [];
  for (const { runtime, project, ecosystem } of available) {
    for (const { src } of runtime.toolchainBinds) addBind(src, src);
    for (const { src, dst } of runtime.dependencyBinds) {
      if (within(checkoutReal, dst)) {
        dependencyMounts.push(Object.freeze({ src, dst, project, ecosystem }));
      } else {
        addBind(src, dst);
      }
    }
  }
  addBind(publication.published, WORKER_TEST_RUNTIME_TABLE_MOUNT_DIR);
  addBind(WORKER_TEST_RUNTIME_ENTRY_ASSET_DIR, WORKER_TEST_RUNTIME_ENTRY_MOUNT_DIR);

  const sources = Object.freeze(readOnlyBinds.map(({ src, dst }) =>
    Object.freeze({ ...bindSourceIdentity(src), dst })));
  const projection = Object.freeze({
    schema_version: WORKER_TEST_RUNTIME_SCHEMA_VERSION,
    identity: Object.freeze({
      repository: mainReal,
      checkout: checkoutReal,
      unit_address: workerScopeAuthority.unit_address ?? null,
      selected_unit: workerScopeAuthority.selected_unit?.address ?? null,
      source_digest: workerScopeAuthority.source_digest ?? null,
      readiness_digest: loaded.ok ? loaded.record.readiness_digest : null,
      record_failure: recordFailure,
      table_digest: publication.digest,
      projects: projects.map((project) => Object.freeze({
        ecosystem: project.ecosystem, project: project.project, environment: project.environment,
        members: project.members, runners: project.runners,
        status: project.failure ? "unavailable" : "available",
        failure: project.failure ?? null,
        dependencies: project.runtime?.identity.dependencies ?? null,
        toolchains: project.runtime?.identity.toolchains ?? null
      }))
    }),
    commands: Object.freeze(commands),
    pathPrefix: `${WORKER_TEST_RUNTIME_TABLE_MOUNT_DIR}/bin`,
    readOnlyBinds: Object.freeze(readOnlyBinds),
    sources,
    dependencyMounts: Object.freeze(dependencyMounts),
    scratchRoot: WORKER_TEST_RUNTIME_SCRATCH_ROOT,
    publication: Object.freeze({ path: publication.published, identity: Object.freeze(publication.identity) })
  });
  composed.add(projection);
  return projection;
}
