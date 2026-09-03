import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { ControlledContractToolError } from "@agent-chassis/wiki-core";
import { createControlledContractRefusal } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs";

const TASK_CURSOR_TTL_MS = 30 * 60 * 1000;
const TASK_CURSOR_VERSION = "controlled-contract-task-cursor.v2";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}

function refuse(reason) {
  throw createControlledContractRefusal(new ControlledContractToolError(
    "controlled_contract_task_cursor_invalid",
    "controlled-contract task continuation is invalid or no longer current",
    { changed: false, reason }
  ), { operation: "controlled_contract_task_continuation" });
}

function decode(value) {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

export function createControlledContractTaskCursorCodec({
  now = () => Date.now(),
  random = randomBytes,
  ttlMs = TASK_CURSOR_TTL_MS
} = {}) {
  const key = random(32);

  function issue(payload) {
    const body = Buffer.from(JSON.stringify(canonical({
      ...payload,
      cursor_version: TASK_CURSOR_VERSION,
      expires_at: now() + ttlMs
    })), "utf8").toString("base64url");
    const mac = createHmac("sha256", key).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  function read(value) {
    const parts = typeof value === "string" ? value.split(".") : [];
    if (parts.length !== 2) refuse("malformed");
    const expected = createHmac("sha256", key).update(parts[0]).digest();
    const supplied = decode(parts[1]);
    if (supplied === null || supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)) refuse("integrity_check_failed");
    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch {
      refuse("payload_invalid");
    }
    if (!Number.isSafeInteger(payload.expires_at) || payload.expires_at <= now()) {
      refuse("expired");
    }
    if (payload.cursor_version !== TASK_CURSOR_VERSION) refuse("payload_invalid");
    return Object.freeze(payload);
  }

  return Object.freeze({ issue, read, refuse });
}

export { TASK_CURSOR_TTL_MS, TASK_CURSOR_VERSION };
