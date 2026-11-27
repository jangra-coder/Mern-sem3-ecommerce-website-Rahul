// All settings come from environment variables.
//  - On your own computer they live in server/.env (created automatically on first run).
//  - On Render they are set in the service's "Environment" page; no file is used.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

if (!isProd) {
  const envPath = path.join(serverRoot, '.env');
  if (!fs.existsSync(envPath)) {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(
      envPath,
      [
        'PORT=4000',
        'MONGO_URI=mongodb://127.0.0.1:27017/layerforge',
        `JWT_SECRET=${secret}`,
        '',
        '# Razorpay keys (https://dashboard.razorpay.com/app/keys). Use TEST keys while developing.',
        '# Leave empty to offer cash on delivery only.',
        'RAZORPAY_KEY_ID=',
        'RAZORPAY_KEY_SECRET=',
        'RAZORPAY_WEBHOOK_SECRET=',
        '',
      ].join('\n'),
      { mode: 0o600 } // readable only by you
    );
  }
  process.loadEnvFile(envPath); // does not override variables that are already set
}

const env = (name) => (process.env[name] || '').trim();

// Tidies a pasted connection string: invisible characters some terminals add
// when pasting, surrounding quotes, or a "MONGO_URI=" copied along with it.
export function cleanUri(value) {
  return value
    .replace(/\x1b\[20[01]~/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .replace(/^MONGO_URI\s*=\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

export const config = {
  isProd,
  isTest,
  port: Number(env('PORT')) || 4000,
  // Locally: this computer only. In production the host's proxy must be able to reach us.
  host: isProd ? '0.0.0.0' : '127.0.0.1',
  onRender: Boolean(env('RENDER')),
  mongoUri: cleanUri(env('MONGO_URI')) || (isProd ? '' : 'mongodb://127.0.0.1:27017/layerforge'),
  jwtSecret: env('JWT_SECRET'),
  bcryptRounds: isTest ? 4 : 12,
  razorpay: {
    keyId: env('RAZORPAY_KEY_ID'),
    keySecret: env('RAZORPAY_KEY_SECRET'),
    webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
  },
  shipping: { fee: 79, freeAbove: 999 }, // rupees
  maxQtyPerProduct: 10,
  maxUnpaidOrders: 3, // online orders waiting for payment, per account
  maxOpenOrders: 5, // orders not yet packed (paid or cash), per account
  pendingPaymentMinutes: 30, // unpaid online orders are cancelled after this long
  clientDist: path.resolve(serverRoot, '..', 'client', 'dist'),
};

if (!config.mongoUri) {
  throw new Error('MONGO_URI is not set. Add your MongoDB Atlas connection string to the environment.');
}
if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET is missing or too short (need 32+ characters).');
}
if (isProd && config.razorpay.keyId.startsWith('rzp_test_')) {
  console.warn('Note: Razorpay is using TEST keys. No real money will move until you switch to live keys.');
}
