// Input rules shared by several routes. Every field must be a plain string
// or number, which also blocks MongoDB operator injection such as
// { "email": { "$ne": null } }.
import { z } from 'zod';
import { STATES } from './models.js';

// Lower-cased, so the same id written two ways is always treated as one.
export const objectId = z
  .string('Invalid id')
  .regex(/^[a-f\d]{24}$/i, 'Invalid id')
  .transform((id) => id.toLowerCase());

export const text = (label, min, max) =>
  z.string(`${label} is required`).trim().min(min, `${label} is too short`).max(max, `${label} is too long`);

export const nameSchema = z
  .string('Name is required')
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(50, 'Name is too long');

export const emailSchema = z
  .string('Email is required')
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

export const passwordSchema = z
  .string('Password is required')
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const addressSchema = z.object(
  {
    fullName: text('Full name', 2, 80),
    phone: z.string('Phone is required').trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
    address: text('Address', 5, 200),
    city: text('City', 2, 60),
    state: z.enum(STATES, 'Choose your state'),
    pincode: z.string('PIN code is required').trim().regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code'),
  },
  'Delivery address is required'
);
