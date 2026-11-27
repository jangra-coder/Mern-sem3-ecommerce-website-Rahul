import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

// ---------- Shop settings from the server (delivery fee, payment options...) ----------

const DEFAULT_CONFIG = {
  razorpay: { enabled: false, keyId: null },
  shipping: { fee: 79, freeAbove: 999 },
  maxQty: 10,
  holdMinutes: 30,
  categories: ['Printers', 'Filament', 'Resin', 'Parts', 'Printed Models'],
  shapes: [],
  states: [],
};
const ConfigContext = createContext(DEFAULT_CONFIG);
export const useConfig = () => useContext(ConfigContext);

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  useEffect(() => {
    api('/config').then(setConfig).catch(() => {});
  }, []);
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

// ---------- Small pop-up messages ----------

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const toast = useCallback((message, kind = 'ok') => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'bad' ? 6000 : 3200);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Who is logged in ----------

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      setUser,
      login: async (email, password) => setUser((await api('/auth/login', { method: 'POST', body: { email, password } })).user),
      register: async (name, email, password) =>
        setUser((await api('/auth/register', { method: 'POST', body: { name, email, password } })).user),
      logout: async () => {
        await api('/auth/logout', { method: 'POST', body: {} });
        setUser(null);
      },
      // Called when the server says the session has expired.
      forget: () => setUser(null),
    }),
    [user, loading]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------- Shopping cart (kept in this browser) ----------

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

const STORAGE_KEY = 'layerforge-cart-v2';

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved)) return [];
    // Ignore anything that doesn't look like a cart line.
    return saved.filter(
      (i) => i && typeof i.id === 'string' && typeof i.name === 'string' && Number.isFinite(i.price) && Number.isInteger(i.qty) && i.qty > 0
    );
  } catch {
    return [];
  }
}

const lineFrom = (product, qty) => ({
  id: product._id,
  name: product.name,
  price: product.price,
  stock: product.stock,
  color: product.color,
  shape: product.shape,
  category: product.category,
  imageVersion: product.imageVersion || 0,
  qty,
});

export function CartProvider({ children }) {
  const { maxQty } = useConfig();
  const [items, setItems] = useState(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable - the cart still works until the tab closes */
    }
  }, [items]);

  const value = useMemo(() => {
    const clamp = (qty, stock) => Math.max(1, Math.min(qty, maxQty, stock ?? maxQty));
    return {
      items,
      count: items.reduce((n, i) => n + i.qty, 0),
      subtotal: items.reduce((sum, i) => sum + i.price * i.qty, 0),
      qtyOf: (id) => items.find((i) => i.id === id)?.qty || 0,
      add(product, qty = 1) {
        setItems((prev) => {
          const existing = prev.find((i) => i.id === product._id);
          const line = lineFrom(product, clamp((existing?.qty || 0) + qty, product.stock));
          return existing ? prev.map((i) => (i.id === line.id ? line : i)) : [...prev, line];
        });
      },
      setQty(id, qty) {
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty: clamp(qty, i.stock) } : i)));
      },
      remove(id) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      },
      clear() {
        setItems([]);
      },
      // Bring saved lines up to date with the shop: new prices, lower stock,
      // products that no longer exist. Returns what changed, for a message.
      sync(products) {
        // Worked out from the current cart directly (not inside a state
        // updater, which React may run later or twice).
        const byId = new Map(products.map((p) => [p._id, p]));
        const notes = [];
        const next = items.flatMap((i) => {
          const p = byId.get(i.id);
          if (!p) {
            notes.push(`${i.name} is no longer sold and was removed.`);
            return [];
          }
          if (p.stock === 0) {
            notes.push(`${p.name} has sold out and was removed.`);
            return [];
          }
          if (p.price !== i.price) notes.push(`${p.name} now costs ₹${p.price.toLocaleString('en-IN')}.`);
          if (i.qty > p.stock) notes.push(`Only ${p.stock} of ${p.name} left, so your quantity was lowered.`);
          return [lineFrom(p, clamp(i.qty, p.stock))];
        });
        setItems(next);
        return notes;
      },
    };
  }, [items, maxQty]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
