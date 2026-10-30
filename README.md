# Tobs Route Circuit

A React and Vite fleet-dispatch dashboard with admin-owned driver accounts, email invitations, route assignment, live location updates, and proof of delivery.

## Run locally

1. Use Node.js 22.12 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`; set `APP_BASE_URL` and configure SMTP for password-reset emails and optional driver-invitation emails. Keep `.env` private.
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

The map uses Lagos, Nigeria as its initial center. Without a Google Maps key, the app shows the standard keyless Google Maps embed; add the key to enable interactive moving driver pins. The first HTML example is a map custom element, while the second snippet is a JavaScript API loader. This app loads the Maps JavaScript API and uses advanced markers.

If the frontend and API are on different domains, set `VITE_API_BASE_URL` to the API origin and `FRONTEND_ORIGIN` to the exact frontend origin. For a single Vercel project these can be left blank; the frontend calls `/api` on the same origin. On GitHub Pages without an API URL, the app remains a browser-only sample preview and does not provide real accounts or cross-device tracking.

## Local server configuration

- The local API stores accounts, invitations, route stops, driver state, and sessions in `DATA_DIRECTORY/store.json` (defaults to the ignored `data/` folder).
- Set `DATABASE_URL` locally if you want to exercise the Neon-backed store instead of the local JSON file.
- Use HTTPS in production. GPS sharing requires driver permission and remains visible while the location is fresh.
- Accounts from the previous browser-only prototype are not automatically imported.
