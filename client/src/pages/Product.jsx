import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, imageUrl, rupees } from '../api.js';
import { useCart, useConfig, useToast } from '../context.jsx';
import { PrintModel, layerCount } from '../components/PrintModel.jsx';
import { ProductGrid } from '../components/ProductCard.jsx';
import { Empty, Loading, QtyStepper, StockTag, productCode, useTitle } from '../components/ui.jsx';

const LAYER_MM = 0.2;

export default function ProductPage() {
  const { id } = useParams();
  const cart = useCart();
  const toast = useToast();
  const { maxQty, shipping } = useConfig();
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [error, setError] = useState('');
  const [qty, setQty] = useState(1);
  const [view, setView] = useState('model');
  const [layer, setLayer] = useState(null); // null until someone drags the slider
  const [added, setAdded] = useState(false);
  useTitle(product?.name);

  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setError('');
    setQty(1);
    setLayer(null);
    setAdded(false);
    api(`/products/${encodeURIComponent(id)}`)
      .then(({ product: p }) => {
        if (cancelled) return;
        setProduct(p);
        setView(p.imageVersion ? 'photo' : 'model');
        api(`/products?category=${encodeURIComponent(p.category)}`)
          .then((d) => !cancelled && setRelated(d.products.filter((r) => r._id !== p._id).slice(0, 4)))
          .catch(() => {});
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const total = useMemo(() => (product ? layerCount(product.shape) : 0), [product]);

  if (error) {
    return (
      <div className="wrap">
        <Empty shape="gear" color="#b5ac98" title="We couldn't find that one." action={<Link to="/shop" className="btn">Back to the shop</Link>}>
          {error}
        </Empty>
      </div>
    );
  }
  if (!product) return <Loading text="Loading product" />;

  const shown = layer ?? total;
  const inCart = cart.qtyOf(product._id);
  const canAdd = Math.max(0, Math.min(maxQty, product.stock) - inCart);
  const pickQty = Math.min(qty, Math.max(1, canAdd));

  function handleAdd() {
    cart.add(product, pickQty);
    toast(`Added ${pickQty} × ${product.name} to your cart.`);
    setQty(1);
    setAdded(true);
  }

  return (
    <div className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/shop">Shop</Link>/
        <Link to={`/shop?category=${encodeURIComponent(product.category)}`}>{product.category}</Link>/
        <span>{productCode(product)}</span>
      </nav>

      <div className="pdp">
        <div className="stage">
          <div className="stage-view">
            {product.imageVersion > 0 && (
              <div className="stage-tabs" role="group" aria-label="View">
                <button className={view === 'photo' ? 'is-on' : ''} onClick={() => setView('photo')}>Photo</button>
                <button className={view === 'model' ? 'is-on' : ''} onClick={() => setView('model')}>Layers</button>
              </div>
            )}
            {view === 'photo' ? (
              <img src={imageUrl(product)} alt={product.name} />
            ) : (
              <PrintModel shape={product.shape} color={product.color} shown={shown} print={layer === null} nozzle={layer !== null} label={`Layer preview of ${product.name}`} />
            )}
          </div>
          {view === 'model' && (
            <label className="stage-bar">
              <span>LAYER</span>
              <input
                type="range"
                className="slider"
                min={0}
                max={total}
                value={shown}
                style={{ '--p': `${(shown / total) * 100}%` }}
                onChange={(e) => setLayer(Number(e.target.value))}
                aria-label="Scrub through the print layer by layer"
              />
              <b>{String(shown).padStart(2, '0')}/{total} · Z {(shown * LAYER_MM).toFixed(1)}</b>
            </label>
          )}
        </div>

        <div className="pdp-info">
          <p className="eyebrow">{product.category} · {productCode(product)}</p>
          <h1>{product.name}</h1>
          <div className="pdp-price">
            <span className="price">{rupees(product.price)}</span>
            <StockTag stock={product.stock} />
          </div>
          <p className="pdp-desc">{product.description}</p>

          <div className="buy">
            {product.stock === 0 ? (
              <button className="btn btn--block" disabled>Sold out</button>
            ) : canAdd === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                You have the most you can order ({inCart}) in your cart. <Link to="/cart" className="link">Go to cart →</Link>
              </p>
            ) : (
              <>
                <QtyStepper value={pickQty} max={canAdd} onChange={setQty} />
                <button className="btn btn--hot" onClick={handleAdd}>Add to cart · {rupees(product.price * pickQty)}</button>
              </>
            )}
            {added && canAdd > 0 && <Link to="/cart" className="btn btn--ghost">View cart →</Link>}
          </div>

          {product.specs?.length > 0 && (
            <dl className="specs">
              {product.specs.map((s) => (
                <div key={s.label} style={{ display: 'contents' }}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <ul className="assure">
            <li>{product.price >= shipping.freeAbove ? 'Free delivery on this item.' : `Free delivery once your cart passes ${rupees(shipping.freeAbove)}, otherwise ${rupees(shipping.fee)}.`}</li>
            <li>Cancel from your orders page any time before it ships.</li>
            <li>At most {maxQty} of one product per order.</li>
          </ul>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div><p className="eyebrow">Same shelf</p><h2>More {product.category.toLowerCase()}</h2></div>
          </div>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
