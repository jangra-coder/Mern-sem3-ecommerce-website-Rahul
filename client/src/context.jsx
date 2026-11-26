import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

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

  const value = {
    user,
    loading,
    login: async (email, password) => setUser((await api('/auth/login', { method: 'POST', body: { email, password } })).user),
    register: async (name, email, password) =>
      setUser((await api('/auth/register', { method: 'POST', body: { name, email, password } })).user),
    logout: async () => {
      await api('/auth/logout', { method: 'POST', body: {} });
      setUser(null);
    },
    // Called when the server says the session has expired.
    forget: () => setUser(null),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------- Shopping cart (kept in this browser) ----------

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

export const MAX_QTY = 10;
const STORAGE_KEY = 'layerforge-cart';

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

const clampQty = (qty, stock) => Math.max(1, Math.min(qty, MAX_QTY, stock ?? MAX_QTY));

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable - the cart still works until the tab closes */
    }
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      count: items.reduce((n, i) => n + i.qty, 0),
      total: items.reduce((sum, i) => sum + i.price * i.qty, 0),
      add(product, qty = 1) {
        setItems((prev) => {
          const existing = prev.find((i) => i.id === product._id);
          const line = {
            id: product._id,
            name: product.name,
            price: product.price,
            stock: product.stock,
            color: product.color,
            category: product.category,
            qty: clampQty((existing?.qty || 0) + qty, product.stock),
          };
          return existing ? prev.map((i) => (i.id === line.id ? line : i)) : [...prev, line];
        });
      },
      setQty(id, qty) {
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty: clampQty(qty, i.stock) } : i)));
      },
      remove(id) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      },
      clear() {
        setItems([]);
      },
    }),
    [items]
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
