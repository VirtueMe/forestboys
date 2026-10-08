/**
 * Injection keys per detail-page data composable. The 5 detail pages
 * (`PersonDetail`, `DistrictDetail`, `OrganizationDetail`, `StationDetail`,
 * `TransportDetail`) call `inject(key, () => useXData(), true)` so they
 * default to the live composable when no provider exists, and pick up
 * a proposal-wrapped composable when one is provided by the bundle
 * preview page.
 *
 * The injected value is the full return of the corresponding composable
 * (or its proposal-wrapped equivalent — same destructure shape).
 *
 * See `docs/PROPOSALS.md` § "Controller-view preview".
 */
import type { InjectionKey } from 'vue'
import type { usePersonData }       from './usePersonData.ts'
import type { useUnitData }         from './useUnitData.ts'
import type { useOrganizationData } from './useOrganizationData.ts'
import type { useStationData }      from './useStationData.ts'
import type { useTransportData }    from './useTransportData.ts'
import type { useOutlineData }      from './useOutlineData.ts'
import type { useEventData }        from './useEventData.ts'
import type { useLocationData }     from './useLocationData.ts'
import type { useEquipmentData }    from './useEquipmentData.ts'
import type { useArticleData }      from './useArticleData.ts'
import type { useSourceData }       from './useSourceData.ts'

export const PersonDataKey:       InjectionKey<ReturnType<typeof usePersonData>>       = Symbol('PersonData')
export const UnitDataKey:         InjectionKey<ReturnType<typeof useUnitData>>         = Symbol('UnitData')
export const OrganizationDataKey: InjectionKey<ReturnType<typeof useOrganizationData>> = Symbol('OrganizationData')
export const StationDataKey:      InjectionKey<ReturnType<typeof useStationData>>      = Symbol('StationData')
export const TransportDataKey:    InjectionKey<ReturnType<typeof useTransportData>>    = Symbol('TransportData')
export const OutlineDataKey:      InjectionKey<ReturnType<typeof useOutlineData>>      = Symbol('OutlineData')
export const EventDataKey:        InjectionKey<ReturnType<typeof useEventData>>        = Symbol('EventData')
export const LocationDataKey:     InjectionKey<ReturnType<typeof useLocationData>>     = Symbol('LocationData')
export const EquipmentDataKey:    InjectionKey<ReturnType<typeof useEquipmentData>>    = Symbol('EquipmentData')
export const ArticleDataKey:      InjectionKey<ReturnType<typeof useArticleData>>      = Symbol('ArticleData')
export const SourceDataKey:       InjectionKey<ReturnType<typeof useSourceData>>       = Symbol('SourceData')

/**
 * `true` while a detail page is rendering inside a proposal preview.
 * AdminViewTabs hides itself and useDetailCreateMode skips the
 * auto-flip-to-edit so the user can't mutate live state from the modal.
 */
export const ProposalPreviewKey: InjectionKey<boolean> = Symbol('ProposalPreview')

/**
 * The slug of the entity a preview panel was given (#178). A detail page reads its entity from the URL's `:slug`; the
 * window on a bundle page (`/admin/proposals/<bundleId>`) has none, so the panel provides the slug it was opened with
 * and `useDetailSlug()` hands that to the page.
 */
export const ProposalPreviewSlugKey: InjectionKey<string> = Symbol('ProposalPreviewSlug')
