---
story_id: <STORY-ID>
generated_at: <ISO-8601>
generator: hybrid(cli+vibe)
status: pending
---

# <STORY-ID> — Requirements Checklist

> Generated mechanically from the story frontmatter. Soft constraints (below) are
> prompts for the planning agent: tick them when you have actually inspected the
> story against each criterion — do NOT auto-check.

## Hard Constraints (CLI-generated)

- [ ] CHK-M01 Story declares a REQ mapping (maps_to_req: or refs: [REQ-…])
- [ ] CHK-M02 scope_write is non-empty and ≤ <N> files
- [ ] CHK-M03 acceptance_check declares ≥ <N> command(s)
- [ ] CHK-M04 Every declared REQ exists in prd.md
- [ ] CHK-M05 scope_write paths are project-relative (no leading "/" or "..")

## Soft Constraints (Claude-reviewed)

- [ ] CHK-001 Title is specific (no vague adjectives: "user-friendly", "fast", "robust", "good")
- [ ] CHK-002 Each acceptance_criteria entry is independently verifiable (pass/fail without ambiguity)
- [ ] CHK-003 Edge cases considered: empty input, concurrent calls, permission denied, timeout
- [ ] CHK-004 Dependencies declared: every `depends_on:` story exists and is in a valid upstream state
- [ ] CHK-005 Out of scope explicit: story states what it deliberately does NOT touch
