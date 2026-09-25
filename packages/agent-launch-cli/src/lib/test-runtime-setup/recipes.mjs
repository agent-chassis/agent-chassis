

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export function currentPlatformKey({ platform = process.platform, arch = process.arch } = {}) {
  return `${platform}-${arch}`;
}

function firstLine(file) {
  return readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#")) ?? null;
}

export const TOOLCHAIN_RECIPES = Object.freeze({
  node: Object.freeze({
    name: "node",
    pins: Object.freeze([
      Object.freeze({ file: ".nvmrc", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null }),
      Object.freeze({ file: ".node-version", read: (file) => firstLine(file)?.replace(/^v/u, "") ?? null })
    ]),
    host_command: "node",
    hostRoot: (executable) => path.dirname(path.dirname(executable)),
    executables: Object.freeze({ node: "bin/node" }),
    population: Object.freeze(["bin/node"]),
    probe: Object.freeze({ executable: "node", args: Object.freeze(["--version"]),
      version: (text) => /^v(\d+\.\d+\.\d+)\s*$/u.exec(text)?.[1] ?? null })
  }),
  python: Object.freeze({
    name: "python",
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
    pins: Object.freeze([

      Object.freeze({ file: "go.mod", read: (file) =>
        /^toolchain\s+go(\d+\.\d+\.\d+)\s*$/mu.exec(readFileSync(file, "utf8"))?.[1] ?? null })
    ]),
    host_command: "go",
    hostRoot: (executable) => path.dirname(path.dirname(executable)),

    executables: Object.freeze({ go: "bin/go", gofmt: "bin/gofmt" }),
    population: Object.freeze(["."]),
    probe: Object.freeze({ executable: "go", args: Object.freeze(["version"]),
      version: (text) => /^go version go(\d+\.\d+\.\d+) /u.exec(text)?.[1] ?? null })
  }),
  rust: Object.freeze({
    name: "rust",
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

const VERSION_REQUIREMENT = /^\d+(?:\.\d+){0,2}$/u;

export function isVersionRequirement(value) {
  return typeof value === "string" && VERSION_REQUIREMENT.test(value);
}

export function versionSatisfies(requirement, version) {
  return version === requirement || (typeof version === "string" && version.startsWith(`${requirement}.`));
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
