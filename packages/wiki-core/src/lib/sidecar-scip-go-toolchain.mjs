

import { realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { goModuleCacheFromEnvironment } from "./runtime-inputs/ecosystem-inputs-go.mjs";
import { observeExecutable } from "./runtime-inputs/executable-lookup.mjs";

const SYSTEM_PATH = Object.freeze(["/usr/bin", "/bin"]);

export const SIDECAR_GO_TOOLCHAIN_UNAVAILABLE = "scip_go_toolchain_unavailable";

const ordinaryExit = error => error?.code === "scip_indexer_exit_failed" && error.exit?.code === 1 &&
  error.exit.signal === null;
const version = text => /^go(\d+)\.(\d+)(?:\.(\d+))?$/u.exec(text)?.slice(1).map(value => Number(value ?? 0)) ?? null;
const newer = (left, right) => left.some((value, index) => value > right[index] &&
  left.slice(0, index).every((part, prior) => part === right[prior]));

async function missingSelectedToolchain({ run, request, project, moduleCache, searchPath }) {
  const local = { ...request, env: { ...request.env, GOTOOLCHAIN: "local" } };
  const facts = JSON.parse((await run({ ...local, args: ["env", "-json", "GOVERSION", "GOOS", "GOARCH"] })).toString("utf8"));
  if (!version(facts.GOVERSION) || !/^[a-z0-9]+$/u.test(facts.GOOS) || !/^[a-z0-9]+$/u.test(facts.GOARCH)) {
    throw Object.assign(new Error("local Go returned invalid toolchain facts"), { code: "scip_go_toolchain_output_invalid" });
  }
  const config = JSON.parse((await run({ ...local, args: project.workspace ? ["work", "edit", "-json"]
    : ["mod", "edit", "-json"] })).toString("utf8"));
  const setting = request.env.GOTOOLCHAIN ?? "auto";
  const explicit = setting !== "auto" && setting !== "path";
  if (explicit && !/^go\d+\.\d+(?:\.\d+)?(?:\+(?:auto|path))?$/u.test(setting)) return null;
  let selected = setting.split("+")[0];
  if (selected === "auto" || selected === "path") selected = facts.GOVERSION;
  if (!version(selected)) return null;
  if (setting === "auto" || setting === "path" || setting.endsWith("+auto") || setting.endsWith("+path")) {
    for (const required of [config.Go ? `go${config.Go}` : null, config.Toolchain]) {
      if (required && version(required) && newer(version(required), version(selected))) selected = required;
    }
  }
  const required = version(selected);
  if (!required || (explicit ? required.every((part, index) => part === version(facts.GOVERSION)[index])
    : !newer(required, version(facts.GOVERSION)))) return null;
  if (explicit && required[1] >= 21 && setting.split("+")[0].split(".").length === 2) return null;

  if (required[1] >= 21 && selected.split(".").length === 2) selected += ".0";
  const candidates = [observeExecutable({ command: selected, searchPath })];
  if (moduleCache) candidates.push(observeExecutable({ executable: path.join(moduleCache,
    `golang.org/toolchain@v0.0.1-${selected}.${facts.GOOS}-${facts.GOARCH}`, "bin", "go") }));
  const failed = candidates.find(candidate => candidate.status === "failed");
  if (failed) throw Object.assign(new Error(failed.message), { code: failed.code, cause: failed.cause });
  return candidates.every(candidate => candidate.status === "absent") ? selected : null;
}

export async function describeSidecarGoToolchains({ projects, checkoutRoot, privateRoot, env, run, timeoutMs }) {
  const selections = new Map();
  const subjects = projects.filter((project) => !project.refusal);
  if (subjects.length === 0) return selections;
  const go = observeExecutable({ command: "go", searchPath: env.PATH });
  if (go.status !== "found" ||
      observeExecutable({ command: "scip-go", searchPath: env.PATH }).status !== "found") return selections;
  const container = path.join(privateRoot, "go-toolchain");
  await mkdir(container, { recursive: true });
  try {
    const moduleCache = goModuleCacheFromEnvironment(env);
    for (const project of subjects) {
      const declaring = project.workspace ?? (project.project === "." ? "go.mod" : `${project.project}/go.mod`);
      const refuse = (cause) => selections.set(project.key, { refusal: {
        code: cause.code ?? "scip_go_toolchain_probe_failed",
        message: `Go toolchain observation for ${declaring} failed: ${cause.message ?? cause}` } });
      let root;
      const request = { executable: go.requested_path, args: ["env", "GOROOT"], captureStdout: true, timeoutMs,
        cwd: path.join(checkoutRoot, project.project),
        env: { PATH: [path.dirname(go.requested_path), ...SYSTEM_PATH].join(path.delimiter),
          HOME: path.join(container, "home"), GOPATH: path.join(container, "gopath"),
          GOCACHE: path.join(container, "gocache"), GOPROXY: "off", GOENV: "off", GOTELEMETRY: "off",
          GOWORK: project.workspace ? path.join(checkoutRoot, project.workspace) : "off",
          ...(moduleCache ? { GOMODCACHE: moduleCache } : {}),
          ...(typeof env.GOTOOLCHAIN === "string" && env.GOTOOLCHAIN !== "" ? { GOTOOLCHAIN: env.GOTOOLCHAIN } : {}) } };
      try {

        root = (await run(request)).toString("utf8").trim();
      } catch (error) {
        if (!ordinaryExit(error)) { refuse(error); continue; }
        try {
          const missing = await missingSelectedToolchain({ run, request, project, moduleCache, searchPath: env.PATH });
          if (missing) {
            const message = `${declaring} requires unavailable Go toolchain ${missing}: ${error.message}; ` +
              "install that toolchain and explicitly build again (no toolchain is downloaded)";
            selections.set(project.key, { configuration_unavailable: {
              dependency_limitation: { code: SIDECAR_GO_TOOLCHAIN_UNAVAILABLE, message }, provider_failure: error.message } });
          } else refuse(error);
        } catch (secondary) {
          refuse({ code: secondary.code ?? "scip_go_toolchain_output_invalid",
            message: `${error.message.slice(0, 170)}; availability probe also failed: ${secondary.message.slice(0, 170)}` });
        }
        continue;
      }
      let selected;
      try {
        selected = path.isAbsolute(root) ? realpathSync(path.join(root, "bin", "go")) : null;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") { refuse(error); continue; }
        selected = null;
      }
      if (selected === null) {
        refuse({ code: "scip_go_toolchain_output_invalid",
          message: `${go.requested_path} named the toolchain root ${root || "<none>"}, which holds no bin/go` });
      } else if (observeExecutable({ executable: selected }).status !== "found") {
        const observed = observeExecutable({ executable: selected });
        refuse({ code: observed.code, message: observed.message });
      } else if (selected !== go.resolved_path) {
        selections.set(project.key, { root: path.dirname(path.dirname(selected)) });
      }
    }
  } finally {

    await rm(container, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  return selections;
}
