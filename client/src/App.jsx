import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth, useCart } from './context.jsx';
import { ProductPage, Shop } from './pages/Shop.jsx';
import { CartPage, Checkout, Orders } from './pages/Cart.jsx';
import { Login, Register } from './pages/Account.jsx';

function Header() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout().catch(() => {});
    navigate('/');
  }

  return (
    <header className="header">
      <div className="container header-row">
        <Link to="/" className="logo">
          <span className="logo-mark" aria-hidden="true" />
          LayerForge
        </Link>
        <nav className="nav">
          <NavLink to="/" end>Shop</NavLink>
          {user && <NavLink to="/orders">My orders</NavLink>}
          <NavLink to="/cart">Cart{count > 0 && <span className="badge">{count}</span>}</NavLink>
          {user ? (
            <>
              <span className="hello">Hi, {user.name.split(' ')[0]}</span>
              <button className="link-button" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <Link to="/register" className="button small">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <main className="container main">
        <Routes>
          <Route path="/" element={<Shop />} />
          <Route path="/product/:id" element={<ProductPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<div className="empty"><h2>Page not found</h2><Link to="/">Back to the shop</Link></div>} />
        </Routes>
      </main>
      <footer className="footer">LayerForge &middot; a local demo store &middot; no real payments are taken</footer>
    </>
  );
}
