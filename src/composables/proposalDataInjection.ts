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

export const PersonDataKey:       InjectionKey<ReturnType<typeof usePersonData>>       = Symbol('PersonData')
export const UnitDataKey:         InjectionKey<ReturnType<typeof useUnitData>>         = Symbol('UnitData')
export const OrganizationDataKey: InjectionKey<ReturnType<typeof useOrganizationData>> = Symbol('OrganizationData')
export const StationDataKey:      InjectionKey<ReturnType<typeof useStationData>>      = Symbol('StationData')
export const TransportDataKey:    InjectionKey<ReturnType<typeof useTransportData>>    = Symbol('TransportData')
export const OutlineDataKey:      InjectionKey<ReturnType<typeof useOutlineData>>      = Symbol('OutlineData')
export const EventDataKey:        InjectionKey<ReturnType<typeof useEventData>>        = Symbol('EventData')
export const LocationDataKey:     InjectionKey<ReturnType<typeof useLocationData>>     = Symbol('LocationData')

/**
 * `true` while a detail page is rendering inside a proposal preview.
 * AdminViewTabs hides itself and useDetailCreateMode skips the
 * auto-flip-to-edit so the user can't mutate live state from the modal.
 */
export const ProposalPreviewKey: InjectionKey<boolean> = Symbol('ProposalPreview')
