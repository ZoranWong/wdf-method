import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { evaluateStoryReadyGate } from './story-ready-gate.js';
const baseStory = {
    story_id: 'S-1.1',
    title: 'Test Story',
    track: 'backend',
    scope_write: ['src/auth'],
    acceptance_check: ['npm run test'],
    depends_on: [],
};
function projectWithStory() {
    const root = mkdtempSync(join(tmpdir(), 'wdf-srg-'));
    mkdirSync(join(root, 'stories'), { recursive: true });
    mkdirSync(join(root, 'src', 'auth'), { recursive: true });
    writeFileSync(join(root, 'stories', 'S-1.1.md'), '# Story');
    return root;
}
describe('Story Ready Gate', () => {
    it('passes a valid story', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate(baseStory, {
            projectRoot: root,
            storiesDir: join(root, 'stories'),
            activeStories: [],
            protectedPaths: ['schema/migration'],
        });
        expect(result.all_pass).toBe(true);
        expect(result.serial_only).toBe(false);
    });
    it('fails missing scope_write as SRG-01', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate({ ...baseStory, scope_write: [] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-01', status: 'fail' }));
    });
    it('fails missing acceptance_check as SRG-02', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate({ ...baseStory, acceptance_check: [] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-02', status: 'fail' }));
    });
    it('fails missing story file as SRG-03', () => {
        const root = mkdtempSync(join(tmpdir(), 'wdf-srg-'));
        mkdirSync(join(root, 'stories'), { recursive: true });
        mkdirSync(join(root, 'src', 'auth'), { recursive: true });
        const result = evaluateStoryReadyGate(baseStory, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-03', status: 'fail' }));
    });
    it('marks protected paths as serial-only', () => {
        const root = projectWithStory();
        mkdirSync(join(root, 'schema', 'migration'), { recursive: true });
        const result = evaluateStoryReadyGate({ ...baseStory, scope_write: ['schema/migration'] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: ['schema/migration'] });
        expect(result.all_pass).toBe(true);
        expect(result.serial_only).toBe(true);
    });
    it('fails unsafe acceptance commands as SRG-09', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate({ ...baseStory, acceptance_check: ['npm run test && rm -rf /'] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-09', status: 'fail' }));
    });
    it('passes path safety check for relative paths (SRG-04)', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate({ ...baseStory, scope_write: ['src/auth'] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-04', status: 'pass' }));
    });
    it('fails path traversal in scope_write as SRG-04', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate({ ...baseStory, scope_write: ['src/../secret'] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-04', status: 'fail' }));
    });
    it('fails scope overlap with active stories as SRG-05', () => {
        const root = projectWithStory();
        const activeStories = [{ id: 'S-1.0', scope_write: ['src/auth'], status: 'IN_PROGRESS' }];
        const result = evaluateStoryReadyGate(baseStory, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories, protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-05', status: 'fail' }));
    });
    it('passes when no scope overlap with active stories (SRG-05)', () => {
        const root = projectWithStory();
        const activeStories = [{ id: 'S-1.0', scope_write: ['src/api'], status: 'IN_PROGRESS' }];
        const result = evaluateStoryReadyGate(baseStory, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories, protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-05', status: 'pass' }));
    });
    it('passes parent directories exist (SRG-07)', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate(baseStory, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-07', status: 'pass' }));
    });
    it('fails when parent directory does not exist (SRG-07)', () => {
        const root = projectWithStory();
        const result = evaluateStoryReadyGate({ ...baseStory, scope_write: ['src/nonexistent/deep/path'] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
        expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-07', status: 'fail' }));
    });
});
//# sourceMappingURL=story-ready-gate.test.js.map