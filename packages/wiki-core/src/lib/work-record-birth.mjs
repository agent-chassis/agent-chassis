
import { WORK_RECORD_SCHEMA_VERSION } from "./work-record-schema.mjs";

export function buildCreatedIssueWorkRecord({ id, title, date, repo }) {
  return {
    schema_version: WORK_RECORD_SCHEMA_VERSION,
    id,
    repo,
    title,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "inbox",
    priority: "medium",
    owner: "unassigned",
    created: date,
    updated: date,
    docs: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: null,
      target_unit: "none",
      requires_graph_impact: false,
      requires_escalation: false
    },

    acceptance: {
      criteria: [],
      validation: []
    },
    sections: {
      summary: "",
      why_it_matters: "",
      scope: {
        items: [],
        out_of_scope: []
      },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    migration: null,
    derived_evidence: []
  };
}
