// The starting catalogue. Run "npm run seed" to add or reset these products.
// (Also runs automatically the first time the server starts with an empty shop.)
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Product } from './models.js';

const spec = (pairs) => Object.entries(pairs).map(([label, value]) => ({ label, value }));

export const sampleProducts = [
  {
    slug: 'forge-one', name: 'Forge One', category: 'Printers', price: 18999, stock: 6, color: '#ff5a2b', shape: 'printer', featured: true,
    description: 'Our everyday workhorse. A rigid bed-slinger with automatic bed levelling and a direct-drive extruder that handles PLA, PETG and TPU without swapping parts. Arrives 90% assembled; first print in about twenty minutes.',
    specs: spec({ 'Build volume': '220 × 220 × 250 mm', 'Layer height': '0.08 – 0.32 mm', 'Max nozzle temp': '300 °C', 'Bed': 'PEI spring steel, 100 °C', 'Extruder': 'Direct drive, 0.4 mm', 'Levelling': 'Automatic, 25-point' }),
  },
  {
    slug: 'forge-mini', name: 'Forge Mini', category: 'Printers', price: 11499, stock: 9, color: '#2456e6', shape: 'mini', featured: false,
    description: 'A 180 mm cantilever printer that fits on a study desk and under a hostel bed. Silent stepper drivers, a magnetic flex bed and a single-cable setup.',
    specs: spec({ 'Build volume': '180 × 180 × 180 mm', 'Layer height': '0.1 – 0.3 mm', 'Max nozzle temp': '260 °C', 'Bed': 'Magnetic flex, 80 °C', 'Noise': '< 45 dB', 'Weight': '4.6 kg' }),
  },
  {
    slug: 'resin-pro-4k', name: 'Resin Pro 4K', category: 'Printers', price: 24999, stock: 3, color: '#f08a24', shape: 'resin', featured: true,
    description: 'A mono-LCD resin printer for miniatures, dental-grade detail and jewellery masters. The UV-blocking hood lifts straight off for easy access to the vat.',
    specs: spec({ 'Build volume': '143 × 89 × 175 mm', 'XY resolution': '35 µm', 'Layer height': '0.01 – 0.2 mm', 'Light source': '405 nm LED matrix', 'Print speed': 'Up to 50 mm/h' }),
  },
  {
    slug: 'pla-charcoal-1kg', name: 'PLA 1 kg — Charcoal', category: 'Filament', price: 899, stock: 40, color: '#4b4741', shape: 'spool', featured: false,
    description: 'The filament we reach for first. Prints clean at low temperatures with almost no warping, and the matte charcoal hides layer lines well.',
    specs: spec({ 'Diameter': '1.75 mm ± 0.02', 'Nozzle temp': '190 – 220 °C', 'Bed temp': '50 – 60 °C', 'Net weight': '1 kg', 'Spool': 'Recycled cardboard' }),
  },
  {
    slug: 'pla-molten-1kg', name: 'PLA 1 kg — Molten Orange', category: 'Filament', price: 899, stock: 35, color: '#ff5a2b', shape: 'spool', featured: true,
    description: 'A loud, saturated orange that photographs beautifully. Same easy-printing PLA, tuned for sharp overhangs and clean bridges.',
    specs: spec({ 'Diameter': '1.75 mm ± 0.02', 'Nozzle temp': '190 – 220 °C', 'Bed temp': '50 – 60 °C', 'Net weight': '1 kg', 'Spool': 'Recycled cardboard' }),
  },
  {
    slug: 'petg-cobalt-1kg', name: 'PETG 1 kg — Cobalt', category: 'Filament', price: 1099, stock: 25, color: '#2456e6', shape: 'spool', featured: false,
    description: 'Tougher and more heat-resistant than PLA, with a slight gloss. The right choice for brackets, enclosures and anything that lives outdoors.',
    specs: spec({ 'Diameter': '1.75 mm ± 0.02', 'Nozzle temp': '230 – 250 °C', 'Bed temp': '70 – 85 °C', 'Heat resistance': 'Up to 75 °C', 'Net weight': '1 kg' }),
  },
  {
    slug: 'tpu-mint-500g', name: 'TPU 95A 500 g — Mint', category: 'Filament', price: 1499, stock: 12, color: '#2bb58b', shape: 'spool', featured: false,
    description: 'Rubber-like and nearly indestructible. For phone cases, gaskets, tyres and feet. Print it slowly on a direct-drive extruder.',
    specs: spec({ 'Diameter': '1.75 mm ± 0.03', 'Hardness': 'Shore 95A', 'Nozzle temp': '220 – 240 °C', 'Bed temp': '40 – 60 °C', 'Print speed': '20 – 35 mm/s' }),
  },
  {
    slug: 'resin-grey-1l', name: 'Standard Resin 1 L — Slate', category: 'Resin', price: 1799, stock: 18, color: '#7b8794', shape: 'bottle', featured: false,
    description: 'A low-odour photopolymer in a neutral grey that shows every detail and takes primer well. Sands and paints without fuss.',
    specs: spec({ 'Wavelength': '405 nm', 'Volume': '1 litre', 'Exposure': '2 – 3 s per layer', 'Hardness': 'Shore 84D', 'Wash': 'Isopropyl alcohol' }),
  },
  {
    slug: 'resin-teal-wash-1l', name: 'Water-Wash Resin 1 L — Teal', category: 'Resin', price: 2099, stock: 10, color: '#1aa3a3', shape: 'bottle', featured: false,
    description: 'Cleans up under the tap, no alcohol needed. A translucent teal that glows when backlit.',
    specs: spec({ 'Wavelength': '405 nm', 'Volume': '1 litre', 'Exposure': '2.5 – 3.5 s per layer', 'Wash': 'Plain water' }),
  },
  {
    slug: 'nozzle-set-04', name: 'Brass Nozzle Set — 0.4 mm × 5', category: 'Parts', price: 299, stock: 60, color: '#c9a04a', shape: 'nozzle', featured: true,
    description: 'A worn nozzle is behind most mystery print problems. Five precision-drilled MK8 nozzles, so there is always a fresh one in the drawer.',
    specs: spec({ 'Thread': 'M6 × 1.0 (MK8)', 'Bore': '0.4 mm', 'Material': 'CNC brass', 'Quantity': '5' }),
  },
  {
    slug: 'pei-plate-235', name: 'PEI Build Plate — 235 mm', category: 'Parts', price: 1299, stock: 15, color: '#c9962c', shape: 'plate', featured: false,
    description: 'Double-sided spring steel: textured on one face, smooth on the other. Prints grip when hot and pop free once the bed cools.',
    specs: spec({ 'Size': '235 × 235 mm', 'Surface': 'Textured / smooth PEI', 'Base': 'Magnetic, included', 'Max temp': '120 °C' }),
  },
  {
    slug: 'nema17-stepper', name: 'NEMA 17 Stepper Motor', category: 'Parts', price: 749, stock: 4, color: '#34312d', shape: 'motor', featured: false,
    description: 'A drop-in replacement for tired axis motors. Runs cool and quiet on modern silent drivers.',
    specs: spec({ 'Step angle': '1.8°', 'Holding torque': '45 N·cm', 'Rated current': '1.5 A', 'Shaft': '5 mm, D-cut' }),
  },
  {
    slug: 'spiral-vase', name: 'Spiral Vase', category: 'Printed Models', price: 449, stock: 20, color: '#e9785f', shape: 'vase', featured: true,
    description: 'Printed in one continuous spiral with no seam, in a soft terracotta PLA. Made to order on our own machines; watertight with a liner.',
    specs: spec({ 'Height': '180 mm', 'Material': 'Matte PLA', 'Wall': '0.8 mm, single spiral', 'Lead time': '48 hours' }),
  },
  {
    slug: 'hex-planter', name: 'Faceted Desk Planter', category: 'Printed Models', price: 349, stock: 0, color: '#3f8f6b', shape: 'planter', featured: false,
    description: 'A low-poly planter with a hidden drainage tray. Sized for an 8 cm nursery pot.',
    specs: spec({ 'Size': '110 × 95 mm', 'Material': 'Matte PLA', 'Includes': 'Drainage tray', 'Lead time': '48 hours' }),
  },
  {
    slug: 'gear-fidget', name: 'Planetary Gear Fidget', category: 'Printed Models', price: 249, stock: 30, color: '#8b5cf6', shape: 'gear', featured: false,
    description: 'Printed fully assembled, gears already meshed. Spins straight off the bed. A small, satisfying demonstration of what a printer can do.',
    specs: spec({ 'Diameter': '70 mm', 'Material': 'PLA', 'Assembly': 'None, print-in-place' }),
  },
];

// Samples from the first version of the shop that the new catalogue replaces.
const retiredSlugs = ['pla-black-1kg', 'pla-orange-1kg', 'petg-blue-1kg', 'tpu-flex-500g', 'dragon-articulated', 'planter-lowpoly'];

export async function seedProducts() {
  for (const p of sampleProducts) {
    await Product.updateOne({ slug: p.slug }, { $set: p }, { upsert: true });
  }
  await Product.deleteMany({ slug: { $in: retiredSlugs } });
  return sampleProducts.length;
}

// Only when run directly: node src/seed.js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mongoose.connect(config.mongoUri);
  console.log(`Seeded ${await seedProducts()} products.`);
  await mongoose.disconnect();
}
