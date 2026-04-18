(ns linge.pages
  "Round-1.5: migrate Sanity's `home` + `aboutUs` documents into Neo4j
   Page / Card / Description / Source nodes. After this round, the Vue app
   can drop Sanity as a content dependency.

   Output to ../data/round-1.5/ :
     00-pages.cypher            Page + Card + HAS_CARD edges
     01-page-descriptions.cypher  Description nodes + HAS_CONTENT edges
     02-page-sources.cypher     Source nodes for hero images + HAS_HERO_IMAGE edges"
  (:require [clojure.java.io :as io]
            [clojure.string  :as str]
            [cheshire.core   :as json]
            [linge.cypher    :as cy]))

(def data-dir   "../data")
(def output-dir "../data/round-1.5")

;; ── Helpers ──────────────────────────────────────────────────────────────

(defn load-json [filename]
  (json/parse-string (slurp (str data-dir "/" filename)) true))

(defn sanity-image-url
  "Resolve a Sanity image asset reference to a CDN URL.
   Example: 'image-abc123-1024x768-jpg' → https://cdn.sanity.io/.../abc123-1024x768.jpg"
  [asset-ref]
  (when asset-ref
    (when-let [[_ id dims ext] (re-matches #"image-([a-f0-9]+)-(\d+x\d+)-(\w+)" asset-ref)]
      (str "https://cdn.sanity.io/images/7r6kqtqy/production/" id "-" dims "." ext))))

(defn card-id [page-slug idx] (str "card:" page-slug ":" (inc idx)))
(defn desc-id [page-slug idx] (str "desc:" page-slug ":" (inc idx)))
(defn img-source-id [asset-ref] (when asset-ref (str "img:sanity:" asset-ref)))

;; ── Normalizers: Sanity shapes → a common `card` shape ───────────────────

(defn topbottom-card->card [section section-order c]
  (let [asset-ref (get-in c [:image :asset :_ref])]
    {:title         (:title c)
     :blocks        (:description c)
     :image-ref     asset-ref
     :image-url     (sanity-image-url asset-ref)
     :type          "hero"
     :section       section
     :section-order section-order}))

(defn plain-text->card
  "Wrap a plain `description` string as a prose card with one Portable Text block."
  [section section-order text]
  (when (not (str/blank? text))
    {:title         nil
     :blocks        [{:_type "block" :style "normal"
                      :children [{:_type "span" :text text :marks []}]}]
     :type          "prose"
     :section       section
     :section-order section-order}))

(defn prose-blocks->card [section section-order blocks]
  {:title nil :blocks blocks :type "prose"
   :section section :section-order section-order})

;; ── Assemble the two pages in a canonical shape ──────────────────────────
;; Cards carry their own {section, section-order} properties — section is
;; free text but in practice "top" | "middle" | "bottom" for pages. Jan can
;; rearrange cards by editing either value; no tree-rewrite required.

(defn home-page [home]
  {:slug "home"
   :title "Milorg 2 Utforsker"
   :author "jan"
   :updatedAt (:_updatedAt home)
   :cards (->> (concat
                 (map-indexed #(topbottom-card->card "top"    (inc %1) %2) (:topCards home))
                 [(plain-text->card "middle" 1 (:description home))]
                 (map-indexed #(topbottom-card->card "bottom" (inc %1) %2) (:bottomCards home)))
               (remove nil?)
               vec)})

(defn partner->card
  "Turn a Sanity `partner` document into a partner-type card for the About page.
   Lives in the 'bottom' section — no need for a dedicated 'partners' section;
   the card's type is enough for renderers to pick the grid layout."
  [section-order p]
  (let [asset-ref (get-in p [:image :asset :_ref])]
    {:title         (:title p)
     :blocks        (:description p)
     :image-ref     asset-ref
     :image-url     (sanity-image-url asset-ref)
     :type          "partner"
     :section       "bottom"
     :section-order section-order}))

(defn about-page [about partners]
  {:slug "about"
   :title "Om prosjektet"
   :author "jan"
   :updatedAt (:_updatedAt about)
   :cards (vec (concat
                 [(prose-blocks->card "middle" 1 (:description about))]
                 (map-indexed #(partner->card (inc %1) %2) partners)))})

;; ── Cypher emitters ──────────────────────────────────────────────────────

(defn page-cypher [{:keys [slug title subtitle author updatedAt]}]
  (cy/merge-node :Page
                 (cond-> {:slug slug :title title :author author :updatedAt updatedAt}
                   subtitle (assoc :subtitle subtitle))))

(defn card-with-edges-cypher
  "Card node, HAS_CARD edge from Page, and hero-image handling if present."
  [page-slug idx {:keys [title type image-ref image-url section section-order]}]
  (let [cid (card-id page-slug idx)
        hid (img-source-id image-ref)]
    (str
      ;; Card node — section + sectionOrder make cards movable without tree rewrite
      (cy/merge-node :Card
                     (cond-> {:id cid
                              :section       (or section "middle")
                              :sectionOrder  (or section-order 1)}
                       title (assoc :title title)
                       type  (assoc :type type)
                       hid   (assoc :heroImageRef hid)))
      ;; Page → Card (edge carries no ordering — that lives on the Card)
      (cy/merge-edge {:from {:label :Page :match {:slug page-slug}}
                      :to   {:label :Card :match {:id cid}}
                      :rel  :HAS_CARD})
      ;; Hero image Source + edge (optional)
      (when hid
        (str
          (cy/merge-node :Source
                         {:id hid
                          :type "photograph"
                          :url image-url
                          :sanityAssetRef image-ref
                          :title (or title (str page-slug " card " (inc idx) " hero"))})
          (cy/merge-edge {:from {:label :Card   :match {:id cid}}
                          :to   {:label :Source :match {:id hid}}
                          :rel  :HAS_HERO_IMAGE}))))))

(defn card-description-cypher [{:keys [slug author updatedAt]} idx {:keys [blocks]}]
  (let [cid (card-id slug idx)
        did (desc-id slug idx)]
    (str
      ;; Description node (blocks serialized as JSON string for now)
      (cy/merge-node :Description
                     {:id did
                      :content       (json/generate-string blocks)
                      :author        author
                      :recordedDate  updatedAt
                      :confidence    "verified"})
      ;; Card → Description
      (cy/merge-edge {:from {:label :Card        :match {:id cid}}
                      :to   {:label :Description :match {:id did}}
                      :rel  :HAS_CONTENT
                      :props {:order 1}}))))

(defn pages-cypher [pages]
  (apply str (map page-cypher pages)))

(defn cards-cypher [pages]
  (apply str
    (for [{:keys [slug cards]} pages
          [idx card] (map-indexed vector cards)]
      (card-with-edges-cypher slug idx card))))

(defn descriptions-cypher [pages]
  (apply str
    (for [{:keys [slug cards] :as page} pages
          [idx card] (map-indexed vector cards)]
      (card-description-cypher page idx card))))

;; ── Orchestration ────────────────────────────────────────────────────────

(defn build []
  (let [home     (load-json "sanity-home.json")
        about    (load-json "sanity-about.json")
        partners (load-json "sanity-partner.json")
        pages    [(home-page home) (about-page about partners)]]
    {:pages    pages
     :counts   {:pages        (count pages)
                :cards        (count (mapcat :cards pages))
                :hero-images  (count (keep :image-ref (mapcat :cards pages)))}
     :files {"00-pages.cypher"             (pages-cypher pages)
             "01-cards.cypher"             (cards-cypher pages)
             "02-page-descriptions.cypher" (descriptions-cypher pages)}}))

(defn write-outputs! [{:keys [files]}]
  (.mkdirs (io/file output-dir))
  (doseq [[fname content] files]
    (spit (io/file output-dir fname) content)))

(defn report [{:keys [counts pages]}]
  (println "\n--- Round-1.5 report ---")
  (println "Pages:       " (:pages counts))
  (println "Cards:       " (:cards counts))
  (println "Hero images: " (:hero-images counts))
  (doseq [{:keys [slug cards]} pages]
    (println (format "\n  %s (%d card%s)" slug (count cards) (if (= 1 (count cards)) "" "s")))
    (doseq [[i c] (map-indexed vector cards)]
      (println (format "    card %d: [%s #%d] title=%-42s type=%s  hero=%s"
                       (inc i)
                       (or (:section c) "?")
                       (or (:section-order c) 0)
                       (pr-str (or (:title c) "«no title»"))
                       (or (:type c) "«none»")
                       (if (:image-ref c) "✓" "—")))))
  (println "\nOutput:" output-dir))

(defn -main [& _]
  (let [r (build)]
    (write-outputs! r)
    (report r)))

(comment
  (def r (build))
  (:counts r)
  (keys (:files r))
  (println (subs (get (:files r) "00-pages.cypher") 0 500))
  (write-outputs! r)
  (report r))
