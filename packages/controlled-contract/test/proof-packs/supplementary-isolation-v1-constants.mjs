const GUARANTEE = "Within one exact captured attempt, one core computation settles one valid core result; one distinct supplementary computation then fails without producing a result; one final result follows, preserves the exact captured core value and complete core-member population, represents the supplementary component in exactly one closed present-unavailable or omitted-disclosed form, and discloses exactly one captured failure reason from the captured closed reason population.";

const EXCLUSIONS = Object.freeze([
  "acquisition-completeness-before-capture",
  "applicability-evidence-authority-and-cce-consequence",
  "concurrency-outside-declared-attempt",
  "core-computation-failure",
  "retries-or-later-attempts",
  "runtime-truth-outside-exact-capture",
  "semantic-reason-quality-beyond-closed-membership",
  "successful-supplementary-computation",
  "undeclared-effects-and-components"
]);

export { EXCLUSIONS, GUARANTEE };
