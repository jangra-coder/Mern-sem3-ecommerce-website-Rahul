// The admin area. Hidden from non-admins here for convenience only:
// the server refuses every admin request from a non-admin account anyway.
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, imageUrl, rupees, shortId, when } from '../api.js';
import { useAuth, useConfig, useToast } from '../context.jsx';
import { PrintModel, SHAPE_NAMES } from '../components/PrintModel.jsx';
import { Empty, Loading, PaymentPill, StatusPill, useTitle } from '../components/ui.jsx';

const NEXT_STEP = { Placed: 'Packed', Packed: 'Shipped', Shipped: 'Delivered' };
const CANCELLABLE = ['Pending payment', 'Placed', 'Packed', 'Shipped'];

function useAdminData(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(
    () => api(path).then((d) => { setData(d); setError(''); }).catch((err) => setError(err.message)),
    [path]
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

// ---------- Dashboard numbers ----------

function Stats({ stats }) {
  const tiles = [
    ['Order value (not cancelled)', rupees(stats.revenue)],
    ['Paid online', rupees(stats.paidOnline)],
    ['To fulfil', stats.openOrders],
    ['Awaiting payment', stats.unpaidOrders],
    ['Orders', stats.orders],
    ['Customers', stats.customers],
    ['Products', stats.products],
    ['Low stock (≤ 5)', stats.lowStock],
  ];
  return (
    <>
      {stats.refundIssues > 0 && (
        <p className="alert alert--bad" role="alert" style={{ marginBottom: 16 }}>
          {stats.refundIssues} cancelled order{stats.refundIssues === 1 ? ' has' : 's have'} a refund that has not finished. Filter orders by “Cancelled” and use “Retry refund”.
        </p>
      )}
      {stats.onlinePayments && !stats.webhook && (
        <p className="alert alert--warn" style={{ marginBottom: 16 }}>
          The Razorpay webhook is not set up. Payments still work, but set it up (DEPLOY.md, step 4) so a payment is confirmed even if the customer closes the tab.
        </p>
      )}
      <div className="stats">
        {tiles.map(([label, value]) => (
          <div key={label} className="stat"><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
    </>
  );
}

// ---------- Orders ----------

function OrdersTab({ onChange }) {
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const { data, error, reload } = useAdminData(`/admin/orders${filter ? `?status=${encodeURIComponent(filter)}` : ''}`);
  const [busyId, setBusyId] = useState('');

  async function act(order, work, message) {
    setBusyId(order._id);
    try {
      await work();
      toast(message);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusyId('');
      reload();
      onChange();
    }
  }

  const setStatus = (order, status) =>
    act(order, () => api(`/admin/orders/${order._id}`, { method: 'PATCH', body: { status } }), `Order #${shortId(order._id)} marked ${status.toLowerCase()}.`);

  function cancel(order) {
    const paid = order.payment.status === 'paid' && order.payment.method === 'razorpay';
    const ok = window.confirm(`Cancel order #${shortId(order._id)}? Items go back into stock${paid ? ` and ${rupees(order.total)} is refunded to the customer` : ''}. This cannot be undone.`);
    if (ok) setStatus(order, 'Cancelled');
  }

  const retryRefund = (order) =>
    act(order, () => api(`/admin/orders/${order._id}/refund`, { method: 'POST', body: {} }), 'Refund sent.');

  return (
    <>
      <div className="toolbar">
        <label className="field-row">
          <span className="eyebrow">Show</span>
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All orders</option>
            {data?.statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="alert alert--bad" role="alert">{error}</p>}
      {!error && !data && <Loading />}
      {data?.orders.length === 0 && <Empty shape="planter" color="#d8d0bf" title="No orders here." />}
      {data?.orders.map((o) => (
        <article key={o._id} className="aorder">
          <div className="aorder-head">
            <div className="field-row" style={{ flexWrap: 'wrap' }}>
              <strong className="mono">#{shortId(o._id)}</strong>
              <StatusPill status={o.status} />
              <PaymentPill status={o.payment.status} admin />
            </div>
            <span className="muted mono" style={{ fontSize: 13 }}>{when(o.createdAt)}</span>
          </div>
          <div className="aorder-grid">
            <div className="rows" style={{ gap: 6 }}>
              {o.items.map((i) => (
                <div key={i.product} className="row"><span>{i.qty} × {i.name}</span><span className="price">{rupees(i.price * i.qty)}</span></div>
              ))}
              <div className="row muted"><span>Delivery</span><span className="price">{o.shippingFee ? rupees(o.shippingFee) : 'Free'}</span></div>
              <div className="row" style={{ fontWeight: 600 }}><span>Total</span><span className="price">{rupees(o.total)}</span></div>
            </div>
            <dl className="kv">
              <dt>Customer</dt>
              <dd>{o.user ? <>{o.user.name}<br /><span className="muted">{o.user.email}</span></> : 'Deleted account'}</dd>
              <dt>Ship to</dt>
              <dd>{o.shipping.fullName}, {o.shipping.phone}<br />{o.shipping.address}, {o.shipping.city}, {o.shipping.state} {o.shipping.pincode}</dd>
              <dt>Payment</dt>
              <dd>
                {o.payment.method === 'razorpay' ? 'Razorpay' : 'Cash on delivery'}
                {o.payment.razorpayPaymentId && <><br /><span className="mono" style={{ fontSize: 13 }}>{o.payment.razorpayPaymentId}</span></>}
                {o.payment.refundId && <><br /><span className="mono" style={{ fontSize: 13 }}>refund {o.payment.refundId}</span></>}
              </dd>
            </dl>
          </div>
          <div className="aorder-foot">
            <div className="field-row" style={{ flexWrap: 'wrap' }}>
              {NEXT_STEP[o.status] && (
                <button className="btn btn--sm" disabled={busyId === o._id} onClick={() => setStatus(o, NEXT_STEP[o.status])}>
                  Mark {NEXT_STEP[o.status].toLowerCase()} →
                </button>
              )}
              {o.status === 'Cancelled' && o.payment.method === 'razorpay' && ['paid', 'refunding', 'refund_failed'].includes(o.payment.status) && (
                <button className="btn btn--sm btn--hot" disabled={busyId === o._id} onClick={() => retryRefund(o)}>Retry refund</button>
              )}
              {o.status === 'Pending payment' && <span className="muted" style={{ fontSize: 14 }}>Not paid yet. Released automatically if it stays unpaid.</span>}
            </div>
            {CANCELLABLE.includes(o.status) && (
              <button className="btn btn--sm btn--danger" disabled={busyId === o._id} onClick={() => cancel(o)}>Cancel order</button>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

// ---------- Products ----------

const blankProduct = { name: '', category: '', shape: 'vase', color: '#ff5a2b', price: '', stock: '', featured: false, description: '', specs: [] };

// Shrinks a photo in the browser so the upload stays small (the server
// checks the size and real file type again).
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  if (file.size > 20 * 1024 * 1024) throw new Error('That image is over 20 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e9e3d6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.86, 0.76, 0.62, 0.48]) {
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 560 * 1024) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the image.'));
        reader.readAsDataURL(blob);
      });
    }
  }
  throw new Error('Could not make that image small enough. Try a smaller photo.');
}

function ProductEditor({ product, onDone, onSaved }) {
  const { categories, shapes } = useConfig();
  const toast = useToast();
  const [saved, setSaved] = useState(product); // the version in the database (null = not yet created)
  const [form, setForm] = useState(() => (product ? { ...blankProduct, ...product, specs: product.specs || [] } : blankProduct));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setSpec = (index, key, value) => setForm({ ...form, specs: form.specs.map((s, i) => (i === index ? { ...s, [key]: value } : s)) });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy('save');
    const body = {
      name: form.name,
      category: form.category,
      shape: form.shape,
      color: form.color,
      price: Number(form.price),
      stock: Number(form.stock),
      featured: Boolean(form.featured),
      description: form.description,
      specs: form.specs.filter((s) => s.label.trim() || s.value.trim()),
      // Lets the server refuse the save if an order changed the stock meanwhile.
      ...(saved ? { stockWas: saved.stock } : {}),
    };
    try {
      const { product: result } = saved
        ? await api(`/admin/products/${saved._id}`, { method: 'PUT', body })
        : await api('/admin/products', { method: 'POST', body });
      onSaved();
      if (saved) {
        toast('Product saved.');
        onDone();
      } else {
        setSaved(result);
        setForm({ ...form, specs: result.specs });
        toast('Product added. You can add a photo now.');
      }
    } catch (err) {
      setError(err.message);
      if (err.status === 409 && saved) {
        // Keep what was typed, but start from the new stock number next time.
        api(`/products/${saved._id}`).then(({ product: fresh }) => setSaved(fresh)).catch(() => {});
      }
    } finally {
      setBusy('');
    }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy('photo');
    try {
      const image = await shrinkImage(file);
      const { product: result } = await api(`/admin/products/${saved._id}/image`, { method: 'PUT', body: { image } });
      setSaved(result);
      onSaved();
      toast('Photo uploaded.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function removePhoto() {
    setBusy('photo');
    try {
      const { product: result } = await api(`/admin/products/${saved._id}/image`, { method: 'DELETE' });
      setSaved(result);
      onSaved();
      toast('Photo removed. The drawing is shown instead.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="editor">
      <form className="panel form" onSubmit={handleSubmit}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{saved ? `Edit: ${saved.name}` : 'Add a product'}</h2>
          <button type="button" className="link link--quiet" onClick={onDone}>← Back to list</button>
        </div>
        {error && <p className="alert alert--bad" role="alert">{error}</p>}
        <label className="field"><span>Name</span><input value={form.name} onChange={set('name')} required minLength={2} maxLength={80} /></label>
        <div className="form-grid">
          <label className="field">
            <span>Category</span>
            <select value={form.category} onChange={set('category')} required>
              <option value="" disabled>Choose…</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Drawing</span>
            <select value={form.shape} onChange={set('shape')}>
              {(shapes.length ? shapes : Object.keys(SHAPE_NAMES)).map((s) => <option key={s} value={s}>{SHAPE_NAMES[s] || s}</option>)}
            </select>
          </label>
          <label className="field"><span>Price (₹, whole rupees)</span><input type="number" value={form.price} onChange={set('price')} required min={1} max={10000000} step={1} inputMode="numeric" /></label>
          <label className="field"><span>Stock</span><input type="number" value={form.stock} onChange={set('stock')} required min={0} max={100000} step={1} inputMode="numeric" /></label>
          <div className="field">
            <span>Colour</span>
            <div className="color-field">
              <input type="color" value={form.color} onChange={set('color')} aria-label="Pick colour" />
              <input value={form.color} onChange={set('color')} pattern="#[0-9a-fA-F]{6}" maxLength={7} aria-label="Colour code" />
            </div>
          </div>
          <label className="check" style={{ alignSelf: 'end', minHeight: 46 }}>
            <input type="checkbox" checked={form.featured} onChange={set('featured')} />
            Staff pick (shown on the home page)
          </label>
        </div>
        <label className="field"><span>Description</span><textarea value={form.description} onChange={set('description')} required minLength={5} maxLength={1000} rows={4} /></label>

        <div className="field">
          <span>Specs (shown as a table)</span>
          {form.specs.map((s, i) => (
            <div key={i} className="spec-row">
              <input className="input" placeholder="e.g. Nozzle temp" value={s.label} maxLength={40} onChange={(e) => setSpec(i, 'label', e.target.value)} aria-label={`Spec ${i + 1} name`} />
              <input className="input" placeholder="e.g. 190 – 220 °C" value={s.value} maxLength={80} onChange={(e) => setSpec(i, 'value', e.target.value)} aria-label={`Spec ${i + 1} value`} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm({ ...form, specs: form.specs.filter((_, j) => j !== i) })} aria-label={`Remove spec ${i + 1}`}>✕</button>
            </div>
          ))}
          {form.specs.length < 10 && (
            <div><button type="button" className="link" onClick={() => setForm({ ...form, specs: [...form.specs, { label: '', value: '' }] })}>+ Add a spec</button></div>
          )}
        </div>

        <div className="field-row">
          <button className="btn btn--hot" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : saved ? 'Save changes' : 'Add product'}</button>
          <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
        </div>
      </form>

      <aside className="editor-preview">
        <div className="stage-view">
          {saved?.imageVersion ? <img src={imageUrl(saved)} alt="" /> : <PrintModel key={form.shape} shape={form.shape} color={form.color} print />}
        </div>
        <div className="panel rows" style={{ gap: 10 }}>
          <strong>Photo</strong>
          {saved ? (
            <>
              <span className="fine">JPEG, PNG or WebP. Resized in your browser before upload. Without a photo, the drawing is shown.</span>
              <label className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }}>
                {busy === 'photo' ? 'Uploading…' : saved.imageVersion ? 'Replace photo' : 'Upload photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy === 'photo'} className="sr-only" />
              </label>
              {saved.imageVersion > 0 && <button type="button" className="link link--quiet" style={{ alignSelf: 'flex-start' }} onClick={removePhoto} disabled={busy === 'photo'}>Remove photo</button>}
            </>
          ) : (
            <span className="fine">Save the product first, then you can add a photo.</span>
          )}
        </div>
      </aside>
    </div>
  );
}

function ProductsTab({ onChange }) {
  const toast = useToast();
  const { data, error, reload } = useAdminData('/products?sort=name');
  const [editing, setEditing] = useState(null); // null = list, 'new', or a product

  async function remove(p) {
    if (!window.confirm(`Delete “${p.name}”? Past orders keep their own record of it. This cannot be undone.`)) return;
    try {
      await api(`/admin/products/${p._id}`, { method: 'DELETE' });
      toast('Product deleted.');
    } catch (err) {
      toast(err.message, 'bad');
    }
    reload();
    onChange();
  }

  const changed = () => {
    reload();
    onChange();
  };

  if (editing) {
    return <ProductEditor key={editing === 'new' ? 'new' : editing._id} product={editing === 'new' ? null : editing} onDone={() => setEditing(null)} onSaved={changed} />;
  }

  return (
    <>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <span className="result-count" style={{ margin: 0 }}>{data ? `${data.products.length} products` : ''}</span>
        <button className="btn btn--hot btn--sm" onClick={() => setEditing('new')}>+ Add product</button>
      </div>
      {error && <p className="alert alert--bad" role="alert">{error}</p>}
      {!error && !data && <Loading />}
      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Product</th><th>Category</th><th className="num">Price</th><th className="num">Stock</th><th /></tr></thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p._id}>
                  <td>
                    <div className="cell-product">
                      <div className="thumb thumb--sm">{p.imageVersion ? <img src={imageUrl(p)} alt="" /> : <PrintModel shape={p.shape} color={p.color} />}</div>
                      <div>
                        <Link to={`/product/${p._id}`} className="link link--quiet">{p.name}</Link>
                        {p.featured && <span className="pill" style={{ marginLeft: 8 }}>Pick</span>}
                      </div>
                    </div>
                  </td>
                  <td>{p.category}</td>
                  <td className="num">{rupees(p.price)}</td>
                  <td className="num" style={{ color: p.stock === 0 ? 'var(--bad)' : p.stock <= 5 ? 'var(--warn)' : undefined, fontWeight: p.stock <= 5 ? 600 : 400 }}>{p.stock}</td>
                  <td>
                    <div className="actions">
                      <button className="link" onClick={() => setEditing(p)}>Edit</button>
                      <button className="link" style={{ color: 'var(--bad)' }} onClick={() => remove(p)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- Customers ----------

function CustomersTab() {
  const { data, error } = useAdminData('/admin/customers');
  if (error) return <p className="alert alert--bad" role="alert">{error}</p>;
  if (!data) return <Loading />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th className="num">Orders</th></tr></thead>
        <tbody>
          {data.customers.map((c) => (
            <tr key={c.id}>
              <td>{c.name} {c.isAdmin && <span className="pill">Admin</span>}</td>
              <td>{c.email}</td>
              <td className="mono" style={{ fontSize: 13.5 }}>{when(c.joined)}</td>
              <td className="num">{c.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Page ----------

const TABS = ['Orders', 'Products', 'Customers'];

export default function Admin() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState('Orders');
  const isAdmin = Boolean(user?.isAdmin);
  const stats = useAdminData(isAdmin ? '/admin/stats' : '/auth/me');
  useTitle('Admin');

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login?next=%2Fadmin" replace />;
  if (!isAdmin) {
    return (
      <div className="wrap">
        <Empty shape="motor" color="#b5ac98" title="Admins only." action={<Link to="/" className="btn">Back to the shop</Link>}>
          This part of the site is for the people who run the shop.
        </Empty>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="page-head">
        <p className="eyebrow">Admin</p>
        <h1>Workshop</h1>
      </header>
      {stats.data?.orders !== undefined && <Stats stats={stats.data} />}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Orders' && <OrdersTab onChange={stats.reload} />}
      {tab === 'Products' && <ProductsTab onChange={stats.reload} />}
      {tab === 'Customers' && <CustomersTab />}
    </div>
  );
}
