// Opens the Razorpay payment window and confirms the result with our server.
// Razorpay's script is only loaded at the moment someone actually pays.
import { api, shortId } from './api.js';

let loading;

function loadCheckout() {
  loading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => {
      loading = null; // allow another try
      script.remove();
      reject(new Error('Could not open the payment window. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves with the paid order. Rejects with `dismissed: true` if the window
// was closed, or `pending: true` if the payment could not be confirmed yet.
export async function payForOrder({ order, payment, user }) {
  const Razorpay = await loadCheckout();

  const proof = await new Promise((resolve, reject) => {
    const checkout = new Razorpay({
      key: payment.keyId,
      order_id: payment.razorpayOrderId,
      amount: payment.amount,
      currency: payment.currency,
      name: 'LayerForge',
      description: `Order #${shortId(order._id)}`,
      prefill: { name: order.shipping.fullName, email: user.email, contact: order.shipping.phone },
      theme: { color: '#15130f' },
      handler: resolve,
      modal: {
        ondismiss: () => reject(Object.assign(new Error('Payment was not completed.'), { dismissed: true })),
      },
    });
    checkout.open();
  });

  try {
    const { order: paid } = await api(`/orders/${order._id}/verify`, {
      method: 'POST',
      body: {
        razorpay_order_id: proof.razorpay_order_id,
        razorpay_payment_id: proof.razorpay_payment_id,
        razorpay_signature: proof.razorpay_signature,
      },
    });
    return paid;
  } catch (err) {
    if ([400, 404, 409].includes(err.status)) throw err;
    // The money moved but our confirmation call failed (a dropped connection,
    // say). Ask the server to check with Razorpay directly before giving up.
    await wait(2500);
    const { order: checked } = await api(`/orders/${order._id}/pay`, { method: 'POST', body: {} }).catch(() => ({ order: null }));
    if (checked?.payment.status === 'paid') return checked;
    throw Object.assign(new Error('Your payment is still being confirmed. It will show under your orders in a few minutes.'), { pending: true });
  }
}
