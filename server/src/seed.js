// Sample products. Run "npm run seed" to add or reset them.
// (Also runs automatically the first time the server starts with an empty shop.)
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Product } from './models.js';

export const sampleProducts = [
  { slug: 'forge-one', name: 'Forge One FDM Printer', category: 'Printers', price: 18999, stock: 6, color: '#f97316',
    description: '220 x 220 x 250 mm build volume, auto bed levelling and a direct-drive extruder. A reliable first printer that prints PLA, PETG and TPU out of the box.' },
  { slug: 'forge-mini', name: 'Forge Mini Printer', category: 'Printers', price: 11499, stock: 9, color: '#0ea5e9',
    description: 'Compact 180 mm cube printer that fits on a study desk. Quiet stepper drivers and a magnetic flexible bed.' },
  { slug: 'resin-pro-4k', name: 'Resin Pro 4K Printer', category: 'Printers', price: 24999, stock: 3, color: '#8b5cf6',
    description: 'Mono 4K LCD resin printer for miniatures and jewellery masters. 35 micron XY resolution.' },
  { slug: 'pla-black-1kg', name: 'PLA Filament 1 kg - Black', category: 'Filament', price: 899, stock: 40, color: '#334155',
    description: '1.75 mm PLA with +/- 0.02 mm tolerance. Easy to print, low warp, wound neatly on a cardboard spool.' },
  { slug: 'pla-orange-1kg', name: 'PLA Filament 1 kg - Orange', category: 'Filament', price: 899, stock: 35, color: '#f97316',
    description: '1.75 mm PLA in a bright safety orange. Great for prototypes and visible parts.' },
  { slug: 'petg-blue-1kg', name: 'PETG Filament 1 kg - Blue', category: 'Filament', price: 1099, stock: 25, color: '#2563eb',
    description: 'Tough, slightly flexible and heat resistant up to 75 C. Ideal for functional and outdoor parts.' },
  { slug: 'tpu-flex-500g', name: 'TPU Flexible Filament 500 g', category: 'Filament', price: 1499, stock: 12, color: '#10b981',
    description: 'Shore 95A flexible filament for phone cases, gaskets and tyres. Best with direct-drive extruders.' },
  { slug: 'resin-grey-1l', name: 'Standard Resin 1 L - Grey', category: 'Resin', price: 1799, stock: 18, color: '#64748b',
    description: '405 nm standard photopolymer resin. Low odour, fine detail, easy to sand and paint.' },
  { slug: 'nozzle-set-04', name: 'Brass Nozzle Set 0.4 mm (5 pcs)', category: 'Parts', price: 299, stock: 60, color: '#ca8a04',
    description: 'MK8-compatible brass nozzles. Keep spares handy - a fresh nozzle fixes most print quality issues.' },
  { slug: 'pei-plate-235', name: 'PEI Spring Steel Build Plate 235 mm', category: 'Parts', price: 1299, stock: 15, color: '#b45309',
    description: 'Double-sided textured and smooth PEI sheet with magnetic base. Prints pop off when the bed cools.' },
  { slug: 'dragon-articulated', name: 'Articulated Dragon (printed)', category: 'Printed Models', price: 499, stock: 20, color: '#dc2626',
    description: 'A 30 cm print-in-place flexible dragon in silk PLA. Printed to order in our workshop.' },
  { slug: 'planter-lowpoly', name: 'Low-Poly Desk Planter (printed)', category: 'Printed Models', price: 349, stock: 0, color: '#16a34a',
    description: 'Geometric planter with drainage tray, printed in matte PLA. Fits an 8 cm pot.' },
];

export async function seedProducts() {
  for (const p of sampleProducts) {
    await Product.updateOne({ slug: p.slug }, { $set: p }, { upsert: true });
  }
  return sampleProducts.length;
}

// Only when run directly: node src/seed.js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mongoose.connect(config.mongoUri);
  console.log(`Seeded ${await seedProducts()} products.`);
  await mongoose.disconnect();
}
