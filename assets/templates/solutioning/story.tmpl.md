---
template: story-v1
artifact_type: story
description: "User story with acceptance criteria and implementation guidance"
version: "1.0"
---

# Story {STORY_ID}: {TITLE}

**Epic:** {EPIC_ID}
**Track:** backend | frontend | fullstack
**Priority:** P1 | P2 | P3
**Parallel Safe:** true | false
**Estimated Effort:** {HOURS}h

---

## User Story

<!-- ACTION REQUIRED: As a [role], I want [goal], so that [reason] -->

As a {ROLE}, I want {GOAL}, so that {REASON}.

## Acceptance Criteria

<!-- ACTION REQUIRED: At least 3 Given/When/Then scenarios -->

1. **Given** {context}, **When** {event}, **Then** {outcome}
2. **Given** {context}, **When** {event}, **Then** {outcome}
3. **Given** {context}, **When** {event}, **Then** {outcome}

## Technical Notes

<!-- ACTION REQUIRED: Implementation guidance — files to touch, patterns to use, constraints (min 100 chars) -->

- **Primary files:** {file_paths}
- **Patterns:** {design_patterns}
- **Constraints:** {constraints}

## Scope

<!-- ACTION REQUIRED: Exact files this story will create or modify -->

### In Scope (`scope_write`)
- `{filepath}` — {change_description}
- `{filepath}` — {change_description}

### Out of Scope
- {excluded_file_or_behavior}

## Dependencies

<!-- Stories that must be CODE_ACCEPTED before this one starts -->

- {STORY_ID} — {brief_reason}

## Acceptance Checks

<!-- ACTION REQUIRED: Executable commands. No placeholders (todo, tbd, etc.) -->

```bash
{executable_command_1}
{executable_command_2}
```

## Code Standards

<!-- Reference to coding standards file(s) -->

- {code_standards_source}

## Handoff

### self-check.md
```
Commands run:
{commands_executed}

Results:
{test_output_summary}
```

### handoff.md
```
Summary:
{what_was_built}

Files changed:
{modified_files_list}
```
