# LayerForge - 3D printing store

A small local online store for 3D printers, filament, resin, parts and printed models.
MongoDB + Express + React + Node. Runs only on this computer.

## Run it

You need Node.js 20.12+ and MongoDB running locally (`mongod`).

```bash
npm run setup   # first time only: installs packages
npm start       # builds the site and starts it
```

Open http://localhost:4000

Sample products are added automatically the first time. `npm run seed` resets them.

Other commands:

- `npm test` - runs the 22 API tests (uses a separate `layerforge_test` database)
- `npm run dev` - development mode with live reload at http://localhost:5173

## What it does

- Browse products, filter by category, search
- Cart (saved in the browser)
- Create account, log in, log out
- Checkout with a delivery address (cash on delivery - no card details)
- "My orders" history

## Security built in

- Passwords are hashed with bcrypt; only the hash is stored
- Login uses a signed cookie that page scripts can't read (httpOnly, SameSite=Strict)
- Sign-up and log-in are rate limited (20 attempts per 15 minutes)
- Every input is validated on the server; MongoDB operator injection is rejected
- Prices and totals are always calculated on the server from the database
- Stock can't go below zero, even with simultaneous orders
- Users can only see their own orders
- Requests from other websites are blocked (CSRF), security headers via helmet
- The server listens on 127.0.0.1 only, so other devices on your network can't reach it
- The signing secret is generated on first run into `server/.env` (never commit that file)

## Layout

```
server/src/   config.js  models.js  auth.js  shop.js  app.js  server.js  seed.js
server/test/  api.test.js
client/src/   App.jsx  context.jsx  api.js  styles.css  pages/
```
