---
template: architecture-v1
artifact_type: architecture
description: "System architecture document — C4 Levels 1-3 + ADRs"
version: "1.0"
---

# Architecture: {PROJECT_NAME}

**Author:** {AUTHOR}
**Created:** {DATE}
**Status:** Draft | Reviewed | Approved

---

## System Context (C4 Level 1)

<!-- ACTION REQUIRED: Describe the system boundary, all actors (users + external systems), and integrations (min 300 chars) -->

{system_context_diagram_description}

### Actors

| Actor | Type | Description |
|-------|------|-------------|
| {actor_name} | User | System | {description} |

### External Integrations

| System | Protocol | Purpose |
|--------|----------|---------|
| {external_system} | REST | gRPC | Message Queue | {purpose} |

## Containers (C4 Level 2)

<!-- ACTION REQUIRED: At least 2 runtime containers. Each: name, type, technology, responsibilities -->

### {CONTAINER_NAME_1}

- **Type**: Web App | API Server | Database | Message Broker | File Storage
- **Technology**: {framework_or_product}
- **Responsibilities**: {list_of_responsibilities}

### {CONTAINER_NAME_2}

- **Type**: {type}
- **Technology**: {technology}
- **Responsibilities**: {responsibilities}

## Components (C4 Level 3)

<!-- ACTION REQUIRED: At least 3 key components within containers -->

### {COMPONENT_NAME_1} (in {CONTAINER_NAME})

- **Responsibility**: {what_it_does}
- **Interfaces**: {exposed_APIs_or_contracts}

### {COMPONENT_NAME_2} (in {CONTAINER_NAME})

- **Responsibility**: {what_it_does}
- **Interfaces**: {exposed_APIs_or_contracts}

## Architecture Decisions

<!-- ACTION REQUIRED: At least 2 ADR entries in the standard format -->

### ADR-001: {TITLE}

- **Context**: {why_this_decision_is_needed}
- **Decision**: {what_was_chosen}
- **Alternatives Considered**: {other_options_and_why_rejected}
- **Consequences**: {resulting_tradeoffs}

### ADR-002: {TITLE}

- **Context**: {context}
- **Decision**: {decision}
- **Alternatives Considered**: {alternatives}
- **Consequences**: {consequences}

## Deployment

<!-- ACTION REQUIRED: How and where the system is deployed (min 200 chars) -->

{deployment_description}

- **Target Platform**: Docker | Vercel | AWS | Kubernetes | Other
- **CI/CD Pipeline**: {pipeline_description}
- **Environments**: dev | staging | production

## Quality Attributes (Optional)

<!-- Performance, availability, security, maintainability targets -->

{quality_attributes_if_needed}
