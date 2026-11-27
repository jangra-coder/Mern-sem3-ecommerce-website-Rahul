// API tests: normal use, bad input, and security checks.
// Run with "npm test". Uses its own database (layerforge_test), never your real one,
// and a pretend Razorpay, so no real payment service is contacted.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createRazorpay } from '../src/payments.js';
import { Order, Product, ProductImage, User } from '../src/models.js';

if (!config.mongoUri.endsWith('_test')) {
  throw new Error('Refusing to run: tests wipe the database, so MONGO_URI must end with "_test".');
}

// ---------- A pretend Razorpay ----------

const KEY_SECRET = 'test_key_secret_123';
const WEBHOOK_SECRET = 'test_webhook_secret_456';
const rzp = { created: new Map(), payments: new Map(), byId: new Map(), refunds: [], captures: [], down: false, failRefund: false, n: 0 };
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function pretendRazorpay(url, options) {
  const { pathname } = new URL(url);
  assert.match(options.headers.Authorization, /^Basic /);
  if (rzp.down) throw new Error('network is down');
  const body = options.body ? JSON.parse(options.body) : null;
  let m;
  if (options.method === 'POST' && pathname === '/v1/orders') {
    const id = `order_Test${String(++rzp.n).padStart(4, '0')}`;
    rzp.created.set(id, body);
    return reply(200, { id, amount: body.amount, currency: 'INR', status: 'created' });
  }
  if ((m = /^\/v1\/orders\/(\w+)\/payments$/.exec(pathname))) return reply(200, { items: rzp.payments.get(m[1]) || [] });
  if (options.method === 'GET' && (m = /^\/v1\/payments\/(\w+)$/.exec(pathname))) {
    const payment = rzp.byId.get(m[1]);
    return payment ? reply(200, payment) : reply(404, { error: { description: 'The id provided does not exist' } });
  }
  if ((m = /^\/v1\/payments\/(\w+)\/capture$/.exec(pathname))) {
    const payment = rzp.byId.get(m[1]);
    if (!payment || payment.status !== 'authorized') return reply(400, { error: { description: 'This payment has already been captured' } });
    payment.status = 'captured';
    rzp.captures.push(m[1]);
    return reply(200, payment);
  }
  if ((m = /^\/v1\/payments\/(\w+)\/refund$/.exec(pathname))) {
    if (rzp.failRefund) return reply(400, { error: { description: 'Your account does not have enough balance to carry out the refund operation.' } });
    rzp.refunds.push({ paymentId: m[1], amount: body.amount });
    return reply(200, { id: `rfnd_Test${++rzp.n}` });
  }
  return reply(404, { error: { description: 'not found' } });
}

const razorpay = createRazorpay({ keyId: 'rzp_test_fakekey', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, fetchImpl: pretendRazorpay });
const app = createApp({ authLimit: 1000, loginPerEmail: 1000, apiLimit: 100000, orderLimit: 100000, razorpay });
const orderService = app.locals.orders;

const hmac = (secret, message) => crypto.createHmac('sha256', secret).update(message).digest('hex');
// What Razorpay's window hands the browser after a payment. The payment is
// also recorded in the pretend Razorpay, as the real one would have it.
function proofFor(razorpayOrderId, paymentId, { status = 'captured', amount } = {}) {
  rzp.byId.set(paymentId, {
    id: paymentId,
    order_id: razorpayOrderId,
    amount: amount ?? rzp.created.get(razorpayOrderId)?.amount,
    currency: 'INR',
    status,
  });
  return {
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: hmac(KEY_SECRET, `${razorpayOrderId}|${paymentId}`),
  };
}

// ---------- Shared test data ----------

const shipping = { fullName: 'Test User', phone: '9876543210', address: '12 Maker Street', city: 'Gurugram', state: 'Haryana', pincode: '122001' };
const alice = { name: 'Alice', email: 'alice@example.com', password: 'printer123' };
const bob = { name: 'Bob', email: 'bob@example.com', password: 'filament456' };
let spool; // in stock: 5
let soldOut; // in stock: 0

before(async () => {
  await mongoose.connect(config.mongoUri);
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(), Order.init(), Product.init()]);
  spool = await Product.create({ slug: 'spool', name: 'Test Spool (PLA+)', description: 'd', category: 'Filament', price: 900, stock: 5 });
  soldOut = await Product.create({ slug: 'gone', name: 'Sold Out Printer', description: 'd', category: 'Printers', price: 20000, stock: 0 });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// A logged-in browser session (keeps cookies between requests).
async function loginAs(person, onApp = app) {
  const agent = request.agent(onApp);
  const res = await agent.post('/api/auth/login').send({ email: person.email, password: person.password });
  assert.equal(res.status, 200);
  return agent;
}
const stockOf = async (product) => (await Product.findById(product._id ?? product.id)).stock;

describe('accounts', () => {
  test('sign up creates an account and logs in with an httpOnly cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(alice);
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['address', 'email', 'id', 'isAdmin', 'name']);
    const cookie = res.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    await request(app).post('/api/auth/register').send(bob).expect(201);
  });

  test('password is stored hashed, never as plain text', async () => {
    const saved = await User.findOne({ email: alice.email });
    assert.notEqual(saved.passwordHash, alice.password);
    assert.match(saved.passwordHash, /^\$2[aby]\$/);
  });

  test('sign up rejects bad input', async () => {
    const bad = [
      { ...alice, email: 'not-an-email' },
      { ...alice, email: 'new@example.com', password: 'short1' },
      { ...alice, email: 'new@example.com', password: 'onlyletters' },
      { ...alice, email: 'new@example.com', name: '' },
      { email: 'new@example.com' },
    ];
    for (const body of bad) {
      const res = await request(app).post('/api/auth/register').send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(res.body.error);
    }
  });

  test('sign up rejects an email that is already used (any letter case)', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...alice, email: 'ALICE@example.com' });
    assert.equal(res.status, 409);
  });

  test('log in fails the same way for a wrong password and an unknown email', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: alice.email, password: 'wrongpass1' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrongpass1' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
    assert.equal(wrong.headers['set-cookie'], undefined);
  });

  test('log in rejects a MongoDB injection attempt', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    assert.equal(res.status, 400);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  test('"me" shows the user only when logged in, and log out ends the session', async () => {
    assert.equal((await request(app).get('/api/auth/me')).body.user, null);
    const agent = await loginAs(alice);
    assert.equal((await agent.get('/api/auth/me')).body.user.email, alice.email);
    await agent.post('/api/auth/logout').send({}).expect(200);
    assert.equal((await agent.get('/api/auth/me')).body.user, null);
  });

  test('a forged or tampered login cookie is not accepted', async () => {
    for (const token of ['garbage', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.']) {
      const res = await request(app).get('/api/orders').set('Cookie', `token=${token}`);
      assert.equal(res.status, 401);
    }
  });

  test('wrong passwords are throttled per email, the same way for real and made-up emails', async () => {
    const dave = { name: 'Dave', email: 'dave@example.com', password: 'nozzle1234' };
    await request(app).post('/api/auth/register').send(dave).expect(201);
    const limited = createApp({ authLimit: 1000, loginPerEmail: 3, razorpay });
    const tryLogin = (email, password) => request(limited).post('/api/auth/login').send({ email, password });

    // Successful logins don't use up the allowance.
    for (let i = 0; i < 5; i++) await tryLogin(dave.email, dave.password).expect(200);

    // Many guesses at once can't slip past the limit.
    const burst = await Promise.all(Array.from({ length: 8 }, () => tryLogin(dave.email, 'wrong-guess-1')));
    assert.equal(burst.filter((r) => r.status === 401).length, 3);
    assert.equal(burst.filter((r) => r.status === 429).length, 5);
    const blocked = await tryLogin('DAVE@example.com ', dave.password); // even the right password, any letter case
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers['set-cookie'], undefined);

    // An email with no account behaves identically, so this reveals nothing.
    for (let i = 0; i < 3; i++) await tryLogin('nobody-here@example.com', 'wrong-guess-1').expect(401);
    const ghost = await tryLogin('nobody-here@example.com', 'wrong-guess-1');
    assert.equal(ghost.status, 429);
    assert.equal(ghost.body.error, blocked.body.error);

    // Other people are not affected.
    await tryLogin(alice.email, alice.password).expect(200);
  });

  test('"log out everywhere" ends every session of the account', async () => {
    const erin = { name: 'Erin', email: 'erin@example.com', password: 'bedlevel99' };
    await request(app).post('/api/auth/register').send(erin).expect(201);
    const [laptop, phone] = await Promise.all([loginAs(erin), loginAs(erin)]);
    await laptop.post('/api/auth/logout-all').send({}).expect(200);
    assert.equal((await laptop.get('/api/auth/me')).body.user, null);
    assert.equal((await phone.get('/api/auth/me')).body.user, null);
    await request(app).post('/api/auth/logout-all').send({}).expect(401);
    await loginAs(erin); // logging in again works
  });

  test('changing the password needs the current one and signs out other devices', async () => {
    const carol = { name: 'Carol', email: 'carol@example.com', password: 'resin12345' };
    await request(app).post('/api/auth/register').send(carol).expect(201);
    const [laptop, phone] = await Promise.all([loginAs(carol), loginAs(carol)]);

    await laptop.post('/api/auth/password').send({ currentPassword: 'not-my-password1', newPassword: 'brandnew123' }).expect(400);
    await laptop.post('/api/auth/password').send({ currentPassword: carol.password, newPassword: 'weak' }).expect(400);
    await request(app).post('/api/auth/password').send({ currentPassword: carol.password, newPassword: 'brandnew123' }).expect(401);

    await laptop.post('/api/auth/password').send({ currentPassword: carol.password, newPassword: 'brandnew123' }).expect(200);
    assert.equal((await laptop.get('/api/auth/me')).body.user.email, carol.email); // this device stays in
    assert.equal((await phone.get('/api/auth/me')).body.user, null); // the other one is out
    await request(app).post('/api/auth/login').send({ email: carol.email, password: carol.password }).expect(401);
    await request(app).post('/api/auth/login').send({ email: carol.email, password: 'brandnew123' }).expect(200);
  });

  test('profile: name and saved address can be updated, with the same checks as checkout', async () => {
    const agent = await loginAs(bob);
    const saved = await agent.patch('/api/auth/profile').send({ name: 'Bob B', address: shipping });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.user.name, 'Bob B');
    assert.equal(saved.body.user.address.city, 'Gurugram');
    await agent.patch('/api/auth/profile').send({ address: { ...shipping, state: 'Atlantis' } }).expect(400);
    await agent.patch('/api/auth/profile').send({ address: { ...shipping, phone: '123' } }).expect(400);
    // Extra fields such as isAdmin are ignored.
    await agent.patch('/api/auth/profile').send({ name: 'Bob', isAdmin: true, email: 'evil@example.com' }).expect(200);
    const user = await User.findOne({ email: bob.email });
    assert.equal(user.isAdmin, false);
    await request(app).patch('/api/auth/profile').send({ name: 'Nobody' }).expect(401);
  });
});

describe('products', () => {
  test('lists products, counts per category, and filters', async () => {
    const all = await request(app).get('/api/products');
    assert.equal(all.status, 200);
    assert.equal(all.body.products.length, 2);
    assert.deepEqual(all.body.counts, { Filament: 1, Printers: 1 });
    const filtered = await request(app).get('/api/products').query({ category: 'Filament' });
    assert.deepEqual(filtered.body.products.map((p) => p.slug), ['spool']);
    const inStock = await request(app).get('/api/products').query({ inStock: '1' });
    assert.deepEqual(inStock.body.products.map((p) => p.slug), ['spool']);
    const byPrice = await request(app).get('/api/products').query({ sort: 'price-desc' });
    assert.deepEqual(byPrice.body.products.map((p) => p.slug), ['gone', 'spool']);
  });

  test('search treats special characters as plain text', async () => {
    const hit = await request(app).get('/api/products').query({ q: '(pla+)' });
    assert.deepEqual(hit.body.products.map((p) => p.slug), ['spool']);
    const miss = await request(app).get('/api/products').query({ q: '.*' });
    assert.equal(miss.status, 200);
    assert.equal(miss.body.products.length, 0);
  });

  test('rejects unknown filters and returns 404 for bad product ids', async () => {
    await request(app).get('/api/products').query({ category: 'Hacks' }).expect(400);
    await request(app).get('/api/products').query({ sort: 'price; drop' }).expect(400);
    await request(app).get('/api/products/not-an-id').expect(404);
    await request(app).get('/api/products/000000000000000000000000').expect(404);
    await request(app).get(`/api/products/${spool.id}`).expect(200);
    await request(app).get(`/api/products/${spool.id}/image`).expect(404);
  });
});

describe('orders', () => {
  test('ordering requires login', async () => {
    await request(app).post('/api/orders').send({ items: [{ productId: spool.id, qty: 1 }], shipping }).expect(401);
    await request(app).get('/api/orders').expect(401);
  });

  test('total uses database prices - prices sent by the browser are ignored', async () => {
    const agent = await loginAs(alice);
    const res = await agent.post('/api/orders').send({
      items: [{ productId: spool.id, qty: 2, price: 1 }],
      shipping,
      total: 1,
      shippingFee: -500,
      status: 'Delivered',
      payment: { status: 'paid' },
      user: '000000000000000000000000',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.subtotal, 1800);
    assert.equal(res.body.order.shippingFee, 0); // free above ₹999
    assert.equal(res.body.order.total, 1800);
    assert.equal(res.body.order.items[0].price, 900);
    assert.equal(res.body.order.status, 'Placed');
    assert.equal(res.body.order.payment.status, 'cod');
    assert.equal(res.body.payment, null);
    assert.equal(await stockOf(spool), 3); // 5 - 2
    const saved = await Order.findById(res.body.order._id);
    assert.equal(String(saved.user), (await User.findOne({ email: alice.email })).id);
  });

  test('cannot order more than is in stock, and stock is left unchanged', async () => {
    const agent = await loginAs(alice);
    const res = await agent.post('/api/orders').send({ items: [{ productId: spool.id, qty: 4 }], shipping });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Only 3 left/);
    assert.equal(await stockOf(spool), 3);
  });

  test('if one item is out of stock, nothing is taken from the others', async () => {
    const agent = await loginAs(alice);
    const res = await agent.post('/api/orders').send({
      items: [{ productId: spool.id, qty: 1 }, { productId: soldOut.id, qty: 1 }],
      shipping,
    });
    assert.equal(res.status, 409);
    assert.equal(await stockOf(spool), 3);
    assert.equal(await Order.countDocuments(), 1);
  });

  test('two people racing for the last items cannot both get them', async () => {
    const [a, b] = await Promise.all([loginAs(alice), loginAs(bob)]);
    const body = { items: [{ productId: spool.id, qty: 2 }], shipping }; // 3 left, both want 2
    const results = await Promise.all([a.post('/api/orders').send(body), b.post('/api/orders').send(body)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await stockOf(spool), 1);
  });

  test('rejects bad quantities, bad ids, split-up quantities and bad addresses', async () => {
    const agent = await loginAs(alice);
    const item = { productId: spool.id, qty: 1 };
    const bad = [
      { items: [], shipping },
      { items: [{ ...item, qty: 0 }], shipping },
      { items: [{ ...item, qty: -3 }], shipping },
      { items: [{ ...item, qty: 1.5 }], shipping },
      { items: [{ ...item, qty: '2' }], shipping },
      { items: [{ ...item, qty: 999 }], shipping },
      { items: [{ productId: { $gt: '' }, qty: 1 }], shipping },
      { items: [{ productId: '000000000000000000000000', qty: 1 }], shipping },
      { items: [{ ...item, qty: 6 }, { ...item, qty: 6 }], shipping },
      { items: [item], shipping: { ...shipping, phone: '12345' } },
      { items: [item], shipping: { ...shipping, pincode: 'ABCDEF' } },
      { items: [item], shipping: { ...shipping, state: 'Narnia' } },
      { items: [item], shipping, paymentMethod: 'bitcoin' },
      { items: [item] },
    ];
    for (const body of bad) {
      const res = await agent.post('/api/orders').send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(await stockOf(spool), 1);
  });

  test('product ids in capital letters count as the same product, and no stock is ever lost', async () => {
    const agent = await loginAs(alice);
    const a = await Product.create({ slug: 'case-a', name: 'Case A', description: 'd', category: 'Parts', price: 10, stock: 10 });
    const b = await Product.create({ slug: 'case-b', name: 'Case B', description: 'd', category: 'Parts', price: 10, stock: 10 });

    // Same product written two ways: merged, and the per-product limit still applies.
    const tooMany = await agent.post('/api/orders').send({ items: [{ productId: a.id, qty: 6 }, { productId: a.id.toUpperCase(), qty: 6 }], shipping });
    assert.equal(tooMany.status, 400);

    // This used to take A's stock, crash, and never give it back.
    const res = await agent.post('/api/orders').send({ items: [{ productId: a.id, qty: 10 }, { productId: b.id.toUpperCase(), qty: 1 }], shipping });
    assert.equal(res.status, 201);
    assert.equal(await stockOf(a), 0);
    assert.equal(await stockOf(b), 9);
    await agent.post(`/api/orders/${res.body.order._id.toUpperCase()}/cancel`).send({}).expect(200);
    assert.equal(await stockOf(a), 10);
    assert.equal(await stockOf(b), 10);
    await Product.deleteMany({ _id: { $in: [a._id, b._id] } });
  });

  test('each account can only have a few orders waiting at once, even when sent all together', async () => {
    await request(app).post('/api/auth/register').send({ name: 'Hoarder', email: 'hoarder@example.com', password: 'hoard12345' }).expect(201);
    const hoarder = await loginAs({ email: 'hoarder@example.com', password: 'hoard12345' });
    const pile = await Product.create({ slug: 'pile', name: 'Pile', description: 'd', category: 'Parts', price: 10, stock: 100 });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => hoarder.post('/api/orders').send({ items: [{ productId: pile.id, qty: 1 }], shipping }))
    );
    const placed = results.filter((r) => r.status === 201).length;
    assert.ok(placed >= 1 && placed <= config.maxOpenOrders, `placed ${placed}`);
    assert.ok(results.every((r) => [201, 409, 429].includes(r.status)));
    assert.equal(await stockOf(pile), 100 - placed);
    // Sequentially, the limit is exact.
    while ((await Order.countDocuments({ user: (await User.findOne({ email: 'hoarder@example.com' }))._id, status: 'Placed' })) < config.maxOpenOrders) {
      await hoarder.post('/api/orders').send({ items: [{ productId: pile.id, qty: 1 }], shipping }).expect(201);
    }
    const over = await hoarder.post('/api/orders').send({ items: [{ productId: pile.id, qty: 1 }], shipping });
    assert.equal(over.status, 409);
    assert.match(over.body.error, /waiting to ship/);
    assert.equal(await stockOf(pile), 100 - config.maxOpenOrders);
  });

  test('small orders pay the delivery fee, and the address can be saved for next time', async () => {
    const agent = await loginAs(bob);
    await Order.deleteMany({ user: (await User.findOne({ email: bob.email }))._id });
    const res = await agent.post('/api/orders').send({ items: [{ productId: spool.id, qty: 1 }], shipping: { ...shipping, city: 'Sohna' }, saveAddress: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.subtotal, 900);
    assert.equal(res.body.order.shippingFee, 79);
    assert.equal(res.body.order.total, 979);
    assert.equal((await agent.get('/api/auth/me')).body.user.address.city, 'Sohna');
    assert.equal(await stockOf(spool), 0);
  });

  test('users only ever see their own orders', async () => {
    const [a, b] = await Promise.all([loginAs(alice), loginAs(bob)]);
    const aliceId = (await User.findOne({ email: alice.email })).id;
    const bobId = (await User.findOne({ email: bob.email })).id;
    for (const [agent, id] of [[a, aliceId], [b, bobId]]) {
      const { orders } = (await agent.get('/api/orders')).body;
      assert.ok(orders.length >= 1);
      assert.ok(orders.every((o) => o.user === id));
    }
    const bobsOrder = (await b.get('/api/orders')).body.orders[0];
    await b.get(`/api/orders/${bobsOrder._id}`).expect(200);
    await a.get(`/api/orders/${bobsOrder._id}`).expect(404);
    await a.post(`/api/orders/${bobsOrder._id}/cancel`).send({}).expect(404);
    await a.post(`/api/orders/${bobsOrder._id}/pay`).send({}).expect(404);
    assert.equal((await Order.findById(bobsOrder._id)).status, 'Placed');
  });

  test('a customer can cancel before shipping, exactly once, and gets the stock put back', async () => {
    const b = await loginAs(bob);
    const order = (await b.get('/api/orders')).body.orders[0];
    const results = await Promise.all([b.post(`/api/orders/${order._id}/cancel`).send({}), b.post(`/api/orders/${order._id}/cancel`).send({})]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await stockOf(spool), 1); // back from 0, and only once
    const saved = await Order.findById(order._id);
    assert.equal(saved.status, 'Cancelled');
    assert.equal(saved.payment.status, 'void');
  });
});

describe('general protection', () => {
  test('requests from another website are blocked (CSRF)', async () => {
    const agent = await loginAs(alice);
    const body = { items: [{ productId: spool.id, qty: 1 }], shipping };
    await agent.post('/api/orders').set('Origin', 'http://evil.example').send(body).expect(403);
    await agent.post('/api/orders').set('Origin', 'null').send(body).expect(403);
    // What a plain HTML form on another site would send:
    await agent.post('/api/orders').type('form').send('a=b').expect(415);
    assert.equal(await stockOf(spool), 1);
    // The site's own pages are of course allowed.
    await agent.post('/api/auth/logout').set('Host', 'shop.example').set('Origin', 'https://shop.example').send({}).expect(200);
  });

  test('security headers are set and server details are hidden', async () => {
    const res = await request(app).get('/api/products');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /script-src 'self' https:\/\/checkout\.razorpay\.com/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  });

  test('broken or oversized requests get a clean error, not a crash', async () => {
    const broken = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.equal(broken.status, 400);
    const huge = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(50_000) });
    assert.equal(huge.status, 413);
    await request(app).get('/api/does-not-exist').expect(404);
    await request(app).get('/healthz').expect(200);
  });

  test('repeated log-in attempts are rate limited', async () => {
    const limited = createApp({ authLimit: 3, razorpay });
    const attempt = () => request(limited).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'guess12345' });
    for (let i = 0; i < 3; i++) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
  });
});

describe('admin', () => {
  let admin; // alice, promoted directly in the database
  let customer; // bob, a normal user
  let widget;
  const newProduct = { name: 'Admin Widget', description: 'Made in a test', category: 'Parts', price: 250, stock: 8, color: '#123abc' };
  const pngPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  before(async () => {
    await User.updateOne({ email: alice.email }, { $set: { isAdmin: true } });
    admin = await loginAs(alice);
    customer = await loginAs(bob);
  });

  test('admin pages are closed to visitors and to normal customers', async () => {
    const calls = [
      ['get', '/api/admin/stats'],
      ['get', '/api/admin/orders'],
      ['get', '/api/admin/customers'],
      ['post', '/api/admin/products'],
      ['put', `/api/admin/products/${spool.id}`],
      ['put', `/api/admin/products/${spool.id}/image`],
      ['delete', `/api/admin/products/${spool.id}/image`],
      ['delete', `/api/admin/products/${spool.id}`],
      ['patch', '/api/admin/orders/000000000000000000000000'],
      ['post', '/api/admin/orders/000000000000000000000000/refund'],
    ];
    for (const [method, url] of calls) {
      assert.equal((await request(app)[method](url).send({})).status, 401, `visitor ${method} ${url}`);
      assert.equal((await customer[method](url).send({})).status, 403, `customer ${method} ${url}`);
    }
    assert.ok(await Product.findById(spool.id), 'product must not have been deleted');
  });

  test('nobody can make themselves an admin by signing up', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Mallory', email: 'mallory@example.com', password: 'sneaky1234', isAdmin: true, role: 'admin' });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.isAdmin, false);
    assert.equal((await User.findOne({ email: 'mallory@example.com' })).isAdmin, false);
  });

  test('admin can add a product (with specs) and it shows up in the shop', async () => {
    const res = await admin.post('/api/admin/products').send({ ...newProduct, shape: 'gear', featured: true, specs: [{ label: 'Bore', value: '5 mm' }] });
    assert.equal(res.status, 201);
    widget = res.body.product;
    assert.equal(widget.slug, 'admin-widget');
    assert.deepEqual(widget.specs, [{ label: 'Bore', value: '5 mm' }]);
    const shop = await request(app).get('/api/products').query({ q: 'Admin Widget', featured: '1' });
    assert.equal(shop.body.products.length, 1);
    // Same name again still works (gets a different internal slug).
    const again = await admin.post('/api/admin/products').send(newProduct);
    assert.equal(again.status, 201);
    assert.notEqual(again.body.product.slug, widget.slug);
    await admin.delete(`/api/admin/products/${again.body.product._id}`).expect(200);
  });

  test('admin product form rejects bad values', async () => {
    const bad = [
      { ...newProduct, price: -5 },
      { ...newProduct, price: 0 },
      { ...newProduct, price: 99.5 },
      { ...newProduct, price: '250' },
      { ...newProduct, stock: -1 },
      { ...newProduct, category: 'Weapons' },
      { ...newProduct, shape: 'rocket' },
      { ...newProduct, color: 'red;background:url(x)' },
      { ...newProduct, specs: [{ label: '', value: 'x' }] },
      { ...newProduct, specs: Array(11).fill({ label: 'a', value: 'b' }) },
      { ...newProduct, name: '' },
      { ...newProduct, name: { $gt: '' } },
      {},
    ];
    for (const body of bad) {
      assert.equal((await admin.post('/api/admin/products').send(body)).status, 400, JSON.stringify(body));
      assert.equal((await admin.put(`/api/admin/products/${widget._id}`).send(body)).status, 400, JSON.stringify(body));
    }
  });

  test('admin can edit a product', async () => {
    const edited = await admin.put(`/api/admin/products/${widget._id}`).send({ ...newProduct, price: 300, stock: 4 });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.product.price, 300);
    assert.equal(await stockOf(widget), 4);
    await admin.put('/api/admin/products/000000000000000000000000').send(newProduct).expect(404);
    await admin.delete('/api/admin/products/not-an-id').expect(404);
  });

  test('an admin save does not undo stock taken by an order placed while editing', async () => {
    const opened = (await request(app).get(`/api/products/${widget._id}`)).body.product; // the form loads: stock 4
    const order = await customer.post('/api/orders').send({ items: [{ productId: widget._id, qty: 1 }], shipping }); // stock 3
    assert.equal(order.status, 201);
    const stale = await admin.put(`/api/admin/products/${widget._id}`).send({ ...newProduct, price: 300, stock: 4, stockWas: opened.stock });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /Stock changed to 3/);
    assert.equal(await stockOf(widget), 3);
    await admin.put(`/api/admin/products/${widget._id}`).send({ ...newProduct, price: 300, stock: 4, stockWas: 3 }).expect(200);
    await customer.post(`/api/orders/${order.body.order._id}/cancel`).send({}).expect(200);
    await admin.put(`/api/admin/products/${widget._id}`).send({ ...newProduct, price: 300, stock: 4, stockWas: 5 }).expect(200);
    assert.equal(await stockOf(widget), 4);
  });

  test('product photos: real images are accepted, disguised files are refused', async () => {
    const url = `/api/admin/products/${widget._id}/image`;
    const upload = await admin.put(url).send({ image: `data:image/png;base64,${pngPixel}` });
    assert.equal(upload.status, 200);
    assert.ok(upload.body.product.imageVersion > 0);

    const served = await request(app).get(`/api/products/${widget._id}/image`);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.equal(served.headers['x-content-type-options'], 'nosniff');
    assert.ok(Buffer.from(pngPixel, 'base64').equals(served.body));

    const script = Buffer.from('<script>alert(1)</script>').toString('base64');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
    const tooBig = Buffer.concat([Buffer.from(pngPixel, 'base64'), Buffer.alloc(700 * 1024)]).toString('base64');
    await admin.put(url).send({ image: `data:image/png;base64,${script}` }).expect(400); // says PNG, is a script
    await admin.put(url).send({ image: `data:image/svg+xml;base64,${svg}` }).expect(400);
    await admin.put(url).send({ image: 'https://example.com/cat.png' }).expect(400);
    await admin.put(url).send({ image: `data:image/png;base64,${tooBig}` }).expect(413);
    await admin.put(url).send({}).expect(400);
    await admin.put('/api/admin/products/000000000000000000000000/image').send({ image: `data:image/png;base64,${pngPixel}` }).expect(404);

    // The original photo is untouched by the failed attempts, then removed on request.
    assert.equal((await ProductImage.findById(widget._id)).type, 'image/png');
    const removed = await admin.delete(url);
    assert.equal(removed.body.product.imageVersion, 0);
    await request(app).get(`/api/products/${widget._id}/image`).expect(404);
  });

  test('admin sees every order with the customer, and never a password hash', async () => {
    const res = await admin.get('/api/admin/orders');
    assert.equal(res.status, 200);
    const emails = new Set(res.body.orders.map((o) => o.user.email));
    assert.ok(emails.has(alice.email) && emails.has(bob.email));
    const customers = await admin.get('/api/admin/customers');
    assert.ok(customers.body.customers.length >= 3);
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
    assert.ok(!JSON.stringify(customers.body).includes('passwordHash'));
    await admin.get('/api/admin/orders').query({ status: 'Nope' }).expect(400);
  });

  test('admin can move an order forward; cancelling returns stock exactly once', async () => {
    const placed = await customer.post('/api/orders').send({ items: [{ productId: widget._id, qty: 3 }], shipping });
    assert.equal(placed.status, 201);
    const url = `/api/admin/orders/${placed.body.order._id}`;
    assert.equal(await stockOf(widget), 1); // 4 - 3

    await admin.patch(url).send({ status: 'Flying' }).expect(400);
    await admin.patch(url).send({ status: 'Pending payment' }).expect(400);
    const shipped = await admin.patch(url).send({ status: 'Shipped' });
    assert.equal(shipped.body.order.status, 'Shipped');
    assert.equal(shipped.body.order.user.email, bob.email);
    assert.equal((await customer.get('/api/orders')).body.orders[0].status, 'Shipped');
    // Once it has shipped, the customer can no longer cancel it themselves.
    await customer.post(`/api/orders/${placed.body.order._id}/cancel`).send({}).expect(409);

    // Two cancel clicks at the same moment: only one may succeed.
    const results = await Promise.all([admin.patch(url).send({ status: 'Cancelled' }), admin.patch(url).send({ status: 'Cancelled' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await stockOf(widget), 4); // back to 4, not 7

    await admin.patch(url).send({ status: 'Placed' }).expect(409); // cancelled is final
    await admin.patch('/api/admin/orders/000000000000000000000000').send({ status: 'Packed' }).expect(404);
  });

  test('a cash order counts as paid once it is delivered', async () => {
    const placed = await customer.post('/api/orders').send({ items: [{ productId: widget._id, qty: 1 }], shipping });
    const delivered = await admin.patch(`/api/admin/orders/${placed.body.order._id}`).send({ status: 'Delivered' });
    assert.equal(delivered.body.order.status, 'Delivered');
    assert.equal(delivered.body.order.payment.status, 'paid');
    await admin.patch(`/api/admin/orders/${placed.body.order._id}`).send({ status: 'Cancelled' }).expect(409); // delivered is final
    assert.equal(await stockOf(widget), 3);
  });

  test('dashboard numbers add up and leave out cancelled orders', async () => {
    const { body } = await admin.get('/api/admin/stats');
    const live = await Order.find({ status: { $nin: ['Cancelled', 'Pending payment'] } });
    assert.equal(body.orders, await Order.countDocuments());
    assert.equal(body.revenue, live.reduce((sum, o) => sum + o.total, 0));
    assert.equal(body.products, await Product.countDocuments());
  });

  test('deleting a product keeps old orders readable and removes its photo', async () => {
    await admin.put(`/api/admin/products/${widget._id}/image`).send({ image: `data:image/png;base64,${pngPixel}` }).expect(200);
    await admin.delete(`/api/admin/products/${widget._id}`).expect(200);
    await request(app).get(`/api/products/${widget._id}`).expect(404);
    assert.equal(await ProductImage.findById(widget._id), null);
    const list = (await customer.get('/api/orders')).body.orders;
    assert.ok(list.some((o) => o.items.some((i) => i.name === 'Admin Widget')));
  });
});

describe('online payments (Razorpay)', () => {
  let admin;
  let customer;
  let stranger;
  let kit; // ₹1500, free delivery
  let knob; // ₹200, pays the delivery fee

  const buyOnline = async (agent, product, qty = 1) => {
    const res = await agent.post('/api/orders').send({ items: [{ productId: product.id, qty }], shipping, paymentMethod: 'razorpay' });
    assert.equal(res.status, 201, res.body.error);
    return res.body;
  };
  const makeOld = (orderId) =>
    Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(orderId) }, { $set: { createdAt: new Date(Date.now() - 31 * 60 * 1000) } });

  before(async () => {
    admin = await loginAs(alice);
    customer = await loginAs(bob);
    await request(app).post('/api/auth/register').send({ name: 'Eve', email: 'eve@example.com', password: 'listening1' }).expect(201);
    stranger = await loginAs({ email: 'eve@example.com', password: 'listening1' });
    kit = await Product.create({ slug: 'kit', name: 'Upgrade Kit', description: 'd', category: 'Parts', price: 1500, stock: 10 });
    knob = await Product.create({ slug: 'knob', name: 'Bed Knob', description: 'd', category: 'Parts', price: 200, stock: 10 });
  });

  test('the shop tells the browser the public key id, never the secret', async () => {
    const res = await request(app).get('/api/config');
    assert.equal(res.body.razorpay.enabled, true);
    assert.equal(res.body.razorpay.keyId, 'rzp_test_fakekey');
    assert.ok(!JSON.stringify(res.body).includes(KEY_SECRET));
    assert.ok(!JSON.stringify(res.body).includes(WEBHOOK_SECRET));
  });

  test('an online order waits for payment, holds the stock, and asks Razorpay for the exact amount', async () => {
    const { order, payment } = await buyOnline(customer, knob, 2); // 400 + 79 delivery
    assert.equal(order.status, 'Pending payment');
    assert.equal(order.payment.status, 'pending');
    assert.equal(order.total, 479);
    assert.deepEqual(payment, { keyId: 'rzp_test_fakekey', razorpayOrderId: order.payment.razorpayOrderId, amount: 47900, currency: 'INR' });
    const asked = rzp.created.get(order.payment.razorpayOrderId);
    assert.equal(asked.amount, 47900);
    assert.equal(asked.currency, 'INR');
    assert.equal(asked.receipt, order._id);
    assert.equal(await stockOf(knob), 8);
    assert.ok(!JSON.stringify({ order, payment }).includes(KEY_SECRET));
    // An unpaid order can't be shipped.
    await admin.patch(`/api/admin/orders/${order._id}`).send({ status: 'Shipped' }).expect(409);
    await customer.post(`/api/orders/${order._id}/cancel`).send({}).expect(200);
    assert.equal(await stockOf(knob), 10);
  });

  test('a forged payment confirmation is rejected', async () => {
    const { order } = await buyOnline(customer, kit);
    const rid = order.payment.razorpayOrderId;
    const url = `/api/orders/${order._id}/verify`;
    const forged = [
      { ...proofFor(rid, 'pay_Fake000001'), razorpay_signature: 'a'.repeat(64) }, // made-up signature
      { ...proofFor(rid, 'pay_Fake000001'), razorpay_payment_id: 'pay_Other00002' }, // signature for another payment
      proofFor('order_Somebody1', 'pay_Fake000001'), // genuine-looking, but for a different Razorpay order
      { razorpay_order_id: rid, razorpay_payment_id: 'pay_Fake000001' }, // nothing signed at all
      { razorpay_order_id: { $ne: '' }, razorpay_payment_id: 'pay_Fake000001', razorpay_signature: 'a'.repeat(64) },
      {},
    ];
    for (const body of forged) {
      assert.equal((await customer.post(url).send(body)).status, 400, JSON.stringify(body));
    }
    // Somebody else can't confirm it either, even with a valid signature.
    await stranger.post(url).send(proofFor(rid, 'pay_Fake000001')).expect(404);
    await request(app).post(url).send(proofFor(rid, 'pay_Fake000001')).expect(401);
    const saved = await Order.findById(order._id);
    assert.equal(saved.status, 'Pending payment');
    assert.equal(saved.payment.status, 'pending');
    await customer.post(`/api/orders/${order._id}/cancel`).send({}).expect(200);
  });

  test('a genuine confirmation marks the order paid - and repeating it changes nothing', async () => {
    const { order } = await buyOnline(customer, kit);
    const proof = proofFor(order.payment.razorpayOrderId, 'pay_Real000001');
    const first = await customer.post(`/api/orders/${order._id}/verify`).send(proof);
    assert.equal(first.status, 200);
    assert.equal(first.body.order.status, 'Placed');
    assert.equal(first.body.order.payment.status, 'paid');
    assert.equal(first.body.order.payment.razorpayPaymentId, 'pay_Real000001');
    const again = await customer.post(`/api/orders/${order._id}/verify`).send(proof);
    assert.equal(again.status, 200);
    assert.equal(again.body.order.payment.paidAt, first.body.order.payment.paidAt);
    // "Pay now" on a paid order does not start a second payment.
    assert.equal((await customer.post(`/api/orders/${order._id}/pay`).send({})).body.payment, null);
    assert.equal(await stockOf(kit), 9);
  });

  test('cancelling a paid order refunds the full amount, once, and restocks', async () => {
    const order = (await customer.get('/api/orders')).body.orders.find((o) => o.payment.razorpayPaymentId === 'pay_Real000001');
    const refundsBefore = rzp.refunds.length;
    const results = await Promise.all([
      customer.post(`/api/orders/${order._id}/cancel`).send({}),
      customer.post(`/api/orders/${order._id}/cancel`).send({}),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const saved = await Order.findById(order._id);
    assert.equal(saved.status, 'Cancelled');
    assert.equal(saved.payment.status, 'refunded');
    assert.ok(saved.payment.refundId);
    assert.deepEqual(rzp.refunds.slice(refundsBefore), [{ paymentId: 'pay_Real000001', amount: 150000 }]);
    assert.equal(await stockOf(kit), 10);
  });

  test('the webhook confirms payment when the browser never reports back', async () => {
    const { order } = await buyOnline(customer, kit);
    const event = (amount, paymentId = 'pay_Hook000001') =>
      JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: order.payment.razorpayOrderId, amount, status: 'captured' } } } });
    const send = (raw, signature) =>
      request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(raw);

    await send(event(150000), 'f'.repeat(64)).expect(400); // not signed by Razorpay
    await send(event(150000), hmac('wrong-secret', event(150000))).expect(400);
    await request(app).post('/api/payments/webhook').send(JSON.parse(event(150000))).expect(400); // no signature
    assert.equal((await Order.findById(order._id)).status, 'Pending payment');

    await send(event(100), hmac(WEBHOOK_SECRET, event(100))).expect(200); // signed, but ₹1 instead of ₹1500
    assert.equal((await Order.findById(order._id)).status, 'Pending payment');

    await send(event(150000), hmac(WEBHOOK_SECRET, event(150000))).expect(200);
    const saved = await Order.findById(order._id);
    assert.equal(saved.status, 'Placed');
    assert.equal(saved.payment.status, 'paid');
    assert.equal(saved.payment.razorpayPaymentId, 'pay_Hook000001');

    await send(event(150000), hmac(WEBHOOK_SECRET, event(150000))).expect(200); // Razorpay may send it twice
    const unknown = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x000000', order_id: 'order_Nobody01', amount: 5 } } } });
    await send(unknown, hmac(WEBHOOK_SECRET, unknown)).expect(200);
    const other = JSON.stringify({ event: 'refund.processed', payload: {} });
    await send(other, hmac(WEBHOOK_SECRET, other)).expect(200);
    assert.equal(await stockOf(kit), 9);
  });

  test('a refund that fails is flagged, and the admin can retry it without paying twice', async () => {
    const order = await Order.findOne({ 'payment.razorpayPaymentId': 'pay_Hook000001' });
    const refundsBefore = rzp.refunds.length;
    rzp.failRefund = true;
    const cancelled = await admin.patch(`/api/admin/orders/${order.id}`).send({ status: 'Cancelled' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.order.status, 'Cancelled');
    assert.equal(cancelled.body.order.payment.status, 'refund_failed');
    assert.equal((await admin.get('/api/admin/stats')).body.refundIssues, 1);
    await admin.post(`/api/admin/orders/${order.id}/refund`).send({}).expect(502); // still failing

    rzp.failRefund = false;
    const retries = await Promise.all([
      admin.post(`/api/admin/orders/${order.id}/refund`).send({}),
      admin.post(`/api/admin/orders/${order.id}/refund`).send({}),
    ]);
    assert.ok(retries.some((r) => r.status === 200));
    assert.equal(rzp.refunds.length - refundsBefore, 1); // money went back exactly once
    assert.equal((await Order.findById(order.id)).payment.status, 'refunded');
    await admin.post(`/api/admin/orders/${order.id}/refund`).send({}).expect(200); // already done: nothing more is sent
    assert.equal(rzp.refunds.length - refundsBefore, 1);
    assert.equal((await admin.get('/api/admin/stats')).body.refundIssues, 0);
    // A cash order has nothing to refund.
    const cash = await Order.findOne({ 'payment.method': 'cod', status: 'Cancelled' });
    await admin.post(`/api/admin/orders/${cash.id}/refund`).send({}).expect(409);
  });

  test('unpaid orders expire after the hold time and release their stock', async () => {
    const old = await buyOnline(customer, knob, 3);
    const recent = await buyOnline(customer, knob, 1);
    assert.equal(await stockOf(knob), 6);
    await makeOld(old.order._id);
    assert.equal(await orderService.expirePendingOrders(), 1);
    assert.equal((await Order.findById(old.order._id)).status, 'Cancelled');
    assert.equal((await Order.findById(old.order._id)).payment.status, 'void');
    assert.equal((await Order.findById(recent.order._id)).status, 'Pending payment');
    assert.equal(await stockOf(knob), 9);
    await customer.post(`/api/orders/${recent.order._id}/cancel`).send({}).expect(200);
  });

  test('an order that was paid at the last minute is kept, not expired', async () => {
    const { order } = await buyOnline(customer, kit);
    await makeOld(order._id);
    rzp.payments.set(order.payment.razorpayOrderId, [
      { id: 'pay_Failed0001', status: 'failed', amount: 150000 },
      { id: 'pay_Late000001', status: 'captured', amount: 150000 },
    ]);
    assert.equal(await orderService.expirePendingOrders(), 0);
    const saved = await Order.findById(order._id);
    assert.equal(saved.status, 'Placed');
    assert.equal(saved.payment.razorpayPaymentId, 'pay_Late000001');
    assert.equal(await stockOf(kit), 9); // still held by this order
  });

  test('if Razorpay cannot be reached, old unpaid orders are left alone rather than guessed at', async () => {
    const { order } = await buyOnline(customer, knob);
    await makeOld(order._id);
    rzp.down = true;
    assert.equal(await orderService.expirePendingOrders(), 0);
    assert.equal((await Order.findById(order._id)).status, 'Pending payment');
    rzp.down = false;
    assert.equal(await orderService.expirePendingOrders(), 1);
  });

  test('money that arrives after an order was cancelled is sent straight back', async () => {
    const { order } = await buyOnline(customer, kit);
    await customer.post(`/api/orders/${order._id}/cancel`).send({}).expect(200);
    const stock = await stockOf(kit);
    const refundsBefore = rzp.refunds.length;
    const res = await customer.post(`/api/orders/${order._id}/verify`).send(proofFor(order.payment.razorpayOrderId, 'pay_TooLate001'));
    assert.equal(res.status, 200);
    assert.equal(res.body.order.status, 'Cancelled');
    assert.equal(res.body.order.payment.status, 'refunded');
    assert.deepEqual(rzp.refunds.slice(refundsBefore), [{ paymentId: 'pay_TooLate001', amount: 150000 }]);
    assert.equal(await stockOf(kit), stock); // not taken a second time
  });

  test('a payment that lands while the order is being cancelled is still refunded', async () => {
    const { order } = await buyOnline(customer, kit);
    // The moment between "cancelled" and "marked unpaid" inside a cancellation:
    await Order.updateOne({ _id: order._id }, { $set: { status: 'Cancelled' } });
    const refundsBefore = rzp.refunds.length;
    const res = await customer.post(`/api/orders/${order._id}/verify`).send(proofFor(order.payment.razorpayOrderId, 'pay_InGap00001'));
    assert.equal(res.status, 200);
    assert.equal(res.body.order.payment.status, 'refunded');
    assert.deepEqual(rzp.refunds.slice(refundsBefore), [{ paymentId: 'pay_InGap00001', amount: 150000 }]);
    // The rest of the cancellation must not paper over it.
    await Order.updateOne({ _id: order._id, 'payment.status': { $in: ['pending', 'cod'] } }, { $set: { 'payment.status': 'void' } });
    assert.equal((await Order.findById(order._id)).payment.status, 'refunded');
    await Product.updateOne({ _id: kit._id }, { $inc: { stock: 1 } });
  });

  test('a payment for a released order is found later and refunded, even with no webhook and no browser', async () => {
    const { order } = await buyOnline(customer, kit);
    await customer.post(`/api/orders/${order._id}/cancel`).send({}).expect(200);
    rzp.payments.set(order.payment.razorpayOrderId, [{ id: 'pay_Silent0001', status: 'captured', amount: 150000 }]);
    const refundsBefore = rzp.refunds.length;
    assert.equal(await orderService.recheckCancelled(), 1);
    const saved = await Order.findById(order._id);
    assert.equal(saved.payment.status, 'refunded');
    assert.equal(saved.payment.razorpayPaymentId, 'pay_Silent0001');
    assert.deepEqual(rzp.refunds.slice(refundsBefore), [{ paymentId: 'pay_Silent0001', amount: 150000 }]);
    // Checked again soon after: not asked again, nothing sent twice.
    assert.equal(await orderService.recheckCancelled(), 0);
    assert.equal(await orderService.recheckCancelled(Date.now() + 30 * 60 * 1000), 0);
    assert.equal(rzp.refunds.length - refundsBefore, 1);
  });

  test('an interrupted refund is finished by the clean-up timer', async () => {
    const { order } = await buyOnline(customer, kit);
    await customer.post(`/api/orders/${order._id}/verify`).send(proofFor(order.payment.razorpayOrderId, 'pay_Crash00001')).expect(200);
    // As if the server stopped right after marking it cancelled:
    await Order.updateOne({ _id: order._id }, { $set: { status: 'Cancelled' } });
    assert.equal((await admin.get('/api/admin/stats')).body.refundIssues, 1);
    await orderService.resumeRefunds();
    assert.equal((await Order.findById(order._id)).payment.status, 'refunded');
    assert.equal((await admin.get('/api/admin/stats')).body.refundIssues, 0);
    await Product.updateOne({ _id: kit._id }, { $inc: { stock: 1 } });
  });

  test('a payment that was only authorised is captured before the order counts as paid', async () => {
    const { order } = await buyOnline(customer, knob);
    const proof = proofFor(order.payment.razorpayOrderId, 'pay_AuthOnly01', { status: 'authorized' });
    const res = await customer.post(`/api/orders/${order._id}/verify`).send(proof);
    assert.equal(res.status, 200);
    assert.equal(res.body.order.payment.status, 'paid');
    assert.ok(rzp.captures.includes('pay_AuthOnly01'));
    await customer.post(`/api/orders/${order._id}/cancel`).send({}).expect(200);

    // For an order that is already cancelled, the money is not taken at all.
    const second = await buyOnline(customer, knob);
    await customer.post(`/api/orders/${second.order._id}/cancel`).send({}).expect(200);
    const late = proofFor(second.order.payment.razorpayOrderId, 'pay_AuthLate01', { status: 'authorized' });
    await customer.post(`/api/orders/${second.order._id}/verify`).send(late).expect(409);
    assert.ok(!rzp.captures.includes('pay_AuthLate01'));
    assert.equal((await Order.findById(second.order._id)).payment.status, 'void');
  });

  test('a payment that does not match the order (amount or order) is refused', async () => {
    const { order } = await buyOnline(customer, knob);
    const rid = order.payment.razorpayOrderId;
    await customer.post(`/api/orders/${order._id}/verify`).send(proofFor(rid, 'pay_Short00001', { amount: 100 })).expect(400);
    rzp.byId.set('pay_Elsewhere1', { id: 'pay_Elsewhere1', order_id: 'order_Other0001', amount: 27900, currency: 'INR', status: 'captured' });
    const elsewhere = { razorpay_order_id: rid, razorpay_payment_id: 'pay_Elsewhere1', razorpay_signature: hmac(KEY_SECRET, `${rid}|pay_Elsewhere1`) };
    await customer.post(`/api/orders/${order._id}/verify`).send(elsewhere).expect(400);
    assert.equal((await Order.findById(order._id)).status, 'Pending payment');
    await customer.post(`/api/orders/${order._id}/cancel`).send({}).expect(200);
  });

  test('a second payment for an already-paid order is refunded once', async () => {
    const { order } = await buyOnline(customer, knob);
    const rid = order.payment.razorpayOrderId;
    await customer.post(`/api/orders/${order._id}/verify`).send(proofFor(rid, 'pay_First0001')).expect(200);
    const refundsBefore = rzp.refunds.length;
    const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_Twice0001', order_id: rid, amount: order.total * 100, status: 'captured' } } } });
    const send = () => request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', hmac(WEBHOOK_SECRET, event)).send(event);
    await Promise.all([send().expect(200), send().expect(200)]);
    await send().expect(200);
    assert.deepEqual(rzp.refunds.slice(refundsBefore), [{ paymentId: 'pay_Twice0001', amount: order.total * 100 }]);
    const saved = await Order.findById(order._id);
    assert.equal(saved.payment.status, 'paid');
    assert.equal(saved.payment.razorpayPaymentId, 'pay_First0001');
    await customer.post(`/api/orders/${order._id}/cancel`).send({}).expect(200);
  });

  test('if Razorpay is down, the order fails cleanly and no stock is lost', async () => {
    const [ordersBefore, stockBefore] = [await Order.countDocuments(), await stockOf(kit)];
    rzp.down = true;
    const res = await customer.post('/api/orders').send({ items: [{ productId: kit.id, qty: 2 }], shipping, paymentMethod: 'razorpay' });
    rzp.down = false;
    assert.equal(res.status, 502);
    assert.ok(!res.body.error.includes('network'));
    assert.equal(await Order.countDocuments(), ordersBefore);
    assert.equal(await stockOf(kit), stockBefore);
  });

  test('one account cannot hold stock with a pile of unpaid orders', async () => {
    const held = [];
    for (let i = 0; i < config.maxUnpaidOrders; i++) held.push(await buyOnline(stranger, knob));
    const stock = await stockOf(knob);
    const res = await stranger.post('/api/orders').send({ items: [{ productId: knob.id, qty: 1 }], shipping, paymentMethod: 'razorpay' });
    assert.equal(res.status, 409);
    assert.equal(await stockOf(knob), stock);
    // Cash orders are still fine, and "pay now" hands back the same payment details.
    await stranger.post('/api/orders').send({ items: [{ productId: knob.id, qty: 1 }], shipping }).expect(201);
    const retry = await stranger.post(`/api/orders/${held[0].order._id}/pay`).send({});
    assert.deepEqual(retry.body.payment, held[0].payment);
    for (const h of held) await stranger.post(`/api/orders/${h.order._id}/cancel`).send({}).expect(200);

    // Sent all at once, still no more than the limit.
    const burst = await Promise.all(
      Array.from({ length: 10 }, () => stranger.post('/api/orders').send({ items: [{ productId: knob.id, qty: 1 }], shipping, paymentMethod: 'razorpay' }))
    );
    const unpaid = await Order.countDocuments({ user: (await User.findOne({ email: 'eve@example.com' }))._id, status: 'Pending payment' });
    assert.ok(unpaid <= config.maxUnpaidOrders, `unpaid ${unpaid}`);
    assert.equal(burst.filter((r) => r.status === 201).length, unpaid);
    for (const r of burst.filter((x) => x.status === 201)) await stranger.post(`/api/orders/${r.body.order._id}/cancel`).send({}).expect(200);
  });

  test('without Razorpay keys the shop still works, with cash on delivery only', async () => {
    const cashOnly = createApp({ authLimit: 1000, razorpay: createRazorpay({}) });
    const config2 = (await request(cashOnly).get('/api/config')).body;
    assert.deepEqual(config2.razorpay, { enabled: false, keyId: null });
    const agent = await loginAs(bob, cashOnly);
    const stock = await stockOf(knob);
    await agent.post('/api/orders').send({ items: [{ productId: knob.id, qty: 1 }], shipping, paymentMethod: 'razorpay' }).expect(400);
    assert.equal(await stockOf(knob), stock);
    await agent.post('/api/orders').send({ items: [{ productId: knob.id, qty: 1 }], shipping, paymentMethod: 'cod' }).expect(201);
    await request(cashOnly).post('/api/payments/webhook').set('X-Razorpay-Signature', 'a'.repeat(64)).send({ event: 'payment.captured' }).expect(404);
  });
});
