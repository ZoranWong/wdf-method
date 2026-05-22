---
sub_workflow: "3-3-container-design"
phase: 3
sub_phase: "3.3"
version: "3.6.0"
title: "Phase 3.3 — Container Design (C4 Level 2)"
description: "Design the container architecture (C4 Level 2) — decompose the system into deployable containers (web app, API server, database, file storage, message broker, etc.), define their responsibilities, technology choices, and communication patterns."
dependencies:
  - system-context.md
  - architecture-style.md (ADR-001)
methodology: "C4 Model by Simon Brown (Level 2)"
bmad_skills:
  - "/bmad-create-architecture"
---

# Phase 3.3 — Container Design (C4 Level 2)

**Sub-Phase Goal:** Decompose the system into containers (separately deployable/runnable units). Define each container's technology stack, responsibilities, inter-container communication, and deployment topology.

**Why This Matters:** Container design bridges high-level system context and detailed component design. It defines the "shape" of the system — what runs where, what talks to what, and what technology powers each piece.

**Duration:** This sub-phase continues until the container design is drafted, verified, and locked.

---

## FSM State Transition Table

| Current State | Trigger | Next State | Description |
|--------------|---------|-----------|-------------|
| `NOT_STARTED` | Sub-phase selected | `IN_PROGRESS` | Begin container decomposition |
| `IN_PROGRESS` | Containers identified | `CONTAINERS_DESIGNED` | All containers mapped |
| `CONTAINERS_DESIGNED` | Technology choices made + ADRs | `TECH_CHOSEN` | Tech stack decided |
| `TECH_CHOSEN` | User verifies | `VERIFIED` | Design confirmed |
| `VERIFIED` | User locks | `LOCKED` | Container design locked |

---

## Gate Card

```yaml
gate_card:
  phase: 3
  sub_phase: "3.3"
  enters_from: "3.2"
  checks:
    - id: "G3.3-01"
      description: "Architecture Style ADR (3.2) is LOCKED"
      type: "dependency_status"
      source: "{sprint_tracking}"
      field: "phases.phase_3.substates.phase_3_2.status"
      operator: "eq"
      expected: "LOCKED"
  all_pass: false
```

---

## Step 1: Gate Card Check

Verify Phase 3.2 is LOCKED.

---

## Step 2: Load Context

Read:
- `{system_context_output}` — external actors and systems
- `{architecture_style_output}` — ADR-001 (selected style)
- `{prd_output}` — feature requirements

---

## Step 3: Decompose into Containers

Based on the chosen architecture style, decompose the system into containers.

**What is a container?**
- A separately deployable/runnable unit (e.g., a web server, an API server, a database, a file system, a mobile app, a browser-based SPA)
- Runs as a process in its own space
- Communicates with other containers via inter-process communication (HTTP, messaging, etc.)

For each container, capture:

```markdown
## Container Inventory

### {Container Name}
- **Type:** {Web Application / API Server / Database / File Storage / Message Broker / Mobile App / SPA / etc.}
- **Technology:** {Node.js + Express / Python + FastAPI / PostgreSQL / Redis / AWS S3 / etc.}
- **Responsibilities:** {what this container owns and does}
- **Deployment:** {how and where it runs — Docker container, serverless function, managed service}
```

Typical container types to consider:

| Container Type | Common Technologies | Deployment |
|---------------|-------------------|------------|
| Web App / SPA | React, Vue, Angular (static files) | CDN, Nginx, S3 |
| API Server | Express, Nest.js, FastAPI, Django | Docker container |
| Database | PostgreSQL, MongoDB, MySQL | Managed service or container |
| Cache | Redis, Memcached | Managed service or container |
| File Storage | AWS S3, MinIO, local filesystem | Managed service |
| Message Broker | RabbitMQ, Kafka, AWS SQS | Managed service or container |
| Background Worker | Bull/BullMQ, Celery, Sidekiq | Docker container |
| Search Engine | Elasticsearch, Meilisearch, Typesense | Managed service or container |
| Identity Provider | Auth0, Keycloak, Supabase Auth | SaaS or container |

---

## Step 4: Create the Container Diagram

```markdown
## Container Diagram (C4 Level 2)

┌──────────────────────────────────────────────────────┐
│                                                      │
│  ┌──────────┐                                        │
│  │  {User}  │                                        │
│  └─────┬────┘                                        │
│        │ Uses [HTTPS]                                │
│        ▼                                             │
│  ┌─────────────────────────────────────┐             │
│  │      Web Application / SPA          │             │
│  │      [{framework}]                  │             │
│  │      [Container: {name}]            │             │
│  └──────────────┬──────────────────────┘             │
│                 │ Makes API calls [HTTPS/JSON]        │
│                 ▼                                     │
│  ┌─────────────────────────────────────┐             │
│  │      API Server                     │             │
│  │      [{technology}]                 │             │
│  │      [Container: {name}]            │             │
│  └──┬──────┬─────────────┬─────────────┘             │
│     │      │             │                            │
│     │[SQL] │[Cache]      │[File Storage]              │
│     ▼      ▼             ▼                            │
│  ┌──────┐ ┌──────┐  ┌──────────┐                     │
│  │DB    │ │Cache │  │File Store│                     │
│  │{tech}│ │{tech}│  │{tech}    │                     │
│  └──────┘ └──────┘  └──────────┘                     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Step 5: Technology Choices

For each container, make explicit technology decisions. Create ADRs for decisions that have significant trade-offs.

```yaml
# ADR-002: API Server Technology
# ADR-003: Database Selection
# ADR-004: Frontend Framework
# ADR-005: Cache Strategy
# ADR-006: File Storage Strategy
# ADR-007: Deployment Platform
```

Use the same ADR template as 3.2 for each.

---

## Step 6: Communication Patterns

Document how containers communicate:

```markdown
## Inter-Container Communication

| From | To | Protocol | Data Format | Sync/Async | Resilience |
|------|----|----------|------------|------------|-----------|
| SPA | API Server | HTTPS | JSON | Sync | Retry + circuit breaker |
| API Server | Database | TCP/PostgreSQL | SQL | Sync | Connection pool + retry |
| API Server | Cache | TCP/Redis | Binary | Sync | Fallback to DB on miss |
| API Server | Message Broker | AMQP | JSON | Async | Persistent queue |
| API Server | File Storage | HTTPS | Binary | Sync | Retry + exponential backoff |
```

---

## Step 7: Invoke BMAD Architecture Skill

**Invoke `/bmad-create-architecture`** with the container design as context. The BMAD skill will produce formal architecture documentation that validates and extends the container design.

---

## Step 8: Verify and Lock

Present the container design for review:

> "Here's the Container Design (C4 Level 2). Let's verify:
> 1. All system responsibilities are allocated to containers
> 2. Every container has a clear technology choice with ADR
> 3. Inter-container communication is fully specified
> 4. Resilience and failure modes are addressed
> 5. The design aligns with the architecture style ADR (3.2)
>
> Does this design look correct? [Approve / Revise]"

Update `{sprint_tracking}`:

```yaml
phases:
  phase_3:
    substates:
      phase_3_3:
        status: "LOCKED"
        artifacts:
          - { type: "container_design", path: "{container_design_output}", status: "locked" }
```

---

## Step 9: Completion

Present summary:

> "Phase 3.3 complete — Container Design locked. Artifact: `{container_design_output}`."
>
> "Summary: {N} containers, {M} ADRs, {K} communication paths defined."

Return to the Phase 3 sub-phase menu.
