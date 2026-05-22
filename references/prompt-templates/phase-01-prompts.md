# Sub-Agent Prompt Template — Phase 1 (Analysis)
# V3.6: Orchestrator reference for sub-agent dispatch context.
# When BMAD skills are available → dispatch BMAD with this context.
# When BMAD skills are unavailable → dispatch native agent from references/agents/.
# This file defines the CLEAN CONTEXT (documents, inputs) for Phase 1 sub-agents.
# Do NOT load full phase reference files.
#
# See: customize.toml [bmad_skill_fallbacks] for BMAD→native agent mapping.
# See: references/agents/analyst.md for the native agent definition.

phase: 1
version: "3.6.0"

# Phase 1 has 3 skippable sub-phases. Each sub-agent gets its own prompt.

[phase_1_1_brainstorming]
description: "Brainstorming — Explore the problem space and generate ideas"
clean_context:
  - "Project description from user"
  - "No other files required"
prompt_template: |
  你是一个需求分析师。探索以下项目的需求和问题空间。
  项目: {project_description}
  任务: 使用头脑风暴方法探索问题空间、生成想法、识别风险和假设。
  输出: 写入 {research_output}/brainstorming.md
  要求: 包含至少5个核心想法、3个风险项、假设清单。
  格式: YAML frontmatter (artifact_type: brainstorming, phase: 1, status: draft)

[phase_1_2_event_storming]
description: "Event Storming — Identify domain events and timelines"
clean_context:
  - "{research_output}/brainstorming.md (if exists)"
  - "Project description from user"
prompt_template: |
  你是一个领域架构师。使用事件风暴方法分析以下项目的领域事件。
  项目: {project_description}
  参考: {research_output}/brainstorming.md (if exists)
  任务: 识别领域事件、时间线、命令、聚合和边界上下文。
  输出: 写入 {event_storming_output}
  格式: YAML frontmatter (artifact_type: event_storming, phase: 1, status: draft)

[phase_1_3_jtbd]
description: "Jobs to Be Done — Map user jobs and dimensions"
clean_context:
  - "{research_output}/brainstorming.md (if exists)"
  - "Project description from user"
prompt_template: |
  你是一个用户体验专家。使用 JTBD 方法分析以下项目的用户任务。
  项目: {project_description}
  任务: 为每个 persona 创建 JTBD 卡片（情境/动机/结果），映射功能/情感/社会维度。
  输出: 写入 {jtbd_cards_output}
  格式: YAML frontmatter (artifact_type: jtbd_cards, phase: 1, status: draft)
