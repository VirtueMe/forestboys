/**
 * useArticleData — Neo4j data layer for an Article. An Article has no page
 * of its own: this backs ArticlePreviewBody, which the review preview
 * renders (via useProposalArticleData).
 *
 * Properties: slug, title, author, topic. Description: sections via HAS_CONTENT.
 */
import { ref } from 'vue'
import { neo4jQuery } from './useNeo4j.ts'
import type { Section } from '@/components/SectionsEditor.vue'

export interface ArticleNode {
  slug:   string
  title:  string
  author: string | null
  topic:  string | null
}

export function useArticleData() {
  const article       = ref<ArticleNode | null>(null)
  const savedSections = ref<Section[]>([])

  function resetArticle() {
    article.value       = null
    savedSections.value = []
  }

  async function loadArticle(slug: string): Promise<void> {
    try {
      const [rows, sectionRows] = await Promise.all([
        neo4jQuery<ArticleNode>(
          `MATCH (a:Article {slug: $slug})
           RETURN a.slug AS slug, a.title AS title, a.author AS author, a.topic AS topic`,
          { slug },
        ),
        neo4jQuery<{ order: number | null; content: string | null }>(
          `MATCH (:Article {slug: $slug})-[:HAS_CONTENT]->(d:Description)
           RETURN coalesce(d.order, 1) AS \`order\`, d.content AS content
           ORDER BY \`order\``,
          { slug },
        ),
      ])
      article.value       = rows[0] ?? null
      savedSections.value = sectionRows.map(r => ({
        order: r.order ?? 1, content: r.content ?? '[]', citations: [], sourcedFrom: null,
      }))
    } catch (err) {
      console.error('[useArticleData] load failed:', err)
      article.value = null
    }
  }

  return { article, savedSections, loadArticle, resetArticle }
}
