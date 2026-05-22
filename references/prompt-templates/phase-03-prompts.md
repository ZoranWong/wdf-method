# Sub-Agent Prompt Template — Phase 3 (Solutioning)
# V3.6: Orchestrator reference for sub-agent dispatch context.
# When BMAD skills available → dispatch BMAD with this context.
# When unavailable → dispatch native agent from references/agents/.
# See: customize.toml [bmad_skill_fallbacks], references/agents/architect.md, references/agents/story-planner.md, references/agents/api-designer.md

phase: 3
version: "3.6.0"

# Phase 3 has 9 sub-phases. All required except 3.4.

[phase_3_1_system_context]
description: "System Context (C4 Level 1)"
clean_context:
  - "{prd_output}"
prompt_template: |
  你是一个系统架构师。为以下项目创建系统上下文图 (C4 L1)。
  参考: {prd_output}
  任务: 定义系统边界 → 识别所有参与者和外部系统集成 → 绘制上下文图。
  输出: 写入 {architecture_output}/system-context.md
  格式: YAML frontmatter (artifact_type: system_context, phase: 3, status: draft)

[phase_3_2_architecture_style]
description: "Architecture Style Decision"
clean_context:
  - "{architecture_output}/system-context.md"
prompt_template: |
  你是一个技术负责人。为以下项目选择架构风格。
  参考: {architecture_output}/system-context.md
  任务: 分析约束 → 评估架构风格选项 (加权矩阵) → 选择风格 → 写 ADR-001 → 确定 dev_mode (separated/full_stack)。
  输出: 写入 {architecture_output}/architecture-style.md
  格式: YAML frontmatter (artifact_type: architecture_style, phase: 3, status: draft)

[phase_3_3_container_design]
description: "Container Design (C4 Level 2)"
clean_context:
  - "{architecture_output}/architecture-style.md"
prompt_template: |
  你是一个容器架构师。为以下项目设计容器架构 (C4 L2)。
  参考: {architecture_output}/architecture-style.md
  任务: 识别容器 → 选择每个容器的技术栈 → 写 ADR-002~007。
  输出: 写入 {architecture_output}/container-design.md
  格式: YAML frontmatter (artifact_type: container_design, phase: 3, status: draft)

[phase_3_4_quality_attributes]
description: "Quality Attributes (ATAM-lite, skippable)"
clean_context:
  - "{architecture_output}/container-design.md"
prompt_template: |
  你是一个质量架构师。为以下项目分析质量属性。
  参考: {architecture_output}/container-design.md
  任务: 生成质量属性场景 → 构建效用树 → 分析架构的风险/敏感点/权衡。
  输出: 写入 {architecture_output}/quality-attributes.md
  格式: YAML frontmatter (artifact_type: quality_attributes, phase: 3, status: draft)

[phase_3_5_component_synthesis]
description: "Component Synthesis (C4 Level 3)"
clean_context:
  - "{architecture_output}/container-design.md"
  - "{architecture_output}/quality-attributes.md (if exists)"
prompt_template: |
  你是一个组件架构师。为以下项目设计组件架构 (C4 L3)。
  参考: {architecture_output}/container-design.md, {architecture_output}/quality-attributes.md
  任务: 设计组件 → 验证 4+1 视图 → 编译 architecture.md。
  输出: 写入 {architecture_output}/component-design.md + {architecture_output}
  格式: YAML frontmatter (artifact_type: component_design, phase: 3, status: draft)

[phase_3_6_epics]
description: "Epics & Feature Plan"
clean_context:
  - "{architecture_output}"
  - "{prd_output}"
prompt_template: |
  你是一个敏捷架构师。为以下项目创建 Epic 层次结构。
  参考: {architecture_output}, {prd_output}
  任务: 定义 Epic 层次结构 → 功能规划 → Epic 文件。
  输出: 写入 {epics_output}
  格式: YAML frontmatter (artifact_type: epics, phase: 3, status: draft)

[phase_3_7_stories]
description: "Story Design + Contract Freeze"
clean_context:
  - "{epics_output}"
  - "{architecture_output}"
prompt_template: |
  你是一个故事工程师。为以下项目创建详细用户故事。
  参考: {epics_output}, {architecture_output}
  任务: 为每个 Epic 创建详细故事 → 包含 acceptance_criteria, technical_notes, scope_write, acceptance_check, code_standards_source, dependencies, parallel_safe, ui_truth_source → 按依赖排序 → 冻结开发顺序。
  输出: 写入 {stories_output}/ 目录, 每个故事一个文件
  每个故事必须包含: scope_write, acceptance_check (可执行命令), code_standards_source
  格式: YAML frontmatter (artifact_type: story, phase: 3, status: draft)

[phase_3_8_api_data_design]
description: "API & Data Design"
clean_context:
  - "{stories_output}/ (所有故事文件)"
  - "{architecture_output}"
  - "{prd_output}"
prompt_template: |
  你是一个 API 架构师。为以下项目定义 API 规范和数据库架构。
  参考: {stories_output}, {architecture_output}, {prd_output}
  任务: 创建 OpenAPI 3.0 规范 (所有端点、请求/响应 schema、认证) → 设计数据库架构 (表/关系/索引/迁移计划)。
  输出: 写入 {api_spec_output} + {db_schema_output}
  格式: YAML frontmatter (artifact_type: api_spec, phase: 3, status: draft)

[phase_3_9_readiness_check]
description: "Readiness Check — Verify implementation readiness"
clean_context:
  - "{api_spec_output}"
  - "{db_schema_output}"
  - "{stories_output}/"
  - "{architecture_output}"
prompt_template: |
  你是一个 QA 架构师。验证以下项目的实现准备就绪情况。
  参考: {api_spec_output}, {db_schema_output}, {stories_output}, {architecture_output}
  任务: 验证架构有效 → API 契约完整 → 故事就绪 → 技术栈就绪 → 所有门控通过 → 编写 readiness-check.md。
  输出: 写入 {architecture_output}/readiness-check.md
  格式: YAML frontmatter (artifact_type: readiness_check, phase: 3, status: draft, all_gates_passed: true/false)
