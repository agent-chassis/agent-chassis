# Dispatch after an assignment changes

`start_agent` starts the saved assignment under current launcher admission and
confinement. A saved edit grants no new attempt, source selection or authority to
reuse a retained checkout. See [launch and admission](mcp-dispatch-launch-and-admission.md).

After a previous worker has terminated, a separately authorized start can resume
uncommitted work when the existing lifecycle, topology, checkout and current-scope
checks permit it. Provisioning preserves staged, unstaged and untracked work. It
issues fresh authority for the current saved assignment; the previous binding and
frozen assignment remain historical. A saved change alone does not establish that
this route is available.

A retained commit outside the current WK tip is a different state. If its binding
no longer matches the saved record, dispatch preserves the stale-binding refusal,
names the affected record and changed scope field or saved record, and grants no
worker continuation. Internal source digests and identity-store bookkeeping are
not correction inputs. Older stale history does not hide an independently valid
current binding; the retained-delivery reconciliation gate still applies.

When historical identity, checkout association, ancestry and the attempt journal
establish the retained tip's recorded delivery, the refusal returns an exact
`get_run_result({subject, attempt_id})` call. The journal authenticates the attempt
against the historical binding; the stale binding never authorizes execution.
Observation supplies the authenticated delivery locator and its separate
`integrate_work` call. Missing or altered bindings do not select another attempt.

If integration is authorized, follow that delivery's returned call. Integration
authenticates its target, preserves the delivered implementation and applies its
own confinement, current scope and policy checks. After successful integration,
starting the original slice returns a bulk reader call for the same-WK root,
with `for_changes: ["ready_slices"]` on that read. Consume its ordered
`results` and use `contexts[root].revision` for the save. Follow that context's
schema call only when the authoring grammar is needed, then author a
follow-up slice preserving existing review, disposition, remediation and validation
requirements. Separately authorize its start. Its base includes the
integrated work. No old worktree or binding is blindly reused. See
[slice integration](mcp-dispatch-slice-integration.md).

This route does not require another review merely because review is available.
A separately authorized review remains inspection of its selected source; it
does not create delivery authority or authorize adoption, integration or another
worker. Observe its issued attempt and consume its result when that review is
the intended task. A retained read repeats no execution.

Without an authenticated delivery for the retained tip, there is no supported
work-transfer route. The refusal preserves the commit and dirty edits and stops;
a review cannot repair that missing authority. Unavailable journal evidence,
ambiguous delivery identities and changed checkout association
remain distinct from a journal that records no delivery. Repeating the unchanged
worker start does not repair stale authority. Dirty edits outside a delivered
commit are not silently transferred into the follow-up assignment.
