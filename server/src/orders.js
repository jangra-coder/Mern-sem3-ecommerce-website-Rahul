// Everything that happens to an order: placing it, taking payment,
// cancelling, refunding, and cleaning up orders that were never paid.
//
// Ground rules for money:
//  - An order is only marked paid after Razorpay itself confirms the money
//    was captured, for the exact amount of the order.
//  - Any captured payment that does not end up paying for a live order
//    (late, duplicate, or for a cancelled order) is refunded.
//  - Every change of state is a single conditional database update, so two
//    things happening at once (two clicks, a webhook and the browser, the
//    clean-up timer) can never both "win".
import { Router } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { requireAuth } from './auth.js';
import { Order, Product, User } from './models.js';
import { addressSchema, objectId } from './validation.js';

const CUSTOMER_CAN_CANCEL = ['Pending payment', 'Placed', 'Packed'];
const OPEN_STATUSES = ['Pending payment', 'Placed'];
const REFUND_RETRY_AFTER_MS = 10 * 60 * 1000;
const RECHECK_CANCELLED_FOR_MS = 6 * 60 * 60 * 1000;
const RECHECK_EVERY_MS = 25 * 60 * 1000;
const paise = (rupees) => Math.round(rupees * 100);
const after = { returnDocument: 'after' };
const log = (...args) => !config.isTest && console.error(...args);

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: objectId,
        qty: z
          .number('Quantity must be a number')
          .int('Quantity must be a whole number')
          .min(1)
          .max(config.maxQtyPerProduct),
      }),
      'Your cart is empty'
    )
    .min(1, 'Your cart is empty')
    .max(20, 'Too many different items in one order'),
  shipping: addressSchema,
  paymentMethod: z.enum(['cod', 'razorpay'], 'Choose how you want to pay').default('cod'),
  saveAddress: z.boolean().optional(),
});

// What the checkout window sends back after a successful payment.
const razorpayId = z.string().regex(/^[A-Za-z0-9_]{6,60}$/, 'Invalid payment details');
const verifySchema = z.object({
  razorpay_order_id: razorpayId,
  razorpay_payment_id: razorpayId,
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid payment details'),
});

export function createOrderService(razorpay) {
  // Products deleted since the order was placed are simply skipped.
  const restoreStock = (order) =>
    Promise.all(order.items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { stock: i.qty } })));

  // What the browser needs to open the Razorpay window. Never the secret.
  const paymentDetails = (order) => ({
    keyId: razorpay.keyId,
    razorpayOrderId: order.payment.razorpayOrderId,
    amount: paise(order.total),
    currency: 'INR',
  });

  // Only one order at a time per account, so the limits below can't be
  // dodged by sending many requests at once.
  async function withOrderLock(userId, work) {
    const now = new Date();
    const locked = await User.findOneAndUpdate(
      { _id: userId, $or: [{ placingOrderUntil: null }, { placingOrderUntil: { $lt: now } }] },
      { $set: { placingOrderUntil: new Date(now.getTime() + 30000) } }
    );
    if (!locked) throw new HttpError(429, 'Your previous order is still being placed. Please wait a moment.');
    try {
      return await work();
    } finally {
      await User.updateOne({ _id: userId }, { $set: { placingOrderUntil: null } });
    }
  }

  async function placeOrder(user, { items, shipping, paymentMethod }) {
    const online = paymentMethod === 'razorpay';
    if (online && !razorpay.enabled) {
      throw new HttpError(400, 'Online payment is not available right now. Please choose cash on delivery.');
    }

    // productId -> quantity. Ids are already lower-case (see validation.js),
    // so the same product written two ways is still counted once.
    const wanted = new Map();
    for (const { productId, qty } of items) wanted.set(productId, (wanted.get(productId) || 0) + qty);
    for (const qty of wanted.values()) {
      if (qty > config.maxQtyPerProduct) {
        throw new HttpError(400, `You can order at most ${config.maxQtyPerProduct} of one product.`);
      }
    }

    return withOrderLock(user._id, async () => {
      // Orders that haven't shipped yet hold stock, so each account can only
      // have a few open at once.
      const [open, unpaid] = await Promise.all([
        Order.countDocuments({ user: user._id, status: { $in: OPEN_STATUSES } }),
        Order.countDocuments({ user: user._id, status: 'Pending payment' }),
      ]);
      if (online && unpaid >= config.maxUnpaidOrders) {
        throw new HttpError(409, 'You already have unpaid orders. Pay for them or cancel them first.');
      }
      if (open >= config.maxOpenOrders) {
        throw new HttpError(409, `You have ${open} orders waiting to ship. Please wait for those, or cancel one, before ordering again.`);
      }

      const products = await Product.find({ _id: { $in: [...wanted.keys()] } });
      if (products.length !== wanted.size) {
        throw new HttpError(400, 'A product in your cart is no longer available.');
      }

      // Take stock one product at a time. The "stock >= qty" condition makes
      // each step safe even if two people order the last item at the same
      // moment. If anything at all goes wrong, everything taken is put back.
      const taken = [];
      let order;
      try {
        for (const p of products) {
          const qty = wanted.get(p.id);
          const result = await Product.updateOne({ _id: p._id, stock: { $gte: qty } }, { $inc: { stock: -qty } });
          if (result.modifiedCount !== 1) {
            const left = (await Product.findById(p._id))?.stock ?? 0;
            throw new HttpError(409, left > 0 ? `Only ${left} left in stock: ${p.name}.` : `Out of stock: ${p.name}.`);
          }
          taken.push([p._id, qty]);
        }

        // Prices always come from the database, never from the browser.
        const orderItems = products.map((p) => ({ product: p._id, name: p.name, price: p.price, qty: wanted.get(p.id) }));
        const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
        const shippingFee = subtotal >= config.shipping.freeAbove ? 0 : config.shipping.fee;
        order = await Order.create({
          user: user._id,
          items: orderItems,
          shipping,
          subtotal,
          shippingFee,
          total: subtotal + shippingFee,
          status: online ? 'Pending payment' : 'Placed',
          payment: { method: paymentMethod, status: online ? 'pending' : 'cod' },
        });
        if (online) {
          const created = await razorpay.createOrder({ amountPaise: paise(order.total), receipt: order.id, notes: { orderId: order.id } });
          order.payment.razorpayOrderId = created.id;
          await order.save();
        }
      } catch (err) {
        await Promise.all(taken.map(([id, qty]) => Product.updateOne({ _id: id }, { $inc: { stock: qty } }))).catch((e) =>
          log('Could not return stock after a failed order:', e.message)
        );
        if (order) await Order.deleteOne({ _id: order._id }).catch(() => {});
        throw err;
      }
      return { order, payment: online ? paymentDetails(order) : null };
    });
  }

  // Sends the money back for a cancelled, paid order. Only one caller can
  // "claim" the refund, so it can never be sent twice from here; Razorpay
  // also refuses to refund more than was paid.
  async function refundOrder(orderId) {
    const stale = new Date(Date.now() - REFUND_RETRY_AFTER_MS);
    const claimed = await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: 'Cancelled',
        'payment.method': 'razorpay',
        'payment.razorpayPaymentId': { $type: 'string' },
        $or: [
          { 'payment.status': { $in: ['paid', 'refund_failed'] } },
          { 'payment.status': 'refunding', 'payment.refundStartedAt': { $lt: stale } },
        ],
      },
      { $set: { 'payment.status': 'refunding', 'payment.refundStartedAt': new Date() } },
      after
    );
    if (!claimed) return Order.findById(orderId);

    try {
      const refund = await razorpay.refund(claimed.payment.razorpayPaymentId, paise(claimed.total));
      return await Order.findByIdAndUpdate(orderId, { $set: { 'payment.status': 'refunded', 'payment.refundId': refund.id } }, after);
    } catch (err) {
      const alreadyDone = /fully refunded|already been refunded/i.test(err.message);
      if (!alreadyDone) log(`Refund failed for order ${orderId}:`, err.message);
      return Order.findByIdAndUpdate(orderId, { $set: { 'payment.status': alreadyDone ? 'refunded' : 'refund_failed' } }, after);
    }
  }

  // Records a captured payment. Safe to call any number of times for the same
  // payment (the checkout window, the webhook and the clean-up timer may all
  // report it). `amountPaise` is what Razorpay says was captured.
  async function settlePayment(razorpayOrderId, paymentId, amountPaise) {
    const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
    if (!order) return null;
    if (amountPaise !== paise(order.total)) {
      log(`Payment ${paymentId} has the wrong amount for order ${order.id}; ignored.`);
      return order;
    }
    const paid = { 'payment.status': 'paid', 'payment.razorpayPaymentId': paymentId, 'payment.paidAt': new Date() };

    // The normal case: the order was waiting for exactly this.
    const confirmed = await Order.findOneAndUpdate(
      { _id: order._id, status: 'Pending payment', 'payment.status': 'pending' },
      { $set: { status: 'Placed', ...paid } },
      after
    );
    if (confirmed) return confirmed;

    // The money arrived after the order was cancelled (it timed out while the
    // customer was still paying, or was cancelled in another tab): send it back.
    const late = await Order.findOneAndUpdate(
      { _id: order._id, status: 'Cancelled', 'payment.status': { $in: ['pending', 'void'] } },
      { $set: paid },
      after
    );
    if (late) return refundOrder(late._id);

    // A second payment for an order that is already paid (for example, paid
    // in two tabs at once): refund the extra one, exactly once.
    const current = await Order.findById(order._id);
    if (current.payment.razorpayPaymentId && current.payment.razorpayPaymentId !== paymentId) {
      const claimed = await Order.updateOne(
        { _id: order._id, 'payment.extraPayments': { $ne: paymentId } },
        { $addToSet: { 'payment.extraPayments': paymentId } }
      );
      if (claimed.modifiedCount === 1) {
        try {
          await razorpay.refund(paymentId, amountPaise);
        } catch (err) {
          if (!/fully refunded|already been refunded/i.test(err.message)) {
            // Forget the claim so the next report of this payment tries again.
            await Order.updateOne({ _id: order._id }, { $pull: { 'payment.extraPayments': paymentId } });
            throw err;
          }
        }
      }
    }
    return current;
  }

  // Asks Razorpay directly whether an online order has in fact been paid.
  // For an order still waiting, a payment that was only authorised (not yet
  // captured) is captured now. For a cancelled one it is left alone, and the
  // bank releases the hold by itself.
  async function reconcile(order, { capture = true } = {}) {
    if (!razorpay.enabled || order.payment.method !== 'razorpay' || !order.payment.razorpayOrderId) return order;
    if (!['pending', 'void'].includes(order.payment.status)) return order;
    const { items = [] } = await razorpay.paymentsForOrder(order.payment.razorpayOrderId);
    let captured = items.find((p) => p.status === 'captured');
    if (!captured && capture && order.status === 'Pending payment') {
      const authorized = items.find((p) => p.status === 'authorized' && p.amount === paise(order.total));
      if (authorized) captured = await captureOrFetch(authorized.id, authorized.amount);
    }
    if (!captured || captured.status !== 'captured') return order;
    return (await settlePayment(order.payment.razorpayOrderId, captured.id, captured.amount)) || order;
  }

  async function captureOrFetch(paymentId, amountPaise) {
    try {
      return await razorpay.capture(paymentId, amountPaise);
    } catch (err) {
      // Captured by Razorpay's own auto-capture a moment earlier.
      if (/already been captured/i.test(err.message)) return razorpay.getPayment(paymentId);
      throw err;
    }
  }

  // Cancels an order if it is still in one of the allowed stages, refunds any
  // online payment and puts the items back in stock.
  async function cancelOrder(filter, allowedStatuses) {
    let order = await Order.findOne(filter);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status === 'Pending payment') {
      // Paid at the last second? Then it is refunded below. If Razorpay can't
      // be reached we still cancel; a late payment is caught and refunded later.
      order = await reconcile(order, { capture: false }).catch(() => order);
    }

    const before = await Order.findOneAndUpdate(
      { _id: order._id, status: { $in: allowedStatuses } },
      { $set: { status: 'Cancelled' } },
      { returnDocument: 'before' }
    );
    if (!before) {
      const current = (await Order.findById(order._id))?.status || 'gone';
      throw new HttpError(409, `This order is ${current.toLowerCase()} and can't be cancelled.`);
    }

    // Nothing was paid: record that, unless a payment slipped in meanwhile
    // (then settlePayment has already marked it paid and refunds it).
    await Order.updateOne({ _id: before._id, 'payment.status': { $in: ['pending', 'cod'] } }, { $set: { 'payment.status': 'void' } });

    // Money first, then stock.
    let result = await Order.findById(before._id);
    if (result.payment.method === 'razorpay' && result.payment.status === 'paid') result = await refundOrder(before._id);
    await restoreStock(before).catch((err) => log(`Could not restock cancelled order ${before.id}:`, err.message));
    return result;
  }

  // Unpaid online orders hold stock. After a while they are cancelled so the
  // items go back on sale, but only after checking they really weren't paid.
  async function expirePendingOrders(now = Date.now()) {
    const cutoff = new Date(now - config.pendingPaymentMinutes * 60 * 1000);
    const stale = await Order.find({ status: 'Pending payment', createdAt: { $lt: cutoff } }).limit(50);
    let cancelled = 0;
    for (const order of stale) {
      try {
        const fresh = await reconcile(order); // paid after all? then keep it
        if (fresh.status !== 'Pending payment') continue;
        await cancelOrder({ _id: order._id }, ['Pending payment']);
        cancelled += 1;
      } catch (err) {
        // Razorpay unreachable: leave this one for the next run rather than
        // cancel something that may have been paid.
        if (!(err instanceof HttpError)) log('Could not expire order', order.id, err.message);
      }
    }
    return cancelled;
  }

  // Recently cancelled online orders are re-checked for a while, in case the
  // customer finished paying after the order was released and closed the tab
  // before the site heard about it. Any such payment is refunded.
  async function recheckCancelled(now = Date.now()) {
    const list = await Order.find({
      'payment.method': 'razorpay',
      'payment.status': 'void',
      createdAt: { $gt: new Date(now - RECHECK_CANCELLED_FOR_MS) },
      $or: [{ 'payment.checkedAt': null }, { 'payment.checkedAt': { $lt: new Date(now - RECHECK_EVERY_MS) } }],
    }).limit(50);
    let refunded = 0;
    for (const order of list) {
      try {
        await Order.updateOne({ _id: order._id }, { $set: { 'payment.checkedAt': new Date(now) } });
        const fresh = await reconcile(order);
        if (fresh.payment.status !== 'void') refunded += 1;
      } catch (err) {
        log('Could not re-check order', order.id, err.message);
      }
    }
    return refunded;
  }

  // Finishes refunds that were interrupted (for example by a restart in the
  // middle of one). Refunds that Razorpay refused are left for the admin.
  async function resumeRefunds(now = Date.now()) {
    const list = await Order.find({
      status: 'Cancelled',
      'payment.method': 'razorpay',
      $or: [
        { 'payment.status': 'paid' },
        { 'payment.status': 'refunding', 'payment.refundStartedAt': { $lt: new Date(now - REFUND_RETRY_AFTER_MS) } },
      ],
    }).limit(50);
    for (const order of list) await refundOrder(order._id);
    return list.length;
  }

  async function sweep() {
    for (const job of [expirePendingOrders, recheckCancelled, resumeRefunds]) {
      await job().catch((err) => log('Clean-up step failed:', err.message));
    }
  }

  return {
    placeOrder, paymentDetails, settlePayment, reconcile, cancelOrder, refundOrder,
    expirePendingOrders, recheckCancelled, resumeRefunds, sweep, captureOrFetch,
  };
}

export function createOrderRouter(orders, razorpay, { orderLimiter }) {
  const router = Router();
  router.use(requireAuth);

  // Always "the logged-in user's order with this id" - never anyone else's.
  const ownOrder = (req) => {
    const id = objectId.safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'Order not found.');
    return { _id: id.data, user: req.user._id };
  };

  router.post('/', orderLimiter, async (req, res) => {
    // Anything else the browser sends (prices, totals, user ids) is dropped here.
    const input = orderSchema.parse(req.body);
    const result = await orders.placeOrder(req.user, input);
    if (input.saveAddress) {
      await User.updateOne({ _id: req.user._id }, { $set: { address: input.shipping } });
    }
    res.status(201).json(result);
  });

  router.get('/', async (req, res) => {
    const list = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
    res.json({ orders: list, holdMinutes: config.pendingPaymentMinutes });
  });

  router.get('/:id', async (req, res) => {
    const order = await Order.findOne(ownOrder(req));
    if (!order) throw new HttpError(404, 'Order not found.');
    res.json({ order });
  });

  // "Pay now" for an order that is still waiting for payment.
  router.post('/:id/pay', async (req, res) => {
    let order = await Order.findOne(ownOrder(req));
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status === 'Pending payment') order = await orders.reconcile(order);
    if (order.status !== 'Pending payment') return res.json({ order, payment: null });
    if (!razorpay.enabled) throw new HttpError(400, 'Online payment is not available right now.');
    res.json({ order, payment: orders.paymentDetails(order) });
  });

  // Called by the browser right after the Razorpay window reports success.
  router.post('/:id/verify', async (req, res) => {
    const proof = verifySchema.parse(req.body);
    const order = await Order.findOne(ownOrder(req));
    if (!order || order.payment.method !== 'razorpay') throw new HttpError(404, 'Order not found.');

    // 1. The signature proves Razorpay issued this payment for this order.
    const genuine =
      proof.razorpay_order_id === order.payment.razorpayOrderId &&
      razorpay.verifyPaymentSignature({
        razorpayOrderId: order.payment.razorpayOrderId,
        paymentId: proof.razorpay_payment_id,
        signature: proof.razorpay_signature,
      });
    if (!genuine) throw new HttpError(400, 'We could not confirm this payment. If money was taken, it will be refunded.');

    // 2. Ask Razorpay what actually happened to the money.
    let payment = await razorpay.getPayment(proof.razorpay_payment_id);
    if (payment.order_id !== order.payment.razorpayOrderId || payment.amount !== paise(order.total) || payment.currency !== 'INR') {
      throw new HttpError(400, 'This payment does not match your order.');
    }
    if (payment.status === 'authorized') {
      if (order.status !== 'Pending payment') {
        throw new HttpError(409, 'This order was cancelled before your payment finished, so the money will not be taken. Your bank releases the hold within a few days.');
      }
      payment = await orders.captureOrFetch(payment.id, payment.amount);
    }
    if (payment.status !== 'captured') {
      throw new HttpError(400, 'Your payment has not gone through yet. Please try again.');
    }

    res.json({ order: await orders.settlePayment(order.payment.razorpayOrderId, payment.id, payment.amount) });
  });

  router.post('/:id/cancel', async (req, res) => {
    res.json({ order: await orders.cancelOrder(ownOrder(req), CUSTOMER_CAN_CANCEL) });
  });

  return router;
}

// Razorpay calls this address itself when a payment goes through, so an
// order is still marked paid even if the customer closes the tab too early.
export function createWebhookHandler(orders, razorpay) {
  return async (req, res) => {
    if (!razorpay.webhookEnabled) return res.status(404).json({ error: 'Not found.' });
    if (!razorpay.verifyWebhookSignature(req.rawBody, req.get('x-razorpay-signature'))) {
      return res.status(400).json({ error: 'Bad signature.' });
    }
    const event = typeof req.body?.event === 'string' ? req.body.event : '';
    const payment = req.body?.payload?.payment?.entity;
    if (
      (event === 'payment.captured' || event === 'order.paid') &&
      payment &&
      payment.status === 'captured' &&
      typeof payment.id === 'string' &&
      typeof payment.order_id === 'string' &&
      typeof payment.amount === 'number'
    ) {
      // An error here answers 5xx, so Razorpay delivers the event again later.
      await orders.settlePayment(payment.order_id, payment.id, payment.amount);
    }
    res.json({ ok: true }); // other events are acknowledged and ignored
  };
}
