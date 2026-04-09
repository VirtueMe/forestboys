export interface IdbEvent {
  _id: string
  title: string
  slug: string
  date?: string
  organization?: string
  district?: string
  thumbnailUrl?: string
}

export interface IdbGalleryImage {
  _key: string
  asset: { _ref: string }
  caption?: string
}

export interface IdbLink {
  _key: string
  title?: string
  url: string
}

export interface IdbLocation {
  _id: string
  title: string
  slug: string
  lat: number
  lng: number
  coordinates?: { lat: number; lng: number }
  thumbnailUrl?: string
  description?: string
  color?: string
  organizations?: string[]
  districts?: string[]
  events?: IdbEvent[]
  gallery?: IdbGalleryImage[]
  movie?: string
  links?: IdbLink[]
  people?: { _id: string; name: string; slug: string }[]
}

export interface IdbStation {
  _id: string
  title: string
  slug: string
  type?: string
  lat: number
  lng: number
  coordinates?: { lat: number; lng: number }
  thumbnailUrl?: string
  description?: string
  events?: IdbEvent[]
  gallery?: IdbGalleryImage[]
  movie?: string
  links?: IdbLink[]
  people?: { _id: string; name: string; slug: string }[]
}

export interface IdbPerson {
  _id: string
  name: string
  slug: string
  secretName?: string
  home?: string
  birthYear?: number
  thumbnailUrl?: string
  description?: string
  events?: IdbEvent[]
  locations?: { _id: string; title: string; slug: string }[]
  stations?: { _id: string; title: string; slug: string }[]
  outlines?: unknown[]
  gallery?: IdbGalleryImage[]
  movie?: string
  links?: IdbLink[]
}

export interface IdbOutline {
  _id: string
  title: string
  slug: string
  thumbnailUrl?: string
  description?: string
  people?: { _id: string; name: string; slug: string }[]
  gallery?: IdbGalleryImage[]
  movie?: string
  links?: IdbLink[]
}

export interface IdbTransport {
  _id: string
  name: string
  slug: string
  type?: string
  unit?: string
  regser?: string
  reserve?: string
  thumbnailUrl?: string
  description?: string
  events?: IdbEvent[]
  gallery?: IdbGalleryImage[]
  movie?: string
  links?: IdbLink[]
}

export interface IdbEventDetail {
  _id: string
  title: string
  slug: string
  date?: string
  organization?: string
  district?: string
  description?: unknown[]   // raw SanityBlock[] — not pre-flattened
  thumbnailUrl?: string
  gallery?: IdbGalleryImage[]
  links?: { _key: string; title?: string; link: string }[]
  locationFrom?: { title: string; slug: string } | null
  locationTo?: { title: string; slug: string } | null
  stationFrom?: { title: string; slug: string } | null
  stationTo?: { title: string; slug: string } | null
  people?: { name: string; slug: string }[]
  transport?: { name: string; slug: string; type: string }[]
}

export interface SavedPosition {
  lat: number
  lng: number
  savedAt: number
}

export interface SavedMapState {
  lat: number
  lng: number
  zoom: number
  savedAt: number
}

export interface IdbCache {
  version: number
  indexedAt: string
  locations: IdbLocation[]
  stations: IdbStation[]
  people: IdbPerson[]
  events: IdbEvent[]
  transport: IdbTransport[]
  outlines: IdbOutline[]
  orgColors: Record<string, string>
  districtColors: Record<string, string>
}
