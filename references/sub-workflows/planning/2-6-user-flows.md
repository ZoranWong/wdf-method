---
sub_workflow: "2-6-user-flows"
phase: 2
sub_phase: "2.6"
version: "3.6.0"
title: "Phase 2.6 — User Flows & Information Architecture"
description: "Map complete user flows for every persona, define the information architecture and site map, establish the navigation hierarchy, and document the structural design of the application."
dependencies: ["prd.md", "story-map.md"]
bmad_skills:
  - "/bmad-create-ux-design"
---

# Phase 2.6 — User Flows & Information Architecture

**Sub-Phase Goal:** Define every user flow (path from entry to goal completion), create the site map showing all pages and their relationships, and establish the information architecture — the structural design of the application's information spaces.

**Why This Matters:** User flows and IA define the skeleton of the user experience. Without them, wireframes and visual design lack structural grounding. This phase ensures every user goal has a clear, efficient path.

---

## FSM State Transition Table

| Current State    | Valid Transition    | Trigger / Condition                                  | Next State      |
|:-----------------|:--------------------|:-----------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins             | IN_PROGRESS     |
| IN_PROGRESS      | FLOWS_COMPLETE      | All user flows drafted for every persona             | FLOWS_DRAFTED   |
| FLOWS_DRAFTED    | SITEMAP_COMPLETE    | Site map and IA defined                              | IA_DRAFTED      |
| IA_DRAFTED       | VERIFY              | User verifies flows and IA                           | VERIFIED         |
| VERIFIED         | LOCK                | Artifact locked                                       | LOCKED          |
| NOT_STARTED      | (none)              | —                                                    | —               |
| IN_PROGRESS      | FAIL                | Irrecoverable error                                  | NOT_STARTED     |
| FLOWS_DRAFTED    | REVISE              | Flow changes needed                                  | IN_PROGRESS     |
| IA_DRAFTED       | RESTRUCTURE         | IA restructuring needed                              | FLOWS_DRAFTED   |
| VERIFIED         | UNLOCK              | Upstream PRD changed                                 | VERIFIED        |

**Final State:** `LOCKED`
**State persistence:** `sprint-status.yaml` key `phase_2_6`

---

## Gate Card

```yaml
gate_card:
  phase: 2.6
  gates:
    - check: prd.md.locked
      operator: equals
      expected: true
      fail_action: "HALT — PRD must be LOCKED before defining user flows"
    - check: story_map.md.locked
      operator: equals
      expected: true
      fail_action: "HALT — Story Map must be LOCKED before defining user flows"
  gate_pass_action: "Set phase_2_6 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 1 — Gate Card Check

Read `{sprint_tracking}/sprint-status.yaml`. Verify both gate conditions:
- `prd.md` status must be `locked: true`
- `story-map.md` status must be `locked: true`

If either condition fails, **HALT** and report which gate is not met.

If both gates pass, update `sprint-status.yaml`:

```yaml
phase_2_6: IN_PROGRESS
```

---

### Step 2 — Load Inputs

1. **`{prd_output}/prd.md`** — Extract:
   - All user personas and their goals
   - Feature list with priorities
   - Core user journeys
   - Platform/browser requirements

2. **`{requirements_output}/story-map.md`** — Extract:
   - Activity backbone (narrative flow)
   - User tasks under each activity
   - Story priorities and release slices

---

### Step 3 — Define User Flows (Per Persona)

For each persona identified in the PRD, map their complete journey through the application.

**User Flow Format:**

```
Flow Name: {descriptive name}
Persona: {primary persona}
Goal: {what they're trying to achieve}
Entry Point: {where they start}
Success State: {what completion looks like}

Step-by-Step:
  [Entry] → [Step 1] → [Step 2] → ... → [Success]
                ↓ [Error/Edge Case]
              [Error State] → [Recovery] → [Success]
```

**Required flows to define:**

For each persona, create flows for:
- **Happy path** — the ideal journey from entry to goal completion
- **First-time user** — onboarding experience
- **Returning user** — repeat usage flow
- **Error recovery** — what happens when things go wrong
- **Edge cases** — unusual but important scenarios

Create a flow for each major user goal:

```markdown
## User Flows — {Persona Name}

### Flow 1: {Goal Name}
- **Goal:** {what the user accomplishes}
- **Entry Point:** {where they start}
- **Preconditions:** {what must be true}
- **Success State:** {what completion looks like}

**Steps:**
1. User {action} → System {response}
2. User {action} → System {response}
3. ...

**Alternative Paths:**
- If {condition}: User goes to {alternative path}
- If {error}: System shows {error state} → User {recovery action}

**Exit States:**
- Success: {state}
- Abandon: {user leaves at step N}
- Error: {system failure state}
```

Add to `{user_flows_output}`.

---

### Step 4 — Information Architecture

Define the structure of information in the application.

#### 4a. Content Inventory

List ALL types of content the application will contain:

```markdown
## Content Types

| Content Type | Attributes | Owner/Author | Lifecycle |
|-------------|-----------|-------------|-----------|
| User Profile | name, email, avatar, bio | User | Create, update, delete |
| Blog Post | title, body, author, tags, date | Author | Draft, publish, archive |
| Product | name, price, description, images, stock | Admin | Create, update, discontinue |
| ... | ... | ... | ... |
```

#### 4b. Navigation Hierarchy

Define how content is organized and navigated:

```markdown
## Navigation Structure

### Primary Navigation
- {Nav Item 1}
  - {Sub Item 1a}
  - {Sub Item 1b}
- {Nav Item 2}
- {Nav Item 3}

### Secondary Navigation (Utility)
- Profile / Account
- Settings
- Notifications
- Help / Support

### Footer Navigation
- About
- Privacy Policy
- Terms of Service
- Contact
```

#### 4c. Taxonomy & Labeling

```markdown
## Taxonomy

| Domain Concept | Label Used | Synonyms Avoided | Notes |
|---------------|-----------|-----------------|-------|
| User Account | "Account" | "Profile" (confusing with public profile) | |
| Shopping Cart | "Cart" | "Basket", "Bag" | Consistency check |
| ... | ... | ... | ... |
```

Add to `{ia_output}`:

```markdown
# Information Architecture

## Content Model

{Content types and their structure}

## Navigation

{Primary, secondary, and utility navigation}

## Taxonomy

{Controlled vocabulary and labeling conventions}
```

---

### Step 5 — Site Map

Create a visual representation of all pages/screens and their relationships.

```markdown
# Site Map

## Page Inventory

| Page ID | Page Name | Route | Access | Personas |
|---------|-----------|-------|--------|----------|
| P-01 | Home Page | / | Public | All |
| P-02 | Login | /login | Public (unauthenticated) | All |
| P-03 | Register | /register | Public (unauthenticated) | New Users |
| P-04 | Dashboard | /dashboard | Authenticated | All Users |
| P-05 | User Profile | /profile/:id | Authenticated | All Users |
| P-06 | Settings | /settings | Authenticated | All Users |
| P-07 | Admin Panel | /admin | Admin | Admin |
| ... | ... | ... | ... | ... |

## Page Hierarchy

```
/
├── /login
├── /register
├── /dashboard
├── /profile/:id
│   └── /profile/:id/edit
├── /settings
│   ├── /settings/account
│   ├── /settings/notifications
│   └── /settings/billing
├── /admin
│   ├── /admin/users
│   ├── /admin/content
│   └── /admin/analytics
└── /404 (Not Found)
```
```

Add the site map to `{user_flows_output}` or `{ia_output}` (whichever is configured as the primary artifact for this phase).

---

### Step 6 — Flow Validation

Review every flow against these criteria:

| Check | Criterion |
|-------|----------|
| Completeness | Every user goal from the PRD has a mapped flow |
| Consistency | Similar goals have similar flow patterns |
| Efficiency | Can any step be eliminated? Is the shortest path the most obvious? |
| Error handling | Every flow includes error states and recovery paths |
| Persona alignment | Flows reflect persona-specific needs and behaviors |
| Cross-device | Consider desktop, tablet, and mobile entry points |

---

### Step 7 — Verification

Present the flows and sitemap to the user for verification:

> "Here are the user flows and site map. Let's verify:
> 1. Every persona's primary goals are covered
> 2. All pages from the PRD feature list are in the site map
> 3. Navigation hierarchy matches user expectations
> 4. No dead-end pages (every page has a way forward)
> 5. Error states are handled for every flow
> 6. Labels are consistent across the application"

Update `sprint-status.yaml`:

```yaml
phase_2_6: VERIFIED
```

---

### Step 8 — Report

Generate `{project-root}/user-flows-report.md`:

```yaml
---
artifact_id: "user-flows-report"
artifact_type: "report"
phase: "2.6"
status: "LOCKED"
created: "{iso-timestamp}"
personas_covered: 0
flows_defined: 0
pages_mapped: 0
---
```

Report body must include:
- Persona summary and flow coverage
- Full user flow listing (one section per persona)
- Site map diagram (ASCII art or text-based)
- IA summary (content model, navigation, taxonomy)
- Validation results
- Cross-reference table: PRD feature → user flow

---

## Phase Complete

Lock the phase in `sprint-status.yaml`:

```yaml
phase_2_6: LOCKED
phase_2_6_artifact: "user-flows-report.md"
phase_2_6_locked_at: "{iso-timestamp}"
```

This unlocks the gate for Phase 2.7 (Wireframes).
