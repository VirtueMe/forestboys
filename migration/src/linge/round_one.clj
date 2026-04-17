(ns linge.round-one
  "Round-1 seed: widen the skeleton base across the full Sanity dataset.

   Output to ../data/round-1/ :
     00-organizations.cypher   23 Orgs (sort-prefix normalized)
     01-sources.cypher         NBN-URN sources from all 29 outlines' links[]
     02-ranks.cypher           unique ranks across all 3,791 persons
     03-persons.cypher         3,791 Person skeletons
     04-transports.cypher        998 Transport nodes with rawUnit candidate
     05-stations.cypher          136 Stations (scalar props only)
     06-locations.cypher       1,105 Locations (scalar props only)
     07-relationships.cypher   HELD_RANK edges for all 3,791 persons
                               (Menig default for those without rank token)

   Does NOT emit (deferred to later rounds):
   - MEMBER_OF edges (except the ones round-0 already wrote for Linge)
   - Person→Station/Location edges (semantic work needs classification)
   - USED_BY edges on Transport (raw `unit` string kept as candidate for now)
   - Any Description-derived cypher
   - Any Event-derived cypher (needs type classification first)"
  (:require [clojure.java.io :as io]
            [clojure.string  :as str]
            [linge.sanity    :as sanity]
            [linge.parse     :as parse]
            [linge.cypher    :as cy]))

(def output-dir "../data/round-1")

(defn slugify [s]
  (-> (str s) str/lower-case
      (str/replace #"æ" "ae") (str/replace #"ø" "o") (str/replace #"å" "aa")
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"(^-+|-+$)" "")))

(defn san-mig-ref [ty sanity-id field]
  (str "sanity-migration:" (name ty) ":" sanity-id ":" field))

;; ── Organizations ─────────────────────────────────────────────────────────

;; Targeted overrides for org names where Sanity's raw name should canonicalize
;; differently than plain "strip NN- prefix" logic produces. Keep the map small
;; and obvious — one entry per real collision. Extend only when new conflicts
;; appear between Sanity's form and the canonical slug Jan will want to navigate.
(def org-name-overrides
  {"NOR.I.C.1 Kompani Linge"
   {:slug "kompani-linge" :canonical "Kompani Linge"
    :cover-name "NOR.I.C.1"}})

(defn parse-org-name
  "Returns {:slug :canonical :raw :sort-prefix? :cover-name?}.
   Override table wins first; otherwise strip '03-' sort prefix; otherwise identity."
  [raw]
  (or (when-let [ov (get org-name-overrides raw)]
        (assoc ov :raw raw))
      (when-let [[_ prefix canonical] (re-matches #"(\d{1,2})-\s*(.*)" raw)]
        (let [trimmed (str/trim canonical)]
          {:slug (slugify trimmed) :canonical trimmed
           :sort-prefix prefix :raw raw}))
      {:slug (slugify raw) :canonical raw :raw raw}))

(defn org-cypher [{:keys [_id _updatedAt name color]}]
  (let [{:keys [slug canonical raw sort-prefix cover-name]} (parse-org-name name)
        hex (:hex color)]
    (cy/merge-node :Organization
                   (cond-> {:slug            slug
                            :canonicalName   canonical
                            :sanityId        _id
                            :sanityUpdatedAt _updatedAt
                            :rawName         raw}
                     sort-prefix (assoc :sortPrefix sort-prefix)
                     cover-name  (assoc :coverName  cover-name)
                     hex         (assoc :color hex)))))

(defn orgs-cypher [orgs]
  (apply str (map org-cypher orgs)))

;; ── Sources — NBN-URN citations only in round-1 ───────────────────────────
;; (YouTube, Wikipedia, spycom.org etc. come in round 2 when outlines are
;;  classified per-outline; round-1 takes only canonical book/archive refs.)

(defn extract-nbn-source [link]
  (when-let [[_ urn] (re-find #"URN:NBN:([^?&\"]+)" (or (:link link) ""))]
    (let [year (some-> (:title link) (->> (re-find #"\b(19|20)\d{2}\b")) first)]
      {:id         (str "urn-nbn-" urn)
       :identifier (str "URN:NBN:" urn)
       :title      (str/trim (or (:title link) ""))
       :type       "book"
       :url        (:link link)
       :year       year})))

(defn sources-cypher [outlines]
  (let [sources (->> outlines
                     (mapcat :links)
                     (keep extract-nbn-source)
                     (distinct))]
    (apply str
      (for [{:keys [id identifier title type url year]} sources]
        (cy/merge-node :Source
                       (cond-> {:id id :title title :type type
                                :identifier identifier :url url}
                         year (assoc :publishedDate year)))))))

;; ── Ranks — union seen across all parsed persons (+ Menig default) ────────

(defn ranks-cypher [parsed-persons]
  (let [seen (into #{"Menig"} (keep #(get-in % [:rank :canonical])) parsed-persons)]
    (apply str
      (for [canonical seen
            :let [{:keys [abbrs tier org]} (get parse/ranks canonical)]
            :when abbrs]
        (str
          (cy/merge-node :Rank
                         {:slug          (slugify canonical)
                          :canonicalName canonical
                          :abbreviation  (first abbrs)
                          :tier          tier})
          (cy/merge-edge {:from {:label :Rank         :match {:slug (slugify canonical)}}
                          :to   {:label :Organization :match {:slug org}}
                          :rel  :IN}))))))

;; ── Persons — 3,791 skeletons, serviceClass inferred from rank presence ───

(defn person-cypher
  "Emit a Person node. Only claims backed by evidence are emitted — no
   made-up 'unknown' states. Lets a prior round's better claim (e.g.,
   round-0's 'military' for Linge members based on unit membership) survive
   round-1's SET pass untouched."
  [{:keys [sanity-id sanity-updated-at canonical-name slug
           birth-year status home secret-name rank]}]
  (let [base   {:slug slug :canonicalName canonical-name
                :sanityId sanity-id :sanityUpdatedAt sanity-updated-at}
        claims (cy/merge-claims
                 (cond-> {}
                   birth-year  (assoc :birthYear
                                      {:value birth-year :state "candidate"
                                       :sourceRef (san-mig-ref :person sanity-id "birthYear")})
                   status      (assoc :status
                                      {:value (:value status) :state "candidate"
                                       :sourceRef (san-mig-ref :person sanity-id
                                                               (str "name-marker:" (:marker status)))})
                   home        (assoc :home
                                      {:value home :state "candidate"
                                       :sourceRef (san-mig-ref :person sanity-id "home")})
                   secret-name (assoc :secretName
                                      {:value secret-name :state "candidate"
                                       :sourceRef (san-mig-ref :person sanity-id "secretName")})
                   ;; Only infer serviceClass=military when a rank token was parsed from the name.
                   ;; No rank → no claim (preserves round-0's Linge-membership-based military claim).
                   rank        (assoc :serviceClass
                                      {:value "military" :state "candidate"
                                       :sourceRef (san-mig-ref :person sanity-id "rank-parsed-from-name")})))]
    (cy/merge-node :Person (merge base claims))))

(defn persons-cypher [parsed-persons]
  (apply str (map person-cypher parsed-persons)))

(defn person-rank-edges [parsed-persons]
  (apply str
    (for [{:keys [slug sanity-id rank]} parsed-persons]
      (let [[rank-slug source-ref]
            (if rank
              [(slugify (:canonical rank)) (san-mig-ref :person sanity-id "name:rank-token")]
              ["menig" (san-mig-ref :person sanity-id "default:menig-soldier-baseline")])]
        (cy/merge-edge {:from  {:label :Person :match {:slug slug}}
                        :to    {:label :Rank   :match {:slug rank-slug}}
                        :rel   :HELD_RANK
                        :props {:state "candidate" :sourceRef source-ref}})))))

;; ── Transports — scalar props + rawUnit candidate ─────────────────────────

(defn transport-cypher [{:keys [_id _updatedAt name slug type unit regser reserve]}]
  (let [base   {:slug (:current slug) :canonicalName name
                :sanityId _id :sanityUpdatedAt _updatedAt}
        claims (cy/merge-claims
                 (cond-> {}
                   type    (assoc :type    {:value type    :state "candidate"
                                            :sourceRef (san-mig-ref :transport _id "type")})
                   regser  (assoc :regser  {:value regser  :state "candidate"
                                            :sourceRef (san-mig-ref :transport _id "regser")})
                   reserve (assoc :reserve {:value reserve :state "candidate"
                                            :sourceRef (san-mig-ref :transport _id "reserve")})
                   unit    (assoc :rawUnit {:value unit    :state "candidate"
                                            :sourceRef (san-mig-ref :transport _id "unit")})))]
    (cy/merge-node :Transport (merge base claims))))

(defn transports-cypher [transports]
  (apply str (map transport-cypher transports)))

;; ── Stations ──────────────────────────────────────────────────────────────

(defn station-cypher [{:keys [_id _updatedAt title slug type coordinates]}]
  (let [base   {:slug (:current slug) :canonicalName title
                :sanityId _id :sanityUpdatedAt _updatedAt}
        claims (cy/merge-claims
                 (cond-> {}
                   type                (assoc :type {:value type :state "candidate"
                                                     :sourceRef (san-mig-ref :station _id "type")})
                   (:lat coordinates)  (assoc :lat  {:value (:lat coordinates) :state "candidate"
                                                     :sourceRef (san-mig-ref :station _id "coordinates")})
                   (:lng coordinates)  (assoc :lng  {:value (:lng coordinates) :state "candidate"
                                                     :sourceRef (san-mig-ref :station _id "coordinates")})))]
    (cy/merge-node :Station (merge base claims))))

(defn stations-cypher [stations]
  (apply str (map station-cypher stations)))

;; ── Locations ─────────────────────────────────────────────────────────────

(defn location-cypher [{:keys [_id _updatedAt title slug coordinates]}]
  (let [base   {:slug (:current slug) :canonicalName title
                :sanityId _id :sanityUpdatedAt _updatedAt}
        claims (cy/merge-claims
                 (cond-> {}
                   (:lat coordinates) (assoc :lat {:value (:lat coordinates) :state "candidate"
                                                   :sourceRef (san-mig-ref :location _id "coordinates")})
                   (:lng coordinates) (assoc :lng {:value (:lng coordinates) :state "candidate"
                                                   :sourceRef (san-mig-ref :location _id "coordinates")})))]
    (cy/merge-node :Location (merge base claims))))

(defn locations-cypher [locations]
  (apply str (map location-cypher locations)))

;; ── Orchestration ─────────────────────────────────────────────────────────

(defn build []
  (let [orgs       (sanity/load-orgs)
        persons    (sanity/load-persons)
        transports (sanity/load-transports)
        stations   (sanity/load-stations)
        locations  (sanity/load-locations)
        outlines   (sanity/load-outlines)
        parsed     (mapv parse/parse-person persons)]
    {:counts {:orgs       (count orgs)
              :persons    (count persons)
              :transports (count transports)
              :stations   (count stations)
              :locations  (count locations)}
     :parsed parsed
     :files  {"00-organizations.cypher"  (orgs-cypher orgs)
              "01-sources.cypher"        (sources-cypher outlines)
              "02-ranks.cypher"          (ranks-cypher parsed)
              "03-persons.cypher"        (persons-cypher parsed)
              "04-transports.cypher"     (transports-cypher transports)
              "05-stations.cypher"       (stations-cypher stations)
              "06-locations.cypher"      (locations-cypher locations)
              "07-relationships.cypher"  (person-rank-edges parsed)}}))

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [counts parsed]}]
  (let [by-rank (frequencies (map #(get-in % [:rank :canonical] "Menig (default)") parsed))
        status-count (count (filter :status parsed))
        flag-count   (count (filter (comp seq :flags) parsed))]
    (println "\n--- Round-1 report ---")
    (println (format "Organizations: %4d" (:orgs counts)))
    (println (format "Persons:       %4d" (:persons counts)))
    (println (format "Transports:    %4d" (:transports counts)))
    (println (format "Stations:      %4d" (:stations counts)))
    (println (format "Locations:     %4d" (:locations counts)))
    (println (format "Status markers: %4d (✝/∞)" status-count))
    (println (format "Org-flags:      %4d (NNIU/KS — no edges this round)" flag-count))
    (println "\nRank distribution (top 10):")
    (doseq [[r n] (take 10 (sort-by (comp - val) by-rank))]
      (println (format "  %4d  %s" n r)))
    (let [extra (- (count by-rank) 10)]
      (when (pos? extra)
        (println (format "  … %d more rank buckets" extra))))
    (println "\nOutput:" output-dir)))

(defn -main [& _]
  (let [r (build)]
    (write-outputs! r)
    (report r)))

(comment
  ;; REPL usage:
  (def r (build))
  (:counts r)
  (take 3 (:parsed r))
  (frequencies (map #(get-in % [:rank :canonical] "Menig") (:parsed r)))
  (keys (:files r))

  ;; Inspect a single emitted file before writing:
  (println (subs (get (:files r) "00-organizations.cypher") 0 500))

  ;; Write all output files:
  (write-outputs! r)
  (report r)

  ;; Or as a script:
  ;;   clj -M:run-1
  )
