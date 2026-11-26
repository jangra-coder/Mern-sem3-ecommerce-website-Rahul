import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { Product, User } from './models.js';
import { seedProducts } from './seed.js';

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
} catch {
  console.error(`Could not connect to MongoDB at ${config.mongoUri}. Is mongod running?`);
  process.exit(1);
}

await User.init(); // make sure the "unique email" index exists
if ((await Product.countDocuments()) === 0) {
  console.log(`Empty shop - added ${await seedProducts()} sample products.`);
}

createApp().listen(config.port, config.host, () => {
  console.log(`LayerForge is running at http://localhost:${config.port}`);
});
