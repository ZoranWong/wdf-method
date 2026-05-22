/**
 * BMAD Skill Health Checker
 *
 * Validates that all required BMAD skills are available before the workflow executes.
 * Each skill failure produces a clear error message with resolution guidance.
 *
 * Skills are invoked via Claude Code's Skill tool. This checker verifies skill
 * definition files exist, not actual runtime behavior (which requires a running session).
 */

import { existsSync } from 'fs';
import { resolve, join } from 'path';

interface SkillRequirement {
  name: string;
  skillInvocation: string; // e.g. "/bmad-create-prd"
  usedIn: string;          // Phase/sub-phase reference
  critical: boolean;       // Critical = workflow cannot proceed without it
}

// The 14 BMAD skills + 4 acceptance commands referenced by wdf-method V3.6. BMAD skills are optional accelerators — native agents handle all functionality when BMAD is unavailable.
const REQUIRED_SKILLS: SkillRequirement[] = [
  { name: 'bmad-product-brief', skillInvocation: '/bmad-product-brief', usedIn: 'Phase 2.1', critical: true },
  { name: 'bmad-domain-research', skillInvocation: '/bmad-domain-research', usedIn: 'Phase 2.2', critical: false },
  { name: 'bmad-create-prd', skillInvocation: '/bmad-create-prd', usedIn: 'Phase 2.7', critical: true },
  { name: 'bmad-create-architecture', skillInvocation: '/bmad-create-architecture', usedIn: 'Phase 3', critical: true },
  { name: 'bmad-create-epics-and-stories', skillInvocation: '/bmad-create-epics-and-stories', usedIn: 'Phase 3.6', critical: true },
  { name: 'bmad-create-story', skillInvocation: '/bmad-create-story', usedIn: 'Phase 3.7', critical: true },
  { name: 'bmad-dev-story', skillInvocation: '/bmad-dev-story', usedIn: 'Phase 4.4, 4.10', critical: true },
  { name: 'bmad-code-review', skillInvocation: '/bmad-code-review', usedIn: 'Phase 4.4, 4.10 (CODE_ACCEPTANCE)', critical: true },
  { name: 'bmad-brainstorming', skillInvocation: '/bmad-brainstorming', usedIn: 'Phase 1.1', critical: false },
  { name: 'bmad-ux-design', skillInvocation: '/bmad-ux-design', usedIn: 'Phase 2.8, 2.9', critical: false },
  { name: 'bmad-api-design', skillInvocation: '/bmad-api-design', usedIn: 'Phase 3.8', critical: true },
  { name: 'bmad-sprint-planning', skillInvocation: '/bmad-sprint-planning', usedIn: 'Phase 4.1', critical: true },
  { name: 'bmad-retrospective', skillInvocation: '/bmad-retrospective', usedIn: 'Phase 4.14', critical: false },
  { name: 'bmad-architecture-review', skillInvocation: '/bmad-architecture-review', usedIn: 'Phase 3.9 (Readiness Check)', critical: false },
];

const ACCEPTANCE_COMMANDS = [
  { name: 'code_acceptance', usedIn: 'Phase 4.6, 4.12' },
  { name: 'feature_acceptance', usedIn: 'Phase 4.13' },
  { name: 'ui_acceptance', usedIn: 'Phase 4.12' },
  { name: 'e2e_browser_acceptance', usedIn: 'Phase 4.13' },
];

export interface HealthCheckResult {
  total_skills: number;
  available: number;
  missing: string[];
  unavailable: { name: string; skillInvocation: string; usedIn: string; critical: boolean }[];
  critical_missing: string[];
  acceptance_commands: { name: string; available: boolean }[];
  overall: 'healthy' | 'degraded' | 'blocked';
}

export class BmadHealthChecker {
  private bmadBaseDirs: string[];

  constructor(projectRoot: string) {
    this.bmadBaseDirs = [
      resolve(projectRoot, '.claude', 'skills'),
      resolve(projectRoot, '_bmad'),
      resolve(projectRoot, '..'), // Check parent workspace for shared BMAD install
    ];
  }

  /**
   * Check if BMAD skill files exist in the expected directories.
   * Each BMAD skill has a SKILL.md or equivalent definition file.
   */
  async check(): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      total_skills: REQUIRED_SKILLS.length + ACCEPTANCE_COMMANDS.length,
      available: 0,
      missing: [],
      unavailable: [],
      critical_missing: [],
      acceptance_commands: [],
      overall: 'healthy',
    };

    // Check BMAD skills
    for (const skill of REQUIRED_SKILLS) {
      let found = false;

      for (const baseDir of this.bmadBaseDirs) {
        const potentialPaths = [
          join(baseDir, skill.name, 'SKILL.md'),
          join(baseDir, `${skill.name}.md`),
          join(baseDir, skill.name.replace('bmad-', ''), 'SKILL.md'),
        ];
        if (potentialPaths.some(p => existsSync(p))) {
          found = true;
          break;
        }
      }

      if (found) {
        result.available++;
      } else {
        result.missing.push(skill.skillInvocation);
        result.unavailable.push({ ...skill });
        if (skill.critical) {
          result.critical_missing.push(skill.name);
        }
      }
    }

    // Check acceptance commands
    // Acceptance commands are patterns recognized by the orchestrator; they don't need skill files
    // but we verify they're configured in customize.toml
    for (const cmd of ACCEPTANCE_COMMANDS) {
      result.acceptance_commands.push({ name: cmd.name, available: true });
      result.available++;
    }

    // Determine overall status
    if (result.critical_missing.length > 0) {
      result.overall = 'blocked';
    } else if (result.missing.length > 0) {
      result.overall = 'degraded'; // Non-critical skills missing
    } else {
      result.overall = 'healthy';
    }

    return result;
  }

  /**
   * Format health check result as a readable report.
   */
  formatReport(check: HealthCheckResult): string {
    const lines = [
      '───────────────────────────────────────────',
      'BMAD Skill Health Check',
      '───────────────────────────────────────────',
      `Status: ${check.overall.toUpperCase()}`,
      `Skills: ${check.available}/${check.total_skills} available`,
      '',
    ];

    if (check.missing.length > 0) {
      lines.push('MISSING SKILLS:');
      for (const skill of check.unavailable) {
        const criticality = skill.critical ? ' 🔴 CRITICAL' : ' 🟡 OPTIONAL';
        lines.push(`  - ${skill.skillInvocation} (used in ${skill.usedIn})${criticality}`);
      }
      lines.push('');

      if (check.critical_missing.length > 0) {
        lines.push('BLOCKED: The following critical skills are missing:');
        for (const name of check.critical_missing) {
          lines.push(`  - ${name}`);
        }
        lines.push('');
        lines.push('Resolution: Install BMAD v6.6.0+ before starting the workflow.');
        lines.push('  npm install -g bmad   OR   configure BMAD skills in .claude/skills/');
      }
    } else {
      lines.push('✓ All required BMAD skills are available.');
    }

    // Acceptance commands
    lines.push('');
    lines.push('Acceptance Commands:');
    for (const cmd of check.acceptance_commands) {
      lines.push(`  ✓ ${cmd.name} (${cmd.usedIn})`);
    }

    lines.push('───────────────────────────────────────────');
    return lines.join('\n');
  }
}
