// Stub for subphase-executor — full implementation not yet recovered.
// Signatures inferred from subphase-executor.d.ts and call sites in
// auto-executor.js / orchestrator.js / prompt-generator.js.
export interface SubPhaseContext {
  projectRoot: string;
  phaseNum: number;
  subPhaseKey: string;
  subPhaseName: string;
  outputPath: string;
  agentFile: string;
  agentMode?: string;
  previousArtifacts: string[];
}

export interface SubPhaseResult {
  success: boolean;
  artifactPath: string;
  summary: string;
  /** Markdown prompt ready for Claude session execution */
  prompt: string;
  /** Path to the saved prompt file */
  promptFile: string;
}

export interface SubPhaseConfig {
  agentFile: string;
  agentMode?: string;
  produces: string;
  dependsOn: string[];
  skipIf?: (projectRoot: string) => boolean;
}

export const SUB_PHASE_AGENT_MAP: Record<string, SubPhaseConfig> = {};

export function getSubPhaseConfig(_subPhaseKey: string): SubPhaseConfig | null {
  throw new Error('TODO: subphase-executor not yet recovered');
}

export function isSubPhaseComplete(_ctx: SubPhaseContext): boolean {
  throw new Error('TODO: subphase-executor not yet recovered');
}

export function buildSubPhasePrompt(_ctx: SubPhaseContext): SubPhaseResult {
  throw new Error('TODO: subphase-executor not yet recovered');
}

export function buildAgentTask(_ctx: SubPhaseContext): string {
  throw new Error('TODO: subphase-executor not yet recovered');
}
