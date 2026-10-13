"use strict";

const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const vm = require("node:vm");

const { captureTestFailureDiagnostic, unavailableTestFailureDiagnostic } =
  require("../../workspace-agent-test-proof-diagnostic-graph.cjs");

const CONFIG_ENV = "LAUNCHER_TEST_PROOF_CONFIG";
const CONFIG_SCHEMA_VERSION = "launcher-test-proof-observer-config.v1";
const REACH_SYMBOL = Symbol.for("launcher.test-proof.reach");

function loadConfig(configPath = process.env[CONFIG_ENV]) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config?.schema_version !== CONFIG_SCHEMA_VERSION) {
    throw new Error("unsupported launcher test-proof observer configuration");
  }
  return config;
}

function selectedRunnerPackage(config) {
  if (typeof config?.runner_package !== "string" || !path.isAbsolute(config.runner_package)) {
    throw new Error("the launcher test-proof observer configuration names no selected runner package");
  }
  return { directory: config.runner_package, real: fs.realpathSync(config.runner_package),
    module: path.join(config.runner_package, "launcher-test-proof.cjs") };
}

function runnerRequire(config) {
  const selected = selectedRunnerPackage(config);
  const anchored = createRequire(selected.module);
  const resolve = (specifier) => {
    const resolved = anchored.resolve(specifier);
    const relative = path.relative(selected.real, fs.realpathSync(resolved));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`the selected runner package at ${selected.directory} does not supply ${specifier}; ` +
        `Node resolved it to another installation (${resolved}), which is not loaded`);
    }
    return resolved;
  };
  return Object.assign((specifier) => anchored(resolve(specifier)), { resolve });
}

function importRunnerModule(config, specifier) {
  return new vm.Script("(specifier) => import(specifier)", { filename: selectedRunnerPackage(config).module,
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInThisContext()(specifier);
}

function createChannel(config, role) {
  const source = `${role}.${process.pid}.${randomBytes(4).toString("hex")}`;
  let sequence = 0;
  return {
    source,
    emit(kind, fields = {}) {
      const line = `${JSON.stringify({ v: 1, nonce: config.nonce, src: source, seq: sequence,
        kind, ...fields })}\n`;
      fs.appendFileSync(config.channel, line);
      sequence += 1;
    }
  };
}

function repositoryPath(config, absolute) {
  let resolved = absolute;
  try { resolved = fs.realpathSync(absolute); } catch {   }
  const relative = path.relative(config.repository_root, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null
    : relative.split(path.sep).join("/");
}

function failureDiagnostic(error, native = {}) {
  try {
    return captureTestFailureDiagnostic(error, native);
  } catch {
    return unavailableTestFailureDiagnostic([{ path: "/error", reason: "source_value_unreadable" }],
      { origin: native.origin });
  }
}

function sameTitles(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((title, index) => title === right[index]);
}

function installReachSink(channel) {
  Object.defineProperty(globalThis, REACH_SYMBOL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: (token) => channel.emit("reach", { token: String(token).slice(0, 64) })
  });
}

module.exports = {
  CONFIG_ENV,
  createChannel,
  failureDiagnostic,
  importRunnerModule,
  installReachSink,
  loadConfig,
  repositoryPath,
  runnerRequire,
  sameTitles
};
