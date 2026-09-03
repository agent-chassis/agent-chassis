

import assert from "node:assert/strict";

export const FORGE_HANDOFF_TOOL = "workspace_wk_forge_handoff";

export function extractForgeHandoffGuidance(sourceText) {
  const blocks = String(sourceText ?? "")
    .split(/\n\s*\n/)
    .filter((block) => block.includes(FORGE_HANDOFF_TOOL));
  return { present: blocks.length > 0, blocks, text: blocks.join("\n\n") };
}

const anyOf = (...patterns) => (text) => patterns.some((pattern) => pattern.test(text));
const allOf = (...predicates) => (text) => predicates.every((predicate) => predicate(text));

export const REQUIRED_SEMANTICS = [
  {
    id: "sequenced-after-terminal-review",
    description: "handoff is the next action only after the exact terminal whole-WK review",
    holds: allOf(
      anyOf(/\bafter\b/, /\bonce\b/, /\bwhen\b/, /\bupon\b/, /\bfollowing\b/),
      anyOf(/\bterminal\b/, /whole[- ]wk/),
      anyOf(/\breview/)
    )
  },
  {
    id: "publishes-reviewed-candidate",
    description: "the tool publishes the already-reviewed candidate",
    scope: "clause",
    holds: allOf(
      anyOf(/\bpublish/, /\bhands off\b/, /\bhanded off\b/, /\bhand off\b/),
      anyOf(/already[- ]reviewed/, /reviewed candidate/, /reviewed commit/)
    )
  },
  {
    id: "publishes-byte-for-byte",
    description: "publication is byte-for-byte, not a re-derivation",
    holds: anyOf(/byte[- ]for[- ]byte/, /identical bytes/, /\bverbatim\b/, /\bunmodified\b/)
  },
  {
    id: "targets-configured-base",
    description: "the publication target is the configured base",
    holds: anyOf(/configured base/, /base branch/, /configured target/)
  },
  {
    id: "creates-or-observes-pull-request",
    description: "the tool creates the pull request or observes the existing one",
    scope: "clause",
    holds: allOf(
      anyOf(/\bcreat/),
      anyOf(/\bobserv/, /\breports? the existing/, /\breuses\b/),
      anyOf(/pull request/, /\bpr\b/)
    )
  }
];

export const FORBIDDEN_AUTHORITY = [
  {
    id: "merge-or-merge-observation",
    description: "merging, or observing merge state",
    trigger: /\bmerg(?:e|es|ed|ing)\b/
  },
  {
    id: "state-reconciliation",
    description: "reconciling repository, ref, or record state",
    trigger: /\breconcil\w*/
  },
  {
    id: "parent-wk-completion",
    description: "completing or closing the parent WK",
    trigger:
      /\b(?:complete|completes|completing|close|closes|closing|finish|finishes|finalize|finalizes)\s+(?:out\s+)?(?:the\s+)?(?:parent\s+|reviewed\s+)?[`'"*]*(?:wk|work[- ]record|unit)\b/
  },
  {
    id: "candidate-reconstruction",
    description: "reconstructing, rebuilding, or amending the candidate",
    trigger: /\b(?:reconstructs?|rebuilds?|re-?creates?|re-?derives?|regenerates?|amends?|rewrites?)\b/
  },
  {
    id: "caller-supplied-authority",
    description: "accepting caller-, prompt-, or environment-supplied candidate or forge authority",

    trigger:
      /\b(?:caller|prompt|environment|operator|ambient)[- ](?:supplied|provided|chosen|selected|specified)\b|\bfrom\s+(?:the\s+)?(?:caller|prompt|environment|ambient)\b/
  },
  {
    id: "shell-or-gh-route",
    description: "recommending shell or `gh` as an authority route",
    scope: "region",
    trigger: /\bgh\b|\bgit\s+push\b|\bshell\b|\bcommand[- ]line\b/
  }
];

const TOOL_REFERENCE = new RegExp(`${FORGE_HANDOFF_TOOL}|\\bit\\b|\\bthe tool\\b|\\bhandoff\\b|\\bthis capability\\b`);
const NEGATION = /\b(?:not|never|no|nor|neither|cannot|can't|without|outside|nothing)\b/;

const CLAUSE_SUBJECT =
  "(?:it|they|we|you|he|she|one|this|that|these|those|there|who|which|" +
  "the|a|an|its|their|our|your|his|her|any|each|every|some|no|another|both|either|neither|" +
  `${FORGE_HANDOFF_TOOL}|handoff|coordinator|operator|agent|caller|reviewer|worker|server|launcher)`;

const CLAUSE_BOUNDARY = new RegExp(
  ";|:|\\s+—\\s+|,?\\s+(?:so|but|however)\\s+" +
    `|,?\\s+and(?:\\s+(?:then|while|also|yet|afterwards))?\\s+(?=${CLAUSE_SUBJECT}\\b)`,
  "gi"
);

const POST_TRIGGER_DENIAL =
  /^[^,;:.]{0,48}?\b(?:is|are|was|were|remains?|stays?|becomes?|remain|being)\s+(?:\w+\s+){0,2}?(?:not|never|no|denied|forbidden|prohibited|disallowed|unsupported|excluded|barred|off[- ]limits)\b/;

function splitSentences(text) {

  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function splitClauses(sentence) {
  const clauses = [];
  let start = 0;
  for (const boundary of sentence.matchAll(CLAUSE_BOUNDARY)) {
    clauses.push(sentence.slice(start, boundary.index));
    start = boundary.index + boundary[0].length;
  }
  clauses.push(sentence.slice(start));
  return clauses.map((clause) => clause.trim()).filter(Boolean);
}

export function attributionUnits(regionText) {
  return splitSentences(regionText).flatMap((sentence) =>
    splitClauses(sentence).map((clause) => clause.toLowerCase())
  );
}

export const withoutSemantic = (semanticId) => (regionText) => {
  const semantic = REQUIRED_SEMANTICS.find((entry) => entry.id === semanticId);
  assert.ok(semantic, `unknown required semantic: ${semanticId}`);
  return splitSentences(regionText)
    .filter(
      (sentence) =>
        !splitClauses(sentence).some((clause) => semantic.holds(clause.toLowerCase()))
    )
    .join(" ");
};

export function evaluateForgeHandoffGuidance(sourceText) {
  const region = extractForgeHandoffGuidance(sourceText);

  const lowerRegion = region.text.replace(/\s+/g, " ").toLowerCase();
  const units = region.present ? attributionUnits(region.text) : [];
  const missing = REQUIRED_SEMANTICS.filter((semantic) => {
    if (!region.present) return true;
    return semantic.scope === "clause"
      ? !units.some((unit) => semantic.holds(unit))
      : !semantic.holds(lowerRegion);
  }).map(({ id, description }) => ({ id, description }));

  const violations = [];
  for (const sentence of splitSentences(region.text)) {
    const attributed = TOOL_REFERENCE.test(sentence.toLowerCase());
    for (const rule of FORBIDDEN_AUTHORITY) {
      if (rule.scope !== "region" && !attributed) continue;

      const claimed = splitClauses(sentence).some((rawClause) => {
        const clause = rawClause.toLowerCase();

        for (const match of clause.matchAll(new RegExp(rule.trigger, "g"))) {
          if (NEGATION.test(clause.slice(0, match.index))) continue;
          if (POST_TRIGGER_DENIAL.test(clause.slice(match.index + match[0].length))) continue;
          return true;
        }
        return false;
      });
      if (claimed) violations.push({ id: rule.id, description: rule.description, sentence });
    }
  }

  return { present: region.present, blocks: region.blocks, missing, violations };
}

export function assertForgeHandoffGuidance(sourceText, { surface = "guidance surface" } = {}) {
  const result = evaluateForgeHandoffGuidance(sourceText);
  assert.ok(
    result.present,
    `${surface} must name ${FORGE_HANDOFF_TOOL} as the post-terminal-review next action`
  );
  assert.deepEqual(
    result.missing.map((entry) => entry.id),
    [],
    `${surface} omits forge-handoff semantics: ${result.missing.map((entry) => entry.description).join("; ")}`
  );
  assert.deepEqual(
    result.violations.map((entry) => entry.id),
    [],
    `${surface} claims unsupported forge authority: ${result.violations
      .map((entry) => `${entry.description} -> "${entry.sentence}"`)
      .join("; ")}`
  );
  return result;
}
