---
name: wdf-party
description: Multi-agent requirements meeting — experts discuss and debate to produce high-quality specs. 3 rounds: Discovery → Design → Architecture.
argument-hint: "\"project description\""
platforms: [claude, codex, cursor, copilot, gemini, windsurf]
handoffs:
  - label: "Start Building"
    command: /wdf-build
    prompt: "Requirements confirmed — start automated implementation"
  - label: "Sequential Planning"
    command: /wdf-start
    prompt: "Switch to step-by-step planning mode"
  - label: "View Dashboard"
    command: /wdf-status
    prompt: "Show current project status"
scripts:
  sh: "echo 'wdf-method party — assembling experts'"
---

# /wdf party — Requirements Party Mode

Multi-agent requirements meeting. Expert agents collaborate like a real product team: an analyst, product manager, UX designer, architect, and story planner discuss your project together, debate trade-offs, and converge on a complete requirements specification.

**You are the stakeholder.** You answer questions, resolve disagreements, and approve each round's output.

## Meeting Structure

```
/wdf party "description"
        ↓
  ROUND 1: DISCOVERY — Problem space & personas
        ↓
  ROUND 2: DESIGN — User experience & requirements
        ↓
  ROUND 3: ARCHITECTURE — System design & stories
        ↓
  WRAP-UP — Ready to Build confirmation
        ↓
  Phase 4: Automated implementation
```

## External Domain Experts

For projects requiring specialized knowledge (healthcare, finance, legal, IoT, gaming, etc.), invite external experts to join the party.

### Inviting an External Expert

Before starting the party, the user declares:

```
/wdf party "a HIPAA-compliant patient portal" --expert "healthcare-compliance"
```

Or during any round:

```
/invite {domain} — "We need a {domain} expert's perspective on {topic}"
```

### How External Experts Participate

External experts are NOT pre-defined agents. They are **user-provided context**. The orchestrator asks the user to define the expert:

```
── External Expert Needed ──
Domain: healthcare-compliance
Round: Design
Topic: Data privacy and consent flows

Please describe your domain expert:
1. Name/Role: (e.g., "Healthcare Compliance Officer")
2. Expertise: (e.g., "HIPAA, GDPR-health, patient data consent, medical record audit trails")
3. Key concerns for this project: (e.g., "PHI encryption at rest, audit logging, patient consent revocation")
─────────────────────────────
```

The user provides the expert definition, then the orchestrator dispatches the expert as an additional parallel sub-agent alongside the standard agents for that round. The expert receives:
- The same round agenda + project context
- A custom prompt: `{skill-root}/references/party/external-expert.md`
- The user's expert definition as their "persona"

### External Expert Protocol

```
Round N: {TITLE}
─────────────────
Participants:
  🧠 Analyst — WDF Analyst
  📋 Product Manager — WDF PM
  👤 {Expert Name} — User-defined {Domain} Expert  ← EXTERNAL
─────────────────

All agents (including external) dispatched in parallel.
External expert's response displayed alongside standard agents.
External expert participates in cross-talk.
```

### Multiple External Experts

For complex projects, invite multiple experts:

```
/wdf party "a fintech trading platform" --expert "sec-compliance,market-microstructure,crypto-custody"
```

Max 3 external experts per round (total agents ≤ 6 per round).

### External Expert User Commands

| Command | Effect |
|---------|--------|
| `/invite {domain}` | Invite a new external expert |
| `/dismiss {expert}` | Remove an external expert from current round |
| `/ask-expert {name} {q}` | Direct a question to a specific external expert |
| `/expert-list` | Show all invited experts and their domains |

## Party Protocol

For each round, follow this exact protocol:

### 0. FIRST PRINCIPLES CHECK (Facilitator)

Before each round, execute a First Principles analysis. Read `{skill-root}/references/principles/first-principles.md` for the full methodology.

Present to the user:

```
── First Principles Check: Round {N} ──

Key Assumptions to Challenge:
  1. {assumption} → Counter: {why it might be wrong}
  2. {assumption} → Counter: {why it might be wrong}
  3. {assumption} → Counter: {why it might be wrong}

Constraints Audit:
  Hard (P0): {N} — {examples}
  Strong (P1): {N} — {examples}
  Assumed (P2-P3): {N} being removed or downgraded

Unvalidated Hypotheses (from prior rounds):
  {carry-over assumptions that still need validation}

Question for Stakeholder:
  "Before we proceed — is there anything we're taking for granted
   that we should be questioning more deeply?"
─────────────────────────────────────────
```

### 1. AGENDA (Facilitator)

Present the round agenda:

```
═══════════════════════════════════════════
Round {N}: {TITLE} — {DURATION}
═══════════════════════════════════════════
Goal: {one sentence}
Context: {what we know from previous rounds}
Deliverable: {artifact to produce}
───────────────────────────────────────────
Participants: {emoji} {role} — {expertise}
═══════════════════════════════════════════
```

### 2. PARALLEL RESPONSES

Dispatch participants as sub-agents simultaneously. Each agent receives:
- Their party prompt from `{skill-root}/references/party/{role}-party.md`
- The round agenda and project context
- Previous round outputs (for Rounds 2 and 3)
- A <400-word summary of the discussion so far

**CRITICAL**: Dispatch all agents for this round in a SINGLE message with multiple Agent tool calls. They must run in parallel to produce genuinely independent perspectives.

### 3. CROSS-TALK

After all agents return, present their responses to each other. Ask each agent to identify:
- **Agreements**: "We agree on..."
- **Disagreements**: "I disagree with {agent} on {point} because..."
- **Gaps**: "We haven't addressed..."

Display the cross-talk results to the user:

```
── Agreements ──
✓ {point} — {agents} agree

── Disagreements ──
✗ {point}
  {agent A}: {position}
  {agent B}: {position}

── Gaps ──
? {topic} — not yet addressed
```

### 4. CONVERGENCE

Present the synthesis to the user. Ask the user to decide on disagreements:

```
── Proposed Convergence ──
{summary of agreed-upon decisions}

Decisions needed from stakeholder:
1. {disagreement} → [A] {agent A's position}  [B] {agent B's position}
2. {gap} → What is your preference?

Reply: /agree | /decide 1=A 2="my preference" | /debate {topic}
```

### 5. GATE

After convergence, validate and write the artifact:

- Run `wdf validate --content {artifact}` to check required sections
- If validation fails: agents revise, re-converge
- If validation passes: write artifact, proceed

---

## Round 1: Discovery

**Goal**: Understand the problem space, target users, and solution hypotheses.

**Participants**: Analyst, Product Manager

**Agenda topics**:
- What problem are we solving? Who has this problem?
- Who are the target users? What are their goals and pain points?
- What existing solutions exist? What do they miss?
- What are our hypotheses for solving this?

**Deliverable**: `product-brief.md`

---

## Round 2: Design

**Goal**: Define the user experience, requirements, and design language.

**Participants**: Product Manager, UX Designer

**Context**: product-brief.md from Round 1

**Agenda topics**:
- What are the core user flows? Primary + secondary + error paths
- What are the key pages/screens? Layout and component inventory
- What are the functional requirements? (FR-{NNN} format)
- What are the design tokens? (colors, typography, spacing)
- How do we measure success?

**Deliverable**: `prd.md` + `user-flows.md` + `wireframes.md` + `design-tokens.md`

---

## Round 3: Architecture

**Goal**: Design the system architecture, epics, stories, API, and data model.

**Participants**: Architect, Story Planner, API Designer

**Context**: PRD + UX artifacts from Round 2

**Agenda topics**:
- What is the system architecture? (C4 L1-L3, ADRs)
- What are the epics and feature breakdown?
- What are the individual stories? (with acceptance criteria, scope, dependencies)
- What is the API contract? (endpoints, schemas, auth)
- What is the data model? (entities, relationships, migrations)

**Deliverable**: `architecture.md` + `epics.md` + `stories/*.md` + `api-spec.yaml` + `db-schema.md`

---

## User Commands

During any party round, the user can use these inline commands:

| Command | Effect |
|---------|--------|
| `/agree` | Accept convergence, proceed to next round |
| `/disagree {point}` | Flag a specific point for re-discussion |
| `/ask {agent} {question}` | Direct a question to a specific agent |
| `/debate {topic}` | Ask all agents to debate a specific topic |
| `/decide {N}={choice}` | Make a specific decision on a disagreement |
| `/skip` | Skip this round (simple projects) |
| `/next` | Move to next round (save current state) |
| `/pause` | Save party state and exit to Main Menu |
| `/retro` | Re-open previous round for revision |
| `/method` | Enter Round 2 advanced elicitation (50 methods) |

## Round 2: Advanced Elicitation (Optional)

After Round 3 converges, before "Ready to Build":

```
── Round 2: Advanced Elicitation ──

Auto-selected for this project:
  1. Red Team vs Blue Team (competitive)
  2. ADR formalization (technical)
  3. Pre-mortem Analysis (risk)
  4. Challenge from Critical Perspective (risk)
  5. Occam's Razor Application (philosophical)

  r. Reshuffle  a. List All  x. Proceed
```

Full catalog: `{skill-root}/references/methods/catalog.json` (50 methods, 11 categories)
Guide: `{skill-root}/references/methods/method-application.md`
Quick: `/wdf method N` for direct invocation

## After Party: Ready to Build

After all 3 rounds converge, present the build gate:

```
═══════════════════════════════════════════
Party Complete — Requirements Confirmed
═══════════════════════════════════════════
Artifacts produced:
  ✓ product-brief.md
  ✓ prd.md  ✓ user-flows.md  ✓ design-tokens.md
  ✓ architecture.md  ✓ epics.md
  ✓ {N} stories  ✓ api-spec.yaml  ✓ db-schema.md

[Y] Start automated build  [R] Review an artifact  [P] Party on (additional round)
═══════════════════════════════════════════
```

## Full Spec

See:
- `references/party/*.md` for per-agent party prompts
- `SKILL.md` "## On Activation" for phase execution
- `SKILL.md` "## BMAD Skill Invocation Map" for agent dispatch

## Example

### Standard Party
```
/wdf party "a team task management dashboard with React + Express + PostgreSQL"

Round 1: Discovery
[Analyst]: "I see 3 core problems: task visibility, team coordination, deadline tracking..."
[PM]: "Primary personas: team lead (needs overview), team member (needs focus)..."
→ User: /agree
...
```

### Party with External Expert
```
/wdf party "a HIPAA-compliant patient portal" --expert "healthcare-compliance"

─ Inviting healthcare-compliance expert ─
User defines: "Healthcare Compliance Officer — HIPAA, PHI protection, patient consent, 
               audit trail requirements, breach notification procedures"

Round 2: Design
[UX]: "Patient portal: dashboard → appointments → messages → medical records..."
[PM]: "FR-001: Patients MUST be able to view and download their medical records..."
[Healthcare Compliance Officer]: "Critical missing requirements:
  1. FR-XXX: System MUST log ALL PHI accesses with user ID, timestamp, and purpose
  2. FR-XXX: Patients MUST be able to revoke consent per 45 CFR 164.520
  3. FR-XXX: Session MUST auto-terminate after 15 min inactivity per HIPAA technical safeguard
  4. Data export MUST support both FHIR R4 and C-CDA formats for interoperability"
→ User: /agree
→ PM rewrites FR list incorporating compliance requirements
```
