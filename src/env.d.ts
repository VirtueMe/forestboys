/** Injected by vite.config.ts (`define`). */
declare const __APP_VERSION__: string
/** Short commit the bundle was built from; '' when unknown. */
declare const __APP_COMMIT__: string
/** Commits after the latest release tag; null when git could not tell. */
declare const __APP_SINCE__: import('./utils/sinceRelease.ts').SinceRelease | null
