import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import {
  parseToml,
  loadConfig,
  resolvePath,
  getOutputDir,
  getSprintTrackingPath,
  getStatusDir,
  getStoriesDir,
  getMergeQueueDir,
  getSignalDir,
  getAuditDir,
  getSpecsDir,
  DEFAULT_CONFIG,
} from './config.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `wdf-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('parseToml', () => {
  it('parses simple key/value pairs', () => {
    const out = parseToml(`
[workflow]
version = "3.6.0"
dev_mode = "separated"
`);
    expect(out.workflow).toBeDefined();
    expect(out.workflow.version).toBe('3.6.0');
    expect(out.workflow.dev_mode).toBe('separated');
  });

  it('parses booleans and numbers', () => {
    const out = parseToml(`
[acceptance_gates]
code_acceptance_min_coverage = 80
code_acceptance_require_lint = true
e2e_browser_acceptance_visual_diff_threshold_pct = 0.5
`);
    expect(out.acceptance_gates.code_acceptance_min_coverage).toBe(80);
    expect(out.acceptance_gates.code_acceptance_require_lint).toBe(true);
    expect(out.acceptance_gates.e2e_browser_acceptance_visual_diff_threshold_pct).toBe(0.5);
  });

  it('parses single-line arrays', () => {
    const out = parseToml(`
[acceptance_gates]
e2e_browser_acceptance_browsers = ["chrome", "firefox", "safari"]
`);
    expect(out.acceptance_gates.e2e_browser_acceptance_browsers).toEqual(['chrome', 'firefox', 'safari']);
  });

  it('parses multi-line arrays', () => {
    const out = parseToml(`
[scope_lock]
forbidden_paths = [
  "/etc/",
  "~/.ssh/",
  ".env.production",
]
`);
    expect(out.scope_lock.forbidden_paths).toEqual(['/etc/', '~/.ssh/', '.env.production']);
  });

  it('parses nested sections', () => {
    const out = parseToml(`
[auto_run]
enabled = true

[auto_run.concurrency]
max_concurrent_stories = 5
`);
    expect(out.auto_run.enabled).toBe(true);
    expect(out.auto_run.concurrency.max_concurrent_stories).toBe(5);
  });

  it('ignores comment lines and inline comments', () => {
    const out = parseToml(`
# This is a comment
[workflow]
version = "3.6.0"  # inline comment
`);
    expect(out.workflow.version).toBe('3.6.0');
  });
});

describe('loadConfig', () => {
  it('returns defaults when no customize.toml present', () => {
    const { config, sources } = loadConfig(tmpRoot, { silent: true });
    expect(sources).toHaveLength(0);
    expect(config.workflow.version).toBe(DEFAULT_CONFIG.workflow.version);
    expect(config.workflow.output_dir).toBe(DEFAULT_CONFIG.workflow.output_dir);
    expect(config.acceptance_gates.code_acceptance_min_coverage).toBe(80);
  });

  it('loads customize.toml from project root', () => {
    writeFileSync(join(tmpRoot, 'customize.toml'), `
[workflow]
version = "9.9.9"
output_dir = "{project-root}/custom-output"
sprint_tracking = "{project-root}/custom-output/status.yaml"
status_dir = "{project-root}/custom-output/status"
stories_output = "{project-root}/custom-output/stories"
`);
    const { config, sources } = loadConfig(tmpRoot, { silent: true });
    expect(sources.length).toBe(1);
    expect(config.workflow.version).toBe('9.9.9');
    expect(config.workflow.output_dir).toBe('{project-root}/custom-output');
  });

  it('overlays user override file on top of base', () => {
    writeFileSync(join(tmpRoot, 'customize.toml'), `
[workflow]
version = "3.6.0"

[acceptance_gates]
code_acceptance_min_coverage = 80
`);
    const customDir = join(tmpRoot, '_bmad', 'custom');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'web-dev-flow.user.toml'), `
[acceptance_gates]
code_acceptance_min_coverage = 95
`);
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(config.acceptance_gates.code_acceptance_min_coverage).toBe(95);
    expect(config.workflow.version).toBe('3.6.0');
  });

  it('warns about unknown sections', () => {
    writeFileSync(join(tmpRoot, 'customize.toml'), `
[workflow]
version = "3.6.0"

[mystery_section]
foo = "bar"
`);
    const { warnings } = loadConfig(tmpRoot, { silent: true });
    expect(warnings.some(w => w.includes('mystery_section'))).toBe(true);
  });

  it('warns and uses defaults when required workflow keys are missing', () => {
    writeFileSync(join(tmpRoot, 'customize.toml'), `
[acceptance_gates]
code_acceptance_min_coverage = 70
`);
    const { config, warnings } = loadConfig(tmpRoot, { silent: true });
    // workflow defaults should still be present
    expect(config.workflow.output_dir).toBe(DEFAULT_CONFIG.workflow.output_dir);
    expect(config.acceptance_gates.code_acceptance_min_coverage).toBe(70);
    // No missing-key warnings since defaults backfill
    expect(warnings.filter(w => w.includes('output_dir'))).toHaveLength(0);
  });
});

describe('path helpers', () => {
  it('resolvePath substitutes {project-root}', () => {
    const out = resolvePath('{project-root}/foo/bar', '/abs/proj');
    expect(out).toBe('/abs/proj/foo/bar');
  });

  it('resolvePath expands ~ home tokens', () => {
    const out = resolvePath('~/.wdf-method/signals', '/abs/proj');
    expect(out.startsWith(homedir())).toBe(true);
    expect(out.endsWith('.wdf-method/signals')).toBe(true);
  });

  it('getOutputDir resolves to absolute path under project root', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getOutputDir(config, tmpRoot)).toBe(resolve(tmpRoot, '_wdf_output'));
  });

  it('getSprintTrackingPath resolves to sprint-status.yaml', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getSprintTrackingPath(config, tmpRoot)).toBe(
      resolve(tmpRoot, '_wdf_output/sprint-status.yaml')
    );
  });

  it('getStatusDir resolves to status/', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getStatusDir(config, tmpRoot)).toBe(resolve(tmpRoot, '_wdf_output/status'));
  });

  it('getStoriesDir resolves to stories/', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getStoriesDir(config, tmpRoot)).toBe(resolve(tmpRoot, '_wdf_output/stories'));
  });

  it('getMergeQueueDir falls back to status/merge-queue', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getMergeQueueDir(config, tmpRoot)).toBe(
      resolve(tmpRoot, '_wdf_output/status/merge-queue')
    );
  });

  it('getSignalDir defaults to ~/.wdf-method/signals', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    const dir = getSignalDir(config, tmpRoot);
    expect(dir.startsWith(homedir())).toBe(true);
    expect(dir.endsWith('.wdf-method/signals')).toBe(true);
  });

  it('getSignalDir respects explicit absolute path', () => {
    writeFileSync(join(tmpRoot, 'customize.toml'), `
[agent_communication]
signal_dir = "/var/run/wdf-signals"
`);
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getSignalDir(config, tmpRoot)).toBe('/var/run/wdf-signals');
  });

  it('getAuditDir is sibling to sprint-status.yaml', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getAuditDir(config, tmpRoot)).toBe(
      resolve(tmpRoot, '_wdf_output/audit')
    );
  });

  it('respects custom output_dir from customize.toml', () => {
    writeFileSync(join(tmpRoot, 'customize.toml'), `
[workflow]
output_dir = "{project-root}/build/wdf"
sprint_tracking = "{project-root}/build/wdf/status.yaml"
status_dir = "{project-root}/build/wdf/state"
stories_output = "{project-root}/build/wdf/stories"
`);
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(getOutputDir(config, tmpRoot)).toBe(resolve(tmpRoot, 'build/wdf'));
    expect(getStatusDir(config, tmpRoot)).toBe(resolve(tmpRoot, 'build/wdf/state'));
    expect(getStoriesDir(config, tmpRoot)).toBe(resolve(tmpRoot, 'build/wdf/stories'));
  });
});

describe('specs section (CHG-2026-015 S1)', () => {
  it('defaults to source_of_truth=false and standard paths', () => {
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(config.specs).toBeDefined();
    expect(config.specs.source_of_truth).toBe(false);
    expect(config.specs.default_sync_direction).toBe('reverse');
    expect(config.specs.managed_region_marker).toBe('wdf:specs-sync');
    expect(config.specs.enforce_unique_requirement_names).toBe(true);
    expect(getSpecsDir(config, tmpRoot)).toBe(resolve(tmpRoot, '_wdf_output/specs'));
  });

  it('honors [specs] override from customize.toml', () => {
    writeFileSync(join(tmpRoot, 'customize.toml'), `
[specs]
source_of_truth = true
default_sync_direction = "forward"
specs_dir = "{project-root}/custom-specs"
`);
    const { config } = loadConfig(tmpRoot, { silent: true });
    expect(config.specs.source_of_truth).toBe(true);
    expect(config.specs.default_sync_direction).toBe('forward');
    expect(getSpecsDir(config, tmpRoot)).toBe(resolve(tmpRoot, 'custom-specs'));
  });
});
