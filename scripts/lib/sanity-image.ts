/**
 * Cypher fragments that say "this Source is a Sanity photo", for the sync (#413). The backfill (#412) moves
 * `Source.url` to our bucket, so the url no longer tells: the id (`img:sanity:<assetRef>`) and `sanityKey` do,
 * and the url test stays for a photo not copied yet.
 */

/** A predicate on the Source bound to `alias`: true before and after the photo is copied. */
export const isSanityImage = (alias: string) =>
  `(${alias}.id STARTS WITH 'img:sanity:' OR ${alias}.url STARTS WITH 'https://cdn.sanity.io/')`

/** An expression: the `<hash>-<W>x<H>.<ext>` key Sanity names the photo by, whether or not it is copied. */
export const sanityImageKey = (alias: string) =>
  `coalesce(${alias}.sanityKey, last(split(${alias}.url, '/')))`
