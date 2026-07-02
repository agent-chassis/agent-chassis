import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { rename } from "node:fs/promises";

import { ensureTokenKey, ensureTokenStateDirs, getTokenStateDir } from "./config.mjs";
import { readJson, writeJsonAtomic } from "./filesystem.mjs";

function signPayload(key, payload) {
  return createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
}

export async function mintReviewToken(reviewPayload) {
  const ensured = await ensureTokenStateDirs();
  if (!ensured.ok) {
    throw new Error(ensured.reason);
  }
  const key = await ensureTokenKey();
  const token = {
    payload: reviewPayload,
    mac: signPayload(key.trim(), reviewPayload)
  };
  const tokenPath = path.join(getTokenStateDir("pending"), `${reviewPayload.review_id}.token`);
  await writeJsonAtomic(tokenPath, token, { mode: 0o600 });
  return tokenPath;
}

export async function loadAndVerifyToken(reviewId, state = "pending") {
  const key = await ensureTokenKey();
  const tokenPath = path.join(getTokenStateDir(state), `${reviewId}.token`);
  const token = await readJson(tokenPath);
  const expected = signPayload(key.trim(), token.payload);
  if (!timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(String(token.mac), "utf8"))) {
    throw new Error("Invalid review token MAC");
  }
  if (Date.parse(token.payload.expires_at) <= Date.now()) {
    throw new Error("Review token has expired");
  }
  return { tokenPath, token };
}

export async function moveToken(reviewId, fromState, toState) {
  const fromPath = path.join(getTokenStateDir(fromState), `${reviewId}.token`);
  const toPath = path.join(getTokenStateDir(toState), `${reviewId}.token`);
  await rename(fromPath, toPath);
  return toPath;
}
