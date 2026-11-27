import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees } from '../api.js';
import { useConfig } from '../context.jsx';
import { PrintModel, layerCount } from '../components/PrintModel.jsx';
import { ProductGrid } from '../components/ProductCard.jsx';
import { useReducedMotion, useTitle } from '../components/ui.jsx';

// What the printer in the hero works through, one after another.
const JOBS = [
  { shape: 'vase', color: '#ff5a2b', file: 'spiral_vase.gcode', nozzle: 210, bed: 60 },
  { shape: 'spool', color: '#2456e6', file: 'spool_holder.gcode', nozzle: 240, bed: 80 },
  { shape: 'gear', color: '#2bb58b', file: 'planetary_gear.gcode', nozzle: 215, bed: 60 },
  { shape: 'planter', color: '#e9785f', file: 'faceted_planter.gcode', nozzle: 205, bed: 55 },
];
const LAYER_MM = 0.2;

function Chamber() {
  const reduced = useReducedMotion();
  const [job, setJob] = useState(0);
  const [layer, setLayer] = useState(0);
  const { shape, color, file, nozzle, bed } = JOBS[job];
  const total = useMemo(() => layerCount(shape), [shape]);
  const done = reduced || layer >= total;
  const shown = reduced ? total : layer;

  // One layer at a time; a short pause when a print finishes, then the next job.
  useEffect(() => {
    if (reduced) return;
    const delay = layer < total ? Math.max(40, 3000 / total) : 2000;
    const t = setTimeout(() => {
      if (layer < total) setLayer(layer + 1);
      else {
        setJob((j) => (j + 1) % JOBS.length);
        setLayer(0);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [layer, total, reduced]);

  const pct = Math.round((shown / total) * 100);
  return (
    <div className="chamber" aria-label="A printer printing a sample model" role="img">
      <div className="chamber-head">
        <span><i className={`dot${done ? ' dot--done' : ''}`} />{done ? 'COMPLETE' : 'PRINTING'} <b>{file}</b></span>
        <span>{pct}%</span>
      </div>
      <div className="chamber-plate live">
        <PrintModel shape={shape} color={color} shown={shown} nozzle={!done} />
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="hud">
        <div><span>Layer</span><strong>{shown}/{total}</strong></div>
        <div><span>Z height</span><strong>{(shown * LAYER_MM).toFixed(2)}</strong></div>
        <div><span>Nozzle</span><strong>{done ? 'idle' : `${nozzle}°`}</strong></div>
        <div><span>Bed</span><strong>{bed}°</strong></div>
      </div>
    </div>
  );
}

const CATEGORY_TILES = [
  { name: 'Printers', shape: 'printer', color: '#ff5a2b' },
  { name: 'Filament', shape: 'spool', color: '#2456e6' },
  { name: 'Resin', shape: 'bottle', color: '#1aa3a3' },
  { name: 'Parts', shape: 'nozzle', color: '#c9a04a' },
  { name: 'Printed Models', shape: 'vase', color: '#e9785f' },
];

// How the common materials compare (1 to 5).
const MATERIALS = [
  { name: 'PLA', color: '#ff5a2b', ease: 5, tough: 2, heat: 1, flex: 1, temp: '190–220 °C', use: 'Prototypes, models and décor. Forgiving, low smell, the place to start.', link: '/shop?q=PLA' },
  { name: 'PETG', color: '#2456e6', ease: 4, tough: 4, heat: 3, flex: 2, temp: '230–250 °C', use: 'Brackets, enclosures and anything that lives outdoors or near heat.', link: '/shop?q=PETG' },
  { name: 'TPU', color: '#2bb58b', ease: 2, tough: 5, heat: 2, flex: 5, temp: '220–240 °C', use: 'Rubbery parts: phone cases, gaskets, tyres, feet. Print slowly.', link: '/shop?q=TPU' },
  { name: 'Resin', color: '#1aa3a3', ease: 3, tough: 2, heat: 2, flex: 1, temp: '405 nm UV', use: 'Miniatures and fine detail down to 35 µm. Needs a resin printer.', link: '/shop?category=Resin' },
];

const Meter = ({ value, label }) => (
  <span className="meter" role="img" aria-label={`${label}: ${value} out of 5`}>
    {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= value ? 'on' : ''} />)}
  </span>
);

export default function Home() {
  const { shipping, razorpay } = useConfig();
  const [featured, setFeatured] = useState(null);
  const [counts, setCounts] = useState({});
  useTitle();

  useEffect(() => {
    api('/products?featured=1')
      .then((d) => {
        setFeatured(d.products.slice(0, 4));
        setCounts(d.counts);
      })
      .catch(() => setFeatured([]));
  }, []);

  return (
    <>
      <section className="wrap hero">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">3D printing supplies · shipped across India</p>
            <h1>
              <span>Printers.</span>
              <span className="striped">Plastic.</span>
              <span>Parts.</span>
            </h1>
            <p className="hero-lede">
              Machines, filament and resin, the spares that keep them running, and a few things we print ourselves.
              {razorpay.enabled ? ' Pay by UPI, card or cash on delivery.' : ' Pay in cash when it arrives.'}
            </p>
            <div className="hero-cta">
              <Link to="/shop" className="btn btn--hot">Browse the shop <span className="arrow">→</span></Link>
              <Link to="/shop?category=Filament" className="btn btn--ghost">Filament</Link>
            </div>
          </div>
          <Chamber />
        </div>

        <div className="facts">
          <div className="fact"><strong>Free delivery over {rupees(shipping.freeAbove)}</strong><span>Smaller orders ship for {rupees(shipping.fee)}, anywhere in India.</span></div>
          <div className="fact">
            <strong>{razorpay.enabled ? 'UPI, cards or cash' : 'Cash on delivery'}</strong>
            <span>{razorpay.enabled ? 'Online payments run through Razorpay. Card details never touch our server.' : 'Pay the courier when your parcel arrives.'}</span>
          </div>
          <div className="fact"><strong>Changed your mind?</strong><span>Cancel from your orders page until it ships. Online payments are refunded automatically.</span></div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div><p className="eyebrow">Categories</p><h2>Find it by what it does</h2></div>
          <Link to="/shop" className="link link--quiet hide-sm">Everything →</Link>
        </div>
        <div className="cats">
          {CATEGORY_TILES.map((c) => (
            <Link key={c.name} to={`/shop?category=${encodeURIComponent(c.name)}`} className="cat">
              <div className="cat-plate"><PrintModel shape={c.shape} color={c.color} /></div>
              <div className="cat-body">
                <strong>{c.name}</strong>
                <span>{counts[c.name] ?? '–'}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div><p className="eyebrow">Staff picks</p><h2>What we'd buy first</h2></div>
          <Link to="/shop" className="link link--quiet">See all →</Link>
        </div>
        <ProductGrid products={featured || []} loading={featured === null} />
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div><p className="eyebrow">Material guide</p><h2>Which plastic do you need?</h2></div>
        </div>
        <div className="table-scroll">
          <table className="materials">
            <thead>
              <tr><th>Material</th><th>Easy to print</th><th>Toughness</th><th>Heat</th><th>Flex</th><th>Prints at</th><th>Good for</th><th /></tr>
            </thead>
            <tbody>
              {MATERIALS.map((m) => (
                <tr key={m.name}>
                  <td><span className="mat-name"><PrintModel shape={m.name === 'Resin' ? 'bottle' : 'spool'} color={m.color} />{m.name}</span></td>
                  <td><Meter value={m.ease} label="Easy to print" /></td>
                  <td><Meter value={m.tough} label="Toughness" /></td>
                  <td><Meter value={m.heat} label="Heat resistance" /></td>
                  <td><Meter value={m.flex} label="Flexibility" /></td>
                  <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 14 }}>{m.temp}</td>
                  <td className="use">{m.use}</td>
                  <td><Link to={m.link} className="link" style={{ whiteSpace: 'nowrap' }}>Shop {m.name} →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
