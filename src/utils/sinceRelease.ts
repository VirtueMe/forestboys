/**
 * The commits in this build that come after the latest release tag. vite.config.ts
 * reads them from git at build time and injects the result as `__APP_SINCE__`;
 * `null` means git could not tell (no tags in a shallow clone, no git).
 */

export interface CommitRef { hash: string; subject: string }
export interface SinceRelease { tag: string; commits: CommitRef[] }

/** `git log --format=%h%x09%s` output: one `hash<TAB>subject` per line. */
export function parseCommitLog(log: string): CommitRef[] {
  const out: CommitRef[] = []
  for (const line of log.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab > 0) out.push({ hash: line.slice(0, tab), subject: line.slice(tab + 1).trim() })
  }
  return out
}

const HOUSEKEEPING_RE = /^(chore|ci|build|docs|test|refactor)(\([^)]*\))?!?:/

/** chore, ci, build, docs, test and refactor commits (any scope) are upkeep, not something a reader of the changelog cares about. style stays visible. */
export function isHousekeeping(subject: string): boolean {
  return HOUSEKEEPING_RE.test(subject)
}

export function commitUrl(repo: string, hash: string): string {
  return `https://github.com/${repo}/commit/${hash}`
}
