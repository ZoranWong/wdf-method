import { LintRule } from '../types.js';
import { VersionConsistencyRule } from './version-consistency.js';
import { SrgIdCompletenessRule } from './srg-id-completeness.js';
import { NoDeprecatedTermsRule } from './no-deprecated-terms.js';
import { StoryRefsRequiredRule } from './story-refs-required.js';
import { StoryRefsResolveRule } from './story-refs-resolve.js';
import { StoryScopeRequiredRule } from './story-scope-required.js';
import { AgentSafetyRule } from './agent-safety.js';
import { ConstitutionCheckRule } from './constitution-check.js';
import { StoryPackRequiredRule } from './story-pack-required.js';
import { ReqCoverageRule } from './req-coverage.js';
import { ApiScopeMappingRule } from './api-scope-mapping.js';
import { DbApiConsistencyRule } from './db-api-consistency.js';
import { AcTestBindingRule } from './ac-test-binding.js';
import { SpecDriftRule } from './spec-drift.js';

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
  StoryPackRequiredRule,
  ReqCoverageRule,
  ApiScopeMappingRule,
  DbApiConsistencyRule,
  AcTestBindingRule,
  SpecDriftRule,
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
  STORY_PACK_REQUIRED: 'warning',
  // Phase B (V3.10.2) semantic rules — default to warning so existing
  // projects aren't broken on first upgrade. Strict mode promotes them.
  REQ_COVERAGE: 'warning',
  API_SCOPE_MAPPING: 'warning',
  DB_API_CONSISTENCY: 'warning',
  AC_TEST_BINDING: 'warning',
  // Phase D (V3.10.4) drift rule — same rationale: warning by default so
  // greenfield (code leads spec) and legacy projects aren't spammed; strict
  // promotes it to a pre-merge gate so unspec'd endpoints never land on main.
  SPEC_DRIFT: 'warning',
};
