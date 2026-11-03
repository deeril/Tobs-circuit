# Tobs Route Circuit

A React and Vite fleet-dispatch dashboard with admin-owned driver accounts, email invitations, route assignment, live location updates, and proof of delivery.

## Run locally

1. Use Node.js 22.12 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`; set `APP_BASE_URL` and configure SMTP for password-reset emails and optional driver-invitation emails. Add your restricted Google Maps browser key as `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` (do not commit that file).
4. Run `npm run dev`. The command starts the Vite frontend and API server together.

`npm start` serves the production build and API from one Node process. Run `npm run build` first.

## Deploy on Vercel from Git

Vercel can host both the Vite frontend and the Express API. The `/api` serverless function persists application data and sessions in Neon Postgres; local JSON-file storage is used only when running outside Vercel.

1. Import this Git repository into the Tobs Vercel team and deploy it. Vercel builds the frontend and routes `/api/*` to the Express function.
2. Add the Neon integration to the Vercel project. Ensure it provides `DATABASE_URL` to the function in Production and Preview. The app creates its single-row JSONB state table on the first API request.
3. Set `APP_BASE_URL` to the complete Vercel app URL, for example `https://your-project.vercel.app/` (no `/Tobs-circuit/` path).
4. Configure `VITE_GOOGLE_MAPS_API_KEY` in Vercel to enable the interactive Google map and native live driver pins. In Google Cloud, enable **Maps JavaScript API**, enable billing, and restrict the key to your Vercel site referrer. The key is included in the browser bundle, so referrer restrictions are essential. `VITE_GOOGLE_MAP_ID` is optional; the default demo map ID supports advanced rider markers.
5. Add SMTP environment variables if you want password-reset and invitation emails. Driver application links still work without SMTP.
6. Redeploy after adding or changing environment variables. Git pushes to the connected branch trigger new deployments automatically.

## Deploy on Render

Render does not provide an email inbox or SMTP relay. The app sends driver invitations and password-recovery codes through the SMTP service you configure; both features use the same mail settings.

1. Create a Render **PostgreSQL** database and a Node web service for this repository. Use the database's **internal** connection string for the web service when both are in the same Render region.
2. Set `DATABASE_URL` to that PostgreSQL connection string. Production now requires this persistent database instead of writing accounts, invitations, and reset tokens to Render's temporary service filesystem.
3. Set `NODE_ENV` to `production` and `APP_BASE_URL` to the public service URL, for example `https://your-service.onrender.com/`. Use the real frontend URL if the frontend is hosted separately.
4. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` using credentials from an SMTP email provider. The sender address in `SMTP_FROM` must be authorized by that provider. Keep these values in Render's environment settings; never put credentials in frontend variables or source control.
5. Deploy with the web service's build command `npm install && npm run build` and start command `npm start`. After changing environment variables, redeploy the service.

When SMTP is configured, creating an invitation sends its application link to the entered email, and Forgot password sends an 8-digit, single-use recovery code that expires after 15 minutes. The driver/admin enters that code in the app with their new password. Invitation links are single-use and remain available until redeemed or replaced by a newer invitation for the same driver. A successful SMTP response means the mail server accepted the message for delivery; it does not guarantee inbox placement. If SMTP is missing or rejects a message, the app reports a categorized, credential-safe hint and keeps the copyable application link available. SMTP failure logs contain only the provider error code and response code. A missing `DATABASE_URL` in production is reported as a service error rather than risking invitation links becoming invalid after a restart.

The map uses Lagos, Nigeria as its initial center. Without a Google Maps key, the app shows the standard keyless Google Maps embed; add the key to enable interactive moving driver pins. For GitHub Pages, add a repository Actions secret named `VITE_GOOGLE_MAPS_API_KEY` and restrict the key to the Pages site referrer (for this repository, `https://deeril.github.io/Tobs-circuit/*`). The deployment workflow passes that secret only to the frontend build. For local development, create a key in Google Cloud, enable billing and **Maps JavaScript API**, and add an HTTP referrer restriction for `http://localhost:5173/*` (and `http://127.0.0.1:5173/*` if you use that host). Put the key in `.env.local`, restart Vite, and check the browser console if the map still falls back. The key is necessarily visible in the frontend bundle, so use a browser key restricted by allowed sites and APIs; never put a service-account key or OAuth token in frontend code.

This app loads the Maps JavaScript API and uses advanced markers; it does not use the `<gmp-map>` custom element from the sample. The Route Optimization API example is a separate server-side feature, not required to display the map or driver pins. Do not call it from the browser with a service-account credential or access token.

If the frontend and API are on different domains, set `VITE_API_BASE_URL` to the API origin and `FRONTEND_ORIGIN` to the exact frontend origin. For a single Vercel project these can be left blank; the frontend calls `/api` on the same origin. On GitHub Pages without an API URL, the app remains a browser-only sample preview and does not provide real accounts or cross-device tracking.

## Local server configuration

- The local API stores accounts, invitations, route stops, driver state, and sessions in `DATA_DIRECTORY/store.json` (defaults to the ignored `data/` folder).
- Set `DATABASE_URL` locally if you want to exercise the Neon-backed store instead of the local JSON file.
- Use HTTPS in production. GPS sharing requires driver permission and remains visible while the location is fresh.
- Accounts from the previous browser-only prototype are not automatically imported.
