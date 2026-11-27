// Sign up, log in, log out, profile, password change, and the
// "must be logged in" / "must be an admin" checks.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { User } from './models.js';
import { addressSchema, emailSchema, nameSchema, passwordSchema } from './validation.js';

// The "__Host-" prefix makes browsers refuse the cookie unless it is
// HTTPS-only and tied to exactly this site.
const COOKIE = config.isProd ? '__Host-token' : 'token';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Repeated wrong passwords are slowed down per email address in app.js
// (the same for real and made-up emails, so it can't reveal who has an account).

const cookieOptions = {
  httpOnly: true, // page JavaScript cannot read the cookie (limits XSS damage)
  sameSite: 'strict', // never sent on requests coming from other sites (CSRF)
  secure: config.isProd, // HTTPS only once deployed
  path: '/',
};

const registerSchema = z.object({ name: nameSchema, email: emailSchema, password: passwordSchema });
const loginSchema = z.object({
  email: z.string('Email is required').trim().toLowerCase().max(254),
  password: z.string('Password is required').min(1, 'Password is required').max(72),
});
const profileSchema = z.object({ name: nameSchema.optional(), address: addressSchema.nullable().optional() });
const passwordChangeSchema = z.object({
  currentPassword: z.string('Current password is required').min(1, 'Current password is required').max(72),
  newPassword: passwordSchema,
});

// Compared against when the email is unknown, so "no such user" takes about
// as long as "wrong password" and can't be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  isAdmin: u.isAdmin === true,
  address: u.address || null,
});

function setLoginCookie(res, user) {
  const token = jwt.sign({ sub: user.id, v: user.tokenVersion || 0 }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '7d',
  });
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: WEEK_MS });
}

async function userFromRequest(req) {
  const token = req.cookies?.[COOKIE];
  if (typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const user = await User.findById(payload.sub);
    // A token issued before the last password change is no longer valid.
    if (!user || (user.tokenVersion || 0) !== (payload.v || 0)) return null;
    return user;
  } catch {
    return null; // expired, tampered or malformed token
  }
}

export async function requireAuth(req, res, next) {
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  req.user = user;
  next();
}

// The admin flag is read from the database on every request, so it can't
// be faked from the browser.
export async function requireAdmin(req, res, next) {
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  if (user.isAdmin !== true) return res.status(403).json({ error: 'Admins only.' });
  req.user = user;
  next();
}

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { name, email, password } = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  let user;
  try {
    user = await User.create({ name, email, passwordHash });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    throw err;
  }
  setLoginCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await User.findOne({ email });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    // Same message for both cases so nobody can probe which emails exist.
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  setLoginCookie(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, cookieOptions);
  res.json({ ok: true });
});

// Ends every session of this account, on every device (for a lost phone, or
// a computer you logged in on somewhere else).
authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  res.clearCookie(COOKIE, cookieOptions);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const user = await userFromRequest(req);
  res.json({ user: user ? publicUser(user) : null });
});

authRouter.patch('/profile', requireAuth, async (req, res) => {
  const changes = profileSchema.parse(req.body);
  if (changes.name !== undefined) req.user.name = changes.name;
  if (changes.address !== undefined) req.user.address = changes.address;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);
  if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
    return res.status(400).json({ error: 'Your current password is not correct.' });
  }
  req.user.passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  req.user.tokenVersion = (req.user.tokenVersion || 0) + 1; // signs out every other device
  await req.user.save();
  setLoginCookie(res, req.user); // keep this browser logged in
  res.json({ ok: true });
});
