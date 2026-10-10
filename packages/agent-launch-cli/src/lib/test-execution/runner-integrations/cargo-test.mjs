

import path from "node:path";

import { DEPENDENCY_ECOSYSTEMS } from "../../test-runtime-setup/ecosystems.mjs";
import { RunnerIntegrationPreconditionError } from "./common.mjs";

function toolchainEnv(runtime) {
  return DEPENDENCY_ECOSYSTEMS.cargo.toolchainEnv({ rust: { executables: runtime.executables } });
}

const LIBRARY_KINDS = new Set(["lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"]);

export default Object.freeze({
  runner_id: "runner.cargo-test",

  setupProbe: ({ runtime, projectDir }) => ({ command: runtime.executables.cargo,
    args: ["metadata", "--frozen", "--format-version", "1"], cwd: projectDir,
    env: toolchainEnv(runtime) }),

  ordinaryInvocation: async ({ runtime, projectDir, absoluteFile, selector, metadata, proof = null }) => {
    const env = toolchainEnv(runtime);
    const listed = await metadata({ command: runtime.executables.cargo,
      args: ["metadata", "--frozen", "--no-deps", "--format-version", "1"], cwd: projectDir, env });
    let packages;
    try {
      packages = JSON.parse(listed.stdout).packages;
    } catch (error) {
      throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unresolved",
        `cargo metadata did not print its JSON metadata: ${error.message}`, { reason: "metadata_unreadable" });
    }

    const declared = (pkg, target) => path.dirname(pkg.manifest_path) === projectDir &&
      (proof.target.kind === "lib" ? target.kind.some((name) => LIBRARY_KINDS.has(name))
        : target.kind.includes("test") && target.name === proof.target.name);
    const roots = packages.flatMap((pkg) => pkg.targets.filter((target) => proof === null
      ? target.src_path === absoluteFile : declared(pkg, target)).map((target) => ({ pkg, target })));
    if (roots.length !== 1) {
      throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unsupported",
        roots.length === 0 ? `${absoluteFile} is not the crate root of any Cargo target`
          : `${absoluteFile} is the crate root of ${roots.length} Cargo targets`,
        { reason: roots.length === 0 ? "cargo_file_not_target_root" : "cargo_file_ambiguous_target",
          targets: roots.map(({ pkg, target }) => ({ package: pkg.name, name: target.name, kind: target.kind })) });
    }
    const [{ pkg, target }] = roots;
    const kind = target.kind.some((name) => LIBRARY_KINDS.has(name)) ? "lib"
      : ["test", "bin", "example", "bench"].find((name) => target.kind.includes(name)) ?? null;
    if (kind === null) {
      throw new RunnerIntegrationPreconditionError("ordinary_test_selection_unsupported",
        `cargo test cannot select a ${target.kind.join("/")} target`,
        { reason: "cargo_target_kind_unsupported", package: pkg.name, name: target.name, kind: target.kind });
    }
    return {
      harness: Object.freeze({ kind: "cargo_test" }),
      selection: Object.freeze({ package: `${pkg.name}@${pkg.version}`, target: target.name, target_kind: kind }),
      invocation: { command: runtime.executables.cargo,
        args: ["test", "--frozen", "--color", "never", ...(proof === null ? [] : ["--message-format=json"]),
          "--package", `${pkg.name}@${pkg.version}`,
          ...(kind === "lib" ? ["--lib"] : [`--${kind}`, target.name]),
          ...(proof !== null ? ["--", "--exact", proof.exactName, "--test-threads", "1"]
            : selector === null ? [] : ["--", selector])],
        cwd: projectDir, env }
    };
  }
});

