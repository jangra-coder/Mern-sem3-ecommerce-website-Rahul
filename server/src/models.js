import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const CATEGORIES = ['Printers', 'Filament', 'Resin', 'Parts', 'Printed Models'];
// Which built-in illustration a product uses when it has no photo.
export const SHAPES = ['printer', 'mini', 'resin', 'spool', 'bottle', 'nozzle', 'plate', 'motor', 'vase', 'planter', 'gear'];
export const ORDER_STATUSES = ['Pending payment', 'Placed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
// cod = pay the courier, pending = waiting for online payment, void = nothing was ever paid.
export const PAYMENT_STATUSES = ['cod', 'pending', 'paid', 'refunding', 'refunded', 'refund_failed', 'void'];
export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const addressSchema = new Schema(
  { fullName: String, phone: String, address: String, city: String, state: String, pincode: String },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Only the bcrypt hash is stored, never the password itself.
    passwordHash: { type: String, required: true },
    // Can only be switched on with "npm run make-admin", never through the website.
    isAdmin: { type: Boolean, default: false },
    // Raised when the password changes, which logs out every older session.
    tokenVersion: { type: Number, default: 0 },
    // Set while one of this user's orders is being placed (one at a time).
    placingOrderUntil: { type: Date, default: null },
    address: { type: addressSchema, default: null }, // saved delivery address
  },
  { timestamps: true }
);

const productSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true, enum: CATEGORIES },
    price: { type: Number, required: true, min: 0 }, // whole rupees
    stock: { type: Number, required: true, min: 0 },
    color: { type: String, default: '#ff5a2b' },
    shape: { type: String, enum: SHAPES, default: 'vase' },
    specs: [{ _id: false, label: String, value: String }],
    featured: { type: Boolean, default: false },
    imageVersion: { type: Number, default: 0 }, // 0 = no photo uploaded
  },
  { timestamps: true }
);

// Photos are kept in their own collection so product lists stay small and fast.
const productImageSchema = new Schema({
  _id: { type: Schema.Types.ObjectId, ref: 'Product' },
  type: { type: String, required: true },
  data: { type: Buffer, required: true },
});

const orderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [
      {
        _id: false,
        product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        name: String, // name and price are copied at order time
        price: Number,
        qty: Number,
      },
    ],
    shipping: addressSchema,
    subtotal: { type: Number, required: true },
    shippingFee: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true },
    status: { type: String, default: 'Placed', enum: ORDER_STATUSES },
    payment: {
      method: { type: String, enum: ['cod', 'razorpay'], default: 'cod' },
      status: { type: String, enum: PAYMENT_STATUSES, default: 'cod' },
      razorpayOrderId: { type: String, index: { unique: true, sparse: true } },
      razorpayPaymentId: String,
      refundId: String,
      refundStartedAt: Date,
      paidAt: Date,
      checkedAt: Date, // last time a cancelled order was re-checked with Razorpay
      extraPayments: { type: [String], default: undefined }, // duplicate payments that were refunded
    },
  },
  { timestamps: true }
);
orderSchema.index({ status: 1, createdAt: 1 });

export const User = model('User', userSchema);
export const Product = model('Product', productSchema);
export const ProductImage = model('ProductImage', productImageSchema);
export const Order = model('Order', orderSchema);
