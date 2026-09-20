

import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { processDiagnostic, runSetupProcess } from "./process.mjs";
import { TestRuntimeSetupError } from "./toolchains.mjs";

export const ATTEMPT_SCRATCH_ROOT = "/agent-validation-tmp";

function fail(code, message, detail = {}) {
  throw new TestRuntimeSetupError(code, message, detail);
}

const SYSTEM_PATH = ["/usr/bin", "/bin"];

function pathWith(...directories) {
  return [...directories, ...SYSTEM_PATH].join(path.delimiter);
}

function requireSuccess(result, code, message) {
  if (!result.ok) fail(code, message, { diagnostic: processDiagnostic(result),
    exit_code: result.code, spawn_error: result.spawn_error ?? null });
}

export function makeTreeReadOnly(root) {
  const visit = (target) => {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) for (const name of readdirSync(target)) visit(path.join(target, name));
    chmodSync(target, stat.mode & ~0o222);
  };
  visit(root);
}

export function makeTreeWritable(root) {
  if (!existsSync(root)) return;
  const visit = (target) => {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) return;
    chmodSync(target, stat.mode | 0o200);
    if (stat.isDirectory()) for (const name of readdirSync(target)) visit(path.join(target, name));
  };
  visit(root);
}

function packageDeclaresDependencies(file) {
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
      .some((field) => manifest[field] && Object.keys(manifest[field]).length > 0);
  } catch {
    fail("test_runtime_manifest_invalid", `${file} is not valid JSON`, { manifest: file });
  }
}

const PYTHON_REQUIREMENT_FILES = Object.freeze(
  ["requirements.txt", "test-requirements.txt", "requirements-dev.txt"]);

export const DEPENDENCY_ECOSYSTEMS = Object.freeze({
  npm: Object.freeze({
    name: "npm",
    toolchains: Object.freeze(["node"]),

    manifests(projectDir) {
      const manifest = path.join(projectDir, "package.json");
      if (!existsSync(manifest)) return { status: "none", files: {} };
      const lock = path.join(projectDir, "package-lock.json");
      if (!packageDeclaresDependencies(manifest)) {
        return { status: "none", files: { "package.json": manifest } };
      }
      if (!existsSync(lock)) return { status: "lock_missing", required: "package-lock.json" };
      return { status: "present", files: { "package.json": manifest, "package-lock.json": lock } };
    },
    async prepare({ projectDir, outputDir, stagingDir, toolchains, stateRoot }) {
      for (const name of ["package.json", "package-lock.json"]) {
        copyFileSync(path.join(projectDir, name), path.join(stagingDir, name));
      }
      const node = toolchains.node;
      const result = await runSetupProcess(node.executables.node, [
        node.setup_executables.npm_cli, "ci", "--ignore-scripts", "--no-audit", "--no-fund",
        "--loglevel=error"
      ], { cwd: stagingDir, env: {
        PATH: pathWith(path.dirname(node.executables.node)),
        HOME: path.join(stagingDir, ".home"),
        npm_config_cache: path.join(stateRoot, "cache", "npm"),
        npm_config_update_notifier: "false"
      } });
      requireSuccess(result, "test_runtime_dependency_install_failed", "npm ci failed");
      const installed = path.join(stagingDir, "node_modules");
      if (!existsSync(installed)) mkdirSync(installed);
      cpSync(installed, path.join(outputDir, "node_modules"), { recursive: true, verbatimSymlinks: true });
      return { population: ["node_modules"] };
    },
    runtimeBinding({ preparedDir, projectHostDir }) {
      return {
        binds: [{ src: path.join(preparedDir, "node_modules"), dst: path.join(projectHostDir, "node_modules") }],
        mountpoints: [path.join(projectHostDir, "node_modules")],
        links: [],
        env: {},
        values: { node_modules_source: path.join(preparedDir, "node_modules"),
          node_modules: path.join(projectHostDir, "node_modules") }
      };
    },

    workingCopyBinding({ preparedDir, workProjectDir }) {
      const prepared = path.join(preparedDir, "node_modules");
      return {
        binds: [{ src: prepared, dst: prepared }],
        mountpoints: [],
        links: [{ path: path.join(workProjectDir, "node_modules"), target: prepared }],
        env: {},
        values: { node_modules_source: prepared, node_modules: prepared }
      };
    }
  }),
  deno: Object.freeze({
    name: "deno",
    toolchains: Object.freeze(["deno"]),
    manifests(projectDir) {
      const config = ["deno.json", "deno.jsonc"].find((name) => existsSync(path.join(projectDir, name)));
      if (!config) return { status: "none", files: {} };
      const lock = path.join(projectDir, "deno.lock");
      if (!existsSync(lock)) return { status: "lock_missing", required: "deno.lock" };
      return { status: "present", files: { [config]: path.join(projectDir, config), "deno.lock": lock } };
    },
    async prepare({ projectDir, outputDir, stagingDir, toolchains }) {
      const denoDir = path.join(outputDir, "deno_dir");
      const project = path.join(stagingDir, "project");
      cpSync(projectDir, project, { recursive: true, verbatimSymlinks: true,
        filter: (source) => !["node_modules", ".git"].includes(path.basename(source)) });
      const result = await runSetupProcess(toolchains.deno.executables.deno, ["install", "--frozen"], {
        cwd: project,
        env: { PATH: pathWith(), HOME: path.join(stagingDir, ".home"), DENO_DIR: denoDir,
          DENO_NO_UPDATE_CHECK: "1", NO_COLOR: "1" }
      });
      requireSuccess(result, "test_runtime_dependency_install_failed", "deno install --frozen failed");
      mkdirSync(denoDir, { recursive: true });
      return { population: ["deno_dir"] };
    },
    runtimeBinding({ preparedDir }) {
      const denoDir = path.join(preparedDir, "deno_dir");
      return {
        binds: [{ src: denoDir, dst: denoDir }],
        mountpoints: [],
        links: [],
        env: { DENO_DIR: denoDir, DENO_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
        values: { deno_dir: denoDir }
      };
    }
  }),
  python: Object.freeze({
    name: "python",
    toolchains: Object.freeze(["python"]),
    manifests(projectDir) {
      const files = Object.fromEntries(PYTHON_REQUIREMENT_FILES
        .filter((name) => existsSync(path.join(projectDir, name)))
        .map((name) => [name, path.join(projectDir, name)]));
      return Object.keys(files).length === 0
        ? { status: "lock_missing", required: PYTHON_REQUIREMENT_FILES.join(" or ") }
        : { status: "present", files };
    },
    async prepare({ outputDir, stagingDir, toolchains, manifestFiles, stateRoot, env }) {
      const uv = env.uvExecutable;
      if (!uv) fail("test_runtime_installer_unavailable",
        "preparing a Python environment requires the uv installer on PATH", { installer: "uv" });
      const venv = path.join(outputDir, "venv");
      const common = { PATH: pathWith(), HOME: path.join(stagingDir, ".home"),
        UV_CACHE_DIR: path.join(stateRoot, "cache", "uv"), UV_NO_CONFIG: "1",
        UV_PYTHON_DOWNLOADS: "never" };
      const created = await runSetupProcess(uv, ["venv", "--relocatable", "--no-project",
        "--python", toolchains.python.executables.python, venv], { env: common });
      requireSuccess(created, "test_runtime_dependency_install_failed", "uv venv failed");
      const installed = await runSetupProcess(uv, ["pip", "install", "--python",
        path.join(venv, "bin", "python"), "--no-config",
        ...Object.values(manifestFiles).flatMap((file) => ["-r", file])], { env: common });
      requireSuccess(installed, "test_runtime_dependency_install_failed", "uv pip install failed");
      return { population: ["venv"], exclude: ["__pycache__"] };
    },
    runtimeBinding({ preparedDir }) {
      const venv = path.join(preparedDir, "venv");
      return {
        binds: [{ src: venv, dst: venv }],
        mountpoints: [],
        links: [],
        env: { PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
        values: { python: path.join(venv, "bin", "python"), venv }
      };
    }
  }),
  go_modules: Object.freeze({
    name: "go_modules",
    toolchains: Object.freeze(["go"]),
    manifests(projectDir) {
      const mod = path.join(projectDir, "go.mod");
      if (!existsSync(mod)) return { status: "lock_missing", required: "go.mod" };
      const sum = path.join(projectDir, "go.sum");
      return { status: "present",
        files: { "go.mod": mod, ...(existsSync(sum) ? { "go.sum": sum } : {}) } };
    },
    async prepare({ outputDir, stagingDir, toolchains, manifestFiles }) {
      for (const [name, file] of Object.entries(manifestFiles)) {
        copyFileSync(file, path.join(stagingDir, name));
      }
      const go = toolchains.go.executables.go;
      const result = await runSetupProcess(go, ["mod", "download", "all"], { cwd: stagingDir, env: {
        PATH: pathWith(path.dirname(go)), HOME: path.join(stagingDir, ".home"),
        GOMODCACHE: path.join(outputDir, "gomodcache"), GOPATH: path.join(stagingDir, "gopath"),
        GOCACHE: path.join(stagingDir, "gocache"), GOFLAGS: "-modcacherw -mod=readonly",
        GOTOOLCHAIN: "local", GOTELEMETRY: "off", GOENV: "off"
      } });
      requireSuccess(result, "test_runtime_dependency_install_failed", "go mod download failed");
      mkdirSync(path.join(outputDir, "gomodcache"), { recursive: true });
      return { population: ["gomodcache"] };
    },
    runtimeBinding({ preparedDir, scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
      const cache = path.join(preparedDir, "gomodcache");
      return {
        binds: [{ src: cache, dst: cache }],
        mountpoints: [],
        links: [],
        env: { GOMODCACHE: cache, GOPROXY: "off", GOFLAGS: "-mod=readonly",
          GOTOOLCHAIN: "local", GOTELEMETRY: "off", GOENV: "off", GOSUMDB: "off", GOWORK: "off",
          GOCACHE: `${scratchRoot}/go-build`, GOPATH: `${scratchRoot}/gopath` },
        values: {}
      };
    }
  }),
  cargo: Object.freeze({
    name: "cargo",
    toolchains: Object.freeze(["rust"]),
    manifests(projectDir) {
      const manifest = path.join(projectDir, "Cargo.toml");
      if (!existsSync(manifest)) return { status: "lock_missing", required: "Cargo.toml" };
      const lock = path.join(projectDir, "Cargo.lock");
      if (!existsSync(lock)) return { status: "lock_missing", required: "Cargo.lock" };
      return { status: "present", files: { "Cargo.toml": manifest, "Cargo.lock": lock } };
    },
    async prepare({ projectDir, outputDir, stagingDir, toolchains }) {
      const project = path.join(stagingDir, "project");
      cpSync(projectDir, project, { recursive: true, verbatimSymlinks: true,
        filter: (source) => !["target", ".git"].includes(path.basename(source)) });
      const rust = toolchains.rust;
      const vendor = path.join(outputDir, "vendor");
      const result = await runSetupProcess(rust.executables.cargo, ["vendor", "--locked",
        "--versioned-dirs", vendor], { cwd: project, env: {
        PATH: pathWith(path.dirname(rust.executables.cargo)), HOME: path.join(stagingDir, ".home"),
        RUSTC: rust.executables.rustc, CARGO_HOME: path.join(stagingDir, "cargo-home"),
        CARGO_TARGET_DIR: path.join(stagingDir, "target")
      } });
      requireSuccess(result, "test_runtime_dependency_install_failed", "cargo vendor failed");
      mkdirSync(vendor, { recursive: true });
      return { population: ["vendor"] };
    },
    runtimeBinding({ preparedDir, scratchRoot = ATTEMPT_SCRATCH_ROOT }) {
      const vendor = path.join(preparedDir, "vendor");
      return {
        binds: [{ src: vendor, dst: vendor }],
        mountpoints: [],
        links: [],
        env: { CARGO_HOME: `${scratchRoot}/cargo-home`,
          CARGO_TARGET_DIR: `${scratchRoot}/cargo-target`, CARGO_NET_OFFLINE: "true",
          CARGO_TERM_COLOR: "never" },
        values: { cargo_source_args: ["--config", "source.crates-io.replace-with=\"agent-vendored\"",
          "--config", `source.agent-vendored.directory=${JSON.stringify(vendor)}`] }
      };
    }
  })
});
