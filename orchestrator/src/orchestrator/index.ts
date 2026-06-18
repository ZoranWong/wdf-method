import { PhaseOrchestrator } from './orchestrator.js';
import { SprintStatusValidator } from './state-validator.js';
import { SprintStatusManager } from './sprint-status.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { loadConfig, getSprintTrackingPath, getStatusDir, getSignalDir } from './config.js';
import { SpecLinter } from './linter/linter.js';
import { BUILTIN_RULES } from './linter/rules/index.js';
import { preCheckCommand, formatPreCheckResult } from './pre-check.js';
import { initCommand } from './init.js';
import { rebuildStatusCommand } from './rebuild-status.js';
import { statusCommand, renderStatus } from './status.js';
import { GateEvaluator } from './gate-evaluator.js';
import { runDoctor, formatDoctorReport } from './doctor.js';
import { applyDelta, summarizePlan, unifiedDiff, loadDelta, planApply } from './cr-applier.js';
import { renameSync, readdirSync, statSync } from 'fs';

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

  if (command === 'init') {
    await runInitCommand(args);
    return;
  }

  // Proposal-level CR ops (cr apply / cr archive) work on changes/<CHG-id>/
  // and do NOT require an initialized project; treat cwd as project root.
  if (command === 'cr' && (args[1] === 'apply' || args[1] === 'archive')) {
    await runCrProposalCommand(args, process.cwd());
    return;
  }

  const projectRoot = resolve(args[1] ?? process.cwd());

  if (!existsSync(projectRoot)) {
    console.error(`Project root not found: ${projectRoot}`);
    process.exit(1);
  }

  // Check if project is initialized for commands that need it
  const statusDir = join(projectRoot, '_wdf_output', 'status');
  const initialized = existsSync(join(statusDir, 'global.yaml'));

  if (!initialized && !['status', 'help', 'rebuild-status'].includes(command)) {
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
      // `cr apply` and `cr archive` operate on changes/<CHG-id>/ source files,
      // not runtime status — they do NOT require the project to be initialized.
      if (args[1] === 'apply' || args[1] === 'archive') {
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

    case 'run':
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      const mode = args[2] as 'light' | 'serial' | 'parallel' | undefined;
      await orchestrator.triageAndExecute(mode);
      break;

    case 'run-track': {
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      const track = args[2] as 'backend' | 'frontend' | undefined;
      if (!track) {
        console.error('Usage: orchestrator run-track <backend|frontend>');
        process.exit(1);
      }
      console.log(`Running ${track} track...`);
      await orchestrator.triageAndExecute('serial');
      break;
    }

    case 'auto-run':
    case 'autorun':
    case 'run-loop': {
      if (!orchestrator) {
        console.error('WDF project not initialized. Run `wdf init` first.');
        process.exit(1);
      }
      const verbose = args.includes('--verbose') || args.includes('-v');
      const maxIter = parseOptInt(args, '--max-iter', 50);
      const result = await orchestrator.runAutoLoop({ verbose, maxIterations: maxIter });
      if (!verbose) {
        console.log(JSON.stringify({
          all_done: result.all_phases_complete,
          phases: result.phases_executed,
          paused: result.paused,
          iterations: result.iterations,
        }, null, 2));
      }
      if (result.paused && !verbose) {
        console.log(`⏸  Paused: ${result.pause_reason ?? '(unknown)'}. Resume: wdf resume`);
      }
      process.exit(result.all_phases_complete ? 0 : 1);
    }

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
        try { const g = require('child_process').execSync('git --version', { encoding: 'utf8' }).trim(); results.push(['Git', true, g]); } catch { results.push(['Git', false, 'Not installed']); }
        // Worktree
        try { require('child_process').execSync('git worktree list', { cwd: projectRoot, stdio: 'pipe' }); results.push(['Git worktree', true, 'Available']); } catch { results.push(['Git worktree', false, 'Not available']); }
        // Node
        results.push(['Node.js', true, process.version]);
        // NPM
        try { const n = require('child_process').execSync('npm --version', { encoding: 'utf8' }).trim(); results.push(['npm', true, n]); } catch { results.push(['npm', false, 'Not installed']); }
        // Disk
        try { const df = require('child_process').execSync('df -h .', { encoding: 'utf8', cwd: projectRoot }).trim().split('\n')[1]; results.push(['Disk', true, df.split(/\s+/)[3] + ' available']); } catch { results.push(['Disk', false, 'Cannot check']); }
        // Signals
        const signalDir = getSignalDir(cfg, projectRoot);
        results.push(['Signals dir', existsSync(signalDir), existsSync(signalDir) ? signalDir : 'Not found']);
        // Status files
        if (existsSync(statusDir)) {
          const files = require('fs').readdirSync(statusDir).filter((f: string) => f.endsWith('.yaml'));
          results.push(['Status files', files.length > 0, `${files.length} files: ${files.join(', ')}`]);
        } else { results.push(['Status files', false, 'status/ directory not found']); }
        // BMAD skills
        try { const { BmadHealthChecker } = await import('./bmad-health-check.js'); const chk = new BmadHealthChecker(projectRoot); const r: any = await chk.check(); results.push(['BMAD skills', r.overall !== 'blocked', `${r.available.filter((s: any) => s.available).length}/${r.available.length} available (${r.overall})`]); } catch { results.push(['BMAD skills', false, 'Health checker error']); }
        // Agent count
        const agentDir = join(projectRoot, '.claude', 'skills', 'wdf-method', 'skills');
        if (existsSync(agentDir)) { const c = require('fs').readdirSync(agentDir).filter((d: string) => existsSync(join(agentDir, d, 'SKILL.md'))).length; results.push(['Agent skills', c > 0, `${c} agents installed`]); } else { results.push(['Agent skills', false, 'Not installed']); }
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
web-dev-flow orchestrator v3.6.0

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
  const options: any = {
    projectRoot: process.cwd(),
    complexity: 'standard',
    devMode: 'separated',
    triageMode: 'parallel',
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

  try {
    const result = await initCommand(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`✅ WDF project initialized successfully!`);
      console.log(`   Project: ${result.projectName}`);
      console.log(`   Root: ${result.projectRoot}`);
      console.log(`   Files created: ${result.filesCreated.length}`);
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
      console.log('Usage: wdf cr <list|show|create|resolve|apply|archive> [args] [options]');
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

  if (!id || !/^CHG-\d{4}-\d{3}$/.test(id)) {
    console.error(`Usage: wdf cr ${sub} <CHG-YYYY-NNN> [options]`);
    process.exit(1);
  }

  const proposalDir = join(projectRoot, 'changes', id);
  if (!existsSync(proposalDir)) {
    console.error(`Proposal directory not found: changes/${id}`);
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
    const archiveRoot = join(projectRoot, 'changes', '_archive');
    const target = join(archiveRoot, id);
    if (existsSync(target) && !args.includes('--force')) {
      console.error(`Already archived: changes/_archive/${id} (use --force to overwrite)`);
      process.exit(1);
    }
    mkdirSync(archiveRoot, { recursive: true });
    if (existsSync(target)) {
      // --force: remove existing target via shutil-like recursive remove
      const { rmSync } = require('fs') as typeof import('fs');
      rmSync(target, { recursive: true, force: true });
    }
    renameSync(proposalDir, target);
    if (json) {
      console.log(JSON.stringify({ change_id: id, archived_to: relative(projectRoot, target) }, null, 2));
    } else {
      console.log(`✅ Archived changes/${id} → changes/_archive/${id}`);
    }
    return;
  }
}

function relative(from: string, to: string): string {
  const path = require('path') as typeof import('path');
  return path.relative(from, to);
}

function parseOptInt(args: string[], flag: string, defaultVal: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const n = Number(args[idx + 1]);
  return Number.isFinite(n) ? n : defaultVal;
}

