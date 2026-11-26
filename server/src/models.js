import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const CATEGORIES = ['Printers', 'Filament', 'Resin', 'Parts', 'Printed Models'];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Only the bcrypt hash is stored, never the password itself.
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

const productSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true, enum: CATEGORIES },
  price: { type: Number, required: true, min: 0 }, // whole rupees
  stock: { type: Number, required: true, min: 0 },
  color: { type: String, default: '#f97316' }, // used to draw the product picture
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
    shipping: {
      fullName: String,
      phone: String,
      address: String,
      city: String,
      pincode: String,
    },
    total: { type: Number, required: true },
    paymentMethod: { type: String, default: 'Cash on Delivery' },
    status: { type: String, default: 'Placed' },
  },
  { timestamps: true }
);

export const User = model('User', userSchema);
export const Product = model('Product', productSchema);
export const Order = model('Order', orderSchema);
