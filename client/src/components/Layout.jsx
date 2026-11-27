// Announcement bar, header (with account menu and mobile menu) and footer.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { rupees } from '../api.js';
import { useAuth, useCart, useConfig, useToast } from '../context.jsx';

const CATEGORY_LINKS = [
  ['Printers', 'Printers'],
  ['Filament', 'Filament'],
  ['Resin', 'Resin'],
  ['Parts', 'Parts'],
  ['Printed Models', 'Models'],
];

const Icon = {
  cart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 4h2.4l2.2 11h10.6l2-8H6.3" strokeLinejoin="round" />
      <circle cx="9.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5" strokeLinecap="round" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
    </svg>
  ),
};

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="LayerForge home">
      <svg className="logo-mark" viewBox="0 0 26 22" aria-hidden="true">
        <rect x="8.5" y="0" width="9" height="4" rx="2" />
        <rect x="5" y="6" width="16" height="4" rx="2" />
        <rect x="2" y="12" width="22" height="4" rx="2" />
        <rect x="0" y="18" width="26" height="4" rx="2" />
      </svg>
      <span>LayerForge</span>
    </Link>
  );
}

export function Announce() {
  const { shipping, razorpay } = useConfig();
  return (
    <div className="announce">
      <div className="announce-row">
        <span>Free delivery on orders over {rupees(shipping.freeAbove)}</span>
        <span>{razorpay.enabled ? 'UPI · cards · netbanking · cash on delivery' : 'Cash on delivery across India'}</span>
        <span>Cancel any time before it ships</span>
      </div>
    </div>
  );
}

export function Header() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const [bump, setBump] = useState(false);
  const lastCount = useRef(count);

  // Close menus whenever the page changes.
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
  }, [location.pathname, location.search]);

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (e) => !accountRef.current?.contains(e.target) && setAccountOpen(false);
    const onKey = (e) => e.key === 'Escape' && setAccountOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen]);

  // A little pop on the cart count when something is added.
  useEffect(() => {
    if (count > lastCount.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 400);
      lastCount.current = count;
      return () => clearTimeout(t);
    }
    lastCount.current = count;
  }, [count]);

  async function handleLogout() {
    try {
      await logout();
      toast('You are logged out.');
      navigate('/');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  const params = new URLSearchParams(location.search);
  const activeCategory = location.pathname === '/shop' ? params.get('category') : null;
  const categoryLink = ([value, label]) => (
    <Link key={value} to={`/shop?category=${encodeURIComponent(value)}`} className={activeCategory === value ? 'is-active' : undefined}>
      {label}
    </Link>
  );

  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Logo />
        <nav className="nav" aria-label="Shop sections">
          <NavLink to="/shop" end className={({ isActive }) => (isActive && !activeCategory ? 'is-active' : undefined)}>All</NavLink>
          {CATEGORY_LINKS.map(categoryLink)}
        </nav>

        <div className="header-actions">
          {user ? (
            <div className="menu hide-sm" ref={accountRef}>
              <button className="icon-btn" aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => setAccountOpen((o) => !o)}>
                {Icon.user}
                {user.name.split(' ')[0]}
              </button>
              {accountOpen && (
                <div className="menu-panel" role="menu">
                  <div className="menu-who">
                    {user.name}
                    <small>{user.email}</small>
                  </div>
                  <Link to="/orders" role="menuitem">My orders</Link>
                  <Link to="/account" role="menuitem">Account &amp; address</Link>
                  {user.isAdmin && <Link to="/admin" role="menuitem">Admin</Link>}
                  <button role="menuitem" onClick={handleLogout}>Log out</button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="icon-btn hide-sm">{Icon.user}Log in</Link>
          )}
          <Link to="/cart" className="icon-btn cart-btn" aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
            {Icon.cart}
            <span className={`cart-count${bump ? ' bump' : ''}`}>{count}</span>
          </Link>
          <button className="icon-btn burger" aria-expanded={mobileOpen} aria-controls="mobile-nav" onClick={() => setMobileOpen((o) => !o)}>
            {Icon.menu}
            <span className="sr-only">Menu</span>
          </button>
        </div>
      </div>

      <nav id="mobile-nav" className={`wrap mobile-nav${mobileOpen ? ' is-open' : ''}`} aria-label="Menu">
        <Link to="/shop">All products</Link>
        {CATEGORY_LINKS.map(([value, label]) => (
          <Link key={value} to={`/shop?category=${encodeURIComponent(value)}`}>{label}</Link>
        ))}
        {user ? (
          <>
            <Link to="/orders">My orders</Link>
            <Link to="/account">Account &amp; address</Link>
            {user.isAdmin && <Link to="/admin">Admin</Link>}
            <button onClick={handleLogout}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/register">Create account</Link>
          </>
        )}
      </nav>
    </header>
  );
}

export function Footer() {
  const { user } = useAuth();
  const { razorpay } = useConfig();
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Logo />
          <p>Printers, filament, resin and spare parts, plus a few things we print ourselves. Shipped anywhere in India.</p>
        </div>
        <div>
          <h4>Shop</h4>
          {CATEGORY_LINKS.map(([value, label]) => (
            <Link key={value} to={`/shop?category=${encodeURIComponent(value)}`}>{label === 'Models' ? 'Printed models' : label}</Link>
          ))}
        </div>
        <div>
          <h4>Account</h4>
          {user ? (
            <>
              <Link to="/orders">My orders</Link>
              <Link to="/account">Saved address</Link>
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link>
              <Link to="/register">Create account</Link>
            </>
          )}
          <Link to="/cart">Cart</Link>
        </div>
        <div>
          <h4>Paying</h4>
          <p style={{ fontSize: 14.5 }}>
            {razorpay.enabled
              ? 'Card, UPI and netbanking payments are handled by Razorpay. We never see or store your card details.'
              : 'Pay the courier in cash when your order arrives.'}
          </p>
        </div>
      </div>
      <div className="footer-word" aria-hidden="true">LayerForge</div>
      <div className="wrap footer-base">
        <span>© {new Date().getFullYear()} LayerForge</span>
        <span>All prices in Indian rupees</span>
      </div>
    </footer>
  );
}
