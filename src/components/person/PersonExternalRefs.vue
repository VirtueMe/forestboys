<template>
  <section class="section">
    <h2 class="section-heading">Lenker<span v-if="refs.length"> ({{ refs.length }})</span></h2>
    <div v-if="refs.length" class="link-list">
      <a
        v-for="r in refs"
        :key="r.id"
        :href="r.url"
        target="_blank"
        rel="noopener noreferrer"
        class="ref-item"
      >
        <span class="ref-title">{{ r.title ?? r.url }}</span>
        <span class="ref-meta">
          <span v-if="r.nbBacked" class="ref-nb" title="Nasjonalbiblioteket">NB</span>
          <span v-if="r.domain" class="ref-domain">{{ r.domain }}</span>
        </span>
      </a>
    </div>
    <p v-else class="section-empty">Ingen lenker registrert ennå.</p>
  </section>
</template>

<script setup lang="ts">
/**
 * PersonExternalRefs — "Lenker" section: external Source nodes the
 * Person is REFERENCED_IN. Always renders the heading; shows an empty
 * note when the list is empty.
 */
export interface ExternalRef {
  id:       string
  title:    string | null
  url:      string
  type:     string
  domain:   string | null
  nbBacked: boolean
}

defineProps<{ refs: ExternalRef[] }>()
</script>

<style scoped>
.section-empty {
  margin: 0;
  padding: var(--space-xs) 0;
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-style: italic;
}

.link-list { display: flex; flex-direction: column; gap: var(--space-xs); }

.ref-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0 calc(var(--space-sm) * -1);
  text-decoration: none;
  color: var(--ink);
  border-radius: var(--radius-md);
  transition: background 120ms ease-out;
}
.ref-item:hover { background: var(--paper-sunken); }
.ref-item:hover .ref-title { color: var(--faded-red); }

.ref-title {
  font-family: var(--font-sans);
  font-size: var(--size-body-ui);
  color: var(--ink);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.ref-nb {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: var(--size-caps);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  background: var(--moss);
  color: var(--paper);
}

.ref-domain {
  font-family: var(--font-sans);
  font-size: var(--size-label);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
