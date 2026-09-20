const PUBLIC_FINAL_RESULT_SCHEMA_VERSION = "workspace-agent-public-final-result.v1";

const CAPTURED_TEXT_SLOTS = Object.freeze([
  Object.freeze({
    member: "final_result.full_response.text",
    path: Object.freeze(["full_response", "text"])
  }),
  Object.freeze({
    member: "final_result.advisory_review.advisory_output.text",
    path: Object.freeze(["advisory_review", "advisory_output", "text"])
  }),
  Object.freeze({
    member: "final_result.findings.text",
    path: Object.freeze(["findings", "text"])
  }),
  Object.freeze({
    member: "final_result.no_findings.text",
    path: Object.freeze(["no_findings", "text"])
  })
]);

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOwnString(root, path) {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (!isObjectRecord(current) || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  const leaf = path.at(-1);
  if (!isObjectRecord(current) || !Object.hasOwn(current, leaf) ||
      typeof current[leaf] !== "string") {
    return null;
  }
  return current[leaf];
}

function analyzeCapturedText(finalResult) {
  const retainedMemberByText = new Map();
  let sourceTextCount = 0;
  const slots = CAPTURED_TEXT_SLOTS.map((slot) => {
    const text = readOwnString(finalResult, slot.path);
    if (text === null) return { ...slot, text: null, retainedMember: null };
    sourceTextCount += 1;
    const retainedMember = retainedMemberByText.get(text) ?? slot.member;
    if (!retainedMemberByText.has(text)) retainedMemberByText.set(text, slot.member);
    return { ...slot, text, retainedMember };
  });
  return {
    slots,
    sourceTextCount,
    distinctTextCount: retainedMemberByText.size
  };
}

function replaceTextWithReference(projected, path, retainedMember) {
  let current = projected;
  for (const segment of path.slice(0, -1)) {
    current[segment] = { ...current[segment] };
    current = current[segment];
  }
  delete current[path.at(-1)];
  current.text_reference = {
    member: retainedMember,
    reason: "duplicate_text"
  };
}

export function projectPublicFinalResult(finalResult) {
  if (!isObjectRecord(finalResult)) return finalResult;

  const analysis = analyzeCapturedText(finalResult);
  const projected = {
    ...finalResult,
    ...(Object.hasOwn(finalResult, "schema_version")
      ? { source_schema_version: finalResult.schema_version }
      : {}),
    schema_version: PUBLIC_FINAL_RESULT_SCHEMA_VERSION,
    text_projection: {
      source_text_count: analysis.sourceTextCount,
      distinct_text_count: analysis.distinctTextCount,
      omitted_text_count: analysis.sourceTextCount - analysis.distinctTextCount
    }
  };

  for (const slot of analysis.slots) {
    if (slot.text !== null && slot.retainedMember !== slot.member) {
      replaceTextWithReference(projected, slot.path, slot.retainedMember);
    }
  }
  return projected;
}

export function getPublicFinalResultTextMember(finalResult, member) {
  const requested = CAPTURED_TEXT_SLOTS.find((slot) => slot.member === member);
  if (!requested) throw new TypeError(`unknown final-result text member: ${member}`);
  const slot = analyzeCapturedText(finalResult).slots.find((entry) => entry.member === member);
  return slot?.retainedMember ?? null;
}
