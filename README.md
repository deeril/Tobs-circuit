# Tobs Route Circuit

A React and Vite fleet-dispatch dashboard with admin-owned driver accounts, email invitations, route assignment, live location updates, and proof of delivery.

## Admin dashboard

The admin workspace opens to an overview of recorded deliveries, performance trends, mapped delivery destinations, driver availability, and timestamped activity. Deliveries can be searched, filtered, paginated, and reviewed from the dashboard. The sidebar links to the existing Route Planner and Live Tracking views; Customers, Fleet Management, Payments, and Settings are navigation placeholders for later phases. Driver map markers are shown only for fresh GPS updates shared by drivers. Maps use MapLibre GL JS with OpenFreeMap/OpenStreetMap data and do not require a map-provider key.

## Super Admin and Customer Care

The Super Admin dashboard is available at `https://tobs-circuit.vercel.app/#/super-admin`. Sign-in is restricted to the existing Admin account `ayodeletobs@gmail.com`. After password verification, a six-digit one-time code is emailed to that address; it expires after 10 minutes and is invalidated after five incorrect attempts. Production requires the configured PostgreSQL database and SMTP settings.

Admin and Driver users can open Customer Care chat from the profile menu. Chats create support cases; sensitive and unresolved requests are escalated. Customer Care mini-admin users can sign in to the protected support inbox, reply to conversations, and resolve or reopen cases. Super Admin can review case summaries in Support & Disputes.
Drivers opt in with **Share live location** or **Start journey**. Location is read from the device only while sharing is enabled, and requires a secure HTTPS page plus browser permission. The app syncs fresh coordinates and heartbeats while open; admins can view recent driver locations on the Live Tracking map and focus a driver from their profile. Stopping sharing clears the saved coordinates. Browser backgrounding or closing the app can interrupt updates, so locations older than 90 seconds are labelled as last-known (and are not offered as live rider positions).

Drivers also have a separate **Delivery availability** control. The existing nearby-rider dashboard lists active drivers who opted in to availability, are sharing a location updated within 90 seconds, have an idle route, and have no active delivery. Admins can filter candidates by the driver's configured zone and view them on the existing fleet map. Distance is a straight-line estimate from the saved route origin (or the Ikeja depot fallback); arrival time is a rough estimate at 20 km/h, not a road-routed ETA. Availability remains in the application state for login/dashboard compatibility and is synchronized to the dispatch profile after the migration is applied.

### Rider delivery offers

When creating a delivery, an admin can select **Save & find riders**. Both the pickup and delivery addresses must be selected from map suggestions so their coordinates are included. Before the dispatch migration, offers are limited to active, available riders in the same fleet, with a fresh location, an idle route, no other active delivery, and a 5 km radius. After migration, matching uses active business-rider membership and 3/5/10 km search rounds. H3 cells narrow the nearby search and exact spherical distance remains the final radius check. Each offer shows the business, exact pickup and destination addresses, map directions, package information, proposed earnings when set, and a road distance/time estimate when the configured routing service is available. If it is not, the UI labels the straight-line estimate and warns that road routing is unavailable.

Eligible riders can accept or reject an offer. Offers expire after two minutes; the business can send a new offer from **Unassigned Stops** after expiry or rejection. Structured dispatch uses a partial unique index on active assignments, so only one rider can own a delivery at a time; local JSON mode uses an in-process assignment check. Other riders' offers are closed after acceptance. The business sees the assigned rider and can focus the existing live map on them; the rider's existing location-sharing flow tracks the trip to pickup and continues after the rider confirms collection until proof of delivery.

To search from a newly entered pickup, select both pickup and destination from address suggestions. While the form is open, the nearby-driver panel refreshes and ranks eligible, fresh drivers from that pickup, and can reverse the order; **Show on map** closes the form and focuses the selected driver on the expanded map. Choose **Save & find nearby drivers** to create the delivery and send offers. When a rider accepts, the dispatcher map follows the rider's current leg to pickup and then to the destination.

The business map refreshes authorized rider positions every five seconds and receives authenticated Socket.IO location pushes when the app is running on its Node server; polling remains the fallback. The rider's browser sends GPS updates at a minimum five-second interval while sharing is enabled. Assigned-rider routes and ETA are recalculated every ten seconds, with a reroute when meaningful deviation is detected. The map labels locations older than 90 seconds as last known rather than live. Backgrounding or closing the rider's browser can interrupt GPS updates. Automatic offer redistribution after rejection or expiry is not enabled: an admin can retry **Find riders**.

### Delivery chat and audio calls

The delivery chat is available to the business and the currently assigned rider. Messages are stored in `delivery_messages`; a message notification is created for the other participant, and fetching the conversation records delivery/read timestamps and marks that notification read. The browser retries an uncertain send using a client-generated idempotency ID so a lost response does not create duplicate messages. Message updates use Socket.IO when connected and four-second polling as a fallback.

Audio-only calls are available in delivery conversations and existing Customer Care support cases between the business/driver and verified Super Admin. Calls require an active delivery assignment or an authorized support-thread participant. Signaling is relayed through authenticated Socket.IO; media uses WebRTC audio with short-lived ICE server credentials requested server-side from Twilio Network Traversal Service. Configure `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, and `TWILIO_API_SECRET` only in the Node service's secret environment, never as `VITE_*` variables. Voice calls require the additive `20261110_03_dispatch_calls_and_message_idempotency.sql` migration and a persistent Node Socket.IO host. Without Twilio credentials, calling returns an explicit unavailable error; customer chatbot behavior is unchanged.

### Dispatch foundation migration

`migrations/20261109_01_dispatch_foundation.sql` is an additive PostgreSQL migration for structured deliveries, business-to-rider memberships, rider availability and current locations, offers, assignment history, delivery status history, and GPS history. It preserves the JSONB state as the login and dashboard compatibility store and backfills dispatch rows from it. It briefly takes a PostgreSQL `SHARE` table lock on `tobs_app_state` while backfilling so application writes wait and the copy is consistent. The application uses the structured matching/assignment path only after the migration tables are present; otherwise the existing JSON-backed flow remains in use. The migration is not run automatically.

The structured matcher offers every eligible rider within 5 km, then expands to 10 km only when no rider is found within 5 km. It uses active business-rider membership, rider availability, a location no older than 90 seconds, zone, vehicle/package limits when their profile and delivery fields are populated, and active assignments. Existing rider registration collects a vehicle plate, not vehicle type or package capacity, and current delivery UI does not set required vehicle type; those compatibility filters therefore need product fields before they can be fully used. Membership is many-to-many; the migration backfills each current rider-to-business relationship. A cross-business rider must have an explicit active membership row, and membership invitation/consent management is not yet exposed in the UI. Rider GPS history is written only while location sharing is enabled and the rider is available for matching or has an active assignment. The cleanup command's configured retention is 14 days; it deletes in batches of 1,000 and requires `DISPATCH_GPS_CLEANUP_CONFIRM=DELETE_EXPIRED_GPS`. It was not run during development.

`npm test` runs the PostgreSQL integration checks only when `DISPATCH_TEST_DATABASE_URL` is set to a dedicated test database. It exercises concurrent assignment attempts through independent connections, cancellation/reassignment, expiry, authorization filters, and database error propagation. It is not a full multi-process Vercel test. Never point the test variable at the application database; the suite creates and drops its own random schema.

## Super Admin portal


## Run locally

1. Use Node.js 22.12 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`; set `APP_BASE_URL` and configure SMTP for password-reset emails and optional driver-invitation emails. The default MapLibre style requires no browser map key.
4. Run `npm run dev`. The command starts the Vite frontend and API server together.

In non-production mode, the API permits browser requests from `localhost` and `127.0.0.1` so the Vite development server can use the local API. Production requests remain restricted to `FRONTEND_ORIGIN` and the API's own origin.

## Stage 2B maps, geocoding and routing

MapLibre GL JS renders the fleet map using the public OpenFreeMap Liberty style by default; set `VITE_MAPLIBRE_STYLE_URL` to use another compatible style. The public style/tile service is subject to its availability and usage policy; production deployments with substantial traffic should choose an approved hosted plan or operate their own tile service. OpenStreetMap attribution is displayed by MapLibre. The application uses Uber's H3 library for rider discovery, Photon for address search, Valhalla for road routes, and Socket.IO for live updates; these services are independent of the map renderer.

Address autocomplete and reverse geocoding now go through authenticated, rate-limited `/api/geocode/search` and `/api/geocode/reverse` endpoints. Set `PHOTON_BASE_URL` to a self-hosted or otherwise approved Photon endpoint in production. For local development only, an unset value uses the public Photon demo, which may throttle or block requests and is not suitable for production traffic. Photon is Apache-2.0 licensed; self-hosting requires a JVM and storage sized for the chosen data extract.

Road routes are requested through the authenticated `/api/routing/route` endpoint. Set `VALHALLA_BASE_URL` to a reachable Valhalla service and `VALHALLA_PROFILE` to `auto`, `motorcycle`, `bicycle`, or `pedestrian` (`driving`, `cycling`, and `walking` are accepted aliases). The default `auto` costing models a car; use `motorcycle` only when your Valhalla build has suitable motorcycle costing/data and validate its routes before relying on its ETAs. Do not expose an unauthenticated routing service directly to the public internet. If Valhalla is unset or unavailable, the UI explicitly labels its result as a straight-line estimate.

**Closest to Farthest** sequences pending stops on the server using a Valhalla road-distance matrix and nearest-next-stop selection from the rider's GPS location, which must be no older than 90 seconds. The saved stop numbers, order, and road geometry are stored with the existing JSONB application state, so no migration is introduced; completion preserves historical stop numbers while updating the pending route. Admins/businesses and riders receive route updates through the existing authenticated Socket.IO rooms, with polling as a fallback. Grouped multi-delivery acceptance is still blocked by the existing one-active-delivery assignment protection. No verified traffic-data provider is configured, so the map explicitly reports traffic as unavailable rather than showing estimated traffic as live data.

The `ops/osrm/` directory contains an older optional OSRM setup and is no longer used by the app's routing endpoint. Valhalla itself must be hosted separately; provide its reachable `/route` service URL via `VALHALLA_BASE_URL`. Hosting map/routing data requires compute, storage, bandwidth, monitoring, and recurring map-data updates.

H3 JavaScript (Apache-2.0) is used at resolution 7 to narrow rider candidates in the current matcher, with exact distance still enforced. No new database migration is required for H3. MapLibre GL JS is BSD-3-Clause and provides the interactive map renderer.

On the business dashboard, the authorized rider-map feed polls every 5 seconds as a fallback and also receives authenticated Socket.IO location updates when the app is running on its Node server. Fresh offer candidates and assigned riders are shown; an assigned rider with a stale GPS fix is marked as a last-known position with its timestamp. In MapLibre mode, active deliveries show the rider's current leg and an ETA/distance estimate; the route refreshes at most every 30 seconds and is recalculated sooner after more than 500 metres of route deviation. The map draws at most eight active routes. The pickup-to-destination leg begins when the rider confirms collection and the delivery enters `HEADING_TO_DESTINATION`. These ETA values inherit the configured Valhalla costing profile's limitations.

Google OR-Tools is Apache-2.0, but its official wrappers target Python, C#, and Java rather than Node.js. It is not integrated yet: the current application lacks total rider capacity, delivery deadline fields, batch-offer acceptance, and an explicit rider/business cross-business consent flow. Those are prerequisites for safely turning a route suggestion into atomic active assignments. Do not treat the current multi-stop route planner as a dispatch optimizer or as a safe cross-business batch assignment.

MapTiler Cloud is the straightforward hosted option for map tiles; a self-hosted OSM tile stack is the no-vendor-request-fee alternative. Valhalla and Photon are open-source software but require hosting and data operations. Actual self-hosting monthly cost depends on the cloud/region and traffic; no service, key, paid plan, data download, or deployment has been activated by this repository.

`npm start` serves the production build and API from one Node process. Run `npm run build` first.

## Deploy on Vercel from Git

Vercel can host the Vite frontend and the Express API, but Vercel's serverless function does not host a persistent Socket.IO server. For live map pushes, run the Node API on Render and use Vercel for the frontend; polling remains available when the Node Socket.IO endpoint is not configured.

1. Import this Git repository into the Tobs Vercel team and deploy it. Vercel builds the frontend and routes `/api/*` to the Express function.
2. For the realtime setup, deploy the Node service from `render.yaml` first and configure `DATABASE_URL`, `APP_BASE_URL`, `FRONTEND_ORIGIN`, `PHOTON_BASE_URL`, `VALHALLA_BASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, and `TWILIO_API_SECRET` in Render. Set `FRONTEND_ORIGIN` to the exact Vercel site origin (without a path). Keep the Render service to one instance; multi-instance Socket.IO requires shared session and Socket.IO adapter infrastructure that is not configured here. Keep Twilio credentials server-side; never prefix them with `VITE_`.
3. In Vercel, set `VITE_API_BASE_URL` and `VITE_SOCKET_URL` to the Render service URL (for example `https://your-service.onrender.com`) so frontend API calls and live sockets use the persistent Node server rather than serverless routes. These are public frontend build variables, not secrets.
4. If instead you intentionally use Vercel's serverless API, configure Neon `DATABASE_URL` there; the app creates its single-row JSONB state table on the first API request, but map updates use polling rather than Socket.IO.
5. Add SMTP environment variables if you want password-reset and invitation emails. Driver application links still work without SMTP.
6. Redeploy after changing frontend environment variables because Vite embeds them at build time. Git pushes to the connected branch trigger new deployments automatically.

## Private owner dashboard

Open `https://tobs-circuit.vercel.app/#/super-admin`, enter the registered owner's password, then enter the code sent to `ayodeletobs@gmail.com`. Access requires the existing Admin account with that exact email; the API does not allow other account emails to request or verify the code. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`, plus `DATABASE_URL`, in Vercel's Production environment and redeploy after changing variables. Never expose SMTP credentials as `VITE_` variables.

The dashboard refreshes business, driver, invitation, delivery, support-chat summary, and basic API/storage status data every 15 seconds. Customer Care accounts can sign in to the support inbox, reply to cases, and resolve or reopen them.

## Deploy on Render

Render does not provide an email inbox or SMTP relay. The app sends driver invitations and password-recovery codes through the SMTP service you configure; both features use the same mail settings.

1. Create a Render **PostgreSQL** database and a Node web service for this repository. Use the database's **internal** connection string for the web service when both are in the same Render region.
2. Set `DATABASE_URL` to that PostgreSQL connection string. Production now requires this persistent database instead of writing accounts, invitations, and reset tokens to Render's temporary service filesystem.
3. Set `NODE_ENV` to `production` and `APP_BASE_URL` to the public service URL, for example `https://your-service.onrender.com/`. Use the real frontend URL if the frontend is hosted separately.
4. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` using credentials from an SMTP email provider. The sender address in `SMTP_FROM` must be authorized by that provider. Keep these values in Render's environment settings; never put credentials in frontend variables or source control.
5. Deploy with the web service's build command `npm install && npm run build` and start command `npm start`. After changing environment variables, redeploy the service.

When SMTP is configured, creating an invitation sends its application link to the entered email, and Forgot password sends an 8-digit, single-use recovery code that expires after 15 minutes. The driver/admin enters that code in the app with their new password. Invitation links are single-use and remain available until redeemed or replaced by a newer invitation for the same driver. A successful SMTP response means the mail server accepted the message for delivery; it does not guarantee inbox placement. If SMTP is missing or rejects a message, the app reports a categorized, credential-safe hint and keeps the copyable application link available. SMTP failure logs contain only the provider error code and response code. A missing `DATABASE_URL` in production is reported as a service error rather than risking invitation links becoming invalid after a restart.

The map uses Lagos, Nigeria as its initial center and MapLibre GL JS for rendering. The default OpenFreeMap style requires no API key; set `VITE_MAPLIBRE_STYLE_URL` only when using a different style provider. Driver locations and delivery stops are rendered as interactive MapLibre markers, while assigned-delivery routes and ETAs come from the authenticated Valhalla-backed API. Preview sessions display static rider fixtures labeled "Preview"; they do not represent live GPS locations.

GitHub Pages is configured to call the production API at `https://tobs-circuit.vercel.app`; the API allows the Pages origin `https://deeril.github.io` for credentialed requests. Keep the frontend API URL and server CORS origin in sync if either domain changes. For a single Vercel project these can be left blank; the frontend calls `/api` on the same origin. On GitHub Pages, real accounts and cross-device tracking require the configured API and its persistent PostgreSQL connection.

## Local server configuration

- The local API stores accounts, invitations, route stops, driver state, and sessions in `DATA_DIRECTORY/store.json` (defaults to the ignored `data/` folder).
- Set `DATABASE_URL` locally if you want to exercise the Neon-backed store instead of the local JSON file.
- Use HTTPS in production. GPS sharing requires driver permission and remains visible while the location is fresh.
- Accounts from the previous browser-only prototype are not automatically imported.

### PostgreSQL dispatch integration tests

The PostgreSQL integration suite creates a temporary schema and drops it when the run finishes. Use a dedicated, disposable PostgreSQL database for this suite; never point it at production or the application database. Put its connection string in the git-ignored `.env.dispatch-test.local` file as `DISPATCH_TEST_DATABASE_URL=postgresql://...`. Do not share that connection string in chat or commit the file. The `npm run test:pg` command loads that local setting, refuses to run when it matches the application's configured database, and runs the full 21-test suite. This test command does not apply repository migrations.
