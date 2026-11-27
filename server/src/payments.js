// A small client for the Razorpay API (https://razorpay.com/docs/api).
// The key secret never leaves the server; the browser only ever sees the key id.
import crypto from 'node:crypto';

const API = 'https://api.razorpay.com/v1';

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// Compares two signatures without leaking, through timing, how much matched.
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createRazorpay({ keyId, keySecret, webhookSecret, fetchImpl = fetch }) {
  const enabled = Boolean(keyId && keySecret);
  const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (cause) {
      const err = new Error('Could not reach Razorpay.', { cause });
      err.razorpay = true;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.description || `Razorpay replied with status ${res.status}.`);
      err.razorpay = true;
      err.statusCode = res.status;
      throw err;
    }
    return data;
  }

  return {
    enabled,
    keyId,
    webhookEnabled: Boolean(enabled && webhookSecret),

    // Amounts are always in paise (1 rupee = 100 paise).
    createOrder: ({ amountPaise, receipt, notes }) =>
      call('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes }),

    paymentsForOrder: (razorpayOrderId) => call('GET', `/orders/${encodeURIComponent(razorpayOrderId)}/payments`),

    getPayment: (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}`),

    // Takes the money for a payment that was only authorised.
    capture: (paymentId, amountPaise) =>
      call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' }),

    refund: (paymentId, amountPaise) =>
      call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise }),

    // Proof, sent back by the checkout window, that Razorpay accepted this
    // payment for this order. Only someone holding the key secret can make it.
    verifyPaymentSignature({ razorpayOrderId, paymentId, signature }) {
      if (!enabled) return false;
      return safeEqual(hmacHex(keySecret, `${razorpayOrderId}|${paymentId}`), signature);
    },

    // Webhooks are signed over the exact bytes Razorpay sent.
    verifyWebhookSignature(rawBody, signature) {
      if (!enabled || !webhookSecret || !rawBody || !signature) return false;
      return safeEqual(hmacHex(webhookSecret, rawBody), signature);
    },
  };
}
