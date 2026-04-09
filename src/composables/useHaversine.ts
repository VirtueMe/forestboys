const R = 6371 // Earth radius in km

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function useHaversine() {
  function sortByDistance<T extends { lat: number; lng: number }>(
    items: T[],
    from: { lat: number; lng: number },
  ): T[] {
    return [...items].sort(
      (a, b) =>
        haversineKm(from.lat, from.lng, a.lat, a.lng) -
        haversineKm(from.lat, from.lng, b.lat, b.lng),
    )
  }

  return { sortByDistance, haversineKm }
}
