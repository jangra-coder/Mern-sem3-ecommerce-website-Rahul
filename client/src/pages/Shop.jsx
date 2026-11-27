import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useConfig } from '../context.jsx';
import { ProductGrid } from '../components/ProductCard.jsx';
import { Empty, useTitle } from '../components/ui.jsx';

const SORTS = [
  ['featured', 'Staff picks first'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
  ['newest', 'Newest'],
  ['name', 'Name A–Z'],
];

export default function Shop() {
  const { categories } = useConfig();
  // Filters live in the address bar, so a filtered page can be bookmarked or shared.
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || '';
  const sort = params.get('sort') || 'featured';
  const inStock = params.get('inStock') === '1';
  const q = params.get('q') || '';
  const [search, setSearch] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useTitle(category || (q ? `“${q}”` : 'Shop'));

  const update = (changes) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true }
    );

  // Keep the box in step when the address changes (back button, header links).
  useEffect(() => {
    setSearch(q);
  }, [q]);

  // Search once typing pauses.
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => update({ q: search.trim() }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    if (q) query.set('q', q);
    if (sort !== 'featured') query.set('sort', sort);
    if (inStock) query.set('inStock', '1');
    setError('');
    api(`/products?${query}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [category, q, sort, inStock]);

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const filtered = Boolean(category || q || inStock);

  return (
    <div className="wrap">
      <header className="page-head">
        <p className="eyebrow">Shop</p>
        <h1>{category || 'Everything'}</h1>
      </header>

      <div className="shop">
        <aside className="filters" aria-label="Filters">
          <div>
            <p className="eyebrow">Category</p>
            <div className="filter-list">
              <button className={!category ? 'is-on' : ''} onClick={() => update({ category: '' })}>
                All <span>{data ? total : ''}</span>
              </button>
              {categories.map((c) => (
                <button key={c} className={category === c ? 'is-on' : ''} onClick={() => update({ category: c })}>
                  {c} <span>{data?.counts[c] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={inStock} onChange={(e) => update({ inStock: e.target.checked ? '1' : '' })} />
            In stock only
          </label>
        </aside>

        <div>
          <div className="toolbar">
            <div className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4.5 4.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                className="input"
                placeholder="Search: PETG, nozzle, resin…"
                aria-label="Search products"
                maxLength={60}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="input" aria-label="Sort" value={sort} onChange={(e) => update({ sort: e.target.value === 'featured' ? '' : e.target.value })}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          {error && <p className="alert alert--bad" role="alert">{error}</p>}
          {data && !error && (
            <p className="result-count" aria-live="polite">
              {data.products.length} {data.products.length === 1 ? 'product' : 'products'}
              {q && <> matching “{q}”</>}
            </p>
          )}
          {data && !error && data.products.length === 0 ? (
            <Empty
              shape="nozzle"
              color="#c9a04a"
              title="Nothing on the plate."
              action={filtered && <button className="btn btn--ghost" onClick={() => { setSearch(''); update({ category: '', q: '', inStock: '' }); }}>Clear filters</button>}
            >
              No products match that. Try a shorter search or another category.
            </Empty>
          ) : (
            !error && <ProductGrid products={data?.products || []} loading={!data} />
          )}
        </div>
      </div>
    </div>
  );
}
