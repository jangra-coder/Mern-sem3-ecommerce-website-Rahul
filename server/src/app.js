// Builds the Express app. Kept separate from server.js so tests can use it.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { CATEGORIES, SHAPES, STATES } from './models.js';
import { authRouter } from './auth.js';
import { productRouter } from './products.js';
import { createRazorpay } from './payments.js';
import { createOrderRouter, createOrderService, createWebhookHandler } from './orders.js';
import { createAdminRouter } from './admin.js';

const WEBHOOK_PATH = '/api/payments/webhook';
const IMAGE_UPLOAD = /^\/api\/admin\/products\/[a-f\d]{24}\/image$/i;

// CSRF protection (on top of the SameSite=Strict cookie): a request that
// changes data must come from a page on this same site and must be JSON,
// which a plain HTML form on another website cannot send.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* not a URL: treated as foreign */
    }
    if (originHost !== req.get('host')) {
      return res.status(403).json({ error: 'Request blocked: it did not come from this site.' });
    }
  }
  // DELETE carries no body, and browsers never let another site send one
  // without asking this server first (which it refuses).
  if (req.method !== 'DELETE' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  }
  next();
}

export function createApp({ authLimit = 20, loginPerEmail = 10, apiLimit = 600, orderLimit = 30, razorpay = createRazorpay(config.razorpay) } = {}) {
  const app = express();
  const orders = createOrderService(razorpay);
  app.locals.orders = orders; // server.js uses this for the clean-up timer
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1); // we sit behind the host's HTTPS proxy

  app.use(compression());

  // Security headers. The Razorpay entries let its checkout window load and
  // nothing else: no other outside script can run on the site.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'", 'https://checkout.razorpay.com'],
          'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          'connect-src': ["'self'", 'https://*.razorpay.com'],
          'img-src': ["'self'", 'data:', 'blob:', 'https://*.razorpay.com'],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      // Some banks open their own window during payment and report back to ours.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      strictTransportSecurity: config.isProd ? { maxAge: 15552000, includeSubDomains: false } : false,
    })
  );

  // Render checks this address to know the site is alive.
  app.get('/healthz', (req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ ok });
  });

  // Small request bodies only. The raw bytes of a webhook are kept, because
  // its signature is calculated over exactly those bytes. Photo uploads get
  // their own, larger limit inside the admin router, after the admin check.
  const smallJson = express.json({
    limit: '20kb',
    verify: (req, res, buf) => {
      if (req.originalUrl === WEBHOOK_PATH) req.rawBody = buf;
    },
  });
  app.use((req, res, next) => (IMAGE_UPLOAD.test(req.path) ? next() : smallJson(req, res, next)));
  app.use(cookieParser());
  app.use('/api', csrfGuard);

  // Rate limits, counted per visitor. On Render the real visitor address is
  // the one reported by its Cloudflare front door (Cloudflare overwrites any
  // value a visitor tries to send in this header).
  const visitor = (req) => ipKeyGenerator((config.onRender && req.get('cf-connecting-ip')) || req.ip);
  const limiter = (windowMs, limit, message) =>
    rateLimit({ windowMs, limit, keyGenerator: visitor, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message } });

  app.post(WEBHOOK_PATH, createWebhookHandler(orders, razorpay));

  app.use('/api', limiter(15 * 60 * 1000, apiLimit, 'Too many requests. Please slow down for a few minutes.'));
  // Slow down password guessing.
  const authLimiter = limiter(15 * 60 * 1000, authLimit, 'Too many attempts. Please wait a few minutes and try again.');
  app.use(['/api/auth/login', '/api/auth/register', '/api/auth/password'], authLimiter);
  // ...and per email address, whichever computers the guesses come from.
  // Only failed attempts count, and an email that has no account is treated
  // exactly the same, so this can't reveal who is registered.
  app.post(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: loginPerEmail,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `email:${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '-'}`,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
    })
  );
  const orderLimiter = limiter(60 * 60 * 1000, orderLimit, 'Too many orders in a short time. Please try again later.');

  // What the storefront needs to know. The Razorpay key id is public by
  // design; the key secret is never sent anywhere.
  app.get('/api/config', (req, res) => {
    res.json({
      razorpay: { enabled: razorpay.enabled, keyId: razorpay.enabled ? razorpay.keyId : null },
      shipping: config.shipping,
      maxQty: config.maxQtyPerProduct,
      holdMinutes: config.pendingPaymentMinutes,
      categories: CATEGORIES,
      shapes: SHAPES,
      states: STATES,
    });
  });

  app.use('/api/auth/logout-all', authLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/products', productRouter);
  app.use('/api/orders', createOrderRouter(orders, razorpay, { orderLimiter }));
  app.use('/api/admin', createAdminRouter(orders, razorpay));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Serve the built React site (after "npm run build" in client/).
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        setHeaders(res, file) {
          // Built files have a fingerprint in their name, so they never change.
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      })
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || path.extname(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml); // let React Router handle the page URL
    });
  }
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // One place for all errors. Details go to the server log, never to the browser.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input.' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (err.razorpay) {
      if (!config.isTest) console.error('Razorpay:', err.message);
      return res.status(502).json({ error: 'The payment service is not responding. Please try again in a moment.' });
    }
    if (!config.isTest) console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
