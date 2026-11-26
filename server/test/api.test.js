// API tests: normal use, bad input, and security checks.
// Run with "npm test". Uses its own database (layerforge_test), never your real one.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { Order, Product, User } from '../src/models.js';

if (!config.mongoUri.endsWith('_test')) {
  throw new Error('Refusing to run: tests wipe the database, so MONGO_URI must end with "_test".');
}

const app = createApp({ authLimit: 1000 });
const shipping = { fullName: 'Test User', phone: '9876543210', address: '12 Maker Street', city: 'Gurugram', pincode: '122001' };
const alice = { name: 'Alice', email: 'alice@example.com', password: 'printer123' };
const bob = { name: 'Bob', email: 'bob@example.com', password: 'filament456' };
let spool; // in stock: 5
let soldOut; // in stock: 0

before(async () => {
  await mongoose.connect(config.mongoUri);
  await mongoose.connection.dropDatabase();
  await User.init();
  spool = await Product.create({ slug: 'spool', name: 'Test Spool (PLA+)', description: 'd', category: 'Filament', price: 900, stock: 5 });
  soldOut = await Product.create({ slug: 'gone', name: 'Sold Out Printer', description: 'd', category: 'Printers', price: 20000, stock: 0 });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// A logged-in browser session (keeps cookies between requests).
async function loginAs(person) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: person.email, password: person.password });
  assert.equal(res.status, 200);
  return agent;
}

describe('accounts', () => {
  test('sign up creates an account and logs in with an httpOnly cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(alice);
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['email', 'id', 'name']);
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
});

describe('products', () => {
  test('lists products and filters by category', async () => {
    const all = await request(app).get('/api/products');
    assert.equal(all.status, 200);
    assert.equal(all.body.products.length, 2);
    const filtered = await request(app).get('/api/products').query({ category: 'Filament' });
    assert.deepEqual(filtered.body.products.map((p) => p.slug), ['spool']);
  });

  test('search treats special characters as plain text', async () => {
    const hit = await request(app).get('/api/products').query({ q: '(pla+)' });
    assert.deepEqual(hit.body.products.map((p) => p.slug), ['spool']);
    const miss = await request(app).get('/api/products').query({ q: '.*' });
    assert.equal(miss.status, 200);
    assert.equal(miss.body.products.length, 0);
  });

  test('rejects an unknown category and returns 404 for bad product ids', async () => {
    await request(app).get('/api/products').query({ category: 'Hacks' }).expect(400);
    await request(app).get('/api/products/not-an-id').expect(404);
    await request(app).get('/api/products/000000000000000000000000').expect(404);
    await request(app).get(`/api/products/${spool.id}`).expect(200);
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
      user: '000000000000000000000000',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.total, 1800);
    assert.equal(res.body.order.items[0].price, 900);
    assert.equal((await Product.findById(spool.id)).stock, 3); // 5 - 2
    const saved = await Order.findById(res.body.order._id);
    assert.equal(String(saved.user), (await User.findOne({ email: alice.email })).id);
  });

  test('cannot order more than is in stock, and stock is left unchanged', async () => {
    const agent = await loginAs(alice);
    const res = await agent.post('/api/orders').send({ items: [{ productId: spool.id, qty: 4 }], shipping });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Only 3 left/);
    assert.equal((await Product.findById(spool.id)).stock, 3);
  });

  test('if one item is out of stock, nothing is taken from the others', async () => {
    const agent = await loginAs(alice);
    const res = await agent.post('/api/orders').send({
      items: [{ productId: spool.id, qty: 1 }, { productId: soldOut.id, qty: 1 }],
      shipping,
    });
    assert.equal(res.status, 409);
    assert.equal((await Product.findById(spool.id)).stock, 3);
    assert.equal(await Order.countDocuments(), 1);
  });

  test('two people racing for the last items cannot both get them', async () => {
    const [a, b] = await Promise.all([loginAs(alice), loginAs(bob)]);
    const body = { items: [{ productId: spool.id, qty: 2 }], shipping }; // 3 left, both want 2
    const results = await Promise.all([a.post('/api/orders').send(body), b.post('/api/orders').send(body)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await Product.findById(spool.id)).stock, 1);
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
      { items: [item] },
    ];
    for (const body of bad) {
      const res = await agent.post('/api/orders').send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal((await Product.findById(spool.id)).stock, 1);
  });

  test('users only ever see their own orders', async () => {
    const [a, b] = await Promise.all([loginAs(alice), loginAs(bob)]);
    const aliceId = (await User.findOne({ email: alice.email })).id;
    const bobId = (await User.findOne({ email: bob.email })).id;
    await Order.deleteMany({ user: bobId });
    await b.post('/api/orders').send({ items: [{ productId: spool.id, qty: 1 }], shipping }).expect(201);
    for (const [agent, id] of [[a, aliceId], [b, bobId]]) {
      const { orders } = (await agent.get('/api/orders')).body;
      assert.ok(orders.length >= 1);
      assert.ok(orders.every((o) => o.user === id));
    }
  });
});

describe('general protection', () => {
  test('requests from another website are blocked (CSRF)', async () => {
    const agent = await loginAs(alice);
    const body = { items: [{ productId: spool.id, qty: 1 }], shipping };
    await agent.post('/api/orders').set('Origin', 'http://evil.example').send(body).expect(403);
    // What a plain HTML form on another site would send:
    await agent.post('/api/orders').type('form').send('a=b').expect(415);
    assert.equal((await Product.findById(spool.id)).stock, 0);
  });

  test('security headers are set and server details are hidden', async () => {
    const res = await request(app).get('/api/products');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['content-security-policy']);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('broken or oversized requests get a clean error, not a crash', async () => {
    const broken = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.equal(broken.status, 400);
    const huge = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(50_000) });
    assert.equal(huge.status, 413);
    await request(app).get('/api/does-not-exist').expect(404);
  });

  test('repeated log-in attempts are rate limited', async () => {
    const limited = createApp({ authLimit: 3 });
    const attempt = () => request(limited).post('/api/auth/login').send({ email: alice.email, password: 'guess12345' });
    for (let i = 0; i < 3; i++) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
  });
});
