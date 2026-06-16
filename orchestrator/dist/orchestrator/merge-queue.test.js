import { describe, expect, it } from 'vitest';
import { validateMergeQueueItem, detectHiddenOverlapsFromFileLists } from './merge-queue.js';
describe('merge queue safety', () => {
    it('rejects unsafe branch names', () => {
        expect(() => validateMergeQueueItem({ branch: 'story/S-1;rm -rf /', story_id: 'S-1', queue_item_id: 'QUEUE-1', integration_checks: ['npm run test'] })).toThrow(/branch/);
    });
    it('rejects unsafe integration checks', () => {
        expect(() => validateMergeQueueItem({ branch: 'story/S-1', story_id: 'S-1', queue_item_id: 'QUEUE-1', integration_checks: ['npm run test && rm -rf /'] })).toThrow(/Unsafe integration check/);
    });
    it('accepts valid merge queue items', () => {
        expect(() => validateMergeQueueItem({
            branch: 'story/S-1.2.3/backend-auth',
            story_id: 'S-1.2.3',
            queue_item_id: 'QUEUE-1',
            integration_checks: ['npm run test', 'npm run build'],
        })).not.toThrow();
    });
});
describe('hidden overlap detection', () => {
    it('detects overlap outside both story scopes', () => {
        expect(detectHiddenOverlapsFromFileLists(['src/a.ts', 'src/shared/util.ts'], ['src/b.ts', 'src/shared/util.ts'], ['src/a.ts'], ['src/b.ts'])).toEqual(['src/shared/util.ts']);
    });
    it('does not flag files inside current scope', () => {
        expect(detectHiddenOverlapsFromFileLists(['src/a.ts', 'src/shared/util.ts'], ['src/b.ts', 'src/shared/util.ts'], ['src/a.ts', 'src/shared/util.ts'], ['src/b.ts'])).toEqual([]);
    });
    it('does not flag files inside other scope', () => {
        expect(detectHiddenOverlapsFromFileLists(['src/a.ts', 'src/shared/util.ts'], ['src/b.ts', 'src/shared/util.ts'], ['src/a.ts'], ['src/b.ts', 'src/shared/util.ts'])).toEqual([]);
    });
    it('returns empty when no overlap', () => {
        expect(detectHiddenOverlapsFromFileLists(['src/a.ts'], ['src/b.ts'], ['src/a.ts'], ['src/b.ts'])).toEqual([]);
    });
    it('detects multiple hidden overlaps', () => {
        expect(detectHiddenOverlapsFromFileLists(['src/a.ts', 'shared/config.ts', 'shared/logger.ts'], ['src/b.ts', 'shared/config.ts', 'shared/logger.ts'], ['src/a.ts'], ['src/b.ts'])).toEqual(['shared/config.ts', 'shared/logger.ts']);
    });
});
//# sourceMappingURL=merge-queue.test.js.map