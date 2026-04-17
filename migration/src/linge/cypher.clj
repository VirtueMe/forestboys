(ns linge.cypher
  "Cypher as data. Build node/edge descriptions as Clojure maps, compile to
   Cypher strings at the end. Keeps the DSL composable and testable."
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

;; ────────────────────────────────────────────────────────────────────────────
;; Low-level escaping / literal rendering.

(defn escape [s]
  (-> (str s)
      (str/replace "\\" "\\\\")
      (str/replace "\"" "\\\"")))

(defn literal
  "Render a Clojure value as a Cypher literal."
  [v]
  (cond
    (nil? v)        "null"
    (string? v)     (str "\"" (escape v) "\"")
    (number? v)     (str v)
    (boolean? v)    (str v)
    (map? v)        (str "\"" (escape (json/generate-string v)) "\"") ; JSON-as-string for now
    (sequential? v) (str "\"" (escape (json/generate-string v)) "\"")
    :else           (str "\"" (escape (str v)) "\"")))

(defn props->str
  "Render a map of props as  k1: v1, k2: v2  (skipping nil values)."
  [props]
  (->> props
       (remove (fn [[_ v]] (nil? v)))
       (map (fn [[k v]] (str (name k) ": " (literal v))))
       (str/join ", ")))

;; ────────────────────────────────────────────────────────────────────────────
;; Statement builders.

(defn merge-node
  "Emit  MERGE (n:Label {identity}) SET n.other = ...;

   Identity key is :slug if present, else :id, else the first key.
   Everything else becomes SET clauses. This makes MERGE idempotent
   across rounds — round-1 correctly updates round-0 nodes instead of
   creating duplicates when property sets differ."
  [label props]
  (let [id-key (cond
                 (contains? props :slug) :slug
                 (contains? props :id)   :id
                 :else                   (first (keys props)))
        id-val (get props id-key)
        updates (into {} (remove (fn [[_ v]] (nil? v)) (dissoc props id-key)))]
    (str "MERGE (n:" (name label) " {" (name id-key) ": " (literal id-val) "})\n"
         (if (seq updates)
           (str "SET "
                (->> updates
                     (map (fn [[k v]] (str "n." (name k) " = " (literal v))))
                     (str/join ", "))
                ";\n")
           ";\n"))))

(defn merge-edge
  "Emit MATCH ... MERGE (a)-[r:REL]->(b) ON CREATE SET r.k = v ...;"
  [{:keys [from to rel props]}]
  (let [{from-label :label from-match :match} from
        {to-label :label to-match :match}     to
        set-clause (when (seq props)
                     (str " ON CREATE SET "
                          (->> props
                               (map (fn [[k v]] (str "r." (name k) " = " (literal v))))
                               (str/join ", "))))]
    (str "MATCH (a:" (name from-label) " {" (props->str from-match) "}), "
         "(b:" (name to-label) " {" (props->str to-match) "})\n"
         "MERGE (a)-[r:" (name rel) "]->(b)" set-clause ";\n")))

;; ────────────────────────────────────────────────────────────────────────────
;; Scalar claims — {value, state, sourceRef} rendered as three paired props.

(defn scalar-claim-props
  "Given a field key and a claim map {:value :state :sourceRef}, produce the
   three paired properties for the enclosing node (or nil entries for state=unknown)."
  [field {:keys [value state sourceRef]}]
  (let [k (name field)]
    (cond-> {(keyword (str k "_state")) (or state "unknown")}
      (some? value)     (assoc (keyword k) value)
      (some? sourceRef) (assoc (keyword (str k "_sourceRef")) sourceRef))))

(defn merge-claims
  "Fold a map of {field → claim} into a flat props map using scalar-claim-props."
  [claims]
  (reduce-kv (fn [acc field claim]
               (merge acc (scalar-claim-props field claim)))
             {}
             claims))

(comment
  (merge-node :Organization {:slug "soe" :canonicalName "SOE" :type "allied-agency"})
  ;; "MERGE (:Organization {slug: \"soe\", canonicalName: \"SOE\", type: \"allied-agency\"});\n"

  (merge-edge {:from {:label :Organization :match {:slug "kompani-linge"}}
               :to   {:label :Organization :match {:slug "soe"}}
               :rel  :PART_OF})

  (merge-claims {:birth-year {:value 1903 :state "candidate" :sourceRef "sanity-migration:..."}
                 :home       {:state "unknown"}}))
