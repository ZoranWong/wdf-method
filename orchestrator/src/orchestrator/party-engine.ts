// PartyEngine - Orchestrates multi-agent collaborative discussions
//
// Features:
// - Parallel agent dispatch with shared context
// - Cross-Talk: agents can read and comment on each other's outputs
// - Convergence: identifies agreements, disagreements, and gaps
// - First Principles: challenges assumptions and decomposes problems
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendAudit } from './audit-logger.js';
import {
  PartyState,
  PartyAgent,
  PartyConfig,
  PartyRound,
  CrossTalkComment,
  ConvergencePoint,
  FirstPrincipleAnalysis,
  PartyRole,
} from './types.js';

/**
 * PartyAgentPersonas - defines the personality, perspective, and focus
 * for each agent role in Party Mode.
 */
const PARTY_AGENT_PERSONAS: Record<
  Exclude<PartyRole, 'external_expert'> | 'external_expert',
  { name: string; persona: string; perspectives: string[] }
> = {
  analyst: {
    name: 'Business Analyst',
    persona: 'Data-driven, detail-oriented, focuses on user needs and business value',
    perspectives: [
      'User pain points and needs',
      'Business value and ROI analysis',
      'Market differentiation opportunities',
      'Success metrics and KPIs',
    ],
  },
  product_manager: {
    name: 'Product Manager',
    persona: 'Strategic thinker, prioritizes user experience and business goals',
    perspectives: [
      'Product vision and roadmap alignment',
      'User experience journey mapping',
      'Feature prioritization framework',
      'Risk and opportunity assessment',
    ],
  },
  ux_designer: {
    name: 'UX Designer',
    persona: 'User-centric, focuses on interaction patterns and visual hierarchy',
    perspectives: [
      'User interaction flows and patterns',
      'Accessibility and inclusive design',
      'Visual hierarchy and information architecture',
      'Emotional response and delight factors',
    ],
  },
  architect: {
    name: 'System Architect',
    persona: 'Technical strategist, focuses on scalability, maintainability, and patterns',
    perspectives: [
      'System architecture and component boundaries',
      'Scalability and performance considerations',
      'Technical debt and maintainability',
      'Integration patterns and standards',
    ],
  },
  story_planner: {
    name: 'Story Planner',
    persona: 'Execution-focused, breaks down work into actionable stories',
    perspectives: [
      'Work breakdown and story sizing',
      'Dependency mapping and sequencing',
      'Parallel execution opportunities',
      'Risk identification and mitigation',
    ],
  },
  api_designer: {
    name: 'API Designer',
    persona: 'Contract-focused, designs for clarity, consistency, and developer experience',
    perspectives: [
      'RESTful design principles and conventions',
      'API contract clarity and versioning',
      'Developer experience and documentation',
      'Error handling and edge cases',
    ],
  },
  external_expert: {
    name: 'External Expert',
    persona: 'Domain specialist, brings external perspective and industry best practices',
    perspectives: [
      'Industry standards and best practices',
      'Emerging trends and innovations',
      'Cross-domain analogies and patterns',
      'Potential blind spots and unknowns',
    ],
  },
};

/**
 * PartyEngine - Orchestrates multi-agent collaborative discussions
 *
 * Features:
 * - Parallel agent dispatch with shared context
 * - Cross-Talk: agents can read and comment on each other's outputs
 * - Convergence: identifies agreements, disagreements, and gaps
 * - First Principles: challenges assumptions and decomposes problems
 */
export class PartyEngine {
  private projectRoot: string;
  private outputDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.outputDir = join(projectRoot, '_wdf_output', 'party');
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Create a new party session with specified agents and topic.
   */
  createParty(config: PartyConfig): PartyState {
    const partyId = `party-${Date.now()}`;
    const agents: PartyAgent[] = config.agents.map((role, index) => {
      const persona = PARTY_AGENT_PERSONAS[role];
      return {
        id: `agent-${index + 1}`,
        role,
        name: persona.name,
        persona: persona.persona,
        perspectives: persona.perspectives,
        status: 'idle',
      };
    });
    const state: PartyState = {
      party_id: partyId,
      topic: config.topic,
      phase: config.phase,
      status: 'NOT_STARTED',
      agents,
      rounds: [],
      convergence_points: [],
      first_principles: [],
      invited_experts: [],
      started_at: new Date().toISOString(),
    };
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_created', {
      status: 'info',
      party_id: partyId,
      topic: config.topic,
      phase: config.phase,
      agent_count: agents.length,
      message: `Created party session with ${agents.length} agents`,
    });
    return state;
  }

  /**
   * Start or resume a party session.
   */
  async startParty(partyId: string): Promise<PartyState> {
    const state = this.loadPartyState(partyId);
    if (state.status === 'COMPLETED') {
      throw new Error(`Party ${partyId} is already completed`);
    }
    if (state.status === 'PAUSED') {
      state.resumed_at = new Date().toISOString();
    }
    state.status = 'IN_PROGRESS';
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_started', {
      status: 'info',
      party_id: partyId,
      message: `Party session started`,
    });
    return state;
  }

  /**
   * Pause a party session.
   */
  async pauseParty(partyId: string, reason?: string): Promise<PartyState> {
    const state = this.loadPartyState(partyId);
    state.status = 'PAUSED';
    state.paused_at = new Date().toISOString();
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_paused', {
      status: 'info',
      party_id: partyId,
      reason: reason || 'User requested pause',
      message: `Party session paused`,
    });
    return state;
  }

  /**
   * Execute a discussion round: all agents respond to the prompt.
   * This simulates parallel agent execution.
   */
  async executeRound(partyId: string, prompt: string): Promise<PartyRound> {
    const state = this.loadPartyState(partyId);
    const roundNumber = state.rounds.length + 1;
    const round: PartyRound = {
      round_number: roundNumber,
      phase: state.phase,
      prompt,
      agent_outputs: {},
      cross_talk: [],
      started_at: new Date().toISOString(),
    };
    // Simulate each agent's response
    for (const agent of state.agents) {
      agent.status = 'thinking';
      this.savePartyState(state);
      // Generate agent's response based on their persona
      const response = this.generateAgentResponse(agent, prompt, state);
      round.agent_outputs[agent.id] = response;
      agent.output = response;
      agent.status = 'responded';
      agent.completed_at = new Date().toISOString();
    }
    round.completed_at = new Date().toISOString();
    state.rounds.push(round);
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_round_completed', {
      status: 'info',
      party_id: partyId,
      round_number: roundNumber,
      agent_count: state.agents.length,
      message: `Completed round ${roundNumber} with ${state.agents.length} agents`,
    });
    return round;
  }

  /**
   * Prepare a dispatch manifest for a discussion round.
   *
   * Instead of using the internal stub generator, this writes one entry per
   * persona to `_wdf_output/.dispatch/party/<id>/round-<N>.json`. The parent
   * Claude session consumes the manifest with the Agent tool — each entry is
   * dispatched as a parallel sub-agent. Sub-agents write their response to
   * the entry's `output_path`. Call `collectDispatchOutputs()` afterwards to
   * fold the responses into party state.
   */
  prepareDispatch(
    partyId: string,
    prompt: string,
  ): {
    manifest_path: string;
    output_dir: string;
    entries: Array<{
      agent_id: string;
      role: string;
      name: string;
      persona: string;
      perspectives: string[];
      prompt: string;
      context: { topic: string; phase: string; round_number: number };
      output_path: string;
    }>;
  } {
    const state = this.loadPartyState(partyId);
    const roundNumber = state.rounds.length + 1;
    const dispatchDir = join(this.projectRoot, '_wdf_output', '.dispatch', 'party', partyId);
    if (!existsSync(dispatchDir))
      mkdirSync(dispatchDir, { recursive: true });
    const entries = state.agents.map(agent => {
      const persona = PARTY_AGENT_PERSONAS[agent.role];
      const outputPath = join(dispatchDir, `round-${roundNumber}-${agent.id}.md`);
      return {
        agent_id: agent.id,
        role: agent.role,
        name: persona.name,
        persona: persona.persona,
        perspectives: persona.perspectives,
        prompt,
        context: {
          topic: state.topic,
          phase: state.phase,
          round_number: roundNumber,
        },
        output_path: outputPath,
      };
    });
    const manifest = {
      party_id: partyId,
      round_number: roundNumber,
      generated_at: new Date().toISOString(),
      instruction_for_parent_agent:
        'Dispatch one sub-agent per entry (parallel). Each sub-agent MUST adopt the listed persona/perspectives, answer the prompt, and write its full markdown response to output_path. Use Agent tool with subagent_type=general-purpose.',
      entries,
    };
    const manifestPath = join(dispatchDir, `round-${roundNumber}-manifest.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    appendAudit(this.projectRoot, 'party_round_completed', {
      status: 'info',
      party_id: partyId,
      round_number: roundNumber,
      agent_count: entries.length,
      message: `Prepared dispatch manifest for round ${roundNumber} — waiting on parent agent to dispatch ${entries.length} sub-agents`,
    });
    return {
      manifest_path: manifestPath,
      output_dir: dispatchDir,
      entries,
    };
  }

  /**
   * Collect sub-agent outputs written for the current round and fold them
   * into party state. If an agent's output file is missing or empty, the
   * internal stub generator is used as a fallback so the round can still
   * complete (e.g., when running without a parent agent in CI tests).
   */
  async collectDispatchOutputs(partyId: string): Promise<PartyRound> {
    const state = this.loadPartyState(partyId);
    const roundNumber = state.rounds.length + 1;
    const dispatchDir = join(this.projectRoot, '_wdf_output', '.dispatch', 'party', partyId);
    const round: PartyRound = {
      round_number: roundNumber,
      phase: state.phase,
      prompt: '(collected from dispatched sub-agents)',
      agent_outputs: {},
      cross_talk: [],
      started_at: new Date().toISOString(),
    };
    let collected = 0;
    let stubbed = 0;
    for (const agent of state.agents) {
      const outputPath = join(dispatchDir, `round-${roundNumber}-${agent.id}.md`);
      let response: string;
      const onDisk = existsSync(outputPath) ? readFileSync(outputPath, 'utf8').trim() : '';
      if (onDisk.length > 0) {
        response = onDisk;
        collected++;
      } else {
        // Fallback: use the stub generator so the round still completes.
        // This keeps CI / non-agent test runs functional.
        response = this.generateAgentResponse(
          agent,
          '(no sub-agent dispatched — using stub)',
          state,
        );
        stubbed++;
      }
      round.agent_outputs[agent.id] = response;
      agent.output = response;
      agent.status = 'responded';
      agent.completed_at = new Date().toISOString();
    }
    // Recover the original prompt from the manifest if available.
    const manifestPath = join(dispatchDir, `round-${roundNumber}-manifest.json`);
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (m.entries && m.entries[0] && typeof m.entries[0].prompt === 'string') {
          round.prompt = m.entries[0].prompt;
        }
      } catch { /* keep default prompt */ }
    }
    round.completed_at = new Date().toISOString();
    state.rounds.push(round);
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_round_completed', {
      status: 'info',
      party_id: partyId,
      round_number: roundNumber,
      agent_count: state.agents.length,
      message: `Collected round ${roundNumber}: ${collected} dispatched, ${stubbed} stubbed`,
    });
    return round;
  }

  /**
   * Generate a simulated agent response based on persona.
   * In a real implementation, this would dispatch to actual LLM agents.
   */
  private generateAgentResponse(agent: PartyAgent, prompt: string, state: PartyState): string {
    const persona = PARTY_AGENT_PERSONAS[agent.role];
    const contextLines: string[] = [];
    contextLines.push(`# ${agent.name} Response`);
    contextLines.push(`Role: ${agent.role}`);
    contextLines.push(`Topic: ${state.topic}`);
    contextLines.push('');
    contextLines.push(`## Analysis`);
    contextLines.push('');
    // Add perspective-based analysis
    for (const perspective of persona.perspectives) {
      contextLines.push(`### ${perspective}`);
      contextLines.push('');
      contextLines.push(`- Consideration 1 for "${perspective}"`);
      contextLines.push(`- Consideration 2 for "${perspective}"`);
      contextLines.push(`- Key insight: ${perspective} is critical for success`);
      contextLines.push('');
    }
    contextLines.push(`## Recommendations`);
    contextLines.push('');
    contextLines.push(`1. First recommendation from ${agent.name}`);
    contextLines.push(`2. Second recommendation from ${agent.name}`);
    contextLines.push(`3. Third recommendation from ${agent.name}`);
    contextLines.push('');
    contextLines.push(`## Open Questions`);
    contextLines.push('');
    contextLines.push(`- What is the primary success metric?`);
    contextLines.push(`- How should we prioritize conflicting requirements?`);
    contextLines.push(`- Are there any technical constraints we haven't considered?`);
    return contextLines.join('\n');
  }

  /**
   * Execute Cross-Talk: agents review and comment on each other's outputs.
   */
  async executeCrossTalk(partyId: string, roundNumber: number): Promise<CrossTalkComment[]> {
    const state = this.loadPartyState(partyId);
    const round = state.rounds.find(r => r.round_number === roundNumber);
    if (!round) {
      throw new Error(`Round ${roundNumber} not found`);
    }
    const comments: CrossTalkComment[] = [];
    let commentIndex = 0;
    for (const reviewer of state.agents) {
      for (const reviewee of state.agents) {
        if (reviewer.id === reviewee.id) continue;
        reviewer.status = 'reviewing';
        this.savePartyState(state);
        const output = round.agent_outputs[reviewee.id];
        if (!output) continue;
        // Generate cross-talk comments
        const agentComments = this.generateCrossTalkComments(reviewer, reviewee, output, state);
        for (const comment of agentComments) {
          commentIndex++;
          const c: CrossTalkComment = {
            id: `comment-${roundNumber}-${commentIndex}`,
            from_agent: reviewer.id,
            to_agent: reviewee.id,
            ...comment,
            created_at: new Date().toISOString(),
          };
          comments.push(c);
          round.cross_talk.push(c);
        }
      }
      reviewer.status = 'responded';
    }
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_crosstalk_completed', {
      status: 'info',
      party_id: partyId,
      round_number: roundNumber,
      comment_count: comments.length,
      message: `Cross-talk completed with ${comments.length} comments`,
    });
    return comments;
  }

  /**
   * Generate simulated cross-talk comments between agents.
   */
  private generateCrossTalkComments(
    reviewer: PartyAgent,
    reviewee: PartyAgent,
    output: string,
    state: PartyState,
  ): Array<Omit<CrossTalkComment, 'id' | 'from_agent' | 'to_agent' | 'created_at'>> {
    const persona = PARTY_AGENT_PERSONAS[reviewer.role];
    const comments: Array<Omit<CrossTalkComment, 'id' | 'from_agent' | 'to_agent' | 'created_at'>> = [];
    // Agreement
    comments.push({
      type: 'agreement',
      content: `${reviewer.name} agrees with ${reviewee.name}'s analysis on user needs. The perspective on ${persona.perspectives[0]} aligns well.`,
    });
    // Question
    comments.push({
      type: 'question',
      content: `${reviewer.name} asks: Have you considered how this impacts ${persona.perspectives[1]}? Could you elaborate on that aspect?`,
    });
    // Suggestion
    comments.push({
      type: 'suggestion',
      content: `${reviewer.name} suggests: We might want to add consideration for ${persona.perspectives[2]} to make this more comprehensive.`,
    });
    // Gap identification (50% chance)
    if (Math.random() > 0.5) {
      comments.push({
        type: 'gap',
        content: `${reviewer.name} identifies a potential gap: We haven't discussed how this handles ${persona.perspectives[3]} — this might need further exploration.`,
      });
    }
    return comments;
  }

  /**
   * Analyze cross-talk and identify convergence points:
   * agreements, disagreements, and gaps.
   */
  analyzeConvergence(partyId: string): ConvergencePoint[] {
    const state = this.loadPartyState(partyId);
    const points: ConvergencePoint[] = [];
    // Aggregate comments by topic and identify patterns
    const allComments = state.rounds.flatMap(r => r.cross_talk);
    // Identify agreement points
    const agreements = allComments.filter(c => c.type === 'agreement');
    if (agreements.length > 0) {
      points.push({
        id: 'convergence-agreement-1',
        topic: 'User needs and requirements',
        type: 'agreement',
        agents_involved: [...new Set(agreements.flatMap(c => [c.from_agent, c.to_agent!]))],
        summary: 'All agents agree on the core user needs and requirements analysis approach.',
      });
    }
    // Identify gaps
    const gaps = allComments.filter(c => c.type === 'gap');
    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i];
      points.push({
        id: `convergence-gap-${i + 1}`,
        topic: `Gap identified by ${gap.from_agent}`,
        type: 'gap',
        agents_involved: [gap.from_agent, gap.to_agent!],
        summary: gap.content,
      });
    }
    // Identify questions as potential disagreement or decision points
    const questions = allComments.filter(c => c.type === 'question');
    for (let i = 0; i < Math.min(questions.length, 2); i++) {
      const q = questions[i];
      points.push({
        id: `convergence-decision-${i + 1}`,
        topic: `Clarification needed from user`,
        type: 'decision_needed',
        agents_involved: [q.from_agent, q.to_agent!],
        summary: q.content,
      });
    }
    state.convergence_points = points;
    this.savePartyState(state);
    return points;
  }

  /**
   * Run First Principles analysis: decompose assumptions and challenge them.
   */
  analyzeFirstPrinciples(partyId: string, topic?: string): FirstPrincipleAnalysis[] {
    const state = this.loadPartyState(partyId);
    const focusTopic = topic || state.topic;
    const analyses: FirstPrincipleAnalysis[] = [
      {
        id: 'fp-1',
        assumption: 'Users need all features immediately',
        challenge:
          'What is the minimal set of features that delivers core value? MVP thinking suggests we can phase delivery.',
        validity_score: 5,
        alternative: 'Prioritize high-impact features and deliver incrementally',
        impact: 'Reduces initial development effort by ~40% while still delivering value',
      },
      {
        id: 'fp-2',
        assumption: 'We need a custom solution for everything',
        challenge:
          'What existing tools, libraries, or patterns can we leverage? Not everything needs to be built from scratch.',
        validity_score: 4,
        alternative: 'Leverage open-source libraries and SaaS for commodity functionality',
        impact: 'Faster time-to-market and reduced maintenance burden',
      },
      {
        id: 'fp-3',
        assumption: 'Performance is always the top priority',
        challenge:
          'What is the actual performance requirement? "Fast enough" is often better than "optimal". Developer velocity matters too.',
        validity_score: 6,
        alternative: 'Define clear SLAs and optimize only where it matters',
        impact: 'Better balance between speed of delivery and runtime performance',
      },
      {
        id: 'fp-4',
        assumption: 'More complexity = more capability',
        challenge:
          'Complexity has a multiplicative cost in maintenance and cognitive load. Simpler systems are often more flexible.',
        validity_score: 3,
        alternative: 'Design for simplicity first, add complexity only when proven necessary',
        impact: 'Lower cognitive load, fewer bugs, easier to evolve the system',
      },
    ];
    state.first_principles = analyses;
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_firstprinciples_completed', {
      status: 'info',
      party_id: partyId,
      analysis_count: analyses.length,
      message: `First principles analysis completed with ${analyses.length} assumptions challenged`,
    });
    return analyses;
  }

  /**
   * Resolve a convergence point with a user-provided decision.
   */
  resolveConvergencePoint(
    partyId: string,
    pointId: string,
    resolution: string,
    resolvedBy: 'user' | 'consensus' | 'lead_agent' = 'user',
  ): ConvergencePoint | null {
    const state = this.loadPartyState(partyId);
    const point = state.convergence_points.find(p => p.id === pointId);
    if (!point) return null;
    point.resolution = resolution;
    point.resolved_by = resolvedBy;
    point.resolved_at = new Date().toISOString();
    // Mark related comments as resolved
    for (const round of state.rounds) {
      for (const comment of round.cross_talk) {
        if (comment.type !== 'agreement' && !comment.resolved) {
          comment.resolved = true;
          comment.resolution = `See convergence point ${pointId}: ${resolution}`;
        }
      }
    }
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_convergence_resolved', {
      status: 'info',
      party_id: partyId,
      point_id: pointId,
      resolved_by: resolvedBy,
      message: `Convergence point ${pointId} resolved`,
    });
    return point;
  }

  /**
   * Invite an external expert to join the party.
   */
  inviteExpert(partyId: string, expertType: string): PartyAgent {
    const state = this.loadPartyState(partyId);
    const persona = PARTY_AGENT_PERSONAS.external_expert;
    const expert: PartyAgent = {
      id: `expert-${state.invited_experts.length + 1}`,
      role: 'external_expert',
      name: `External Expert: ${expertType}`,
      persona: `${persona.persona} (Specialty: ${expertType})`,
      perspectives: [...persona.perspectives, `${expertType} domain expertise`],
      status: 'idle',
    };
    state.agents.push(expert);
    state.invited_experts.push(expertType);
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_expert_invited', {
      status: 'info',
      party_id: partyId,
      expert_id: expert.id,
      expert_type: expertType,
      message: `External expert ${expertType} invited to party`,
    });
    return expert;
  }

  /**
   * Finalize the party and generate consolidated output.
   */
  async completeParty(
    partyId: string,
  ): Promise<{ state: PartyState; outputPath: string }> {
    const state = this.loadPartyState(partyId);
    state.status = 'COMPLETED';
    state.phase = 'completed';
    state.completed_at = new Date().toISOString();
    // Generate consolidated output
    const output = this.generateConsolidatedOutput(state);
    state.final_output = output;
    // Write output artifact
    const outputPath = join(this.outputDir, `${partyId}-final-report.md`);
    writeFileSync(outputPath, output, 'utf8');
    state.output_artifact = outputPath;
    this.savePartyState(state);
    appendAudit(this.projectRoot, 'party_completed', {
      status: 'pass',
      party_id: partyId,
      output_path: outputPath,
      agent_count: state.agents.length,
      round_count: state.rounds.length,
      convergence_points: state.convergence_points.length,
      first_principles: state.first_principles.length,
      message: `Party session completed successfully`,
    });
    return { state, outputPath };
  }

  /**
   * Generate consolidated final report from all agent inputs.
   */
  private generateConsolidatedOutput(state: PartyState): string {
    const lines: string[] = [];
    lines.push(`# Party Mode Final Report: ${state.topic}`);
    lines.push('');
    lines.push(`**Phase**: ${state.phase}`);
    lines.push(`**Started**: ${state.started_at}`);
    lines.push(`**Completed**: ${state.completed_at}`);
    lines.push(`**Agents**: ${state.agents.length}`);
    lines.push(`**Rounds**: ${state.rounds.length}`);
    lines.push('');
    // Participants
    lines.push('## Participants');
    lines.push('');
    for (const agent of state.agents) {
      lines.push(`- **${agent.name}** (${agent.role})`);
      lines.push(`  - Persona: ${agent.persona}`);
    }
    lines.push('');
    // Summary of Rounds
    lines.push('## Discussion Summary');
    lines.push('');
    for (const round of state.rounds) {
      lines.push(`### Round ${round.round_number}`);
      lines.push('');
      lines.push(`**Prompt**: ${round.prompt}`);
      lines.push('');
      lines.push(`**Cross-Talk**: ${round.cross_talk.length} comments`);
      lines.push('');
      // Comment type breakdown
      const types: Record<string, number> = {};
      for (const c of round.cross_talk) {
        types[c.type] = (types[c.type] || 0) + 1;
      }
      for (const [type, count] of Object.entries(types)) {
        lines.push(`- ${type}: ${count}`);
      }
      lines.push('');
    }
    // Convergence Points
    lines.push('## Convergence Points');
    lines.push('');
    for (const point of state.convergence_points) {
      const status = point.resolution ? '✅ Resolved' : '⚠️ Open';
      lines.push(`### ${point.id} - ${status}`);
      lines.push('');
      lines.push(`**Topic**: ${point.topic}`);
      lines.push(`**Type**: ${point.type}`);
      lines.push(`**Agents**: ${point.agents_involved.join(', ')}`);
      lines.push('');
      lines.push(`**Summary**: ${point.summary}`);
      lines.push('');
      if (point.resolution) {
        lines.push(`**Resolution**: ${point.resolution}`);
        lines.push(`**Resolved by**: ${point.resolved_by}`);
        lines.push(`**At**: ${point.resolved_at}`);
      }
      lines.push('');
    }
    // First Principles
    if (state.first_principles.length > 0) {
      lines.push('## First Principles Analysis');
      lines.push('');
      for (const fp of state.first_principles) {
        lines.push(`### ${fp.id}`);
        lines.push('');
        lines.push(`**Assumption**: ${fp.assumption}`);
        lines.push(`**Challenge**: ${fp.challenge}`);
        lines.push(`**Validity Score**: ${fp.validity_score}/10`);
        if (fp.alternative) {
          lines.push(`**Alternative**: ${fp.alternative}`);
        }
        if (fp.impact) {
          lines.push(`**Impact**: ${fp.impact}`);
        }
        lines.push('');
      }
    }
    // Recommendations
    lines.push('## Consolidated Recommendations');
    lines.push('');
    lines.push('1. Start with MVP focused on core value delivery');
    lines.push('2. Leverage existing tools and patterns where appropriate');
    lines.push('3. Define clear SLAs before optimizing performance');
    lines.push('4. Prioritize simplicity for maintainability and evolution');
    lines.push('');
    lines.push('## Next Steps');
    lines.push('');
    lines.push('1. Review and confirm convergence point resolutions');
    lines.push('2. Incorporate first principles into design decisions');
    lines.push('3. Begin detailed planning phase');
    return lines.join('\n');
  }

  /**
   * Get party state.
   */
  getPartyState(partyId: string): PartyState {
    return this.loadPartyState(partyId);
  }

  /**
   * List all party sessions.
   */
  listParties(): Array<{
    party_id: string;
    topic: string;
    status: string;
    phase: string;
    started_at?: string;
  }> {
    if (!existsSync(this.outputDir)) return [];
    try {
      const entries = readdirSync(this.outputDir)
        .filter(f => f.endsWith('.json') && f.startsWith('party-'))
        .map((f): { party_id: string; topic: string; status: string; phase: string; started_at?: string } | null => {
          try {
            const state = JSON.parse(readFileSync(join(this.outputDir, f), 'utf8'));
            return {
              party_id: state.party_id,
              topic: state.topic,
              status: state.status,
              phase: state.phase,
              started_at: state.started_at,
            };
          } catch {
            return null;
          }
        })
        .filter((s): s is { party_id: string; topic: string; status: string; phase: string; started_at?: string } => s !== null);
      // Newest first — party ids embed a timestamp so lexical sort = chronological.
      entries.sort((a, b) => (b.party_id > a.party_id ? 1 : -1));
      return entries;
    } catch {
      return [];
    }
  }

  private loadPartyState(partyId: string): PartyState {
    const path = join(this.outputDir, `${partyId}.json`);
    if (!existsSync(path)) {
      throw new Error(`Party ${partyId} not found at ${path}`);
    }
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  private savePartyState(state: PartyState): void {
    const path = join(this.outputDir, `${state.party_id}.json`);
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
  }
}
