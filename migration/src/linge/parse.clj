(ns linge.parse
  "Extract rank, status, and organizational flags from raw Sanity person names.
   Ported from scripts/round-0-importer.ts; refine in the REPL."
  (:require [clojure.string :as str]))

;; ────────────────────────────────────────────────────────────────────────────
;; Rank table — canonical-name → {:abbrs [...], :tier N, :org slug}.
;; Small on purpose; extend as Jan encounters edge cases.

;; "Menig" is the default rank for ordinary soldiers — every person gets a
;; HELD_RANK edge, defaulting to Menig if no other rank token was parsed.
;; The edge's sourceRef distinguishes parsed-from-name from default-inference
;; so Jan can review the defaults separately.

(def ranks
  {"Menig"              {:abbrs ["Menig"]                                           :tier 1 :org "haeren"}
   "Korporal"           {:abbrs ["Korporal" "Korp" "Korp." "Cpl" "Cpl."]            :tier 2 :org "haeren"}
   "Sersjant"           {:abbrs ["Sersjant" "Sgt" "Sgt." "Sjt" "Sers." "Sers"]      :tier 3 :org "haeren"}
   "Fenrik"             {:abbrs ["Fenrik" "Fenr" "Fenr."]                           :tier 4 :org "haeren"}
   "Løytnant"           {:abbrs ["Løytnant" "Lt" "Lt."]                             :tier 5 :org "haeren"}
   "Kaptein"            {:abbrs ["Kaptein" "Kapt" "Kapt."]                          :tier 6 :org "haeren"}
   "Major"              {:abbrs ["Major"]                                           :tier 7 :org "haeren"}
   "Oberst"             {:abbrs ["Oberst"]                                          :tier 8 :org "haeren"}
   "Pilot Officer"      {:abbrs ["P/O"]                                             :tier 3 :org "raf"}
   "Flying Officer"     {:abbrs ["F/O"]                                             :tier 4 :org "raf"}
   "Flight Lieutenant"  {:abbrs ["F/Lt" "Flt"]                                      :tier 5 :org "raf"}
   "Warrant Officer"    {:abbrs ["W/O"]                                             :tier 3 :org "raf"}
   "Sub Lieutenant"     {:abbrs ["S/Lt"]                                            :tier 4 :org "marinen"}})

(def abbr->canonical
  (into {} (for [[canonical {:keys [abbrs]}] ranks, a abbrs]
             [(str/lower-case a) canonical])))

;; ────────────────────────────────────────────────────────────────────────────
;; Status markers — single-char unicode suffixes on names.

(def status-markers
  {"✝" "KIA"
   "∞" "ambiguous"}) ; TODO: Jan to classify per-person

(def org-flags #{"NNIU" "KS"}) ; → additional MEMBER_OF edges later, not a status

;; ────────────────────────────────────────────────────────────────────────────

(defn normalize-whitespace [s]
  (-> s (str/replace #"\t" " ") (str/replace #"\s+" " ") str/trim))

(defn extract-marker [s marker]
  (when (str/includes? s marker)
    {:match marker :remainder (str/replace s (re-pattern (str "\\s*" marker "\\s*")) " ")}))

(defn extract-status [name-str]
  (some (fn [[marker value]]
          (when-let [{:keys [remainder]} (extract-marker name-str marker)]
            {:value value :marker marker :remainder remainder}))
        status-markers))

(defn extract-flags [name-str]
  (reduce (fn [acc flag]
            (let [re (re-pattern (str "\\s*\\(?" flag "\\)?\\s*"))]
              (if (re-find re (:remainder acc))
                {:flags     (conj (:flags acc) flag)
                 :remainder (str/replace (:remainder acc) re " ")}
                acc)))
          {:flags [] :remainder name-str}
          org-flags))

(defn extract-rank [name-str]
  (let [tokens (str/split (str/trim name-str) #"\s+")]
    (loop [i 0]
      (cond
        (>= i (count tokens))
        {:rank nil :remainder name-str}

        (get abbr->canonical (str/lower-case (nth tokens i)))
        {:rank      {:canonical (get abbr->canonical (str/lower-case (nth tokens i)))
                     :original  (nth tokens i)}
         :remainder (str/join " " (concat (take i tokens) (drop (inc i) tokens)))}

        :else (recur (inc i))))))

(defn parse-person
  "Parse a raw Sanity person doc into a canonical record.
   Returns {:sanity-id :sanity-updated-at :raw-name :canonical-name :slug
            :rank {:canonical :original}?  :status {:value :marker}?
            :flags [..] :birth-year? :home? :secret-name?}"
  [{:keys [_id _updatedAt name slug birthYear home secretName]}]
  (let [normalized (normalize-whitespace name)
        status     (extract-status normalized)
        after-status (or (:remainder status) normalized)
        flags-r    (extract-flags after-status)
        rank-r     (extract-rank (:remainder flags-r))]
    {:sanity-id         _id
     :sanity-updated-at _updatedAt
     :raw-name          name
     :canonical-name    (normalize-whitespace (:remainder rank-r))
     :slug              (:current slug)
     :rank              (:rank rank-r)
     :status            (when status (select-keys status [:value :marker]))
     :flags             (:flags flags-r)
     :birth-year        birthYear
     :home              home
     :secret-name       secretName}))

(comment
  (parse-person {:_id "x" :_updatedAt "2026-04-17"
                 :name "Leif Tronstad Kaptein ✝"
                 :slug {:current "leif-tronstad"}
                 :birthYear 1903 :home "Trondheim"})
  ;; → {:canonical-name "Leif Tronstad"
  ;;    :rank {:canonical "Kaptein" :original "Kaptein"}
  ;;    :status {:value "KIA" :marker "✝"}
  ;;    ...}
  )
