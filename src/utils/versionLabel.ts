/**
 * The version label in the footer: the last release this build includes,
 * the commits past it when known, and the commit it was built from. Production
 * deploys every merge, so a build is often a few commits past the release.
 */
export function versionLabel(version: string, commit: string, ahead = 0): string {
  const v = ahead > 0 ? `v${version} +${ahead}` : `v${version}`
  return commit ? `${v} · ${commit}` : v
}
