import { LintRule } from '../types.js';
import { VersionConsistencyRule } from './version-consistency.js';
import { SrgIdCompletenessRule } from './srg-id-completeness.js';
import { NoDeprecatedTermsRule } from './no-deprecated-terms.js';
import { StoryRefsRequiredRule } from './story-refs-required.js';

/**
 * Registry of all built-in lint rules
 */
export const BUILTIN_RULES: LintRule[] = [
  VersionConsistencyRule,
  SrgIdCompletenessRule,
  NoDeprecatedTermsRule,
  StoryRefsRequiredRule
];

/**
 * Default rule configuration
 */
export const DEFAULT_RULE_CONFIG: Record<string, 'error' | 'warning' | 'off'> = {
  VERSION_CONSISTENCY: 'error',
  SRG_ID_COMPLETENESS: 'warning',
  NO_DEPRECATED_TERMS: 'warning',
  STORY_REFS_REQUIRED: 'error'
};
