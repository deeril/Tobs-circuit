# DropLag

A React and Vite fleet-dispatch dashboard with self-service driver onboarding, private identity and payout details, route assignment, live location updates, and proof of delivery.

## Admin dashboard

The admin workspace opens to an overview of recorded deliveries, performance trends, mapped delivery destinations, driver availability, and timestamped activity. Deliveries can be searched, filtered, paginated, and reviewed from the dashboard. The sidebar links to the existing Route Planner and Live Tracking views; Customers, Fleet Management, Payments, and Settings are navigation placeholders for later phases. Driver map markers are shown only for fresh GPS updates shared by drivers. Maps use MapLibre GL JS with OpenFreeMap/OpenStreetMap data and do not require a map-provider key.

## Super Admin and Customer Care

The Super Admin dashboard is available at `https://tobs-circuit.vercel.app/#/super-admin`. Sign-in is restricted to the existing Admin account `ayodeletobs@gmail.com`. After password verification, a six-digit one-time code is emailed to that address; it expires after 10 minutes and is invalidated after five incorrect attempts. Production requires the configured PostgreSQL database and SMTP settings.

Admin and Driver users can open Customer Care chat from the profile menu. Chats create support cases; sensitive and unresolved requests are escalated. Customer Care mini-admin users can sign in to the protected support inbox, reply to conversations, and resolve or reopen cases. Super Admin can review case summaries in Support & Disputes.

### Driver self-registration

Drivers can register without a business-generated link. Account creation signs the driver in to an onboarding screen where they provide contact and identity information, parent and next-of-kin details, photographs, vehicle information, next-of-kin consent, and a typed signature after reading the agreement in `src/driver-terms.md` and the driver data notice. The profile becomes active for dispatch after successful completion; drivers then add their bank name and 10-digit account number in the dashboard. Identity, family, photo, and payout details are stored separately from public account fields and encrypted with AES-256-GCM. Businesses see only the limited dispatch profile and fresh live location of eligible drivers within 5 km of either the business origin or delivery pickup. Payout details are not exposed to businesses.

Set `DRIVER_PII_ENCRYPTION_KEY` to a persistent 64-character hexadecimal key in every API environment before drivers submit profiles. For example, generate a new key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and store it in the hosting provider's secret settings. Keep the same key across deployments and backups; losing or changing it makes already-encrypted driver data unreadable.
Drivers opt in with **Share live location** or **Start journey**. Location is read from the device only while sharing is enabled, and requires a secure HTTPS page plus browser permission. The app syncs fresh coordinates and heartbeats while open; admins can view recent driver locations on the Live Tracking map and focus a driver from their profile. Stopping sharing clears the saved coordinates. Browser backgrounding or closing the app can interrupt updates, so locations older than 90 seconds are labelled as last-known (and are not offered as live rider positions).

Drivers also have a separate **Delivery availability** control. The nearby-rider dashboard lists active drivers who opted in to availability, are sharing a location updated within 90 seconds, have an idle route, and have no active delivery. Each business can discover eligible drivers within 5 km of its saved origin or the selected delivery pickup. Admins can filter candidates by the driver's configured zone and view nearby candidates on the fleet map. Distances are straight-line estimates; arrival time is a rough estimate at 20 km/h, not a road-routed ETA. Availability remains in the application state for login/dashboard compatibility and is synchronized to the dispatch profile after the migration is applied.

### Rider delivery offers

When creating a delivery, an admin can select **Save & find riders**. Both the pickup and delivery addresses must be selected from map suggestions so their coordinates are included. Offers go to active, available drivers with a fresh location, an idle route, no other active delivery, and a location within 5 km of either the business origin or pickup. H3 cells narrow the nearby search and exact distance is checked before offers are sent. Each offer shows the business, exact pickup and destination addresses, map directions, package information, proposed earnings when set, and a road distance/time estimate when the configured routing service is available. If it is not, the UI labels the straight-line estimate and warns that road routing is unavailable.

Eligible riders can accept or reject an offer. Offers expire after two minutes; the business can send a new offer from **Unassigned Stops** after expiry or rejection. Structured dispatch uses a partial unique index on active assignments, so only one rider can own a delivery at a time; local JSON mode uses an in-process assignment check. Other riders' offers are closed after acceptance. The business sees the assigned rider and can focus the existing live map on them; the rider's existing location-sharing flow tracks the trip to pickup and continues after the rider confirms collection until proof of delivery.

To search from a newly entered pickup, select both pickup and destination from address suggestions. While the form is open, the nearby-driver panel refreshes and ranks eligible, fresh drivers from that pickup, and can reverse the order; **Show on map** closes the form and focuses the selected driver on the expanded map. Choose **Save & find nearby drivers** to create the delivery and send offers. When a rider accepts, the dispatcher map follows the rider's current leg to pickup and then to the destination.

The business map refreshes authorized rider positions every five seconds and receives authenticated Socket.IO location pushes for active assignments when connected; polling remains the fallback. The nearby marketplace feed refreshes every ten seconds and returns eligible drivers only within 5 km of the current business origin or selected pickup. The rider's browser sends GPS updates at a minimum five-second interval while sharing is enabled. Assigned-rider routes and ETA are recalculated every ten seconds, with a reroute when meaningful deviation is detected. The map labels locations older than 90 seconds as last known rather than live. Backgrounding or closing the rider's browser can interrupt GPS updates. Automatic offer redistribution after rejection or expiry is not enabled: an admin can retry **Find riders**.

### Delivery chat and audio calls

The delivery chat is available to the business and the assigned rider, including after a delivery is completed; failed or cancelled assignments cannot send new messages. The dispatch foundation, communications, call-signaling, and pricing migrations (`20261109_01`, `20261109_02`, `20261110_03`, and `20261110_04`) must be applied to Neon before using those features. For assignments created before the structured dispatch flow, also apply `20261111_05` to backfill assignment records. The migration runner refuses to apply a migration automatically if it finds a partial, untracked schema. Messages are stored in `delivery_messages`; a message notification is created for the other participant, and fetching the conversation records delivery/read timestamps and marks that notification read. The browser retries an uncertain send using a client-generated idempotency ID so a lost response does not create duplicate messages. Message updates use Socket.IO when connected and four-second polling as a fallback.

Audio-only calls are available in delivery conversations and existing Customer Care support cases between the business/driver and verified Super Admin. Calls require an active delivery assignment or an authorized support-thread participant. Signaling is relayed through authenticated Socket.IO; media uses WebRTC audio with short-lived ICE server credentials requested server-side from Twilio Network Traversal Service. Configure `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, and `TWILIO_API_SECRET` only as Vercel server-side environment variables, never as `VITE_*` variables. Voice calls require the additive `20261110_03_dispatch_calls_and_message_idempotency.sql` migration and the Vercel WebSocket endpoint. Vercel closes WebSocket connections at the function duration limit, so clients reconnect automatically; media may need to reconnect if a call's peer connection drops. Without Twilio credentials, calling returns an explicit unavailable error; customer chatbot behavior is unchanged.

### Dispatch foundation migration

`migrations/20261109_01_dispatch_foundation.sql` is an additive PostgreSQL migration for structured deliveries, business-to-rider memberships, rider availability and current locations, offers, assignment history, delivery status history, and GPS history. It preserves the JSONB state as the login and dashboard compatibility store and backfills dispatch rows from it. It briefly takes a PostgreSQL `SHARE` table lock on `tobs_app_state` while backfilling so application writes wait and the copy is consistent. The application uses the structured matching/assignment path only after the migration tables are present; otherwise the existing JSON-backed flow remains in use.

The structured matcher offers eligible riders within a fixed 5 km of either search point. It uses rider availability, a location no older than 90 seconds, zone and vehicle/package limits when their profile and delivery fields are populated, and active assignments. Business-rider membership is not required for public marketplace discovery or a single-delivery offer; explicit active membership and business/rider consent remain required for cross-business batches. The migration backfills existing rider-to-business relationships. Rider GPS history is written only while location sharing is enabled and the rider is available for matching or has an active assignment. The cleanup command's configured retention is 14 days; it deletes in batches of 1,000 and requires `DISPATCH_GPS_CLEANUP_CONFIRM=DELETE_EXPIRED_GPS`. It was not run during development.

`npm test` runs the PostgreSQL integration checks only when `DISPATCH_TEST_DATABASE_URL` is set to a dedicated test database. It exercises concurrent assignment attempts through independent connections, cancellation/reassignment, expiry, authorization filters, and database error propagation. It is not a full multi-process Vercel test. Never point the test variable at the application database; the suite creates and drops its own random schema.

## Super Admin portal


## Run locally

1. Use Node.js 22.12 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`; set `APP_BASE_URL`, `DRIVER_PII_ENCRYPTION_KEY`, and SMTP settings if password-recovery emails are needed. The default MapLibre style requires no browser map key.
4. Run `npm run dev`. The command starts the Vite frontend and API server together.

In non-production mode, the API permits browser requests from `localhost` and `127.0.0.1` so the Vite development server can use the local API. Production requests remain restricted to `FRONTEND_ORIGIN` and the API's own origin.

## Stage 2B maps, geocoding and routing

MapLibre GL JS renders the fleet map using the public OpenFreeMap Liberty style by default; set `VITE_MAPLIBRE_STYLE_URL` to use another compatible style. The public style/tile service is subject to its availability and usage policy; production deployments with substantial traffic should choose an approved hosted plan or operate their own tile service. OpenStreetMap attribution is displayed by MapLibre. The application uses Uber's H3 library for rider discovery, Photon for address search, Valhalla for road routes, and Socket.IO for live updates; these services are independent of the map renderer.

Address autocomplete and reverse geocoding now go through authenticated, rate-limited `/api/geocode/search` and `/api/geocode/reverse` endpoints. Search prefers house-number/street results and formats the street before the neighborhood and city; available detail depends on OpenStreetMap coverage. Set `PHOTON_BASE_URL` to a self-hosted or otherwise approved Photon endpoint in production. For local development only, an unset value uses the public Photon demo, which may throttle or block requests and is not suitable for production traffic. Photon is Apache-2.0 licensed; self-hosting requires a JVM and storage sized for the chosen data extract.

Road routes are requested through the authenticated `/api/routing/route` endpoint. Set `VALHALLA_BASE_URL` to a reachable Valhalla service and `VALHALLA_PROFILE` to `auto`, `motorcycle`, `bicycle`, or `pedestrian` (`driving`, `cycling`, and `walking` are accepted aliases). The default `auto` costing models a car; use `motorcycle` only when your Valhalla build has suitable motorcycle costing/data and validate its routes before relying on its ETAs. Do not expose an unauthenticated routing service directly to the public internet. If Valhalla is unset or unavailable, the UI explicitly labels its result as a straight-line estimate.

**Closest to Farthest** sequences pending stops on the server using a Valhalla road-distance matrix and nearest-next-stop selection from the rider's GPS location, which must be no older than 90 seconds. The saved stop numbers, order, and road geometry are stored with the existing JSONB application state, so no migration is introduced; completion preserves historical stop numbers while updating the pending route. Admins/businesses and riders receive route updates through the existing authenticated Socket.IO rooms, with polling as a fallback. Grouped multi-delivery acceptance is still blocked by the existing one-active-delivery assignment protection. No verified traffic-data provider is configured, so the map explicitly reports traffic as unavailable rather than showing estimated traffic as live data.

The `ops/osrm/` directory contains an older optional OSRM setup and is no longer used by the app's routing endpoint. Valhalla itself must be hosted separately; provide its reachable `/route` service URL via `VALHALLA_BASE_URL`. Hosting map/routing data requires compute, storage, bandwidth, monitoring, and recurring map-data updates.

H3 JavaScript (Apache-2.0) is used at resolution 7 to narrow rider candidates in the current matcher, with exact distance still enforced. No new database migration is required for H3. MapLibre GL JS is BSD-3-Clause and provides the interactive map renderer.

On the business dashboard, the authorized rider-map feed polls every 5 seconds as a fallback and receives authenticated Socket.IO location updates for active assignments when connected. Nearby marketplace candidates are polled every 10 seconds and limited to the 5 km business-origin/pickup search area. An assigned rider with a stale GPS fix is marked as a last-known position with its timestamp. In MapLibre mode, active deliveries show the rider's current leg and an ETA/distance estimate; the route refreshes at most every 30 seconds and is recalculated sooner after more than 500 metres of route deviation. The map draws at most eight active routes. The pickup-to-destination leg begins when the rider confirms collection and the delivery enters `HEADING_TO_DESTINATION`. These ETA values inherit the configured Valhalla costing profile's limitations.

Google OR-Tools is Apache-2.0, but its official wrappers target Python, C#, and Java rather than Node.js. It is not integrated yet: the current application lacks total rider capacity, delivery deadline fields, batch-offer acceptance, and an explicit rider/business cross-business consent flow. Those are prerequisites for safely turning a route suggestion into atomic active assignments. Do not treat the current multi-stop route planner as a dispatch optimizer or as a safe cross-business batch assignment.

MapTiler Cloud is the straightforward hosted option for map tiles; a self-hosted OSM tile stack is the no-vendor-request-fee alternative. Valhalla and Photon are open-source software but require hosting and data operations. Actual self-hosting monthly cost depends on the cloud/region and traffic; no service, key, paid plan, data download, or deployment has been activated by this repository.

`npm start` serves the production build and API from one Node process. Run `npm run build` first.

## Deploy on Vercel with Neon

Vercel hosts the frontend, Express HTTP API, login/session endpoints, and Socket.IO WebSocket endpoint. Login and authorization remain app-managed; account and session data are persisted in Neon, with no separate authentication host. Neon also provides the cross-instance realtime event relay. Vercel WebSockets are currently a public beta; connections close when the configured function duration is reached, and the clients reconnect automatically. Map and chat polling remain available as fallbacks. No Render service is required.

The login form's **Remember me on this device** option persists the secure session for 30 days. When unchecked, the browser uses a session cookie and the server expires the session after 12 hours. Password recovery sends a one-time email code that expires after 15 minutes; reset passwords must be at least 12 characters.

1. Import this repository into your Vercel account and deploy it as a Vite project.
2. Create or select a Neon project and set its pooled PostgreSQL connection string as the server-side `DATABASE_URL` in Vercel. The app creates its account-state and realtime-event tables on the first API request.
3. Configure these server-side Vercel environment variables: `DATABASE_URL`, `DRIVER_PII_ENCRYPTION_KEY` (a persistent 64-character hexadecimal key), `APP_BASE_URL` (the public app URL), and `FRONTEND_ORIGIN` (the exact public origin, without a path). Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` for password-recovery and owner verification emails.
4. To retain audio calling, set `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, and `TWILIO_API_SECRET` as server-side variables. For address search and road routing, configure the approved `PHOTON_BASE_URL` and `VALHALLA_BASE_URL` services. Never prefix server secrets with `VITE_`.
5. Apply the required SQL migrations to Neon once, in order: `20261109_01_dispatch_foundation.sql`, `20261109_02_dispatch_batches_and_communications.sql`, `20261110_03_dispatch_calls_and_message_idempotency.sql`, and `20261110_04_public_driver_marketplace_and_pricing.sql`. Apply `20261111_05_global_rider_assignment_protection.sql` when backfilling existing assignments. Review the schema and back up existing data before applying migrations to a database that already contains production data.
6. Leave `VITE_API_BASE_URL`, `VITE_SOCKET_URL`, and `VITE_SOCKET_PATH` blank when the frontend and backend use the same Vercel project. The app uses same-origin API and WebSocket paths by default. If the frontend is hosted separately, set `VITE_API_BASE_URL` to the Vercel origin and set `VITE_SOCKET_PATH=/api/socket`; set `VITE_SOCKET_URL` only when using a separate Socket.IO server. Redeploy after changing environment variables because Vite embeds public variables at build time.

The Socket.IO endpoint uses Vercel WebSocket support and Neon-backed event fanout so API invocations and WebSocket function instances can notify one another. The configured 300-second function duration means a long-lived socket reconnects periodically; verify WebSockets are enabled for the Vercel project and review current plan limits before production use.

## Private owner dashboard

Open `https://tobs-circuit.vercel.app/#/super-admin`, enter the registered owner's password, then enter the code sent to `ayodeletobs@gmail.com`. Access requires the existing Admin account with that exact email; the API does not allow other account emails to request or verify the code. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`, plus `DATABASE_URL`, in Vercel's Production environment and redeploy after changing variables. Never expose SMTP credentials as `VITE_` variables.

The dashboard refreshes business, driver, delivery, support-chat summary, and basic API/storage status data every 15 seconds. Customer Care accounts can sign in to the support inbox, reply to cases, and resolve or reopen them.

When SMTP is configured, Forgot password sends an 8-digit, single-use recovery code that expires after 15 minutes. The driver/admin enters that code in the app with their new password. A successful SMTP response means the mail server accepted the message for delivery; it does not guarantee inbox placement. If SMTP is missing or rejects a message, the app reports a categorized, credential-safe hint. SMTP failure logs contain only the provider error code and response code. A missing `DATABASE_URL` in production is reported as a service error rather than risking account or recovery state after a restart.

The map uses Lagos, Nigeria as its initial center and MapLibre GL JS for rendering. The default OpenFreeMap style requires no API key; set `VITE_MAPLIBRE_STYLE_URL` only when using a different style provider. Driver locations and delivery stops are rendered as interactive MapLibre markers, while assigned-delivery routes and ETAs come from the authenticated Valhalla-backed API. Preview sessions display static rider fixtures labeled "Preview"; they do not represent live GPS locations.

GitHub Pages is configured to call the production API at `https://tobs-circuit.vercel.app`; the API allows the Pages origin `https://deeril.github.io` for credentialed requests. Keep the frontend API URL and server CORS origin in sync if either domain changes. For a single Vercel project these can be left blank; the frontend calls `/api` on the same origin. On GitHub Pages, real accounts and cross-device tracking require the configured API and its persistent PostgreSQL connection.

## Local server configuration

- The local API stores accounts, legacy invitation records, route stops, driver state, and sessions in `DATA_DIRECTORY/store.json` (defaults to the ignored `data/` folder).
- Set `DATABASE_URL` locally if you want to exercise the Neon-backed store instead of the local JSON file.
- Use HTTPS in production. GPS sharing requires driver permission and remains visible while the location is fresh.
- Accounts from the previous browser-only prototype are not automatically imported.

### PostgreSQL dispatch integration tests

The PostgreSQL integration suite creates a temporary schema and drops it when the run finishes. Use a dedicated, disposable PostgreSQL database for this suite; never point it at production or the application database. Put its connection string in the git-ignored `.env.dispatch-test.local` file as `DISPATCH_TEST_DATABASE_URL=postgresql://...`. Do not share that connection string in chat or commit the file. The `npm run test:pg` command loads that local setting, refuses to run when it matches the application's configured database, and runs the full 21-test suite. This test command does not apply repository migrations.
