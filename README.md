# Tobs Route Circuit

A React and Vite fleet-dispatch dashboard with admin-owned driver accounts, email invitations, route assignment, live location updates, and proof of delivery.

## Run locally

1. Use Node.js 22.12 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set your SMTP host, port, username, password, sender address, and `APP_BASE_URL`. Keep `.env` private.
4. Run `npm run dev`. The command starts the Vite frontend and API server together.

`npm start` serves the production build and API from one Node process. Run `npm run build` first.

## Server configuration

- The API stores accounts, invitations, route stops, and driver status in `DATA_DIRECTORY/store.json` (defaults to the ignored `data/` folder). Back this file up and use persistent storage in production.
- Password hashes, one-use invitation tokens, admin ownership, and SMTP sending are handled on the server. SMTP credentials must only be configured in server environment variables.
- `APP_BASE_URL` must be the public app URL, including `/Tobs-circuit/` when deployed with this Vite base path.
- Use HTTPS in production; the session cookie is secure when `NODE_ENV=production`.
- Route stops are synchronized with the API, and driver/admin dashboards poll fleet updates every 10 seconds. GPS sharing requires driver permission and remains visible while the location is fresh.
- Accounts created by the previous browser-only prototype are not automatically imported. Create a new admin account in the server-backed version, then invite drivers to join that fleet.

## GitHub Pages preview

GitHub Pages serves the frontend as a static demo and does not run this Node API. The Pages preview uses sample admin and rider sessions; changes and uploaded fleet logos are stored only in the current browser. Account login, password recovery, email delivery, and cross-device live location sharing require deploying the Node server separately with the environment variables above.
