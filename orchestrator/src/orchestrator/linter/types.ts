// Linter type definitions

export interface LintRule {
  id: string;
  level: 'error' | 'warning';
  description: string;
  check: (context: LintContext) => LintResult[] | Promise<LintResult[]>;
}

export interface LintContext {
  projectRoot: string;
  files: FileEntry[];
  config: any;
}

export interface FileEntry {
  path: string;
  content: string;
  lines: string[];
}

export interface LintResult {
  ruleId: string;
  level: 'error' | 'warning';
  file: string;
  line?: number;
  column?: number;
  message: string;
  /** Optional automatic fix */
  fix?: () => Promise<void> | void;
}

export interface LintReport {
  results: LintResult[];
  errors: number;
  warnings: number;
  filesChecked: number;
  rulesApplied: number;
  durationMs: number;
}

export interface LintOptions {
  /** Only run specific rules */
  onlyRules?: string[];
  /** Skip specific rules */
  skipRules?: string[];
  /** Auto-fix fixable issues */
  fix?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
}
