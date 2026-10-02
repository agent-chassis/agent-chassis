
import path from "node:path";

export const TOOLCHAIN_DESCRIPTIONS = Object.freeze({
  node: Object.freeze({
    name: "node",
    host_command: "node",
    hostRoot: (executable) => path.dirname(path.dirname(executable)),
    executables: Object.freeze({ node: "bin/node" }),
    population: Object.freeze(["bin/node"]),
    probe: Object.freeze({ executable: "node", args: Object.freeze(["--version"]),
      version: (text) => /^v(\d+\.\d+\.\d+)\s*$/u.exec(text)?.[1] ?? null })
  }),
  python: Object.freeze({
    name: "python",
    host_command: "python3",
    executables: Object.freeze({ python: "bin/python3" }),
    probe: Object.freeze({ executable: "python", args: Object.freeze(["--version"]),
      version: (text) => /^Python (\d+\.\d+\.\d+)\s*$/u.exec(text)?.[1] ?? null })
  }),
  go: Object.freeze({
    name: "go",
    host_command: "go",
    hostRoot: (executable) => path.dirname(path.dirname(executable)),
    executables: Object.freeze({ go: "bin/go", gofmt: "bin/gofmt" }),
    population: Object.freeze(["."]),
    probe: Object.freeze({ executable: "go", args: Object.freeze(["version"]),
      version: (text) => /^go version go(\d+\.\d+\.\d+) /u.exec(text)?.[1] ?? null })
  }),
  rust: Object.freeze({
    name: "rust",
    host_command: "rustc",

    host_root_probe: Object.freeze(["--print", "sysroot"]),
    executables: Object.freeze({ cargo: "bin/cargo", rustc: "bin/rustc" }),
    population: Object.freeze(["."]),
    probe: Object.freeze({ executable: "cargo", args: Object.freeze(["--version"]),
      version: (text) => /^cargo (\d+\.\d+\.\d+)[ -]/u.exec(text)?.[1] ?? null })
  }),
  deno: Object.freeze({
    name: "deno",
    host_command: "deno",
    hostRoot: (executable) => path.dirname(executable),
    executables: Object.freeze({ deno: "deno" }),
    population: Object.freeze(["deno"]),
    probe: Object.freeze({ executable: "deno", args: Object.freeze(["--version"]),
      version: (text) => /^deno (\d+\.\d+\.\d+) /u.exec(text)?.[1] ?? null })
  })
});
