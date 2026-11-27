// The public catalogue: anyone can browse, nobody can change anything here.
import { Router } from 'express';
import { z } from 'zod';
import { CATEGORIES, Product, ProductImage } from './models.js';
import { objectId } from './validation.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SORTS = {
  featured: { featured: -1, category: 1, name: 1 },
  'price-asc': { price: 1, name: 1 },
  'price-desc': { price: -1, name: 1 },
  newest: { createdAt: -1, name: 1 },
  name: { name: 1 },
};

const listSchema = z.object({
  category: z.enum(CATEGORIES, 'Unknown category').optional(),
  q: z.string().trim().max(60, 'Search text is too long').optional(),
  sort: z.enum(Object.keys(SORTS), 'Unknown sort order').optional(),
  inStock: z.literal('1').optional(),
  featured: z.literal('1').optional(),
});

export const productRouter = Router();

productRouter.get('/', async (req, res) => {
  const { category, q, sort, inStock, featured } = listSchema.parse(req.query);

  const filter = {};
  if (category) filter.category = category;
  if (inStock) filter.stock = { $gt: 0 };
  if (featured) filter.featured = true;
  // The search text is escaped, so it is matched literally and can't be
  // used to run a slow or malicious regular expression.
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

  const [products, perCategory] = await Promise.all([
    Product.find(filter).sort(SORTS[sort || 'featured']),
    Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
  ]);
  res.json({
    products,
    categories: CATEGORIES,
    counts: Object.fromEntries(perCategory.map((c) => [c._id, c.count])),
  });
});

productRouter.get('/:id', async (req, res) => {
  const id = objectId.safeParse(req.params.id);
  const product = id.success ? await Product.findById(id.data) : null;
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product });
});

productRouter.get('/:id/image', async (req, res) => {
  const id = objectId.safeParse(req.params.id);
  const image = id.success ? await ProductImage.findById(id.data) : null;
  if (!image) return res.status(404).json({ error: 'No photo for this product.' });
  // The address changes whenever a new photo is uploaded (?v=...), so
  // browsers may keep each version for as long as they like.
  res.set({ 'Content-Type': image.type, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(image.data);
});
