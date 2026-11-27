import { Link } from 'react-router-dom';
import { PrintModel } from '../components/PrintModel.jsx';
import { useTitle } from '../components/ui.jsx';

// A print with a layer shift: the classic way a print goes wrong.
export default function NotFound() {
  useTitle('Page not found');
  return (
    <div className="wrap lost">
      <PrintModel shape="vase" color="#ff5a2b" shifted print label="A vase print with its top layers shifted sideways" />
      <div>
        <p className="eyebrow">Error 404 · layer shift detected</p>
        <h1>Well, that didn't stick.</h1>
        <p className="hero-lede">The page you were after isn't here. It may have moved, or the link had a typo in it.</p>
        <div className="hero-cta">
          <Link to="/shop" className="btn btn--hot">Go to the shop <span className="arrow">→</span></Link>
          <Link to="/" className="btn btn--ghost">Home</Link>
        </div>
      </div>
    </div>
  );
}
