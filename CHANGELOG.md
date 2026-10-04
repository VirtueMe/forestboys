# Changelog

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
