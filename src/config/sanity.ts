export const SANITY_PROJECT_ID = import.meta.env.VITE_SANITY_PROJECT_ID as string
export const SANITY_DATASET    = import.meta.env.VITE_SANITY_DATASET    as string

const SANITY_BASE = import.meta.env.DEV
  ? '/sanity'
  : `https://${SANITY_PROJECT_ID}.apicdn.sanity.io`

export const SANITY_CDN = `${SANITY_BASE}/v2021-08-31/data/query/${SANITY_DATASET}`
export const SANITY_IMG = `https://cdn.sanity.io/images/${SANITY_PROJECT_ID}/${SANITY_DATASET}`
