import { PhaseOrchestrator } from './orchestrator.js';
import { SprintStatusValidator } from './state-validator.js';
import { SprintStatusManager } from './sprint-status.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] ?? 'status';
    const projectRoot = resolve(args[1] ?? process.cwd());
    if (!existsSync(projectRoot)) {
        console.error(`Project root not found: ${projectRoot}`);
        process.exit(1);
    }
    const orchestrator = new PhaseOrchestrator(projectRoot);
    await orchestrator.initialize();
    switch (command) {
        case 'status':
            console.log(orchestrator.displayStatus());
            break;
        case 'run':
            const mode = args[2];
            await orchestrator.triageAndExecute(mode);
            break;
        case 'run-track': {
            const track = args[2];
            if (!track) {
                console.error('Usage: orchestrator run-track <backend|frontend>');
                process.exit(1);
            }
            console.log(`Running ${track} track...`);
            await orchestrator.triageAndExecute('serial');
            break;
        }
        case 'merge-queue':
            console.log(orchestrator.displayMergeQueue());
            break;
        case 'validate-state': {
            const trackingPath = resolve(projectRoot, '_bmad-output/web-dev-flow/sprint-status.yaml');
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

Usage:
  orchestrator status [project-root]     Show current status dashboard
  orchestrator run [project-root]        Execute workflow from current state
  orchestrator run <light|serial|parallel> [project-root]  Execute with specific triage mode
  orchestrator run-track <backend|frontend> [project-root]  Run a specific track
  orchestrator merge-queue [project-root]   Show merge queue status
  orchestrator validate-state [project-root] Validate sprint-status.yaml consistency
  orchestrator health [project-root]     Check BMAD skill availability
  orchestrator help                      Show this help
      `);
            break;
    }
}
main().catch(err => {
    console.error('Orchestrator error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map