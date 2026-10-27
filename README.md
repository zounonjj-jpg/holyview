# HOLYVIEW

Responsive Christian streaming web app (Vite + Supabase), with a progressive web app shell.

## Current implementation
- Premium dark/cinematic responsive landing page (rose accent, green secondary accent).
- Original SVG logo and favicon.
- PWA manifest and service worker (app shell cache only; protected media is never cached by the service worker).
- Supabase Auth email/password registration and sign-in.
- Registration requires full name, email, password, country and country-aware phone validation with `libphonenumber-js`.
- Catalog reads published films and tracks from Supabase; demo posters are explicitly illustrative and have no playable media.
- Database migration adds profile signup metadata, trailers, media assets and a payments table kept inactive.

## Configure
The project uses the Supabase project URL and publishable key in `src/main.js`. A publishable/anon key is intended for browser use; never place a Supabase service-role key or other server secret in client code.

## Development
```sh
npm install
npm run dev
npm run build
npm run preview
```

## Product requirements still to complete
- Server-side phone validation and optional phone/SMS verification (client validation is not a security boundary).
- Server-side trial metering that measures actual playback time; the browser must not be trusted to report its own viewing time.
- Protected media signing/player, admin dashboard and role provisioning.
- Google/Microsoft OAuth setup.
- Entitlement checks for PRO/ELITE; secure offline playback requires a native/mobile approach and appropriate DRM.
- Accessibility, cross-browser testing, automated tests and production media/legal-rights configuration.

No real payments are enabled. Demo content is not represented as licensed or playable content.
