(ns linge.outlines
  "Round 2: classify the 29 Sanity `outline` documents into their proper target
   types — Unit, Operation, EquipmentType, Source, Article. Linge was already
   done in round 0 (as a Unit now). Planeter + EUREKA kml integrations are a
   separate round-2.1 concern.

   Output to ../data/round-2/ :
     00-parent-orgs.cypher     any parent Organizations not yet in the graph
                               (British Commandos, USAAF, COSSAC, Regjeringen)
     01-units.cypher           9 Units (Linge skipped — already in round 0)
     02-operations.cypher      5 Operations
     03-equipment.cypher       3 EquipmentTypes (OLGA, BERIT, EUREKA+Rebecca)
     04-sources.cypher         2 Sources
     05-articles.cypher        Essay/article-shaped outlines → Article nodes
     06-descriptions.cypher    Descriptions ABOUT the migrated targets"
  (:require [clojure.java.io :as io]
            [clojure.string  :as str]
            [cheshire.core   :as json]
            [linge.sanity    :as sanity]
            [linge.cypher    :as cy]))

(def output-dir "../data/round-2")

(defn slugify [s]
  (-> (str s) str/lower-case
      (str/replace #"æ" "ae") (str/replace #"ø" "o") (str/replace #"å" "aa")
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"(^-+|-+$)" "")))

;; ── Classification table ────────────────────────────────────────────────
;; Each entry describes how to migrate one Sanity outline document into the
;; graph. `title-match` is a regex (or exact string contains) matched against
;; outline.title. `kind` decides the target node type.
;;
;; Jan-verification tasks are left for a future review pass; for now each
;; created node carries a migrationCategory claim with state=candidate so
;; Jan can see which ones came from automated classification and flip them
;; if wrong.

(def classifications
  [;; ── Units (belong to a parent Organization) ────────────────────────
   ;; Linge's Unit node already exists from round 0 with its rich names[] and color.
   ;; We re-run it as :unit here so the outline's Description gets attached and the
   ;; sanityOutlineId ref is stored; MERGE-by-slug preserves untouched round-0 props.
   ;; canonical-name must be explicit here — the outline's title ("N.O.R.I.C.(1) (LINGE)
   ;; Medlemmer") isn't the clean canonical form we want showing in UI.
   {:match "N.O.R.I.C" :kind :unit :slug "kompani-linge" :canonical-name "Kompani Linge" :type "company" :parent-org "soe" :transform-blocks :strip-course-list}
   ;; KP F had dual reporting lines — administratively a Norwegian Army unit
   ;; under HOK, operationally attached to SOE for training and mission tasking.
   ;; The `:parents` form creates one PART_OF edge per entry with metadata that
   ;; drives the UI's parent chips + info markers.
   {:match "Norwegian Parachute" :kind :unit :slug "kp-f" :type "company"
    :parents [{:org "haerens-overkommando-i-london-hok" :role "administrative" :order 1}
              {:org "soe" :role "operational" :order 2
               :description "KP F var operativt tilknyttet SOE for trening og oppdragsgivning, men administrativt underlagt Hærens Overkommando (HOK) som del av den norske hæren."
               :source-refs ["editorial:jan-warberg:2026-04-19"]}]}
   {:match "No. 5 Troop"        :kind :unit :slug "no-5-troop-10-ia-commandos" :type "troop" :parent-org "british-commandos"}
   {:match "Balchen"             :kind :unit :slug "balchen-bernt-projects" :type "task-force" :parent-org "usaaf"}
   {:match "Eksportgruppe  Torsvik"     :kind :unit :slug "eksportgruppe-torsvik"     :type "cell" :parent-org "sis"}
   {:match "Eksportgruppe Skytterholm"  :kind :unit :slug "eksportgruppe-skytterholm" :type "cell" :parent-org "sis"}
   {:match "Eksportgruppe Walle"        :kind :unit :slug "eksportgruppe-walle"       :type "cell" :parent-org "sis"}
   {:match "Eksportgruppe Kvalen"       :kind :unit :slug "eksportgruppe-kvalen"      :type "cell" :parent-org "sis"}
   {:match "Eksportgruppe Nielsen"      :kind :unit :slug "eksportgruppe-nielsen"     :type "cell" :parent-org "sis"}
   {:match #"^EXPORT grupper"           :kind :unit :slug "eksportgruppene"           :type "network" :parent-org "sis"}
   {:match "Norwegian Defence Committee" :kind :unit :slug "norwegian-defence-committee-1942" :type "committee" :parent-org "regjeringen"}
   {:match "COSSAC"                      :kind :unit :slug "cossac" :type "allied-command" :parent-org "shaef"}

   ;; ── Operations ─────────────────────────────────────────────────────
   {:match "POLAR BEAR"      :kind :operation :slug "operasjon-polar-bear"   :orchestrated-by "soe"}
   {:match "BUKKEN BRUSE"    :kind :operation :slug "operasjon-bukken-bruse" :orchestrated-by "soe"
    :names [{:value "BUKKEN BRUSE" :type "primary" :language "no"}
            {:value "ANTIPODES"    :type "code-name" :language "en"}]}
   {:match "FOSCOTT"         :kind :operation :slug "operasjon-foscott"     :orchestrated-by "soe"}
   {:match "CLAIRVOYANT"     :kind :operation :slug "operasjon-clairvoyant" :orchestrated-by "soe"}
   {:match "De hvite bussene" :kind :operation :slug "de-hvite-bussene"     :orchestrated-by "swedish-red-cross"}

   ;; ── EquipmentType ──────────────────────────────────────────────────
   {:match #"^OLGA"  :kind :equipment :slug "olga"  :eq-type "radio" :subtype "agent-radio" :country "NO"}
   {:match #"^BERIT" :kind :equipment :slug "berit" :eq-type "radio" :subtype "agent-radio" :country "NO"}
   {:match #"^EUREKA" :kind :equipment :slug "eureka" :eq-type "navigation" :subtype "ground-transponder" :country "UK"
    :paired-with "rebecca"}

   ;; ── Sources ────────────────────────────────────────────────────────
   {:match "Granlund rapport"          :kind :source :slug "granlund-rapport-1942"
    :src-type "report" :publishedDate "1942-04-15"
    :authorFreeText "Sverre Granlund"}
   {:match "Report Operation CLAYMORE" :kind :source :slug "report-claymore-london-tribune-1948"
    :src-type "newspaper" :publishedDate "1948-06-23"
    :authorFreeText "London Tribune"}

   ;; ── Articles (essay / reference / humor / technical) ───────────────
   {:match "Code names"              :kind :article :slug "code-names"                  :topic "reference"}
   {:match "Do's & Dont's"           :kind :article :slug "dos-and-donts"               :topic "conduct"}
   {:match "Okkupasjonshumor"        :kind :article :slug "okkupasjonshumor"            :topic "cultural"}
   {:match "Radiosendinger"          :kind :article :slug "radiosendinger-i-krigsaarene" :topic "reference"}
   {:match "HLD drops"               :kind :article :slug "hld-drops"                   :topic "technique"}
   {:match "Convoy oversikter"       :kind :article :slug "convoy-oversikter"           :topic "reference"}

   ;; ── Composite (handled separately in round-2.1 with kml data) ──────
   {:match "PLANETER OG BASER"       :kind :skip-composite}])

(defn classify-outline [outline]
  (let [title (:title outline "")]
    (some (fn [rule]
            (let [m (:match rule)]
              (when (cond
                      (string? m)        (str/includes? title m)
                      (instance? java.util.regex.Pattern m) (re-find m title))
                rule)))
          classifications)))

;; ── Parent Organizations that may be new (not in prior rounds) ──────────

(def parent-orgs-cypher
  "Parent orgs referenced by Units above. Some already exist (SOE, SIS via
   round-1 numbered orgs). These are the new ones round-2 introduces."
  (str
    (cy/merge-node :Organization {:slug "british-commandos"
                                  :canonicalName "British Commandos"
                                  :type "military-branch" :country "UK"})
    (cy/merge-node :Organization {:slug "usaaf"
                                  :canonicalName "USAAF"
                                  :type "military-branch" :country "US"
                                  :foundedDate "1941-06-20" :dissolvedDate "1947-09-18"})
    (cy/merge-node :Organization {:slug "shaef"
                                  :canonicalName "SHAEF"
                                  :type "allied-command" :country "UK"
                                  :foundedDate "1943-12-01" :dissolvedDate "1945-07-14"
                                  :names "[{\"value\":\"Supreme Headquarters Allied Expeditionary Force\",\"type\":\"formal\",\"language\":\"en\"}]"})
    (cy/merge-node :Organization {:slug "swedish-red-cross"
                                  :canonicalName "Svenska Röda Korset"
                                  :type "humanitarian" :country "SE"})
    (cy/merge-node :Organization {:slug "regjeringen"
                                  :canonicalName "Den norske regjering i London"
                                  :type "government" :country "NO"})))

;; ── Per-target-type emitters ────────────────────────────────────────────

(defn desc-id [outline-id] (str "desc:outline:" outline-id))

(defn block-text [block]
  (->> (:children block [])
       (map #(or (:text %) ""))
       (apply str)))

(defn strip-course-list-blocks
  "Remove course-table scaffolding from Linge's outline blocks:
     - the 'Oversikt over kursene' section header
     - the column-header row (Oppst / Ser / Ant / Høyest / Mangl / Gruppe)
     - all numbered-list rows (the 30 courses themselves)
   The course data lives in Unit{type:\"course\"} nodes now (round 2.1),
   so the prose version is redundant noise."
  [blocks]
  (remove (fn [b]
            (let [text (block-text b)]
              (or (= "number" (:listItem b))
                  (re-find #"(?i)oversikt over kursene" text)
                  ;; Column-header line: contains Oppst + Høyest + Gruppe together.
                  (and (re-find #"(?i)oppst"  text)
                       (re-find #"(?i)høyest" text)
                       (re-find #"(?i)gruppe" text)))))
          blocks))

(def transforms
  "Named block transformers selectable from the classification table."
  {:strip-course-list strip-course-list-blocks})

(defn outline-description-cypher [outline target-label target-slug id-key transform-key]
  (let [raw-blocks  (:description outline)
        transform   (get transforms transform-key identity)
        blocks      (transform raw-blocks)
        did    (desc-id (:_id outline))
        match-key (or id-key :slug)]
    (when (and (seq blocks) target-slug)
      (str
        (cy/merge-node :Description
                       {:id did
                        :content       (json/generate-string blocks)
                        :recordedDate  (:_updatedAt outline)
                        :author        "sanity-outline-migration"
                        :confidence    "verified"
                        :sanityOutlineId (:_id outline)})
        (cy/merge-edge {:from {:label :Description :match {:id did}}
                        :to   {:label target-label  :match {match-key target-slug}}
                        :rel  :ABOUT})))))

;; Parent resolution:
;;   :parent-org "soe"                        — legacy single-parent shorthand
;;   :parents [{:org "hok" :role "administrative" :order 1}
;;             {:org "soe" :role "operational"    :order 2
;;              :description "…"
;;              :source-refs ["editorial:jan-warberg:2026-04-19"]}]
;;     — one PART_OF edge per entry with metadata (role, description, order,
;;     sourceRefs). Target label is currently :Organization; extend to :Unit
;;     when needed.
(defn- unit-parent-edges [slug {:keys [parent-org parents]}]
  (let [entries (cond
                  (seq parents) parents
                  parent-org    [{:org parent-org}]
                  :else         [])]
    (apply str
      (for [{:keys [org role description order source-refs]} entries]
        (cy/merge-edge {:from {:label :Unit         :match {:slug slug}}
                        :to   {:label :Organization :match {:slug org}}
                        :rel  :PART_OF
                        :props (cond-> {}
                                 role         (assoc :role role)
                                 description  (assoc :description description)
                                 order        (assoc :order order)
                                 (seq source-refs) (assoc :sourceRefs source-refs))})))))

(defn unit-cypher [outline classification]
  (let [{:keys [slug type names canonical-name]} classification]
    (str
      (cy/merge-node :Unit
                     (cond-> {:slug slug
                              :canonicalName (or canonical-name (:title outline))
                              :type type
                              :sanityOutlineId (:_id outline)
                              :sanityUpdatedAt (:_updatedAt outline)}
                       names (assoc :names (json/generate-string names))))
      (unit-parent-edges slug classification))))

(defn operation-cypher [outline {:keys [slug orchestrated-by names]}]
  (str
    (cy/merge-node :Operation
                   (cond-> {:slug slug
                            :codeName (:title outline)
                            :sanityOutlineId (:_id outline)
                            :sanityUpdatedAt (:_updatedAt outline)
                            :status "unknown"}
                     names (assoc :names (json/generate-string names))))
    (when orchestrated-by
      (cy/merge-edge {:from {:label :Operation    :match {:slug slug}}
                      :to   {:label :Organization :match {:slug orchestrated-by}}
                      :rel  :ORCHESTRATED_BY}))))

(defn equipment-cypher [outline {:keys [slug eq-type subtype country paired-with]}]
  (let [pair-slug paired-with]
    (str
      (cy/merge-node :EquipmentType
                     (cond-> {:slug slug
                              :canonicalName (:title outline)
                              :type eq-type
                              :sanityOutlineId (:_id outline)
                              :sanityUpdatedAt (:_updatedAt outline)}
                       subtype (assoc :subtype subtype)
                       country (assoc :country country)))
      ;; If paired, materialize the partner EquipmentType and a symmetric edge.
      (when pair-slug
        (str
          (cy/merge-node :EquipmentType
                         {:slug pair-slug
                          :canonicalName (str/capitalize pair-slug)
                          :type "navigation"
                          :subtype "airborne-receiver"
                          :country "UK"
                          :names (json/generate-string
                                   [{:value (str/capitalize pair-slug) :type "primary" :language "en"}
                                    ;; Norwegian sources sometimes spell with k
                                    {:value (str/capitalize (str/replace pair-slug "cc" "ck"))
                                     :type "variant" :language "no"}])})
          (cy/merge-edge {:from {:label :EquipmentType :match {:slug slug}}
                          :to   {:label :EquipmentType :match {:slug pair-slug}}
                          :rel  :PAIRED_WITH}))))))

(defn source-cypher [outline {:keys [slug src-type publishedDate authorFreeText]}]
  (cy/merge-node :Source
                 (cond-> {:id slug
                          :title (:title outline)
                          :type src-type
                          :sanityOutlineId (:_id outline)}
                   publishedDate  (assoc :publishedDate publishedDate)
                   authorFreeText (assoc :authorFreeText authorFreeText))))

(defn article-cypher [outline {:keys [slug topic]}]
  (cy/merge-node :Article
                 {:slug slug
                  :title (:title outline)
                  :topic topic
                  :sanityOutlineId (:_id outline)
                  :sanityUpdatedAt (:_updatedAt outline)
                  :author "jan"}))

;; ── Orchestration ──────────────────────────────────────────────────────

(defn migrate-outline [outline]
  (when-let [rule (classify-outline outline)]
    (let [{:keys [kind slug]} rule
          base (case kind
                 :skip-linge     {:outline outline :rule rule}
                 :skip-composite {:outline outline :rule rule}
                 :unit       {:outline outline :rule rule :node-cypher (unit-cypher outline rule)      :label :Unit          :slug slug}
                 :operation  {:outline outline :rule rule :node-cypher (operation-cypher outline rule) :label :Operation     :slug slug}
                 :equipment  {:outline outline :rule rule :node-cypher (equipment-cypher outline rule) :label :EquipmentType :slug slug}
                 ;; Source uses :id not :slug — and outline-description-cypher expects a label+slug,
                 ;; so we adapt the matching key when emitting descriptions.
                 :source     {:outline outline :rule rule :node-cypher (source-cypher outline rule)    :label :Source        :slug slug :id-key :id}
                 :article    {:outline outline :rule rule :node-cypher (article-cypher outline rule)   :label :Article       :slug slug})]
      (assoc base :transform-blocks (:transform-blocks rule)))))

(defn build []
  (let [outlines (sanity/load-outlines)
        migrated (mapv migrate-outline outlines)
        unclassified (->> outlines
                          (filter #(nil? (classify-outline %)))
                          (map :title))
        by-kind (group-by #(get-in % [:rule :kind]) (filter some? migrated))

        units      (by-kind :unit       [])
        operations (by-kind :operation  [])
        equipment  (by-kind :equipment  [])
        sources    (by-kind :source     [])
        articles   (by-kind :article    [])]
    {:outlines  outlines
     :migrated  (filter some? migrated)
     :unclassified unclassified
     :counts {:total          (count outlines)
              :units          (count units)
              :operations     (count operations)
              :equipment      (count equipment)
              :sources        (count sources)
              :articles       (count articles)
              :skipped-linge     (count (filter #(= :skip-linge     (get-in % [:rule :kind])) migrated))
              :skipped-composite (count (filter #(= :skip-composite (get-in % [:rule :kind])) migrated))
              :unclassified   (count unclassified)}
     :files {"00-parent-orgs.cypher"   parent-orgs-cypher
             "01-units.cypher"         (apply str (map :node-cypher units))
             "02-operations.cypher"    (apply str (map :node-cypher operations))
             "03-equipment.cypher"     (apply str (map :node-cypher equipment))
             "04-sources.cypher"       (apply str (map :node-cypher sources))
             "05-articles.cypher"      (apply str (map :node-cypher articles))
             "06-descriptions.cypher"  (apply str
                                             (keep (fn [{:keys [outline label slug id-key transform-blocks]}]
                                                     (outline-description-cypher outline label slug id-key transform-blocks))
                                                   (filter :node-cypher migrated)))}}))

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [counts unclassified]}]
  (println "\n--- Round-2 report ---")
  (println (format "Outlines total:     %d" (:total counts)))
  (println (format "  Units:            %d" (:units counts)))
  (println (format "  Operations:       %d" (:operations counts)))
  (println (format "  EquipmentType:    %d" (:equipment counts)))
  (println (format "  Sources:          %d" (:sources counts)))
  (println (format "  Articles:         %d" (:articles counts)))
  (println (format "  Skipped (Linge):  %d" (:skipped-linge counts)))
  (println (format "  Skipped (Planeter):%d" (:skipped-composite counts)))
  (println (format "  Unclassified:     %d" (:unclassified counts)))
  (when (seq unclassified)
    (println "\n  Unclassified outlines:")
    (doseq [t unclassified] (println "   -" t)))
  (println "\nOutput:" output-dir))

(defn -main [& _]
  (let [r (build)]
    (write-outputs! r)
    (report r)))

(comment
  (def r (build))
  (:counts r)
  (:unclassified r))
