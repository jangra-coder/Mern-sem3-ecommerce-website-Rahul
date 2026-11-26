// Sign up, log in, log out, and the "must be logged in" check.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { User } from './models.js';

const COOKIE = 'token';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: true, // page JavaScript cannot read the cookie (limits XSS damage)
  sameSite: 'strict', // never sent on requests coming from other sites (CSRF)
  secure: false, // the site runs on plain http://localhost
  path: '/',
};

// Every field must be a plain string, which also blocks MongoDB operator
// injection such as { "email": { "$ne": null } }.
const registerSchema = z.object({
  name: z.string('Name is required').trim().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long'),
  email: z.string('Email is required').trim().toLowerCase().max(254, 'Email is too long').email('Enter a valid email address'),
  password: z
    .string('Password is required')
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a number'),
});

const loginSchema = z.object({
  email: z.string('Email is required').trim().toLowerCase().max(254),
  password: z.string('Password is required').min(1, 'Password is required').max(72),
});

// Compared against when the email is unknown, so "no such user" takes about
// as long as "wrong password" and can't be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

function setLoginCookie(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '7d' });
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: WEEK_MS });
}

async function userFromRequest(req) {
  const token = req.cookies?.[COOKIE];
  if (typeof token !== 'string') return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return await User.findById(payload.sub);
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

authRouter.get('/me', async (req, res) => {
  const user = await userFromRequest(req);
  res.json({ user: user ? publicUser(user) : null });
});
