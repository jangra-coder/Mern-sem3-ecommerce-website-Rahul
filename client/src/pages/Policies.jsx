// Terms, Privacy, Refund & Cancellation, Shipping and Contact pages.
// Business details come from ../business.js.
import { NavLink } from 'react-router-dom';
import { rupees } from '../api.js';
import { useConfig } from '../context.jsx';
import { BUSINESS, isPlaceholder } from '../business.js';
import { useTitle } from '../components/ui.jsx';

// Shows a business detail; anything not filled in yet is highlighted.
const B = ({ k }) => (isPlaceholder(BUSINESS[k]) ? <mark className="todo">{BUSINESS[k]}</mark> : <>{BUSINESS[k]}</>);

const PAGES = [
  ['/shipping', 'Shipping'],
  ['/refunds', 'Refunds & cancellation'],
  ['/terms', 'Terms & conditions'],
  ['/privacy', 'Privacy policy'],
  ['/contact', 'Contact us'],
];

function PolicyLayout({ title, children }) {
  useTitle(title);
  return (
    <div className="wrap">
      <header className="page-head">
        <p className="eyebrow">Help &amp; policies</p>
        <h1>{title}</h1>
        <p>Last updated {BUSINESS.updated}</p>
      </header>
      <div className="policy">
        <nav className="policy-nav" aria-label="Policies">
          {PAGES.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'is-on' : undefined)}>{label}</NavLink>
          ))}
        </nav>
        <article className="prose">{children}</article>
      </div>
    </div>
  );
}

const ContactLine = () => (
  <>email <B k="email" /> or call <B k="phone" /> ({BUSINESS.hours})</>
);

export function Shipping() {
  const { shipping, razorpay } = useConfig();
  return (
    <PolicyLayout title="Shipping policy">
      <p>{BUSINESS.brand} ships to addresses across India.</p>

      <h2>Delivery charges</h2>
      <ul>
        <li>Orders of {rupees(shipping.freeAbove)} or more ship free.</li>
        <li>Smaller orders have a flat delivery charge of {rupees(shipping.fee)}, shown at checkout before you pay.</li>
      </ul>

      <h2>How long it takes</h2>
      <ul>
        <li>In-stock items are packed and handed to the courier within {BUSINESS.dispatchDays} of your order.</li>
        <li>Printed models are made after you order, so they can take {BUSINESS.madeToOrderExtra} before dispatch.</li>
        <li>Delivery usually takes {BUSINESS.deliveryDays} after dispatch. Remote areas can take longer.</li>
      </ul>
      <p>You can follow each order on the <strong>My orders</strong> page as it moves from Placed to Packed, Shipped and Delivered.</p>

      <h2>Paying on delivery</h2>
      <p>
        Cash on delivery is available on all orders{razorpay.enabled ? ', alongside UPI, cards and netbanking at checkout' : ''}.
        Please keep the exact amount ready for the courier.
      </p>

      <h2>Address and damaged parcels</h2>
      <ul>
        <li>Check your address and phone number carefully. Once an order has shipped, the address can't be changed.</li>
        <li>If a parcel arrives open or visibly damaged, take photos before opening it further and contact us within 48 hours.</li>
      </ul>

      <p>Questions about a delivery? <ContactLine />, quoting your order number.</p>
    </PolicyLayout>
  );
}

export function Refunds() {
  const { holdMinutes } = useConfig();
  return (
    <PolicyLayout title="Refund & cancellation policy">
      <h2>Cancelling an order</h2>
      <ul>
        <li>You can cancel any order yourself from <strong>My orders</strong> until it ships (while it is Placed or Packed).</li>
        <li>If you paid online, the full amount is refunded to your original payment method automatically. Banks usually take 5–7 working days to show it.</li>
        <li>If you chose cash on delivery, nothing has been charged, so there is nothing to refund.</li>
        <li>An online order that is not paid within {holdMinutes} minutes is released automatically and nothing is charged.</li>
      </ul>

      <h2>After an order has shipped</h2>
      <p>Once shipped, an order can't be cancelled, but we will put things right if something is wrong with it:</p>
      <ul>
        <li>If an item arrives <strong>damaged, faulty or not what you ordered</strong>, contact us within {BUSINESS.returnWindowDays} days of delivery with your order number and photos.</li>
        <li>We will arrange a replacement or a full refund for that item, including its delivery charge.</li>
        <li>For hygiene and safety, opened filament or resin, and models printed to order, can't be returned just because you changed your mind.</li>
        <li>Printers and parts in unused condition and original packaging can be returned within {BUSINESS.returnWindowDays} days of delivery if you change your mind; return shipping is paid by you.</li>
      </ul>

      <h2>How refunds are paid</h2>
      <ul>
        <li>Online payments: back to the card, UPI account, bank or wallet you paid with.</li>
        <li>Cash on delivery orders: by UPI or bank transfer to an account you give us.</li>
        <li>Approved refunds are started within 2 working days.</li>
      </ul>

      <h2>If we have to cancel</h2>
      <p>If we can't fulfil an order (for example, an item turns out to be out of stock), we will cancel it and refund everything you paid in full.</p>

      <p>To ask for a return or refund, <ContactLine />.</p>
    </PolicyLayout>
  );
}

export function Terms() {
  return (
    <PolicyLayout title="Terms & conditions">
      <p>
        These terms apply when you use this website or buy from it. The website and store are run by <B k="legalName" />,
        <B k="address" /> ("we", "us"). By placing an order you agree to these terms, our Shipping policy, our Refund &amp; cancellation policy and our Privacy policy.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Give accurate details and keep your password private. You are responsible for orders placed from your account.</li>
        <li>We may suspend accounts used for fraud, abuse or attempts to break the website.</li>
      </ul>

      <h2>Products and prices</h2>
      <ul>
        <li>All prices are in Indian rupees (₹). The total shown at checkout, including any delivery charge, is the amount you pay.</li>
        <li>Product drawings are illustrations, and photos may differ slightly in colour from the real item. Specifications are as provided by the manufacturer.</li>
        <li>Printed models are made to order. Small variations in colour and visible layer lines are a normal part of 3D printing.</li>
        <li>If a product is listed at a clearly wrong price, we may cancel the order and refund you in full.</li>
      </ul>

      <h2>Orders and payment</h2>
      <ul>
        <li>An order is confirmed once it shows as Placed in <strong>My orders</strong>.</li>
        <li>Online payments are processed securely by Razorpay. We never see or store your card, UPI or bank login details.</li>
        <li>Cash on delivery orders are paid to the courier on delivery.</li>
      </ul>

      <h2>Safe use</h2>
      <p>
        3D printers have hot nozzles and beds, moving parts and mains power, and resins must be handled with gloves and good ventilation.
        Follow the manufacturer's instructions. To the extent the law allows, our liability for any product is limited to the amount you paid for it.
      </p>

      <h2>Changes and law</h2>
      <p>
        We may update these terms; the version on this page when you order applies to that order. These terms are governed by the laws of India,
        and disputes are subject to the courts of <B k="jurisdiction" />.
      </p>

      <p>Questions? <ContactLine />.</p>
    </PolicyLayout>
  );
}

export function Privacy() {
  return (
    <PolicyLayout title="Privacy policy">
      <p>
        This explains what personal information {BUSINESS.brand} (run by <B k="legalName" />) collects, why, and what you can do about it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your name, email address and password. The password is stored only as a secure one-way hash; nobody can read it.</li>
        <li><strong>Orders:</strong> what you bought, your delivery name, address and mobile number, and the payment status.</li>
        <li><strong>Payments:</strong> card, UPI and bank details are entered in Razorpay's own window and go directly to Razorpay. We receive only a payment reference number.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To process, deliver and support your orders, including refunds.</li>
        <li>To keep your account secure (for example, limiting repeated wrong passwords).</li>
        <li>To keep records the law requires for accounting and tax.</li>
      </ul>
      <p>We don't sell your information, and we don't use it for advertising.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li>Courier partners: your name, phone number and address, to deliver your order.</li>
        <li>Razorpay: to process online payments and refunds.</li>
        <li>Our hosting providers (Render and MongoDB Atlas), who store the website's data on our behalf.</li>
      </ul>

      <h2>Cookies and storage</h2>
      <p>
        We use a single essential cookie to keep you logged in, and your cart is saved in your own browser. There are no advertising or tracking cookies.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Update your name, saved address and password on the <strong>Account</strong> page, and log out of all devices from there.</li>
        <li>To get a copy of your data or have your account deleted, email <B k="email" />. Order records may be kept for as long as the law requires.</li>
      </ul>

      <h2>Contact for privacy questions</h2>
      <p><B k="legalName" />, <B k="address" />. Email <B k="email" />.</p>
    </PolicyLayout>
  );
}

export function Contact() {
  return (
    <PolicyLayout title="Contact us">
      <p>We're happy to help with orders, returns, or choosing the right printer or material.</p>
      <dl className="kv contact-kv">
        <dt>Email</dt>
        <dd>{isPlaceholder(BUSINESS.email) ? <B k="email" /> : <a className="link" href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>}</dd>
        <dt>Phone</dt>
        <dd><B k="phone" /></dd>
        <dt>Hours</dt>
        <dd>{BUSINESS.hours}</dd>
        <dt>Address</dt>
        <dd><B k="legalName" /><br /><B k="address" /></dd>
      </dl>
      <p>For a question about an order, include its number (shown as #ABC123 on your <strong>My orders</strong> page).</p>
    </PolicyLayout>
  );
}
