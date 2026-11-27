// Small helper for talking to the server. The login cookie is sent
// automatically by the browser; this code never sees or stores it.
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the shop right now. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
export const shortId = (id) => String(id).slice(-6).toUpperCase();
export const imageUrl = (product) => `/api/products/${product._id || product.id}/image?v=${product.imageVersion}`;
export const when = (date) => new Date(date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const CATEGORY_CODES = { Printers: 'PRN', Filament: 'FIL', Resin: 'RSN', Parts: 'PRT', 'Printed Models': 'MDL' };
