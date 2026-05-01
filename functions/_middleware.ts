/**
 * Pages Functions root middleware. Pass-through; placeholder for future
 * cross-cutting concerns. The BundleEventsDO durable object lives in
 * the sibling Worker `workers/bundle-events/` (Pages can't host DO
 * classes itself), bound here via `script_name` in wrangler.toml.
 */

export const onRequest: PagesFunction = (ctx) => ctx.next()
