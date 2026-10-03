/**
 * The version label in the footer: the last release this build includes,
 * and the commit it was built from. Production deploys every merge, so it is
 * often a few commits past the release; the commit says exactly which.
 */
export function versionLabel(version: string, commit: string): string {
  return commit ? `v${version} · ${commit}` : `v${version}`
}
