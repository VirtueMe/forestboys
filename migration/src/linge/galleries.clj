(ns linge.galleries
  "Round-galleries: walk each entity's gallery[] in Sanity, create
   Source{type:photograph} nodes (deduped by Sanity asset ref) and add
   HAS_IMAGE edges from the entity. URLs point at the Sanity CDN; R2
   migration is deferred and will rewrite the URL property in place.

   Coverage (8,141 of 8,395 raw images — outlines deferred):
     event:     3,214 images on 2,088 events     → Incident HAS_IMAGE Source
     person:    2,511 images on 1,227 persons    → Person HAS_IMAGE Source
     transport: 1,681 images on 918 transports   → Transport HAS_IMAGE Source
     location:    539 images on 185 locations    → Location HAS_IMAGE Source
     station:     196 images on 92 stations      → Station HAS_IMAGE Source

   Output to ../data/round-galleries/ ."
  (:require [clojure.java.io :as io]
            [clojure.string  :as str]
            [linge.sanity    :as sanity]
            [linge.cypher    :as cy]))

(def output-dir "../data/round-galleries")
(def sanity-cdn "https://cdn.sanity.io/images/7r6kqtqy/production")

;; ── Asset-ref → URL ─────────────────────────────────────────────────────
;; Sanity asset refs look like `image-{hash}-{WxH}-{ext}`. The CDN path is
;; `{hash}-{WxH}.{ext}`. We strip the prefix + remap the trailing -ext to .ext.

(defn asset-ref->url [asset-ref]
  (when asset-ref
    (when-let [[_ id dims ext] (re-matches #"image-([a-f0-9]+)-(\d+x\d+)-(\w+)" asset-ref)]
      (str sanity-cdn "/" id "-" dims "." ext))))

(defn source-id [asset-ref] (str "img:sanity:" asset-ref))

;; ── Per-entity gallery extraction ───────────────────────────────────────

(defn entity-images
  "For one entity, return [{:slug :asset-ref :url :caption :order}, ...]
   one entry per gallery item."
  [doc slug-fn]
  (let [slug    (slug-fn doc)
        gallery (or (:gallery doc) [])]
    (when slug
      (for [[idx item] (map-indexed vector gallery)
            :let [asset-ref (get-in item [:asset :_ref])
                  url       (asset-ref->url asset-ref)]
            :when (and asset-ref url)]
        {:slug slug
         :asset-ref asset-ref
         :url url
         :caption (:caption item)
         :order (inc idx)}))))

(defn collect-entity [docs slug-fn]
  (mapcat #(entity-images % slug-fn) docs))

(defn slug-current [doc] (get-in doc [:slug :current]))

;; ── Cypher emission ─────────────────────────────────────────────────────

;; Source (photograph) node properties:
;;   :id             — synthetic source ID (img:sanity:<asset-ref>)
;;   :type           — 'photograph' (vs book, archive, etc. on non-image Sources)
;;   :url            — CDN URL (Sanity today; R2 after future migration)
;;   :sanityAssetRef — original Sanity asset reference (for re-derivation)
;;   :kind           — intrinsic photo category: 'portrait' | 'group' | 'action'
;;                     | 'scene' | 'document' | 'artifact' | 'uniform' | 'landscape'
;;                     (absent = unclassified). Set editorially post-migration.
;;                     Used by hero selection and future search/filter.
(defn source-cypher [{:keys [asset-ref url]}]
  (cy/merge-node :Source
                 {:id (source-id asset-ref)
                  :type "photograph"
                  :url url
                  :sanityAssetRef asset-ref}))

;; HAS_IMAGE edge properties:
;;   :order   — gallery position on the attachment entity
;;   :caption — per-edge caption (may differ across entities for the same Source)
;;   :scope   — 'entity'   → pin image to this attachment only, don't propagate
;;                           to related entities (e.g. a private/sensitive
;;                           portrait visible on the Person page only, not on
;;                           every Unit they were a member of)
;;              'propagate' / absent → default: image surfaces in aggregate
;;                           galleries via graph traversal
;;   :isHero  — boolean. When true, this attachment is the hero image on the
;;              entity's page. Edge-scoped (not on Source) because the same
;;              photo can be the hero on Person X's page but just a gallery
;;              entry on an Incident page. At most one `isHero = true` per
;;              entity is a UI convention (not enforced in the graph).
;;
;; Hero-selection rule (frontend):
;;   1. Direct HAS_IMAGE with isHero = true  →  use that Source
;;   2. Else direct Source with kind = 'portrait'  →  first by :order
;;   3. Else first direct image by :order  (Sanity convention: gallery[0] ≈ portrait)
;;
;; This migration does NOT emit :scope, :isHero, or Source.kind — all defaults
;; apply. Editors set these via the (future) CMS post-migration.
(defn image-edge-cypher [entity-label {:keys [slug asset-ref order caption]}]
  (cy/merge-edge {:from {:label entity-label :match {:slug slug}}
                  :to   {:label :Source      :match {:id (source-id asset-ref)}}
                  :rel  :HAS_IMAGE
                  :props (cond-> {:order order}
                           (and caption (string? caption) (seq caption))
                           (assoc :caption caption))}))

(defn unique-sources-cypher [all-images]
  (->> all-images
       (group-by :asset-ref)
       (map (comp first val))
       (sort-by :asset-ref)
       (map source-cypher)
       (apply str)))

(defn edges-cypher [pairs-by-label]
  (apply str
    (for [[label pairs] pairs-by-label
          p pairs]
      (image-edge-cypher label p))))

;; ── Orchestration ──────────────────────────────────────────────────────

(defn build []
  (println "Loading Sanity dumps…")
  (let [events     (sanity/load-events)
        persons    (sanity/load-persons)
        locations  (sanity/load-locations)
        stations   (sanity/load-stations)
        transports (sanity/load-transports)

        ;; Each entity collection → list of {:slug :asset-ref :url :caption :order}
        per-label {:Incident  (collect-entity events     slug-current)
                   :Person    (collect-entity persons    slug-current)
                   :Location  (collect-entity locations  slug-current)
                   :Station   (collect-entity stations   slug-current)
                   :Transport (collect-entity transports slug-current)}

        all-images (apply concat (vals per-label))
        unique-by-ref (count (set (map :asset-ref all-images)))]
    {:counts (into {:total-image-edges (count all-images)
                    :unique-sources    unique-by-ref}
                   (for [[label pairs] per-label]
                     [(keyword (str/lower-case (name label))) (count pairs)]))
     :files {"00-sources.cypher" (unique-sources-cypher all-images)
             "01-edges.cypher"   (edges-cypher per-label)}}))

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [counts files]}]
  (println "\n--- Galleries report ---")
  (println (format "Total HAS_IMAGE edges:       %5d" (:total-image-edges counts)))
  (println (format "Unique image Source nodes:   %5d" (:unique-sources counts)))
  (println "\nEdges per entity type:")
  (doseq [k [:incident :person :transport :location :station]]
    (println (format "  %-12s %5d" (name k) (get counts k 0))))
  (println "\nFile sizes:")
  (doseq [[fname content] files]
    (println (format "  %-22s %10d bytes" fname (count content))))
  (println "\nOutput:" output-dir))

(defn -main [& _]
  (let [r (build)]
    (write-outputs! r)
    (report r)))

(comment
  (def r (build))
  (:counts r))
