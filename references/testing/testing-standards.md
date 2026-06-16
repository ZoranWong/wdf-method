# WDF Method — Acceptance Testing Standards

**Version:** 3.8.0
**Status:** MANDATORY for all Phase 4 stories

---

## Testing Pyramid (MANDATORY)

```
           ┌──────────┐
           │  E2E     │  Playwright browser tests — critical user journeys
           │ (Playwright)│
          ┌┴──────────┴┐
          │ Integration │  API contract tests, DB migration tests, cross-service
          │  Tests      │
         ┌┴────────────┴┐
         │   Functional  │  Feature-level tests — acceptance criteria verification
         │    Tests      │
        ┌┴──────────────┴┐
        │    Unit Tests   │  Pure function tests, component tests, validation tests
        │                 │
        └─────────────────┘
              Coverage ≥ 80%
```

---

## Level 1: Unit Tests (MANDATORY)

### Coverage Requirements

| Metric | Backend | Frontend |
|--------|---------|----------|
| Line Coverage | ≥ 80% | ≥ 75% |
| Branch Coverage | ≥ 75% | ≥ 70% |
| Function Coverage | ≥ 85% | ≥ 80% |

### What MUST Be Unit Tested

**Backend:**
- Every service/use-case function — all code paths including error branches
- Every data validation function — valid, invalid, boundary, edge cases
- Every authorization/permission check — granted, denied, edge cases
- Every calculation/business logic function — normal, zero, negative, overflow
- Every data transformation/mapping function — round-trip integrity
- Every utility function with > 3 callers

**Frontend:**
- Every utility/helper function — pure functions tested exhaustively
- Every custom hook — all state transitions, cleanup
- Every data transformation/formatting function
- Every validation function — form validation rules
- Every state reducer — all action types, immutability

### Unit Test Standards

```
Each unit test MUST:
1. Be independent — no shared mutable state between tests
2. Be deterministic — same input always produces same output
3. Be fast — entire unit test suite < 30 seconds
4. Test behavior, not implementation — refactoring shouldn't break tests
5. Follow AAA pattern: Arrange → Act → Assert
6. Have descriptive names: "should [expected behavior] when [condition]"

Each unit test MUST test:
1. Happy path — normal input produces expected output
2. Error path — invalid input produces expected error
3. Edge cases — null, undefined, empty, boundary values
4. Invariant preservation — output format/structure consistent
```

### Example: Backend Unit Test (Jest)

```typescript
describe('TaskService.createTask', () => {
  // Happy path
  it('should create a task with valid input and return task with ID', async () => {
    const input = { title: 'Test task', dueDate: '2026-07-01', assigneeId: 'user-1' };
    const task = await taskService.createTask(input);
    expect(task.id).toBeDefined();
    expect(task.title).toBe('Test task');
    expect(task.status).toBe('TODO');
    expect(task.createdAt).toBeInstanceOf(Date);
  });

  // Validation
  it('should throw ValidationError when title is empty', async () => {
    await expect(taskService.createTask({ title: '' }))
      .rejects.toThrow(ValidationError);
  });

  // Authorization
  it('should throw ForbiddenError when user lacks CREATE_TASK permission', async () => {
    await expect(taskService.createTask(validInput, { user: unauthorizedUser }))
      .rejects.toThrow(ForbiddenError);
  });

  // Edge case
  it('should truncate title to 500 characters when input exceeds maximum', async () => {
    const longTitle = 'x'.repeat(1000);
    const task = await taskService.createTask({ ...validInput, title: longTitle });
    expect(task.title.length).toBe(500);
  });
});
```

### Example: Frontend Unit Test (Vitest)

```typescript
describe('useTaskFilter', () => {
  it('should return all tasks when filter is "all"', () => {
    const { result } = renderHook(() => useTaskFilter(mockTasks, 'all'));
    expect(result.current.filteredTasks).toHaveLength(mockTasks.length);
  });

  it('should filter tasks by status when filter is applied', () => {
    const { result } = renderHook(() => useTaskFilter(mockTasks, 'TODO'));
    expect(result.current.filteredTasks.every(t => t.status === 'TODO')).toBe(true);
  });

  it('should return empty array when no tasks match filter', () => {
    const { result } = renderHook(() => useTaskFilter([], 'TODO'));
    expect(result.current.filteredTasks).toHaveLength(0);
  });

  it('should memoize results until tasks or filter change', () => {
    const { result, rerender } = renderHook(
      ({ tasks, filter }) => useTaskFilter(tasks, filter),
      { initialProps: { tasks: mockTasks, filter: 'all' } }
    );
    const firstResult = result.current.filteredTasks;
    rerender({ tasks: mockTasks, filter: 'all' });
    expect(result.current.filteredTasks).toBe(firstResult); // Same reference
  });
});
```

---

## Level 2: Functional Tests (MANDATORY)

### What MUST Be Functionally Tested

**For every story**, verify:
1. Each acceptance criterion (Given/When/Then) has a corresponding test
2. Every UI state is tested: loading, empty, error, success, edge case
3. Every user interaction path in the story scope
4. Form validation: required fields, format validation, submission
5. Error handling: network failure, server error, timeout, retry

### Functional Test Standards

```
Each functional test MUST:
1. Map directly to a story acceptance criterion
2. Use the same language as the AC (traceable)
3. Be independent — can run in any order
4. Mock external dependencies (API calls, file system, etc.)
5. Test the component/page as the user experiences it
```

### Example: Functional Test (React Testing Library)

```typescript
describe('TaskBoard Page — Story S-1.2', () => {
  // AC-1: User sees tasks grouped by status columns
  it('AC-1: should display tasks grouped in TODO, IN_PROGRESS, DONE columns', async () => {
    render(<TaskBoard />);
    await screen.findByText('TODO');
    await screen.findByText('IN_PROGRESS');
    await screen.findByText('DONE');
    expect(screen.getByTestId('column-TODO')).toContainElement(screen.getByText('Task A'));
    expect(screen.getByTestId('column-DONE')).toContainElement(screen.getByText('Task C'));
  });

  // AC-2: User can drag task between columns
  it('AC-2: should update task status when dragged to another column', async () => {
    const { container } = render(<TaskBoard />);
    await screen.findByText('Task A');
    fireEvent.dragStart(screen.getByText('Task A'));
    fireEvent.drop(screen.getByTestId('column-DONE'));
    await waitFor(() => {
      expect(screen.getByTestId('column-DONE')).toContainElement(screen.getByText('Task A'));
    });
  });

  // AC-3: Empty state
  it('AC-3: should show empty state message when board has no tasks', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json([])));
    render(<TaskBoard />);
    await screen.findByText(/no tasks yet/i);
  });

  // AC-4: Error state
  it('AC-4: should show error message and retry button when API fails', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.error()));
    render(<TaskBoard />);
    await screen.findByText(/failed to load/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
```

---

## Level 3: Integration Tests (MANDATORY)

### What MUST Be Integration Tested

1. **API Contract Tests** — every endpoint verified against api-spec.yaml
2. **Database Migration Tests** — every migration up AND down tested
3. **Auth Flow** — login, token refresh, logout, permission enforcement across endpoints
4. **Cross-Service Integration** — any interaction between services
5. **Data Persistence** — round-trip: create → read → update → read → delete → verify gone

### API Contract Test Standards

```
Each API endpoint MUST have:
1. Happy path — valid request → valid response matching OpenAPI schema
2. Validation error — invalid request → 400 with error body matching schema
3. Auth error — no token → 401, wrong permissions → 403
4. Not found — valid ID that doesn't exist → 404
5. Response schema validation — actual response validated against OpenAPI schema
```

### Example: API Integration Test

```typescript
describe('POST /api/tasks', () => {
  // Happy path
  it('should create task and return 201 with task object matching schema', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ title: 'New task', dueDate: '2026-07-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchSchema('Task'); // Validates against OpenAPI schema
    expect(res.body.id).toBeDefined();
  });

  // Validation
  it('should return 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ dueDate: '2026-07-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.details).toContainEqual(
      expect.objectContaining({ field: 'title', code: 'required' })
    );
  });

  // Auth
  it('should return 401 when no token provided', async () => {
    const res = await request(app).post('/api/tasks').send(validInput);
    expect(res.status).toBe(401);
  });

  // DB migration test
  it('should persist task and be queryable after creation', async () => {
    const createRes = await request(app).post('/api/tasks')
      .set('Authorization', `Bearer ${validToken}`).send(validInput);
    const id = createRes.body.id;

    const getRes = await request(app).get(`/api/tasks/${id}`)
      .set('Authorization', `Bearer ${validToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.title).toBe(validInput.title);
  });
});
```

---

## Level 4: Playwright E2E Tests (MANDATORY for web applications)

### When Playwright is Required

Playwright E2E testing is MANDATORY when:
- The project has a web frontend (React, Vue, Next.js, Svelte, etc.)
- Any story involves a user-facing page or interaction
- Phase 4.13 (Integration) E2E Browser Acceptance gate

### Playwright Test Requirements

```
Every web application MUST have:
1. Smoke tests — critical path: login → core action → logout (3-5 flows)
2. Feature tests — one Playwright test per story acceptance criterion
3. Cross-browser tests — Chrome (chromium), Firefox, Safari (webkit)
4. Responsive tests — Mobile (375px), Tablet (768px), Desktop (1280px)
5. Visual regression tests — screenshot comparison, diff < 0.5%
6. Accessibility scans — axe-core integration at key pages
```

### Playwright Test Standards

```
Each Playwright test MUST:
1. Use page objects for maintainability — no direct selectors in tests
2. Wait for network idle before assertions — no arbitrary sleep() calls
3. Test real API calls — no mocking in E2E (use test database with seed data)
4. Capture screenshot on failure automatically
5. Run in CI — headless mode, parallel execution
6. Complete full suite in < 10 minutes
```

### Playwright Configuration

```typescript
// playwright.config.ts — REQUIRED for wdf-method projects
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['html', { outputFolder: 'e2e-report' }],
    ['json', { outputFile: 'e2e-report/results.json' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

### Page Object Pattern (REQUIRED)

```typescript
// e2e/pages/TaskBoardPage.ts
export class TaskBoardPage {
  constructor(private page: Page) {}

  // Selectors — centralized, no magic strings in tests
  private column = (status: string) => this.page.getByTestId(`column-${status}`);
  private taskCard = (title: string) => this.page.getByTestId('task-card').filter({ hasText: title });
  private createButton = () => this.page.getByRole('button', { name: /create task/i });
  private emptyState = () => this.page.getByText(/no tasks yet/i);

  // Actions — semantic, not implementation details
  async goto() { await this.page.goto('/board'); }
  async waitForLoad() { await this.page.waitForLoadState('networkidle'); }

  async createTask(title: string, assignee: string) {
    await this.createButton().click();
    await this.page.getByLabel(/title/i).fill(title);
    await this.page.getByLabel(/assignee/i).fill(assignee);
    await this.page.getByRole('button', { name: /save/i }).click();
  }

  async dragTaskToStatus(title: string, targetStatus: string) {
    await this.taskCard(title).dragTo(this.column(targetStatus));
  }

  async getTasksInColumn(status: string): Promise<string[]> {
    const cards = await this.column(status).getByTestId('task-card').allTextContents();
    return cards;
  }

  // Assertions — reusable verification
  async expectTaskInColumn(title: string, status: string) {
    await expect(this.column(status)).toContainText(title);
  }

  async expectEmptyState() {
    await expect(this.emptyState()).toBeVisible();
  }
}
```

### E2E Test Example

```typescript
// e2e/stories/S-1.2-task-board.spec.ts
import { test, expect } from '@playwright/test';
import { TaskBoardPage } from '../pages/TaskBoardPage';
import { loginAs } from '../helpers/auth';

test.describe('Story S-1.2: Task Board', () => {
  let board: TaskBoardPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'team-member');
    board = new TaskBoardPage(page);
    await board.goto();
    await board.waitForLoad();
  });

  // AC-1: User sees tasks grouped by status
  test('AC-1: should display tasks grouped in TODO, IN_PROGRESS, DONE columns', async () => {
    await expect(board.column('TODO')).toBeVisible();
    await expect(board.column('IN_PROGRESS')).toBeVisible();
    await expect(board.column('DONE')).toBeVisible();

    const todoTasks = await board.getTasksInColumn('TODO');
    expect(todoTasks.length).toBeGreaterThan(0);
    expect(todoTasks).toContain('Task A'); // From seed data
  });

  // AC-2: Drag and drop between columns
  test('AC-2: should move task to DONE column on drag and drop', async () => {
    await board.dragTaskToStatus('Task A', 'DONE');
    await board.expectTaskInColumn('Task A', 'DONE');
  });

  // AC-3: Empty state
  test('AC-3: should show empty state when no tasks exist', async ({ page }) => {
    // Use test helper to clear task data
    await page.evaluate(() => localStorage.setItem('test:clearTasks', 'true'));
    await page.reload();
    await board.expectEmptyState();
  });

  // Accessibility: axe-core scan
  test('a11y: should have no critical accessibility violations on board page', async ({ page }) => {
    await board.goto();
    await board.waitForLoad();
    const accessibilityScanResults = await page.evaluate(async () => {
      const axe = (window as any).axe;
      return await axe.run();
    });
    const violations = accessibilityScanResults.violations.filter(
      (v: any) => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(violations).toEqual([]);
  });
});

// Cross-browser: same test runs on chromium, firefox, webkit
// Responsive: same test runs on Desktop, Pixel 5, iPhone 13
```

---

## Acceptance Gate Criteria

### CODE_ACCEPTANCE Gate (Sub-phase 4.6)

```
All conditions MUST pass:

[ ] Unit test coverage ≥ threshold (BE: 80% line, 75% branch; FE: 75% line, 70% branch)
[ ] Functional tests: 100% of story acceptance criteria have passing tests
[ ] Integration tests: all API endpoints tested against OpenAPI schema
[ ] Database migrations: all migrations tested up AND down
[ ] Type check: zero errors (strict mode)
[ ] Lint: zero errors
[ ] No skipped or pending tests (no test.skip, no it.todo)
[ ] Test suite completes in CI without failures
```

### UI_ACCEPTANCE Gate (Sub-phase 4.12)

```
All conditions MUST pass:

[ ] Playwright E2E tests: 100% pass across all browsers (chromium, firefox, webkit)
[ ] Playwright E2E tests: 100% pass across all viewports (mobile, tablet, desktop)
[ ] Visual regression: diff < 0.5% from baseline screenshots
[ ] axe-core audit: 0 critical issues, 0 serious issues
[ ] Lighthouse Performance ≥ 90
[ ] Lighthouse Accessibility ≥ 90
[ ] Lighthouse Best Practices ≥ 90
[ ] Bundle size < 500KB (JS total, gzipped)
[ ] No console errors in E2E test runs
[ ] All network requests succeed (no 404, no CORS errors, no 500)
```

### FEATURE_ACCEPTANCE Gate (Sub-phase 4.13)

```
All conditions MUST pass:

[ ] All stories CODE_ACCEPTED
[ ] All stories UI_ACCEPTED (if frontend)
[ ] API contract compliance: 100% endpoints match OpenAPI spec
[ ] E2E critical paths pass: all smoke tests pass
[ ] Cross-browser: chromium + firefox + webkit all pass
[ ] Responsive: mobile + tablet + desktop all pass
[ ] Security audit: dependency audit zero critical/high, OWASP review complete
```

---

## Test Report Template

Every story MUST produce a test report at `{output_dir}/stories/{story_id}-test-report.md`.

See `assets/templates/testing/test-report.tmpl.md` for the required template.

## CI/CD Integration

Every project MUST have:

```yaml
# .github/workflows/test.yml — REQUIRED
name: Test Suite
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage, path: coverage/ }

  e2e:
    needs: unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: e2e-report/ }
```

## Non-Compliance

Any story that does not meet ALL test requirements at its acceptance gate:
1. Cannot enter CODE_ACCEPTED state
2. Cannot enter the merge queue
3. Must be returned to the developer agent with a specific test gap report
4. After 2 retries → escalate to blocking CR with test gap analysis
