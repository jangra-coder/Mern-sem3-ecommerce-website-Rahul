// Products (public) and orders (login required).
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import { CATEGORIES, Order, Product } from './models.js';

const MAX_QTY_PER_PRODUCT = 10;
const objectId = z.string('Invalid id').regex(/^[a-f\d]{24}$/i, 'Invalid id');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Products ----------

export const productRouter = Router();

productRouter.get('/', async (req, res) => {
  const { category, q } = z
    .object({
      category: z.enum(CATEGORIES, 'Unknown category').optional(),
      q: z.string().trim().max(60, 'Search text is too long').optional(),
    })
    .parse(req.query);

  const filter = {};
  if (category) filter.category = category;
  // The search text is escaped, so it is matched literally and can't be
  // used to run a slow or malicious regular expression.
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

  const products = await Product.find(filter).sort({ category: 1, name: 1 });
  res.json({ products, categories: CATEGORIES });
});

productRouter.get('/:id', async (req, res) => {
  const id = objectId.safeParse(req.params.id);
  const product = id.success ? await Product.findById(id.data) : null;
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product });
});

// ---------- Orders ----------

const text = (label, min, max) =>
  z.string(`${label} is required`).trim().min(min, `${label} is too short`).max(max, `${label} is too long`);

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: objectId,
        qty: z.number('Quantity must be a number').int('Quantity must be a whole number').min(1).max(MAX_QTY_PER_PRODUCT),
      }),
      'Your cart is empty'
    )
    .min(1, 'Your cart is empty')
    .max(20, 'Too many different items in one order'),
  shipping: z.object(
    {
      fullName: text('Full name', 2, 80),
      phone: z.string('Phone is required').trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
      address: text('Address', 5, 200),
      city: text('City', 2, 60),
      pincode: z.string('PIN code is required').trim().regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code'),
    },
    'Shipping details are required'
  ),
});

export const orderRouter = Router();
orderRouter.use(requireAuth);

orderRouter.post('/', async (req, res) => {
  // Anything else the browser sends (prices, totals, user ids) is dropped
  // here. Prices always come from the database.
  const { items, shipping } = orderSchema.parse(req.body);

  const wanted = new Map(); // productId -> quantity, duplicates merged
  for (const { productId, qty } of items) {
    wanted.set(productId, (wanted.get(productId) || 0) + qty);
  }
  for (const qty of wanted.values()) {
    if (qty > MAX_QTY_PER_PRODUCT) {
      return res.status(400).json({ error: `You can order at most ${MAX_QTY_PER_PRODUCT} of one product.` });
    }
  }

  const products = await Product.find({ _id: { $in: [...wanted.keys()] } });
  if (products.length !== wanted.size) {
    return res.status(400).json({ error: 'A product in your cart is no longer available.' });
  }

  // Take stock one product at a time. The "stock >= qty" condition makes
  // each step safe even if two people order the last item at the same moment.
  const taken = [];
  const giveBack = () =>
    Promise.all(taken.map(([id, qty]) => Product.updateOne({ _id: id }, { $inc: { stock: qty } })));

  for (const p of products) {
    const qty = wanted.get(p.id);
    const result = await Product.updateOne({ _id: p._id, stock: { $gte: qty } }, { $inc: { stock: -qty } });
    if (result.modifiedCount !== 1) {
      await giveBack();
      const left = (await Product.findById(p._id))?.stock ?? 0;
      return res.status(409).json({
        error: left > 0 ? `Only ${left} left in stock: ${p.name}.` : `Out of stock: ${p.name}.`,
      });
    }
    taken.push([p._id, qty]);
  }

  try {
    const orderItems = products.map((p) => ({ product: p._id, name: p.name, price: p.price, qty: wanted.get(p.id) }));
    const total = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    const order = await Order.create({ user: req.user._id, items: orderItems, shipping, total });
    res.status(201).json({ order });
  } catch (err) {
    await giveBack();
    throw err;
  }
});

orderRouter.get('/', async (req, res) => {
  // Only ever the logged-in user's own orders.
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ orders });
});
