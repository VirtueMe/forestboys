import { ref, computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLocationCache, fetchEventDetailBySlug } from './useLocationCache.ts'
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

export function useEventsContext() {
  const route  = useRoute()
  const router = useRouter()
  const { events, orgColors, districtColors, loading, init } = useLocationCache()

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
    const hash = route.hash?.slice(1) ?? ''
    return hash ? (events.value.find(e => e.slug === hash) ?? null) : null
  })

  const visibleEvent = computed<IdbEvent | null>(() => hashEvent.value ?? slugEvent.value)

  const isDetail = computed(() => !!slugEvent.value)

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
    if (org === curOrg && (districts as string[]).join(',') === curDist.join(',')) return
    const q: Record<string, string> = {}
    if (org) q.org = org
    if ((districts as string[]).length) q.district = (districts as string[]).join(',')
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

  watch(visibleEvent, async (event) => {
    if (!event || detailCache[event.slug]) return
    fetchingSlug.value = event.slug
    detailError.value  = false
    try {
      const detail = await fetchEventDetailBySlug(event.slug)
      if (!detail) { detailError.value = true; return }
      detailCache[event.slug] = detail
    } catch {
      detailError.value = true
    } finally {
      if (fetchingSlug.value === event.slug) fetchingSlug.value = null
    }
  }, { immediate: true })

  // ── Timeline data builder ─────────────────────────────────────────────────
  function buildTimelineData(evts: IdbEvent[]): Record<string, unknown> {
    const slugVal = (route.params.slug as string | undefined) ?? ''
    const hashVal = route.hash?.slice(1) ?? ''
    const data: Record<string, unknown> = {
      events: evts.map((e, i) => {
        const [year, month, day] = (e.date ?? '').split('-')
        const isSlug    = e.slug === slugVal
        const isHash    = e.slug === hashVal
        const showMedia = slugVal ? (isSlug || isHash) : i === 0
        return {
          unique_id:  e.slug,
          start_date: { year: year || '1940', month: month || '01', day: day || '01' },
          text:       { headline: e.title.replace(/\t/g, ' ').trim(), text: '' },
          ...(showMedia && e.thumbnailUrl
            ? { media: {
                url:       e.thumbnailUrl.replace(/\?.*$/, '') + '?h=200&fit=max&auto=format',
                thumbnail: e.thumbnailUrl,
              } }
            : {}),
          ...(slugVal
            ? { group: e.organization ?? e.district ?? '' }
            : {}),
          ...(isHash ? { background: { color: '#1e3a5f' } }
            : isSlug ? { background: { color: '#8b1a1a' } }
            : {}),
        }
      }),
    }
    return data
  }

  return {
    // cache init
    loading,
    init,
    // route context
    isDetail,
    slugEvent,
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
    // colours
    orgColor,
    // timeline
    buildTimelineData,
  }
}
