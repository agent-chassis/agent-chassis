const GUARANTEE =
  "For one exact captured target, observation attempt, complete declared source and " +
  "raw-observation populations, and interval, every valid observation is authenticated " +
  "and directly grounded to its exact target, source of record, attempt, observation " +
  "position, and raw observation; declared and observed source coverage is complete; " +
  "every source outcome has one stable endpoint pair; every valid observation fails to " +
  "match the target; the invalidating-condition population is exactly empty; and the " +
  "same exact projection derives the sole absent conclusion.";

const EXCLUSIONS = Object.freeze([
  "authenticated-presence-proof",
  "copied-transformed-or-derived-provenance",
  "correctness-or-completeness-of-pre-capture-source-discovery",
  "cross-pack-occurrence-joins",
  "evidence-authority-applicability-authority-or-cce-consequences",
  "evidenced-unavailability-proof",
  "external-pki-or-legal-identity",
  "runtime-or-post-capture-truth",
  "undeclared-sources-observations-conditions-or-mutations"
]);

export {
  EXCLUSIONS,
  GUARANTEE
};
