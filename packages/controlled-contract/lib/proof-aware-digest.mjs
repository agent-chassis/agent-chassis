import { createHash } from "node:crypto";

function compareCodeUnits(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) throw new TypeError(
        "proof-aware canonical JSON rejects unpaired Unicode surrogates"
      );
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError(
      "proof-aware canonical JSON rejects unpaired Unicode surrogates"
    );
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) assertUnicodeScalarString(key);
    return Object.fromEntries(Object.keys(value).sort(compareCodeUnits).map(
      (key) => [key, canonicalValue(value[key])]
    ));
  }
  if (typeof value === "string") assertUnicodeScalarString(value);
  if (typeof value === "number" && (!Number.isFinite(value) || !Number.isSafeInteger(value) && Number.isInteger(value))) {
    throw new TypeError("proof-aware canonical JSON requires finite JSON-safe numbers");
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalJsonBytes(value) {
  const json = JSON.stringify(canonicalValue(value));
  if (json === undefined) throw new TypeError("proof-aware canonical JSON value is not serializable");
  return Buffer.from(json, "utf8");
}

function domainSeparatedDigest(domain, value) {
  if (typeof domain !== "string" || domain.length === 0 || domain.includes("\0")) {
    throw new TypeError("proof-aware digest domain must be a nonempty string without NUL");
  }
  return createHash("sha256")
    .update(Buffer.from(domain, "utf8"))
    .update(Buffer.from([0]))
    .update(canonicalJsonBytes(value))
    .digest("hex");
}

function commitment(domain, value) {
  const bytes = canonicalJsonBytes(value);
  return Object.freeze({
    domain,
    digest: createHash("sha256")
      .update(Buffer.from(domain, "utf8"))
      .update(Buffer.from([0]))
      .update(bytes)
      .digest("hex"),
    canonical_bytes: bytes.byteLength
  });
}

export {
  canonicalJsonBytes,
  canonicalValue,
  commitment,
  compareCodeUnits,
  domainSeparatedDigest
};
