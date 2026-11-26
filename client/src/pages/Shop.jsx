import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, rupees } from '../api.js';
import { MAX_QTY, useCart } from '../context.jsx';

// Width of each printed "layer" from top to bottom, per category.
const SHAPES = {
  Printers: [10, 10, 4, 4, 4, 4, 9, 9, 4, 4, 10, 10],
  Filament: [4, 7, 9, 10, 10, 10, 10, 10, 10, 9, 7, 4],
  Resin: [3, 3, 4, 7, 8, 8, 8, 8, 8, 8, 8, 8],
  Parts: [8, 8, 8, 8, 6, 6, 6, 5, 4, 3, 2, 1],
  'Printed Models': [2, 4, 6, 5, 7, 9, 8, 6, 7, 9, 10, 10],
};

// Draws a product picture out of stacked layers, like a 3D print.
export function ProductArt({ category, color }) {
  const layers = SHAPES[category] || SHAPES.Parts;
  return (
    <svg className="art" viewBox="0 0 120 100" role="img" aria-label={`${category} illustration`}>
      {layers.map((w, i) => (
        <rect key={i} x={60 - w * 4} y={14 + i * 6} width={w * 8} height={4.6} rx={2.3} fill={color} opacity={0.55 + (i / layers.length) * 0.45} />
      ))}
      <rect x="14" y="88" width="92" height="3" rx="1.5" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

function StockLabel({ stock }) {
  if (stock === 0) return <span className="stock out">Out of stock</span>;
  if (stock <= 5) return <span className="stock low">Only {stock} left</span>;
  return <span className="stock">In stock</span>;
}

export function Shop() {
  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Wait a moment after typing stops before asking the server.
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search.trim()) params.set('q', search.trim());
      api(`/products?${params}`)
        .then((data) => {
          if (cancelled) return;
          setProducts(data.products);
          setCategories(data.categories);
          setError('');
        })
        .catch((err) => !cancelled && setError(err.message));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [category, search]);

  return (
    <>
      <section className="hero">
        <h1>Everything for your next print.</h1>
        <p>Printers, filament, resin, spare parts and ready-made models.</p>
      </section>

      <div className="filters">
        <div className="chips">
          {['', ...categories].map((c) => (
            <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
              {c || 'All'}
            </button>
          ))}
        </div>
        <input type="search" className="search" placeholder="Search products…" aria-label="Search products"
          value={search} maxLength={60} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {!error && products === null && <p className="muted">Loading products…</p>}
      {products?.length === 0 && <p className="empty">No products match your search.</p>}

      <div className="grid">
        {products?.map((p) => (
          <Link key={p._id} to={`/product/${p._id}`} className="card product">
            <ProductArt category={p.category} color={p.color} />
            <span className="category">{p.category}</span>
            <h3>{p.name}</h3>
            <div className="product-foot">
              <strong>{rupees(p.price)}</strong>
              <StockLabel stock={p.stock} />
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export function ProductPage() {
  const { id } = useParams();
  const cart = useCart();
  const [product, setProduct] = useState(null);
  const [error, setError] = useState('');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setProduct(null);
    setError('');
    api(`/products/${encodeURIComponent(id)}`)
      .then((data) => setProduct(data.product))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <div className="empty"><h2>{error}</h2><Link to="/">Back to the shop</Link></div>;
  if (!product) return <p className="muted">Loading…</p>;

  const inCart = cart.items.find((i) => i.id === product._id)?.qty || 0;
  const canAdd = Math.min(MAX_QTY, product.stock) - inCart;

  function handleAdd() {
    cart.add(product, Math.min(qty, canAdd));
    setQty(1);
    setAdded(true);
  }

  return (
    <div className="detail">
      <div className="card detail-art"><ProductArt category={product.category} color={product.color} /></div>
      <div>
        <Link to="/" className="muted">&larr; Back to shop</Link>
        <span className="category">{product.category}</span>
        <h1>{product.name}</h1>
        <p className="price">{rupees(product.price)}</p>
        <StockLabel stock={product.stock} />
        <p>{product.description}</p>

        {product.stock === 0 ? (
          <button className="button" disabled>Out of stock</button>
        ) : canAdd <= 0 ? (
          <p className="muted">You have the maximum available ({inCart}) in your cart.</p>
        ) : (
          <div className="buy-row">
            <label className="qty">Qty
              <select value={Math.min(qty, canAdd)} onChange={(e) => setQty(Number(e.target.value))}>
                {Array.from({ length: canAdd }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            <button className="button" onClick={handleAdd}>Add to cart</button>
          </div>
        )}
        {added && <p className="success" role="status">Added to cart. <Link to="/cart">View cart</Link></p>}
      </div>
    </div>
  );
}
