import { ref, computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLocationCache, fetchEventDetailBySlug, clearEventDetailCache } from './useLocationCache.ts'
import { cacheVersion } from './cacheFreshness.ts'
import { useEventsList, fetchEventDetailFromNeo4j } from './useEventsList.ts'
import { neo4jQuery } from './useNeo4j.ts'
import { resolveSlug } from '../utils/slugResolver.ts'
import type { IdbEvent, IdbEventDetail } from '../types/idb.ts'

// ── Fallback colour maps ──────────────────────────────────────────────────────
const ORG_COLORS: Record<string, string> = {
  '01-SIS': '#276a8b', '02-SOE': '#276a8b', '03-Milorg': '#0aa50a',
  '04-MTB flåten': '#047485', '05-MSP Marinens skøyteavdeling Petershead': '#31789b',
  '06-MK Skøyter': '#276a8b', '07-NNIU - Norwegian Naval Independent Unit': '#047485',
  '08-BOAC': '#a2a00b', '09-Catalina trafikken': '#276a8b', '10-Flyktninger': '#a1166a',
  '11-Grupper': '#724a11', '12-Stockholm': '#7b080e', '13-Ubåtene': '#2f146e',
  'FO IV - MI 4': '#e9748b', 'Homefleet': '#e38924',
  'Hærens Overkommando i London HOK': '#ce3f06', 'Norge i United Kingdom': '#0aa50a',
  'Nortraship': '#24a3e3', 'RAF/RCAF/RAAF/RNZAF': '#24a3e3',
  'RNNSU  Royal Norwegian Naval Special Unit ': '#e324cc', 'USSR': '#276a8b',
}

const DISTRICT_COLORS: Record<string, string> = {
  '01- SIS-XU': '#276a8b', '02-SOE': '#047485', '06 Skøyter ikke organisert': '#276a8b',
  'A/U Patrol': '#24a3e3', 'ANGLO-NORWEGIAN COLLABORATING COMMITEE': '#276a8b',
  'Den norske regjering': '#627202', 'Flukt': '#747b7e', 'Grupper': '#724a11',
  'Holland': '#047485', 'Hurtigruten': '#e38924',
  'Milorg D11': '#276a8b', 'Milorg D12': '#276a8b', 'Milorg D13': '#276a8b',
  'Milorg D14.1': '#0aa50a', 'Milorg D14.2': '#276a8b', 'Milorg D14.3': '#0aa50a',
  'Milorg D15': '#276a8b', 'Milorg D16.1': '#276a8b', 'Milorg D16.2': '#276a8b',
  'Milorg D16.3': '#276a8b', 'Milorg D17': '#276a8b', 'Milorg D18': '#276a8b',
  'Milorg D19': '#276a8b', 'Milorg D20.1': '#276a8b', 'Milorg D20.2': '#276a8b',
  'Milorg D20.3': '#276a8b', 'Milorg D21': '#276a8b', 'Milorg D22': '#276a8b',
  'Milorg D23': '#276a8b', 'Milorg D24': '#276a8b', 'Milorg D25': '#276a8b',
  'Milorg D26': '#276a8b', 'Milorg D40': '#276a8b', 'Norge': '#a1166a',
  'RAF': '#276a8b', 'SOVJET': '#276a8b', 'Sverige': '#276a8b',
  'Sjur Østervold': '#31789b', 'United Kingdom': '#724a11',
}

// ─────────────────────────────────────────────────────────────────────────────

/** The event slug in `#<slug>`. A `key=value` hash (`#proposal=<bundleId>`) belongs to
 *  someone else — the proposal panel — and is not an event. */
export function eventHash(hash: string | undefined): string {
  const h = hash?.slice(1) ?? ''
  return h.includes('=') ? '' : h
}

export function useEventsContext() {
  const route  = useRoute()
  const router = useRouter()
  // Events list now comes from Neo4j; orgColors/districtColors stay
  // sourced from the Sanity-derived cache for now.
  const { orgColors, districtColors } = useLocationCache()
  const { events, loading, init, renameEvent: renameEventRow } = useEventsList()

  // ── Colours ───────────────────────────────────────────────────────────────
  function orgColor(name: string): string {
    return orgColors.value[name] ?? ORG_COLORS[name] ?? '#666'
  }

  const districtColorMap = computed<Record<string, string>>(() => {
    const map: Record<string, string> = { ...DISTRICT_COLORS }
    for (const [k, v] of Object.entries(districtColors.value)) map[k] = v
    return map
  })

  // ── Route-derived context ─────────────────────────────────────────────────
  const slugEvent = computed<IdbEvent | null>(() => {
    const slug = route.params.slug as string | undefined
    return slug ? (events.value.find(e => e.slug === slug) ?? null) : null
  })

  const hashEvent = computed<IdbEvent | null>(() => {
    const hash = eventHash(route.hash)
    return hash ? (events.value.find(e => e.slug === hash) ?? null) : null
  })

  const visibleEvent = computed<IdbEvent | null>(() => hashEvent.value ?? slugEvent.value)

  const isDetail = computed(() => !!slugEvent.value)

  // The URL names a slug that is no event. Most such links are written a little
  // differently from their page, or mean a person or a vessel: send the reader
  // where the link meant to go, or, when no single page fits, say it was not found
  // instead of quietly showing the whole list.
  const slugNotFound = ref<string | null>(null)
  watch([() => route.params.slug, () => route.hash, loading], async ([slug, hash, isLoading]) => {
    slugNotFound.value = null
    if (typeof slug !== 'string' || !slug || hash === '#new' || isLoading || slugEvent.value) return
    try {
      const hit = await resolveSlug(slug, neo4jQuery)
      if (route.params.slug !== slug) return          // the reader went elsewhere meanwhile
      if (hit && hit.path !== route.path) void router.replace({ path: hit.path, query: route.query })
      else if (!hit) slugNotFound.value = slug
    } catch {
      if (route.params.slug === slug) slugNotFound.value = slug
    }
  }, { immediate: true })

  // ── List filter state (URL-synced) ────────────────────────────────────────
  const selectedOrg       = ref((route.query.org as string) ?? '')
  const selectedDistricts = ref<string[]>(
    route.query.district ? (route.query.district as string).split(',').filter(Boolean) : [],
  )
  const searchQuery = ref('')

  watch(selectedOrg, () => { selectedDistricts.value = [] })

  watch([selectedOrg, selectedDistricts], ([org, districts]) => {
    const curOrg  = (route.query.org as string) ?? ''
    const curDist = route.query.district
      ? (route.query.district as string).split(',').filter(Boolean)
      : []
    if (org === curOrg && (districts).join(',') === curDist.join(',')) return
    const q: Record<string, string> = {}
    if (org) q.org = org
    if ((districts).length) q.district = (districts).join(',')
    void router.push({ path: '/events', query: q })
  })

  watch(() => route.query, (q) => {
    selectedOrg.value       = (q.org as string) ?? ''
    selectedDistricts.value = q.district
      ? (q.district as string).split(',').filter(Boolean)
      : []
  }, { immediate: true })

  // ── Detail filter state (initialised from slug event) ─────────────────────
  const detailOrg       = ref('')
  const detailDistricts = ref<string[]>([])
  let skipDetailCascade = false

  watch(slugEvent, (ev) => {
    skipDetailCascade = true
    detailOrg.value       = ev?.organization ?? ''
    detailDistricts.value = ev?.district ? [ev.district] : []
    skipDetailCascade = false
  }, { immediate: true })

  watch(detailOrg, () => {
    if (skipDetailCascade) return
    detailDistricts.value = []
  })

  // ── Option lists ──────────────────────────────────────────────────────────
  const allOrgs = computed<string[]>(() => {
    const set = new Set<string>()
    for (const e of events.value) if (e.organization) set.add(e.organization)
    return [...set].sort()
  })

  const orgDistrictMap = computed<Record<string, Set<string>>>(() => {
    const map: Record<string, Set<string>> = {}
    for (const e of events.value) {
      if (!e.organization) continue
      if (!map[e.organization]) map[e.organization] = new Set()
      if (e.district) map[e.organization].add(e.district)
    }
    return map
  })

  function districtsFor(org: string): string[] {
    return org
      ? [...(orgDistrictMap.value[org] ?? [])].sort()
      : [...new Set(Object.values(orgDistrictMap.value).flatMap(s => [...s]))].sort()
  }

  // ── Active filter accessors — single API regardless of mode ──────────────
  const org = computed(() => isDetail.value ? detailOrg.value : selectedOrg.value)

  const districts = computed(() => isDetail.value ? detailDistricts.value : selectedDistricts.value)

  function setOrg(v: string) {
    if (isDetail.value) detailOrg.value = v; else selectedOrg.value = v
  }

  function setDistricts(v: string[]) {
    if (isDetail.value) detailDistricts.value = v; else selectedDistricts.value = v
  }

  const availableDistricts = computed(() => districtsFor(org.value))

  const hasFilter = computed(() =>
    searchQuery.value.length > 0 ||
    (!isDetail.value && (!!selectedOrg.value || selectedDistricts.value.length > 0)),
  )

  function resetFilters() {
    searchQuery.value = ''
    if (!isDetail.value) {
      selectedOrg.value       = ''
      selectedDistricts.value = []
    }
  }

  // ── Filtered events (drives timeline and list) ────────────────────────────
  const filteredEvents = computed<IdbEvent[]>(() => {
    if (isDetail.value) {
      let r = events.value
      if (detailOrg.value)            r = r.filter(e => e.organization === detailOrg.value)
      if (detailDistricts.value.length) r = r.filter(e => detailDistricts.value.includes(e.district ?? ''))
      if (searchQuery.value.length >= 2) {
        const q = searchQuery.value.toLowerCase()
        r = r.filter(e => e.title.toLowerCase().includes(q))
      }
      return r
    }
    let r = events.value
    if (selectedOrg.value)       r = r.filter(e => e.organization === selectedOrg.value)
    if (selectedDistricts.value.length) r = r.filter(e => selectedDistricts.value.includes(e.district ?? ''))
    if (searchQuery.value.length >= 2) {
      const q = searchQuery.value.toLowerCase()
      r = r.filter(e => e.title.toLowerCase().includes(q))
    }
    return r
  })

  // ── Event detail fetch ────────────────────────────────────────────────────
  const detailCache  = reactive<Record<string, IdbEventDetail>>({})
  const fetchingSlug = ref<string | null>(null)
  const detailError  = ref(false)

  const visibleDetail = computed<IdbEventDetail | null>(() =>
    visibleEvent.value ? detailCache[visibleEvent.value.slug] ?? null : null,
  )

  const loadingDetail = computed(() =>
    !!visibleEvent.value && !visibleDetail.value && fetchingSlug.value === visibleEvent.value.slug,
  )

  /** `force` reloads even when the detail is already held (after an admin save). */
  async function loadDetail(event: IdbEvent, force = false): Promise<void> {
    if (detailCache[event.slug] && !force) return
    fetchingSlug.value = event.slug
    detailError.value  = false
    try {
      // Prefer Neo4j; fall back to Sanity-IDB if Neo4j has no entry.
      let detail = await fetchEventDetailFromNeo4j(event.slug)
      if (!detail) {
        try { detail = await fetchEventDetailBySlug(event.slug) }
        catch { detail = null }
      }
      if (!detail) { detailError.value = true; return }
      detailCache[event.slug] = detail
    } catch {
      detailError.value = true
    } finally {
      if (fetchingSlug.value === event.slug) fetchingSlug.value = null
    }
  }

  watch(visibleEvent, (event) => { if (event) void loadDetail(event) }, { immediate: true })

  // An admin saved something: drop the details held for other events and
  // reload the open one in place (the old text stays up until the new arrives).
  watch(cacheVersion, () => {
    clearEventDetailCache()
    const open = visibleEvent.value
    for (const slug of Object.keys(detailCache)) if (slug !== open?.slug) delete detailCache[slug]
    if (open) void loadDetail(open, true)
  })

  /**
   * Re-key a renamed event in both caches. `slugEvent` resolves the URL
   * slug against the cached list, so a rename leaves the new URL pointing
   * at nothing — isDetail goes false and the whole detail block unmounts,
   * error branch included. Carrying the detail across too avoids a refetch
   * of data the rename didn't change.
   */
  function renameEvent(oldSlug: string, newSlug: string): void {
    if (oldSlug === newSlug) return
    renameEventRow(oldSlug, newSlug)
    const cached = detailCache[oldSlug]
    if (cached) {
      detailCache[newSlug] = { ...cached, slug: newSlug, _id: newSlug }
      delete detailCache[oldSlug]
    }
  }

  return {
    // cache init
    loading,
    init,
    // route context
    isDetail,
    slugEvent,
    slugNotFound,
    visibleEvent,
    // filter API (single surface, mode-aware internally)
    org,
    districts,
    setOrg,
    setDistricts,
    availableDistricts,
    allOrgs,
    districtColorMap,
    searchQuery,
    hasFilter,
    resetFilters,
    // data
    filteredEvents,
    // detail
    visibleDetail,
    loadingDetail,
    detailError,
    renameEvent,
    // colours
    orgColor,
    // timeline
  }
}
