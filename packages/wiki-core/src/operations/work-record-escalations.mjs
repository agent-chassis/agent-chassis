import path from "node:path";

import {
  acceptWorkRecordEscalation as acceptWorkRecordEscalationCore,
  authorWorkRecordEscalation as authorWorkRecordEscalationCore,
  proposeWorkRecordEscalation as proposeWorkRecordEscalationCore
} from "../lib/work-record-escalations.mjs";

export async function authorWorkRecordEscalation({ dir = ".", ...options } = {}) {
  return authorWorkRecordEscalationCore({
    dir: path.resolve(String(dir)),
    ...options
  });
}

export async function proposeWorkRecordEscalation({ dir = ".", ...options } = {}) {
  return proposeWorkRecordEscalationCore({
    dir: path.resolve(String(dir)),
    ...options
  });
}

export async function acceptWorkRecordEscalation({ dir = ".", ...options } = {}) {
  return acceptWorkRecordEscalationCore({
    dir: path.resolve(String(dir)),
    ...options
  });
}
