

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRASH_DURABLE_RESULTS,
  createSyncEffects,
  planReplacement,
  runCrashDurablePlanSync
} from "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";

import {
  attemptPartitionDir,
  canonicalJson,
  digestOf,
  isValidAttemptTuple,
  sameAttempt
} from "@agent-chassis/agent-launch-core";

import {
  captureProcessIdentity,
  defaultLivenessDeps
} from "./worktree-lease.mjs";
import { TypedRefusalError } from "./workspace-agent-dispatch-run-receipt-store-io.mjs";

export const LAUNCHER_SUPERVISOR_TERMINATION_SCHEMA_VERSION =
  "launcher-supervisor-termination.v1";

export const LAUNCHER_SUPERVISOR_BINDING_SCHEMA_VERSION =
  "launcher-supervisor-binding.v1";

export const SUPERVISOR_TERMINATION_OBSERVATIONS = Object.freeze({
  CHILD_EXITED: "child_exited",
  CHILD_SIGNALLED: "child_signalled",
  NO_CHILD: "no_child"
});

const OBSERVATION_VALUES = new Set(Object.values(SUPERVISOR_TERMINATION_OBSERVATIONS));

export const SUPERVISOR_AUTHENTICATION_REFUSALS = Object.freeze({
  ABSENT: "supervisor_termination.absent.v1",
  UNREADABLE: "supervisor_termination.unreadable.v1",
  UNKNOWN_SCHEMA_VERSION: "supervisor_termination.unknown_schema_version.v1",
  UNEXPECTED_KEYS: "supervisor_termination.unexpected_keys.v1",
  TOKEN_MISMATCH: "supervisor_termination.token_mismatch.v1",
  BINDING_MISMATCH: "supervisor_termination.binding_mismatch.v1",
  UNKNOWN_OBSERVATION: "supervisor_termination.unknown_observation.v1"
});

const TERMINATION_KEYS = Object.freeze([
  "schema_version",
  "repository",
  "subject",
  "attempt",
  "generation_digest",
  "wk_tip",
  "supervisor_identity",
  "spawn_token_proof",
  "sandbox_identity",
  "observation",
  "exit_code",
  "signal"
]);

const IDENTITY_KEYS = Object.freeze(["pid", "starttime", "boot_id"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isIdentity(value) {
  return hasExactKeys(value, IDENTITY_KEYS) &&
    Number.isInteger(value.pid) && value.pid > 0 &&
    typeof value.starttime === "string" && /^\d+$/.test(value.starttime) &&
    typeof value.boot_id === "string" && value.boot_id.length > 0;
}

export function supervisorResultSlotPath(mainRepo, repository, subject, attempt) {
  const key = createHash("sha256")
    .update(canonicalJson([LAUNCHER_SUPERVISOR_TERMINATION_SCHEMA_VERSION, attempt]))
    .digest("hex");
  return path.join(attemptPartitionDir(mainRepo, repository, subject), `supervisor-${key}.json`);
}

export function mintSpawnToken() {
  return randomBytes(32).toString("hex");
}

export function spawnTokenDigest(token) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function buildSupervisorBinding({
  repository,
  subject,
  attempt,
  mainRepo,
  supervisorIdentity,
  spawnToken
}) {
  if (!isValidAttemptTuple(attempt)) throw new Error("attempt must be a complete launcher-minted tuple");
  if (!isIdentity(supervisorIdentity)) throw new Error("supervisorIdentity must be a non-reusable process identity");
  if (typeof spawnToken !== "string" || spawnToken.length < 32) {
    throw new Error("spawnToken must be an unguessable launcher-minted secret");
  }
  return Object.freeze({
    schema_version: LAUNCHER_SUPERVISOR_BINDING_SCHEMA_VERSION,
    supervisor_identity: { ...supervisorIdentity },

    spawn_token_digest: spawnTokenDigest(spawnToken),
    result_slot: supervisorResultSlotPath(mainRepo, repository, subject, attempt)
  });
}

export function publishSupervisorTermination({
  slotPath,
  repository,
  subject,
  attempt,
  generationDigest,
  wkTip,
  supervisorIdentity,
  spawnToken,
  sandboxIdentity,
  observation,
  exitCode = null,
  signal = null
}) {
  if (!OBSERVATION_VALUES.has(observation)) {
    throw new TypeError(`unknown supervisor termination observation: ${JSON.stringify(observation)}`);
  }
  const record = {
    schema_version: LAUNCHER_SUPERVISOR_TERMINATION_SCHEMA_VERSION,
    repository,
    subject,
    attempt: {
      assigned_unit: attempt.assigned_unit,
      launch_ref: attempt.launch_ref,
      run_id: attempt.run_id,
      retry_id: attempt.retry_id
    },
    generation_digest: generationDigest,
    wk_tip: wkTip,
    supervisor_identity: { ...supervisorIdentity },

    spawn_token_proof: spawnToken,
    sandbox_identity: sandboxIdentity === null ? null : { ...sandboxIdentity },
    observation,
    exit_code: exitCode,
    signal
  };
  mkdirSync(path.dirname(slotPath), { recursive: true });
  const result = runCrashDurablePlanSync(
    planReplacement({
      targetPath: slotPath,
      privatePath: `${slotPath}.supervisor-${process.pid}.tmp`,
      bytes: `${JSON.stringify(record, null, 2)}\n`
    }),
    createSyncEffects({ mode: 0o600 })
  );
  if (result.classification !== CRASH_DURABLE_RESULTS.PUBLISHED) {
    throw new TypedRefusalError(
      "failed to durably publish the supervisor termination record",
      result.classification,
      result
    );
  }
  return Object.freeze(record);
}

export function authenticateSupervisorTermination({
  slotPath,
  repository,
  subject,
  attempt,
  generationDigest,
  wkTip,
  boundSupervisorIdentity,
  spawnTokenDigest: committedDigest
}) {
  const deny = (code, reason, detail = null) => Object.freeze({
    authenticated: false,
    refusal: Object.freeze({ code, reason, detail }),
    record: null
  });

  let body;
  try {
    body = readFileSync(slotPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.ABSENT, "no supervisor termination record is published for this attempt");
    }
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.UNREADABLE, "the supervisor termination record is unreadable", { errno: error?.code ?? null });
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.UNREADABLE, "the supervisor termination record is not valid JSON");
  }
  if (!hasExactKeys(parsed, TERMINATION_KEYS)) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.UNEXPECTED_KEYS, "the supervisor termination record does not carry exactly the closed key set");
  }
  if (parsed.schema_version !== LAUNCHER_SUPERVISOR_TERMINATION_SCHEMA_VERSION) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.UNKNOWN_SCHEMA_VERSION, "unknown supervisor termination schema version", { observed: parsed.schema_version });
  }
  if (!OBSERVATION_VALUES.has(parsed.observation)) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.UNKNOWN_OBSERVATION, "unknown supervisor termination observation", { observed: parsed.observation });
  }

  if (typeof parsed.spawn_token_proof !== "string" ||
      spawnTokenDigest(parsed.spawn_token_proof) !== committedDigest) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.TOKEN_MISMATCH, "the supervisor termination record does not prove the committed spawn token");
  }

  if (parsed.repository !== repository || parsed.subject !== subject) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.BINDING_MISMATCH, "the supervisor termination record names another repository or subject");
  }
  if (!isValidAttemptTuple(parsed.attempt) || !sameAttempt(parsed.attempt, attempt)) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.BINDING_MISMATCH, "the supervisor termination record names another attempt");
  }
  if (parsed.generation_digest !== generationDigest || parsed.wk_tip !== wkTip) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.BINDING_MISMATCH, "the supervisor termination record does not repeat the frozen generation and WK tip");
  }
  if (!isIdentity(parsed.supervisor_identity) ||
      parsed.supervisor_identity.pid !== boundSupervisorIdentity.pid ||
      parsed.supervisor_identity.starttime !== boundSupervisorIdentity.starttime ||
      parsed.supervisor_identity.boot_id !== boundSupervisorIdentity.boot_id) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.BINDING_MISMATCH, "the supervisor termination record was not published by the bound supervisor identity");
  }
  if (parsed.sandbox_identity !== null && !isIdentity(parsed.sandbox_identity)) {
    return deny(SUPERVISOR_AUTHENTICATION_REFUSALS.BINDING_MISMATCH, "the supervisor termination record carries a malformed sandbox identity");
  }
  return Object.freeze({
    authenticated: true,
    refusal: null,
    record: Object.freeze({ ...parsed })
  });
}

export const SUPERVISOR_MODULE_PATH = fileURLToPath(import.meta.url);

export function spawnAttemptSupervisor({
  mainRepo,
  repository,
  subject,
  attempt,
  generationDigest,
  wkTip,
  slotPath,
  spawnToken,
  command,
  args = [],
  nodeExecutable = process.execPath,
  spawnFn = spawn
}) {
  const child = spawnFn(nodeExecutable, [SUPERVISOR_MODULE_PATH], {
    stdio: ["ignore", "ignore", "inherit", "pipe"],
    detached: true,
    env: {
      ...process.env,

      AGENT_LAUNCH_SUPERVISOR_PLAN: JSON.stringify({
        main_repo: mainRepo,
        repository,
        subject,
        attempt,
        generation_digest: generationDigest,
        wk_tip: wkTip,
        slot_path: slotPath,
        command,
        args
      })
    }
  });

  if (child.stdio && child.stdio[3] && typeof child.stdio[3].write === "function") {
    child.stdio[3].write(spawnToken);
    child.stdio[3].end();
  }
  return child;
}

export async function runSupervisorChild({
  plan,
  spawnToken,
  spawnFn = spawn,
  deps = defaultLivenessDeps
} = {}) {
  const supervisorIdentity = captureProcessIdentity(process.pid, deps);
  const attempt = plan.attempt;
  let sandboxIdentity = null;
  let observation = SUPERVISOR_TERMINATION_OBSERVATIONS.NO_CHILD;
  let exitCode = null;
  let signal = null;

  if (typeof plan.command === "string" && plan.command.length > 0) {
    let child = null;
    try {
      child = spawnFn(plan.command, plan.args ?? [], { stdio: ["ignore", "ignore", "inherit"] });
    } catch {
      child = null;
    }
    if (child !== null && typeof child.pid === "number" && child.pid > 0) {
      try {
        sandboxIdentity = captureProcessIdentity(child.pid, deps);
      } catch {

        sandboxIdentity = null;
      }
      const outcome = await new Promise((resolve) => {
        child.once("exit", (code, sig) => resolve({ code, sig }));
        child.once("error", () => resolve({ code: null, sig: null }));
      });
      exitCode = outcome.code;
      signal = outcome.sig;
      observation = outcome.sig === null || outcome.sig === undefined
        ? SUPERVISOR_TERMINATION_OBSERVATIONS.CHILD_EXITED
        : SUPERVISOR_TERMINATION_OBSERVATIONS.CHILD_SIGNALLED;
    }
  }

  return publishSupervisorTermination({
    slotPath: plan.slot_path,
    repository: plan.repository,
    subject: plan.subject,
    attempt,
    generationDigest: plan.generation_digest,
    wkTip: plan.wk_tip,
    supervisorIdentity,
    spawnToken,
    sandboxIdentity,
    observation,
    exitCode,
    signal
  });
}

function readSpawnTokenFromPrivateDescriptor() {
  try {
    return readFileSync(3, "utf8").trim();
  } catch {
    return "";
  }
}

if (process.argv[1] === SUPERVISOR_MODULE_PATH) {
  const raw = process.env.AGENT_LAUNCH_SUPERVISOR_PLAN;
  if (typeof raw === "string" && raw.length > 0) {
    const plan = JSON.parse(raw);
    const spawnToken = readSpawnTokenFromPrivateDescriptor();
    runSupervisorChild({ plan, spawnToken })
      .then(() => { process.exit(0); })
      .catch(() => { process.exit(1); });
  } else {
    process.exit(2);
  }
}
