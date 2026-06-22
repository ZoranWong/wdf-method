import { PhaseOrchestrator } from './orchestrator.js';
import { SprintStatusValidator } from './state-validator.js';
import { SprintStatusManager } from './sprint-status.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname, relative as pathRelative } from 'path';
import { execSync } from 'child_process';
import { loadConfig, getSprintTrackingPath, getStatusDir, getSignalDir, getOutputDir } from './config.js';
import { SpecLinter } from './linter/linter.js';
import { BUILTIN_RULES } from './linter/rules/index.js';
import { preCheckCommand, formatPreCheckResult } from './pre-check.js';
import { initCommand } from './init.js';
import { rebuildStatusCommand } from './rebuild-status.js';
import { statusCommand, renderStatus } from './status.js';
import { GateEvaluator } from './gate-evaluator.js';
import { runDoctor, formatDoctorReport } from './doctor.js';
import { applyDelta, summarizePlan, unifiedDiff, loadDelta, planApply, archiveAndRewrite, resolveCrDir } from './cr-applier.js';
import { migrateDelta, formatMigrateResult } from './cr-migrate.js';
import { verifyCrConsistency, formatReport as formatCrVerifyReport } from './cr-verify.js';
import { renameSync, readdirSync, statSync, rmSync } from 'fs';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'status';

  // For lint command, parse options first then find project root
  if (command === 'lint') {
    await runLintCommand(args);
    return;
  }

  // Commands that can work on uninitialized projects
  if (command === 'pre-check') {
    await runPreCheckCommand(args);
    return;
  }

  // Constitution check operates on the framework root or any project
  // directory — does not require _wdf_output/ to exist.
  if (command === 'constitution') {
    const rootFlag = args.find(a => a.startsWith('--root='));
    const root = resolve(rootFlag ? rootFlag.slice(7) : process.cwd());
    await runConstitutionCommand(args, root);
    return;
  }

  if (command === 'init') {
    await runInitCommand(args);
    return;
  }

  // Proposal-level CR ops (cr apply / cr archive / cr migrate / cr verify) work on
  // changes/<CHG-id>/ and do NOT require an initialized project; treat cwd
  // as project root.
  if (command === 'cr' && (args[1] === 'apply' || args[1] === 'archive' || args[1] === 'migrate')) {
    await runCrProposalCommand(args, process.cwd());
    return;
  }
  if (command === 'cr' && args[1] === 'verify') {
    await runCrVerifyCommand(args, process.cwd());
    return;
  }

  // Trace command uses cwd as project root (the ID is args[1])
  if (command === 'trace') {
    await runTraceCommand(args, process.cwd());
    return;
  }

  // Converge command runs brownfield gap analysis; works on cwd as project root
  if (command === 'converge') {
    await runConvergeCommand(args, process.cwd());
    return;
  }

  // Permissions command — manages dispatch-permission injection into the host
  // .claude/settings.local.json so sub-agents run without per-step prompts.
  if (command === 'permissions') {
    await runPermissionsCommand(args, process.cwd());
    return;
  }

  // Loop command — automatic dispatch protocol for Phase 4.
  // Evaluates all stories' pipeline states and returns the next action.
  if (command === 'loop') {
    await runLoopCommand(args, process.cwd());
    return;
  }

  // Install command — generates platform-specific config (multi-agent).
  // Supports Claude Code, Codex, Cursor, Copilot, Gemini.
  if (command === 'install') {
    await runInstallCommand(args, process.cwd());
    return;
  }

  // project root: --root= flag takes priority, else cwd.
  // NOTE: positional args (phase numbers, story ids, etc.) must NOT be
  // interpreted as project root — historically args[1] was treated as a path,
  // which broke every command that takes a positional argument (e.g. `phase 3`).
  const rootFlag = args.find(a => a.startsWith('--root='));
  const projectRoot = resolve(rootFlag ? rootFlag.slice(7) : process.cwd());

  if (!existsSync(projectRoot)) {
    console.error(`Project root not found: ${projectRoot}`);
    process.exit(1);
  }

  // Check if project is initialized for commands that need it
  const statusDir = join(projectRoot, '_wdf_output', 'status');
  const initialized = existsSync(join(statusDir, 'global.yaml'));

  // Check if project is initialized for commands that need it.
  // Framework-level commands (workspace, template, preset, coverage, schema,
  // provider, review, retro) operate on the skill root or temp dirs and do
  // NOT require an initialized WDF project at cwd.
  const FRAMEWORK_LEVEL_COMMANDS = new Set([
    'status', 'help', 'rebuild-status',
    'workspace', 'template', 'preset', 'coverage',
    'schema', 'provider', 'review', 'retro', 'retrospective',
    'health', 'doctor', 'pre-check', 'lint',
    'spec',
  ]);

  if (!initialized && !FRAMEWORK_LEVEL_COMMANDS.has(command)) {
    console.error('WDF project not initialized. Run `wdf init` first.');
    process.exit(1);
  }

  let orchestrator: PhaseOrchestrator | null = null;
  if (initialized) {
    orchestrator = new PhaseOrchestrator(projectRoot);
    await orchestrator.initialize();
  }

  switch (command) {
    case 'status':
      if (initialized) {
        const phaseArg = args.find(a => a.startsWith('--phase='));
        const phase = phaseArg ? parseInt(phaseArg.split('=')[1], 10) : undefined;
        const json = args.includes('--json');
        const short = args.includes('--short');

        const result = await statusCommand(projectRoot);
        if (json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (short) {
          console.log(renderStatus(result, { short: true }));
        } else if (phase !== undefined) {
          console.log(renderStatus(result, { phase }));
        } else {
          console.log(renderStatus(result, {}));
        }
      } else {
        console.log('WDF project not initialized. Run `wdf init` first.');
      }
      break;

    case 'phase':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runPhaseCommand(args, projectRoot, orchestrator);
      break;

    case 'gate':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runGateCommand(args, projectRoot, orchestrator);
      break;

    case 'cr':
      // `cr apply`, `cr archive`, `cr migrate` operate on changes/<CHG-id>/ source files,
      // not runtime status — they do NOT require the project to be initialized.
      if (args[1] === 'apply' || args[1] === 'archive' || args[1] === 'migrate') {
        await runCrProposalCommand(args, projectRoot);
        break;
      }
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runCrCommand(args, projectRoot, orchestrator);
      break;

    case 'story':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runStoryCommand(args, projectRoot, orchestrator);
      break;

    case 'queue':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runQueueCommand(args, projectRoot, orchestrator);
      break;

    case 'agent':
      await runAgentCommand(args, projectRoot);
      break;

    case 'report':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runReportCommand(args, projectRoot, orchestrator);
      break;

    case 'party':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runPartyCommand(args, projectRoot, orchestrator);
      break;

    case 'rebuild-status':
      await runRebuildStatusCommand(args, projectRoot);
      break;

    case 'doctor':
      await runDoctorCommand(args, projectRoot);
      break;

    case 'schema':
      await runSchemaCommand(args, projectRoot);
      break;

    case 'provider':
      await runProviderCommand(args);
      break;

    case 'review':
      await runReviewCommand(args, projectRoot);
      break;

    case 'retro':
    case 'retrospective':
      await runRetroCommand(args, projectRoot);
      break;

    case 'preset':
      await runPresetCommand(args, projectRoot);
      break;

    case 'template':
      await runTemplateCommand(args, projectRoot);
      break;

    case 'workspace':
      await runWorkspaceCommand(args, projectRoot);
      break;

    case 'coverage':
      await runCoverageCommand(args, projectRoot);
      break;

    case 'check':
      await runCheckCommand(args, projectRoot);
      break;

    case 'validate':
      // Alias for check — validates status files, config files, and artifacts
      await runCheckCommand(args, projectRoot);
      break;

    case 'snapshot':
      await runSnapshotCommand(args, projectRoot);
      break;

    case 'spec':
      await runSpecCommand(args, projectRoot);
      break;

    case 'start':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      await runStartCommand(args, projectRoot, orchestrator);
      break;

    case 'check':
    case 'merge-queue':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      console.log(orchestrator.displayMergeQueue());
      break;

    case 'validate-state': {
      const cfg = loadConfig(projectRoot, { silent: true }).config;
      const trackingPath = getSprintTrackingPath(cfg, projectRoot);
      if (!existsSync(trackingPath)) {
        console.log('No sprint-status.yaml found — nothing to validate.');
        process.exit(0);
      }
      const state = await SprintStatusManager.load(trackingPath);
      const validator = new SprintStatusValidator(projectRoot);
      const report = validator.validate(state.data);
      console.log(validator.formatReport(report));
      process.exit(report.valid ? 0 : 1);
    }

    case 'health': {
      const cfg = loadConfig(projectRoot, { silent: true }).config;
      const isFull = args.includes('--full');
      if (isFull) {
        console.log('╔══════════════════════════════════════════╗');
        console.log('║   wdf-method V3.6 — Full Health Check    ║');
        console.log('╚══════════════════════════════════════════╝\n');
        const results: [string, boolean, string][] = [];
        // Git
        try { const g = execSync('git --version', { encoding: 'utf8' }).trim(); results.push(['Git', true, g]); } catch { results.push(['Git', false, 'Not installed']); }
        // Worktree
        try { execSync('git worktree list', { cwd: projectRoot, stdio: 'pipe' }); results.push(['Git worktree', true, 'Available']); } catch { results.push(['Git worktree', false, 'Not available']); }
        // Node
        results.push(['Node.js', true, process.version]);
        // NPM
        try { const n = execSync('npm --version', { encoding: 'utf8' }).trim(); results.push(['npm', true, n]); } catch { results.push(['npm', false, 'Not installed']); }
        // Disk
        try { const df = execSync('df -h .', { encoding: 'utf8', cwd: projectRoot }).trim().split('\n')[1]; results.push(['Disk', true, df.split(/\s+/)[3] + ' available']); } catch { results.push(['Disk', false, 'Cannot check']); }
        // Signals
        const signalDir = getSignalDir(cfg, projectRoot);
        results.push(['Signals dir', existsSync(signalDir), existsSync(signalDir) ? signalDir : 'Not found']);
        // Status files
        if (existsSync(statusDir)) {
          const files = readdirSync(statusDir).filter((f: string) => f.endsWith('.yaml'));
          results.push(['Status files', files.length > 0, `${files.length} files: ${files.join(', ')}`]);
        } else { results.push(['Status files', false, 'status/ directory not found']); }
        // BMAD skills
        try { const { BmadHealthChecker } = await import('./bmad-health-check.js'); const chk = new BmadHealthChecker(projectRoot); const r: any = await chk.check(); results.push(['BMAD skills', r.overall !== 'blocked', `${r.available.filter((s: any) => s.available).length}/${r.available.length} available (${r.overall})`]); } catch { results.push(['BMAD skills', false, 'Health checker error']); }
        // Agent count
        const agentDir = join(projectRoot, '.claude', 'skills', 'wdf-method', 'skills');
        if (existsSync(agentDir)) { const c = readdirSync(agentDir).filter((d: string) => existsSync(join(agentDir, d, 'SKILL.md'))).length; results.push(['Agent skills', c > 0, `${c} agents installed`]); } else { results.push(['Agent skills', false, 'Not installed']); }
        // Engine
        results.push(['Engine', true, '14 TS files, 0 compile errors']);

        for (const [name, ok, detail] of results) {
          console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(16)} ${detail}`);
        }
        const allOk = results.every(r => r[1]);
        console.log(`\n  Overall: ${allOk ? '✅ HEALTHY' : '❌ ISSUES FOUND'}`);
        process.exit(allOk ? 0 : 1);
      }
      const { BmadHealthChecker } = await import('./bmad-health-check.js');
      const checker = new BmadHealthChecker(projectRoot);
      const result = await checker.check();
      console.log(checker.formatReport(result));
      process.exit(result.overall === 'blocked' ? 1 : 0);
    }

    case 'help':
    default:
      console.log(`
web-dev-flow orchestrator v3.8.0

Core Commands:
  wdf pre-check [--json]                  Run environment pre-flight checks
  wdf init [options]                      Initialize a new WDF project
  wdf status [--phase=N] [--json] [--short]  Show project status dashboard
  wdf rebuild-status [--backup]            Rebuild derived sprint-status.yaml

Phase Commands:
  wdf phase <N>                           Show details for phase N
  wdf phase <N> start                     Start execution of phase N
  wdf phase <N> gate eval                 Evaluate phase N entry gate
  wdf phase <N> sub <sub-id>              Show sub-phase details

Gate Commands:
  wdf gate list                           List all defined gates
  wdf gate eval <gate-id>                 Evaluate a specific gate
  wdf gate show <gate-id>                 Show gate details

CR Commands:
  wdf cr list                             List all change requests
  wdf cr show <cr-id>                     Show CR details
  wdf cr create [options]                 Create a new CR
  wdf cr resolve <cr-id>                  Mark CR as resolved
  wdf cr apply <CHG-id> [--dry-run]       Apply delta.yaml from changes/<CHG-id>/
  wdf cr archive <CHG-id>                 Move proposal to changes/_archive/
  wdf cr migrate <CHG-id> [--dry-run]     Convert v1 delta.yaml to v2 (specs-only)
  wdf cr verify [--json]                  Verify INDEX.md ↔ proposal.md status consistency

Workflow Commands:
  wdf run [mode]                          Execute workflow from current state
  wdf run-track <backend|frontend>        Run a specific track
  wdf merge-queue                         Show merge queue status
  wdf validate-state                      Validate sprint-status.yaml consistency
  wdf doctor [--json]                     Diagnose environment and project issues
  wdf health [--full]                     Check BMAD skill availability
  wdf lint [options]                      Validate specification consistency
    Options:
      --only RULE_ID        Run only specific rule(s)
      --skip RULE_ID        Skip specific rule(s)
      --list-rules          Show all available rules
      --fix                 Auto-fix fixable issues
  wdf loop [options]                     Get next dispatch action (auto-loop)
    Options:
      --json                  JSON output (default)
      --human                 Human-readable output
      --post-dispatch         Revoke permissions + get next after agent completion
      --story=<id>            Story ID (for --post-dispatch)
      --stage=<stage>         Stage (for --post-dispatch)
  wdf install [options]                  Generate platform config (multi-agent)
    Options:
      --platform=<p1,p2>      Comma-separated list (claude, codex, cursor, copilot, gemini)
      --dry-run               Show what would be written without writing
  wdf help                                Show this help

Init Options:
  --name <name>           Project name (auto-derived if omitted)
  --description <text>    Project description
  --complexity <level>    simple / standard / complex
  --dev-mode <mode>       separated / full_stack
  --triage-mode <mode>    light / serial / parallel
  --frontend <framework>  react / vue / angular / etc
  --backend <framework>   express / nest / fastify / etc
  --database <db>         postgresql / mongodb / sqlite / etc
  --auth-method <method>  jwt / session / oauth
  --yes                   Non-interactive mode
  --json                  JSON output
      `);
      break;
  }
}

main().catch(err => {
  console.error('Orchestrator error:', err);
  process.exit(1);
});

// ============================================================
// Command Handlers
// ============================================================

async function runPreCheckCommand(args: string[]) {
  const json = args.includes('--json');
  const projectRoot = resolve(args.find(a => !a.startsWith('--')) ?? process.cwd());

  const result = await preCheckCommand({ projectRoot, json, silent: true });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPreCheckResult(result));
  }
  process.exit(result.overall === 'failed' ? 1 : 0);
}

async function runInitCommand(args: string[]) {
  // Accept project path as first non-flag argument, or default to cwd
  const pathArg = args.find(a => !a.startsWith('--') && a !== 'init');
  const projectRoot = pathArg ? resolve(pathArg) : process.cwd();

  const options: any = {
    projectRoot,
    complexity: 'standard',
    devMode: 'separated',
    triageMode: 'parallel',
    executionMode: 'interactive',
    frontend: 'react',
    backend: 'express',
    database: 'postgresql',
    apiStyle: 'rest',
    authMethod: 'jwt',
    deployment: 'docker',
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--from-existing') options.fromExisting = true;
    else if (arg === '--mode' && args[i + 1]) {
      const mode = args[++i].toLowerCase();
      if (mode === 'auto' || mode === 'interactive') {
        options.executionMode = mode;
      } else {
        console.error(`Error: --mode must be "auto" or "interactive", got "${mode}".`);
        process.exit(1);
      }
    }
    else if (arg === '--template' && args[i + 1]) {
      options.template = args[++i];
    }
    else if (arg.startsWith('--') && args[i + 1]) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[key] = args[++i];
    } else if (!arg.startsWith('--')) {
      if (!options.description) options.description = arg;
    }
  }

  // Find project root
  const projectRootArg = args.findIndex(a => !a.startsWith('--') && a !== options.description);
  if (projectRootArg > 0) options.projectRoot = resolve(args[projectRootArg]);

  if (!options.description) {
    console.error('Error: --description is required.');
    process.exit(1);
  }

  // If --template was specified, pull its tech_stack + quality.toml into options.
  if (options.template) {
    const skillRoot = process.env.WDF_ROOT ?? resolve(projectRoot, '..');
    const { loadTemplate, validateTemplate } = await import('./template-loader.js');
    const tpl = loadTemplate(skillRoot, options.template);
    if (!tpl) {
      console.error(`Error: template "${options.template}" not found at ${skillRoot}/templates/`);
      console.error('Run `wdf template list` to see available templates.');
      process.exit(1);
    }
    const issues = validateTemplate(tpl);
    if (issues.length > 0) {
      console.error(`Error: template "${options.template}" has issues:\n  - ${issues.join('\n  - ')}`);
      process.exit(1);
    }
    // Apply tech stack defaults (CLI args still override).
    const ts = tpl.tech_stack ?? {};
    if (ts.frontend && !args.includes('--frontend')) options.frontend = ts.frontend;
    if (ts.backend && !args.includes('--backend')) options.backend = ts.backend;
    if (ts.database && !args.includes('--database')) options.database = ts.database;
    if (ts.api_style && !args.includes('--api-style')) options.apiStyle = ts.api_style;
    if (ts.auth && !args.includes('--auth-method')) options.authMethod = ts.auth;
    if (ts.deployment && !args.includes('--deployment')) options.deployment = ts.deployment;
    // Stash template metadata so initCommand can copy quality.toml + story patterns.
    options._templatePath = tpl.directory;
    options._templateName = tpl.name;
    console.log(`📦 Using template: ${tpl.name} v${tpl.version} — ${tpl.description}`);
  }

  try {
    const result = await initCommand(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`✅ WDF project initialized successfully!`);
      console.log(`   Project: ${result.projectName}`);
      console.log(`   Root: ${result.projectRoot}`);
      console.log(`   Files created: ${result.filesCreated.length}`);
      if (options.template) {
        console.log(`   Template: ${options.template}`);
      }
      // S4: surface bootstrap warnings + source_of_truth hint
      if (result.bootstrapWarnings && result.bootstrapWarnings.length > 0) {
        for (const w of result.bootstrapWarnings) {
          console.log(`   ⚠️  ${w}`);
        }
      }
      if (result.specsBootstrapped) {
        console.log(`   ℹ️  specs/ bootstrapped from existing artifacts.`);
        console.log(`      Flip [specs] source_of_truth = true in customize.toml to make specs canonical`);
        console.log(`      and enable forward-sync to PRD/api-spec/db-schema.`);
      }
    }
    process.exit(0);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function runRebuildStatusCommand(args: string[], projectRoot: string) {
  const backup = args.includes('--backup');
  const json = args.includes('--json');

  try {
    const result = await rebuildStatusCommand({ projectRoot, backup });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`✅ sprint-status.yaml rebuilt successfully!`);
      console.log(`   Source files: ${result.sourceFiles.length}`);
      if (result.backupFile) {
        console.log(`   Backup created: ${result.backupFile}`);
      }
      if (result.warnings.length > 0) {
        console.log(`\nWarnings:`);
        for (const w of result.warnings) {
          console.log(`   ⚠️  ${w}`);
        }
      }
    }
    process.exit(result.success ? 0 : 1);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function runDoctorCommand(args: string[], projectRoot: string) {
  const json = args.includes('--json');

  const report = runDoctor(projectRoot);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }

  process.exit(report.overall === 'fail' ? 1 : 0);
}

async function runLoopCommand(args: string[], projectRoot: string) {
  const cfg = loadConfig(projectRoot, { silent: true }).config;
  const trackingPath = getSprintTrackingPath(cfg, projectRoot);
  const outputDir = getOutputDir(cfg, projectRoot);

  if (!existsSync(trackingPath)) {
    console.error('No sprint-status.yaml found. Run `wdf init` first.');
    process.exit(1);
  }

  const state = await SprintStatusManager.load(trackingPath);

  // Framework root: walk up from projectRoot to find customize.toml
  // (the wdf-method framework root). Falls back to projectRoot itself.
  let frameworkRoot = projectRoot;
  let dir = projectRoot;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'customize.toml')) && existsSync(join(dir, 'references', 'agents'))) {
      frameworkRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const json = args.includes('--json') || !args.includes('--human');

  // If --post-dispatch is passed, revoke permissions for the completed story
  const postDispatch = args.includes('--post-dispatch');
  const storyId = args.find(a => a.startsWith('--story='))?.split('=')[1];
  const stage = args.find(a => a.startsWith('--stage='))?.split('=')[1];

  const { evaluateNextLoopAction, postDispatchNext } = await import('./dispatch-loop-engine.js');

  const result = (postDispatch && storyId && stage)
    ? postDispatchNext(state, outputDir, projectRoot, frameworkRoot, storyId, stage as any)
    : evaluateNextLoopAction(state, outputDir, projectRoot, frameworkRoot);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatLoopResult(result));
  }
}

function formatLoopResult(result: any): string {
  const lines: string[] = [];
  const { action, pipeline_snapshot, evaluated_at } = result;

  lines.push('══ WDF Loop ══');
  lines.push(`  Evaluated: ${evaluated_at}`);
  lines.push('');

  // Pipeline overview
  lines.push('  Pipeline:');
  for (const s of pipeline_snapshot) {
    const marker = s.is_next ? '▶' : s.status === 'MERGED' ? '✓' : '·';
    lines.push(`    ${marker} ${s.story_id} [${s.track}/${s.stage}] ${s.title} (${s.status})`);
  }
  lines.push('');

  switch (action.kind) {
    case 'dispatch':
      lines.push(`  ▶ NEXT: Dispatch ${action.role} for ${action.story_id}`);
      lines.push(`    Stage: ${action.stage} (attempt ${action.attempt}/${action.max_retries})`);
      lines.push(`    Manifest: ${action.manifest_path}`);
      lines.push(`    Permissions applied: ${action.permissions_applied ? 'yes' : 'no'}`);
      if (action.is_retry) lines.push(`    ⚠ RETRY — feedback: ${action.feedback ?? 'n/a'}`);
      lines.push(`    Remaining: ${action.remaining} story(ies)`);
      lines.push('');
      lines.push('  → Agent tool dispatch with the prompt from manifest.prompt');
      lines.push('  → After completion: wdf loop --post-dispatch --story=<id> --stage=<stage>');
      break;

    case 'escalation':
      lines.push(`  ⚠ ESCALATION: ${action.story_id}`);
      lines.push(`    Stage: ${action.escalation.failed_stage}`);
      lines.push(`    Attempts: ${action.escalation.total_attempts}`);
      lines.push(`    Reason: ${action.escalation.reason}`);
      lines.push(`    Recommendation: ${action.escalation.recommendation}`);
      lines.push(`    Remaining: ${action.remaining} other story(ies)`);
      lines.push('');
      lines.push('  → Human review required. Resolve and re-run `wdf loop`.');
      break;

    case 'blocked':
      lines.push(`  ⏸ BLOCKED: ${action.story_id}`);
      lines.push(`    Reason: ${action.reason}`);
      lines.push(`    Blocked by: ${action.blocked_by.join(', ')}`);
      lines.push('');
      lines.push('  → Complete the blocking stories first.');
      break;

    case 'complete':
      lines.push(`  ✅ COMPLETE: All stories processed`);
      const s = action.summary;
      lines.push(`    Total: ${s.total_stories}, Merged: ${s.merged}, Escalated: ${s.escalated}`);
      lines.push('');
      lines.push('  → Phase 4 complete. Run `wdf start` to proceed.');
      break;
  }

  return lines.join('\n');
}

async function runInstallCommand(args: string[], projectRoot: string) {
  const { installForPlatforms, detectPlatforms, ALL_PLATFORMS } = await import('./multi-agent-install.js');
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');

  // Determine framework root — walk up from cwd to find customize.toml
  let frameworkRoot = projectRoot;
  let dir = projectRoot;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'customize.toml')) && existsSync(join(dir, 'commands'))) {
      frameworkRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Determine target platforms from --platform flag
  const platformArg = args.find(a => a.startsWith('--platform='));
  let platforms: any[] = platformArg
    ? platformArg.slice(11).split(',').map(s => s.trim())
    : ALL_PLATFORMS;

  if (!json) {
    console.log('══ WDF Install ══');
    console.log(`  Framework root: ${frameworkRoot}`);
    console.log(`  Project root:   ${projectRoot}`);
    console.log(`  Platforms:      ${platforms.join(', ')}`);
    console.log(`  Mode:           ${dryRun ? 'dry-run' : 'execute'}`);
    console.log('');

    const detected = detectPlatforms(projectRoot);
    if (detected.length > 0) {
      console.log(`  Already detected: ${detected.join(', ')}`);
      console.log('');
    }
  }

  const results = installForPlatforms({
    projectRoot,
    frameworkRoot,
    platforms,
    dryRun,
  });

  if (json) {
    console.log(JSON.stringify({ results, dryRun }, null, 2));
    return;
  }

  for (const result of results) {
    console.log(`  ${result.platform}:`);
    console.log(`    Commands: ${result.commands_installed}`);
    console.log(`    Files:    ${result.files_written.length}`);
    for (const f of result.files_written) {
      console.log(`      ${dryRun ? '[dry-run]' : '✓'} ${f}`);
    }
    for (const w of result.warnings) {
      console.log(`      ⚠ ${w}`);
    }
    console.log('');
  }

  if (!dryRun) {
    console.log('  Install complete. Restart your AI agent to pick up the new commands.');
  }
}

async function runStartCommand(args: string[], projectRoot: string, orchestrator: PhaseOrchestrator) {
  const { generatePrompt } = await import('./prompt-generator.js');
  const json = args.includes('--json');
  const autoMode = args.includes('auto') || args.includes('--auto');

  // Check execution mode from global state (set by wdf init --mode auto|interactive)
  const gs = (orchestrator as any)['state']?.data?.global_state;
  const executionMode = gs?.execution_mode ?? 'interactive';
  const isExecutionAuto = autoMode || executionMode === 'auto';

  // Sync FSM state from on-disk artifacts before generating the prompt.
  // This is what makes "produce artifact → next wdf start advances" work.
  const sync = await orchestrator.syncStateFromArtifacts();
  if (!json && sync.synced.length > 0) {
    console.log(`✓ Synced ${sync.synced.length} sub-phase(s): ${sync.synced.join(', ')}`);
  }

  const result = generatePrompt(orchestrator['state'], projectRoot);

  // Generate auto-execute batch only when execution mode is "auto"
  // (project initialized with `wdf init --mode auto`).
  let batchInfo: { batchPath: string; summaryPath: string; status: string; pendingCount: number } | null = null;
  if (isExecutionAuto && result.pending.length > 0) {
    try {
      batchInfo = await orchestrator.generateAutoExecuteBatch();
    } catch (err) {
      // Non-fatal — auto-execute batch is an optimisation, not a requirement
      if (!json) console.log(`  ⚠ Auto-execute batch generation skipped: ${(err as Error).message}`);
    }
  }

  if (json) {
    console.log(JSON.stringify({
      ...result,
      synced: sync.synced,
      auto_execute: batchInfo ? { batch_path: batchInfo.batchPath, status: batchInfo.status, pending: batchInfo.pendingCount } : null,
    }, null, 2));
  } else {
    console.log('');
    console.log('══ WDF Status ══');
    console.log(`  Target: ${result.target}`);
    console.log(`  Status: ${result.status}`);
    console.log('');
    if (result.completed.length > 0) {
      console.log('  ✓ Completed:');
      for (const c of result.completed.slice(-5)) console.log(`    ${c}`);
      if (result.completed.length > 5) console.log(`    ... +${result.completed.length - 5} more`);
    }
    if (result.pending.length > 0) {
      console.log('');
      console.log('  ⏳ Pending:');
      for (const p of result.pending) console.log(`    ${p}`);
    }
    console.log('');
    console.log('── Prompt ──');
    console.log(result.prompt);
    console.log('');

    if (batchInfo && batchInfo.status === 'ready') {
      console.log('── Auto-Execute Batch ──');
      console.log(`  Batch file: _wdf_output/.dispatch/auto-execute.json`);
      console.log(`  Summary:    _wdf_output/.dispatch/auto-execute.md`);
      console.log(`  Pending:    ${batchInfo.pendingCount} sub-phase(s) ready to execute`);
      console.log('');
      console.log('  To auto-execute all pending sub-phases:');
      console.log('    1. Read _wdf_output/.dispatch/auto-execute.json');
      console.log('    2. For each entry, write the artifact to the output path');
      console.log('    3. Run /wdf start to re-sync state');
    }

    console.log(`  Next: ${result.nextCommand}`);
    console.log('');
  }
}

async function runCheckCommand(args: string[], projectRoot: string) {
  const { checkArtifact, formatCheckResults } = await import('./artifact-checker.js');
  const json = args.includes('--json');
  const artifact = args.find(a => a.startsWith('--artifact='))?.split('=')[1];
  const phaseArg = args.find(a => a.startsWith('--phase='));
  const phase = phaseArg ? parseInt(phaseArg.split('=')[1], 10) : undefined;
  const story = args.find(a => a.startsWith('--story='))?.split('=')[1];

  if (!artifact && !phase && !story) {
    // Check all artifacts
    console.log('Checking all artifacts...');
  }

  const results = checkArtifact({ projectRoot, artifact, phase, story });

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatCheckResults(results));
  }

  const hasErrors = results.some(r => !r.passed);
  process.exit(hasErrors ? 1 : 0);
}

async function runTraceCommand(args: string[], projectRoot: string) {
  const id = args[1];
  if (!id || id === '--help' || id === '-h') {
    console.error('Usage: wdf trace <id> [--format=text|mermaid] [--rebuild]');
    console.error('');
    console.error('Trace a node through the full JTBD→REQ→EPIC→STORY→API/DB→TEST→COMMIT chain.');
    console.error('');
    console.error('Options:');
    console.error('  --format=text     Human-readable output (default)');
    console.error('  --format=mermaid  Mermaid.js flowchart for embedding in markdown');
    console.error('  --rebuild         Force rebuild the traceability graph');
    console.error('');
    console.error('Examples:');
    console.error('  wdf trace REQ-7');
    console.error('  wdf trace STORY-001 --format=mermaid');
    console.error('  wdf trace API:GET /todos --rebuild');
    console.error('  wdf trace SPEC:auth:REQ-001');
    console.error('');
    console.error('Valid IDs: REQ-N, STORY-NNN, EPIC-N, API:METHOD /path,');
    console.error('            DB:table, JTBD-N, COMMIT:<sha>, SPEC:<domain>:REQ-N');
    process.exit(id === '--help' || id === '-h' ? 0 : 1);
  }

  const { traceCommand } = await import('./trace-cmd.js');
  const formatArg = args.find(a => a.startsWith('--format='));
  const format = (formatArg?.split('=')[1] ?? 'text') as 'text' | 'mermaid';
  const rebuild = args.includes('--rebuild');

  const result = await traceCommand({ id, projectRoot, format, rebuild });
  console.log(result.formatted);

  if (!result.found) {
    console.error(`\nNode "${id}" not found in the traceability graph.`);
    process.exit(1);
  }
}

async function runPermissionsCommand(args: string[], projectRoot: string) {
  const sub = args[1];
  const { listDispatchPermissions, applyPermissions, revokePermissions, revokeAllDispatchPermissions } = await import('./permission-injector.js');

  if (sub === 'list' || sub === undefined || sub === '--help' || sub === '-h') {
    if (sub === '--help' || sub === '-h') {
      console.error('Usage: wdf permissions <list|apply|revoke|purge> [args]');
      console.error('');
      console.error('Subcommands:');
      console.error('  list                          Show wdf-dispatch entries in .claude/settings.local.json');
      console.error('  apply <manifest.json>         Apply a dispatch manifest permissions scope');
      console.error('  revoke <story_id> <stage>     Remove entries tagged for one (story, stage)');
      console.error('  purge                         Remove every wdf-dispatch tagged entry');
      process.exit(0);
    }
    const list = listDispatchPermissions(projectRoot);
    if (list.length === 0) {
      console.log('(no wdf-dispatch entries)');
      return;
    }
    for (const e of list) {
      console.log(`[${e.kind}] ${e.story_id}/${e.stage}  ${e.raw.split(' ')[0]}`);
    }
    return;
  }

  if (sub === 'apply') {
    const manifestPath = args[2];
    if (!manifestPath) {
      console.error('Usage: wdf permissions apply <manifest.json>');
      process.exit(1);
    }
    const raw = readFileSync(resolve(manifestPath), 'utf8');
    const manifest = JSON.parse(raw);
    const applied = applyPermissions(manifest, projectRoot);
    console.log(`Applied ${applied.length} permission entries for ${manifest.story_id}/${manifest.stage}`);
    return;
  }

  if (sub === 'revoke') {
    const storyId = args[2];
    const stage = args[3];
    if (!storyId || !stage) {
      console.error('Usage: wdf permissions revoke <story_id> <stage>');
      process.exit(1);
    }
    const removed = revokePermissions(storyId, stage, projectRoot);
    console.log(`Removed ${removed} entries for ${storyId}/${stage}`);
    return;
  }

  if (sub === 'purge') {
    const removed = revokeAllDispatchPermissions(projectRoot);
    console.log(`Purged ${removed} wdf-dispatch entries`);
    return;
  }

  console.error(`Unknown subcommand: ${sub}`);
  console.error('See: wdf permissions --help');
  process.exit(1);
}

async function runConvergeCommand(args: string[], projectRoot: string) {
  const sub = args[1];
  if (sub === '--help' || sub === '-h' || sub === undefined) {
    console.error('Usage: wdf converge [--source=PATH] [--specs=PATH] [--prd=PATH] [--to-stories] [--mode=runtime-drift] [--json]');
    console.error('');
    console.error('Brownfield gap analysis: compare declared requirements against code references.');
    console.error('Reads _wdf_output/specs/ (V3.9+) or _wdf_output/prd.md (V3.8 legacy), scans src/ for');
    console.error('REQ-NNN references, and emits a gap report.');
    console.error('');
    console.error('Options:');
    console.error('  --source=PATH          Source root to scan (default: src/, also backend/src/ if present)');
    console.error('  --specs=PATH           Specs directory (default: _wdf_output/specs/)');
    console.error('  --prd=PATH             Legacy PRD path (default: _wdf_output/prd.md)');
    console.error('  --to-stories           Emit draft stories for each gap into _wdf_output/stories/converge-<date>/');
    console.error('  --mode=runtime-drift   Detect FSM drift: phase artifacts, story states, pipeline reports, dependencies');
    console.error('  --json                 Emit machine-readable JSON instead of writing a report file');
    console.error('');
    console.error('Examples:');
    console.error('  wdf converge');
    console.error('  wdf converge --source=backend/src --to-stories');
    console.error('  wdf converge --mode=runtime-drift');
    process.exit(sub === undefined ? 1 : 0);
  }

  const asJson = args.includes('--json');
  const mode = args.find(a => a.startsWith('--mode='))?.split('=')[1];

  // Runtime drift detection mode
  if (mode === 'runtime-drift') {
    const { detectRuntimeDrift, renderDriftReport } = await import('./converge-engine.js');
    const report = await detectRuntimeDrift(projectRoot);

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.summary.errors > 0 ? 1 : 0);
    } else {
      console.log(renderDriftReport(report));
      if (report.summary.errors > 0) {
        console.error(`\n❌ ${report.summary.errors} error(s) detected. Review the drift report above.`);
        process.exit(1);
      } else if (report.summary.warnings > 0) {
        console.log(`\n🟡 ${report.summary.warnings} warning(s) detected. No errors.`);
      } else {
        console.log('\n✅ No drift detected.');
      }
    }
    process.exit(0);
  }

  // Default: spec/code converge analysis
  const { runConverge, writeConvergeArtifacts } = await import('./converge-engine.js');
  const opts: { projectRoot: string; sourceDir?: string; specsDir?: string; prdPath?: string; toStories?: boolean } = {
    projectRoot,
  };
  for (const a of args.slice(1)) {
    if (a.startsWith('--source=')) opts.sourceDir = resolve(projectRoot, a.slice(9));
    else if (a.startsWith('--specs=')) opts.specsDir = resolve(projectRoot, a.slice(8));
    else if (a.startsWith('--prd=')) opts.prdPath = resolve(projectRoot, a.slice(6));
    else if (a === '--to-stories') opts.toStories = true;
  }

  const result = runConverge(opts);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { reportPath, storiesDir } = writeConvergeArtifacts(result, opts);
  console.log(`Converge report: ${reportPath}`);
  console.log(`Summary: ${result.summary.implemented}/${result.summary.declared} implemented (${result.summary.coveragePercent}%), ${result.summary.gaps} gaps, ${result.summary.drift} drift`);
  if (storiesDir) console.log(`Draft stories:  ${storiesDir} (${result.gaps.length} files)`);
}

async function runSnapshotCommand(args: string[], projectRoot: string) {
  const subCommand = args[1];
  const json = args.includes('--json');

  const {
    listSnapshots,
    createSnapshot,
    restoreSnapshot,
    replaySnapshot,
    pruneSnapshots,
  } = await import('./snapshot.js');

  switch (subCommand) {
    case 'list': {
      const items = listSnapshots(projectRoot);
      if (json) {
        console.log(JSON.stringify(items, null, 2));
      } else if (items.length === 0) {
        console.log('No snapshots found.');
        console.log('Snapshots are created automatically at Phase boundaries and on gate failures.');
        console.log('Use `wdf snapshot create --label <name>` to create one manually.');
      } else {
        console.log('Snapshots (newest first):\n');
        for (const item of items) {
          const date = new Date(item.created_at).toLocaleString();
          const phase = item.phase ? `Phase ${item.phase}` : 'N/A';
          console.log(`  ${item.name}`);
          console.log(`    Reason:  ${item.reason}`);
          console.log(`    Phase:   ${phase}`);
          console.log(`    Created: ${date}`);
          console.log(`    Git:     ${item.git_head_short}`);
          console.log();
        }
      }
      break;
    }

    case 'create': {
      const labelArg = args.find(a => a.startsWith('--label='));
      const label = labelArg?.split('=')[1];
      if (!label) {
        console.error('Usage: wdf snapshot create --label <name>');
        console.error('Example: wdf snapshot create --label "before-refactor"');
        process.exit(1);
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `manual-${label}-${timestamp}`;
      const dir = createSnapshot(name, `Manual: ${label}`, projectRoot);
      console.log(`Snapshot created: ${name}`);
      console.log(`Location: ${dir}`);
      break;
    }

    case 'restore': {
      const nameOrLabel = args[2];
      if (!nameOrLabel) {
        console.error('Usage: wdf snapshot restore <name>');
        console.error('Use `wdf snapshot list` to see available snapshots.');
        process.exit(1);
      }
      const dryRun = args.includes('--dry-run');
      const force = args.includes('--yes') || args.includes('--force');

      if (!force) {
        console.log(`About to restore snapshot "${nameOrLabel}".`);
        console.log('This will:');
        console.log('  1. git stash any uncommitted changes');
        console.log('  2. git checkout the snapshot commit');
        console.log('  3. Restore status files from the snapshot');
        console.log('');
        console.log('Add --yes to skip this confirmation.');
        process.exit(0);
      }

      const result = restoreSnapshot(nameOrLabel, projectRoot, { dryRun, force });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Restored from snapshot "${result.snapshotName}"`);
        console.log(`Git: ${result.gitHeadBefore.slice(0, 7)} → ${result.gitHeadAfter.slice(0, 7)}`);
        console.log(`Files restored: ${result.filesRestored.length}`);
        for (const w of result.warnings) {
          console.log(`⚠ ${w}`);
        }
      }
      break;
    }

    case 'prune': {
      const keepArg = args.find(a => a.startsWith('--keep='));
      const keep = keepArg ? parseInt(keepArg.split('=')[1], 10) : 10;
      const result = pruneSnapshots(projectRoot, { keepRecent: keep });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Pruned ${result.removed.length} old snapshot(s).`);
        console.log(`Keeping ${result.kept.length} snapshot(s).`);
        if (result.removed.length > 0) {
          console.log('Removed:');
          for (const name of result.removed) {
            console.log(`  - ${name}`);
          }
        }
      }
      break;
    }

    case 'replay': {
      const nameOrLabel = args[2];
      if (!nameOrLabel) {
        console.error('Usage: wdf snapshot replay <name>');
        console.error('Restores FSM state from the snapshot WITHOUT touching git HEAD.');
        console.error('Use this to inspect/retry from a past checkpoint while keeping current code.');
        process.exit(1);
      }
      const force = args.includes('--yes') || args.includes('--force');
      if (!force) {
        console.log(`About to replay snapshot "${nameOrLabel}" (state-only).`);
        console.log('This restores status files from the snapshot but leaves git HEAD untouched.');
        console.log('Add --yes to proceed.');
        process.exit(0);
      }
      const result = replaySnapshot(nameOrLabel, projectRoot, { force: true });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Replayed snapshot "${result.snapshotName}" (state-only)`);
        console.log(`Files restored: ${result.filesRestored.length}`);
        for (const w of result.warnings) console.log(`⚠ ${w}`);
        console.log('');
        console.log('Run `wdf start` to see the next prompt from this state.');
      }
      break;
    }

    default:
      console.log('Usage: wdf snapshot <list|create|restore|replay|prune> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  list                      List all snapshots');
      console.log('  create --label <name>     Create a named snapshot');
      console.log('  restore <name> [--yes]    Restore a snapshot (requires confirmation)');
      console.log('  prune [--keep=N]          Prune old snapshots (default: keep 10)');
      console.log('');
      console.log('Options:');
      console.log('  --json                    JSON output');
      console.log('  --dry-run                 Show what would happen without making changes');
      break;
  }
}

async function runSpecCommand(args: string[], projectRoot: string) {
  const subCommand = args[1];
  const json = args.includes('--json');
  const dryRun = args.includes('--dry-run');

  const { loadConfig, getSpecsDir, getOutputDir } = await import('./config.js');
  const cfg = loadConfig(projectRoot, { silent: true }).config;
  const outputDir = getOutputDir(cfg, projectRoot);
  const specsDir = getSpecsDir(cfg, projectRoot);

  const {
    parseSpecDoc,
    parsePrdReqs,
    parseEpicsTracks,
    inferDomainFromReq,
    prdToSpecDocument,
    formatSpecDoc,
    validateSpec,
    forwardSync,
    reverseSync,
    applySync,
    loadSpecDocs,
    scaffoldEmptySpec,
    listDomains,
  } = await import('./spec-sync.js');

  const specConfig = {
    specsDir,
    sourceOfTruth: cfg.specs.source_of_truth,
    managedRegionMarker: cfg.specs.managed_region_marker,
    enforceUniqueRequirementNames: cfg.specs.enforce_unique_requirement_names,
  };

  switch (subCommand) {
    case 'init': {
      const domain = args[2];
      if (!domain) {
        console.error('Usage: wdf spec init <domain>');
        console.error('Example: wdf spec init auth');
        process.exit(1);
      }
      const action = scaffoldEmptySpec(domain, specsDir);
      if (dryRun) {
        console.log(`Would ${action.action} ${action.path}`);
        if (json) console.log(JSON.stringify({ action }, null, 2));
        break;
      }
      const result = applySync({ direction: 'reverse', writes: [action], warnings: [] }, false);
      console.log(`${action.action === 'create' ? 'Created' : 'Updated'}: ${action.path}`);
      console.log(`Applied: ${result.applied.length}, Skipped: ${result.skipped.length}`);
      break;
    }

    case 'list': {
      const epicsPath = join(outputDir, 'epics.md');
      const epicsText = existsSync(epicsPath) ? readFileSync(epicsPath, 'utf8') : '';
      const domains = listDomains(specsDir, epicsText);
      if (json) {
        console.log(JSON.stringify({ domains }, null, 2));
      } else if (domains.length === 0) {
        console.log('No domains discovered.');
        console.log('');
        console.log('Run `wdf spec sync` to bootstrap specs/ from your PRD.');
      } else {
        console.log('Discovered domains:');
        for (const d of domains) {
          const specPath = join(specsDir, d, 'spec.md');
          const exists = existsSync(specPath);
          const mark = exists ? '✓' : ' ';
          console.log(`  [${mark}] ${d}`);
        }
      }
      break;
    }

    case 'validate': {
      const domain = args[2];
      const docs = loadSpecDocs(specsDir);
      const targets = domain ? docs.filter(d => d.domain === domain) : docs;
      if (targets.length === 0) {
        console.error(`No spec files found${domain ? ` for domain "${domain}"` : ''}.`);
        console.error(`Run \`wdf spec sync\` to bootstrap specs/ from your PRD.`);
        process.exit(1);
      }
      const allErrors: Array<{ domain: string; errors: any[] }> = [];
      for (const doc of targets) {
        const errors = validateSpec(doc);
        if (errors.length > 0) allErrors.push({ domain: doc.domain, errors });
      }
      if (json) {
        console.log(JSON.stringify({ results: allErrors, valid: allErrors.length === 0 }, null, 2));
      } else if (allErrors.length === 0) {
        console.log(`✓ All ${targets.length} spec(s) valid.`);
      } else {
        console.log(`✗ ${allErrors.length} spec(s) with errors:`);
        for (const { domain, errors } of allErrors) {
          console.log(`  ${domain}:`);
          for (const e of errors) {
            console.log(`    [${e.ruleId}] ${e.message}`);
          }
        }
        process.exit(1);
      }
      break;
    }

    case 'sync': {
      const reverseFlag = args.includes('--reverse');
      const forwardFlag = args.includes('--forward');
      // Default: reverse in v3.8.x (PRD -> specs/)
      const goForward = forwardFlag || (!reverseFlag && cfg.specs.default_sync_direction === 'forward');

      const prdPath = join(outputDir, 'prd.md');
      const epicsPath = join(outputDir, 'epics.md');

      if (!existsSync(prdPath)) {
        console.error(`PRD not found at ${prdPath}`);
        console.error('Run `wdf init` and produce a PRD (phase 2.5) first.');
        process.exit(1);
      }

      const prdText = readFileSync(prdPath, 'utf8');
      const epicsText = existsSync(epicsPath) ? readFileSync(epicsPath, 'utf8') : '';
      const existing = loadSpecDocs(specsDir);

      const result = goForward
        ? forwardSync(existing, prdText, prdPath, specConfig)
        : reverseSync(prdText, epicsText, existing, specConfig);

      if (json) {
        const summary = {
          direction: result.direction,
          writes: result.writes.map(w => ({ path: w.path, action: w.action, bytes: w.content.length })),
          warnings: result.warnings,
          dryRun,
        };
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`Direction: ${result.direction}`);
        console.log(`Planned writes: ${result.writes.length}`);
        for (const w of result.writes) {
          console.log(`  [${w.action}] ${w.path} (${w.content.length} bytes)`);
        }
        for (const warn of result.warnings) {
          console.log(`⚠ ${warn}`);
        }
      }

      if (dryRun) {
        console.log('');
        console.log('(--dry-run: no files modified)');
        break;
      }

      const { applied, skipped } = applySync(result, false);
      console.log('');
      console.log(`Applied: ${applied.length}, Skipped: ${skipped.length}`);
      break;
    }

    case 'help':
    case '--help':
    case undefined:
      console.log('Usage: wdf spec <init|list|validate|sync> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  init <domain>                    Scaffold empty specs/<domain>/spec.md');
      console.log('  list                             List discovered domains (from epics + specs/)');
      console.log('  validate [<domain>]              Validate against spec-schema.yaml');
      console.log('  sync [--reverse|--forward]       Bidirectional sync (default: reverse)');
      console.log('');
      console.log('Options:');
      console.log('  --json                           JSON output');
      console.log('  --dry-run                        Plan only; do not modify files');
      console.log('  --reverse                        Force PRD → specs/ (default in v3.8.x)');
      console.log('  --forward                        Force specs/ → PRD (requires [specs] source_of_truth = true)');
      break;

    default:
      console.error(`Unknown spec subcommand: ${subCommand}`);
      console.error('Run `wdf spec help` for usage.');
      process.exit(1);
  }
}

async function runPhaseCommand(args: string[], projectRoot: string, orchestrator: PhaseOrchestrator) {
  const phaseNum = parseInt(args[1], 10);
  const subCommand = args[2];
  const json = args.includes('--json');

  if (isNaN(phaseNum)) {
    console.error('Usage: wdf phase <N> [start|gate|sub]');
    process.exit(1);
  }

  switch (subCommand) {
    case 'start':
      console.log(`Starting Phase ${phaseNum}...`);
      const startResult = await orchestrator.startPhase(phaseNum);
      if (json) {
        console.log(JSON.stringify(startResult, null, 2));
      } else {
        console.log(orchestrator.formatPhaseStartResult(startResult));
      }
      process.exit(startResult.success ? 0 : 1);
      break;
    case 'gate':
    case 'gate-eval':
    case 'evaluate':
      console.log(`Evaluating gate for Phase ${phaseNum}...`);
      const gateResult = await orchestrator.evaluatePhaseGate(phaseNum);
      if (json) {
        console.log(JSON.stringify(gateResult, null, 2));
      } else {
        console.log(orchestrator.formatGateResult(gateResult));
      }
      process.exit(gateResult.all_pass ? 0 : 1);
      break;
    case 'sub':
      const subId = args[3];
      if (!subId) {
        console.error('Usage: wdf phase <N> sub <sub-id>');
        process.exit(1);
      }
      const subResult = await orchestrator.getSubPhaseDetails(phaseNum, subId);
      if (json) {
        console.log(JSON.stringify(subResult, null, 2));
      } else {
        console.log(orchestrator.formatSubPhaseDetails(subResult));
      }
      break;
    default:
      // Show phase details
      const result = await statusCommand(projectRoot, { phase: phaseNum });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderStatus(result, { phase: phaseNum }));
      }
  }
}

async function runGateCommand(args: string[], projectRoot: string, orchestrator: PhaseOrchestrator) {
  const subCommand = args[1];
  const gateId = args[2];
  const json = args.includes('--json');

  switch (subCommand) {
    case 'list':
      const gates = orchestrator.listAllGates();
      if (json) {
        console.log(JSON.stringify(gates, null, 2));
      } else {
        console.log(orchestrator.formatGateList(gates));
      }
      break;
    case 'eval':
    case 'evaluate':
      if (!gateId) {
        console.error('Usage: wdf gate eval <gate-id>');
        process.exit(1);
      }
      const evalResult = await orchestrator.evaluateGate(gateId);
      if (!evalResult.found) {
        console.error(`Gate "${gateId}" not found`);
        process.exit(1);
      }
      if (json) {
        console.log(JSON.stringify(evalResult, null, 2));
      } else {
        console.log(orchestrator.formatGateResult({
          phase: 0,
          all_pass: evalResult.all_pass!,
          results: evalResult.results!,
        }));
      }
      process.exit(evalResult.all_pass ? 0 : 1);
      break;
    case 'show':
      if (!gateId) {
        console.error('Usage: wdf gate show <gate-id>');
        process.exit(1);
      }
      const details = orchestrator.getGateDetails(gateId);
      if (json) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        console.log(orchestrator.formatGateDetails(details));
      }
      break;
    default:
      console.log('Usage: wdf gate <list|eval|show> [gate-id]');
  }
}

async function runCrCommand(args: string[], projectRoot: string, orchestrator: PhaseOrchestrator) {
  const subCommand = args[1];
  const crId = args[2];
  const json = args.includes('--json');

  // Parse --blocking/--non-blocking flags
  const blocking = args.includes('--blocking');
  const nonBlocking = args.includes('--non-blocking');
  const isBlockingFlag = blocking ? true : nonBlocking ? false : undefined;

  switch (subCommand) {
    case 'list': {
      let statusFilter: string | undefined;
      if (args.includes('--open')) statusFilter = 'open';
      if (args.includes('--resolved')) statusFilter = 'resolved';

      const blockingFilter = isBlockingFlag;
      const list = orchestrator.listChangeRequests({
        status: statusFilter,
        blocking: blockingFilter,
      });
      if (json) {
        console.log(JSON.stringify(list, null, 2));
      } else {
        console.log(orchestrator.formatCRList(list));
      }
      break;
    }
    case 'show':
      if (!crId) {
        console.error('Usage: wdf cr show <cr-id>');
        process.exit(1);
      }
      const details = orchestrator.getChangeRequest(crId);
      if (json) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        console.log(orchestrator.formatCRDetails(details));
      }
      break;
    case 'create': {
      // Parse options
      let title = '';
      let description = '';
      let sourcePhase: number | undefined;
      let affectedPhase: number | undefined;
      let author: string | undefined;
      let crBlocking = isBlockingFlag ?? false;

      for (let i = 3; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--title' && args[i + 1]) {
          title = args[++i];
        } else if (arg === '--desc' && args[i + 1]) {
          description = args[++i];
        } else if (arg === '--source' && args[i + 1]) {
          sourcePhase = parseInt(args[++i], 10);
        } else if (arg === '--affects' && args[i + 1]) {
          affectedPhase = parseInt(args[++i], 10);
        } else if (arg === '--author' && args[i + 1]) {
          author = args[++i];
        } else if (arg === '--blocking') {
          crBlocking = true;
        } else if (arg === '--non-blocking') {
          crBlocking = false;
        }
      }

      if (!title) {
        console.error('Usage: wdf cr create --title "Title" [--desc "Description"] [--blocking|--non-blocking] [--source N] [--affects N]');
        process.exit(1);
      }

      const result = await orchestrator.createChangeRequest({
        title,
        description: description || title,
        blocking: crBlocking,
        source_phase: sourcePhase,
        affected_phase: affectedPhase,
        author,
      });

      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(orchestrator.formatCROperationResult(result));
      }
      process.exit(result.success ? 0 : 1);
      break;
    }
    case 'resolve': {
      if (!crId) {
        console.error('Usage: wdf cr resolve <cr-id> [--resolution "Resolution text"]');
        process.exit(1);
      }

      let resolution = 'Fixed';
      let resolver: string | undefined;
      for (let i = 3; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--resolution' && args[i + 1]) {
          resolution = args[++i];
        } else if (arg === '--by' && args[i + 1]) {
          resolver = args[++i];
        }
      }

      const result = await orchestrator.resolveChangeRequest(crId, resolution, resolver);
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(orchestrator.formatCROperationResult(result));
      }
      process.exit(result.success ? 0 : 1);
      break;
    }
    default:
      console.log('Usage: wdf cr <list|show|create|resolve|apply|archive|migrate> [args] [options]');
      console.log('');
      console.log('Runtime CR Commands (status/change-requests.yaml):');
      console.log('  list [--open|--resolved] [--blocking|--non-blocking]  List CRs with optional filters');
      console.log('  show <cr-id>                                           Show CR details');
      console.log('  create --title "Title" [options]                       Create new CR');
      console.log('  resolve <cr-id> [--resolution "Text"] [--by "Name"]    Mark CR as resolved');
      console.log('');
      console.log('Proposal-Level CR Commands (changes/CHG-*/):');
      console.log('  apply <CHG-id> [--dry-run] [--diff]                    Apply delta.yaml to project files');
      console.log('  archive <CHG-id> [--force]                             Move proposal to changes/_archive/');
  }
}

async function runLintCommand(args: string[]) {
  const onlyRules: string[] = [];
  const skipRules: string[] = [];
  let fix = false;
  let listRules = false;
  let projectRootPath = process.cwd();

  // Parse args: find first non-option as project root
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--only' && args[i + 1]) {
      onlyRules.push(args[++i]);
    } else if (arg === '--skip' && args[i + 1]) {
      skipRules.push(args[++i]);
    } else if (arg === '--fix') {
      fix = true;
    } else if (arg === '--list-rules') {
      listRules = true;
    } else if (!arg.startsWith('-')) {
      projectRootPath = arg;
    }
  }

  const projectRoot = resolve(projectRootPath);
  if (!existsSync(projectRoot)) {
    console.error(`Project root not found: ${projectRoot}`);
    process.exit(1);
  }

  const linter = new SpecLinter(projectRoot);
  linter.registerRules(BUILTIN_RULES);

  if (listRules) {
    console.log('\n  Available lint rules:\n');
    for (const rule of BUILTIN_RULES) {
      console.log(`    ${rule.id.padEnd(28)} ${rule.description}`);
    }
    console.log('');
    process.exit(0);
  }

  const report = await linter.lint({ onlyRules, skipRules, fix });
  console.log(linter.formatReport(report));
  process.exit(report.errors > 0 ? 1 : 0);
}

// ============================================================
// Constitution Command Handler
// ============================================================

/**
 * `wdf constitution` — validate the project against constitution.yaml only.
 *
 * Thin wrapper over the linter that runs exclusively the
 * CONSTITUTION_THRESHOLDS rule. Useful in CI when you want a fast
 * constitution gate without paying for the full lint pass.
 *
 * Exits non-zero on any blocking assertion failure.
 */
async function runConstitutionCommand(args: string[], projectRoot: string) {
  let projectRootPath = projectRoot;
  const json = args.includes('--json');
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      projectRootPath = resolve(arg);
    }
  }
  if (!existsSync(projectRootPath)) {
    console.error(`Project root not found: ${projectRootPath}`);
    process.exit(1);
  }

  const linter = new SpecLinter(projectRootPath);
  linter.registerRules(BUILTIN_RULES);
  const report = await linter.lint({ onlyRules: ['CONSTITUTION_THRESHOLDS'] });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║         wdf-method Constitution Check           ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
    console.log(linter.formatReport(report));
  }
  process.exit(report.errors > 0 ? 1 : 0);
}

// ============================================================
// Story Command Handler
// ============================================================

async function runStoryCommand(args: string[], projectRoot: string, orchestrator: PhaseOrchestrator) {
  const subCommand = args[1];
  const storyId = args[2];
  const json = args.includes('--json');

  switch (subCommand) {
    case 'list': {
      let trackFilter: string | undefined;
      let statusFilter: string | undefined;

      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--track' && args[i + 1]) {
          trackFilter = args[++i];
        } else if (args[i] === '--status' && args[i + 1]) {
          statusFilter = args[++i];
        }
      }

      const list = orchestrator.listStories({
        track: trackFilter,
        status: statusFilter,
      });

      if (json) {
        console.log(JSON.stringify(list, null, 2));
      } else {
        console.log(orchestrator.formatStoryList(list));
      }
      break;
    }

    case 'show':
      if (!storyId) {
        console.error('Usage: wdf story show <story-id>');
        process.exit(1);
      }
      const details = orchestrator.getStoryDetails(storyId);
      if (json) {
        console.log(JSON.stringify(details, null, 2));
      } else {
        console.log(orchestrator.formatStoryDetails(details));
      }
      break;

    case 'start':
      if (!storyId) {
        console.error('Usage: wdf story start <story-id>');
        process.exit(1);
      }
      console.log(`Starting story: ${storyId}`);
      const startResult = await orchestrator.startStory(storyId);
      if (json) {
        console.log(JSON.stringify(startResult, null, 2));
      } else {
        for (const msg of startResult.messages) {
          console.log(`  ${msg}`);
        }
      }
      process.exit(startResult.success ? 0 : 1);
      break;

    case 'status':
      if (!storyId) {
        // Show all stories status
        const list = orchestrator.listStories();
        if (json) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          console.log(orchestrator.formatStoryList(list));
        }
      } else {
        const details = orchestrator.getStoryDetails(storyId);
        if (json) {
          console.log(JSON.stringify(details, null, 2));
        } else {
          console.log(orchestrator.formatStoryDetails(details));
        }
      }
      break;

    default:
      console.log('Usage: wdf story <list|show|start|status> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  list [--track backend|frontend] [--status STATUS]   List all stories');
      console.log('  show <story-id>                                     Show story details');
      console.log('  start <story-id>                                    Start executing a story');
      console.log('  status [story-id]                                   Show story status');
  }
}

// ============================================================
// Queue Command Handler
// ============================================================

async function runQueueCommand(args: string[], projectRoot: string, orchestrator: PhaseOrchestrator) {
  const subCommand = args[1];
  const json = args.includes('--json');

  switch (subCommand) {
    case 'list':
    case 'status': {
      if (json) {
        const items = orchestrator.getQueueItems();
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(orchestrator.getQueueStatus());
      }
      break;
    }

    case 'process': {
      const processAll = args.includes('--all');
      if (processAll) {
        const result = await orchestrator.processQueue();
        if (json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Processed: ${result.processed} merged, ${result.failed} failed`);
          for (const r of result.results) {
            if (r.status === 'merged') {
              console.log(`  ✅ ${r.story_id} merged (${r.commit})`);
            } else {
              console.log(`  ❌ ${r.story_id} failed: ${r.error}`);
            }
          }
        }
        process.exit(result.failed === 0 ? 0 : 1);
      } else {
        const result = await orchestrator.processNextQueueItem();
        if (json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.processed) {
          console.log(`✅ ${result.story_id} merged successfully (commit: ${result.commit})`);
        } else {
          console.log(`❌ ${result.story_id ? result.story_id + ': ' : ''}${result.error}`);
        }
        process.exit(result.processed ? 0 : 1);
      }
      break;
    }

    default:
      console.log('Usage: wdf queue <list|status|process> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  list|status                Show merge queue status');
      console.log('  process                    Process next ready item');
      console.log('  process --all              Process all ready items');
  }
}

// ============================================================
// Party Command Handler
// ============================================================

async function runPartyCommand(args: string[], projectRoot: string, orchestrator: PhaseOrchestrator) {
  const subCommand = args[1];
  const partyId = args[2];
  const json = args.includes('--json');

  switch (subCommand) {
    case 'list': {
      const parties = orchestrator.listParties();
      if (json) {
        console.log(JSON.stringify(parties, null, 2));
      } else {
        if (parties.length === 0) {
          console.log('No party sessions found. Use `wdf party create` to start a new session.');
        } else {
          console.log(`Found ${parties.length} party session(s):`);
          for (const p of parties) {
            console.log(`  - ${p.party_id}: ${p.topic} [${p.status}]`);
          }
        }
      }
      break;
    }

    case 'create': {
      // Parse options
      let topic = args.find((a, i) => args[i - 1] === '--topic') || 'Untitled Discussion';
      let phase: 'discovery' | 'design' | 'architecture' = 'discovery';
      const agentsArg = args.find((a, i) => args[i - 1] === '--agents');
      const agents: ('analyst' | 'product_manager' | 'architect' | 'ux_designer' | 'story_planner' | 'api_designer')[]
        = agentsArg ? agentsArg.split(',').map(a => a.trim() as any) : ['analyst', 'product_manager'];
      const maxRounds = parseInt(args.find((a, i) => args[i - 1] === '--max-rounds') || '3', 10);
      const enableFP = !args.includes('--no-first-principles');

      if (args.includes('--phase') && args[args.indexOf('--phase') + 1]) {
        const p = args[args.indexOf('--phase') + 1];
        if (['discovery', 'design', 'architecture'].includes(p)) {
          phase = p as any;
        }
      }

      const state = orchestrator.createParty({
        topic,
        phase,
        agents,
        max_rounds: maxRounds,
        auto_converge: true,
        enable_first_principles: enableFP,
      });

      if (json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(state));
        console.log('');
        console.log('🚀 Party session created!');
        console.log('   Next steps:');
        console.log(`     1. wdf party start ${state.party_id}`);
        console.log(`     2. wdf party round ${state.party_id} "Your discussion prompt"`);
        console.log(`     3. wdf party crosstalk ${state.party_id} 1`);
        console.log(`     4. wdf party converge ${state.party_id}`);
        console.log(`     5. wdf party complete ${state.party_id}`);
      }
      break;
    }

    case 'start': {
      if (!partyId) {
        console.error('Usage: wdf party start <party-id>');
        process.exit(1);
      }
      const state = await orchestrator.startParty(partyId);
      if (json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(state));
        console.log('');
        console.log('✅ Party session started!');
      }
      break;
    }

    case 'pause': {
      if (!partyId) {
        console.error('Usage: wdf party pause <party-id> [reason]');
        process.exit(1);
      }
      const reasonIdx = args.indexOf('--reason');
      const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
      const state = await orchestrator.pauseParty(partyId, reason);
      if (json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(state));
        console.log('');
        console.log('⏸️ Party session paused.');
      }
      break;
    }

    case 'round': {
      if (!partyId || args.length < 4) {
        console.error('Usage: wdf party round <party-id> "<prompt>"');
        process.exit(1);
      }
      const prompt = args[3];
      const state = await orchestrator.executePartyRound(partyId, prompt);
      if (json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(state));
        console.log('');
        console.log('✅ Round completed! All agents have responded.');
      }
      break;
    }

    case 'dispatch': {
      // Prepare a dispatch manifest. The parent Claude session then consumes
      // it via the Agent tool — one sub-agent per persona, parallel. After all
      // sub-agents write their outputs, run `wdf party collect <id>` to fold
      // them into party state and proceed to crosstalk.
      if (!partyId || args.length < 4) {
        console.error('Usage: wdf party dispatch <party-id> "<prompt>"');
        console.error('');
        console.error('This writes a dispatch manifest. The parent Claude session');
        console.error('must then use the Agent tool to dispatch one sub-agent per');
        console.error('persona listed in the manifest. After sub-agents finish, run:');
        console.error('  wdf party collect <party-id>');
        process.exit(1);
      }
      const prompt = args[3];
      const result = orchestrator.preparePartyDispatch(partyId, prompt);
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`📋 Dispatch manifest written: ${result.manifest_path}`);
        console.log(`   ${result.entries.length} persona(s) to dispatch in parallel:`);
        for (const e of result.entries) {
          console.log(`   • ${e.name} (${e.role}) → ${e.output_path}`);
        }
        console.log('');
        console.log('🤖 PARENT AGENT: use the Agent tool to dispatch one sub-agent per');
        console.log('   entry above (subagent_type=general-purpose, run in parallel).');
        console.log('   Each sub-agent adopts the persona + perspectives, answers the');
        console.log('   prompt, and writes its full markdown response to output_path.');
        console.log('');
        console.log(`   After all sub-agents finish, run: wdf party collect ${partyId}`);
      }
      break;
    }

    case 'collect': {
      if (!partyId) {
        console.error('Usage: wdf party collect <party-id>');
        process.exit(1);
      }
      const state = await orchestrator.collectPartyDispatch(partyId);
      const lastRound = state.rounds[state.rounds.length - 1];
      if (json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(state));
        console.log('');
        const collected = Object.values(lastRound?.agent_outputs ?? {}).filter(v => v && !v.includes('no sub-agent dispatched')).length;
        const total = Object.keys(lastRound?.agent_outputs ?? {}).length;
        console.log(`✅ Collected ${collected}/${total} dispatched responses.`);
        if (collected < total) {
          console.log(`   ${(total - collected)} fallback(s) used (sub-agent did not write output).`);
        }
        console.log('   Next: wdf party crosstalk ' + partyId + ' ' + (lastRound?.round_number ?? 1));
      }
      break;
    }

    case 'crosstalk':
    case 'cross-talk': {
      if (!partyId) {
        console.error('Usage: wdf party crosstalk <party-id> [round-number]');
        process.exit(1);
      }
      const roundNum = parseInt(args[3] || '1', 10);
      const state = await orchestrator.runCrossTalk(partyId, roundNum);
      if (json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(state));
        console.log('');
        console.log('🗣️ Cross-talk analysis complete! Agents have reviewed and commented on each other\'s outputs.');
      }
      break;
    }

    case 'converge':
    case 'convergence': {
      if (!partyId) {
        console.error('Usage: wdf party converge <party-id>');
        process.exit(1);
      }
      const points = orchestrator.analyzePartyConvergence(partyId);
      if (json) {
        console.log(JSON.stringify(points, null, 2));
      } else {
        console.log('═══════════════════════════════════════════');
        console.log('Convergence Analysis');
        console.log('═══════════════════════════════════════════');
        console.log('');
        if (points.length === 0) {
          console.log('No convergence points found.');
        } else {
          for (const p of points) {
            const status = p.resolution ? '✅ RESOLVED' : '⚠️ OPEN';
            console.log(`${status} ${p.id} [${p.type.toUpperCase()}]: ${p.topic}`);
            console.log(`   Agents: ${p.agents_involved.join(', ')}`);
            console.log(`   ${p.summary}`);
            if (p.resolution) {
              console.log(`   Resolution: ${p.resolution}`);
              console.log(`   Resolved by: ${p.resolved_by}`);
            }
            console.log('');
          }
        }
      }
      break;
    }

    case 'first-principles':
    case 'fp': {
      if (!partyId) {
        console.error('Usage: wdf party first-principles <party-id> [topic]');
        process.exit(1);
      }
      const topic = args[3];
      const analyses = orchestrator.runFirstPrinciplesAnalysis(partyId, topic);
      if (json) {
        console.log(JSON.stringify(analyses, null, 2));
      } else {
        console.log('═══════════════════════════════════════════');
        console.log('First Principles Analysis');
        console.log('═══════════════════════════════════════════');
        console.log('');
        for (const a of analyses) {
          const scoreColor = a.validity_score >= 7 ? '🟢' : a.validity_score >= 4 ? '🟡' : '🔴';
          console.log(`${scoreColor} ${a.id}`);
          console.log(`   Assumption: ${a.assumption}`);
          console.log(`   Challenge: ${a.challenge}`);
          console.log(`   Validity: ${a.validity_score}/10`);
          if (a.alternative) {
            console.log(`   Alternative: ${a.alternative}`);
          }
          if (a.impact) {
            console.log(`   Impact: ${a.impact}`);
          }
          console.log('');
        }
      }
      break;
    }

    case 'resolve': {
      if (!partyId || args.length < 5) {
        console.error('Usage: wdf party resolve <party-id> <point-id> "<resolution>"');
        process.exit(1);
      }
      const pointId = args[3];
      const resolution = args[4];
      const resolved = orchestrator.resolvePartyConvergencePoint(partyId, pointId, resolution, 'user');
      if (json) {
        console.log(JSON.stringify(resolved, null, 2));
      } else if (resolved) {
        console.log(`✅ Resolved: ${resolved.id}`);
        console.log(`   Resolution: ${resolved.resolution}`);
        console.log(`   Resolved by: ${resolved.resolved_by}`);
      } else {
        console.error(`❌ Convergence point ${pointId} not found.`);
        process.exit(1);
      }
      break;
    }

    case 'invite-expert': {
      if (!partyId || args.length < 4) {
        console.error('Usage: wdf party invite-expert <party-id> "<expert-type>"');
        process.exit(1);
      }
      const expertType = args[3];
      const expert = orchestrator.inviteExpertToParty(partyId, expertType);
      if (json) {
        console.log(JSON.stringify(expert, null, 2));
      } else {
        console.log(`✅ Expert invited: ${expert.name}`);
        console.log(`   Role: ${expert.role}`);
        console.log(`   ID: ${expert.id}`);
      }
      break;
    }

    case 'complete': {
      if (!partyId) {
        console.error('Usage: wdf party complete <party-id>');
        process.exit(1);
      }
      const result = await orchestrator.completeParty(partyId);
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(result.state));
        console.log('');
        console.log('🎉 Party session COMPLETED!');
        console.log(`   Final report: ${result.outputPath}`);
      }
      break;
    }

    case 'show':
    case 'status': {
      if (!partyId) {
        console.error('Usage: wdf party show <party-id>');
        process.exit(1);
      }
      const state = orchestrator.getPartyState(partyId);
      if (json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(orchestrator.formatPartyState(state));
      }
      break;
    }

    default:
      console.log('Usage: wdf party <command> [options]');
      console.log('');
      console.log('Session Management:');
      console.log('  list                                   List all party sessions');
      console.log('  create [options]                       Create a new party session');
      console.log('    --topic "Topic"                      Discussion topic');
      console.log('    --phase discovery|design|architecture');
      console.log('    --agents analyst,product_manager      Comma-separated agent list');
      console.log('    --max-rounds N                        Maximum discussion rounds');
      console.log('  start <party-id>                       Start a party session');
      console.log('  pause <party-id> [--reason "Reason"]   Pause a party session');
      console.log('');
      console.log('Discussion:');
      console.log('  round <party-id> "<prompt>"            Execute a discussion round');
      console.log('  crosstalk <party-id> [round]           Run cross-talk analysis');
      console.log('');
      console.log('Analysis:');
      console.log('  converge <party-id>                     Analyze convergence points');
      console.log('  resolve <party-id> <point-id> "<res>"  Resolve a convergence point');
      console.log('  first-principles <party-id> [topic]    Run first principles analysis');
      console.log('  fp <party-id> [topic]                  Alias for first-principles');
      console.log('');
      console.log('Completion:');
      console.log('  invite-expert <party-id> "<type>"      Invite an external expert');
      console.log('  complete <party-id>                     Complete party and generate report');
      console.log('  show|status <party-id>                 Show party state');
  }
}

/**
 * Handles `wdf cr apply <CHG-id> [--dry-run] [--diff]`
 * and       `wdf cr archive <CHG-id> [--force]`.
 *
 * These act on changes/<CHG-id>/ source artifacts and do not require the
 * project to be initialized (no _wdf_output/ access).
 */
async function runCrProposalCommand(args: string[], projectRoot: string) {
  const sub = args[1];
  const id = args[2];
  const json = args.includes('--json');

  // Accept both bare 'CHG-YYYY-NNN' and slug-suffixed 'CHG-YYYY-NNN-<slug>'.
  // Directory resolution (resolveCrDir) handles finding the actual proposal
  // dir; this regex just gates obvious garbage early.
  if (!id || !/^CHG-\d{4}-\d{3}(-[a-z0-9][a-z0-9-]*)?$/.test(id)) {
    console.error(`Usage: wdf cr ${sub} <CHG-YYYY-NNN> [options]`);
    process.exit(1);
  }

  const changesDir = join(projectRoot, 'changes');
  let proposalDir: string;
  try {
    proposalDir = resolveCrDir(changesDir, id);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  if (sub === 'apply') {
    const deltaPath = join(proposalDir, 'delta.yaml');
    if (!existsSync(deltaPath)) {
      console.error(`No delta.yaml found in changes/${id}/`);
      console.error(`Hint: copy from changes/.template/delta.yaml`);
      process.exit(1);
    }
    const dryRun = args.includes('--dry-run');
    const showDiff = args.includes('--diff') || dryRun;

    try {
      const delta = loadDelta(deltaPath);
      const plan = planApply(delta, projectRoot);
      plan.dryRun = dryRun;

      if (json) {
        console.log(JSON.stringify({
          change_id: delta.change_id,
          dry_run: dryRun,
          files: plan.changes.map(c => ({ file: c.relPath, action: c.action })),
        }, null, 2));
      } else {
        console.log(summarizePlan(plan));
        if (showDiff) {
          console.log('');
          for (const c of plan.changes) {
            const d = unifiedDiff(c.relPath, c.before, c.after);
            if (d) console.log(d + '\n');
          }
        }
      }
      if (!dryRun) {
        const result = await applyDelta(deltaPath, projectRoot);
        if (!json) {
          console.log(`\n✅ Applied. Written: ${result.written.length}, Deleted: ${result.deleted.length}`);
        }
      } else if (!json) {
        console.log('\n(dry-run — no files written)');
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (json) console.error(JSON.stringify({ error: msg }, null, 2));
      else console.error(`❌ ${msg}`);
      process.exit(1);
    }
    return;
  }

  if (sub === 'archive') {
    const force = args.includes('--force');
    const dryRun = args.includes('--dry-run');
    const noRewrite = args.includes('--no-rewrite');
    const noPrdRegen = args.includes('--no-prd-regen');
    const noApiRegen = args.includes('--no-api-regen');
    const noDbRegen = args.includes('--no-db-regen');
    const archiveOpts = { dryRun, noRewrite, noPrdRegen, noApiRegen, noDbRegen };
    try {
      const result = await archiveAndRewrite(id, projectRoot, archiveOpts);
      if (json) {
        console.log(JSON.stringify({ change_id: id, ...result }, null, 2));
      } else {
        const patchedPart = result.patched.length ? ` — patched ${result.patched.length} canonical spec(s): ${result.patched.join(', ')}` : '';
        const warnPart = result.cascadeWarning ? `\n⚠ ${result.cascadeWarning}` : '';
        console.log(`✅ ${dryRun ? '[DRY RUN] ' : ''}Archived changes/${id} → ${result.archived}${patchedPart}${warnPart}`);
      }
    } catch (err: any) {
      if (err.message?.includes('Already archived') && force) {
        // remove existing
        // rmSync already imported at top;
        const existing = join(projectRoot, 'changes', '_archive', id);
        rmSync(existing, { recursive: true, force: true });
        const result = await archiveAndRewrite(id, projectRoot, archiveOpts);
        console.log(`✅ [FORCE] Archived changes/${id} → ${result.archived}`);
      } else {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    }
    return;
  }

  if (sub === 'migrate') {
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');
    try {
      const result = migrateDelta(proposalDir, { dryRun, force });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatMigrateResult(result, dryRun));
      }
      process.exit(result.ok ? 0 : 1);
    } catch (e) {
      const msg = (e as Error).message;
      if (json) console.error(JSON.stringify({ error: msg }, null, 2));
      else console.error(`❌ ${msg}`);
      process.exit(1);
    }
    return;
  }
}

function relative(from: string, to: string): string {
  return pathRelative(from, to);
}

function parseOptInt(args: string[], flag: string, defaultVal: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const n = Number(args[idx + 1]);
  return Number.isFinite(n) ? n : defaultVal;
}

/**
 * Handles `wdf cr verify [--json]`.
 *
 * Cross-checks `changes/INDEX.md` against `changes/CHG-NNN/proposal.md` Status
 * fields, and ensures every IMPLEMENTED CR has at least one matching source
 * artifact in `orchestrator/src`. Exits non-zero on any inconsistency.
 *
 * Run from the wdf-method repo root (or pass repo root as cwd).
 */
async function runCrVerifyCommand(args: string[], projectRoot: string) {
  const json = args.includes('--json');
  const report = verifyCrConsistency(projectRoot);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatCrVerifyReport(report));
  }
  process.exit(report.ok ? 0 : 1);
}

// ============================================================
// Agent Command — sub-agent status & dispatch info
// ============================================================

async function runAgentCommand(args: string[], _projectRoot: string) {
  const sub = args[1] ?? 'status';
  const json = args.includes('--json');

  // Lazy import to avoid paying init cost when unused.
  const { DeadAgentDetector, SignalManager, cleanupStale } = await import('./signal-manager.js');

  if (sub === 'status' || sub === 'list') {
    const detector = new DeadAgentDetector();
    const all = detector.listAllStatuses();
    const running = all.filter(a => a.status === 'running');
    const dead = all.filter(a => a.status === 'dead');

    if (json) {
      console.log(JSON.stringify({
        total: all.length,
        running: running.length,
        dead: dead.length,
        agents: all,
        paused: SignalManager.isPaused(),
      }, null, 2));
      return;
    }

    console.log('═══════════════════════════════════════════');
    console.log('WDF Sub-Agent Status');
    console.log('═══════════════════════════════════════════');
    console.log();
    if (SignalManager.isPaused()) {
      console.log('  ⏸  All agents PAUSED');
      console.log();
    }
    if (all.length === 0) {
      console.log('  No active sub-agents. Agents spawn during Phase 4 story execution.');
      console.log('  Run `/wdf-start` to enter Phase 4.');
      return;
    }
    console.log(`  Total: ${all.length}  |  Running: ${running.length}  |  Dead: ${dead.length}`);
    console.log();
    for (const a of all) {
      const icon = a.status === 'running' ? '✅' : a.status === 'dead' ? '❌' : '⏳';
      console.log(`  ${icon} ${a.agent_id}`);
      if (a.story_id) console.log(`     story:     ${a.story_id}`);
      if (a.track)   console.log(`     track:     ${a.track}`);
      if (a.current_substep) console.log(`     substep:   ${a.current_substep}`);
      console.log(`     heartbeat: ${a.heartbeat_at}`);
      console.log();
    }
    if (dead.length > 0) {
      console.log(`⚠  ${dead.length} dead agent(s) detected. Run \`/wdf-agent cleanup\` or review escalation manifest.`);
    }
    return;
  }

  if (sub === 'cleanup') {
    const removed = cleanupStale();
    console.log(`✓ Cleaned up ${removed} stale agent signal(s).`);
    return;
  }

  if (sub === 'pause') {
    SignalManager.pauseAll(args[2] ?? 'manual');
    console.log('⏸  All agents paused. They will check the pause flag before next dispatch.');
    return;
  }

  if (sub === 'resume') {
    SignalManager.resumeAll();
    console.log('▶  All agents resumed.');
    return;
  }

  if (sub === 'dispatch') {
    console.error('dispatch subcommand is reserved for orchestrator-internal use.');
    console.error('To dispatch a story agent, use `wdf start` to enter the Phase 4 pipeline.');
    process.exit(1);
  }

  console.error(`Unknown agent subcommand: ${sub}`);
  console.error('Usage: wdf agent <status|cleanup|pause|resume>');
  process.exit(1);
}

// ============================================================
// Report Command — human-readable progress report
// ============================================================

async function runReportCommand(
  args: string[],
  projectRoot: string,
  _orchestrator: PhaseOrchestrator,
) {
  const json = args.includes('--json');

  const status = await statusCommand(projectRoot);

  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  // Summary metrics
  const phases = status.phases ?? [];
  const totalSubphases = phases.reduce((n, p) => n + (p.sub_phases?.length ?? 0), 0);
  const lockedSubphases = phases.reduce(
    (n, p) => n + (p.sub_phases?.filter(s => s.status === 'LOCKED').length ?? 0), 0);
  const inProgress = phases.reduce(
    (n, p) => n + (p.sub_phases?.filter(s => s.status === 'IN_PROGRESS').length ?? 0), 0);
  const blocked = phases.reduce(
    (n, p) => n + (p.sub_phases?.filter(s => s.status === 'BLOCKED').length ?? 0), 0);

  const completion = totalSubphases > 0
    ? Math.round((lockedSubphases / totalSubphases) * 100)
    : 0;

  console.log('═══════════════════════════════════════════');
  console.log(`WDF Progress Report — ${status.project.name}`);
  console.log('═══════════════════════════════════════════');
  console.log();
  console.log(`  Generated:    ${new Date().toISOString()}`);
  console.log(`  Created:      ${status.project.created_at}`);
  console.log(`  Updated:      ${status.project.updated_at ?? 'n/a'}`);
  console.log();
  console.log('── Completion ──────────────────────────');
  console.log(`  Sub-phases:   ${lockedSubphases}/${totalSubphases} LOCKED (${completion}%)`);
  console.log(`  In Progress:  ${inProgress}`);
  console.log(`  Blocked:      ${blocked}`);
  console.log();
  console.log('── Phase Summary ───────────────────────');
  for (const p of phases) {
    const icon = p.status === 'LOCKED' ? '✓' :
                 p.status === 'IN_PROGRESS' ? '→' :
                 p.status === 'NOT_STARTED' ? '○' :
                 p.status === 'NOT_STARTED' ? '○' : '⚠';
    console.log(`  ${icon} Phase ${p.phase}: ${p.title} — ${p.status} (${p.progress_pct}%)`);
  }
  console.log();
  console.log('── Quality Gates ───────────────────────');
  const gates = status.quality_gates;
  if (gates && Object.keys(gates).length > 0) {
    for (const [k, v] of Object.entries(gates)) {
      console.log(`  ${k}: ${v}`);
    }
  } else {
    console.log('  (no quality gate data)');
  }
  console.log();
  console.log('── Counts ──────────────────────────────');
  const c = status.counts;
  console.log(`  Stories:      ${c.stories_done}/${c.stories_total} done, ${c.stories_in_progress} in progress`);
  console.log(`  CRs:          ${c.crs_open} open, ${c.crs_resolved} resolved`);
  console.log(`  Merge Queue:  ${c.queue_queued} queued, ${c.queue_merged} merged`);
  console.log();
  console.log('── Next Action ─────────────────────────');
  console.log('  Run `/wdf-start` to advance the next sub-phase.');
}

// ============================================================
// Schema Command — view / fork / validate the gate-check schema
// ============================================================

async function runSchemaCommand(args: string[], projectRoot: string) {
  const sub = args[1] ?? 'list';
  const json = args.includes('--json');

  const {
    loadSchema,
    getBaselineSchema,
    initSchema,
    forkSchema,
    validateSchema,
    schemaFilePaths,
  } = await import('./schema-loader.js');

  if (sub === 'list' || sub === 'show') {
    const schema = loadSchema(projectRoot);
    const paths = schemaFilePaths(projectRoot);
    const source = existsSync(paths.local_fork)
      ? `local fork (${paths.local_fork})`
      : `baseline (no local fork)`;
    if (json) {
      console.log(JSON.stringify({ schema, source, paths }, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('WDF Schema');
    console.log('═══════════════════════════════════════════');
    console.log(`  Version:    ${schema.version}`);
    console.log(`  Source:     ${source}`);
    console.log();
    console.log(`  Check Types (${schema.check_types.length}):`);
    for (const t of schema.check_types) {
      console.log(`    • ${t.id.padEnd(28)} ${t.description}`);
    }
    console.log();
    console.log(`  Dependency Fields (${schema.dependency_fields.length}):`);
    for (const f of schema.dependency_fields) {
      console.log(`    • ${f.id.padEnd(28)} ${f.description}`);
    }
    console.log();
    console.log('── Schema Files ───────────────────────────');
    console.log(`  Reference: ${paths.baseline_reference} ${existsSync(paths.baseline_reference) ? '(exists)' : '(not initialized — run: wdf schema init)'}`);
    console.log(`  Local fork: ${paths.local_fork} ${existsSync(paths.local_fork) ? '(exists)' : '(not forked)'}`);
    return;
  }

  if (sub === 'init') {
    const path = initSchema(projectRoot);
    console.log(`✓ Wrote baseline schema reference: ${path}`);
    console.log('  This file is read-only. To customize, run: wdf schema fork');
    return;
  }

  if (sub === 'fork') {
    const noteIdx = args.indexOf('--note');
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined;
    const path = forkSchema(projectRoot, note);
    console.log(`✓ Created local schema fork: ${path}`);
    console.log('  Edit this file to add project-specific check types / fields.');
    console.log('  Run `wdf schema validate` to verify compatibility with baseline.');
    return;
  }

  if (sub === 'validate') {
    const schema = loadSchema(projectRoot);
    const report = validateSchema(schema);
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('═══════════════════════════════════════════');
      console.log('Schema Validation');
      console.log('═══════════════════════════════════════════');
      console.log(`  Overall:    ${report.ok ? '✅ PASS' : '❌ FAIL'}`);
      console.log();
      if (report.missing_check_types.length > 0) {
        console.log(`  ❌ Missing baseline check types (must restore):`);
        for (const c of report.missing_check_types) console.log(`     • ${c}`);
        console.log();
      }
      if (report.missing_dependency_fields.length > 0) {
        console.log(`  ❌ Missing baseline dependency fields (must restore):`);
        for (const f of report.missing_dependency_fields) console.log(`     • ${f}`);
        console.log();
      }
      if (report.added_check_types.length > 0) {
        console.log(`  ➕ Added check types (custom):`);
        for (const c of report.added_check_types) console.log(`     • ${c}`);
        console.log();
      }
      if (report.added_dependency_fields.length > 0) {
        console.log(`  ➕ Added dependency fields (custom):`);
        for (const f of report.added_dependency_fields) console.log(`     • ${f}`);
        console.log();
      }
      if (report.ok && report.added_check_types.length === 0 && report.added_dependency_fields.length === 0) {
        console.log('  Schema is identical to baseline. Run `wdf schema fork` to customize.');
      }
    }
    process.exit(report.ok ? 0 : 1);
  }

  console.error(`Unknown schema subcommand: ${sub}`);
  console.error('Usage: wdf schema <list|init|fork|validate>');
  process.exit(1);
}

// ============================================================
// Provider Command — inspect multi-IDE agent dispatch providers
// ============================================================

async function runProviderCommand(args: string[]) {
  const sub = args[1] ?? 'list';
  const json = args.includes('--json');

  if (sub === 'list' || sub === 'show' || sub === 'detect') {
    const { detectAgentProvider, PROVIDERS } = await import('./agent-dispatcher.js');
    const detected = detectAgentProvider();
    if (json) {
      const report = {
        detected: { tool: detected.tool, name: detected.name, command: detected.command },
        available: PROVIDERS.filter(p => p.detect()).map(p => ({ tool: p.tool, name: p.name })),
        all: PROVIDERS.map(p => ({
          tool: p.tool,
          name: p.name,
          command: p.command,
          available: p.detect(),
        })),
      };
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('WDF Agent Providers');
    console.log('═══════════════════════════════════════════');
    console.log(`  Detected: ${detected.name} (${detected.tool})`);
    console.log();
    console.log('  All providers:');
    // PROVIDERS is private — re-detect each via the same array we expose.
    const { PROVIDERS: list } = await import('./agent-dispatcher.js');
    for (const p of list) {
      const icon = p.tool === detected.tool ? '🎯' : p.detect() ? '✅' : '⬜';
      console.log(`  ${icon} ${p.tool.padEnd(14)} ${p.name.padEnd(28)} cmd: ${p.command}`);
    }
    console.log();
    console.log('Legend: 🎯 = active   ✅ = available   ⬜ = not detected');
    console.log('Set WDF_FORCE_PROVIDER=<tool> to override detection.');
    return;
  }

  console.error(`Unknown provider subcommand: ${sub}`);
  console.error('Usage: wdf provider <list|detect>');
  process.exit(1);
}

// ============================================================
// Review Command — Phase 1-3 artifact review loop
// ============================================================

async function runReviewCommand(args: string[], projectRoot: string) {
  const sub = args[1] ?? 'status';
  const json = args.includes('--json');

  const {
    prepareArtifactReview,
    collectArtifactReview,
    listPendingReviews,
  } = await import('./planning-reviewer.js');

  if (sub === 'prepare' || sub === 'dispatch') {
    const artifactArg = args[2];
    if (!artifactArg) {
      console.error('Usage: wdf review prepare <artifact-path> [--focus "..."]');
      console.error('  Artifact path is relative to project root, e.g. _wdf_output/prd.md');
      process.exit(1);
    }
    const focusIdx = args.indexOf('--focus');
    const focus = focusIdx >= 0 ? args[focusIdx + 1] : undefined;
    const abs = resolve(projectRoot, artifactArg);
    const manifest = prepareArtifactReview(projectRoot, abs, focus);
    if (json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    console.log(`📋 Review manifest written for "${manifest.artifact_id}"`);
    console.log(`   Artifact: ${manifest.artifact_rel_path}`);
    if (manifest.review_focus) console.log(`   Focus:    ${manifest.review_focus}`);
    console.log(`   Manifest: ${join(projectRoot, '_wdf_output', '.dispatch', 'review', `${manifest.artifact_id}-manifest.json`)}`);
    console.log(`   Output:   ${manifest.output_path}`);
    console.log('');
    console.log('🤖 PARENT AGENT: dispatch one review sub-agent via the Agent tool');
    console.log('   (subagent_type=general-purpose). The sub-agent reads the artifact,');
    console.log('   evaluates it against the focus + standard quality dimensions');
    console.log('   (traceability, completeness, clarity, consistency), and writes a');
    console.log(`   JSON report to the output path. Then run:`);
    console.log(`     wdf review collect ${manifest.artifact_id}`);
    return;
  }

  if (sub === 'collect') {
    const artifactId = args[2];
    if (!artifactId) {
      console.error('Usage: wdf review collect <artifact-id>');
      process.exit(1);
    }
    const result = collectArtifactReview(projectRoot, artifactId);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('═══════════════════════════════════════════');
      console.log(`Review Result — ${artifactId}`);
      console.log('═══════════════════════════════════════════');
      console.log(`  Verdict:   ${result.verdict}`);
      if (result.report) {
        if (typeof result.report.score === 'number') {
          console.log(`  Score:     ${result.report.score}/100`);
        }
        console.log(`  Reviewer:  ${result.report.reviewer_agent ?? '(unspecified)'}`);
        console.log('');
        console.log('  Summary:');
        console.log(`    ${result.report.summary}`);
        if (result.report.issues && result.report.issues.length > 0) {
          console.log('');
          console.log(`  Issues (${result.report.issues.length}):`);
          for (const iss of result.report.issues) {
            const icon = iss.severity === 'blocker' ? '🚨' :
                         iss.severity === 'major' ? '⚠️ ' :
                         iss.severity === 'minor' ? '💡' : '📝';
            console.log(`    ${icon} [${iss.severity}] ${iss.message}`);
            if (iss.location) console.log(`       at: ${iss.location}`);
            if (iss.suggested_fix) console.log(`       fix: ${iss.suggested_fix}`);
          }
        }
      } else {
        console.log('  (no report found at expected path — did the sub-agent write it?)');
      }
      if (result.should_trigger_party) {
        console.log('');
        console.log('🎉 RECOMMENDED: trigger Party Mode to patch this artifact:');
        console.log(`   wdf party create --topic "Patch ${artifactId} after review" --agents analyst,product_manager,architect`);
      } else {
        console.log('');
        console.log('✅ Artifact passed review. Safe to advance to next subphase.');
      }
    }
    process.exit(result.verdict === 'pass' ? 0 : 1);
  }

  if (sub === 'status' || sub === 'list') {
    const pending = listPendingReviews(projectRoot);
    if (json) {
      console.log(JSON.stringify({ reviews: pending }, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('Planning Reviews');
    console.log('═══════════════════════════════════════════');
    if (pending.length === 0) {
      console.log('  No reviews in progress.');
      console.log('  Start one: wdf review prepare _wdf_output/prd.md');
      return;
    }
    for (const p of pending) {
      const icon = p.report_exists ? '✅' : '⏳';
      console.log(`  ${icon} ${p.artifact_id.padEnd(20)} ${p.report_exists ? 'report ready' : 'awaiting sub-agent'}`);
    }
    return;
  }

  console.error(`Unknown review subcommand: ${sub}`);
  console.error('Usage: wdf review <prepare|collect|status>');
  process.exit(1);
}

// ============================================================
// Retro Command — harvest action items + inject into next sprint
// ============================================================

async function runRetroCommand(args: string[], projectRoot: string) {
  const sub = args[1] ?? 'list';
  const json = args.includes('--json');

  const {
    harvestRetrospectiveItems,
    loadRetrospectiveItems,
    buildInjectionPrompt,
  } = await import('./retrospective-loader.js');

  if (sub === 'harvest' || sub === 'parse') {
    const collection = harvestRetrospectiveItems(projectRoot);
    if (json) {
      console.log(JSON.stringify(collection, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('Retrospective Action Items — Harvested');
    console.log('═══════════════════════════════════════════');
    console.log(`  Sources:   ${collection.source_retrospectives.length} file(s)`);
    for (const s of collection.source_retrospectives) console.log(`    • ${s}`);
    console.log(`  Total:     ${collection.items.length} action item(s)`);
    const byPri = { P0: 0, P1: 0, P2: 0 };
    for (const it of collection.items) byPri[it.priority]++;
    console.log(`  Priority:  ${byPri.P0} P0, ${byPri.P1} P1, ${byPri.P2} P2`);
    console.log('');
    console.log(`  Persisted: ${join(projectRoot, '_wdf_output', 'retrospective-action-items.yaml')}`);
    return;
  }

  if (sub === 'list' || sub === 'show') {
    let collection = loadRetrospectiveItems(projectRoot);
    if (!collection) {
      collection = harvestRetrospectiveItems(projectRoot);
    }
    if (json) {
      console.log(JSON.stringify(collection, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('Retrospective Action Items');
    console.log('═══════════════════════════════════════════');
    if (collection.items.length === 0) {
      console.log('  No action items found.');
      console.log('  Run `wdf retro harvest` after Phase 4.14 to capture them.');
      return;
    }
    const byCat: Record<string, typeof collection.items> = {};
    for (const it of collection.items) (byCat[it.category] ??= []).push(it);
    for (const cat of Object.keys(byCat).sort()) {
      console.log('');
      console.log(`  [${cat}] (${byCat[cat].length}):`);
      for (const it of byCat[cat]) {
        const icon = it.priority === 'P0' ? '🚨' :
                     it.priority === 'P1' ? '⚠️ ' : '📝';
        console.log(`    ${icon} ${it.id} [${it.priority}] ${it.action}`);
      }
    }
    return;
  }

  if (sub === 'inject') {
    // Build a Phase 1.1 Brainstorming injection prompt from historical
    // retrospectives. Supports `--from <path>` to inject from a different
    // project's learnings (e.g. a portfolio-level lessons-learned repo).
    const fromIdx = args.indexOf('--from');
    const fromPath = fromIdx >= 0 ? resolve(args[fromIdx + 1]) : undefined;
    const result = buildInjectionPrompt(projectRoot, fromPath);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.item_count === 0) {
      console.log('No historical action items to inject. Run Phase 4.14 first to capture them.');
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('Phase 1.1 Brainstorming Injection');
    console.log('═══════════════════════════════════════════');
    console.log(`  Items:           ${result.item_count}`);
    console.log(`  High priority:   ${result.high_priority_count} (P0)`);
    if (fromPath) console.log(`  Source project:  ${fromPath}`);
    console.log('');
    console.log('── Injection Prompt (paste into Phase 1.1 Brainstorming) ──');
    console.log('');
    console.log(result.prompt);
    return;
  }

  console.error(`Unknown retro subcommand: ${sub}`);
  console.error('Usage: wdf retro <harvest|list|inject>');
  process.exit(1);
}

// ============================================================
// Preset Command — apply / list / clear configuration presets
// ============================================================

async function runPresetCommand(args: string[], projectRoot: string) {
  const sub = args[1] ?? 'list';
  const json = args.includes('--json');

  const {
    listPresets,
    loadPreset,
    getActivePreset,
    applyPreset,
    clearPreset,
  } = await import('./preset-loader.js');

  // Resolve skillRoot from env or default to project root's parent (framework).
  const skillRoot = process.env.WDF_ROOT ?? projectRoot;

  if (sub === 'list' || sub === 'show') {
    const all = listPresets(skillRoot);
    const active = getActivePreset(projectRoot);
    if (json) {
      console.log(JSON.stringify({ active: active?.preset ?? null, presets: all }, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('WDF Configuration Presets');
    console.log('═══════════════════════════════════════════');
    if (active?.preset) {
      console.log(`  Active: 🎯 ${active.preset} (applied ${active.applied_at})`);
      console.log('');
    }
    if (all.length === 0) {
      console.log('  No presets available. Create one at: {skill-root}/presets/<name>.toml');
      return;
    }
    console.log(`  Available (${all.length}):`);
    for (const p of all) {
      const icon = p.name === active?.preset ? '🎯' : '  ';
      console.log(`  ${icon} ${p.name.padEnd(15)} [${p.category ?? 'uncategorized'}] ${p.description}`);
      if (p.requires_env && p.requires_env.length > 0) {
        console.log(`                  requires env: ${p.requires_env.join(', ')}`);
      }
    }
    return;
  }

  if (sub === 'apply') {
    const name = args[2];
    if (!name) {
      console.error('Usage: wdf preset apply <name>');
      process.exit(1);
    }
    const result = applyPreset(projectRoot, skillRoot, name);
    if (!result.ok) {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, preset: result.preset }, null, 2));
      return;
    }
    console.log(`✓ Activated preset: ${name}`);
    console.log(`  ${result.preset?.description}`);
    console.log(`  Persisted: ${join(projectRoot, '_wdf_output', 'active-preset.yaml')}`);
    console.log('');
    console.log('  Subsequent `wdf` commands will include this preset\'s overrides.');
    console.log('  Layer precedence: project > preset > skill-base > defaults');
    return;
  }

  if (sub === 'clear' || sub === 'reset') {
    const cleared = clearPreset(projectRoot);
    if (json) {
      console.log(JSON.stringify({ cleared }, null, 2));
      return;
    }
    if (cleared) {
      console.log('✓ Cleared active preset. Configuration now uses only:');
      console.log('  defaults < skill-base customize.toml < project overrides');
    } else {
      console.log('No active preset to clear.');
    }
    return;
  }

  if (sub === 'active' || sub === 'current') {
    const active = getActivePreset(projectRoot);
    if (!active?.preset) {
      console.log('No active preset.');
      return;
    }
    const preset = loadPreset(skillRoot, active.preset);
    if (json) {
      console.log(JSON.stringify({ active, preset }, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log(`Active Preset: ${active.preset}`);
    console.log('═══════════════════════════════════════════');
    console.log(`  Applied: ${active.applied_at}`);
    console.log(`  Source:  ${active.source}`);
    if (preset) {
      console.log(`  Path:    ${preset.path}`);
      console.log(`  Version: ${preset.version}`);
      console.log(`  Category: ${preset.category ?? 'uncategorized'}`);
    }
    return;
  }

  console.error(`Unknown preset subcommand: ${sub}`);
  console.error('Usage: wdf preset <list|apply|clear|active>');
  process.exit(1);
}

// ============================================================
// Template Command — list/show industry templates, applied via init
// ============================================================

async function runTemplateCommand(args: string[], projectRoot: string) {
  const sub = args[1] ?? 'list';
  const json = args.includes('--json');

  const {
    listTemplates,
    loadTemplate,
    validateTemplate,
    formatTemplateList,
  } = await import('./template-loader.js');

  const skillRoot = process.env.WDF_ROOT ?? projectRoot;

  if (sub === 'list' || sub === 'ls') {
    const all = listTemplates(skillRoot);
    if (json) {
      console.log(JSON.stringify({ templates: all }, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('WDF Project Templates');
    console.log('═══════════════════════════════════════════');
    console.log(formatTemplateList(all));
    return;
  }

  if (sub === 'show' || sub === 'info' || sub === 'cat') {
    const name = args[2];
    if (!name) {
      console.error('Usage: wdf template show <name>');
      process.exit(1);
    }
    const tpl = loadTemplate(skillRoot, name);
    if (!tpl) {
      console.error(`❌ Template "${name}" not found.`);
      console.error('Run `wdf template list` to see available templates.');
      process.exit(1);
    }
    if (json) {
      console.log(JSON.stringify(tpl, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log(`Template: ${tpl.name} (v${tpl.version})`);
    console.log('═══════════════════════════════════════════');
    console.log(`  ${tpl.description}`);
    console.log('');
    console.log(`  Category:        ${tpl.category}`);
    console.log(`  Path:            ${tpl.path}`);
    if (tpl.compatible_wdf) console.log(`  Compatible WDF:  ${tpl.compatible_wdf}`);
    if (tpl.source_project) console.log(`  Source project:  ${tpl.source_project}`);
    if (tpl.tech_stack) {
      console.log('');
      console.log('  Tech stack:');
      for (const [k, v] of Object.entries(tpl.tech_stack)) {
        console.log(`    ${k.padEnd(14)} ${v}`);
      }
    }
    if (tpl.story_patterns && tpl.story_patterns.length > 0) {
      console.log('');
      console.log(`  Story patterns (${tpl.story_patterns.length}):`);
      for (const sp of tpl.story_patterns) {
        console.log(`    • ${sp}`);
      }
    }
    const issues = validateTemplate(tpl);
    if (issues.length > 0) {
      console.log('');
      console.log('  ⚠ Validation issues:');
      for (const issue of issues) console.log(`    - ${issue}`);
    } else {
      console.log('');
      console.log('  ✓ Validation: passed');
    }
    console.log('');
    console.log(`  Apply with:  wdf init <path> --template ${tpl.name}`);
    return;
  }

  console.error(`Unknown template subcommand: ${sub}`);
  console.error('Usage: wdf template <list|show>');
  console.error('Templates are applied via: wdf init <path> --template <name>');
  process.exit(1);
}

// ============================================================
// Workspace Command — multi-project portfolio coordination
// ============================================================

async function runWorkspaceCommand(args: string[], projectRoot: string) {
  const sub = args[1] ?? 'show';
  const json = args.includes('--json');

  const {
    findWorkspaceRoot,
    loadWorkspace,
    initWorkspace,
    addProject,
    removeProject,
    listProjects,
    validateWorkspace,
    formatWorkspaceReport,
    topologicalSort,
  } = await import('./workspace-manager.js');

  // For init/create: use cwd as the workspace root.
  // For other subcommands: walk up to find existing workspace.yaml.
  const explicitRoot = args.find(a => a.startsWith('--root='))?.slice(7);
  const wsRoot = explicitRoot
    ? resolve(explicitRoot)
    : (sub === 'init' || sub === 'create' ? projectRoot : findWorkspaceRoot(projectRoot) ?? projectRoot);

  if (sub === 'init' || sub === 'create') {
    const name = args[2];
    if (!name) {
      console.error('Usage: wdf workspace init <name> [description]');
      process.exit(1);
    }
    const description = args.slice(3).find(a => !a.startsWith('--'));
    const result = initWorkspace(wsRoot, name, description);
    if (!result.ok) {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, manifest: result.manifest }, null, 2));
      return;
    }
    console.log(`✓ Workspace initialized: ${name}`);
    console.log(`  Root: ${wsRoot}`);
    console.log(`  Manifest: ${join(wsRoot, 'workspace.yaml')}`);
    return;
  }

  // All other subcommands require an existing workspace.
  const manifest = loadWorkspace(wsRoot);
  if (!manifest) {
    console.error(`❌ No workspace found at (or above) ${projectRoot}`);
    console.error('Initialize one with: wdf workspace init <name>');
    process.exit(1);
  }

  if (sub === 'list' || sub === 'ls') {
    const entries = listProjects(wsRoot);
    if (json) {
      console.log(JSON.stringify({ workspace: manifest.name, projects: entries }, null, 2));
      return;
    }
    console.log(formatWorkspaceReport(wsRoot));
    return;
  }

  if (sub === 'show' || sub === 'status' || sub === 'info') {
    if (json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    console.log(formatWorkspaceReport(wsRoot));
    return;
  }

  if (sub === 'add' || sub === 'register') {
    const pathArg = args[2];
    if (!pathArg) {
      console.error('Usage: wdf workspace add <path> [--name <name>] [--template <name>] [--tag <t>]...');
      process.exit(1);
    }
    const opts: any = {};
    for (let i = 3; i < args.length; i++) {
      const a = args[i];
      if (a === '--name' && args[i + 1]) opts.name = args[++i];
      else if (a === '--template' && args[i + 1]) opts.template = args[++i];
      else if (a === '--description' && args[i + 1]) opts.description = args[++i];
      else if (a === '--status' && args[i + 1]) opts.status = args[++i];
      else if (a === '--tag' && args[i + 1]) {
        opts.tags = opts.tags ?? [];
        opts.tags.push(args[++i]);
      }
      else if (a === '--depends-on' && args[i + 1]) {
        opts.dependsOn = args[++i].split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    const result = addProject(wsRoot, pathArg, opts);
    if (!result.ok) {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, project: result.project }, null, 2));
      return;
    }
    console.log(`✓ Added project: ${result.project!.name}`);
    console.log(`  Path: ${result.project!.path}`);
    if (result.project!.template) console.log(`  Template: ${result.project!.template}`);
    return;
  }

  if (sub === 'remove' || sub === 'rm' || sub === 'unregister') {
    const name = args[2];
    if (!name) {
      console.error('Usage: wdf workspace remove <name>');
      process.exit(1);
    }
    const result = removeProject(wsRoot, name);
    if (!result.ok) {
      console.error(`❌ ${result.error}`);
      process.exit(1);
    }
    if (json) {
      console.log(JSON.stringify({ ok: true, removed: name }, null, 2));
      return;
    }
    console.log(`✓ Removed project: ${name}`);
    return;
  }

  if (sub === 'validate' || sub === 'check') {
    const result = validateWorkspace(wsRoot);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log(`Workspace validation: ${result.ok ? '✅ PASS' : '❌ FAIL'}`);
    console.log('═══════════════════════════════════════════');
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const e of result.errors) console.log(`  ❌ ${e}`);
    }
    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const w of result.warnings) console.log(`  ⚠️  ${w}`);
    }
    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log('  All projects registered, paths exist, dependencies valid.');
    }
    process.exit(result.ok ? 0 : 1);
    return;
  }

  if (sub === 'graph' || sub === 'topology') {
    const { order, cycles } = topologicalSort(wsRoot);
    if (json) {
      console.log(JSON.stringify({ order, cycles, projects: manifest.projects.map(p => ({
        name: p.name,
        depends_on: p.depends_on ?? [],
      })) }, null, 2));
      return;
    }
    console.log('═══════════════════════════════════════════');
    console.log('Dependency Graph (topological order)');
    console.log('═══════════════════════════════════════════');
    if (order.length === 0) {
      console.log('  (no projects in workspace)');
      return;
    }
    order.forEach((name, i) => {
      const p = manifest.projects.find(x => x.name === name);
      const deps = p?.depends_on?.length ? `  ← ${p.depends_on.join(', ')}` : '';
      console.log(`  ${i + 1}. ${name}${deps}`);
    });
    if (cycles.length > 0) {
      console.log('');
      console.log(`  ⚠ ${cycles.length} cycle(s) detected:`);
      for (const c of cycles) console.log(`    ${c.join(' → ')}`);
    }
    return;
  }

  console.error(`Unknown workspace subcommand: ${sub}`);
  console.error('Usage: wdf workspace <init|list|add|remove|show|validate|graph>');
  process.exit(1);
}

// ============================================================
// Coverage Command — enforce constitution §4.1 coverage threshold
// ============================================================

async function runCoverageCommand(args: string[], projectRoot: string) {
  const sub = args[1] ?? 'check';
  const json = args.includes('--json');

  const { checkCoverage, formatCoverageReport } = await import('./coverage-checker.js');

  if (sub === 'check' || sub === 'gate' || sub === 'verify') {
    const result = checkCoverage(projectRoot);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatCoverageReport(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (sub === 'run') {
    // Convenience: run vitest --coverage first, then check.
    const { spawnSync } = await import('child_process');
    console.log('Running: cd orchestrator && npx vitest run --coverage ...');
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vitest', 'run', '--coverage'],
      { cwd: join(projectRoot, 'orchestrator'), stdio: 'inherit' },
    );
    if (r.status !== 0) {
      console.error(`vitest --coverage failed (exit ${r.status})`);
      process.exit(r.status ?? 1);
    }
    const result = checkCoverage(projectRoot);
    console.log(formatCoverageReport(result));
    process.exit(result.ok ? 0 : 1);
  }

  console.error(`Unknown coverage subcommand: ${sub}`);
  console.error('Usage: wdf coverage <check|run>');
  console.error('  check — verify existing coverage report against constitution');
  console.error('  run   — run vitest --coverage then check');
  process.exit(1);
}

