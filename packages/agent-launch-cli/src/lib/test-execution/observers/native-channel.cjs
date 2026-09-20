"use strict";

const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_ENV = "LAUNCHER_TEST_PROOF_CONFIG";
const CONFIG_SCHEMA_VERSION = "launcher-test-proof-observer-config.v1";
const REACH_SYMBOL = Symbol.for("launcher.test-proof.reach");
const MAX_TEXT = 64 * 1024;

function loadConfig(configPath = process.env[CONFIG_ENV]) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config?.schema_version !== CONFIG_SCHEMA_VERSION) {
    throw new Error("unsupported launcher test-proof observer configuration");
  }
  return config;
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

const text = (value) => (typeof value === "string" ? value.slice(0, MAX_TEXT) : undefined);

function errorFacts(error, assertion) {
  if (error === null || error === undefined) return null;
  const facts = { assertion: assertion === true };
  if (typeof error === "object" || typeof error === "function") {
    for (const field of ["name", "message", "stack"]) {
      try {
        const value = text(error[field]);
        if (value !== undefined) facts[field] = value;
      } catch {   }
    }
    try {
      const code = error.code;
      if (typeof code === "string") facts.code = text(code);
    } catch {   }
  } else {
    facts.message = text(String(error));
  }
  return facts;
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
  errorFacts,
  installReachSink,
  loadConfig,
  repositoryPath,
  sameTitles
};
