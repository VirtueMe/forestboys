export const SANITY_PROJECT_ID = import.meta.env.VITE_SANITY_PROJECT_ID as string
export const SANITY_DATASET    = import.meta.env.VITE_SANITY_DATASET    as string

export const SANITY_IMG = `https://cdn.sanity.io/images/${SANITY_PROJECT_ID}/${SANITY_DATASET}`
