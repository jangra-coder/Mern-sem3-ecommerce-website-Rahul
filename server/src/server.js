import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { Order, Product, User } from './models.js';
import { seedProducts } from './seed.js';

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
} catch (err) {
  console.error('Could not connect to MongoDB. Check MONGO_URI (and that the database is running / reachable).');
  console.error(err.message);
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
