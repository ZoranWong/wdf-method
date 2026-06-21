/**
 * CR consistency verifier.
 *
 * Cross-checks `changes/INDEX.md` against each `changes/CHG-NNN/proposal.md`:
 *
 * 1. Every CR row in INDEX.md has a matching proposal directory.
 * 2. The status column in INDEX.md matches the `Status:` line inside the
 *    proposal's frontmatter code block.
 * 3. Every CR marked IMPLEMENTED has at least one piece of evidence on disk —
 *    a corresponding test file, a status file delta, or a referenced module.
 *    The check is intentionally loose (presence of anything matching the
 *    CR's slug) to avoid false negatives on naming variation; its purpose is
 *    to catch CRs flipped to IMPLEMENTED with zero artifacts to back the claim.
 *
 * Exits non-zero on any mismatch and prints a structured report to stderr.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

export type CrStatus =
  | 'PROPOSED'
  | 'IN_REVIEW'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'IMPLEMENTED'
  | 'ARCHIVED';

export interface CrIssue {
  crId: string;
  kind:
    | 'missing_proposal'
    | 'missing_index_row'
    | 'status_mismatch'
    | 'unknown_status'
    | 'no_evidence'
    | 'malformed_proposal';
  message: string;
}

export interface CrVerifyReport {
  ok: boolean;
  totalCrs: number;
  issues: CrIssue[];
  statusByCr: Record<
    string,
    {
      index: CrStatus | null;
      proposal: CrStatus | null;
    }
  >;
}

const KNOWN_STATUSES: CrStatus[] = [
  'PROPOSED',
  'IN_REVIEW',
  'IN_PROGRESS',
  'BLOCKED',
  'IMPLEMENTED',
  'ARCHIVED',
];

/**
 * Parse `changes/INDEX.md` rows. Returns CR_ID → status (uppercase keyword).
 *
 * Looks for table rows of the shape:
 *   `| [CHG-2026-NNN](path) | Title | … | … | <emoji> STATUS | … | … |`
 *
 * Tolerates the leading emoji (`✅ IMPLEMENTED`, `🚧 IN_PROGRESS`, `📝 PROPOSED`).
 */
export function parseIndex(indexMd: string): Record<string, CrStatus | null> {
  const result: Record<string, CrStatus | null> = {};
  const lines = indexMd.split('\n');
  for (const line of lines) {
    const m = line.match(/\[([Cc][Hh][Gg]-\d{4}-\d{3})\]/);
    if (!m) continue;
    const crId = m[1].toUpperCase();
    // Find the status keyword anywhere on the row.
    const statusMatch = line.match(
      /\b(PROPOSED|IN_REVIEW|IN_PROGRESS|BLOCKED|IMPLEMENTED|ARCHIVED)\b/,
    );
    result[crId] = statusMatch ? (statusMatch[1] as CrStatus) : null;
  }
  return result;
}

/**
 * Extract `Status:` from a proposal.md. Reads the first ```fenced block``` and
 * returns the value of the `Status:` line, uppercased.
 */
export function parseProposalStatus(proposalMd: string): CrStatus | null {
  // Take the first fenced block.
  const fence = proposalMd.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (!fence) return null;
  const head = fence[1];
  const match = head.match(/^\s*Status:\s*(.+?)\s*$/m);
  if (!match) return null;
  const raw = match[1].toUpperCase();
  // Tolerate inline comments like "PROPOSED (placeholder)".
  for (const known of KNOWN_STATUSES) {
    if (raw.startsWith(known)) return known;
  }
  return null;
}

/**
 * Loose evidence check: is there at least one file in the repo whose path
 * mentions the CR slug or its issue keyword? We don't try to be smart — the
 * goal is to catch a CR flipped to IMPLEMENTED with zero artifacts.
 *
 * Heuristic: walk a fixed list of source-bearing directories (orchestrator
 * source, schemas, templates, scripts, CI workflows, commands, ADRs) and
 * check each file's path for any 4+-char token from the CR's slug.
 */
export function hasImplementationEvidence(crDirName: string, projectRoot: string): boolean {
  // crDirName like "CHG-2026-010-agent-communication" → slug "agent-communication"
  const slugMatch = crDirName.match(/^[Cc][Hh][Gg]-\d{4}-\d{3}-(.+)$/);
  if (!slugMatch) return false;
  const slug = slugMatch[1];
  const tokens = slug.split('-').filter((t) => t.length >= 3);
  if (tokens.length === 0) return true; // can't infer; don't block
  const searchRoots = [
    'orchestrator/src',
    'schemas',
    'templates',
    'scripts',
    'commands',
    'references',
    'docs/adr',
    '.github',
  ];
  for (const rel of searchRoots) {
    const root = join(projectRoot, rel);
    if (!existsSync(root)) continue;
    if (walkAndMatch(root, tokens)) return true;
  }
  return false;
}

function walkAndMatch(dir: string, tokens: string[]): boolean {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '_wdf_output') continue;
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    // Match against the full path (lowered) so a CR whose slug token names a
    // directory (e.g. "templates") matches files at templates/foo/bar.yaml.
    const lc = p.toLowerCase();
    if (tokens.some((tok) => lc.includes(tok))) return true;
    if (s.isDirectory()) {
      if (walkAndMatch(p, tokens)) return true;
    }
  }
  return false;
}

/**
 * Run the full verification. `projectRoot` is the wdf-method repo root (where
 * `changes/` and `orchestrator/` live).
 */
export function verifyCrConsistency(projectRoot: string): CrVerifyReport {
  const issues: CrIssue[] = [];
  const statusByCr: CrVerifyReport['statusByCr'] = {};
  const changesDir = join(projectRoot, 'changes');
  const indexPath = join(changesDir, 'INDEX.md');
  if (!existsSync(indexPath)) {
    return {
      ok: false,
      totalCrs: 0,
      issues: [
        {
          crId: '<index>',
          kind: 'malformed_proposal',
          message: `changes/INDEX.md not found at ${indexPath}`,
        },
      ],
      statusByCr: {},
    };
  }
  const indexMd = readFileSync(indexPath, 'utf-8');
  const indexStatuses = parseIndex(indexMd);
  // Discover proposal dirs.
  const proposalDirs = readdirSync(changesDir)
    .filter((d) => /^[Cc][Hh][Gg]-\d{4}-\d{3}-/.test(d))
    .filter((d) => {
      try {
        return statSync(join(changesDir, d)).isDirectory();
      } catch {
        return false;
      }
    });
  const proposalIds = new Set<string>();
  for (const dir of proposalDirs) {
    const idMatch = dir.match(/^([Cc][Hh][Gg]-\d{4}-\d{3})/);
    if (!idMatch) continue;
    const crId = idMatch[1].toUpperCase();
    proposalIds.add(crId);
    const proposalPath = join(changesDir, dir, 'proposal.md');
    if (!existsSync(proposalPath)) {
      issues.push({
        crId,
        kind: 'malformed_proposal',
        message: `${dir}/proposal.md missing`,
      });
      statusByCr[crId] = { index: indexStatuses[crId] ?? null, proposal: null };
      continue;
    }
    const proposalMd = readFileSync(proposalPath, 'utf-8');
    const proposalStatus = parseProposalStatus(proposalMd);
    const indexStatus = indexStatuses[crId] ?? null;
    statusByCr[crId] = { index: indexStatus, proposal: proposalStatus };
    if (proposalStatus === null) {
      issues.push({
        crId,
        kind: 'malformed_proposal',
        message: `${dir}/proposal.md has no parseable Status: line in its frontmatter block`,
      });
      continue;
    }
    if (!KNOWN_STATUSES.includes(proposalStatus)) {
      issues.push({
        crId,
        kind: 'unknown_status',
        message: `${dir}/proposal.md Status: ${proposalStatus} is not a known status`,
      });
    }
    if (indexStatus === null) {
      issues.push({
        crId,
        kind: 'missing_index_row',
        message: `INDEX.md has no row for ${crId}`,
      });
    } else if (indexStatus !== proposalStatus) {
      issues.push({
        crId,
        kind: 'status_mismatch',
        message: `INDEX says ${indexStatus} but proposal says ${proposalStatus}`,
      });
    }
    if (proposalStatus === 'IMPLEMENTED') {
      const hasEvidence = hasImplementationEvidence(dir, projectRoot);
      if (!hasEvidence) {
        issues.push({
          crId,
          kind: 'no_evidence',
          message: `${crId} marked IMPLEMENTED but no file in source-bearing dirs matches its slug tokens`,
        });
      }
    }
  }
  // CRs that appear in INDEX but have no proposal dir.
  for (const crId of Object.keys(indexStatuses)) {
    if (!proposalIds.has(crId)) {
      issues.push({
        crId,
        kind: 'missing_proposal',
        message: `INDEX.md references ${crId} but no changes/${crId}-* directory exists`,
      });
      statusByCr[crId] = { index: indexStatuses[crId] ?? null, proposal: null };
    }
  }
  return {
    ok: issues.length === 0,
    totalCrs: proposalIds.size,
    issues,
    statusByCr,
  };
}

export function formatReport(report: CrVerifyReport): string {
  const lines: string[] = [];
  lines.push(`CR consistency report — ${report.totalCrs} CR(s) inspected`);
  lines.push('');
  if (report.ok) {
    lines.push('✅ All CR statuses agree between INDEX.md and proposal.md');
    return lines.join('\n');
  }
  lines.push(`❌ Found ${report.issues.length} issue(s):`);
  lines.push('');
  for (const issue of report.issues) {
    lines.push(`  [${issue.kind}] ${issue.crId}: ${issue.message}`);
  }
  lines.push('');
  lines.push('Status overview (INDEX → proposal):');
  for (const [crId, st] of Object.entries(report.statusByCr).sort()) {
    const flag = st.index === st.proposal ? '  ' : '⚠ ';
    lines.push(`  ${flag}${crId}: ${st.index ?? '∅'} → ${st.proposal ?? '∅'}`);
  }
  return lines.join('\n');
}
