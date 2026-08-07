

export function createFrozenReviewContextStores() {
  const frozenReviewContextsByTarget = new Map();
  const currentReviewTargetBySubject = new Map();
  const currentTerminalReviewTargetByWk = new Map();
  const wholeReviewTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.candidate_sha ?? context.wk_sha,
    context.base_sha ?? context.diff_base_sha,
    context.canonical_wk_digest ?? null
  ]);
  const frozenReviewContexts = Object.freeze({
    get(subject) {
      const key = currentReviewTargetBySubject.get(subject);
      return key === undefined ? undefined : frozenReviewContextsByTarget.get(key);
    },
    set(subject, context) {
      const key = wholeReviewTargetKey(context);
      frozenReviewContextsByTarget.set(key, context);
      currentReviewTargetBySubject.set(subject, key);
      if (context.review_identity_kind === "terminal_candidate" &&
          typeof context.record_id === "string") {
        currentTerminalReviewTargetByWk.set(context.record_id, key);
      }
      return this;
    },
    has(subject) { return this.get(subject) !== undefined; },
    values() { return frozenReviewContextsByTarget.values(); }
  });

  const frozenSliceReviewContextsByTarget = new Map();
  const currentSliceReviewTargetBySubject = new Map();
  const sliceReviewTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.reviewed_sha,
    context.diff_base_sha,
    context.committed_target_digest ?? context.worktree_identity_digest
  ]);
  const committedSliceIntegrationTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.slice_ref,
    context.reviewed_sha,
    context.diff_base_sha,
    context.committed_target_digest
  ]);
  const frozenSliceReviewContexts = Object.freeze({
    get(subject) {
      const key = currentSliceReviewTargetBySubject.get(subject);
      return key === undefined ? undefined : frozenSliceReviewContextsByTarget.get(key);
    },
    set(subject, context) {
      const key = sliceReviewTargetKey(context);
      frozenSliceReviewContextsByTarget.set(key, context);
      currentSliceReviewTargetBySubject.set(subject, key);
      return this;
    },
    has(subject) {
      return this.get(subject) !== undefined;
    },
    values() {
      return frozenSliceReviewContextsByTarget.values();
    }
  });
  return {
    frozenReviewContextsByTarget,
    currentTerminalReviewTargetByWk,
    wholeReviewTargetKey,
    frozenReviewContexts,
    sliceReviewTargetKey,
    committedSliceIntegrationTargetKey,
    frozenSliceReviewContexts
  };
}
