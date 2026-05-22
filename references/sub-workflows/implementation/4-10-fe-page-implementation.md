---
title: "Phase 4.10 — Frontend Page Implementation (AUTO-CONTINUE)"
sub_workflow: "4-10-fe-page-implementation"
phase: 4
sub_phase: "4.10"
version: "3.6.0"
description: >
  AUTO-CONTINUE page implementation. V3.1 adds Page Parity Gate (UX spec alignment before coding),
  Browser Runtime Verification (viewport screenshots), Protected Paths check (SRG-08),
  Code Standards Gate (SRG-09), Handoff Minimum Gate, and Merge Queue enqueueing.
inputs:
  - api-spec.yaml
  - story files (track: frontend / full-stack)
  - sprint-status.yaml (development_order)
outputs:
  - frontend-dev-log.md
dependencies:
  upstream: [phase_4_8, phase_4_9]
  downstream: [phase_4_11]
iteration: true
auto_continue: true
---

# Phase 4.10 — Frontend Page Implementation

**Sub-Phase Goal:** Implement all frontend stories automatically in development order. The agent reads `global_state.development_order` from sprint-status.yaml, filters to `track: "frontend"` or `track: "full-stack"`, finds the first `NOT_STARTED` story, auto-selects it, builds page components, handles all UI states, runs a11y checks, writes tests, runs CODE ACCEPTANCE, marks it `CODE_ACCEPTED`, and loops to the next story. No menus during normal flow.

**AUTO-CONTINUE:** This sub-phase runs autonomously. The agent auto-selects and auto-advances stories without user menus. The only halts are: (a) a story fails tests or a11y audit, (b) all stories are APPROVED, (c) a blocked story has cross-track deps not yet met.

## FSM State Transition Table

### Phase-Level FSM

| Current State    | Valid Transition    | Trigger / Condition                                          | Next State      |
|:-----------------|:--------------------|:-------------------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins                     | IN_PROGRESS     |
| IN_PROGRESS      | AUTO_CONTINUE       | Auto-continue loop running, stories being processed          | IN_PROGRESS     |
| IN_PROGRESS      | ALL_APPROVED        | All stories CODE_ACCEPTED or BLOCKED_BY_DEPENDENCY           | APPROVED        |
| APPROVED         | COMPLETE            | Phase locked                                                 | LOCKED          |

### Per-Story FSM

| Current State        | Trigger                          | Next State              | Description |
|---------------------|----------------------------------|-------------------------|-------------|
| `NOT_STARTED`       | Story Ready Gate passes          | `IN_PROGRESS`           | Development begins |
| `IN_PROGRESS`       | Page components built, all UI states handled | `IMPLEMENTED` | Code complete |
| `IMPLEMENTED`       | Component + integration tests pass | `TESTED`              | Tests passing |
| `TESTED`            | axe-core / Lighthouse a11y audit passes | `A11Y_CHECKED`    | Accessible |
| `A11Y_CHECKED`      | Handoff docs generated (self-check + handoff) | `SUBMITTED`    | Ready for acceptance |
| `SUBMITTED`         | Acceptance checks pass (executable commands exit 0) | `APPROVED`   | Acceptance verified |
| `APPROVED`          | CODE ACCEPTANCE gates pass       | `CODE_ACCEPTED`         | Code quality verified, advance to next |
| `NOT_STARTED`       | Cross-track dep not APPROVED     | `BLOCKED_BY_DEPENDENCY` | Skip, recheck later |

**Final State:** `CODE_ACCEPTED` (per story), `LOCKED` (phase)
**State persistence:** `sprint-status.yaml` key `phase_4_10`; per-story status tracked under `phase_4_10.stories` (ARRAY of objects, NOT flat map)

---

## Story Ready Gate

Before a story begins execution, verify these conditions (enforced at Step 4, before 4a):

```yaml
story_ready_gate:
  story_id: "{story_id}"
  checks:
    - id: "SRG-01"
      description: "Story is not BLOCKED_BY_DEPENDENCY"
      type: "dependency_status"
      expected: "status != BLOCKED_BY_DEPENDENCY"
      severity: "blocking"

    - id: "SRG-02"
      description: "scope_write is defined (not empty)"
      type: "field_check"
      source: "development_order[story_id].scope_write"
      operator: "not_empty"
      severity: "blocking"

    - id: "SRG-03"
      description: "acceptance_check is defined (not empty)"
      type: "field_check"
      source: "development_order[story_id].acceptance_check"
      operator: "not_empty"
      severity: "blocking"

    - id: "SRG-04"
      description: "Story file exists and is readable"
      type: "artifact_exists"
      source: "{stories_output}/story-{N}-{slug}.md"
      severity: "blocking"

    - id: "SRG-05"
      description: "No conflicting IN_PROGRESS story with overlapping scope_write"
      type: "custom_check"
      rule: "For all other IN_PROGRESS stories, verify their scope_write does not overlap with this story's scope_write"
      severity: "blocking"

    - id: "SRG-06"
      description: "scope_write paths are within implementation_boundary"
      type: "scope_boundary"
      rule: "Each scope_write path must match at least one entry in implementation_boundary.frontend_scope or implementation_boundary.shared_scope"
      severity: "blocking"

    - id: "SRG-07"
      description: "scope_write path parent directories exist in project"
      type: "custom_check"
      rule: "Parent directory of each scope_write entry must exist in the project filesystem"
      severity: "blocking"

    - id: "SRG-08"
      description: "scope_write does not intersect with protected_paths (V3.1)"
      type: "protected_path_compliance"
      source: "customize.toml scope_lock.protected_paths"
      rule: "If scope_write intersects any protected_path entry, mark story as serial_only"
      severity: "blocking"

    - id: "SRG-08b"
      description: "scope_write does NOT intersect with forbidden_paths (V3.6 — security)"
      type: "forbidden_path_compliance"
      source: "customize.toml scope_lock.forbidden_paths"
      rule: "If scope_write intersects any forbidden_path entry, BLOCK immediately. Forbidden paths: /etc/, ~/.ssh/, ~/.aws/, .env.production, .git/, node_modules/."
      severity: "critical"

    - id: "SRG-09"
      description: "code_standards_source is declared and non-empty (V3.1)"
      type: "field_check"
      source: "development_order[story_id].code_standards_source"
      operator: "not_empty"
      severity: "blocking"
  all_pass: false
```

If any **blocking** check fails, halt and present the error menu. If only warnings, proceed with a note.

---

## Gate Card

```yaml
gate_card:
  phase: 4.10
  gates:
    - check: sprint_status.phase_4_8
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 4.8 (Design System) must be LOCKED before implementing pages"
    - check: sprint_status.phase_4_9
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 4.9 (API Client & State Management) must be LOCKED before implementing pages"
  gate_pass_action: "Set phase_4_10 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step 0: Load Sprint Status and Initialize

**Objective:** Load sprint status, development order, and initialize per-story tracking.

**Actions:**

1. Read `{sprint_tracking}` to load:
   - `global_state.development_order` — the frozen development sequence
   - `phases.phase_4.substates.phase_4_10` — current phase state and story statuses

2. Filter `development_order` for this track (`track: "frontend"` or `track: "full-stack"`):

```yaml
frontend_stories:
  - { order: 4, story_id: "S-1.1", title: "Project Scaffold", depends_on: [], status: null }
  - { order: 5, story_id: "S-1.2", title: "Layout & Navigation", depends_on: [{story_id: "S-1.1", track: "frontend"}], status: null }
  - { order: 6, story_id: "S-2.1", title: "Login Page", depends_on: [{story_id: "S-3.2", track: "backend"}], status: null }
```

3. Merge with existing story statuses from `phase_4_10.stories` if resuming. **Stories are stored as an array of objects, NOT a flat map**:

```yaml
# CORRECT format (array of objects):
phase_4_10:
  stories:
    - { id: "S-1.1", status: "CODE_ACCEPTED", started_at: "...", completed_at: "..." }
    - { id: "S-1.2", status: "NOT_STARTED", started_at: null, completed_at: null }
    - { id: "S-2.1", status: "NOT_STARTED", started_at: null, completed_at: null }
```

4. Initialize sprint status for this sub-phase if first entry:

```yaml
phases:
  phase_4:
    substates:
      phase_4_10:
        status: "IN_PROGRESS"
        state_history:
          - { state: "IN_PROGRESS", at: "{ISO_TIMESTAMP}" }
        stories:
          - { id: "S-1.1", status: "NOT_STARTED", started_at: null, completed_at: null }
          - { id: "S-1.2", status: "NOT_STARTED", started_at: null, completed_at: null }
          - { id: "S-2.1", status: "NOT_STARTED", started_at: null, completed_at: null }
```

---

## Step 1 — Gate Card Check

Read `{sprint_tracking}/sprint-status.yaml`. Verify **both** gates:

```yaml
phase_4_8: LOCKED
phase_4_9: LOCKED
```

If either gate fails, **HALT** and report which phase is not locked. Do not proceed until both prerequisites are met.

If both gates pass, update `sprint-status.yaml`:

```yaml
phase_4_10: IN_PROGRESS
```

---

## Step 2 — Load Story Context

Read all story files from `{stories_output}/` that have `track: frontend` or `track: full-stack` in their frontmatter. For each story file, extract:

- Story ID, title, priority
- Acceptance criteria
- UI notes (layout, component usage, design references)
- Technical notes (API endpoints used, state management requirements)
- Dependencies on other stories

**IMPORTANT:** Do NOT sort by priority. The development order from `global_state.development_order` is the single source of truth for ordering.

---

## Step 3 — Parallel Sub-Agent Dispatch (Orchestrator-Controlled)

**IMPORTANT:** The orchestrator dispatches MULTIPLE independent sub-agents CONCURRENTLY for stories with no cross-dependencies and non-overlapping scope_write. Each sub-agent runs in its own worktree with CLEAN context.

### Orchestrator's Parallel Dispatch Algorithm

```
1. Read sprint-status.yaml → global_state.development_order
2. Filter stories WHERE track IN ("frontend", "full-stack")
3. Sort by order ASC

4. Identify ALL eligible stories:
   
   FOR each story IN filtered_stories:
     ✓ status == "NOT_STARTED" or "BLOCKED_BY_DEPENDENCY" (re-check deps)
     ✓ ALL depends_on stories are CODE_ACCEPTED or MERGED
     ✓ scope_write does NOT overlap with any RUNNING story's scope_write
     ✓ IF scope_write intersects protected_paths → mark serial_only
   
5. Group:
   PARALLEL_BATCH = [stories where parallel_safe == true AND NOT serial_only]
   SERIAL_QUEUE = [stories where serial_only == true]

6. Dispatch PARALLEL_BATCH concurrently (up to max_concurrent_stories)
7. Dispatch ONE from SERIAL_QUEUE if no other serial is running
8. As sub-agents complete: merge → update sprint-status → cleanup → dispatch next
9. Loop until all stories CODE_ACCEPTED, BLOCKED, or FAILED
```

### Sub-Agent Clean Context (Per Story, Frontend)

```
1. Read sprint-status.yaml → global_state.development_order
2. Filter stories WHERE track IN ("frontend", "full-stack")
3. Sort by order ASC
4. Find first story with status IN ("NOT_STARTED", "IN_PROGRESS", "BLOCKED_BY_DEPENDENCY")

5. IF story.status == "IN_PROGRESS":
     RESUME scenario. Read last_completed_substep from per-story status file.
     Build sub-agent prompt with resume_from = last_completed_substep.
     → Dispatch sub-agent

6. IF story.status == "NOT_STARTED":
     Check cross-track dependencies:
       FOR each dep IN story.depends_on:
         IF dep.status != "CODE_ACCEPTED" AND dep.status != "MERGED":
           Mark story as BLOCKED_BY_DEPENDENCY, skip, continue to next
     IF all deps satisfied:
       → Dispatch sub-agent (fresh start)

7. IF story.status == "BLOCKED_BY_DEPENDENCY":
     Re-check. If deps now met → update to NOT_STARTED → dispatch.
     If still not met → skip, continue.

8. IF no eligible story:
     → Go to Step 7 (Phase Summary).
```

### Sub-Agent Prompt Template (Frontend)

When dispatching, the orchestrator sends a CLEAN prompt:

```
你在实现一个独立的前端页面 story。只关注这个 story。

Story: {story_id}: {story_title}
Track: frontend
scope_write: {paths}
acceptance_check: {commands}
code_standards_source: {sources}

你需要读取的文件:
  - {story_file_path} (你的 story 定义)
  - {api_spec_output} (API 契约)
  - {architecture_output} (架构约束)
  - {wireframes_output} (UX 设计)
  - {design_tokens_output} (设计变量)

你的工作目录: .claude/worktrees/story/{story_id}-{track}/

实现步骤 (按顺序执行):
  4a: Story Ready Gate 检查
  4b: 读取 story 文件，标记 IN_PROGRESS
  4b1: [Page stories] Page Parity Gate — 读取 UX spec，输出 gap list
  4c: 实现页面组件，处理 ALL UI states
  4c2: Browser Runtime Verification (截图验证)
  4d: Accessibility Audit
  4e: Component Tests
  4f: Integration Tests
  4g: Update Dev Log
  4h: 生成 self-check.md + handoff.md
  4h1: Handoff Minimum Gate
  4h2: Scope Exit Verification
  4i: 运行 acceptance_check
  4j: CODE ACCEPTANCE (CA-01~CA-05)
  3rd Checkpoint commit — CODE_ACCEPTED
  4k: 写入 per-story status 文件，返回结果

Git 提交规范 (至少 3 次 commit):
  1. feat({story_id}): implement {story_title} — IMPLEMENTED
  2. test({story_id}): tests passing for {story_title} — TESTED
  3. accept({story_id}): CODE_ACCEPTED — {story_title}

返回格式:
  { story_id: "{story_id}", status: "CODE_ACCEPTED", summary: "..." }
  
如果任何步骤失败，返回 { story_id, status: "FAILED", step: "4x", error: "..." }
```

### Orchestrator Post-Dispatch

Same flow as backend: read per-story status → merge → update sprint-status → cleanup → next story.

---

## Step 4 — Per-Story Development Loop (Auto-Execute)

For the auto-selected story, execute the following sub-steps in order. **Do NOT pause between sub-steps — execute continuously through to CODE_ACCEPTED.**

**Step Audit Protocol:** Every sub-step (4a through 4k) MUST write a Step Completion Record to `{step_audit_log_output}` after completion. See `specs/step-audit.md` for the full template. Each record includes: step_id, timestamp, story_id, status, skill_used, command_run, summary, quality, artifacts_produced, state_transition, next_action. Additionally, update the story's `last_completed_substep` field in sprint-status.yaml (e.g., `last_completed_substep: "4d"`).

### 4a. Story Ready Gate Check

Before starting work, evaluate the Story Ready Gate:

1. Verify `scope_write` is defined and non-empty
2. Verify `acceptance_check` is defined and non-empty
3. Verify story file exists
4. Check for conflicting `scope_write` overlaps with other IN_PROGRESS stories (blocking)
5. Verify `scope_write` paths are within `implementation_boundary` (SRG-06)
6. Verify `scope_write` path parent directories exist (SRG-07)
7. Check `scope_write` does not intersect `protected_paths` (SRG-08, V3.1) — if so, mark serial_only
8. Verify `code_standards_source` is declared and non-empty (SRG-09, V3.1)
9. Enforce scope: The agent MUST NOT create or modify files outside `scope_write` paths

If the gate passes, display:
`▶ {story_id}: {story_title} — SCOPE LOCKED → starting implementation`
`  scope_write: {paths}`
`  acceptance_check: {commands}`
`  boundary: within implementation_boundary ✓`

If a blocking check fails, present the error menu.

### 4b. Read Story File and Mark IN_PROGRESS

Read the full story file. Capture:
- User story narrative (As a... I want... So that...)
- Acceptance criteria (numbered list)
- UI notes (wireframes, mockup references, layout instructions)
- Technical notes (specific API endpoints to call, components to use)
- Edge cases mentioned

Update sprint status:

```yaml
phase_4_10:
  stories:
    - { id: "{story_id}", status: "IN_PROGRESS", started_at: "{ISO_TIMESTAMP}", completed_at: null }
```

Display: `▶ Implementing {story_id}: {story_title}`

### 4b1. Page Parity Gate — Frontend Page/Layout Stories Only (V3.1)

**When to apply:** The story involves page components, layout, shell, routing, or UI rendering.

**Objective:** Before writing code, verify alignment with UX specifications and prototypes. Catch gaps early — prototype alignment takes priority over chasing test coverage.

**Steps:**

1. **Read UX specification**: Load `wireframes.md` and `design-tokens.md` from `{design_tokens_output}` and `{wireframes_output}`.

2. **Read prototype pages** (if specified): Check the story's `source_of_truth` for prototype paths. If none specified, use `docs/prototype/` if it exists.

3. **Output the Page Parity Gap List**:
   ```
   ═══════════════════════════════════════════════════════
   PAGE PARITY GATE — {story_id}: {story_title}
   ═══════════════════════════════════════════════════════
   
   UX Spec: wireframes.md §{section}, design-tokens.md
   Prototype: {path or "N/A — using wireframe specs only"}
   
   Page: /login
     Spec states: email + password form, "Sign In" button, error state
     Gap: [NONE] — fully specified
     Risk: LOW
   
   Page: /dashboard
     Spec states: card layout, 4 metric cards, recent activity table
     Gap: MINOR — empty state not shown in prototype
     Risk: MEDIUM — implement standard Empty component from design system
   
   Page: /users
     Spec states: table with pagination, search bar, create button
     Gap: MAJOR — prototype shows filter panel not in wireframes
     Risk: HIGH — resolve with PM before implementing
   
   ───────────────────────────────────────────────────────
     Summary:  2/3 pages ready, 1 page has MAJOR gap (/users)
     Next:     Resolve MAJOR gaps before coding; MINOR gaps can proceed with design system defaults
   ═══════════════════════════════════════════════════════
   ```

4. **Gap severity rules:**
   - **MAJOR**: Missing page structure, conflicting layout, unclear interaction flow → HALT and file CR
   - **MINOR**: Missing edge state, unclear responsive behavior → Proceed with design system defaults, note in handoff
   - **NONE**: Fully specified → Proceed

5. **When MAJOR gaps exist**: Halt and file a Change Request:
   ```
   ⚠ PAGE PARITY GATE BLOCKED — 1 MAJOR gap:
     /users: Prototype shows filter panel not in wireframes
     → Filing CR against Phase 2.9 (Wireframes)
     → Story BLOCKED until gap is resolved
   ```

**For non-UI stories** (pure API integration, state management, utility): Skip this step with note: "N/A — no page rendering in scope."

### 4b. Implement Page Component(s)

Create one or more page components. Follow these rules:

- **Import from Phase 4.8**: Use base components (Button, Input, Modal, Table, Loading, Error, Empty, Toast) from the design system. Do NOT reinvent basic UI primitives.
- **Import from Phase 4.9**: Use API hooks from the state management layer. Do NOT make raw fetch/axios calls.
- **Component location**: Place page components in `src/pages/{PageName}/`
- **Co-locate**: Keep page-specific sub-components, styles, and tests in the same directory.

Example structure:

```typescript
// src/pages/Login/LoginPage.tsx
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useLogin } from '@/hooks/useAuth';
import { useToast } from '@/components/Toast';

export function LoginPage() {
  const loginMutation = useLogin();
  const { addToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationErrors = validate({ email, password });
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    try {
      await loginMutation.mutateAsync({ email, password });
      addToast({ type: 'success', title: 'Logged in successfully' });
    } catch (err) {
      addToast({ type: 'error', title: 'Login failed', description: getErrorMessage(err) });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Input type="email" label="Email" value={email} onChange={setEmail} error={errors.email} required />
      <Input type="password" label="Password" value={password} onChange={setPassword} error={errors.password} required />
      <Button type="submit" loading={loginMutation.isPending}>Sign In</Button>
    </form>
  );
}
```

### 4c. Handle ALL UI States

Every page component **MUST** handle the following states explicitly:

| State       | Implementation                                                        |
|:------------|:----------------------------------------------------------------------|
| **Loading** | Use `<Loading variant="skeleton" />` or `<Loading variant="spinner" />` while data fetches |
| **Empty**   | Use `<Empty title="No items found" action={{ label: 'Create one', onClick }} />` when data array is empty |
| **Error**   | Wrap in `<ErrorBoundary>` for render errors; use `<InlineError message={error.message} onRetry={refetch} />` for API errors |
| **Edge cases** | Test and handle: very long text (truncation), missing optional fields (graceful fallback), null/undefined data, network timeout, invalid data shapes |
| **Success**  | Normal data rendering with all interactive elements functional |

After all page components are built and all UI states handled, update status to `IMPLEMENTED`.

**Checkpoint commit 1** — commit the completed page implementation:

```bash
git add {scope_write paths}
git commit -m "feat({story_id}): implement {story_title} — page components

Pages: {page list}
UI states: loading/empty/error/edge/success
Status: IMPLEMENTED"
```

### 4c2. Browser Runtime Verification (V3.1)

**When to apply:** All frontend page/layout stories.

**Objective:** Verify the implemented pages render correctly in an actual browser before proceeding to tests and acceptance. Screenshots serve as evidence.

**Steps:**

1. **Start the dev server**: `npm run dev` (or project-specific dev command).

2. **For each page implemented**, capture:
   - Desktop viewport (1440px width) screenshot
   - Mobile viewport (375px width) screenshot

3. **If prototype pages exist**, open them side-by-side with the implementation and compare.

4. **Output the runtime verification report**:
   ```
   ═══════════════════════════════════════════════════════
   BROWSER RUNTIME VERIFICATION — {story_id}
   ═══════════════════════════════════════════════════════
   
   Page: /login (1440px)
     Render: ✓ Correct
     Layout: ✓ Matches wireframe
     Interactive: ✓ Form fields respond to input
     Screenshot: _story-output/{story_id}/screenshots/login-desktop.png
   
   Page: /login (375px)
     Render: ✓ Correct
     Responsive: ✓ Single column layout
     Screenshot: _story-output/{story_id}/screenshots/login-mobile.png
   
   ───────────────────────────────────────────────────────
     Summary:  RUNTIME VERIFICATION PASSED — 2/2 viewports verified
     Next:     Step 4d — Accessibility Audit
   ═══════════════════════════════════════════════════════
   ```

5. **Without screenshot evidence**, do NOT proceed to subsequent steps. The gate is:
   ```
   ⚠ BROWSER RUNTIME VERIFICATION FAILED:
     No screenshots captured. Dev server may not be running.
     → Start dev server and retry.
   ```

6. **Save screenshots** to `_story-output/{story_id}/screenshots/`.

**After verification passes**, proceed to Step 4d.

### 4d. Accessibility Audit

For each page, run an accessibility check:

Checklist:
- [ ] Focus order follows visual order (Tab through page, verify logical sequence)
- [ ] All interactive elements have accessible names (`aria-label`, `aria-labelledby`, or visible label)
- [ ] Color contrast ratio >= 4.5:1 for all text (use axe DevTools)
- [ ] Keyboard navigation works for all functionality (no mouse required)
- [ ] Screen reader announces dynamic content changes (use `role="alert"`, `aria-live`)
- [ ] Form inputs have associated `<label>` elements
- [ ] Images have `alt` attributes (empty `alt=""` for decorative images)
- [ ] Page has exactly one `<h1>`
- [ ] Heading hierarchy is logical (h1 > h2 > h3, no skips)
- [ ] Skip-to-content link present

Fix any issues found before proceeding.

After audit passes, update status to `A11Y_CHECKED`.

### 4e. Component Tests

Write component tests using the testing framework chosen in Phase 4.7:

```typescript
// src/pages/Login/LoginPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('renders email and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('shows validation errors for empty fields on submit', async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
  });

  it('shows loading state during submission', async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows error toast on failed login', async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'bad@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/login failed/i);
  });
});
```

Minimum test coverage per page component:
- **Render test**: component renders without crashing
- **Interaction test**: user interactions trigger expected handlers
- **Loading state**: loading indicator visible during async operations
- **Error state**: error UI shown when API fails
- **Empty state**: empty UI shown when data is empty
- **Success state**: data renders correctly

### 4f. Integration Tests

Write integration tests that mock the API (via MSW from Phase 4.9) and test complete user flows:

```typescript
// src/pages/UserList/UserList.integration.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

describe('UserList — Integration', () => {
  it('loads and displays users', async () => {
    render(<UserListPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    const rows = await screen.findAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows empty state when no users', async () => {
    server.use(
      http.get('*/users', () => HttpResponse.json({ data: [], total: 0, page: 1, pageSize: 10 }))
    );
    render(<UserListPage />);
    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
  });

  it('handles network error gracefully', async () => {
    server.use(http.get('*/users', () => HttpResponse.error()));
    render(<UserListPage />);
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
```

After all tests pass, update status to `TESTED`.

**Checkpoint commit 2** — commit the passing tests:

```bash
git add {scope_write paths including test files}
git commit -m "test({story_id}): tests passing for {story_title}

Component tests: {component_count}
Integration tests: {integration_count}
Coverage: {percent}%
Status: TESTED"
```

### 4g. Update Dev Log

After completing the story, append an entry to `{frontend_dev_log_output}`:

```yaml
---
artifact_id: "frontend-dev-log"
artifact_type: "log"
phase: "4.10"
created: "{iso-timestamp}"
updated: "{iso-timestamp}"
---

## Story Completion Log

### {STORY_ID} — {STORY_TITLE}
- **Completed at**: {iso-timestamp}
- **Implemented by**: web-dev-flow agent (auto-continue)
- **Files created/modified**:
  - src/pages/{PageName}/{PageName}.tsx
  - src/pages/{PageName}/{PageName}.test.tsx
  - src/pages/{PageName}/{PageName}.integration.test.tsx
- **States handled**: loading, empty, error, edge cases, success
- **Components used**: {list}
- **API hooks used**: {list}
- **A11y check**: PASSED (no critical or serious issues)
- **Component tests**: {N} pass, 0 fail
- **Integration tests**: {N} pass, 0 fail
- **AC verification**: ALL MET
- **Notes**: {any implementation notes, decisions, or follow-up items}
```

After dev log updated, proceed to generate handoff documents.

### 4h. Generate Handoff Documents

Generate two mandatory handoff documents per story. These serve as the audit trail and submission package.

**File: `_story-output/{story_id}/self-check.md`**

```markdown
# Self-Check: {story_id} — {story_title}

## Commands Run
```bash
npm run test:login
# Result: 6 pass, 0 fail, 0 skip

npx axe src/pages/Login/
# Result: 0 violations
```

## Results
- Component tests: {N} pass, 0 fail
- Integration tests: {N} pass, 0 fail
- Accessibility audit: PASSED (0 violations)
- UI states: ALL handled
```

**File: `_story-output/{story_id}/handoff.md`**

```markdown
# Handoff: {story_id} — {story_title}

## Summary
{2-3 sentence summary of page and its key functionality}

## Files Changed
- src/pages/Login/LoginPage.tsx [new]
- src/pages/Login/LoginPage.test.tsx [new]
- src/pages/Login/LoginPage.integration.test.tsx [new]

## Pages Implemented
- /login — Login page with form validation and auth integration

## Components Used
- Button, Input, Toast (Phase 4.8 Design System)

## API Hooks Used
- useLogin (Phase 4.9 API Client)

## Scope Verification
- scope_write: src/pages/Login/ ✓
- No files written outside scope

## Notes for Reviewer
{Any decisions, trade-offs, or items needing attention}
```

After both documents are written, run the **Handoff Minimum Gate (V3.1)** before transitioning to SUBMITTED.

### 4h1. Handoff Minimum Gate (V3.1)

**Objective:** Verify handoff documents contain substantive content — not placeholders or empty sections. This gate MUST pass before SUBMITTED transition.

**self-check.md minimum content:**
- "Commands run" section must be non-empty AND must not contain only "todo"/"tbd"/"none"
- "Results" section must be non-empty AND must not contain only "todo"/"tbd"/"none"

**handoff.md minimum content:**
- "Summary" section must be non-empty AND must not contain only "todo"/"tbd"/"none"
- "Files changed" section must list at least one actual file path
- "Scope Verification" must confirm no files written outside scope_write

**If gate fails:** Do NOT transition to SUBMITTED. Halt and display missing sections.

**After gate passes:** Update status to `SUBMITTED`.

Display: `📄 Handoff docs generated → _story-output/{story_id}/`

### 4h2. Scope Exit Verification

Before proceeding to acceptance checks, verify all file modifications are within the story's `scope_write`:

```bash
# Get all modified files since story started
CHANGED_FILES=$(git diff --name-only scope-freeze/pre-implementation..HEAD)
VIOLATIONS=0
for f in $CHANGED_FILES; do
  matched=0
  for p in ${scope_write}; do
    # 目录边界匹配：精确匹配 或 路径前缀+目录分隔符
    [[ $f = "$p" || $f = "$p"/* ]] && { matched=1; break; }
  done
  if [ $matched = 0 ]; then
    echo "VIOLATION: $f"
    VIOLATIONS=$((VIOLATIONS+1))
  fi
done
if [ $VIOLATIONS -gt 0 ]; then
  echo "SCOPE EXIT FAILED — $VIOLATIONS violation(s)"
  # Present error menu: [Revert] [Expand Scope] [Exit]
fi
```

If `VIOLATIONS` is zero:
```
═══════════════════════════════════════════════════════
SCOPE LOCK — Scope Exit Verification
═══════════════════════════════════════════════════════
  Phase:    4.10
  Story:    {story_id}: {story_title}
  Step:     4h2
  Skill:    /bmad-dev-story
  Command:  git diff --name-only scope-freeze/pre-implementation..HEAD
  Status:   PASS
───────────────────────────────────────────────────────
  Files Changed:   {total_changed}
    ✓ {file_1}  (within scope_write)
    ✓ {file_2}  (within scope_write)
  Violations:      0
───────────────────────────────────────────────────────
  Summary:  CLEAN — 0 violations ({total_changed} files checked)
  Next:     Step 4i — Execute Acceptance Checks
═══════════════════════════════════════════════════════
```

**Document Record** — append to `{scope_audit_log_output}` (see specs/scope-lock.md Operation 6 for full YAML record).

If violations are found:
```
  ⚠ SCOPE VIOLATION in {story_id}: {N} file(s) outside scope_write
    ✗ {file_1}
    ✗ {file_2}

    [1] Revert — git checkout the violating files, keep scope_write changes
    [2] Expand Scope — Submit CR to add files to scope_write (requires approval)
    [3] Exit — Save state, return to menu for manual resolution
```

- **[1] Revert**: `git checkout -- <violating_files>` then continue to acceptance checks
- **[2] Expand Scope**: Submit Scope Expansion CR, wait for user approval before continuing
- **[3] Exit**: Halt auto-continue, story stays in SUBMITTED state

### 4i. Execute Acceptance Checks

Run the `acceptance_check` commands defined in the development order for this story:

```
Running acceptance checks for {story_id}:

  [1/2] npm run test:login
  Executing... ✓ PASSED (exit 0)

  [2/2] npx axe src/pages/Login/
  Executing... ✓ PASSED (exit 0)

  All acceptance checks passed! ✓
```

If any acceptance check fails (non-zero exit), halt and present the error menu.

After all acceptance checks pass, update status to `APPROVED`.

### 4j. CODE ACCEPTANCE

After all acceptance checks pass for the story, invoke `/bmad-code-review adversarial` on the story's scope to run adversarial code review against the implemented changes. This is a mandatory quality gate.

**Code Acceptance Check:**

```yaml
code_acceptance:
  story_id: "{story_id}"
  type: "code_acceptance"
  checks:
    - id: "CA-01"
      description: "Adversarial code review passes"
      command: "/bmad-code-review adversarial"
      target: "{scope_write files}"
      expected: "No critical or high-severity issues"
    - id: "CA-02"
      description: "Test coverage meets threshold"
      command: "npm run test:coverage -- {scope_write}"
      expected: ">= min_test_coverage from customize.toml"
    - id: "CA-03"
      description: "Type check passes"
      command: "npm run type-check"
      expected: "exit 0"
    - id: "CA-04"
      description: "Lint passes"
      command: "npm run lint"
      expected: "exit 0 (no errors)"
    - id: "CA-05"
      description: "Scope boundary audit — git diff verification. Uses for-loop with directory boundary matching (\"$p\"/*) to prevent false positives"
      command: "SCOPE_FILES=\$(git diff --name-only scope-freeze/pre-implementation..HEAD); VIOLATIONS=0; for f in \$SCOPE_FILES; do matched=0; for p in \${scope_write}; do [[ \$f = \"\$p\" || \$f = \"\$p\"/* ]] && { matched=1; break; }; done; [ \$matched = 0 ] && { echo \"VIOLATION: \$f\"; VIOLATIONS=\$((VIOLATIONS+1)); }; done; [ \$VIOLATIONS = 0 ]"
      expected: "exit 0 (0 violations)"
  all_pass: false
```

Run CODE ACCEPTANCE checks:

```
Running CODE ACCEPTANCE for {story_id}:

  [1/5] /bmad-code-review adversarial
  Executing... ✓ PASSED — 0 critical, 0 high, 2 info

  [2/5] npm run test:coverage -- src/pages/Login/
  Executing... ✓ PASSED — 92% coverage (min 80%)

  [3/5] npm run type-check
  Executing... ✓ PASSED (exit 0)

  [4/5] npm run lint
  Executing... ✓ PASSED (exit 0)

  [5/5] git diff --name-only scope-freeze/pre-implementation..HEAD → scope boundary audit
  Executing... ✓ PASSED — 0 violations ({N} files checked)

  All CODE ACCEPTANCE checks passed! ✓
```

If any CODE ACCEPTANCE check fails, halt and present the error menu.

After all CODE ACCEPTANCE checks pass, update status to `CODE_ACCEPTED`.

**Checkpoint commit 3** — final verified commit before merge:

```bash
git add {scope_write paths}
git commit -m "accept({story_id}): CODE_ACCEPTED — {story_title}

Review: PASSED
Coverage: {percent}%
Type check: PASSED
Lint: PASSED
Scope audit: 0 violations
Handoff docs: _story-output/{story_id}/{self-check.md, handoff.md}
Status: CODE_ACCEPTED → queued for merge"
```

### 4k. Mark CODE_ACCEPTED and Auto-Advance (Replaces Post-Story Menu)

**There is NO post-story menu.** After CODE ACCEPTANCE checks pass, the story is automatically marked `CODE_ACCEPTED`:

```yaml
phase_4_10:
  stories:
    - { id: "{story_id}", status: "CODE_ACCEPTED", started_at: "{ISO_TIMESTAMP}", completed_at: "{ISO_TIMESTAMP}" }
```

Display: `✓ {story_id}: {story_title} — CODE_ACCEPTED`

**Enqueue Merge (V3.1):** After CODE_ACCEPTED, enter the Merge Queue for dependency-ordered merging in Phase 4.13. Write entry to `{sprint_tracking}` under `global_state.merge_queue.items` with `merge_status: "queued"` or `"waiting_dependency"` based on dependency status. Display: `📥 {story_id} enqueued for merge`.

**Then loop back to Step 3** to auto-select the next story.

### 4l. Error Halt Menu (Only on Failure)

If a story **fails** tests, a11y audit, CODE ACCEPTANCE, or any verification step, present this minimal 3-option menu (the ONLY menu in this phase):

```
✗ {story_id}: {story_title} — {failure_reason}

[1] Retry — Fix the issue and re-run the failing step for this story
[2] Skip — Mark as IMPLEMENTED with issues noted, continue to next story
[3] Exit — Save state and return to main menu (manual intervention needed)
```

**If [1] Retry:** Fix the identified issue, re-run the failing step, and retry the transition.
**If [2] Skip:** Add a note to the dev log documenting the unresolved issue. Mark the story as `IMPLEMENTED` (not `CODE_ACCEPTED`). Continue to Step 3.
**If [3] Exit:** Save state. Return to main menu. The story remains in its current non-CODE_ACCEPTED state.

### Scope Violation Menu (when scope exit verification or CA-05 fails)

```
⚠ SCOPE VIOLATION in {story_id}: {N} file(s) outside scope_write

  ✗ {file_1}
  ✗ {file_2}

[1] Revert — git checkout the violating files, keep scope_write changes
[2] Expand Scope — Submit CR to add files to scope_write (requires approval)
[3] Exit — Save state and return to main menu
```

---

## Step 5 — Integration Check

When the auto-continue loop finishes (all frontend stories processed — either CODE_ACCEPTED or BLOCKED_BY_DEPENDENCY), perform a cross-page integration check:

1. **Navigation flow**: Navigate through all pages in user-order sequence. Verify no broken links or missing routes.
2. **Data consistency**: Verify that data created on one page (e.g., create user form) appears correctly on another page (e.g., user list).
3. **Auth flow**: Logout and verify protected routes redirect to login. Login and verify all routes accessible.
4. **Error propagation**: Trigger a backend error and verify error state renders consistently across pages.
5. **Mobile responsiveness**: Test each page at 375px and 1440px viewport widths.

---

## Step 6 — Change Request Detection

As pages are implemented, compare actual API usage against `api-spec.yaml`:

- **Missing endpoint**: If a page needs an endpoint not in the spec, file a Change Request (CR) per the CR workflow.
- **Wrong response shape**: If the API returns data that does not match the spec schema, file a CR.
- **Missing field**: If the spec schema lacks a field needed by the UI, file a CR.

Each CR should include:
- CR ID (auto-incremented)
- Page/story that triggered the CR
- Endpoint affected
- Description of the gap
- Proposed change (add endpoint, add field, change response shape)

---

## Step 7 — Phase Summary + Acceptance Gates

After all frontend stories are processed, present the phase summary:

```
═══════════════════════════════════════════
Phase 4.10 — Page Implementation Summary
═══════════════════════════════════════════

Stories Processed: {total_count}
  CODE_ACCEPTED: {code_accepted_count}
    ✓ S-1.1: Project Scaffold
    ✓ S-1.2: Layout & Navigation
    ✓ S-2.1: Login Page
  BLOCKED_BY_DEPENDENCY: {blocked_count}
    ⊘ S-4.1: User List Page (waiting on backend S-4.1)
    ⊘ S-4.2: User Profile Page (waiting on backend S-4.1)
  SKIPPED (issues): {skipped_count}

CRs Filed: {cr_count} ({blocking_count} blocking, {non_blocking_count} non-blocking)
```

**Mixed completion note:** If some stories are BLOCKED_BY_DEPENDENCY but others are CODE_ACCEPTED, the phase can still complete. Blocked stories are tracked for re-evaluation on next entry or when the blocking story's track completes.

### TRACK VERIFICATION (FE Track)

After the phase summary, verify all CODE_ACCEPTED stories and track-level UI quality:

```yaml
track_verification:
  phase: "4.10"
  track: "frontend"
  checks:
    - id: "TV-01"
      description: "All frontend stories CODE_ACCEPTED"
      command: "Check sprint-status.yaml: phases.phase_4.substates.phase_4_10.stories[].status == CODE_ACCEPTED for non-blocked"
      expected: "All non-blocked frontend stories CODE_ACCEPTED"
    - id: "TV-02"
      description: "No type-check or lint failures in frontend code"
      command: "npm run type-check && npm run lint"
      expected: "exit 0 (no type or lint errors)"
    - id: "TV-03"
      description: "All page routes render without crash"
      command: "npm run test -- --grep '{frontend_story_pattern}' || true; verify exit 0"
      expected: "All frontend story tests pass"
  all_pass: false
```

```
Running TRACK VERIFICATION (FE Track):

  [1/3] All stories CODE_ACCEPTED
  ✓ PASSED — 5/5 non-blocked stories CODE_ACCEPTED

  [2/3] Type check + Lint
  ✓ PASSED — 0 type errors, 0 lint errors

  [3/3] Test suite
  ✓ PASSED — 38 tests pass, 0 fail

  All TRACK VERIFICATION checks passed! ✓
```

If any TRACK VERIFICATION check fails, present the error and halt.

### ACCEPTANCE GATE PATH

Track-level verification is complete. The following acceptance gates run at the integration level (Phase 4.13), not within this sub-phase:

| Acceptance Gate | Phase | Location |
|-----------------|-------|----------|
| UI_ACCEPTANCE | 4.12 | FE Completion Review |
| FEATURE_ACCEPTANCE | 4.13 | Integration |
| E2E_BROWSER_ACCEPTANCE | 4.13 | Integration |

Proceed to Phase 4.11 — FE A11y & Perf Audit.

---

## Phase Complete

When all stories are CODE_ACCEPTED or BLOCKED_BY_DEPENDENCY and integration + acceptance checks pass, finalize:

```yaml
phase_4_10:
  status: "ACCEPTED"
  state_history:
    - { state: "IN_PROGRESS", at: "{ISO}" }
    - { state: "APPROVED", at: "{ISO}" }
    - { state: "ACCEPTED", at: "{ISO}" }
  artifacts:
    - { type: "dev_log", path: "{frontend_dev_log_output}", status: "complete" }
    - { type: "handoff_docs", path: "_story-output/{story_id}/", status: "complete" }
  stories:
    - { id: "S-1.1", status: "CODE_ACCEPTED", started_at: "...", completed_at: "..." }
    - { id: "S-1.2", status: "CODE_ACCEPTED", started_at: "...", completed_at: "..." }
    - { id: "S-2.1", status: "CODE_ACCEPTED", started_at: "...", completed_at: "..." }
    - { id: "S-4.1", status: "BLOCKED_BY_DEPENDENCY", started_at: null, completed_at: null }
  stories_code_accepted: {N}
  stories_blocked_by_dependency: {N}
  acceptance:
    code_acceptance: "ALL_PASSED"
    track_verification: "ALL_PASSED"
  crs_filed: {N}
```

**Gate for Phase 4.11:** All non-blocked stories must be CODE_ACCEPTED. `BLOCKED_BY_DEPENDENCY` stories do NOT count as incomplete for gate purposes.

This unlocks the gate for Phase 4.11 (Accessibility & Performance Audit).
