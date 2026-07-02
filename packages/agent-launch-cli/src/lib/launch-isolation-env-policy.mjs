

import {
  LAUNCHER_PAID_NODE_ENGINE_KEY_ENV_KEYS,
  LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY
} from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  fail,
  isNonEmptyString
} from "./launch-isolation-errors.mjs";

export const DEFAULT_BWRAP_ENV_SECRET_DENY_NAME_PATTERNS = Object.freeze([
  /(^|_)TOKENS?($|_)/i,
  /(^|_)SECRETS?($|_)/i,
  /(^|_)PASSWORD?S?($|_)/i,
  /(^|_)PASSWD($|_)/i,
  /(^|_)APIKEY($|_)/i,
  /(^|_)API_KEY($|_)/i,
  /(^|_)ACCESS_?KEY($|_)/i,
  /(^|_)PRIVATE_?KEY($|_)/i,
  /(^|_)SESSION_?TOKEN($|_)/i,
  /(^|_)REFRESH_?TOKEN($|_)/i,
  /(^|_)AUTH_?TOKEN($|_)/i,
  /(^|_)CREDENTIALS?($|_)/i,
  /(^|_)KEY($|_)/i
]);

export const DEFAULT_BWRAP_ENV_SECRET_DENY_NAMES = Object.freeze([
  ...LAUNCHER_PAID_NODE_ENGINE_KEY_ENV_KEYS,
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SESSION_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "HF_TOKEN",
  "SLACK_TOKEN",
  "CLOUDSDK_AUTH_ACCESS_TOKEN"
]);

export const DEFAULT_BWRAP_ENV_POSTURE_DENY_NAMES = Object.freeze([
  ...LAUNCHER_PAID_NODE_ENGINE_KEY_ENV_KEYS,
  LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY
]);

export const DEFAULT_BWRAP_ENV_BEHAVIOR_AFFECTING_DENY_NAMES = Object.freeze([
  LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY,
  "NODE_OPTIONS",
  "NODE_PATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "node_options",
  "node_path",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy"
]);

function isSecretEnvKey(key) {
  if (DEFAULT_BWRAP_ENV_SECRET_DENY_NAMES.includes(key)) return true;
  for (const pattern of DEFAULT_BWRAP_ENV_SECRET_DENY_NAME_PATTERNS) {
    if (pattern.test(key)) return true;
  }
  return false;
}

function isPostureEnvKey(key) {
  return DEFAULT_BWRAP_ENV_POSTURE_DENY_NAMES.includes(key);
}

function isBehaviorAffectingEnvKey(key) {
  return DEFAULT_BWRAP_ENV_BEHAVIOR_AFFECTING_DENY_NAMES.includes(key);
}

export function applyBwrapEnvPolicy(env, envPolicy = null) {
  if (typeof env !== "object" || env === null || Array.isArray(env)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_INVALID,
      "applyBwrapEnvPolicy requires a plain object of string env values"
    );
  }
  let allowSet = null;
  if (envPolicy !== null && envPolicy !== undefined) {
    if (typeof envPolicy !== "object" || Array.isArray(envPolicy)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_POLICY_INVALID,
        "envPolicy must be a plain object with an optional { allow: string[] }"
      );
    }
    for (const key of Object.keys(envPolicy)) {
      if (key !== "allow") {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_POLICY_INVALID,
          `envPolicy has unknown key: ${key} (only "allow" is supported)`
        );
      }
    }
    if (envPolicy.allow !== undefined && envPolicy.allow !== null) {
      if (!Array.isArray(envPolicy.allow)) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_POLICY_INVALID,
          "envPolicy.allow must be an array of non-empty string keys"
        );
      }
      allowSet = new Set();
      for (const entry of envPolicy.allow) {
        if (!isNonEmptyString(entry)) {
          fail(
            BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_POLICY_INVALID,
            "envPolicy.allow entries must be non-empty strings"
          );
        }
        allowSet.add(entry);
      }
    }
  }
  const out = {};
  const dropped = new Set();
  for (const [key, value] of Object.entries(env)) {
    if (allowSet !== null && !allowSet.has(key)) {
      dropped.add(key);
      continue;
    }
    if (
      isSecretEnvKey(key)
      || isPostureEnvKey(key)
      || isBehaviorAffectingEnvKey(key)
    ) {
      dropped.add(key);
      continue;
    }
    out[key] = value;
  }
  return { env: out, droppedKeys: [...dropped].sort() };
}
