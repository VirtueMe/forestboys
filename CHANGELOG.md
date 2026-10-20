# Changelog

## [0.19.0](https://github.com/VirtueMe/forestboys/compare/v0.18.1...v0.19.0) (2026-10-20)


### Features

* **editor:** the box is the fixed-width block, and the table is one split button ([90782de](https://github.com/VirtueMe/forestboys/commit/90782de4e0d8adc16f562defe24a023e59e3d95f)), closes [#325](https://github.com/VirtueMe/forestboys/issues/325)

## [0.18.1](https://github.com/VirtueMe/forestboys/compare/v0.18.0...v0.18.1) (2026-10-19)


### Bug fixes

* **outlines:** the outline page shows the images and the links the graph has ([f6a71f8](https://github.com/VirtueMe/forestboys/commit/f6a71f8c648a095fcf7613ab444a1628a3c4a4e8)), closes [#321](https://github.com/VirtueMe/forestboys/issues/321)

## [0.18.0](https://github.com/VirtueMe/forestboys/compare/v0.17.0...v0.18.0) (2026-10-19)


### Features

* **descriptions:** archive references are linked inside boxes and tables ([005e769](https://github.com/VirtueMe/forestboys/commit/005e769f38f68541d923bcccb85d1ebfbc4dc18c))
* **descriptions:** draw a box and a table container on the page and in text ([c294ee8](https://github.com/VirtueMe/forestboys/commit/c294ee8aee304457827724689f3e39fad2431b9c)), closes [#313](https://github.com/VirtueMe/forestboys/issues/313)
* **descriptions:** lists in boxes and table cells are numbered on their own ([959397b](https://github.com/VirtueMe/forestboys/commit/959397b3940a68312f835f666a101e20c221076b))
* **descriptions:** the block check reads inside boxes and tables ([5aa2e75](https://github.com/VirtueMe/forestboys/commit/5aa2e75c2ca7548fbcf043eb432d9a7c303e9204))
* **descriptions:** the heading check reads inside boxes and flags headings in table cells ([5e7a550](https://github.com/VirtueMe/forestboys/commit/5e7a550f52d3273a52515d84748eb58f235533a8))
* **descriptions:** the link check and slug rename reach links inside boxes and tables ([e631081](https://github.com/VirtueMe/forestboys/commit/e63108109869375672369759895e519d2a2b1a04))
* **editor:** a panel for the options of a table: frame, and rules between rows and columns ([40fdc5a](https://github.com/VirtueMe/forestboys/commit/40fdc5a00aadbf5d3f540b881c1ed61a7056fc05))
* **editor:** insert a box and a table, with cells that take no headings ([45dd3cb](https://github.com/VirtueMe/forestboys/commit/45dd3cb87fb3f0b50f79ee3d04c7f2bb384c505e))
* **editor:** Tab, Shift+Tab and Enter move through a table, and Backspace stays inside a cell ([b6995f9](https://github.com/VirtueMe/forestboys/commit/b6995f99cd11740c2a5e702e2c2293a8117b452c))
* **editor:** table tools for rows, columns and deleting, and wrapping blocks in a box or taking one apart ([a8ce821](https://github.com/VirtueMe/forestboys/commit/a8ce821bae3eb8d6fe5feba45bfb34a5da84a48b))
* **proposals:** bundles treat a box or a table as one block ([45ec32d](https://github.com/VirtueMe/forestboys/commit/45ec32d8f0d2796a931cd03b024090b8ae3b3ecc)), closes [#315](https://github.com/VirtueMe/forestboys/issues/315)
* **sync:** a description with a box or a table is not empty ([c04fbb4](https://github.com/VirtueMe/forestboys/commit/c04fbb4184bb4f886038696029814343221367d2)), closes [#314](https://github.com/VirtueMe/forestboys/issues/314)


### Bug fixes

* **descriptions:** tables scroll sideways instead of wrapping ([b2824db](https://github.com/VirtueMe/forestboys/commit/b2824dbafde219c0bee18f22b4011513ee63ea9c)), closes [#309](https://github.com/VirtueMe/forestboys/issues/309)


### Refactoring

* **descriptions:** one walk over the blocks of a description, containers included ([6d83f01](https://github.com/VirtueMe/forestboys/commit/6d83f01831034b07d3b62335d0d08b6360b6b959))


### Documentation

* **editor:** the box and the table in the editor, and a save check through DescriptionEditor ([4598cea](https://github.com/VirtueMe/forestboys/commit/4598cea3c612fc1dadadc06aa79a694e42ed5f18))

## [0.17.0](https://github.com/VirtueMe/forestboys/compare/v0.16.0...v0.17.0) (2026-10-17)


### Features

* **stations:** airfield as a station category, and a script that fills it ([862fbfa](https://github.com/VirtueMe/forestboys/commit/862fbfa62ff645f4d98f8ef074b1980f876d846c)), closes [#303](https://github.com/VirtueMe/forestboys/issues/303)
* **sync:** sync links of transports, locations and stations from Sanity ([b3ea886](https://github.com/VirtueMe/forestboys/commit/b3ea8868864b6704b3cf6c142e8f8a4036fa4731))
* **sync:** sync locations from Sanity: new nodes, name, coordinates, gallery and slug ([8179e75](https://github.com/VirtueMe/forestboys/commit/8179e75ac000d0e1c7874e886a1999e71e8de6ec)), closes [#296](https://github.com/VirtueMe/forestboys/issues/296)
* **sync:** sync organizations and districts from Sanity ([793e9bb](https://github.com/VirtueMe/forestboys/commit/793e9bb16dffbaf6c60fb3affde5024cdb498f75))
* **sync:** sync outlines from Sanity ([ed8022b](https://github.com/VirtueMe/forestboys/commit/ed8022b1c6dea7768d0aef47d40ca48210499c8d))
* **sync:** sync stations from Sanity: new nodes, name, coordinates, type, gallery and slug ([a796dc3](https://github.com/VirtueMe/forestboys/commit/a796dc349ffaca91ab2c53d30d436dd0cc639ca9)), closes [#297](https://github.com/VirtueMe/forestboys/issues/297)


### Documentation

* **sync:** record that home, about and partners are in the graph ([28f5014](https://github.com/VirtueMe/forestboys/commit/28f50144382fcfd43d3b55a8ff7ddbbefb9b04fb))

## [0.16.0](https://github.com/VirtueMe/forestboys/compare/v0.15.0...v0.16.0) (2026-10-16)


### Features

* **lists:** show a long list in a scrolling box, with a toggle for all of it ([c89114c](https://github.com/VirtueMe/forestboys/commit/c89114cf651086be8d3a1d5606d44ff02acff3b3)), closes [#292](https://github.com/VirtueMe/forestboys/issues/292)
* **relations:** line the chips of a relation list up in a column after the names ([5979e66](https://github.com/VirtueMe/forestboys/commit/5979e660049951a23c4a7c8309d7f23a63a98960)), closes [#291](https://github.com/VirtueMe/forestboys/issues/291)

## [0.15.0](https://github.com/VirtueMe/forestboys/compare/v0.14.0...v0.15.0) (2026-10-16)


### Features

* **map:** start the location map as wide as the text, with cinema mode and full screen ([22aaea9](https://github.com/VirtueMe/forestboys/commit/22aaea95565fe60c5fbf5cfa502f95af93bc2a51)), closes [#288](https://github.com/VirtueMe/forestboys/issues/288)

## [0.14.0](https://github.com/VirtueMe/forestboys/compare/v0.13.0...v0.14.0) (2026-10-16)


### Features

* **events:** show each event's date and sort the lists on entity pages by date ([6b4fde3](https://github.com/VirtueMe/forestboys/commit/6b4fde3c706bdb6b1a5be4940b3e5c226901ae40)), closes [#284](https://github.com/VirtueMe/forestboys/issues/284)

## [0.13.0](https://github.com/VirtueMe/forestboys/compare/v0.12.1...v0.13.0) (2026-10-16)


### Features

* **editor:** a table is a block style the editor sets ([370fb3e](https://github.com/VirtueMe/forestboys/commit/370fb3e24c8d873935ad02540aa4dfb4008ed5f0))
* **proposals:** one record per entity and bundle, so every bundle that touches an entity is visible ([8d056da](https://github.com/VirtueMe/forestboys/commit/8d056dad1d891a79bf5021ff002015a757dd504a)), closes [#273](https://github.com/VirtueMe/forestboys/issues/273)
* **scripts:** cut the ANCC minutes into sections, one per numbered item ([a1c13db](https://github.com/VirtueMe/forestboys/commit/a1c13db1f58fd6b225151fa2bdce1a6ee3315977))
* **scripts:** migrate tab-guessed tables to preformatted, and keep them through the sync ([287f188](https://github.com/VirtueMe/forestboys/commit/287f1881edfc1aa8085b64844c8a4530cfeef100))


### Bug fixes

* **proposals:** drop the old entity indexes in steps a Worker can take ([26a48bd](https://github.com/VirtueMe/forestboys/commit/26a48bdeb41f996af48b8684b573d102077dd77f))
* **sync:** leave a description alone once it is split into sections ([51776af](https://github.com/VirtueMe/forestboys/commit/51776af2704a2526f471e4272f17818cc6a42970))
* **sync:** try the Aura connection again when it is dropped ([db0e00b](https://github.com/VirtueMe/forestboys/commit/db0e00bd2a7995a3ccc36b0cbc855ee3cb7273a6)), closes [#282](https://github.com/VirtueMe/forestboys/issues/282)


### Refactoring

* **renderer:** a tab in a paragraph is just a tab ([9cdaebc](https://github.com/VirtueMe/forestboys/commit/9cdaebced573e0f88d17a91245ee2697235dc78b))

## [0.12.1](https://github.com/VirtueMe/forestboys/compare/v0.12.0...v0.12.1) (2026-10-13)


### Bug fixes

* **descriptions:** keep tab-bearing prose out of the table block ([fcc1cde](https://github.com/VirtueMe/forestboys/commit/fcc1cdea7e38be56cd03381f9b4cf1ffeb7c2804))

## [0.12.0](https://github.com/VirtueMe/forestboys/compare/v0.11.0...v0.12.0) (2026-10-13)


### Features

* **quality:** list descriptions with broken block structure ([9097bd3](https://github.com/VirtueMe/forestboys/commit/9097bd302b211046bdb562f279a7a286b0adf3ff))


### Bug fixes

* **editor:** move the Portable Text editor to 8, with node registrations ([882912d](https://github.com/VirtueMe/forestboys/commit/882912d7dd2390e7884fdbbe2b0b36b03500d2bf))

## [0.11.0](https://github.com/VirtueMe/forestboys/compare/v0.10.1...v0.11.0) (2026-10-13)


### Features

* **slugs:** ask before a slug is changed and show what is rewritten ([ea4d16a](https://github.com/VirtueMe/forestboys/commit/ea4d16a95f3598027e33b4db6a2e0a94d1b3a67a))
* **slugs:** keep a renamed page's old slug as an alias and rewrite links to it ([ed690ac](https://github.com/VirtueMe/forestboys/commit/ed690acacaa067d441256db30e6df9155d9b5461))
* **slugs:** redirect the old address of a renamed page to the page ([f9b626c](https://github.com/VirtueMe/forestboys/commit/f9b626c25c3e3c3464f164d3277afda99b912a68))
* **slugs:** rename through the helper, and let creates and deletes respect aliases ([8407573](https://github.com/VirtueMe/forestboys/commit/8407573391b29a47364364ba2ccf81da39408d04))


### Bug fixes

* **design:** use muted for separator text, not the rule colour ([499ca6f](https://github.com/VirtueMe/forestboys/commit/499ca6ffb837d9a2656abeb49438b8f28052a4f5))
* **events:** an answer for the old slug no longer marks the renamed event as missing ([5802f77](https://github.com/VirtueMe/forestboys/commit/5802f7732db3076814669a8ea7720fa2a213d5a4))
* **proposals:** delete an entity's own text, names and notes with it ([e22e8a3](https://github.com/VirtueMe/forestboys/commit/e22e8a3e706562b27bc27a0a71573d5d84f2b30b))
* **proposals:** stop the bundle stream from holding the Durable Object awake ([fa11696](https://github.com/VirtueMe/forestboys/commit/fa11696090dd55a622cf72418eb9d3420a7fb0d7))


### Documentation

* **events:** the slug preview in the editor ([a52d621](https://github.com/VirtueMe/forestboys/commit/a52d621f70c0be4d79df1d7d54dc4cae718183d7)), closes [#96](https://github.com/VirtueMe/forestboys/issues/96)
* **routing:** old addresses are a 302, in the server and in the app ([d866dd9](https://github.com/VirtueMe/forestboys/commit/d866dd94b81fa862c58a5c20de2f701b22d240ed)), closes [#96](https://github.com/VirtueMe/forestboys/issues/96)
* **schema:** a Description never outlives its entity ([b95bf06](https://github.com/VirtueMe/forestboys/commit/b95bf06aa2c6d9b398083d3a30ffdad8b051a6fc))
* **schema:** define the CourseOverview node ([be4e841](https://github.com/VirtueMe/forestboys/commit/be4e8417149aec984ce02b8f789828f27a4c60af))
* **schema:** document the ATTENDED and HAS_ATTENDANCE_NOTE edges ([48e9add](https://github.com/VirtueMe/forestboys/commit/48e9adde652518c0bebbc66a469fe608c15d70cb))
* **schema:** SlugAlias node and a uniqueness constraint for it ([5183faf](https://github.com/VirtueMe/forestboys/commit/5183faf50957a0e49e9b181cc9656292c823849f))
* **slugs:** who writes aliases, and the sync exception ([72579fb](https://github.com/VirtueMe/forestboys/commit/72579fb7aca580bb35563b27f30d96962b690f4d)), closes [#96](https://github.com/VirtueMe/forestboys/issues/96)

## [0.10.1](https://github.com/VirtueMe/forestboys/compare/v0.10.0...v0.10.1) (2026-10-10)


### Bug fixes

* **pwa:** let sitemap.txt, robots.txt and manifest.json reach the network ([26477f0](https://github.com/VirtueMe/forestboys/commit/26477f0212d28266bee9a2e6c918da0b5de1c37b))

## [0.10.0](https://github.com/VirtueMe/forestboys/compare/v0.9.2...v0.10.0) (2026-10-10)


### Features

* **middleware:** answer 404 for unknown entity pages ([b0cf2c5](https://github.com/VirtueMe/forestboys/commit/b0cf2c5708d2aa079fb0a64cc071fe51f0a85cd4)), closes [#220](https://github.com/VirtueMe/forestboys/issues/220)
* **routing:** drop the 404.html redirect ([efd1355](https://github.com/VirtueMe/forestboys/commit/efd13551406d5c44c75cee9520769249fcf52a20)), closes [#220](https://github.com/VirtueMe/forestboys/issues/220)
* **sitemap:** keep the list of existing pages in KV ([143a739](https://github.com/VirtueMe/forestboys/commit/143a7396e57c0e1f77bda2f972afd0869e4f780d)), closes [#220](https://github.com/VirtueMe/forestboys/issues/220)
* **sitemap:** let the daily sync ask for a rebuild ([68903b2](https://github.com/VirtueMe/forestboys/commit/68903b255fcd9957ffb669d0b0ac525528ffdfff)), closes [#220](https://github.com/VirtueMe/forestboys/issues/220)
* **sitemap:** rebuild the list when a page is created, renamed or deleted ([5cb4d1c](https://github.com/VirtueMe/forestboys/commit/5cb4d1caa4e8da8262b7d85278f75d22fb9fc357)), closes [#220](https://github.com/VirtueMe/forestboys/issues/220)
* **sitemap:** serve sitemap.txt and robots.txt ([3c9a1d0](https://github.com/VirtueMe/forestboys/commit/3c9a1d0a01571b1e4c25706613ef6ac8cc992280)), closes [#220](https://github.com/VirtueMe/forestboys/issues/220)

## [0.9.2](https://github.com/VirtueMe/forestboys/compare/v0.9.1...v0.9.2) (2026-10-09)


### Bug fixes

* **editor:** keep the expanded editor 960px wide on large screens ([c637402](https://github.com/VirtueMe/forestboys/commit/c6374025eb98b7cae9b0b157d3c4f2f18c32746f)), closes [#214](https://github.com/VirtueMe/forestboys/issues/214)
* **editor:** keep two-digit list numbers on one line ([24a6eab](https://github.com/VirtueMe/forestboys/commit/24a6eab3a8934cdb7574fc907958f6e1633faf67)), closes [#213](https://github.com/VirtueMe/forestboys/issues/213)

## [0.9.1](https://github.com/VirtueMe/forestboys/compare/v0.9.0...v0.9.1) (2026-10-09)


### Bug fixes

* **descriptions:** nest lists correctly and style them in one place ([f554bba](https://github.com/VirtueMe/forestboys/commit/f554bba988e5aa3f08c6bcc923380e2744c908af))

## [0.9.0](https://github.com/VirtueMe/forestboys/compare/v0.8.0...v0.9.0) (2026-10-09)


### Features

* **pwa:** link the web app manifest, served from the site name ([30d0af4](https://github.com/VirtueMe/forestboys/commit/30d0af4b783d81c58d5c74f2c042a3f2ea55321b)), closes [#204](https://github.com/VirtueMe/forestboys/issues/204)

## [0.8.0](https://github.com/VirtueMe/forestboys/compare/v0.7.0...v0.8.0) (2026-10-09)


### Features

* **admin:** the site's name is a setting an admin can change ([f7f19ad](https://github.com/VirtueMe/forestboys/commit/f7f19ad47c521f46aaa07ea80b77f1eff3c34a07))
* **design:** use the flag favicon, PWA icons and a 404 page ([16f8084](https://github.com/VirtueMe/forestboys/commit/16f80840b46fb4c32eb3338d394bb9d8efb0c6e2)), closes [#105](https://github.com/VirtueMe/forestboys/issues/105)


### Bug fixes

* **design:** centre the 404 art and give the button room ([5e17bf2](https://github.com/VirtueMe/forestboys/commit/5e17bf24bc47bc417f82f83fff1ebb2b1676a6e1)), closes [#105](https://github.com/VirtueMe/forestboys/issues/105)

## [0.7.0](https://github.com/VirtueMe/forestboys/compare/v0.6.0...v0.7.0) (2026-10-09)


### Features

* **admin:** «Slett» archives a bundle, which can be read and restored ([f27e955](https://github.com/VirtueMe/forestboys/commit/f27e95546b9a51bd820f4b540f05ee65844af347))
* **admin:** a bundle can be annotated, as a whole and per entity ([bf7fe38](https://github.com/VirtueMe/forestboys/commit/bf7fe382793faffdc4079ced0ef9e0fe686670db))
* **admin:** a bundle records its events, with who did what and when ([c893bf7](https://github.com/VirtueMe/forestboys/commit/c893bf7664868884200331d6f473cad18a5cb3fd))
* **admin:** filter and page the proposals list from an index ([c78b85f](https://github.com/VirtueMe/forestboys/commit/c78b85ff67a3547ffa17bb7189fba0f6040213d9))
* **bundles:** nodes and edges an accepted bundle creates say where they came from ([7ff8b38](https://github.com/VirtueMe/forestboys/commit/7ff8b3869f50de55d7ad2c1aaedcc1ae61431f8e)), closes [#157](https://github.com/VirtueMe/forestboys/issues/157)
* **bundles:** packages of entity snapshots, and the comparison that turns them into ops ([3db576c](https://github.com/VirtueMe/forestboys/commit/3db576c4e22c43485bd5a8bfd84385ceb58939c8)), closes [#159](https://github.com/VirtueMe/forestboys/issues/159)
* **bundles:** refuse to create an entity that already exists ([580a98b](https://github.com/VirtueMe/forestboys/commit/580a98bb7355e069d2ecb4e1662b70b8ef2a0365))
* **bundles:** scripts that write a package for a list of entities and turn a package into a bundle ([5f97e90](https://github.com/VirtueMe/forestboys/commit/5f97e90d234fe34cf062b56592a7c9ba02cd2ed5)), closes [#159](https://github.com/VirtueMe/forestboys/issues/159)
* **bundles:** send bundle files to a site's ingest ([c0f21fd](https://github.com/VirtueMe/forestboys/commit/c0f21fd3c1424d8b5fe50791f5c6b9d8fcb55ce9))
* **bundles:** set-description, three more kinds and a package origin in ingest and apply ([a5007b9](https://github.com/VirtueMe/forestboys/commit/a5007b90f9c1d4cd5c83355b17d679e4b693fbed)), closes [#161](https://github.com/VirtueMe/forestboys/issues/161)
* **outlines:** convert the nodes made from outlines into bundles for Jan to accept ([787ca70](https://github.com/VirtueMe/forestboys/commit/787ca70d17e55c04d39a6c5ed33e25cc7788d110)), closes [#158](https://github.com/VirtueMe/forestboys/issues/158)
* **outlines:** the version of an outline is a hash of its text, and the accept records what was absorbed ([bcbaa22](https://github.com/VirtueMe/forestboys/commit/bcbaa224be214b85651f5212df0e04a0bcae2cf1)), closes [#157](https://github.com/VirtueMe/forestboys/issues/157)
* **preview:** review preview for Article ([56998e1](https://github.com/VirtueMe/forestboys/commit/56998e124976b02b5bb740e45271294f88fed1fe))
* **preview:** review preview for EquipmentType ([1d1d9b0](https://github.com/VirtueMe/forestboys/commit/1d1d9b0cd462eadd17a742109bd9a065338f5ca5))
* **preview:** review preview for Source ([7d1c02d](https://github.com/VirtueMe/forestboys/commit/7d1c02de96590f57bbbb474507b70c083bdd2cf4))


### Bug fixes

* **a11y:** edit mode meets the design checks: placeholder, editor name, target size ([98274b5](https://github.com/VirtueMe/forestboys/commit/98274b587ab4639f36e637a9b11abbbfd4348aa8)), closes [#146](https://github.com/VirtueMe/forestboys/issues/146)
* **a11y:** events have an h1 and h2 sections ([a8bb601](https://github.com/VirtueMe/forestboys/commit/a8bb6010fb526319da7ebb1b63519f14651b6b1e)), closes [#132](https://github.com/VirtueMe/forestboys/issues/132)
* **a11y:** section headings on the entity pages are h2 ([fccaf17](https://github.com/VirtueMe/forestboys/commit/fccaf1718ceabe97ca70d561ccd0cac8083cf4f4)), closes [#132](https://github.com/VirtueMe/forestboys/issues/132)
* **a11y:** the edit panes' section headings are h2 ([e70cba9](https://github.com/VirtueMe/forestboys/commit/e70cba92b0df41cbc9620317590daebfb580f484)), closes [#132](https://github.com/VirtueMe/forestboys/issues/132)
* **a11y:** the external-link arrow is hidden from screen readers ([94fa1d4](https://github.com/VirtueMe/forestboys/commit/94fa1d454f850e949d5bc710390e4ddd91168ce4)), closes [#139](https://github.com/VirtueMe/forestboys/issues/139)
* **a11y:** the organisation filter has a name ([0c29eb9](https://github.com/VirtueMe/forestboys/commit/0c29eb92ef39cf236fb34b96d0f4fb94a3099855)), closes [#139](https://github.com/VirtueMe/forestboys/issues/139)
* **a11y:** the person page's section headings are h2 ([7e011f2](https://github.com/VirtueMe/forestboys/commit/7e011f2766d7ccab244a9080b9421fd883114304)), closes [#132](https://github.com/VirtueMe/forestboys/issues/132)
* **admin:** derive a bundle's status and set aside what accept refuses ([ed6ee9f](https://github.com/VirtueMe/forestboys/commit/ed6ee9fe2df3636ec7c6c3b86e62c78f78ebd080))
* **admin:** leave a deleted bundle for the list and say so ([f1b9c21](https://github.com/VirtueMe/forestboys/commit/f1b9c210ffc9e942f72ba0eb87f4eba97342c383))
* **api:** ingest asks the graph through the Query API, and a failed lookup is a failure ([efcd1e1](https://github.com/VirtueMe/forestboys/commit/efcd1e14adc211dec6c140246d251d4f98263d74)), closes [#176](https://github.com/VirtueMe/forestboys/issues/176)
* **design:** muted and faded-red meet AA, and nothing is tolerated ([87e7d47](https://github.com/VirtueMe/forestboys/commit/87e7d470816373ffc27aec29d4a76b969548ab23)), closes [#134](https://github.com/VirtueMe/forestboys/issues/134)
* **editor:** Lagre saves what is on the screen, not the last reported draft ([dcc96a8](https://github.com/VirtueMe/forestboys/commit/dcc96a823aee2d90e64623ba23d33c9aeb751d0a)), closes [#145](https://github.com/VirtueMe/forestboys/issues/145)
* **editor:** no heading on a list item: the toolbar refuses it, the check ignores it ([e4ce3a2](https://github.com/VirtueMe/forestboys/commit/e4ce3a25bc3d85617245cbb02cd22ec94d352a1b)), closes [#144](https://github.com/VirtueMe/forestboys/issues/144)
* **preview:** the preview window gets the entity's slug from the panel, not the URL ([b957580](https://github.com/VirtueMe/forestboys/commit/b95758098bb4e9460b501d0bc94591a586af1ac4)), closes [#178](https://github.com/VirtueMe/forestboys/issues/178)
* **tools:** stop dev:worker cleanly on Ctrl-C ([1275114](https://github.com/VirtueMe/forestboys/commit/12751148aec7ee788356f28cd77be50c4d295b02)), closes [#201](https://github.com/VirtueMe/forestboys/issues/201)


### Documentation

* **agents:** describe the Neo4j app, not the Sanity-backed one ([304685b](https://github.com/VirtueMe/forestboys/commit/304685b926c895dcac0aee423f5f04eb0ed1fc8e)), closes [#37](https://github.com/VirtueMe/forestboys/issues/37)
* **bundles:** origin stamps, the version of an outline and its state ([dde25eb](https://github.com/VirtueMe/forestboys/commit/dde25eb85d048d591293de32264e9c2710fbd222)), closes [#157](https://github.com/VirtueMe/forestboys/issues/157)
* **design:** follow the DESIGN.md spec, and declare the colour pairs ([9f37f19](https://github.com/VirtueMe/forestboys/commit/9f37f19d05f5d15dc7d922edab774fb61e002a39)), closes [#134](https://github.com/VirtueMe/forestboys/issues/134)
* **proposals:** write down the shared decision for the per-bundle records ([ca5579b](https://github.com/VirtueMe/forestboys/commit/ca5579b276b85af629e154f820013687fccb7ac2))

## [0.6.0](https://github.com/VirtueMe/forestboys/compare/v0.5.0...v0.6.0) (2026-10-06)


### Features

* **editor:** bound the text area so the toolbar stays in view ([248a4b1](https://github.com/VirtueMe/forestboys/commit/248a4b14f9591f08a8c29baa935e3caee83d146f)), closes [#123](https://github.com/VirtueMe/forestboys/issues/123)
* **editor:** check the heading outline of a description ([ca8087c](https://github.com/VirtueMe/forestboys/commit/ca8087c3e43cd8f337dd6a2065c2c322edca9be9)), closes [#127](https://github.com/VirtueMe/forestboys/issues/127)
* **editor:** edit the link text in the link popup ([9ac9083](https://github.com/VirtueMe/forestboys/commit/9ac9083cc226ee3d242f0784dfb244b0f4f64102)), closes [#126](https://github.com/VirtueMe/forestboys/issues/126)
* **editor:** expand the editor to the full window and show the link as an icon ([70f8261](https://github.com/VirtueMe/forestboys/commit/70f8261d049a9a7132a4c86f22413fcb5dc0e84b)), closes [#123](https://github.com/VirtueMe/forestboys/issues/123)
* **editor:** group H3 with its menu, and let outside changes reach the editor ([f55b376](https://github.com/VirtueMe/forestboys/commit/f55b37636e3c926b0e66f0d62da9ab15f26a5ff5)), closes [#127](https://github.com/VirtueMe/forestboys/issues/127)
* **editor:** H4 to H6 in the description editor ([247eaa1](https://github.com/VirtueMe/forestboys/commit/247eaa12705d73868550a720a8e8866986d58f7e)), closes [#127](https://github.com/VirtueMe/forestboys/issues/127)
* **editor:** refuse to save headings that break the outline ([1ad80aa](https://github.com/VirtueMe/forestboys/commit/1ad80aa0b7821339d7ba0ee2c78dd84904788a04)), closes [#127](https://github.com/VirtueMe/forestboys/issues/127)
* **editor:** show, add, change and remove links in the description editor ([c0c89db](https://github.com/VirtueMe/forestboys/commit/c0c89dbbabe24b227c14f66ede4b8ad978f35096)), closes [#110](https://github.com/VirtueMe/forestboys/issues/110)
* **editor:** support bullet and numbered lists ([6981a6a](https://github.com/VirtueMe/forestboys/commit/6981a6a4bc077ff2f91c6595154becf204841715)), closes [#124](https://github.com/VirtueMe/forestboys/issues/124)
* **sync:** store TNA links for AIR 27 references in event descriptions ([38266d1](https://github.com/VirtueMe/forestboys/commit/38266d1593d9bd4716fdeb2e8bd0c847bd7b7ebf)), closes [#106](https://github.com/VirtueMe/forestboys/issues/106)
* **sync:** sync transport name, type, unit and regser from Sanity ([8652ccd](https://github.com/VirtueMe/forestboys/commit/8652ccdd15dbd55177cbad05ffc3f64496ed3934)), closes [#112](https://github.com/VirtueMe/forestboys/issues/112)


### Bug fixes

* **editor:** hang the link and person popups from the toolbar ([c3b8464](https://github.com/VirtueMe/forestboys/commit/c3b8464e9a2913d209f81dc82f39236abff517ff)), closes [#123](https://github.com/VirtueMe/forestboys/issues/123)
* **sync:** import links written with a leading or trailing space ([c1f246f](https://github.com/VirtueMe/forestboys/commit/c1f246f5663b94e519b977febc842094f6d94e83)), closes [#113](https://github.com/VirtueMe/forestboys/issues/113)
* **sync:** import location descriptions from Sanity and keep them in step ([03e5be6](https://github.com/VirtueMe/forestboys/commit/03e5be668433663980b9f68c1015334980dc0ccd)), closes [#99](https://github.com/VirtueMe/forestboys/issues/99)
* **sync:** import station descriptions from Sanity and keep them in step ([f0e46c2](https://github.com/VirtueMe/forestboys/commit/f0e46c22b6af3c1e4100e0ff78ddffb79fb75add)), closes [#99](https://github.com/VirtueMe/forestboys/issues/99)
* **sync:** import transport descriptions from Sanity and keep them in step ([c2324a5](https://github.com/VirtueMe/forestboys/commit/c2324a58afd5e24227443a9ae11918600ee035a7)), closes [#99](https://github.com/VirtueMe/forestboys/issues/99)
* **sync:** rewrite an event description edited in the graph from Sanity ([fd82cc2](https://github.com/VirtueMe/forestboys/commit/fd82cc235c6fdb16645a96f8cc6a88a4f82062c5)), closes [#119](https://github.com/VirtueMe/forestboys/issues/119)
* **transport:** let the editor's unit win over the imported rawUnit ([0d09fbf](https://github.com/VirtueMe/forestboys/commit/0d09fbfe146fd9526cd4b06aef2616c43969097f)), closes [#112](https://github.com/VirtueMe/forestboys/issues/112)
* **transport:** show the unit line and tidy whitespace in transport fields ([951feda](https://github.com/VirtueMe/forestboys/commit/951feda2922d61f8f3ba48f2f26b609e422485f0)), closes [#112](https://github.com/VirtueMe/forestboys/issues/112)

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
