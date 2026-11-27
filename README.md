# LayerForge — 3D printing store

An online shop for 3D printers, filament, resin, spare parts and printed models.
MongoDB + Express + React + Node, with **Razorpay** for online payments (UPI, cards,
netbanking) and cash on delivery.

- **Run it on your computer:** below.
- **Put it on the internet (Render):** see [DEPLOY.md](DEPLOY.md).

## Run it locally

You need Node.js 20.12+ and MongoDB running on your computer.

```bash
npm run setup   # first time only: installs packages
npm start       # builds the site and starts it
```

Open <http://localhost:4000>. Sample products are added the first time; `npm run seed` resets them.

`server/.env` is created on the first run with a random signing secret. To try online payments
locally, paste your Razorpay **test** keys into it (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) and
restart. Without keys the shop offers cash on delivery only. Never commit `server/.env`.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | 62 API tests, using a separate `layerforge_test` database and a pretend Razorpay |
| `npm run dev` | development mode with live reload at <http://localhost:5173> |
| `npm run make-admin -- you@example.com` | gives an existing account admin rights (`--remove` takes them away) |

## What it does

**Customers**
- Home page with a live "printer" drawing each model layer by layer, categories, staff picks and a material guide
- Shop with category filter, search, sort and in-stock filter (all kept in the address bar)
- Product pages with specs, an optional photo, and a slider that scrubs through the print layer by layer
- Cart kept in the browser, re-checked against current prices and stock when opened
- Free delivery over ₹999, otherwise ₹79
- Checkout with saved address, online payment through Razorpay, or cash on delivery
- Order pages with delivery progress, "pay now" for unfinished payments, and cancel-before-shipping with automatic refund
- Account page: name, saved address, password change

**Admin** (`/admin`)
- Dashboard: order value, online payments, orders to fulfil, unpaid orders, low stock, refund problems
- Orders: move through Packed → Shipped → Delivered, cancel (restocks and refunds), retry a failed refund
- Products: add, edit, delete, specs, staff picks, choice of drawing and colour, photo upload (resized in the browser)
- Customers list

## Security

- Passwords hashed with bcrypt; wrong passwords limited per email (same for unknown emails); a password change or "log out of all devices" ends other sessions
- Login cookie is `HttpOnly`, `SameSite=Strict`, and HTTPS-only with the `__Host-` prefix once deployed
- Requests that change data must come from the site itself (CSRF check) and be JSON
- Rate limits on log-in, sign-up, orders and the whole API
- Every input validated on the server; MongoDB operator injection refused
- Prices, delivery fee and totals always calculated on the server
- Razorpay: signatures and webhooks verified with HMAC, then the capture and exact amount confirmed with Razorpay itself; stray, late or duplicate payments refunded automatically; refunds can't be sent twice and interrupted ones are finished; the key secret never reaches the browser
- Stock reserved atomically (no overselling, even with simultaneous orders), always returned if an order fails; unpaid online orders released after 30 minutes, after checking with Razorpay; per-account limits on open orders
- Admin stock edits can't undo an order placed while the form was open
- Photo uploads checked by their real file type and size
- Strict Content Security Policy and other security headers (helmet)

## Layout

```
server/src/
  config.js      settings from the environment
  models.js      User, Product, ProductImage, Order
  validation.js  shared input rules
  auth.js        sign-up, log-in, profile, password, login checks
  products.js    public catalogue
  orders.js      ordering, payments, cancelling, refunds, expiry
  payments.js    Razorpay client and signature checks
  admin.js       admin API
  app.js         Express app, security headers, rate limits
  server.js      start-up and the unpaid-order clean-up timer
  seed.js, make-admin.js
server/test/api.test.js
client/src/
  components/PrintModel.jsx   the layer-by-layer product drawings
  components/  pages/  context.jsx  api.js  pay.js  styles.css
render.yaml    Render blueprint      DEPLOY.md    deployment guide
```
