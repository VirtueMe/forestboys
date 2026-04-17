(ns linge.sanity
  "Load and index Sanity JSON dumps from ../data/."
  (:require [cheshire.core :as json]
            [clojure.java.io :as io]))

(def data-dir "../data")

(defn load-json
  "Read a Sanity dump file, return parsed Clojure data (keys as keywords).
   Eager slurp + parse-string — avoids lazy-stream-after-close bugs."
  [filename]
  (json/parse-string (slurp (str data-dir "/" filename)) true))

(defn load-persons   [] (load-json "sanity-person.json"))
(defn load-events    [] (load-json "sanity-event.json"))
(defn load-outlines  [] (load-json "sanity-outline.json"))
(defn load-orgs      [] (load-json "sanity-organization.json"))
(defn load-districts [] (load-json "sanity-district.json"))
(defn load-locations [] (load-json "sanity-location.json"))
(defn load-stations  [] (load-json "sanity-station.json"))
(defn load-transports[] (load-json "sanity-transport.json"))

(defn index-by
  "Map each item in coll to its value under key-fn."
  [key-fn coll]
  (into {} (map (juxt key-fn identity)) coll))

(defn find-linge-outline
  "Locate the Kompani Linge outline by title match."
  [outlines]
  (first (filter #(re-find #"N\.O\.R\.I\.C" (:title % "")) outlines)))

(defn linge-members
  "Return the 272 Person docs referenced by the Linge outline's people[]."
  [outlines persons]
  (let [linge (find-linge-outline outlines)
        by-id (index-by :_id persons)]
    (keep #(get by-id (:_ref %)) (:people linge))))

(comment
  ;; REPL warm-up — evaluate these one at a time.
  (def outlines (load-outlines))
  (def persons  (load-persons))
  (count persons)                                    ; 3791
  (def linge (find-linge-outline outlines))
  (:title linge)                                     ; "N.O.R.I.C.(1) (LINGE) Medlemmer"
  (count (:people linge))                            ; 272
  (def members (linge-members outlines persons))
  (count members)                                    ; 272
  (first members))                                   ; Leif Tronstad Kaptein ✝ or similar
