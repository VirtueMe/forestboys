(ns linge.courses
  "Round 2.1: migrate Kompani Linge's 30 training courses from the outline's
   course table. Each Course is a Unit{type:\"course\"} PART_OF Kompani Linge.

   Data sourced from outline 'N.O.R.I.C.(1) (LINGE) Medlemmer' — the
   'Oversikt over kursene' section.

   Course → destination group (Gruppe column) becomes a FEEDS_INTO edge
   toward an Organization / Unit / Operation. Creates the SHETLAND
   detachment Unit en route (Shetlandsgjengen / Shetland Bus).

   Output to ../data/round-2.1/ ."
  (:require [clojure.java.io :as io]
            [linge.cypher    :as cy]))

(def output-dir "../data/round-2.1")

;; ── Course data table ────────────────────────────────────────────────────
;; [letter, start-month, start-year, students, highest-serial, missing, target-group]
;; target-group values: :haeren :shetland :linge :linge-shetland :haer-linge :polarbear
;; (or nil when the outline table left it blank).
;;
;; Start dates are best-effort from the Sanity source. YYYY-MM when the month
;; is given; nil when the outline didn't record one.

(def courses
  [["A"   "04" "1941" 14 14 0 nil]
   ["B"   nil  nil    17 19 2 nil]
   ["C"   "05" "1941" 21 21 0 nil]
   ["D"   "01" "1943" 12 13 1 :haeren]
   ["E"   "03" "1942"  6  7 1 :shetland]
   ["F"   "03" "1943" 25 25 0 :linge-shetland]
   ["FA"  "03" "1942" 15 17 2 :shetland]
   ["G"   nil  nil    15 15 0 nil]
   ["H"   "08" "1941" 20 21 1 nil]
   ["I"   "10" "1941" 19 21 2 nil]
   ["K"   nil  nil    26 26 0 nil]
   ["L"   nil  nil    28 28 0 nil]
   ["M"   "12" "1941" 26 26 0 nil]
   ["N"   nil  nil    19 19 0 nil]
   ["P"   nil  nil    21 23 2 nil]
   ["Q"   nil  nil    16 16 0 nil]
   ["R"   "05" "1942" 18 18 0 nil]
   ["S"   "07" "1942" 15 15 0 nil]
   ["T"   "10" "1942" 12 12 0 nil]
   ["U"   nil  nil     7  8 2 nil]
   ["Y"   "06" "1943" 20 20 0 :linge]
   ["Z"   nil  nil    45 49 4 :haeren]
   ["X"   nil  nil    72 73 1 nil]           ; "Flere" in source — multi-batch
   ["AA"  "09" "1944" 25 25 0 nil]           ; 9/10-44
   ["CC"  "12" "1944" 13 13 0 nil]
   ["ZA"  nil  nil    19 19 0 :haer-linge]
   ["ZB"  nil  nil    22 22 0 :haeren]
   ["ZY"  nil  nil    20 21 1 :polarbear]
   ["DD"  "02" "1945" 15 15 0 :haeren]
   ["EE"  "02" "1945" 14 14 3 nil]])          ; 12/2-45

(def target-group->edge
  "Destination group → {:label :match} for the FEEDS_INTO edge target."
  {:haeren        {:label :Organization :match {:slug "haeren"}}
   :shetland      {:label :Unit         :match {:slug "shetland-bus"}}
   :linge         {:label :Unit         :match {:slug "kompani-linge"}}
   :polarbear     {:label :Operation    :match {:slug "operasjon-polar-bear"}}
   ;; Split destinations — emit an edge to the PRIMARY target only; secondary
   ;; can surface later in review. Jan can add the second edge manually.
   :linge-shetland {:label :Unit         :match {:slug "kompani-linge"}}
   :haer-linge    {:label :Organization :match {:slug "haeren"}}})

(defn course-slug [letter]
  (str "linge-course-" (clojure.string/lower-case letter)))

(defn course-cypher
  "Emit a Course Unit + PART_OF edge + optional FEEDS_INTO edge.
   `order` is a 1-based sort key derived from the row position in the source
   table — generic numeric order scales beyond letter-based naming schemes."
  [order [letter start-m start-y students highest missing target]]
  (let [slug (course-slug letter)
        start-date (when (and start-m start-y) (str start-y "-" start-m))
        node-props (cond-> {:slug slug
                            :canonicalName (str "Kompani Linge — Kurs " letter)
                            :type "course"
                            :courseLetter letter
                            :order order
                            :studentCount students
                            :highestSerial highest
                            :missingCount missing}
                     start-date            (assoc :startDate start-date)
                     target                (assoc :targetGroup (name target)))]
    (str
      (cy/merge-node :Unit node-props)
      (cy/merge-edge {:from {:label :Unit :match {:slug slug}}
                      :to   {:label :Unit :match {:slug "kompani-linge"}}
                      :rel  :PART_OF})
      (when target
        (let [edge-target (get target-group->edge target)]
          (cy/merge-edge {:from  {:label :Unit :match {:slug slug}}
                          :to    edge-target
                          :rel   :FEEDS_INTO
                          :props {:sourceRef "linge-outline-course-table"}}))))))

;; ── Destinations that don't exist yet ─────────────────────────────────────

(def shetland-bus-cypher
  "Shetlandsgjengen / Shetland Bus — SOE's Norwegian maritime detachment
   based in Shetland, running crossings to occupied Norway. Linge's 'Shetland'
   course graduates fed into this unit."
  (str
    (cy/merge-node :Unit
                   {:slug "shetland-bus"
                    :canonicalName "Shetlandsgjengen"
                    :type "detachment"
                    :country "UK-NO"
                    :names "[{\"value\":\"Shetland Bus\",\"type\":\"primary\",\"language\":\"en\"},{\"value\":\"Shetlandsgjengen\",\"type\":\"primary\",\"language\":\"no\"}]"})
    (cy/merge-edge {:from {:label :Unit         :match {:slug "shetland-bus"}}
                    :to   {:label :Organization :match {:slug "soe"}}
                    :rel  :PART_OF})))

;; ── Orchestration ────────────────────────────────────────────────────────

(defn build []
  {:counts {:courses (count courses)
            :courses-with-dates (count (filter #(nth % 2) courses))
            :courses-with-targets (count (filter #(nth % 6) courses))}
   :files  {"00-destinations.cypher" shetland-bus-cypher
            ;; Canonical order: sort by length of courseLetter, then alphabetically.
            ;; Single letters (A–Z) get orders 1..22; double letters (AA, CC, DD, EE,
            ;; FA, ZA, ZB, ZY) get 23..30. The order integer is what the Vue query
            ;; sorts by — naming-scheme-agnostic, editable per-course if Jan wants
            ;; to reposition one later.
            "01-courses.cypher"      (apply str
                                       (map-indexed
                                         #(course-cypher (inc %1) %2)
                                         (sort-by (juxt #(count (first %)) first) courses)))}})

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [counts]}]
  (println "\n--- Round-2.1 report (Courses) ---")
  (println (format "Courses:              %d" (:courses counts)))
  (println (format "  with start date:    %d" (:courses-with-dates counts)))
  (println (format "  with target group:  %d" (:courses-with-targets counts)))
  (println "\nOutput:" output-dir))

(defn -main [& _]
  (let [r (build)]
    (write-outputs! r)
    (report r)))

(comment
  (def r (build))
  (:counts r)
  (println (subs (get (:files r) "01-courses.cypher") 0 400)))
