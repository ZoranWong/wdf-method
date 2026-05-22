---
sub_workflow: "3-5-component-synthesis"
phase: 3
sub_phase: "3.5"
version: "3.6.0"
title: "Phase 3.5 — Component Synthesis (C4 Level 3)"
description: "Design the component architecture (C4 Level 3) for each container. Decompose containers into components, define their interfaces, responsibilities, and interactions. Synthesize all C4 levels into the final architecture document."
dependencies:
  - container-design.md
  - quality-attributes.md (if not skipped)
methodology: "C4 Model by Simon Brown (Level 3)"
bmad_skills:
  - "/bmad-create-architecture"
---

# Phase 3.5 — Component Synthesis (C4 Level 3)

**Sub-Phase Goal:** For each container designed in Phase 3.3, decompose it into components (the building blocks within a container). Define component interfaces, responsibilities, and interactions. Synthesize all C4 levels into a comprehensive architecture document.

**Why This Matters:** Component-level design provides the blueprint that developers use to implement. It defines the internal structure of each container — the classes, modules, packages, and their interactions.

**Duration:** This sub-phase continues until all container component designs are drafted, verified, and locked.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin component decomposition |
| `IN_PROGRESS` | All components mapped | `COMPONENTS_MAPPED` | Component designs complete |
| `COMPONENTS_MAPPED` | Architecture doc synthesized | `ARCHITECTURE_COMPLETE` | Final architecture doc produced |
| `ARCHITECTURE_COMPLETE` | User verifies | `VERIFIED` | Design confirmed |
| `VERIFIED` | User locks | `LOCKED` | Architecture locked |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.5"
  enters_from: "3.3"
  checks:
    - id: "G3.5-01"
      description: "Container Design is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.substates.phase_3_3.status"
      operator: "eq"
      expected: "LOCKED"
  all_pass: false
```

---

## Step 1: Gate Card Check

Verify Phase 3.3 is LOCKED.

---

## Step 2: Load Architecture Context

Read:
- `{system_context_output}` — C4 Level 1
- `{architecture_style_output}` — ADR-001 (chosen style)
- `{container_design_output}` — C4 Level 2
- `{quality_attributes_output}` — QA analysis (if 3.4 was not skipped)

---

## Step 3: Component Decomposition (Per Container)

For each container from the C4 Level 2 diagram, decompose into components:

**What is a component?**
- A grouping of related functionality encapsulated behind a well-defined interface
- Examples: controllers, services, repositories, event handlers, middleware, UI components
- In Clean/Hexagonal Architecture: ports and adapters
- In MVC: models, views, controllers

### 3a. API Server Components

```markdown
## {API Server Container Name} — Component Design

### Component Diagram (C4 Level 3)

┌─────────────────────────────────────────────────────────┐
│  API Server [{technology}]                              │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Middleware  │  │ Controllers  │  │  Validators  │  │
│  │  Layer       │◄─┤              ├──►              │  │
│  └──────────────┘  └──────┬───────┘  └──────────────┘  │
│                           │                              │
│  ┌──────────────┐  ┌──────▼───────┐  ┌──────────────┐  │
│  │  Services    │◄─┤              ├──►│  DTOs        │  │
│  │              │  │              │  │              │  │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  │
│         │                                                │
│  ┌──────▼───────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Repositories │  │  Auth Module │  │  Error       │  │
│  │              │  │              │  │  Handler     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Component Inventory

| Component | Type | Responsibility | Depends On | Interface |
|-----------|------|----------------|-----------|-----------|
| `Middleware Layer` | Infrastructure | Auth, CORS, logging, rate limiting | — | HTTP middleware pipeline |
| `Controllers` | Interface | Request handling, response formatting | Services, DTOs, Validators | Express route handlers |
| `Services` | Domain | Business logic, orchestration | Repositories, external clients | Class with public methods |
| `Repositories` | Infrastructure | Data access, query execution | Database client | Interface with CRUD methods |
| `Validators` | Infrastructure | Input validation against schemas | — | Zod/Joi schemas |
| `DTOs` | Interface | Request/response type definitions | — | TypeScript interfaces/types |
| `Auth Module` | Domain | Authentication, authorization | User Repository | `authenticate()`, `authorize()` |
| `Error Handler` | Infrastructure | Error normalization and response | — | Express error middleware |
```

### 3b. Web Application (SPA) Components

```markdown
## {Web App Container Name} — Component Design

### Component Inventory

| Component | Type | Responsibility | Depends On | Interface |
|-----------|------|----------------|-----------|-----------|
| `Router` | Infrastructure | Route matching, guards, lazy loading | Pages | Route config |
| `Pages` | Interface | Full-page components, composition | Shared Components, Hooks, API Client | Page component |
| `Shared Components` | UI | Reusable UI primitives (Button, Input, etc.) | Design Tokens | Props interface |
| `Hooks/Composables` | Logic | Reusable stateful logic | API Client, Stores | Hook function |
| `API Client` | Infrastructure | HTTP client, interceptors, error handling | — | Axios/fetch instance |
| `Stores` | State | Global/client state management | API Client | Store interface (Zustand/Pinia) |
| `Design Tokens` | UI | CSS custom properties, theme | — | CSS variables |
| `Utils` | Logic | Pure utility functions | — | Functions |
```

### 3c. Database Container Components

```markdown
## Database — Component Design

| Component | Type | Responsibility |
|-----------|------|----------------|
| `Migrations` | Infrastructure | Schema versioning and evolution |
| `Seeds` | Infrastructure | Development/test data |
| `Functions/Procedures` | Domain | Complex data operations |
| `Views` | Interface | Pre-composed queries |
| `Indexes` | Infrastructure | Query performance optimization |
```

---

## Step 4: Document Component Interfaces

For each major component, document its interface:

```markdown
## Component Interfaces

### UserService

```typescript
interface IUserService {
  // Queries
  findById(id: string): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  listUsers(params: ListParams): Promise<PaginatedResult<User>>;

  // Commands
  createUser(data: CreateUserDTO): Promise<User>;
  updateUser(id: string, data: UpdateUserDTO): Promise<User>;
  deleteUser(id: string): Promise<void>;

  // Auth
  verifyCredentials(email: string, password: string): Promise<User>;
  changePassword(userId: string, oldPw: string, newPw: string): Promise<void>;
}
```

### UserRepository

```typescript
interface IUserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: CreateUserData): Promise<UserRecord>;
  update(id: string, data: Partial<UserData>): Promise<UserRecord>;
  delete(id: string): Promise<void>;
  list(params: QueryParams): Promise<{ records: UserRecord[]; total: number }>;
}
```
```

---

## Step 5: Document Data Flow

For key operations, trace the data flow through components:

```markdown
## Data Flow: User Registration

1. **SPA → API** (HTTP POST /api/v1/auth/register)
   - SPA: `RegisterPage` → `useRegister` hook → `apiClient.post()`
   - Request body: `{ email, password, name }`

2. **API Server** (Internal flow)
   ```
   Request
     → Auth Controller (extract body)
     → Validator (validate schema)
     → Auth Service (check email not taken, hash password)
     → User Repository (INSERT INTO users)
     → Email Service (send verification email) [async]
     → Auth Service (generate JWT tokens)
     → Response (201 + tokens + user object)
   ```

3. **SPA** (Response handling)
   ```
   Response (201)
     → apiClient interceptor (store tokens)
     → Auth Store (set user, isAuthenticated = true)
     → Router (navigate to /dashboard)
     → Toast (show "Welcome, {name}!")
   ```
```

---

## Step 6: Invoke BMAD Architecture Skill

**Invoke `/bmad-create-architecture`** to synthesize all C4 levels into a comprehensive architecture document at `{architecture_output}`.

The BMAD skill should receive context from:
- `{system_context_output}` (C4 L1)
- `{container_design_output}` (C4 L2)
- `{component_design_output}` (C4 L3 + component interfaces)
- `{architecture_style_output}` (ADR-001)
- `{quality_attributes_output}` (if 3.4 not skipped)

---

## Step 7: Synthesize Architecture Document

Verify the final `{architecture_output}` includes:

```markdown
## Architecture Document Checklist

- [ ] **Executive Summary** — Architecture overview for stakeholders
- [ ] **System Context (C4 L1)** — System boundary, actors, external systems
- [ ] **Container Diagram (C4 L2)** — Container decomposition and technology choices
- [ ] **Component Design (C4 L3)** — Internal component diagrams for each container
- [ ] **Architecture Style** — Summary of ADR-001 with rationale
- [ ] **Technology Stack** — Complete list of technologies, versions, purpose
- [ ] **Data Architecture** — Data model overview, database schema, storage strategy
- [ ] **Security Architecture** — Auth flow, threat model summary, security controls
- [ ] **Deployment Architecture** — Deployment topology, environments, CI/CD
- [ ] **Quality Attributes** — How architecture addresses each QA, tradeoffs
- [ ] **ADRs** — All Architecture Decision Records
- [ ] **Known Risks & Gaps** — Acknowledged risks and mitigation strategies
- [ ] **Architecture Decision Log** — Chronological log of all architectural decisions
```

---

## Step 8: Verify and Lock

Present the complete architecture for final review:

> "Here's the complete architecture — C4 Levels 1-3 + ADRs + quality analysis. Let's verify:
> 1. All three C4 levels are consistent (no contradictions)
> 2. Component designs are complete for every container
> 3. Component interfaces are fully specified
> 4. Data flows are traced for critical operations
> 5. Architecture addresses all quality attributes from PRD
> 6. All ADRs are documented with context and rationale
>
> Does this architecture represent the complete system design? [Approve / Revise]"

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    status: "LOCKED"
    substates:
      phase_3_5:
        status: "LOCKED"
        artifacts:
          - { type: "component_design", path: "{component_design_output}", status: "locked" }
          - { type: "architecture", path: "{architecture_output}", status: "locked" }
```

---

## Step 9: Completion

Present summary:

> "Phase 3.5 complete — Component design and architecture synthesis locked."
>
> "Artifacts: `{component_design_output}`, `{architecture_output}`."
>
> "Summary: Full C4 architecture (L1-L3), {N} ADRs, {M} components across {K} containers."
>
> "Phase 3 (Solutioning) is now LOCKED. All architecture decisions are documented and ready for Phase 4 (Implementation)."

Return to the Phase 3 sub-phase menu.
