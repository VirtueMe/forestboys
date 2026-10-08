/**
 * Comments on a bundle in R2 (#186): one object per comment, `proposals/bundles/<id>/comments/<id>.json`, so two editors on
 * the same bundle never collide. `type` and `entityId` are also the object's custom metadata, so one listing gives the
 * count of every thread with no body read. The shape and the checks are in src/utils/bundleComments.ts; docs/PROPOSALS.md,
 * «Comments».
 */

import type { EventActor } from '../../src/utils/bundleEvents.ts'
import type { BundleComment, CommentRef, CommentType } from '../../src/utils/bundleComments.ts'

export const commentsPrefix = (bundleId: string) => `proposals/bundles/${bundleId}/comments/`
export const commentKey     = (bundleId: string, id: string) => `${commentsPrefix(bundleId)}${id}.json`

/** `<ts>-<rand>`: sorts by time, and two comments in the same millisecond still get two names. */
export const newCommentId = (at: string) => `${at}-${crypto.randomUUID().slice(0, 4)}`

function metadataOf(c: Pick<BundleComment, 'type' | 'entityId'>): Record<string, string> {
  return { type: c.type, ...(c.entityId ? { entityId: c.entityId } : {}) }
}

/** Write one comment. `If-None-Match: *`: a name that happens to collide is never overwritten. */
export async function writeComment(
  bucket: R2Bucket, bundleId: string, actor: EventActor, input: { type: CommentType; entityId?: string; text: string },
  at = new Date().toISOString(),
): Promise<BundleComment> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const comment: BundleComment = { id: newCommentId(at), type: input.type, ...(input.entityId ? { entityId: input.entityId } : {}), at, actor, text: input.text }
    const put = await bucket.put(commentKey(bundleId, comment.id), JSON.stringify(comment), {
      httpMetadata:   { contentType: 'application/json' },
      customMetadata: metadataOf(comment),
      onlyIf:         { etagDoesNotMatch: '*' },
    })
    if (put) return comment
  }
  throw new Error(`writeComment: no free name for a comment on ${bundleId}`)
}

/** The refs of a bundle's comments from one listing with the metadata (no body read), oldest first. */
export async function listCommentRefs(bucket: R2Bucket, bundleId: string): Promise<CommentRef[]> {
  const prefix = commentsPrefix(bundleId)
  const refs: CommentRef[] = []
  let cursor: string | undefined
  do {
    const listing = await bucket.list({ prefix, cursor, include: ['customMetadata'] })
    for (const o of listing.objects) {
      const m = o.customMetadata ?? {}
      if (m.type !== 'bundle' && m.type !== 'entity') continue
      refs.push({ id: o.key.slice(prefix.length).replace(/\.json$/, ''), type: m.type, ...(m.entityId ? { entityId: m.entityId } : {}) })
    }
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
  return refs.sort((a, b) => a.id.localeCompare(b.id))
}

/** The bodies of one thread: the bundle's, or one entity's. Only these are read. */
export async function readThread(
  bucket: R2Bucket, bundleId: string, refs: CommentRef[], scope: { type: 'bundle' } | { type: 'entity'; entityId: string },
): Promise<BundleComment[]> {
  const wanted = refs.filter(r => r.type === scope.type && (scope.type === 'bundle' || r.entityId === scope.entityId))
  const comments = await Promise.all(wanted.map(async (r) => {
    const obj = await bucket.get(commentKey(bundleId, r.id))
    return obj ? await obj.json<BundleComment>() : null
  }))
  return comments.filter((c): c is BundleComment => c !== null)
}
