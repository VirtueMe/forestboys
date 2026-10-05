# Changelog

## [0.5.0](https://github.com/VirtueMe/forestboys/compare/v0.4.0...v0.5.0) (2026-10-05)


### Features

* **events:** replace TimelineJS with a timeline that only draws what is in view ([d27847d](https://github.com/VirtueMe/forestboys/commit/d27847dafa4b0134589ee0232ce0855c14af7baa)), closes [#88](https://github.com/VirtueMe/forestboys/issues/88)

## [0.4.0](https://github.com/VirtueMe/forestboys/compare/v0.3.0...v0.4.0) (2026-10-05)


### Features

* **admin:** list of description links that lead nowhere ([db482b6](https://github.com/VirtueMe/forestboys/commit/db482b639ec9c044f0e7b75e4f40aabb1ca0408c)), closes [#95](https://github.com/VirtueMe/forestboys/issues/95)
* **admin:** open a home-page card from the dead-link list ([7e15379](https://github.com/VirtueMe/forestboys/commit/7e153796ba35df9f5c03e618d7ca09a4e1d99c3a)), closes [#95](https://github.com/VirtueMe/forestboys/issues/95)
* **admin:** refuse new description links that lead nowhere ([4697bed](https://github.com/VirtueMe/forestboys/commit/4697bedd38089479ff51a54f55f6ed86c2cc9fa7)), closes [#95](https://github.com/VirtueMe/forestboys/issues/95)
* **admin:** show link problems in the description editor ([ec48b81](https://github.com/VirtueMe/forestboys/commit/ec48b81d35a6fc041c47a86664a24080e2705603)), closes [#95](https://github.com/VirtueMe/forestboys/issues/95)
* **links:** check description links against the pages that exist ([4cbd715](https://github.com/VirtueMe/forestboys/commit/4cbd7155a26e4999e5f5d0761ed89dbe8f59de3b)), closes [#95](https://github.com/VirtueMe/forestboys/issues/95)


### Bug fixes

* **events:** links in descriptions lead somewhere, or say they don't ([f454082](https://github.com/VirtueMe/forestboys/commit/f4540823c087eb14a49042e225410fda8085a222)), closes [#90](https://github.com/VirtueMe/forestboys/issues/90)
* **events:** show the event's «Nyttige lenker» section ([05a8791](https://github.com/VirtueMe/forestboys/commit/05a87916e4748c58be69d18bb0f0babf6bd218db)), closes [#93](https://github.com/VirtueMe/forestboys/issues/93)
* **events:** transport and station pages list their operations ([ac7713e](https://github.com/VirtueMe/forestboys/commit/ac7713e51b413b3c347b93a803eda840a1b3f749)), closes [#97](https://github.com/VirtueMe/forestboys/issues/97)

## [0.3.0](https://github.com/VirtueMe/forestboys/compare/v0.2.0...v0.3.0) (2026-10-05)


### Features

* **changelog:** let an admin set how many releases the page shows ([7508333](https://github.com/VirtueMe/forestboys/commit/7508333d775d8c6aadace71e69b1308b5b3bd96b))
* **changelog:** show the changelog on its own page ([d8528e3](https://github.com/VirtueMe/forestboys/commit/d8528e33f565470c8485c79747338f2ede3f052f))
* **footer:** show how many commits the build is past the latest release ([9b7348c](https://github.com/VirtueMe/forestboys/commit/9b7348c30849635b6272629d073a051d0e3ff149))
* **person:** merge courses and training into «Har deltatt på» ([51e8016](https://github.com/VirtueMe/forestboys/commit/51e80161eb6aa15490db2dffdc875b7a1c168656)), closes [#70](https://github.com/VirtueMe/forestboys/issues/70)
* **roles:** flag a role as «Har deltatt på» ([ed1d077](https://github.com/VirtueMe/forestboys/commit/ed1d077716b5702c0f168e61f0aba3511dc47c79)), closes [#70](https://github.com/VirtueMe/forestboys/issues/70)
* **station:** edit a station's other names ([718745b](https://github.com/VirtueMe/forestboys/commit/718745b58941e28becbb488f27028296fd948563)), closes [#72](https://github.com/VirtueMe/forestboys/issues/72)
* **station:** give a station a category and call the type its function ([a41ae74](https://github.com/VirtueMe/forestboys/commit/a41ae743871c3662ec213edb33cd0285a7e34317)), closes [#72](https://github.com/VirtueMe/forestboys/issues/72)
* **station:** group a station's participants by role ([2cc50d1](https://github.com/VirtueMe/forestboys/commit/2cc50d120e3ee98c007c88eef4277a300b049b24)), closes [#72](https://github.com/VirtueMe/forestboys/issues/72)
* **station:** import a station's people links with a default role ([432e7e4](https://github.com/VirtueMe/forestboys/commit/432e7e45b5b86c758bb00fa92b9c56154ab9e5dd)), closes [#70](https://github.com/VirtueMe/forestboys/issues/70)
* **station:** one list of sources per station ([d9b3a3d](https://github.com/VirtueMe/forestboys/commit/d9b3a3d2f4fb80264a52d790450a54fa75f67662)), closes [#72](https://github.com/VirtueMe/forestboys/issues/72)
* **station:** show a station's other names and search on them ([7542b74](https://github.com/VirtueMe/forestboys/commit/7542b747e6344111930b2d9bab6ffc33d83ef11e)), closes [#72](https://github.com/VirtueMe/forestboys/issues/72)
* **station:** show the station on a map and pick its coordinates there ([9c70291](https://github.com/VirtueMe/forestboys/commit/9c70291979279cd86005fc11260a764f3ce92e52)), closes [#72](https://github.com/VirtueMe/forestboys/issues/72)
* **station:** store a station's other names as Name nodes ([90f0a61](https://github.com/VirtueMe/forestboys/commit/90f0a61d695bfacab555685b0c8dcfa6f694dc52)), closes [#72](https://github.com/VirtueMe/forestboys/issues/72)
* **sync:** save an undo file before --stamp --write adds stamps ([bd226c5](https://github.com/VirtueMe/forestboys/commit/bd226c5dd4167a60ca04f8cf3d645f04da7ebe83)), closes [#80](https://github.com/VirtueMe/forestboys/issues/80)
* **sync:** stamp the baseline into the graph with --stamp ([39c20c4](https://github.com/VirtueMe/forestboys/commit/39c20c4967adb66733d3c6cbd6ea2b46e0793280)), closes [#80](https://github.com/VirtueMe/forestboys/issues/80)


### Bug fixes

* **footer:** fetch the tags in Cloudflare and CI builds ([cfd9a56](https://github.com/VirtueMe/forestboys/commit/cfd9a56df353a6ebe3c9016fb89a2be92cbe360a))
* **sync:** let the syncs run without the baseline files ([dc818aa](https://github.com/VirtueMe/forestboys/commit/dc818aa934eb03813342ce84352be09308b7579f)), closes [#80](https://github.com/VirtueMe/forestboys/issues/80)


### Refactoring

* **scripts:** group the scripts by purpose ([1bc0a65](https://github.com/VirtueMe/forestboys/commit/1bc0a65325b83c321c96ea93b0543d425b18ad68)), closes [#79](https://github.com/VirtueMe/forestboys/issues/79)


### Documentation

* **migration:** say what the Clojure project is and which rounds it has ([381d122](https://github.com/VirtueMe/forestboys/commit/381d1221589e72cbcc2561e0a260659a976e6a2c)), closes [#79](https://github.com/VirtueMe/forestboys/issues/79)
* **scripts:** point every path at the new folders and say what each is ([9e1994c](https://github.com/VirtueMe/forestboys/commit/9e1994c3fd8add30a0d92169eaf0843b5621df77)), closes [#79](https://github.com/VirtueMe/forestboys/issues/79)

## [0.2.0](https://github.com/VirtueMe/forestboys/compare/v0.1.0...v0.2.0) (2026-10-04)


### Features

* **admin:** Brukere page, menu badge and "Sjekk på nytt" ([3e6fc85](https://github.com/VirtueMe/forestboys/commit/3e6fc85e783f485af9a0105584c6edcecf4c89bb)), closes [#58](https://github.com/VirtueMe/forestboys/issues/58)
* **admin:** editors see their saves at once ([c0159c5](https://github.com/VirtueMe/forestboys/commit/c0159c51baf41b308c37507fde8d9511f60fe471)), closes [#55](https://github.com/VirtueMe/forestboys/issues/55)
* **admin:** endpoints and rules for reviewing access requests ([514f633](https://github.com/VirtueMe/forestboys/commit/514f633c33c61fb716c6239f600e1ac047497776)), closes [#58](https://github.com/VirtueMe/forestboys/issues/58)
* **person:** keep the heading to the name, show dekknavn on its own line ([53e8efb](https://github.com/VirtueMe/forestboys/commit/53e8efb41fb03da8e4da31cbeda16f675424a592)), closes [#69](https://github.com/VirtueMe/forestboys/issues/69)
* show the app version and changelog in the footer ([abdb9f9](https://github.com/VirtueMe/forestboys/commit/abdb9f9c9d75d0e9a2704fa89784df33b8fb1eac)), closes [#30](https://github.com/VirtueMe/forestboys/issues/30)


### Bug fixes

* **auth:** read the role from D1 instead of trusting the cookie ([a6618b0](https://github.com/VirtueMe/forestboys/commit/a6618b0e79df7d62ab60713f80c2d868ba7b6706)), closes [#58](https://github.com/VirtueMe/forestboys/issues/58)
* **auth:** show the failure code when it has capital letters ([5eda27b](https://github.com/VirtueMe/forestboys/commit/5eda27bd67607896c2d531612d1c7c6303ffa260)), closes [#14](https://github.com/VirtueMe/forestboys/issues/14)
* **auth:** show why a GitHub sign-in failed ([226b216](https://github.com/VirtueMe/forestboys/commit/226b216648b59843c41e646f2b0eb97fae8ad968)), closes [#14](https://github.com/VirtueMe/forestboys/issues/14)
* **events:** add the missing route for saving event descriptions ([04b5190](https://github.com/VirtueMe/forestboys/commit/04b519061bddcc78c5e9967eb3bb63d3daf49f14)), closes [#65](https://github.com/VirtueMe/forestboys/issues/65)
* **events:** import event text as HAS_CONTENT and move the existing one ([f331309](https://github.com/VirtueMe/forestboys/commit/f3313093045e6246b2dcacee35a007bd08c687ae)), closes [#63](https://github.com/VirtueMe/forestboys/issues/63)
* **pwa:** let /auth, /api and /images bypass the service worker ([2e86075](https://github.com/VirtueMe/forestboys/commit/2e86075239748810840893021bc4c9cce902fd95)), closes [#14](https://github.com/VirtueMe/forestboys/issues/14)

## 0.1.0 (2026-10-03)


### Features

* **auth:** sign in with GitHub ([5d3f271](https://github.com/VirtueMe/forestboys/commit/5d3f2719e8246162d2235cf90f7132de6cdbed54)), closes [#14](https://github.com/VirtueMe/forestboys/issues/14)


### Bug fixes

* **auth:** TextDecoder options for the build's type check ([d2257ae](https://github.com/VirtueMe/forestboys/commit/d2257aeedf788a8f2d75b511463fa18256619c4d))


### Documentation

* add contributing guide, code of conduct, security policy and codeowners ([b5ab89e](https://github.com/VirtueMe/forestboys/commit/b5ab89e17b010beb610134da55737477350919b5)), closes [#19](https://github.com/VirtueMe/forestboys/issues/19)
* rewrite README for the Neo4j-based main ([53c6d0f](https://github.com/VirtueMe/forestboys/commit/53c6d0f11780407a446269c4ebf8659890587603)), closes [#21](https://github.com/VirtueMe/forestboys/issues/21)
