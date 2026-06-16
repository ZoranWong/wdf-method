---
name: wdf-accept
description: Run acceptance checks on code, UI, features, or E2E browser.
argument-hint: "code | ui | feature | e2e"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show acceptance results in status"
  - label: "Process Merge Queue"
    command: /wdf-queue
    prompt: "Process CODE_ACCEPTED stories in merge queue"
scripts:
  sh: "echo 'wdf-method accept — running validation'"
---

# /wdf-accept — Acceptance Checks

Run one of the four executable acceptance gates. These replace verbal approval with automated validation.

## Pre-Execution Checks

**Check for relevant stories:**
- Verify target stories exist and are in CODE_ACCEPTANCE state
- If no stories ready: suggest `/wdf-status` to find eligible stories
- Check for extension hooks: read `.wdf/extensions.yml` for `before_wdf_accept` hooks

**Check for required tooling:**
- Code acceptance: verify linter, test runner, type checker, jscpd (duplicate detection), dependency-cruiser (cyclic deps)
- UI acceptance: verify Playwright, lighthouse, axe-core, stylelint, design token checker
- QA review: verify QA agent is available for independent code + design review

**Load QA Standards:**
- `{skill-root}/references/testing/testing-standards.md` — 4-layer testing pyramid
- `{skill-root}/references/testing/qa-acceptance-standards.md` — code review + design review criteria
- `{skill-root}/references/testing/bug-fix-lifecycle.md` — bug → fix → retest spiral iteration (MANDATORY)

**Spiral iteration is MANDATORY.** Test failures and QA findings generate bug reports. Bug reports generate fix documents. Fix → retest → re-review → iterate until 0 issues. No story is accepted with open bugs.

## Execution

**Testing standards are MANDATORY.** Read `{skill-root}/references/testing/testing-standards.md` before running any acceptance check. All test levels (Unit → Functional → Integration → Playwright E2E) must be verified per the Testing Pyramid.

1. **Load spec**: Read `{skill-root}/SKILL.md`, `{skill-root}/customize.toml`, `{skill-root}/references/testing/testing-standards.md`
2. **Parse arguments**:
   - `/wdf-accept code` — CODE_ACCEPTANCE: unit coverage ≥ threshold, functional tests 100% AC coverage, integration tests all endpoints + migrations, type check + lint, review passed. Use test report template `assets/templates/testing/test-report.tmpl.md`.
   - `/wdf-accept ui` — UI_ACCEPTANCE: Playwright E2E all browsers/viewports pass, visual regression < 0.5%, axe-core 0 critical/serious, Lighthouse ≥ 90, bundle < 500KB. Playwright config from `references/testing/testing-standards.md` is REQUIRED.
   - `/wdf-accept feature` — FEATURE_ACCEPTANCE: all stories code+ui accepted, contract verified, E2E smoke tests pass, security audit clean
   - `/wdf-accept e2e` — E2E_BROWSER_ACCEPTANCE: cross-browser (chromium + firefox + webkit), responsive (mobile + tablet + desktop), network (slow 3G + offline), visual regression < 0.5%
3. **Validate prerequisites**: Check target gate's preconditions per phase gate card
4. **Execute acceptance**: Run the checks defined in the phase's acceptance protocol
5. **Record results**: Update status files with pass/fail and metrics

## Full Spec

See `SKILL.md` section "## Acceptance Command Patterns" for all 4 acceptance gate schemas and thresholds.

## Example

```
/wdf-accept code        — Run code acceptance on backend stories
/wdf-accept e2e         — Run E2E browser acceptance testing
```
