

import { isNonEmptyString, isObject } from "./work-record-dispatch-shared.mjs";
import {
  findSliceById,
  isSatisfiedLocalDependencyStatus,
  parseDependencyAddress
} from "./work-record-dispatch-dependencies.mjs";

const TERMINAL_NON_DONE_STATUSES = new Set(["cancelled", "superseded"]);

const STATE_READY = "ready";
const STATE_BLOCKED = "blocked";
const STATE_DONE = "done";

const MARKER_UNSATISFIED = "unsatisfied";
const MARKER_TERMINAL_PREDECESSOR = "terminal_predecessor";
const MARKER_MISSING_TARGET = "missing_target";
const MARKER_CROSS_RECORD_DEFERRED = "cross_record_deferred";

function emptyProjection() {
  return {
    slices: [],
    frontier: [],
    blocked: [],
    done: [],
    parallel_branch_sets: [],
    diagnostics: []
  };
}

function classifyEdge(record, rawAddress) {
  const address = isNonEmptyString(rawAddress) ? rawAddress.trim() : "";
  const parsed = parseDependencyAddress(address, record.id, {
    recordRepo: record.repo ?? null
  });

  const isIntraRecordSlice =
    parsed.kind === "local" &&
    parsed.record_id === record.id &&
    isNonEmptyString(parsed.slice_id);

  if (!isIntraRecordSlice) {

    return {
      slice_id: parsed.slice_id ?? null,
      selected_status: null,
      marker: MARKER_CROSS_RECORD_DEFERRED,
      address: address || String(rawAddress ?? "")
    };
  }

  const predecessor = findSliceById(record, parsed.slice_id);
  if (!predecessor) {
    return {
      slice_id: parsed.slice_id,
      selected_status: null,
      marker: MARKER_MISSING_TARGET,
      address
    };
  }

  const status = isNonEmptyString(predecessor.status) ? predecessor.status : null;
  if (isSatisfiedLocalDependencyStatus(status)) {
    return null;
  }

  return {
    slice_id: parsed.slice_id,
    selected_status: status,
    marker: TERMINAL_NON_DONE_STATUSES.has(status)
      ? MARKER_TERMINAL_PREDECESSOR
      : MARKER_UNSATISFIED,
    address
  };
}

function computeComponents(sliceIds, intraEdges) {
  const adjacency = new Map();
  for (const id of sliceIds) {
    adjacency.set(id, new Set());
  }
  for (const [from, to] of intraEdges) {
    if (adjacency.has(from) && adjacency.has(to)) {
      adjacency.get(from).add(to);
      adjacency.get(to).add(from);
    }
  }

  const component = new Map();
  let nextIndex = 0;
  for (const id of sliceIds) {
    if (component.has(id)) {
      continue;
    }
    const index = nextIndex++;
    const stack = [id];
    component.set(id, index);
    while (stack.length > 0) {
      const current = stack.pop();
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!component.has(neighbor)) {
          component.set(neighbor, index);
          stack.push(neighbor);
        }
      }
    }
  }
  return component;
}

function detectCycleMembers(sliceIds, directedEdges) {
  const successors = new Map();
  for (const id of sliceIds) {
    successors.set(id, new Set());
  }

  for (const [successor, predecessor] of directedEdges) {
    if (successors.has(successor) && successors.has(predecessor)) {
      successors.get(successor).add(predecessor);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(sliceIds.map((id) => [id, WHITE]));
  const cycleMembers = new Set();

  const visit = (start) => {

    const path = [];
    const onPath = new Set();
    const stack = [{ node: start, neighbors: [...successors.get(start)] }];
    color.set(start, GRAY);
    path.push(start);
    onPath.add(start);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.neighbors.length === 0) {
        color.set(frame.node, BLACK);
        onPath.delete(frame.node);
        path.pop();
        stack.pop();
        continue;
      }
      const next = frame.neighbors.shift();
      if (onPath.has(next)) {

        let mark = false;
        for (const node of path) {
          if (node === next) {
            mark = true;
          }
          if (mark) {
            cycleMembers.add(node);
          }
        }
        continue;
      }
      if (color.get(next) === WHITE) {
        color.set(next, GRAY);
        path.push(next);
        onPath.add(next);
        stack.push({ node: next, neighbors: [...successors.get(next)] });
      }
    }
  };

  for (const id of sliceIds) {
    if (color.get(id) === WHITE) {
      visit(id);
    }
  }
  return cycleMembers;
}

export function buildSliceDagProjection(record) {
  if (!isObject(record) || !Array.isArray(record.slices)) {
    return emptyProjection();
  }

  const diagnostics = [];
  const orderedSliceIds = [];
  const rawSlices = [];

  for (const slice of record.slices) {
    if (!isObject(slice) || !isNonEmptyString(slice.id)) {
      diagnostics.push({
        code: "invalid_slice",
        slice_id: null,
        message: "Encountered a slice entry without a valid string id; skipped."
      });
      continue;
    }
    if (orderedSliceIds.includes(slice.id)) {
      diagnostics.push({
        code: "duplicate_slice_id",
        slice_id: slice.id,
        message: `Duplicate slice id "${slice.id}"; the first occurrence wins.`
      });
      continue;
    }
    orderedSliceIds.push(slice.id);
    rawSlices.push(slice);
  }

  const intraEdges = [];
  const projectedSlices = [];
  const frontier = [];
  const blockedList = [];
  const doneList = [];

  for (const slice of rawSlices) {
    const dependsOn = (Array.isArray(slice.depends_on) ? slice.depends_on : []).filter(
      isNonEmptyString
    );
    const status = isNonEmptyString(slice.status) ? slice.status : null;
    const workKind = isNonEmptyString(slice.work_kind) ? slice.work_kind : null;

    const blockedBy = [];
    for (const address of dependsOn) {
      const entry = classifyEdge(record, address);
      const parsed = parseDependencyAddress(address, record.id, {
        recordRepo: record.repo ?? null
      });
      if (
        parsed.kind === "local" &&
        parsed.record_id === record.id &&
        isNonEmptyString(parsed.slice_id) &&
        findSliceById(record, parsed.slice_id)
      ) {
        intraEdges.push([slice.id, parsed.slice_id]);
      }
      if (entry) {
        blockedBy.push(entry);
        if (entry.marker === MARKER_MISSING_TARGET) {
          diagnostics.push({
            code: MARKER_MISSING_TARGET,
            slice_id: slice.id,
            message: `Slice "${slice.id}" depends on "${entry.address}", which is not a slice of this record.`
          });
        } else if (entry.marker === MARKER_TERMINAL_PREDECESSOR) {
          diagnostics.push({
            code: MARKER_TERMINAL_PREDECESSOR,
            slice_id: slice.id,
            message: `Slice "${slice.id}" is permanently blocked by "${entry.slice_id}" (status "${entry.selected_status}"); it can never satisfy the done-only gate.`
          });
        } else if (entry.marker === MARKER_CROSS_RECORD_DEFERRED) {
          diagnostics.push({
            code: MARKER_CROSS_RECORD_DEFERRED,
            slice_id: slice.id,
            message: `Slice "${slice.id}" has a cross-record dependency "${entry.address}"; kept off the frontier pending cross-record evidence resolution.`
          });
        }
      }
    }

    let state;
    let finalBlockedBy;
    if (isSatisfiedLocalDependencyStatus(status)) {
      state = STATE_DONE;
      finalBlockedBy = [];
      doneList.push(slice.id);
    } else if (blockedBy.length > 0) {
      state = STATE_BLOCKED;
      finalBlockedBy = blockedBy;
      blockedList.push(slice.id);
    } else {
      state = STATE_READY;
      finalBlockedBy = [];
      frontier.push(slice.id);
    }

    projectedSlices.push({
      slice_id: slice.id,
      status,
      work_kind: workKind,
      depends_on: dependsOn,
      state,
      blocked_by: finalBlockedBy,
      unsatisfied_edge_count: finalBlockedBy.length
    });
  }

  const cycleMembers = detectCycleMembers(orderedSliceIds, intraEdges);
  if (cycleMembers.size > 0) {
    diagnostics.push({
      code: "cycle",
      slice_id: null,
      message: `Intra-record dependency cycle detected among slices: ${[...cycleMembers]
        .sort()
        .join(", ")}. Members remain blocked; no ordering is possible.`
    });
  }

  const component = computeComponents(orderedSliceIds, intraEdges);
  const branchByComponent = new Map();
  for (const sliceId of frontier) {
    const index = component.get(sliceId);
    if (!branchByComponent.has(index)) {
      branchByComponent.set(index, []);
    }
    branchByComponent.get(index).push(sliceId);
  }
  const parallelBranchSets = [...branchByComponent.keys()]
    .sort((left, right) => left - right)
    .map((index) => branchByComponent.get(index));

  return {
    slices: projectedSlices,
    frontier,
    blocked: blockedList,
    done: doneList,
    parallel_branch_sets: parallelBranchSets,
    diagnostics
  };
}
