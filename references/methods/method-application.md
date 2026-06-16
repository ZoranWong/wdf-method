# WDF Method — Advanced Elicitation Methods

**Version:** 3.8.0
**Total Methods:** 50 across 11 categories

---

## How to Use

### In Party Mode (Round 2+)

After Round 3 (Architecture) converges, the orchestrator presents:

```
── Round 2: Advanced Elicitation ──

The spec is drafted. Now stress-test it with different lenses.

Selected for this project (based on complexity + domain):
  1. Red Team vs Blue Team — attack surface analysis
  2. Architecture Decision Records — explicit trade-offs
  3. Pre-mortem Analysis — what could cause failure?
  4. Challenge from Critical Perspective — devil's advocate
  5. Occam's Razor Application — complexity elimination

  r. Reshuffle — pick 5 new methods
  a. List All — see all 50 methods
  x. Proceed — spec is ready, enter build phase

Choose [1-5, r, a, x]:
```

### Method Selection Algorithm

When user types `r` (reshuffle), the system selects 5 new methods using context-aware sampling:

```
1. Complexity check:
   - simple project → bias toward core + philosophical
   - standard project → bias toward technical + risk + competitive
   - complex project → bias toward advanced + collaborative + research

2. Domain check:
   - regulated domain (fintech/healthtech) → risk + competitive methods
   - consumer domain (ecommerce/gaming) → creative + collaborative methods
   - infrastructure domain (saas/iot) → technical + advanced methods

3. Diversity constraint:
   - No more than 2 methods from the same category
   - At least 3 categories represented
   - Methods from Round 2 round 1 excluded

4. Novelty bonus:
   - Methods not used in any prior review round get +20% selection weight
   - Methods used in the most recent round get -50% selection weight
```

### Direct Invocation

During any party round or sequential phase:

```
/wdf method 17          — Run method #17 (Red Team vs Blue Team)
/wdf method core        — Run all 6 core methods sequentially
/wdf method reshuffle   — Get 5 new recommended methods
/wdf method list        — Show all 50 methods with categories
/wdf method list risk   — Show only risk category methods
```

### Standalone Usage

Outside of party/build flow:

```
/wdf method 39 "our authentication system"  — Apply First Principles to a specific component
/wdf method 47 "the current architecture"   — Apply Occam's Razor to simplify
```

---

## Category Reference

| Category | Count | Best For | Example Methods |
|----------|-------|----------|-----------------|
| **collaborative** | 10 | Multi-stakeholder alignment | Stakeholder Round Table, Debate Club, Cross-Functional War Room |
| **advanced** | 6 | Complex reasoning problems | Tree of Thoughts, Self-Consistency Validation, Reasoning via Planning |
| **competitive** | 3 | Security, high-stakes systems | Red Team vs Blue Team, Shark Tank Pitch, Code Review Gauntlet |
| **technical** | 5 | Architecture, performance | ADR, Algorithm Olympics, Security Audit Personas, Performance Profiler |
| **creative** | 6 | Innovation, breaking deadlocks | SCAMPER, Reverse Engineering, What If Scenarios, Genre Mashup |
| **research** | 3 | Evidence-based decisions | Literature Review, Thesis Defense, Comparative Analysis Matrix |
| **risk** | 5 | Reliability, safety-critical | Pre-mortem, Failure Mode Analysis, Chaos Monkey Scenarios |
| **core** | 6 | Foundational thinking | First Principles, 5 Whys, Socratic Questioning, Critique and Refine |
| **learning** | 2 | Knowledge verification | Feynman Technique, Active Recall Testing |
| **philosophical** | 2 | Ethics, simplicity | Occam's Razor, Trolley Problem Variations |
| **reflection** | 2 | Post-mortem, learning | Hindsight Reflection, Lessons Learned Extraction |

---

## Method Application Flow

```
1. User invokes method (via party Round 2, /wdf method N, or auto-selection)

2. Orchestrator dispatches sub-agents based on method type:
   - collaborative → 2-4 agents in parallel with role-specific instructions
   - competitive → 2 opposing agents + 1 judge agent
   - core/advanced → 1 agent with deep structured prompt
   - risk → 2-3 agents with different risk perspectives
   - creative → 1-2 agents with divergent thinking instructions

3. Sub-agents apply the method to the current spec/project context

4. Orchestrator presents findings:
   - Method name + category
   - Key insights (3-5 bullet points)
   - Actionable recommendations
   - Spec changes proposed (if any)

5. User decides: apply changes, discuss further, or move on

6. Method result recorded in project memory for future reference
```

## Integration with First Principles

All methods operate within the First Principles framework. Before applying any method, the orchestrator verifies:
- Are assumptions explicitly listed?
- Are constraints classified (P0-P3)?
- Is the problem statement clear?

If not, run First Principles Analysis (method #39) first as a prerequisite.
