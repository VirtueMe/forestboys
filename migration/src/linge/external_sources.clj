(ns linge.external-sources
  "Round-sources: extract every links[] entry from Person/Event/Location/
   Station/Transport/Outline Sanity docs into Source nodes, plus a
   REFERENCED_IN edge from the entity to the source.

   Stats from data/sanity-*.json:
     event=3048, person=1452, transport=1164, location=311, station=211,
     outline=65 → 6,251 link entries across 418 unique domains.
     Top domains: nb.no (2,163), en.wikipedia.org (472),
     krigsseilerregisteret.no (335), youtube.com (286), no.wikipedia.org
     (180), uboat.net (173), fanger.no (171), …

   Sources deduped by URL — same URL referenced from multiple entities
   becomes one Source with multiple incoming REFERENCED_IN edges.

   Output to ../data/round-sources/ ."
  (:require [clojure.java.io :as io]
            [clojure.string  :as str]
            [linge.sanity    :as sanity]
            [linge.cypher    :as cy]))

(def output-dir "../data/round-sources")

;; ── URL → domain / id / type ────────────────────────────────────────────

(defn extract-domain [url]
  (when-let [[_ d] (re-matches #"(?i)https?://(?:www\.)?([^/?#]+).*" (or url ""))]
    (str/lower-case d)))

(defn url->id
  "Deterministic, mostly-readable id per URL: domain + slugified path,
   truncated, with an 8-char hash suffix to absorb truncation collisions
   and disambiguate URLs that differ only in query/fragment."
  [url]
  (let [domain (or (extract-domain url) "")
        path   (-> (or url "")
                   (str/replace (re-pattern (str "^https?://(?:www\\.)?" (java.util.regex.Pattern/quote domain))) "")
                   (str/replace #"\?.*$" "")
                   (str/replace #"#.*$" ""))
        body   (-> (str domain path)
                   str/lower-case
                   (str/replace #"[^a-z0-9]+" "-")
                   (str/replace #"(^-+|-+$)" ""))
        head   (subs body 0 (min 100 (count body)))
        h      (format "%08x" (Math/abs (.hashCode url)))]
    (str head "-" h)))

;; Domain → source-type map. Encyclopedic/registry domains we know;
;; everything else falls back to "website."
(def domain->type
  {"nb.no"                          "book"           ; National Library digital books
   "lokalhistoriewiki.no"           "encyclopedia"   ; NB-backed local-history wiki
   "no.wikipedia.org"               "encyclopedia"
   "en.wikipedia.org"               "encyclopedia"
   "krigsseilerregisteret.no"       "registry"       ; Norwegian war-sailor registry
   "fanger.no"                      "registry"       ; Norwegian POW registry
   "warsailors.com"                 "registry"
   "uboat.net"                      "registry"
   "scramble.no"                    "reference"
   "asn.flightsafety.org"           "registry"
   "media.digitalarkivet.no"        "archive"
   "ueaeprints.uea.ac.uk"           "academic"
   "dora.dmu.ac.uk"                 "academic"
   "youtube.com"                    "video"
   "youtu.be"                       "video"
   "vg.no"                          "newspaper"
   "nrk.no"                         "newspaper"
   "google.com"                     "map"            ; mostly Maps embeds
   "spycom.org"                     "website"        ; Helge Fykse's collection
   "pax.no"                         "publisher"})

;; Domains backed by the National Library — high trust, marked so the
;; review UI can surface them differently from random web pages.
(def nb-backed-domains
  #{"nb.no" "lokalhistoriewiki.no" "media.digitalarkivet.no" "krigsseilerregisteret.no"})

;; License + attribution per known domain. Citation (URL + title) is always
;; fine; these matter when reproducing content (paragraphs / images). The
;; default is "unknown" — the future editor should prompt Jan when he pastes
;; prose so the Source carries the right license tag.
(def domain->license
  {"lokalhistoriewiki.no" "CC-BY-SA-3.0+GFDL"   ; dual-licensed for Wikipedia compatibility
   "no.wikipedia.org"     "CC-BY-SA-4.0"
   "en.wikipedia.org"     "CC-BY-SA-4.0"
   "nb.no"                "copyright"           ; mostly in-copyright digibok scans; cite freely, don't reproduce
   "media.digitalarkivet.no" "varies"})         ; per-document — needs per-Source review

(def domain->attribution
  {"lokalhistoriewiki.no"   "Lokalhistoriewiki, Nasjonalbiblioteket"
   "no.wikipedia.org"       "Wikipedia (no)"
   "en.wikipedia.org"       "Wikipedia (en)"
   "nb.no"                  "Nasjonalbiblioteket"
   "media.digitalarkivet.no" "Arkivverket / Digitalarkivet"
   "krigsseilerregisteret.no" "Krigsseilerregisteret"
   "fanger.no"              "Fangeregisteret"})

(defn classify-domain [domain]
  (or (get domain->type domain) "website"))

;; ── Cypher emitters ────────────────────────────────────────────────────

(defn source-cypher [{:keys [id url title domain type nb-backed license attribution]}]
  (cy/merge-node :Source
                 (cond-> {:id id
                          :url url
                          :type type
                          :domain domain}
                   title              (assoc :title title)
                   (true? nb-backed)  (assoc :nbBacked true)
                   license            (assoc :license license)
                   attribution        (assoc :attribution attribution))))

(defn ref-edge [entity-label entity-key entity-val source-id]
  (cy/merge-edge {:from {:label entity-label :match {entity-key entity-val}}
                  :to   {:label :Source      :match {:id source-id}}
                  :rel  :REFERENCED_IN}))

;; ── Walk Sanity entities, extract refs ─────────────────────────────────

(defn entity-refs
  "For each entity in `docs`, yield {:entity-key entity-val :url :title}
   per links[] entry. `entity-key` is :slug for Person/Event/Location/
   Station/Transport/Outline (all use slug.current); we resolve it here."
  [docs]
  (for [d docs
        link (or (:links d) [])
        :let [url (:link link) title (:title link)
              slug (get-in d [:slug :current])]
        :when (and slug url (re-matches #"(?i)https?://.*" url))]
    {:slug slug :url url :title title}))

(defn collect-sources [refs]
  ;; Dedupe by URL; pick the longest title (best effort) when multiple
  ;; entities reference the same URL with different titles.
  (->> refs
       (group-by :url)
       (map (fn [[url group]]
              (let [domain (extract-domain url)]
                {:id          (url->id url)
                 :url         url
                 :domain      domain
                 :type        (classify-domain domain)
                 :nb-backed   (boolean (get nb-backed-domains domain))
                 :license     (get domain->license domain)
                 :attribution (get domain->attribution domain)
                 :title       (->> group (keep :title) (sort-by count >) first)})))
       (sort-by :id)))

(defn build []
  (println "Loading Sanity dumps…")
  (let [persons    (sanity/load-persons)
        events     (sanity/load-events)
        locations  (sanity/load-locations)
        stations   (sanity/load-stations)
        transports (sanity/load-transports)
        outlines   (sanity/load-outlines)

        per-entity {:Person    (entity-refs persons)
                    :Incident  (for [e events :when (:_id e)]
                                 (let [base (entity-refs [e])]
                                   ;; Events became Incidents — refs hold slug.current
                                   base))
                    :Location  (entity-refs locations)
                    :Station   (entity-refs stations)
                    :Transport (entity-refs transports)}

        all-refs (concat
                   (entity-refs persons)
                   (entity-refs events)
                   (entity-refs locations)
                   (entity-refs stations)
                   (entity-refs transports)
                   (entity-refs outlines))

        sources (collect-sources all-refs)
        url->id-map (into {} (map (juxt :url :id) sources))

        ;; Build edges per entity type. Outlines were classified into
        ;; Article/Operation/EquipmentType/Source/Unit in round 2; we emit
        ;; their REFERENCED_IN edges too, matching the target via
        ;; sanityOutlineId (set by outlines.clj on whichever node type the
        ;; outline resolved to). Description nodes share sanityOutlineId so
        ;; we exclude them explicitly.
        outline-edges-cypher
        (apply str
          (for [o outlines
                link (or (:links o) [])
                :let [url (:link link) oid (:_id o)]
                :when (and oid url (re-matches #"(?i)https?://.*" url))
                :let [src-id (url->id-map url)]
                :when src-id]
            (str "MATCH (t) WHERE t.sanityOutlineId = '" oid
                 "' AND NOT t:Description\n"
                 "MATCH (s:Source {id: '" src-id "'})\n"
                 "MERGE (t)-[:REFERENCED_IN]->(s);\n")))

        edges-cypher
        (apply str
          (concat
            (for [r (entity-refs persons)]    (ref-edge :Person    :slug (:slug r) (url->id-map (:url r))))
            (for [r (entity-refs events)]     (ref-edge :Incident  :slug (:slug r) (url->id-map (:url r))))
            (for [r (entity-refs locations)]  (ref-edge :Location  :slug (:slug r) (url->id-map (:url r))))
            (for [r (entity-refs stations)]   (ref-edge :Station   :slug (:slug r) (url->id-map (:url r))))
            (for [r (entity-refs transports)] (ref-edge :Transport :slug (:slug r) (url->id-map (:url r))))
            [outline-edges-cypher]))]

    {:counts {:total-link-entries (count all-refs)
              :unique-sources     (count sources)
              :nb-backed          (count (filter :nb-backed sources))
              :by-type            (frequencies (map :type sources))}
     :files {"00-sources.cypher"  (apply str (map source-cypher sources))
             "01-references.cypher" edges-cypher}}))

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [counts]}]
  (println "\n--- External-sources report ---")
  (println (format "Total link entries across all entities: %5d" (:total-link-entries counts)))
  (println (format "Unique Source nodes (deduped by URL):   %5d" (:unique-sources counts)))
  (println (format "  NB-backed (nb.no, lokalhistorie, etc): %5d" (:nb-backed counts)))
  (println "\nBy type:")
  (doseq [[t n] (sort-by (comp - val) (:by-type counts))]
    (println (format "  %-14s %5d" t n)))
  (println "\nOutput:" output-dir))

(defn -main [& _]
  (let [r (build)]
    (write-outputs! r)
    (report r)))

(comment
  (def r (build))
  (:counts r))
