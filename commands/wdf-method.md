---
name: wdf-method
description: Apply advanced elicitation methods to review and stress-test specs. 50 methods across 11 categories. Use during party mode or standalone.
argument-hint: "[N] | reshuffle | list [category] | [category]"
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Resume Party"
    command: /wdf-party
    prompt: "Return to party with method findings"
  - label: "Start Build"
    command: /wdf-build
    prompt: "Spec reviewed — start automated implementation"
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show project status"
scripts:
  sh: "echo 'wdf-method — applying advanced elicitation'"
---

# /wdf method — Advanced Elicitation

Apply structured thinking methods to review, stress-test, and improve the current specification. 50 methods across 11 categories.

## Usage

```
/wdf method N              — Run method #N on current spec
/wdf method reshuffle      — Get 5 new recommended methods
/wdf method list           — List all 50 methods
/wdf method list risk      — List methods in a category
/wdf method core           — Run all 6 core methods
/wdf method 39 "topic"     — Apply method to specific topic
```

## Execution

1. **Load method catalog**: Read `{skill-root}/references/methods/catalog.json`
2. **Load application guide**: Read `{skill-root}/references/methods/method-application.md`
3. **Load current spec**: Read the relevant artifact(s) under review
4. **Dispatch per method type**:

| Method Category | Dispatch Pattern |
|----------------|-----------------|
| collaborative | 2-4 agents in parallel, role-specific |
| competitive | 2 opposing agents + 1 judge |
| core/advanced/learning | 1 agent, deep structured prompt |
| risk | 2-3 agents, different risk perspectives |
| creative | 1-2 agents, divergent thinking |
| research | 2-3 agents, different research traditions |
| philosophical/reflection | 1 agent, structured reflection |

5. **Present findings**: Key insights (3-5), actionable recommendations, proposed spec changes
6. **User action**: Apply / Discuss / Move on

## Category Quick Reference

| # | Category | Methods | Best For |
|---|----------|---------|----------|
| 1-10 | collaborative | 10 | Multi-stakeholder, alignment, consensus |
| 11-16 | advanced | 6 | Complex reasoning, deep analysis |
| 17-19 | competitive | 3 | Security, adversarial testing |
| 20-24 | technical | 5 | Architecture, performance, security audit |
| 25-30 | creative | 6 | Innovation, breaking deadlocks |
| 31-33 | research | 3 | Evidence-based, prior art |
| 34-38 | risk | 5 | Failure prevention, reliability |
| 39-44 | core | 6 | Foundational thinking |
| 45-46 | learning | 2 | Knowledge verification |
| 47-48 | philosophical | 2 | Simplicity, ethics |
| 49-50 | reflection | 2 | Lessons learned, retrospectives |

## Example

```
/wdf method list              — Show all 50 methods
/wdf method list risk         — Show risk category (34-38)
/wdf method 17                — Run Red Team vs Blue Team
/wdf method reshuffle         — Get 5 new recommended methods
/wdf method 39 "our auth"     — Apply First Principles to auth design
```
