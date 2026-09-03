const GUARANTEES = Object.freeze({
  boundary:
    "For one exact closed declared policy, one exact caller-supplied boundary observation " +
    "record whose provenance is caller_asserted, and one exact captured subject set, the " +
    "package-owned transformer measures every subject under the declared closed unit and " +
    "measurement-class lexicon, derives the complete N-1/N/N+1 census for every nonzero " +
    "limit and the exact N/N+1 census for a zero maximum, validates every recorded " +
    "disposition against the complete declared table, and emits complete populations, exact " +
    "counts, associations, and one canonical report bound to the exact source-set digest.",
  guidance:
    "For one exact closed declared policy and one exact raw UTF-8 guidance artifact, the " +
    "package-owned transformer associates every required policy key with exactly one plain " +
    "decimal value and exact unit token, refuses missing, duplicate, stale, conflicting, " +
    "substituted, wrong-unit, and unrelated-number guidance, and emits complete policy-key " +
    "and association populations, exact counts, associations, and one canonical report " +
    "bound to the exact source-set digest."
});

const COMMON = Object.freeze([
  "artifact-acquisition-completeness-before-exact-capture",
  "declared-policy-document-correspondence-to-enforced-limit-and-unit",
  "evidence-authority-applicability-authority-or-cce-consequences",
  "locally-redigested-or-unadmitted-profile-variants",
  "runtime-truth-or-production-enforcement",
  "shared-policy-identity-across-independently-assessed-packs"
]);
const EXCLUSIONS = Object.freeze({
  boundary: Object.freeze([
    ...COMMON,
    "boundary-consistency-does-not-entail-guidance-propagation",
    "caller-asserted-observation-execution-provenance",
    "captured-execution-transcript-provenance",
    "nonboundary-input-space-behavior"
  ].sort()),
  guidance: Object.freeze([
    ...COMMON,
    "additional-live-guidance-surfaces-beyond-the-one-captured-artifact",
    "guidance-propagation-does-not-entail-boundary-consistency",
    "non-plain-decimal-numeral-forms"
  ].sort())
});

export { EXCLUSIONS, GUARANTEES };
