import { createHash } from "node:crypto";

import { canonicalJsonBytes } from "./deterministic-projection-primitives.mjs";

function profileDigest(profile) {
  return createHash("sha256").update(canonicalJsonBytes(profile)).digest("hex");
}

export { profileDigest };
