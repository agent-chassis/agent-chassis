import { isObject } from "../operations/work-records-shared.mjs";

export const WORK_RECORD_TASK_ACTION_SCHEMA = Object.freeze({ oneOf: [
  { type: "object", additionalProperties: false, required: ["action", "value"],
    description: 'append_todo requires nonblank value and accepts no text/index selector.', properties: {
    action: { const: "append_todo" }, value: { type: "string", pattern: "\\S", description: "Supply nonblank task text." } } },
  ...["mark_done", "replace_text"].flatMap(action => ["text", "index"].map(selector => ({
    type: "object", additionalProperties: false, required: ["action", selector, ...(action === "replace_text" ? ["value"] : [])],
    description: `${action} requires exactly one of text or index${action === 'replace_text' ? ' and a replacement value (nonblank or explicitly empty)' : ' and accepts no value or status'}.`,
    properties: { action: { const: action }, [selector]: selector === "index" ? { type: "integer", minimum: 0 }
      : { type: "string", description: "Select the exact saved task text (surrounding whitespace is ignored)." },
      ...(action === "replace_text" ? { value: { type: "string", pattern: "^(?:$|[\\s\\S]*\\S[\\s\\S]*)$",
        description: "Supply nonblank replacement text or an explicit empty string; surrounding whitespace is trimmed." } } : {}) }
  }))) ] });

export function selectTaskBySelector({ tasks, text, index }) {
  if (text !== undefined && index !== undefined) {
    return {
      ok: false,
      issue: {
        code: "ambiguous_task_selector",
        message: "Select a task with exactly one of text or index, not both",
        path: "tasks"
      }
    };
  }

  if (text === undefined && index === undefined) {
    return {
      ok: false,
      issue: {
        code: "missing_task_selector",
        message: "Select a task with text (the saved task text) or index (its zero-based position)",
        path: "tasks"
      }
    };
  }

  if (!tasks) {
    return {
      ok: false,
      issue: {
        code: "missing_tasks",
        message: "selected unit has no tasks array",
        path: "sections.tasks"
      }
    };
  }

  if (index !== undefined) {
    const normalizedIndex = typeof index === "number" ? String(index) : String(index || "").trim();
    if (!/^(0|[1-9][0-9]*)$/.test(normalizedIndex)) {
      return {
        ok: false,
        issue: {
          code: "invalid_task_index",
          message: `Task index must be a zero-based integer: ${normalizedIndex}`,
          path: "index"
        }
      };
    }
    const numericIndex = Number(normalizedIndex);
    if (numericIndex < 0 || numericIndex >= tasks.length) {
      return {
        ok: false,
        issue: {
          code: "missing_task",
          message: `Task index ${numericIndex} does not exist`,
          path: "index"
        }
      };
    }
    return { ok: true, index: numericIndex };
  }

  const normalizedText = String(text || "").trim();
  const matches = tasks
    .map((task, taskIndex) => ({ task, taskIndex }))
    .filter(
      ({ task }) =>
        isObject(task) && typeof task.text === "string" && task.text.trim() === normalizedText
    );

  if (matches.length === 0) {
    return {
      ok: false,
      issue: {
        code: "missing_task",
        message: `No task matches text: ${normalizedText}`,
        path: "text"
      }
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      issue: {
        code: "ambiguous_task",
        message: `Multiple tasks match text: ${normalizedText}`,
        path: "text"
      }
    };
  }

  return { ok: true, index: matches[0].taskIndex };
}
