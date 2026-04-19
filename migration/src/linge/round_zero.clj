(ns linge.round-zero
  "Orchestrate the round-0 seed for the Kompani Linge vertical prototype.

   Emits Cypher to ../data/round-0/ :
     00-organizations.cypher — SOE, Kompani Linge (PART_OF SOE), Hæren, RAF, Marinen
     01-sources.cypher       — 4 NBN URN books + sanity-migration pseudo-source
     02-ranks.cypher         — unique ranks seen in the 272 Linge members
     03-persons.cypher       — 272 Person nodes with scalar claims
     04-relationships.cypher — MEMBER_OF (Linge) and HELD_RANK edges

   Port of scripts/round-0-importer.ts — reference implementation in TypeScript."
  (:require [clojure.java.io :as io]
            [clojure.string  :as str]
            [linge.sanity    :as sanity]
            [linge.parse     :as parse]
            [linge.cypher    :as cy]))

(def output-dir "../data/round-0")

(defn slugify [s]
  (-> (str s)
      str/lower-case
      (str/replace #"æ" "ae")
      (str/replace #"ø" "o")
      (str/replace #"å" "aa")
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"(^-+|-+$)" "")))

(defn san-mig-ref [sanity-id field]
  (str "sanity-migration:person:" sanity-id ":" field))

;; ────────────────────────────────────────────────────────────────────────────
;; Emitters per section.

(defn orgs-cypher []
  (str
    (cy/merge-node :Organization
                   {:slug "soe" :canonicalName "SOE" :type "allied-agency" :country "UK"
                    :foundedDate "1940-07-22" :dissolvedDate "1946-01-15"})
    ;; Kompani Linge is a Unit (a SOE-formation), not an Organization.
    ;; Units nest recursively via PART_OF; the type property ("company",
    ;; "troop", "team", "patrol", "squadron", "flotilla", "cell", "district")
    ;; discriminates scale.
    (cy/merge-node :Unit
                   {:slug "kompani-linge" :canonicalName "Kompani Linge" :type "company"
                    :country "UK-NO" :color "#e35c24"
                    :foundedDate    "1940-08-01"
                    :dissolvedDate  "1945-11-15"
                    :names [{:value "Norwegian Independent Company 1" :type "formal"
                             :language "en" :period "1941–1945" :context "SOE"}
                            {:value "NOR.I.C.1"     :type "formal-cover" :language "en"}
                            {:value "Kompani Linge" :type "primary"      :language "no"}]})
    (cy/merge-edge {:from {:label :Unit         :match {:slug "kompani-linge"}}
                    :to   {:label :Organization :match {:slug "soe"}}
                    :rel  :PART_OF})
    (cy/merge-node :Organization {:slug "haeren"  :canonicalName "Hæren"  :type "military-branch" :country "NO"})
    (cy/merge-node :Organization {:slug "raf"     :canonicalName "RAF"    :type "military-branch" :country "UK"})
    (cy/merge-node :Organization {:slug "marinen" :canonicalName "Marinen" :type "military-branch" :country "NO"})

    ;; Manual curated external reference for Kompani Linge.
    ;; lokalhistoriewiki.no/Kompani_Linge documents the unit's history and
    ;; — most importantly — the list of fallen members. NB-backed source.
    ;; Future review-pass: each Person's `status: KIA` claim can have its
    ;; sourceRef upgraded from "sanity-migration:...name-marker:✝" to point
    ;; at this URL with a per-person fragment.
    (cy/merge-node :Source
                   {:id "lokalhistoriewiki-kompani-linge"
                    :url "https://lokalhistoriewiki.no/wiki/Kompani_Linge"
                    :title "Kompani Linge — Lokalhistoriewiki"
                    :type "encyclopedia"
                    :domain "lokalhistoriewiki.no"
                    :nbBacked true
                    :license "CC-BY-SA-3.0+GFDL"
                    :attribution "Lokalhistoriewiki, Nasjonalbiblioteket"})
    (cy/merge-edge {:from {:label :Unit   :match {:slug "kompani-linge"}}
                    :to   {:label :Source :match {:id "lokalhistoriewiki-kompani-linge"}}
                    :rel  :REFERENCED_IN})))

(defn sources-cypher [linge]
  (apply str
    (cy/merge-node :Source {:id "sanity-migration" :title "Sanity migration 2026-04-17"
                            :type "migration-origin"
                            :note "Synthetic source for round-0 auto-extracted claims."})
    (for [link (:links linge)
          :let [urn-match (re-find #"URN:NBN:([^?&]+)" (:link link ""))
                year-match (re-find #"\b(19|20)\d{2}\b" (:title link ""))]
          :when urn-match]
      (cy/merge-node :Source
                     {:id           (str "urn-nbn-" (second urn-match))
                      :title        (str/trim (:title link ""))
                      :type         "book"
                      :identifier   (str "URN:NBN:" (second urn-match))
                      :publishedDate (when year-match (first year-match))
                      :url          (:link link)}))))

(defn ranks-cypher [parsed]
  ;; Include Menig so defaults have a target, plus every rank actually parsed.
  (let [seen (into #{"Menig"} (keep #(get-in % [:rank :canonical])) parsed)]
    (apply str
      (for [canonical seen
            :let [{:keys [abbrs tier org]} (get parse/ranks canonical)]]
        (str
          (cy/merge-node :Rank {:slug (slugify canonical) :canonicalName canonical
                                :abbreviation (first abbrs) :tier tier})
          (cy/merge-edge {:from {:label :Rank         :match {:slug (slugify canonical)}}
                          :to   {:label :Organization :match {:slug org}}
                          :rel  :IN}))))))

(defn person-cypher [{:keys [sanity-id sanity-updated-at canonical-name slug
                             birth-year status home secret-name]}]
  (let [base-props {:slug slug :canonicalName canonical-name
                    :sanityId sanity-id :sanityUpdatedAt sanity-updated-at}
        claims     (cy/merge-claims
                     (cond-> {:birthYear (if birth-year
                                           {:value birth-year :state "candidate"
                                            :sourceRef (san-mig-ref sanity-id "birthYear")}
                                           {:state "unknown"})
                              ;; All Linge members are military by definition of the unit.
                              :serviceClass {:value "military" :state "candidate"
                                             :sourceRef "linge-outline-membership"}}
                       status    (assoc :status
                                        {:value (:value status) :state "candidate"
                                         :sourceRef (san-mig-ref sanity-id (str "name-marker:" (:marker status)))})
                       (not status) (assoc :status {:state "unknown"})
                       home      (assoc :home
                                        {:value home :state "candidate"
                                         :sourceRef (san-mig-ref sanity-id "home")})
                       secret-name (assoc :secretName
                                          {:value secret-name :state "candidate"
                                           :sourceRef (san-mig-ref sanity-id "secretName")})))]
    (cy/merge-node :Person (merge base-props claims))))

(defn persons-cypher [parsed]
  (apply str (map person-cypher parsed)))

(defn rels-cypher [parsed]
  (apply str
    (for [{:keys [slug sanity-id rank]} parsed]
      (let [[rank-slug source-ref]
            (if rank
              [(slugify (:canonical rank)) (san-mig-ref sanity-id "name:rank-token")]
              ;; Default: ordinary soldier, no rank token in name
              ["menig" (san-mig-ref sanity-id "default:menig-soldier-baseline")])]
        (str
          (cy/merge-edge {:from {:label :Person :match {:slug slug}}
                          :to   {:label :Unit :match {:slug "kompani-linge"}}
                          :rel  :MEMBER_OF
                          :props {:state "verified" :sourceRef "linge-outline-membership"}})
          (cy/merge-edge {:from {:label :Person :match {:slug slug}}
                          :to   {:label :Rank   :match {:slug rank-slug}}
                          :rel  :HELD_RANK
                          :props {:state "candidate" :sourceRef source-ref}}))))))

;; ────────────────────────────────────────────────────────────────────────────
;; Orchestration.

(defn build []
  (let [outlines (sanity/load-outlines)
        persons  (sanity/load-persons)
        linge    (sanity/find-linge-outline outlines)
        members  (sanity/linge-members outlines persons)
        parsed   (mapv parse/parse-person members)]
    {:linge    linge
     :parsed   parsed
     :files    {"00-organizations.cypher" (orgs-cypher)
                "01-sources.cypher"       (sources-cypher linge)
                "02-ranks.cypher"         (ranks-cypher parsed)
                "03-persons.cypher"       (persons-cypher parsed)
                "04-relationships.cypher" (rels-cypher parsed)}}))

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [parsed]}]
  (let [by-rank (frequencies (map #(get-in % [:rank :canonical] "Menig (default)") parsed))
        status-count (count (filter :status parsed))
        flag-count   (count (filter (comp seq :flags) parsed))]
    (println "\n--- Round-0 report ---")
    (println "Persons:     " (count parsed))
    (println "With status: " status-count " (✝/∞)")
    (println "With flags:  " flag-count " (NNIU/KS — round-1 work)")
    (println "\nRank distribution (parsed from name, except 'Menig (default)'):")
    (doseq [[r n] (sort-by (comp - val) by-rank)]
      (println (format "  %3d  %s" n r)))
    (println "\nOutput:" output-dir)))

(defn -main [& _]
  (let [result (build)]
    (write-outputs! result)
    (report result)))

(comment
  ;; REPL usage — build and inspect without writing files:
  (def r (build))
  (count (:parsed r))                    ; 272
  (frequencies (map :status (:parsed r))) ; see marker distribution
  (take 3 (:parsed r))                    ; sample parses

  ;; Write outputs:
  (write-outputs! r)
  (report r)

  ;; Or run as script:
  ;; $ clj -M:run
  )
