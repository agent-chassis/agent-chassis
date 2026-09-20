import { isObject } from "../operations/work-records-shared.mjs";

export function selectTaskBySelector({ tasks, text, index }) {
  if (text !== undefined && index !== undefined) {
    return {
      ok: false,
      issue: {
        code: "ambiguous_task_selector",
        message: "set-task accepts --text or --index, not both",
        path: "tasks"
      }
    };
  }

  if (text === undefined && index === undefined) {
    return {
      ok: false,
      issue: {
        code: "missing_task_selector",
        message: "set-task requires --text <task text> or --index <n>",
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
