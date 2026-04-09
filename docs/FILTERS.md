# Filter panel

## Overview

A floating **"Filter"** button sits in the map header row alongside Kartoversikt
and Nærmeste. Clicking it opens the filter panel — a slide-in pane from the left
on desktop, a bottom sheet on mobile.

The filter panel has two conceptually distinct sections:

- **Data filters** — narrow which entities appear in both the map AND the sidebar list
- **Visningsfilter** — controls what is displayed on the map canvas only, does not
  affect the sidebar list

---

## Panel layout (top to bottom)

```
1. Organisasjoner    ← multi-select chips (data filter)
2. Distrikter        ← multi-select chips (data filter)
3. Søk               ← text search within the active selection (data filter)
4. ─────────────────
5. Visningsfilter    ← display toggles (map only)
6. ─────────────────
7. Nullstill filter  ← reset all
```

Search sits below the org/district chips because it operates *within* the current
chip selection — it narrows the already-filtered universe, not the full dataset.

---

## Data filters

### Organisasjoner

A bank of multi-select chips — one per organisation. Tapping a chip toggles it.
Multiple chips can be active simultaneously.

**Behaviour:**
- No chips active → show all locations (no org filter applied)
- One or more active → show only locations matching ANY of the selected orgs (OR logic)

**The 20 organisations derived from live data:**
```
01-SIS
02-SOE
03-Milorg
04-MTB flåten
05-MSP Marinens skøyteavdeling Petershead
06-MK Skøyter
07-NNIU - Norwegian Naval Independent Unit
08-BOAC
09-Catalina trafikken
10-Flyktninger
11-Grupper
12-Stockholm
13-Ubåtene
FO IV - MI 4
Homefleet
Hærens Overkommando i London HOK
Norge i United Kingdom
Nortraship
RAF/RCAF/RAAF/RNZAF
RNNSU Royal Norwegian Naval Special Unit
USSR
```

> These values are derived from the IndexedDB cache at runtime — never hardcoded.
> Collect all unique `organizations[]` values from the locations array on startup.

---

### Distrikter

Same chip pattern as Organisasjoner. 40+ districts — show first 10 with a
"Vis alle distrikter" expand toggle to reveal the rest.

**Behaviour:** Same as Organisasjoner — OR logic within the group.

**Districts derived from live data (40+):**
```
Milorg D11, D12, D13, D14.1, D14.2, D14.3, D15, D16.1, D16.2, D16.3,
D17, D18, D19, D20.1, D20.2, D20.3, D21, D22, D23, D24, D25, D26, D40
01-SIS-XU
02-SOE
06 Skøyter ikke organisert
A/U Patrol
ANGLO-NORWEGIAN COLLABORATING COMMITEE
Den norske regjering
Flukt
Grupper
Holland
Hurtigruten
Norge
RAF
SOVJET
Sverige
Sjur Østervold
United Kingdom
...and others
```

> Derived from the IndexedDB cache at runtime — never hardcoded.

---

### Søk

A text input. Searches by name across all entity types within the current
org/district chip selection:
- Locations
- Stations
- Events
- People

Typing updates the sidebar list and map in real time.

---

## Filter logic chain

Applied in this exact order:

```
All locations in IndexedDB
  → filter by active Organisasjoner chips (OR within group)
  → filter by active Distrikter chips (OR within group)
  → filter by Søk text (name match, case-insensitive)
  → filter by current map bounds (moveend handler)
  → sort by distance from map centre
  → paginate (cardsPerPage calculated from sidebar height)
```

Between groups the logic is AND — a location must match the selected org AND
the selected district.

---

## Visningsfilter

Controls what marker types are rendered on the map canvas. Does NOT affect the
sidebar list, search results, or pagination.

```
☑ Lokasjoner    — show/hide location markers on map
☑ Stasjoner     — show/hide station markers on map
```

**Behaviour:**
- Lokasjoner off → location markers hidden on map, sidebar list unaffected
- Stasjoner off → station markers hidden on map, sidebar list unaffected
- Both off → empty map canvas, sidebar still works normally

---

## Chip styling

```
Active chip:   background #1e3a5f  text #ffffff  border #1e3a5f
Inactive chip: background #ffffff  text #8a7a60  border #d4c9b0
Hover:         border #1e3a5f
```

**Truncation — long chip names**

Chips must not wrap internally or break the layout:
```css
.chip { max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```
Add title="{{ name }}" so hovering shows the full name as a tooltip.
Example: ANGLO-NORWEGIAN COLLABORATING COMMITEE becomes ANGLO-NORWEGIAN C...

---

## Future enhancement — context-aware chip muting

When the filter panel is open, chips that have no matching locations within the
current map bounds should appear visually muted — still selectable, but greyed
out to signal "nothing here right now."

```
Active + in bounds:   background #1e3a5f  text #ffffff
Active + out of bounds: background #1e3a5f  text #ffffff  opacity 0.5
Inactive + in bounds:  background #ffffff  text #8a7a60  border #d4c9b0
Inactive + out of bounds: background #f5f0e8  text #c4b99a  border #e0d8c8
```

Logic: on every `moveend`, for each org/district chip check whether any location
in the current bounds has that org/district. Mute chips with no matches.

This is a non-blocking enhancement — ship it after the core filter is working.

---

## Reset

**"Nullstill filter"** button at the bottom of the panel:
- Clears all active org chips
- Clears all active district chips
- Clears search text
- Resets Visningsfilter to both on
- Restores full unfiltered view

---

## Responsive behaviour

### Desktop (min-width: 768px)

- Filter panel slides in from the left, overlapping the sidebar
- Width: 320px, full viewport height, scrollable
- Organisasjoner: flat chip bank, all chips visible, wrap across panel width
- Distrikter: first 10 chips visible, Vis alle distrikter toggle reveals rest
- Backdrop click closes the panel

### Mobile (max-width: 767px)

Flat chip banks do not work on mobile — 20 orgs + 40 districts would be an
overwhelming wall of chips on a small screen.

Use the dropdown-with-checkboxes pattern on mobile instead — compact,
scrollable, familiar on touch:

  [Alle organisasjoner] tap to open scrollable checklist
  [Alle distrikter]     tap to open scrollable checklist

Selected items show a count badge on the closed dropdown:
  [02-SOE, 03-Milorg (2)]

- Filter panel appears as a bottom sheet, slides up from bottom
- Sok input full width
- Visningsfilter toggles as before
- Nullstill filter button full width at bottom
- Drag down handle or tap backdrop to close

### Summary

| Breakpoint    | Orgs/Districts UI              |
|---------------|-------------------------------|
| Desktop 768px+| Flat chip bank, wrapping       |
| Mobile <768px | Compact dropdown with checklist|

Same underlying filter logic, only the presentation differs.

---

## Search behaviour — auto-close on results

When the user submits a search (presses Enter or clicks Søk button):

**Results found:**
- Filter panel closes automatically
- Map updates to show matching locations
- Sidebar list shows matching results sorted by distance from map centre
- A subtle "Søkeresultater for: X" label appears in the sidebar header
  with a small × to clear the search and return to normal view

**No results found:**
- Filter panel stays open
- Below the search input show: "Ingen resultater funnet"
  styled in muted text — `color: #8a7a60, font-size: 12px, padding: 8px 0`
- User can modify their search or adjust filters and try again

**Clearing search:**
- × button in sidebar header clears search text
- Filter panel does not reopen — user can tap Filter if they want to search again
- Map and list return to normal bounds-filtered view

---

## URL params — shareable search state

All filter and search state is encoded in the URL via `router.replace()` on
every search commit and moveend. Sharing the URL shares everything.

| Param | Meaning | Example |
|---|---|---|
| `lat` | Map centre latitude | `58.27797` |
| `lng` | Map centre longitude | `6.68550` |
| `z` | Map zoom level | `12.0` |
| `q` | Search text | `Larsen` |
| `si` | Active search types (initials) | `l,s,e,p` |

**Search type initials:**
- `l` = Lokasjoner
- `s` = Stasjoner
- `e` = Hendelser
- `p` = Personer

**Example shareable URL:**
```
?lat=58.277&lng=6.685&z=12.0&q=Larsen&si=l,e,p
```

Omit `q` and `si` when no search is active.
Restored from URL on `onMounted` — opening the link restores the full state.

---

## Organisation chip colours

Each organisation has a colour defined in Sanity, used for map markers.
Organisation chips must use these same colours for visual consistency —
the chip you tap should match the dots that appear on the map.

Build an `orgColors` map at index time and store it in the IndexedDB cache:

```typescript
const orgColors: Record<string, string> = {}
locations.forEach(loc => {
  if (loc.color && loc.organizations) {
    loc.organizations.forEach(org => {
      if (!orgColors[org]) orgColors[org] = loc.color
    })
  }
})
cache.orgColors = orgColors
```

**Colour map from live data:**
```
01-SIS         #276a8b    02-SOE              #276a8b
03-Milorg      #0aa50a    04-MTB flåten       #047485
05-MSP         #31789b    06-MK Skøyter       #276a8b
07-NNIU        #047485    08-BOAC             #a2a00b
09-Catalina    #276a8b    10-Flyktninger      #a1166a
11-Grupper     #724a11    12-Stockholm        #7b080e
13-Ubåtene     #2f146e    FO IV - MI 4        #e9748b
Homefleet      #e38924    HOK                 #ce3f06
Norge i UK     #0aa50a    Nortraship          #24a3e3
RAF/RCAF...    #24a3e3    RNNSU               #e324cc
USSR           #276a8b
```

**Chip styling with org colour (desktop chip bank):**

```css
/* Inactive — coloured border and text, white background */
.chip {
  border: 1.5px solid {orgColor};
  color: {orgColor};
  background: #ffffff;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Active — filled with org colour, white text */
.chip.active {
  background: {orgColor};
  color: #ffffff;
  border-color: {orgColor};
}
```

Add `title="{{ org }}"` on each chip so hovering shows the full name —
important for long names like "ANGLO-NORWEGIAN COLLABORATING COMMITEE"
which should be truncated visually but readable on hover.

District chips have no colour — use the default warm palette styling.

---

## District chip colours

Districts also have colours derived from their associated locations — same
derivation pattern as organisations.

Build a `districtColors` map at index time alongside `orgColors`:

```typescript
const districtColors: Record<string, string> = {}
locations.forEach(loc => {
  if (loc.color && loc.districts) {
    loc.districts.forEach(dist => {
      if (!districtColors[dist]) districtColors[dist] = loc.color
    })
  }
})
cache.districtColors = districtColors
```

**Colour map from live data:**
```
01- SIS-XU                              #276a8b
02-SOE                                  #047485
06 Skøyter ikke organisert              #276a8b
A/U Patrol                              #24a3e3
ANGLO-NORWEGIAN COLLABORATING COMMITEE  #276a8b
Den norske regjering                    #627202
Flukt                                   #747b7e
Grupper                                 #724a11
Holland                                 #047485
Hurtigruten                             #e38924
Milorg D11                              #276a8b
Milorg D12                              #276a8b
Milorg D13                              #276a8b
Milorg D14.1                            #0aa50a
Milorg D14.2                            #276a8b
Milorg D14.3                            #0aa50a
Milorg D15                              #276a8b
Milorg D16.1                            #276a8b
Milorg D16.2                            #276a8b
Milorg D16.3                            #276a8b
Milorg D17                              #276a8b
Milorg D18                              #276a8b
Milorg D19                              #276a8b
Milorg D20.1                            #276a8b
Milorg D20.2                            #276a8b
Milorg D20.3                            #276a8b
Milorg D21                              #276a8b
Milorg D22                              #276a8b
Milorg D23                              #276a8b
Milorg D24                              #276a8b
Milorg D25                              #276a8b
Milorg D26                              #276a8b
Milorg D40                              #276a8b
Norge                                   #a1166a
RAF                                     #276a8b
SOVJET                                  #276a8b
Sverige                                 #276a8b
Sjur Østervold                          #31789b
United Kingdom                          #724a11
```

Note: most Milorg districts share the same blue (#276a8b) — this is correct,
they are all Milorg-associated. The colour reflects the dominant organisation
at those locations, not a distinct district identity.

Apply same chip styling as organisations — coloured border and text when
inactive, filled with colour when active.

---

## Cascading org → district filter

Org chips and district chips are connected. When one or more org chips are
selected, the district chips update to show only districts that exist for
those organisations.

### Build orgToDistricts map at index time

```typescript
const orgToDistricts: Record<string, string[]> = {}
locations.forEach(loc => {
  loc.organizations?.forEach(org => {
    if (!orgToDistricts[org]) orgToDistricts[org] = []
    loc.districts?.forEach(dist => {
      if (!orgToDistricts[org].includes(dist)) orgToDistricts[org].push(dist)
    })
  })
})
cache.orgToDistricts = orgToDistricts
```

### Cascading logic

```typescript
const availableDistricts = computed(() => {
  if (selectedOrgs.value.length === 0) return allDistricts
  const dists = new Set<string>()
  selectedOrgs.value.forEach(org => {
    orgToDistricts[org]?.forEach(d => dists.add(d))
  })
  return Array.from(dists).sort()
})
```

If a district chip was active but is no longer in `availableDistricts`,
deselect it automatically.

### District counts per org (from live data)

```
02-SOE          35 districts  (widest reach)
01-SIS          20 districts
10-Flyktninger  17 districts
06-MK Skøyter   16 districts
04-MTB flåten   11 districts
07-NNIU         11 districts
12-Stockholm    11 districts
03-Milorg       10 districts
05-MSP          10 districts
FO IV - MI 4     8 districts
Norge i UK       8 districts
11-Grupper       8 districts
09-Catalina      6 districts
Hærens OK HOK    5 districts
13-Ubåtene       4 districts
Nortraship       2 districts
USSR             2 districts
08-BOAC          1 district
RAF/RCAF...      1 district
RNNSU            1 district
Homefleet        1 district
```

### Apply everywhere

Same cascading logic in:
- Map filter panel
- Hendelsekatalog filter
- Any future view with org/district chips