import { summarizeRunStatusFinalResult } from "./dispatch-tool-helpers.mjs";
import { projectPublicFinalResult } from "./dispatch-final-result-projection.mjs";

export function projectRunFinalResultPublication(
  finalResult,
  { includeFullFinalResult }
) {
  if (!finalResult) return {};
  if (includeFullFinalResult) {
    return { final_result: projectPublicFinalResult(finalResult) };
  }
  return { final_result_summary: summarizeRunStatusFinalResult(finalResult) };
}
