

export const DEPENDENCY_LOCATION_ENVIRONMENT = Object.freeze({
  deno: Object.freeze(["DENO_DIR", "XDG_CACHE_HOME"]),
  go_modules: Object.freeze(["GOPATH", "GOMODCACHE", "GOENV", "XDG_CONFIG_HOME"]),
  cargo: Object.freeze(["CARGO_HOME"])
});

export const DEPENDENCY_LOCATION_ENVIRONMENT_NAMES = Object.freeze(
  [...new Set(Object.values(DEPENDENCY_LOCATION_ENVIRONMENT).flat())]);

export const TOOLCHAIN_SELECTION_ENVIRONMENT = Object.freeze({
  rust: Object.freeze(["RUSTUP_HOME", "RUSTUP_TOOLCHAIN"]),
  go: Object.freeze(["GOTOOLCHAIN"])
});

export const HOST_SERVER_RUNTIME_ENVIRONMENT_NAMES = Object.freeze([...new Set([
  ...DEPENDENCY_LOCATION_ENVIRONMENT_NAMES, ...Object.values(TOOLCHAIN_SELECTION_ENVIRONMENT).flat()])]);

function project(env, names) {
  const projected = {};
  for (const name of names) {
    if (typeof env?.[name] === "string") projected[name] = env[name];
  }
  return Object.freeze(projected);
}

export function projectDependencyLocationEnvironment(env, ecosystem = null) {
  return project(env, ecosystem === null ? DEPENDENCY_LOCATION_ENVIRONMENT_NAMES
    : DEPENDENCY_LOCATION_ENVIRONMENT[ecosystem] ?? []);
}

export function projectHostServerRuntimeEnvironment(env) {
  return project(env, HOST_SERVER_RUNTIME_ENVIRONMENT_NAMES);
}
