import { LintRule } from '../types.js';
import { VersionConsistencyRule } from './version-consistency.js';
import { SrgIdCompletenessRule } from './srg-id-completeness.js';
import { NoDeprecatedTermsRule } from './no-deprecated-terms.js';
import { StoryRefsRequiredRule } from './story-refs-required.js';
import { StoryRefsResolveRule } from './story-refs-resolve.js';
import { StoryScopeRequiredRule } from './story-scope-required.js';
import { AgentSafetyRule } from './agent-safety.js';
import { ConstitutionCheckRule } from './constitution-check.js';

/**
 * Registry of all built-in lint rules
 */
export const BUILTIN_RULES: LintRule[] = [
  VersionConsistencyRule,
  SrgIdCompletenessRule,
  NoDeprecatedTermsRule,
  StoryRefsRequiredRule,
  StoryRefsResolveRule,
  StoryScopeRequiredRule,
  AgentSafetyRule,
  ConstitutionCheckRule,
];

/**
 * Default rule configuration
 */
export const DEFAULT_RULE_CONFIG: Record<string, 'error' | 'warning' | 'off'> = {
  VERSION_CONSISTENCY: 'error',
  SRG_ID_COMPLETENESS: 'warning',
  NO_DEPRECATED_TERMS: 'warning',
  STORY_REFS_REQUIRED: 'error',
  STORY_REFS_RESOLVE: 'error',
  STORY_SCOPE_REQUIRED: 'error',
  AGENT_SAFETY: 'error',
  CONSTITUTION_CHECK: 'error',
};
