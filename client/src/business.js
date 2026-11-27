// Your business details, shown on the Terms, Privacy, Refund, Shipping and
// Contact pages. Razorpay reads these pages when it approves your website for
// live payments, so replace every value in [square brackets] with the real one,
// then rebuild and deploy. Anything still in brackets is highlighted on the site.
export const BUSINESS = {
  brand: 'LayerForge',
  legalName: '[Your registered business name, or your full name if you sell as an individual]',
  email: '[support email address]',
  phone: '[support phone number]',
  address: '[Full postal address, City, State, PIN code]',
  jurisdiction: '[Your city]', // courts for legal disputes
  hours: 'Monday to Saturday, 10 am – 6 pm IST',

  // How you work. Change these to match what you can promise.
  dispatchDays: '1–2 business days',
  madeToOrderExtra: 'up to 2 extra business days', // printed models are made after you order
  deliveryDays: '3–7 business days',
  returnWindowDays: 7, // for damaged, faulty or wrong items
  updated: '27 November 2026',
};

export const isPlaceholder = (value) => typeof value === 'string' && /^\[.*\]$/.test(value);
