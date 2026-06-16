import { isAbsolute, join, resolve } from 'path';
/**
 * Resolve a workflow path string by substituting {project-root} with the
 * resolved absolute project root. If `value` is undefined and `fallback` is
 * provided, the fallback is resolved instead.
 *
 * Throws if neither value nor fallback resolves to a non-empty string.
 */
export function resolveWorkflowPath(projectRoot, value, fallback) {
    const root = resolve(projectRoot);
    const raw = (value && value.trim().length > 0) ? value : fallback;
    if (!raw || raw.trim().length === 0) {
        throw new Error('resolveWorkflowPath: no value or fallback provided');
    }
    const substituted = raw.replace(/\{project-root\}/g, root);
    return isAbsolute(substituted) ? substituted : resolve(root, substituted);
}
/**
 * Read workflow.status_dir from config and resolve to an absolute path.
 * Defaults to `<projectRoot>/_wdf_output/status` when not set.
 */
export function resolveStatusDir(projectRoot, config) {
    const workflow = (config?.workflow ?? {});
    const configured = typeof workflow.status_dir === 'string' ? workflow.status_dir : undefined;
    const fallback = join('{project-root}', '_wdf_output', 'status');
    return resolveWorkflowPath(projectRoot, configured, fallback);
}
//# sourceMappingURL=status-paths.js.map