# Sub-Agent Prompt Template — Phase 2 (Planning)
# V3.6: Orchestrator reference for sub-agent dispatch context.
# When BMAD skills available → dispatch BMAD with this context.
# When unavailable → dispatch native agent from references/agents/.
# This file defines CLEAN CONTEXT for Phase 2 sub-agents.
# See: customize.toml [bmad_skill_fallbacks], references/agents/product-manager.md, references/agents/ux-designer.md

phase: 2
version: "3.6.0"

# Phase 2 has 10 sub-phases. Required: 2.1, 2.4, 2.5, 2.6, 2.7, 2.10

[phase_2_1_impact_mapping]
description: "Impact Mapping — Map business goals to impacts and deliverables"
clean_context:
  - "Phase 1 outputs (if available)"
  - "Project description from user"
prompt_template: |
  你是一个产品战略师。为以下项目创建影响地图。
  项目: {project_description}
  参考: Phase 1 产出文件 (如果存在)
  任务: 定义 SMART 业务目标 → 识别参与者 → 分析影响 → 映射交付物。
  输出: 写入 {impact_map_output}
  格式: YAML frontmatter (artifact_type: impact_map, phase: 2, status: draft)

[phase_2_2_event_storming]
description: "Event Storming — Domain events (skippable)"
clean_context:
  - "{impact_map_output}"
prompt_template: |
  你是一个领域架构师。为以下项目执行事件风暴分析。
  参考: {impact_map_output}
  任务: 识别领域事件、时间线、命令、聚合和边界上下文。
  输出: 写入 {event_storming_output}
  格式: YAML frontmatter (artifact_type: event_storming, phase: 2, status: draft)

[phase_2_3_jtbd]
description: "Jobs to Be Done — User jobs (skippable)"
clean_context:
  - "{impact_map_output}"
prompt_template: |
  你是一个用户体验专家。为以下项目创建 JTBD 卡片。
  参考: {impact_map_output}
  任务: 为每个 persona 创建 JTBD 卡片，映射功能/情感/社会维度。
  输出: 写入 {jtbd_cards_output}
  格式: YAML frontmatter (artifact_type: jtbd_cards, phase: 2, status: draft)

[phase_2_4_story_mapping]
description: "Story Mapping — Build story map backbone and release slices"
clean_context:
  - "{impact_map_output}"
  - "{event_storming_output} (if exists)"
  - "{jtbd_cards_output} (if exists)"
prompt_template: |
  你是一个敏捷教练。为以下项目创建用户故事地图。
  参考: {impact_map_output}, {event_storming_output}, {jtbd_cards_output}
  任务: 构建用户活动骨架 → 分解任务为故事种子 → 定义发布切片 (Walking Skeleton → MVP → v1.1 → v2)。
  输出: 写入 {story_map_output}
  格式: YAML frontmatter (artifact_type: story_map, phase: 2, status: draft)

[phase_2_5_prd]
description: "Kano + RICE + PRD — Prioritize and draft PRD"
clean_context:
  - "{story_map_output}"
  - "{impact_map_output}"
prompt_template: |
  你是一个产品负责人。为以下项目创建 PRD 需求文档。
  参考: {story_map_output}, {impact_map_output}
  任务: Kano 分类功能 → RICE 评分 → 优先级排序 → 编写 PRD (执行摘要/问题陈述/功能需求/用户画像/验收标准)。
  输出: 写入 {prd_output} + {prioritization_output}
  格式: YAML frontmatter (artifact_type: prd, phase: 2, status: draft)

[phase_2_6_user_flows]
description: "User Flows & Information Architecture"
clean_context:
  - "{prd_output}"
  - "{story_map_output}"
prompt_template: |
  你是一个 UX 设计师。为以下项目创建用户流程和信息架构。
  参考: {prd_output}, {story_map_output}
  任务: 映射用户流程 (主路径/次路径/错误路径) → 定义信息架构 (页面清单/导航/站点地图)。
  输出: 写入 {user_flows_output} + {sitemap_output}
  格式: YAML frontmatter (artifact_type: user_flows, phase: 2, status: draft)

[phase_2_7_wireframes]
description: "Wireframes"
clean_context:
  - "{user_flows_output}"
prompt_template: |
  你是一个 UI 设计师。为以下项目创建线框图。
  参考: {user_flows_output}
  任务: 为所有关键页面创建线框图 → 覆盖所有 UI 状态 (loading/empty/error/edge cases) → 列出组件清单。
  输出: 写入 {wireframes_output}
  格式: YAML frontmatter (artifact_type: wireframes, phase: 2, status: draft)

[phase_2_8_design_system]
description: "Design System (skippable)"
clean_context:
  - "{wireframes_output}"
prompt_template: |
  你是一个设计系统专家。为以下项目创建设计 tokens 和组件规范。
  参考: {wireframes_output}
  任务: 定义设计 tokens (colors/typography/spacing/shadows/breakpoints) → 记录组件规范。
  输出: 写入 {design_tokens_output}
  格式: YAML frontmatter (artifact_type: design_tokens, phase: 2, status: draft)

[phase_2_9_interaction_design]
description: "Interaction Design (skippable)"
clean_context:
  - "{wireframes_output}"
prompt_template: |
  你是一个交互设计师。为以下项目定义交互模式和状态转换。
  参考: {wireframes_output}
  任务: 定义交互模式 → 状态转换矩阵 → 动画/反馈规范。
  输出: 写入 {interaction_spec_output}
  格式: YAML frontmatter (artifact_type: interaction_spec, phase: 2, status: draft)

[phase_2_10_design_acceptance]
description: "Design Acceptance — Compile acceptance criteria"
clean_context:
  - "{wireframes_output}"
  - "{prd_output}"
prompt_template: |
  你是一个 QA 专家。为以下项目创建设计验收标准。
  参考: {wireframes_output}, {prd_output}
  任务: 编译验收标准 → 视觉对齐清单 → 无障碍标准 → 交互验收基准。
  输出: 写入 {design_acceptance_output}
  格式: YAML frontmatter (artifact_type: design_acceptance, phase: 2, status: draft)
