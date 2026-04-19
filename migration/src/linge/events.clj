(ns linge.events
  "Round 3: Sanity events (2,163) → Incident nodes, plus the 41 districts
   (as Unit{type:'district'}). All structured refs preserved as graph edges:
   organization, district, locationFrom/To, stationFrom/To, people[],
   transport[]. Each event's description blob becomes a Description ABOUT
   the Incident.

   Operation classification (Incident → Operation promotion) is editorial
   work for Jan in the review UI — every Incident lands with type:'unclassified'.

   Output to ../data/round-3/ ."
  (:require [clojure.java.io :as io]
            [clojure.string  :as str]
            [cheshire.core   :as json]
            [linge.sanity    :as sanity]
            [linge.cypher    :as cy]))

(def output-dir "../data/round-3")

;; ── Slug helpers ────────────────────────────────────────────────────────

(defn slugify [s]
  (-> (str s) str/lower-case
      (str/replace #"æ" "ae") (str/replace #"ø" "o") (str/replace #"å" "aa")
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"(^-+|-+$)" "")))

;; Mirrors round_one's parse-org-name to derive the same Organization slugs
;; round-1 generated. Keeps round-3 references resolvable to round-1 nodes.
(defn parse-org-slug [raw-name]
  (if-let [[_ _ canonical] (re-matches #"(\d{1,2})-\s*(.*)" (or raw-name ""))]
    (slugify (str/trim canonical))
    (slugify raw-name)))

;; Districts may have noisy names ("Sjur Østervold" is a person, "06 Skøyter
;; ikke organisert" has a numeric prefix); we slugify whatever's there and
;; let round-4 triage move mis-categorized ones to their proper homes.
(defn district-slug [d]
  (slugify (str/trim (or (:name d) ""))))

(defn build-slug-index
  "Build a {sanity-id → slug} map for an entity collection."
  [docs slug-fn]
  (into {} (keep (fn [d]
                   (when-let [s (slug-fn d)]
                     (when (seq s) [(:_id d) s])))
                 docs)))

(defn ref-slug
  "Resolve a Sanity reference object {:_ref <id>} to a slug via the index."
  [index ref-obj]
  (when-let [rid (:_ref ref-obj)]
    (get index rid)))

(defn refs-slugs
  "Resolve a collection of Sanity references to a vector of slugs (drop missing)."
  [index refs]
  (vec (keep #(ref-slug index %) refs)))

;; ── Districts → Units ───────────────────────────────────────────────────

(defn district-cypher [d]
  (let [slug (district-slug d)]
    (cy/merge-node :Unit
                   {:slug slug
                    :canonicalName (str/trim (or (:name d) ""))
                    :type "district"
                    :sanityId (:_id d)
                    :sanityUpdatedAt (:_updatedAt d)})))

(defn districts-cypher [districts]
  (apply str (map district-cypher (filter #(seq (district-slug %)) districts))))

;; ── Events → Incidents + edges ──────────────────────────────────────────

(defn ref-edge
  "Build a single MERGE ... directional edge from incident → target.
   Returns nil when the target slug is missing (broken Sanity ref)."
  [incident-slug rel target-label target-slug & [props]]
  (when target-slug
    (cy/merge-edge {:from {:label :Incident :match {:slug incident-slug}}
                    :to   {:label target-label :match {:slug target-slug}}
                    :rel  rel
                    :props (or props {})})))

(defn person-incident-edge
  "Person -[:INVOLVED_IN]-> Incident — note the direction (Person side owns it,
   matching the Person.INVOLVED_IN sketch in the schema memory)."
  [person-slug incident-slug]
  (when person-slug
    (cy/merge-edge {:from {:label :Person   :match {:slug person-slug}}
                    :to   {:label :Incident :match {:slug incident-slug}}
                    :rel  :INVOLVED_IN
                    :props {:state "verified" :sourceRef "sanity-event-migration"}})))

(defn incident-cypher
  [{:keys [_id _updatedAt slug title date organization district
           locationFrom locationTo stationFrom stationTo people transport]}
   indexes]
  (let [s        (:current slug)
        sources  {:org-slug       (ref-slug (:orgs indexes) organization)
                  :district-slug  (ref-slug (:districts indexes) district)
                  :loc-from       (ref-slug (:locations indexes) locationFrom)
                  :loc-to         (ref-slug (:locations indexes) locationTo)
                  :stn-from       (ref-slug (:stations indexes) stationFrom)
                  :stn-to         (ref-slug (:stations indexes) stationTo)
                  :person-slugs   (refs-slugs (:persons indexes) people)
                  :transport-slugs (refs-slugs (:transports indexes) transport)}]
    (str
      ;; Incident node — type stays "unclassified" until Jan promotes it
      ;; to a specific kind (drop / arrest / sabotage / meeting / …) or
      ;; groups it under an Operation.
      (cy/merge-node :Incident
                     (cond-> {:slug s :title title :type "unclassified"
                              :sanityId _id :sanityUpdatedAt _updatedAt}
                       date (assoc :date date)))
      ;; Single-target edges
      (str (ref-edge s :ORCHESTRATED_BY :Organization (:org-slug sources)))
      (str (ref-edge s :IN_DISTRICT     :Unit         (:district-slug sources)))
      (str (ref-edge s :FROM            :Location     (:loc-from sources)))
      (str (ref-edge s :TO              :Location     (:loc-to sources)))
      (str (ref-edge s :FROM_STATION    :Station      (:stn-from sources)))
      (str (ref-edge s :TO_STATION      :Station      (:stn-to sources)))
      ;; Multi-target edges
      (apply str (map #(ref-edge s :USED :Transport %) (:transport-slugs sources)))
      (apply str (map #(person-incident-edge % s) (:person-slugs sources))))))

(defn incidents-cypher [events indexes]
  (apply str (map #(incident-cypher % indexes) events)))

(defn incident-description-cypher [{:keys [_id _updatedAt slug description]}]
  (when (seq description)
    (let [did (str "desc:event:" _id)
          s   (:current slug)]
      (str
        (cy/merge-node :Description
                       {:id did
                        :content       (json/generate-string description)
                        :recordedDate  _updatedAt
                        :author        "sanity-event-migration"
                        :confidence    "verified"
                        :sanityEventId _id})
        (cy/merge-edge {:from {:label :Description :match {:id did}}
                        :to   {:label :Incident    :match {:slug s}}
                        :rel  :ABOUT})))))

(defn descriptions-cypher [events]
  (apply str (keep incident-description-cypher events)))

;; ── Orchestration ──────────────────────────────────────────────────────

(defn build []
  (println "Loading Sanity dumps…")
  (let [events     (sanity/load-events)
        persons    (sanity/load-persons)
        locations  (sanity/load-locations)
        stations   (sanity/load-stations)
        transports (sanity/load-transports)
        orgs       (sanity/load-orgs)
        districts  (sanity/load-districts)

        indexes {:orgs       (build-slug-index orgs       #(parse-org-slug (:name %)))
                 :districts  (build-slug-index districts  district-slug)
                 :persons    (build-slug-index persons    #(get-in % [:slug :current]))
                 :locations  (build-slug-index locations  #(get-in % [:slug :current]))
                 :stations   (build-slug-index stations   #(get-in % [:slug :current]))
                 :transports (build-slug-index transports #(get-in % [:slug :current]))}

        descs (filter (comp seq :description) events)]
    {:counts {:districts          (count districts)
              :events             (count events)
              :events-with-desc   (count descs)
              :events-with-people (count (filter #(seq (:people %)) events))}
     :indexes indexes
     :files {"00-districts.cypher"   (districts-cypher districts)
             "01-incidents.cypher"   (incidents-cypher events indexes)
             "02-descriptions.cypher" (descriptions-cypher events)}}))

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [counts files]}]
  (println "\n--- Round-3 report ---")
  (println (format "Districts → Units:        %d" (:districts counts)))
  (println (format "Events → Incidents:    %5d" (:events counts)))
  (println (format "  with description:    %5d" (:events-with-desc counts)))
  (println (format "  with people refs:    %5d" (:events-with-people counts)))
  (println "\nFile sizes:")
  (doseq [[fname content] files]
    (println (format "  %-28s %10d bytes" fname (count content))))
  (println "\nOutput:" output-dir))

(defn -main [& _]
  (let [r (build)]
    (write-outputs! r)
    (report r)))

(comment
  (def r (build))
  (:counts r)
  (println (subs (get (:files r) "01-incidents.cypher") 0 600)))
