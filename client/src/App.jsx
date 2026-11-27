import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Announce, Footer, Header } from './components/Layout.jsx';
import { ErrorBoundary, Loading, ScrollToTop } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Shop from './pages/Shop.jsx';
import ProductPage from './pages/Product.jsx';
import CartPage from './pages/Cart.jsx';
import NotFound from './pages/NotFound.jsx';
import { Login, Register } from './pages/Auth.jsx';
import { Contact, Privacy, Refunds, Shipping, Terms } from './pages/Policies.jsx';

// Pages most visitors never open are loaded only when needed.
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const OrderList = lazy(() => import('./pages/Orders.jsx').then((m) => ({ default: m.OrderList })));
const OrderDetail = lazy(() => import('./pages/Orders.jsx').then((m) => ({ default: m.OrderDetail })));
const Account = lazy(() => import('./pages/Account.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

export default function App() {
  const location = useLocation();
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <ScrollToTop />
      <Announce />
      <Header />
      <main id="main">
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/product/:id" element={<ProductPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/orders" element={<OrderList />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/account" element={<Account />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/shipping" element={<Shipping />} />
              <Route path="/refunds" element={<Refunds />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
    </>
  );
}
