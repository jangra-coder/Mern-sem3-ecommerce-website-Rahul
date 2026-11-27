import { Link } from 'react-router-dom';
import { rupees } from '../api.js';
import { ProductVisual, StockTag, productCode } from './ui.jsx';

export function ProductCard({ product }) {
  return (
    <Link to={`/product/${product._id}`} className={`pcard${product.stock === 0 ? ' pcard--sold' : ''}`}>
      <div className="pcard-plate">
        <span className="pcard-code">{productCode(product)}</span>
        {product.featured && <span className="pcard-flag">Staff pick</span>}
        <ProductVisual product={product} label="" />
      </div>
      <div className="pcard-body">
        <span className="pcard-cat">{product.category}</span>
        <h3>{product.name}</h3>
        <div className="pcard-foot">
          <span className="price">{rupees(product.price)}</span>
          <StockTag stock={product.stock} />
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ products, loading = false }) {
  if (loading) {
    return (
      <div className="grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="pcard pcard--ghost" />)}
      </div>
    );
  }
  return (
    <div className="grid">
      {products.map((p) => <ProductCard key={p._id} product={p} />)}
    </div>
  );
}
