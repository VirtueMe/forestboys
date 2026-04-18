(ns linge.export-pages
  "Export Page / Card / Description bundles as JSON by querying Neo4j directly.

   Neo4j is the authoritative store after round-1.5. Once Jan's editor UX
   lands, edits live ONLY in Neo4j — this export must reflect them, so we
   query the DB rather than re-parse Sanity dumps. Uses Neo4j's built-in
   HTTP Transactional API so no Bolt driver dep is required."
  (:require [clojure.java.io :as io]
            [cheshire.core   :as json]))

(def neo4j-url  "http://localhost:7474/db/neo4j/tx/commit")
(def neo4j-auth (str "Basic "
                     (.encodeToString (java.util.Base64/getEncoder)
                                      (.getBytes "neo4j:localdev"))))
(def output-dir "../public/pages")

;; ── HTTP query helper — returns row maps keyed by RETURN column names ────

(defn query [cypher]
  (let [body (json/generate-string {:statements [{:statement cypher}]})
        conn ^java.net.HttpURLConnection
             (doto (.openConnection (java.net.URL. neo4j-url))
               (.setRequestMethod "POST")
               (.setRequestProperty "Content-Type"  "application/json")
               (.setRequestProperty "Authorization" neo4j-auth)
               (.setDoOutput true))]
    (with-open [out (.getOutputStream conn)]
      (.write out (.getBytes body "UTF-8")))
    (let [resp    (with-open [in (.getInputStream conn)] (slurp in))
          parsed  (json/parse-string resp true)
          errors  (:errors parsed)]
      (when (seq errors)
        (throw (ex-info "Neo4j query errors" {:errors errors :cypher cypher})))
      (let [result  (first (:results parsed))
            columns (:columns result)]
        (for [row (:data result)]
          (zipmap (map keyword columns) (:row row)))))))

;; ── Query: every card for every page, with its description + hero image ──

(def pages-query
  "MATCH (p:Page)-[:HAS_CARD]->(c:Card)
   OPTIONAL MATCH (c)-[:HAS_CONTENT]->(d:Description)
   OPTIONAL MATCH (c)-[:HAS_HERO_IMAGE]->(s:Source)
   RETURN p.slug AS pageSlug, p.title AS pageTitle, p.author AS pageAuthor,
          p.updatedAt AS pageUpdatedAt,
          c.id AS cardId, c.section AS section, c.sectionOrder AS sectionOrder,
          c.title AS cardTitle, c.type AS cardType,
          d.content AS descContent,
          s.url AS heroImageUrl
   ORDER BY p.slug, c.section, c.sectionOrder")

;; ── Row → Card bundle shape ──────────────────────────────────────────────

(defn row->card [row]
  (let [blocks (when (:descContent row)
                 (json/parse-string (:descContent row) true))]
    (cond-> {:id           (:cardId row)
             :section      (:section row)
             :sectionOrder (:sectionOrder row)
             :content      (or blocks [])}
      (:cardTitle row)    (assoc :title        (:cardTitle row))
      (:cardType row)     (assoc :type         (:cardType row))
      (:heroImageUrl row) (assoc :heroImageUrl (:heroImageUrl row)))))

(defn rows->bundles [rows]
  (for [[page-slug page-rows] (group-by :pageSlug rows)
        :let [first-row (first page-rows)]]
    {:slug      page-slug
     :title     (:pageTitle first-row)
     :author    (:pageAuthor first-row)
     :updatedAt (:pageUpdatedAt first-row)
     :sections  (into (sorted-map)
                      (map (fn [[section rs]]
                             [section (mapv row->card rs)])
                           (group-by :section page-rows)))}))

(defn build []
  (rows->bundles (query pages-query)))

(defn write-outputs! [bundles]
  (.mkdirs (io/file output-dir))
  (doseq [b bundles]
    (spit (io/file output-dir (str (:slug b) ".json"))
          (json/generate-string b {:pretty true}))))

(defn -main [& _]
  (let [bundles (build)]
    (if (empty? bundles)
      (println "No Page nodes found in Neo4j. Run `clj -M:run-1-5` + import first.")
      (do
        (write-outputs! bundles)
        (doseq [b bundles]
          (let [card-count (reduce + (map count (vals (:sections b))))
                sections   (keys (:sections b))]
            (println (format "Wrote %s/%s.json  — sections: %s  cards: %d"
                             output-dir (:slug b)
                             (pr-str (vec sections))
                             card-count))))))))

(comment
  ;; REPL usage:
  (def rows (query pages-query))
  (count rows)                    ; one row per Card (8 expected)
  (first rows)                    ; row structure check
  (def bundles (build))
  (-> bundles first :sections keys)
  (write-outputs! bundles))
