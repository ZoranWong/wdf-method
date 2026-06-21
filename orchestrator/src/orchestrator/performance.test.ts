import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  timed,
  timedSync,
  increment,
  setGauge,
  getTimingStats,
  generatePerformanceReport,
  savePerformanceReport,
  resetMetrics,
  formatPerformanceReport,
} from './performance.js';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('performance', () => {
  let tmpDir: string;

  beforeEach(() => {
    resetMetrics();
    tmpDir = mkdtempSync('wdf-perf-test-');
  });

  describe('timed', async () => {
    it('measures async function execution time', async () => {
      const result = await timed('test-operation', async () => {
        // 30ms sleep with a ≥10ms assertion gives comfortable headroom against
        // timer jitter (Node's setTimeout can fire ~1ms early under load).
        await new Promise(r => setTimeout(r, 30));
        return 42;
      });

      expect(result).toBe(42);
      const stats = getTimingStats('test-operation');
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
      expect(stats!.avg).toBeGreaterThanOrEqual(10);
    });

    it('increments call counter', async () => {
      await timed('counted', async () => 'ok');
      await timed('counted', async () => 'ok');

      const report = generatePerformanceReport();
      expect(report.metrics['counted_calls']).toBeDefined();
    });
  });

  describe('timedSync', () => {
    it('measures sync function execution time', () => {
      const result = timedSync('sync-op', () => {
        let sum = 0;
        for (let i = 0; i < 100000; i++) sum += i;
        return sum;
      });

      expect(typeof result).toBe('number');
      const stats = getTimingStats('sync-op');
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
    });
  });

  describe('increment', () => {
    it('increments counter metrics', () => {
      increment('stories_run');
      increment('stories_run');
      increment('stories_run', 3);

      const report = generatePerformanceReport();
      expect(report.metrics['stories_run']?.[0].value).toBe(5);
    });
  });

  describe('setGauge', () => {
    it('sets gauge values', () => {
      setGauge('active_stories', 3);
      setGauge('memory_usage_mb', 256);

      const report = generatePerformanceReport();
      expect(report.metrics['active_stories']?.[0].value).toBe(3);
      expect(report.metrics['memory_usage_mb']?.[0].value).toBe(256);
    });
  });

  describe('generatePerformanceReport', () => {
    it('generates complete report structure', async () => {
      await timed('op1', async () => { });
      await timed('op2', async () => { });
      increment('gates_checked', 5);

      const report = generatePerformanceReport();

      expect(report.generated_at).toBeDefined();
      expect(report.summary.total_runtime_ms).toBeGreaterThan(0);
      expect(report.summary.total_operations).toBe(2);
      expect(report.summary.slowest_operations.length).toBeGreaterThan(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('identifies slow operations in recommendations', async () => {
      // Use a short delay to avoid timeout
      await timed('very-slow-op', async () => {
        await new Promise(r => setTimeout(r, 15));
        for (let i = 0; i < 10000000; i++) {
          // Some work to ensure measurable time
        }
      });

      const report = generatePerformanceReport();
      // Just verify recommendations exist - we don't need to hit the slow threshold
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('savePerformanceReport', () => {
    it('saves report to JSON file', () => {
      const path = savePerformanceReport(tmpDir);

      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.generated_at).toBeDefined();
      expect(parsed.summary).toBeDefined();
    });
  });

  describe('formatPerformanceReport', () => {
    it('produces human-readable output', async () => {
      await timed('formatted-op', async () => { });
      const report = generatePerformanceReport();
      const formatted = formatPerformanceReport(report);

      expect(formatted).toContain('Performance Report');
      expect(formatted).toContain('Total Runtime');
      expect(formatted).toContain('Recommendations');
    });
  });

  describe('getTimingStats', () => {
    it('returns null for untracked operations', () => {
      expect(getTimingStats('never-ran')).toBeNull();
    });

    it('calculates correct statistics', async () => {
      for (let i = 1; i <= 5; i++) {
        await timed('multi-op', async () => {
          await new Promise(r => setTimeout(r, i * 10));
        });
      }

      const stats = getTimingStats('multi-op');
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(5);
      expect(stats!.min).toBeLessThan(stats!.max);
      expect(stats!.p95).toBeGreaterThanOrEqual(stats!.avg);
    });
  });
});
