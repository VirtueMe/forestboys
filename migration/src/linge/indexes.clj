(ns linge.indexes
  "Constraints + indexes for Neo4j. Idempotent (IF NOT EXISTS) so it's safe
   to re-run any time. Run after the structure is in place via:
       clj -M:indexes

   Two layers:
     (1) UNIQUE constraints on identifier properties — auto-create indexes
         and enforce slug/id uniqueness so MERGE-by-identifier is correct.
     (2) Range/composite indexes on properties used in WHERE/ORDER BY,
         so list queries stay sub-millisecond as the graph grows
         (especially Incident once round 3 lands its 2k+ nodes).

   Output: cypher only — `clj -M:indexes` writes data/round-indexes/00-indexes.cypher
   and pipes it straight at Neo4j via the import pattern used elsewhere."
  (:require [clojure.java.io :as io]))

(def output-dir "../data/round-indexes")

;; ── Unique-id constraints (auto-create lookup indexes) ──────────────────

(def slug-types
  ["Person" "Unit" "Organization" "Operation" "Location" "Station"
   "Transport" "Article" "EquipmentType" "Rank" "Page" "Incident"])

(def id-types
  ["Card" "Description" "Source"])

(defn unique-constraint [label prop]
  (let [name (str (clojure.string/lower-case label) "_" (clojure.string/lower-case prop) "_unique")]
    (str "CREATE CONSTRAINT " name " IF NOT EXISTS "
         "FOR (n:" label ") REQUIRE n." prop " IS UNIQUE;\n")))

(def unique-constraints
  (str
    (apply str (map #(unique-constraint % "slug") slug-types))
    (apply str (map #(unique-constraint % "id")   id-types))))

;; ── Range / composite indexes on commonly filtered/ordered properties ───

(def range-indexes
  (str
    ;; Unit.type — used in `WHERE c.type = 'course'` and similar
    "CREATE INDEX unit_type IF NOT EXISTS FOR (n:Unit) ON (n.type);\n"
    ;; Composite for course-list queries: filter by type then ORDER BY order
    "CREATE INDEX unit_type_order IF NOT EXISTS FOR (n:Unit) ON (n.type, n.order);\n"
    ;; Card.section — Pages group cards by section
    "CREATE INDEX card_section IF NOT EXISTS FOR (n:Card) ON (n.section);\n"
    ;; Source.type — Registre filters citation-worthy sources
    "CREATE INDEX source_type IF NOT EXISTS FOR (n:Source) ON (n.type);\n"
    ;; Person.canonicalName — list ORDER BY name
    "CREATE INDEX person_canonical_name IF NOT EXISTS FOR (n:Person) ON (n.canonicalName);\n"
    ;; Incident.date — once round 3 lands, every event/timeline view filters by date
    "CREATE INDEX incident_date IF NOT EXISTS FOR (n:Incident) ON (n.date);\n"
    ;; Description.recordedDate — pages/units pick most-recent description
    "CREATE INDEX description_recorded_date IF NOT EXISTS FOR (n:Description) ON (n.recordedDate);\n"))

(defn build []
  {:files {"00-indexes.cypher"
           (str unique-constraints
                "\n"
                range-indexes)}})

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn -main [& _]
  (write-outputs! (build))
  (println "Wrote" output-dir "/00-indexes.cypher"))
