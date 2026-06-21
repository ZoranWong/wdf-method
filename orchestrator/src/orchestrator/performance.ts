// Performance metrics collection and reporting for wdf-method.
// Tracks timing, counts, and resource usage for operations.
import { performance } from 'perf_hooks';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export type MetricType = 'counter' | 'gauge' | 'timing' | 'histogram';

export interface MetricValue {
  type: MetricType;
  value: number;
  unit?: string;
  timestamp?: string;
  labels?: Record<string, string>;
}

export interface PerformanceReport {
  generated_at: string;
  summary: {
    total_runtime_ms: number;
    total_operations: number;
    slowest_operations: Array<{
      name: string;
      duration_ms: number;
    }>;
  };
  metrics: Record<string, MetricValue[]>;
  recommendations: string[];
}

export interface PerformanceCheckResult {
  check: string;
  actual: number;
  threshold: number;
  unit: string;
  passed: boolean;
}

export interface PerformanceCheckReport {
  all_passed: boolean;
  fixture: string | null;
  results: PerformanceCheckResult[];
}

interface TimingStats {
  count: number;
  avg: number;
  max: number;
  min: number;
  p95: number;
}

interface ConstitutionThresholds {
  state_load_ms?: number;
  gate_eval_ms?: number;
  single_test_s?: number;
}

class MetricsStore {
  counters = new Map<string, number>();
  gauges = new Map<string, number>();
  timings = new Map<string, number[]>();
  startTime = performance.now();
  operationStartTimes = new Map<string, number>();

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.timings.clear();
    this.startTime = performance.now();
  }

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  startTiming(name: string): void {
    this.operationStartTimes.set(name, performance.now());
  }

  endTiming(name: string): number {
    const start = this.operationStartTimes.get(name);
    if (start === undefined) return -1;
    const duration = performance.now() - start;
    const existing = this.timings.get(name) ?? [];
    existing.push(duration);
    this.timings.set(name, existing);
    this.operationStartTimes.delete(name);
    return duration;
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  getTimingStats(name: string): TimingStats | null {
    const timings = this.timings.get(name);
    if (!timings || timings.length === 0) return null;
    const sorted = [...timings].sort((a, b) => a - b);
    return {
      count: timings.length,
      avg: timings.reduce((a, b) => a + b, 0) / timings.length,
      max: sorted[sorted.length - 1],
      min: sorted[0],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
  }

  getTotalRuntime(): number {
    return performance.now() - this.startTime;
  }

  getAllTimings(): string[] {
    return Array.from(this.timings.keys());
  }

  generateReport(): PerformanceReport {
    const totalRuntime = this.getTotalRuntime();
    const totalOperations = Array.from(this.timings.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const slowestOperations = Array.from(this.timings.entries())
      .map(([name, timings]) => ({
        name,
        duration_ms: Math.max(...timings),
      }))
      .sort((a, b) => b.duration_ms - a.duration_ms)
      .slice(0, 5);
    const metrics: Record<string, MetricValue[]> = {};
    for (const [name, value] of this.counters) {
      metrics[name] = [{ type: 'counter', value, timestamp: new Date().toISOString() }];
    }
    for (const [name, value] of this.gauges) {
      metrics[name] = [{ type: 'gauge', value, timestamp: new Date().toISOString() }];
    }
    for (const [name] of this.timings) {
      const stats = this.getTimingStats(name);
      if (stats) {
        metrics[name] = [
          { type: 'timing', value: stats.avg, unit: 'ms', labels: { statistic: 'avg' } },
          { type: 'timing', value: stats.max, unit: 'ms', labels: { statistic: 'max' } },
          { type: 'timing', value: stats.p95, unit: 'ms', labels: { statistic: 'p95' } },
        ];
      }
    }
    const recommendations = this.generateRecommendations();
    return {
      generated_at: new Date().toISOString(),
      summary: {
        total_runtime_ms: totalRuntime,
        total_operations: totalOperations,
        slowest_operations: slowestOperations,
      },
      metrics,
      recommendations,
    };
  }

  generateRecommendations(): string[] {
    const recs: string[] = [];
    // Check for slow operations
    for (const name of this.getAllTimings()) {
      const stats = this.getTimingStats(name);
      if (stats && stats.avg > 5000) {
        recs.push(`Operation "${name}" averages ${Math.round(stats.avg)}ms — consider optimization`);
      }
    }
    // Check for high story counts
    const storyCount = this.getCounter('stories_run');
    if (storyCount > 20) {
      recs.push('Running 20+ stories — consider splitting into smaller batches');
    }
    if (recs.length === 0) {
      recs.push('All operations within expected performance bounds');
    }
    return recs;
  }
}

// Global metrics store
const metrics = new MetricsStore();

/**
 * Measure the execution time of an async function.
 */
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  metrics.startTiming(name);
  try {
    return await fn();
  } finally {
    metrics.endTiming(name);
    metrics.increment(`${name}_calls`);
  }
}

/**
 * Measure the execution time of a sync function.
 */
export function timedSync<T>(name: string, fn: () => T): T {
  metrics.startTiming(name);
  try {
    return fn();
  } finally {
    metrics.endTiming(name);
    metrics.increment(`${name}_calls`);
  }
}

/**
 * Increment a counter metric.
 */
export function increment(name: string, by = 1): void {
  metrics.increment(name, by);
}

/**
 * Set a gauge metric.
 */
export function setGauge(name: string, value: number): void {
  metrics.setGauge(name, value);
}

/**
 * Get timing statistics for an operation.
 */
export function getTimingStats(name: string): TimingStats | null {
  return metrics.getTimingStats(name);
}

/**
 * Generate a performance report.
 */
export function generatePerformanceReport(): PerformanceReport {
  return metrics.generateReport();
}

/**
 * Save performance report to project directory.
 */
export function savePerformanceReport(projectRoot: string): string {
  const reportDir = join(projectRoot, '_wdf_output', 'reports');
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }
  const report = generatePerformanceReport();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = join(reportDir, `performance-${timestamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return reportPath;
}

/**
 * Reset all metrics (useful for testing).
 */
export function resetMetrics(): void {
  metrics.reset();
}

/**
 * Format performance report for CLI display.
 */
export function formatPerformanceReport(report: PerformanceReport): string {
  const lines: string[] = [];
  lines.push('📊 Performance Report');
  lines.push(`   Generated: ${report.generated_at}`);
  lines.push('');
  lines.push('📈 Summary:');
  lines.push(`   Total Runtime: ${Math.round(report.summary.total_runtime_ms)}ms`);
  lines.push(`   Operations: ${report.summary.total_operations}`);
  lines.push('');
  if (report.summary.slowest_operations.length > 0) {
    lines.push('🐢 Slowest Operations:');
    for (const op of report.summary.slowest_operations) {
      lines.push(`   - ${op.name}: ${Math.round(op.duration_ms)}ms`);
    }
    lines.push('');
  }
  lines.push('💡 Recommendations:');
  for (const rec of report.recommendations) {
    lines.push(`   • ${rec}`);
  }
  return lines.join('\n');
}

/**
 * Load performance thresholds from constitution.yaml.
 * Returns undefined if constitution is missing or has no performance section.
 */
function loadThresholds(projectRoot: string): ConstitutionThresholds | null {
  const constitutionPath = join(projectRoot, 'constitution.yaml');
  if (!existsSync(constitutionPath)) return null;
  try {
    const raw = readFileSync(constitutionPath, 'utf-8');
    // Lightweight YAML extraction — avoid js-yaml dependency for CI speed.
    const match = raw.match(/performance:\s*\n((?:\s+\w+:.*\n?)+)/);
    if (!match) return null;
    const block = match[1];
    const thresholds: ConstitutionThresholds = {};
    const stateLoad = block.match(/state_load_ms:\s*(\d+)/);
    const gateEval = block.match(/gate_eval_ms:\s*(\d+)/);
    const singleTest = block.match(/single_test_s:\s*(\d+)/);
    if (stateLoad) thresholds.state_load_ms = parseInt(stateLoad[1], 10);
    if (gateEval) thresholds.gate_eval_ms = parseInt(gateEval[1], 10);
    if (singleTest) thresholds.single_test_s = parseInt(singleTest[1], 10);
    return thresholds;
  } catch {
    return null;
  }
}

/**
 * Locate a fixture project (with _wdf_output/status/) to run timings against.
 * Prefers examples/todo-app in the repo, else the project root itself.
 */
function findFixture(projectRoot: string): string | null {
  const candidates = [
    join(projectRoot, 'examples', 'todo-app'),
    projectRoot,
  ];
  for (const c of candidates) {
    if (existsSync(join(c, '_wdf_output', 'status', 'global.yaml'))) return c;
  }
  return null;
}

/**
 * Run constitution-defined performance checks and return pass/fail report.
 * Used by CI to enforce performance redlines (constitution.yaml §4.3).
 */
export async function runPerformanceChecks(projectRoot: string): Promise<PerformanceCheckReport> {
  const root = resolve(projectRoot);
  const thresholds = loadThresholds(root);
  const fixture = findFixture(root);
  const results: PerformanceCheckResult[] = [];
  if (!thresholds || !fixture) {
    return {
      all_passed: false,
      fixture,
      results: [
        {
          check: 'setup',
          actual: 0,
          threshold: 1,
          unit: 'precondition',
          passed: false,
        },
      ],
    };
  }
  // Check 1: state load — measure SprintStatusManager initialization.
  if (thresholds.state_load_ms !== undefined) {
    try {
      const { SprintStatusManager } = await import('./sprint-status.js');
      const statusDir = join(fixture, '_wdf_output', 'status');
      const fallbackPath = join(statusDir, 'global.yaml');
      const t0 = performance.now();
      await SprintStatusManager.loadFromStatusDir(statusDir, fallbackPath);
      const elapsed = performance.now() - t0;
      results.push({
        check: 'state_load_ms',
        actual: Math.round(elapsed),
        threshold: thresholds.state_load_ms,
        unit: 'ms',
        passed: elapsed <= thresholds.state_load_ms,
      });
    } catch (err) {
      results.push({
        check: 'state_load_ms',
        actual: -1,
        threshold: thresholds.state_load_ms,
        unit: 'ms (errored)',
        passed: false,
      });
    }
  }
  // Check 2: gate eval — measure GateEvaluator on a synthetic gate card.
  if (thresholds.gate_eval_ms !== undefined) {
    try {
      const { GateEvaluator } = await import('./gate-evaluator.js');
      const { SprintStatusManager } = await import('./sprint-status.js');
      const evaluator = new GateEvaluator(fixture);
      const statusDir = join(fixture, '_wdf_output', 'status');
      const fallbackPath = join(statusDir, 'global.yaml');
      const state = await SprintStatusManager.loadFromStatusDir(statusDir, fallbackPath);
      const t0 = performance.now();
      await evaluator.evaluate(
        {
          checks: [
            {
              id: 'perf-probe',
              type: 'artifact_exists',
              description: 'perf probe',
              target: '_wdf_output/status/global.yaml',
            },
          ],
        },
        state,
      );
      const elapsed = performance.now() - t0;
      results.push({
        check: 'gate_eval_ms',
        actual: Math.round(elapsed),
        threshold: thresholds.gate_eval_ms,
        unit: 'ms',
        passed: elapsed <= thresholds.gate_eval_ms,
      });
    } catch (err) {
      results.push({
        check: 'gate_eval_ms',
        actual: -1,
        threshold: thresholds.gate_eval_ms,
        unit: 'ms (errored)',
        passed: false,
      });
    }
  }
  return {
    all_passed: results.length > 0 && results.every((r) => r.passed),
    fixture,
    results,
  };
}
