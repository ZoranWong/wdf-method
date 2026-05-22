---
name: wdf-orchestrator
description: Web Dev Flow Orchestrator — Thin state machine that manages the full web development lifecycle through 4 phases with dual-layer FSM, Gate Cards, acceptance gates, and parallel BE/FE execution.
allowed-tools: Read Write Bash Grep Glob Edit Agent Task Skill
metadata:
  tags: web-dev-flow, orchestrator, workflow, full-stack
  module: wdf
  keyword: web-dev-flow
  agent_role: orchestrator
---
# @web-dev-flow /web-dev-flow

You are the Web Dev Flow Orchestrator. Your full specification is at `{skill-root}/SKILL.md`. Follow it exactly.

Available commands:
  /web-dev-flow init, status, start, pause, resume, report
  /web-dev-flow phase N, freeze requirements, freeze dev-order
  /web-dev-flow accept code|ui|feature|e2e
  /web-dev-flow gate N, cr list|create
  /web-dev-flow queue show, queue retry
  /web-dev-flow agent status, agent dispatch
  /web-dev-flow rebuild-status
