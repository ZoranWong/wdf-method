/**
 * Resolve a workflow path string by substituting {project-root} with the
 * resolved absolute project root. If `value` is undefined and `fallback` is
 * provided, the fallback is resolved instead.
 *
 * Throws if neither value nor fallback resolves to a non-empty string.
 */
export declare function resolveWorkflowPath(projectRoot: string, value: string | undefined, fallback?: string): string;
/**
 * Read workflow.status_dir from config and resolve to an absolute path.
 * Defaults to `<projectRoot>/_bmad-output/wdf-method/status` when not set.
 */
export declare function resolveStatusDir(projectRoot: string, config: Record<string, any>): string;
//# sourceMappingURL=status-paths.d.ts.map