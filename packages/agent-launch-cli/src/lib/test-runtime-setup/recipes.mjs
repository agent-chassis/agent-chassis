

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const TEST_RUNTIME_RECIPES_VERSION = "agent-launch-test-runtime-recipes.v1";

export function currentPlatformKey({ platform = process.platform, arch = process.arch } = {}) {
  return `${platform}-${arch}`;
}

function firstLine(file) {
  return readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#")) ?? null;
}

const RUST_TARGET = "x86_64-unknown-linux-gnu";

export const TOOLCHAIN_RECIPES = Object.freeze({
  node: Object.freeze({
    name: "node",
    baseline: "24.20.0",
    versions: Object.freeze({
      "24.20.0": Object.freeze({
        "linux-x64": Object.freeze({
          installer: "archive",
          url: "https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz",
          sha256: "2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2",
          format: "tar.xz",
          strip_components: 1
        })
      })
    }),
    pins: Object.freeze([
      Object.freeze({ file: ".nvmrc", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null }),
      Object.freeze({ file: ".node-version", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null })
    ]),
    host_command: "node",
    hostRoot: (executable) => path.dirname(path.dirname(executable)),
    executables: Object.freeze({ node: "bin/node" }),
    setup_executables: Object.freeze({ npm_cli: "lib/node_modules/npm/bin/npm-cli.js" }),
    population: Object.freeze(["bin/node"]),
    probe: Object.freeze({ executable: "node", args: Object.freeze(["--version"]),
      version: (text) => /^v(\d+\.\d+\.\d+)\s*$/u.exec(text)?.[1] ?? null })
  }),
  python: Object.freeze({
    name: "python",
    baseline: "3.12.3",

    versionPattern: /^3\.(?:1[0-4])\.\d+$/u,
    installerFor: (version) => Object.freeze({ installer: "uv_python", version }),
    pins: Object.freeze([
      Object.freeze({ file: ".python-version", read: (file) => firstLine(file) })
    ]),
    host_command: "python3",
    executables: Object.freeze({ python: "bin/python3" }),
    probe: Object.freeze({ executable: "python", args: Object.freeze(["--version"]),
      version: (text) => /^Python (\d+\.\d+\.\d+)\s*$/u.exec(text)?.[1] ?? null })
  }),
  go: Object.freeze({
    name: "go",
    baseline: "1.27.1",
    versions: Object.freeze({
      "1.27.1": Object.freeze({
        "linux-x64": Object.freeze({
          installer: "archive",
          url: "https://go.dev/dl/go1.27.1.linux-amd64.tar.gz",
          sha256: "63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445",
          format: "tar.gz",
          strip_components: 1
        })
      }),
      "1.26.8": Object.freeze({
        "linux-x64": Object.freeze({
          installer: "archive",
          url: "https://go.dev/dl/go1.26.8.linux-amd64.tar.gz",
          sha256: "d0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b",
          format: "tar.gz",
          strip_components: 1
        })
      })
    }),
    pins: Object.freeze([

      Object.freeze({ file: "go.mod", read: (file) =>
        /^toolchain\s+go(\d+\.\d+\.\d+)\s*$/mu.exec(readFileSync(file, "utf8"))?.[1] ?? null })
    ]),
    host_command: "go",
    hostRoot: (executable) => path.dirname(path.dirname(executable)),
    executables: Object.freeze({ go: "bin/go" }),
    population: Object.freeze(["."]),
    probe: Object.freeze({ executable: "go", args: Object.freeze(["version"]),
      version: (text) => /^go version go(\d+\.\d+\.\d+) /u.exec(text)?.[1] ?? null })
  }),
  rust: Object.freeze({
    name: "rust",
    baseline: "1.98.1",
    versions: Object.freeze({
      "1.98.1": Object.freeze({
        "linux-x64": Object.freeze({
          installer: "rustup",
          url: "https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-unknown-linux-gnu/rustup-init",
          sha256: "dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71",
          target: RUST_TARGET
        })
      })
    }),
    pins: Object.freeze([
      Object.freeze({ file: "rust-toolchain.toml", read: (file) =>
        /^\s*channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/mu.exec(readFileSync(file, "utf8"))?.[1] ?? null }),
      Object.freeze({ file: "rust-toolchain", read: (file) => firstLine(file) })
    ]),
    host_command: "rustc",

    host_root_probe: Object.freeze(["--print", "sysroot"]),
    executables: Object.freeze({ cargo: "bin/cargo", rustc: "bin/rustc" }),
    population: Object.freeze(["."]),
    native_prerequisites: Object.freeze(["cc"]),
    probe: Object.freeze({ executable: "cargo", args: Object.freeze(["--version"]),
      version: (text) => /^cargo (\d+\.\d+\.\d+)[ -]/u.exec(text)?.[1] ?? null })
  }),
  deno: Object.freeze({
    name: "deno",
    baseline: "2.9.6",
    versions: Object.freeze({
      "2.9.6": Object.freeze({
        "linux-x64": Object.freeze({
          installer: "archive",
          url: "https://dl.deno.land/release/v2.9.6/deno-x86_64-unknown-linux-gnu.zip",
          sha256: "394f07f4da2bebe6ce6f1e7ce0fa16429b29b08c35e3fac3fe25972676dff4b2",
          format: "zip",
          strip_components: 0
        })
      })
    }),
    pins: Object.freeze([
      Object.freeze({ file: ".dvmrc", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null })
    ]),
    host_command: "deno",
    hostRoot: (executable) => path.dirname(executable),
    executables: Object.freeze({ deno: "deno" }),
    population: Object.freeze(["deno"]),
    probe: Object.freeze({ executable: "deno", args: Object.freeze(["--version"]),
      version: (text) => /^deno (\d+\.\d+\.\d+) /u.exec(text)?.[1] ?? null })
  })
});

export const TOOLCHAIN_NAMES = Object.freeze(Object.keys(TOOLCHAIN_RECIPES));

export function toolchainArtifact(recipe, version, platformKey) {
  if (recipe.installerFor) {
    return recipe.versionPattern.test(version) && platformKey === "linux-x64"
      ? recipe.installerFor(version) : null;
  }
  return recipe.versions[version]?.[platformKey] ?? null;
}

export function isSupportedToolchainVersion(recipe, version) {
  return recipe.installerFor ? recipe.versionPattern.test(version)
    : Object.hasOwn(recipe.versions, version);
}

export function readProjectToolchainPins(recipe, projectDir) {
  const pins = [];
  for (const pin of recipe.pins) {
    const file = path.join(projectDir, pin.file);
    if (!existsSync(file)) continue;
    const version = pin.read(file);
    if (version !== null) pins.push(Object.freeze({ file: pin.file, version }));
  }
  return pins;
}
