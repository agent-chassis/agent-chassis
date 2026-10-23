import { parse } from "smol-toml";

export const SIDECAR_BUILD_HEAP_DEFAULT_MIB = 8192;
export const SIDECAR_RUNTIME_CONFIG_KEY = "code_index.build_heap_mib";

export class SidecarRuntimeConfigError extends Error {
  constructor(code, { file, cause, correction, location }) {
    super(`${file}: ${SIDECAR_RUNTIME_CONFIG_KEY}: ${cause}. ${correction}`);
    this.name = "SidecarRuntimeConfigError";
    this.code = code;
    this.details = Object.freeze({ file, key: SIDECAR_RUNTIME_CONFIG_KEY, cause, correction,
      location: location ?? null });
  }
}

export function sidecarBuildHeapMaximumMiB(nativeWordBits =
  (["ia32", "arm", "mips", "mipsel", "ppc"].includes(process.arch) ? 32 : 64)) {
  if (nativeWordBits !== 32 && nativeWordBits !== 64) {
    throw new TypeError("sidecar native word width must be 32 or 64");
  }
  const nativeMaximum = ((1n << BigInt(nativeWordBits)) - 1n) / 1048576n;
  return Number(nativeMaximum < BigInt(Number.MAX_SAFE_INTEGER)
    ? nativeMaximum : BigInt(Number.MAX_SAFE_INTEGER));
}

export function parseSidecarRuntimeConfig(source, { file = "agent-launch.toml", nativeWordBits } = {}) {
  const maximum = sidecarBuildHeapMaximumMiB(nativeWordBits);
  const correction = `Set ${SIDECAR_RUNTIME_CONFIG_KEY} to a TOML integer from 1 through ${maximum} in ${file}, then commit that file and retry the requesting operation.`;
  const fail = (code, cause, location) => {
    throw new SidecarRuntimeConfigError(code, { file, cause, correction, location });
  };
  let config = {};
  if (source !== null) {
    try {
      config = parse(source, { integersAsBigInt: true });
    } catch (error) {

      fail("sidecar_config_malformed_toml", error.message.split("\n")[0],
        { line: error.line, column: error.column });
    }
  }
  if (Object.hasOwn(config, "code_index") &&
      (config.code_index === null || typeof config.code_index !== "object" ||
        Array.isArray(config.code_index) || config.code_index instanceof Date)) {
    fail("sidecar_config_invalid_type", "code_index must be a TOML table");
  }
  const value = config.code_index && Object.hasOwn(config.code_index, "build_heap_mib")
    ? config.code_index.build_heap_mib : BigInt(SIDECAR_BUILD_HEAP_DEFAULT_MIB);
  if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
    fail("sidecar_config_fractional", "the heap ceiling is fractional");
  }
  if (typeof value !== "bigint") {
    fail("sidecar_config_invalid_type", "the heap ceiling must be a TOML integer, including when a float is numerically integral");
  }
  if (value <= 0n) fail("sidecar_config_nonpositive", "the heap ceiling must be positive");
  if (value > BigInt(maximum)) {
    fail("sidecar_config_out_of_range", `the heap ceiling exceeds the safe native byte-conversion maximum ${maximum} MiB`);
  }
  return Object.freeze({ buildHeapMiB: Number(value) });
}
