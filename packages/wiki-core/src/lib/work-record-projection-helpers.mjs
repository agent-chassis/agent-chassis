import { Buffer } from "node:buffer"

const TRACKER_SLICE_DETAIL_SUPPRESSED_STATUS_SET = new Set([
  "done",
  "cancelled",
  "parked"
])

export const TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES = Object.freeze([
  ...TRACKER_SLICE_DETAIL_SUPPRESSED_STATUS_SET
])

export function shouldSuppressTrackerSliceDetailForStatus(status) {
  return (
    typeof status === "string" &&
    TRACKER_SLICE_DETAIL_SUPPRESSED_STATUS_SET.has(status)
  )
}

export function shouldSuppressTrackerSliceDetail(slice) {
  return shouldSuppressTrackerSliceDetailForStatus(slice?.status)
}

function agentNotesByteLength(agentNotes) {
  if (typeof agentNotes === "string") {
    return agentNotes.length === 0 ? 0 : Buffer.byteLength(agentNotes, "utf8")
  }

  if (!Array.isArray(agentNotes) || agentNotes.length === 0) {
    return 0
  }

  if (!agentNotes.every((entry) => typeof entry === "string")) {
    return 0
  }

  const noteText = agentNotes.join("\n")
  return noteText.length === 0 ? 0 : Buffer.byteLength(noteText, "utf8")
}

export function calculateSliceAgentNotesBytes(slice) {
  return agentNotesByteLength(slice?.sections?.agent_notes)
}
