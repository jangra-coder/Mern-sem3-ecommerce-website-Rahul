import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { Order, Product, User } from './models.js';
import { seedProducts } from './seed.js';

// Describes MONGO_URI for the logs without ever printing the password.
function describeMongoUri(uri) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return 'MONGO_URI is not a valid address. It should start with mongodb+srv://';
  }
  const password = (() => {
    try {
      return decodeURIComponent(u.password);
    } catch {
      return u.password;
    }
  })();
  const problems = [];
  if (!/^mongodb(\+srv)?:$/.test(u.protocol)) problems.push('it does not start with mongodb+srv://');
  if (!u.username) problems.push('no username');
  if (!password) problems.push('no password');
  if (/YOUR_PASSWORD|<|>|db_password/i.test(password)) problems.push('the password still contains a placeholder or < > brackets');
  if (/\s/.test(password)) problems.push('the password contains spaces');
  return (
    `MONGO_URI uses user "${decodeURIComponent(u.username)}" at host "${u.hostname}", database "${u.pathname.slice(1) || '(none)'}", ` +
    `password of ${password.length} characters. ` +
    (problems.length
      ? `Problems: ${problems.join('; ')}.`
      : 'It looks well-formed, so the password probably does not match the database user. Reset it in Atlas (Database Users > Edit > Edit Password > Update User) and paste the new one.')
  );
}

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
} catch (err) {
  console.error('Could not connect to MongoDB. Check MONGO_URI (and that the database is running / reachable).');
  console.error(err.message);
  console.error(describeMongoUri(config.mongoUri));
  process.exit(1);
}

// Make sure the database rules exist ("one account per email", and so on).
await Promise.all([User.init(), Order.init(), Product.init()]);
if ((await Product.countDocuments()) === 0) {
  console.log(`Empty shop - added ${await seedProducts()} sample products.`);
}

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`LayerForge is running on port ${config.port}${config.isProd ? '' : ` - open http://localhost:${config.port}`}`);
  if (!config.razorpay.keyId) console.log('Razorpay keys are not set: only cash on delivery is offered.');
  else if (!config.razorpay.webhookSecret) {
    console.warn('RAZORPAY_WEBHOOK_SECRET is not set. Payments still work, but set up the webhook (DEPLOY.md, step 4) so they are confirmed even when a customer closes the tab.');
  }
});

// Every few minutes: release online orders that were never paid, refund any
// payment that arrived for an order that was already cancelled, and finish
// refunds that were interrupted. (Also once at start-up, for a server that was asleep.)
const sweep = () => app.locals.orders.sweep();
sweep();
setInterval(sweep, 5 * 60 * 1000).unref();

// Finish requests in progress before the host stops or restarts the server.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    // Render waits up to 30 seconds; give a refund in flight time to finish.
    setTimeout(() => process.exit(0), 25000).unref();
  });
}
