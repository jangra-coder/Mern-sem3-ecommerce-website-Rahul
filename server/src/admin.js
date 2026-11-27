// Admin-only API: dashboard numbers, all orders, product management, customers.
import express, { Router } from 'express';
import { z } from 'zod';
import { HttpError } from './errors.js';
import { requireAdmin } from './auth.js';
import { CATEGORIES, ORDER_STATUSES, SHAPES, Order, Product, ProductImage, User } from './models.js';
import { objectId } from './validation.js';

const IN_PROGRESS = ['Placed', 'Packed', 'Shipped']; // can still move forward
const ADMIN_CAN_CANCEL = ['Pending payment', ...IN_PROGRESS];
const LOW_STOCK = 5;
const MAX_IMAGE_BYTES = 600 * 1024;
const after = { returnDocument: 'after' };

const productSchema = z.object({
  name: z.string('Name is required').trim().min(2, 'Name is too short').max(80, 'Name is too long'),
  description: z.string('Description is required').trim().min(5, 'Description is too short').max(1000, 'Description is too long'),
  category: z.enum(CATEGORIES, 'Choose a valid category'),
  price: z.number('Price must be a number').int('Price must be a whole number of rupees').min(1, 'Price must be at least ₹1').max(10_000_000, 'Price is too high'),
  stock: z.number('Stock must be a number').int('Stock must be a whole number').min(0, 'Stock cannot be negative').max(100_000, 'Stock is too high'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #ff5a2b').default('#ff5a2b'),
  shape: z.enum(SHAPES, 'Choose a valid illustration').default('vase'),
  featured: z.boolean().default(false),
  // The stock number the admin's form started from. If an order changed the
  // stock in the meantime, saving is refused rather than silently undoing it.
  stockWas: z.number().int().min(0).optional(),
  specs: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'A spec is missing its label').max(40, 'A spec label is too long'),
        value: z.string().trim().min(1, 'A spec is missing its value').max(80, 'A spec value is too long'),
      })
    )
    .max(10, 'At most 10 specs')
    .default([]),
});

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';

// Works out what a file really is from its first bytes. The type claimed by
// the browser is never trusted, so a script can't be uploaded as a "photo".
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function createAdminRouter(orders, razorpay) {
  const router = Router();
  router.use(requireAdmin); // every route below needs an admin account

  const idParam = (req, what) => {
    const id = objectId.safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, `${what} not found.`);
    return id.data;
  };

  // ---------- Dashboard ----------

  router.get('/stats', async (req, res) => {
    const sum = async (match) =>
      (await Order.aggregate([{ $match: match }, { $group: { _id: null, sum: { $sum: '$total' } } }]))[0]?.sum || 0;
    const [ordersCount, open, unpaid, revenue, paidOnline, refundIssues, products, lowStock, customers] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: { $in: IN_PROGRESS } }),
      Order.countDocuments({ status: 'Pending payment' }),
      sum({ status: { $nin: ['Cancelled', 'Pending payment'] } }),
      sum({ 'payment.method': 'razorpay', 'payment.status': 'paid' }),
      Order.countDocuments({ status: 'Cancelled', 'payment.method': 'razorpay', 'payment.status': { $in: ['paid', 'refunding', 'refund_failed'] } }),
      Product.countDocuments(),
      Product.countDocuments({ stock: { $lte: LOW_STOCK } }),
      User.countDocuments({ isAdmin: { $ne: true } }),
    ]);
    res.json({
      orders: ordersCount, openOrders: open, unpaidOrders: unpaid, revenue, paidOnline, refundIssues, products, lowStock, customers,
      onlinePayments: razorpay.enabled,
      webhook: razorpay.webhookEnabled,
    });
  });

  // ---------- Orders ----------

  router.get('/orders', async (req, res) => {
    const { status } = z.object({ status: z.enum(ORDER_STATUSES, 'Unknown status').optional() }).parse(req.query);
    const list = await Order.find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('user', 'name email'); // only name and email, never the password hash
    res.json({ orders: list, statuses: ORDER_STATUSES });
  });

  router.patch('/orders/:id', async (req, res) => {
    const id = idParam(req, 'Order');
    const { status } = z.object({ status: z.enum([...IN_PROGRESS, 'Delivered', 'Cancelled'], 'Unknown status') }).parse(req.body);

    if (status === 'Cancelled') {
      // Puts stock back and refunds an online payment; can only happen once.
      const cancelled = await orders.cancelOrder({ _id: id }, ADMIN_CAN_CANCEL);
      return res.json({ order: await cancelled.populate('user', 'name email') });
    }

    // The "still in progress" condition is part of the update itself, so a
    // finished or unpaid order can't be changed by a stray click.
    const update = { status };
    const order = await Order.findOneAndUpdate({ _id: id, status: { $in: IN_PROGRESS } }, { $set: update }, after);
    if (!order) {
      const existing = await Order.findById(id);
      if (!existing) throw new HttpError(404, 'Order not found.');
      throw new HttpError(
        409,
        existing.status === 'Pending payment'
          ? "This order hasn't been paid for yet. It can only be cancelled."
          : `This order is already ${existing.status.toLowerCase()} and can't be changed.`
      );
    }
    if (status === 'Delivered' && order.payment.method === 'cod') {
      order.payment.status = 'paid'; // the courier collected the cash
      order.payment.paidAt = new Date();
      await order.save();
    }
    res.json({ order: await order.populate('user', 'name email') });
  });

  // Try again when a refund did not go through the first time.
  router.post('/orders/:id/refund', async (req, res) => {
    const order = await orders.refundOrder(idParam(req, 'Order'));
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.payment.status !== 'refunded') {
      throw new HttpError(
        order.payment.status === 'refund_failed' ? 502 : 409,
        order.payment.status === 'refund_failed'
          ? 'Razorpay did not accept the refund. Check the Razorpay dashboard, then try again.'
          : order.payment.status === 'refunding'
            ? 'A refund for this order is already in progress. Check again in about 10 minutes.'
            : 'There is nothing to refund on this order right now.'
      );
    }
    res.json({ order: await order.populate('user', 'name email') });
  });

  // ---------- Products ----------

  router.post('/products', async (req, res) => {
    const { stockWas, ...data } = productSchema.parse(req.body);
    let slug = slugify(data.name);
    if (await Product.exists({ slug })) slug += `-${Date.now().toString(36)}`;
    res.status(201).json({ product: await Product.create({ ...data, slug }) });
  });

  router.put('/products/:id', async (req, res) => {
    const id = idParam(req, 'Product');
    const { stockWas, ...data } = productSchema.parse(req.body);
    const filter = stockWas === undefined ? { _id: id } : { _id: id, stock: stockWas };
    const product = await Product.findOneAndUpdate(filter, { $set: data }, { ...after, runValidators: true });
    if (!product) {
      const current = await Product.findById(id);
      if (!current) throw new HttpError(404, 'Product not found.');
      throw new HttpError(409, `Stock changed to ${current.stock} while you were editing (an order or cancellation came in). Check the stock number and save again.`);
    }
    res.json({ product });
  });

  router.delete('/products/:id', async (req, res) => {
    const id = idParam(req, 'Product');
    // Past orders keep their own copy of the name and price, so they stay intact.
    const product = await Product.findByIdAndDelete(id);
    if (!product) throw new HttpError(404, 'Product not found.');
    await ProductImage.deleteOne({ _id: id });
    res.json({ ok: true });
  });

  // A photo arrives as a data URL, already shrunk by the browser.
  // (This route has its own, larger body limit - see app.js.)
  router.put('/products/:id/image', express.json({ limit: '1mb' }), async (req, res) => {
    const id = idParam(req, 'Product');
    const { image } = z.object({ image: z.string('No image was sent').max(1_000_000, 'Image is too large') }).parse(req.body);
    const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(image);
    if (!match) throw new HttpError(400, 'Upload a JPEG, PNG or WebP image.');
    const data = Buffer.from(match[1], 'base64');
    if (data.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image is too large (600 KB at most).');
    const type = sniffImage(data);
    if (!type) throw new HttpError(400, 'That file is not a JPEG, PNG or WebP image.');

    const product = await Product.findByIdAndUpdate(id, { $set: { imageVersion: Date.now() } }, after);
    if (!product) throw new HttpError(404, 'Product not found.');
    await ProductImage.findOneAndUpdate({ _id: id }, { $set: { type, data } }, { upsert: true });
    res.json({ product });
  });

  router.delete('/products/:id/image', async (req, res) => {
    const id = idParam(req, 'Product');
    const product = await Product.findByIdAndUpdate(id, { $set: { imageVersion: 0 } }, after);
    if (!product) throw new HttpError(404, 'Product not found.');
    await ProductImage.deleteOne({ _id: id });
    res.json({ product });
  });

  // ---------- Customers ----------

  router.get('/customers', async (req, res) => {
    const [users, counts] = await Promise.all([
      User.find({}, 'name email isAdmin createdAt').sort({ createdAt: -1 }).limit(500),
      Order.aggregate([{ $group: { _id: '$user', orders: { $sum: 1 } } }]),
    ]);
    const orderCount = new Map(counts.map((c) => [String(c._id), c.orders]));
    res.json({
      customers: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isAdmin: u.isAdmin === true,
        joined: u.createdAt,
        orders: orderCount.get(u.id) || 0,
      })),
    });
  });

  return router;
}
