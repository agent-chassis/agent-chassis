

import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { goModuleCacheFromEnvironment } from "./runtime-inputs/ecosystem-inputs-go.mjs";
import { observeExecutable } from "./runtime-inputs/executable-lookup.mjs";

const SYSTEM_PATH = Object.freeze(["/usr/bin", "/bin"]);

export const SIDECAR_GO_TOOLCHAIN_UNAVAILABLE = "scip_go_toolchain_unavailable";

export async function describeSidecarGoToolchains({ projects, goFiles, env, run, timeoutMs }) {
  const selections = new Map();
  const subjects = projects.filter((project) => !project.refusal);
  if (subjects.length === 0) return selections;
  const go = observeExecutable({ command: "go", searchPath: env.PATH });
  if (go.status !== "found" ||
      observeExecutable({ command: "scip-go", searchPath: env.PATH }).status !== "found") return selections;
  const container = await mkdtemp(path.join(os.tmpdir(), "sidecar-go-toolchain-"));
  try {
    const tree = path.join(container, "tree");
    for (const [relative, text] of goFiles) {
      await mkdir(path.dirname(path.join(tree, relative)), { recursive: true });
      await writeFile(path.join(tree, relative), text);
    }
    const moduleCache = goModuleCacheFromEnvironment(env);
    for (const project of subjects) {
      const declaring = project.workspace ?? (project.project === "." ? "go.mod" : `${project.project}/go.mod`);
      const refuse = (reason) => selections.set(project.key, { refusal: { code: SIDECAR_GO_TOOLCHAIN_UNAVAILABLE,
        message: `the Go toolchain ${declaring} selects is not usable from what is installed: ${reason}; ` +
          "install the Go version it requires or put that Go first on PATH (no toolchain is downloaded)" } });
      let root;
      try {

        root = (await run({ executable: go.requested_path, args: ["env", "GOROOT"], captureStdout: true, timeoutMs,
          cwd: path.join(tree, project.project),
          env: { PATH: [path.dirname(go.requested_path), ...SYSTEM_PATH].join(path.delimiter),
            HOME: path.join(container, "home"), GOPATH: path.join(container, "gopath"),

            GOCACHE: path.join(container, "gocache"), GOPROXY: "off", GOENV: "off",
            GOTELEMETRY: "off", GOWORK: project.workspace ? path.join(tree, project.workspace) : "off",
            ...(moduleCache ? { GOMODCACHE: moduleCache } : {}),
            ...(typeof env.GOTOOLCHAIN === "string" && env.GOTOOLCHAIN !== "" ? { GOTOOLCHAIN: env.GOTOOLCHAIN } : {}) }
        })).toString("utf8").trim();
      } catch (error) {
        refuse(String(error?.message ?? error).slice(0, 500));
        continue;
      }
      let selected;
      try {
        selected = path.isAbsolute(root) ? realpathSync(path.join(root, "bin", "go")) : null;
      } catch {
        selected = null;
      }
      if (selected === null) {
        refuse(`${go.requested_path} named the toolchain root ${root || "<none>"}, which holds no bin/go`);
      } else if (selected !== go.resolved_path) {
        selections.set(project.key, { root: path.dirname(path.dirname(selected)) });
      }
    }
  } finally {

    await rm(container, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  return selections;
}
