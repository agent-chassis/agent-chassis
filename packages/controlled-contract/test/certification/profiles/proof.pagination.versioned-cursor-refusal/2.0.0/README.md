# Versioned-cursor fail-closed pagination v1

Exact-bound proof that a stale cursor's exact next-page attempt is refused with no page return, advancement, or protected effect, while an unrelated mutation does not cause refusal. Standalone traversal completeness is excluded.
