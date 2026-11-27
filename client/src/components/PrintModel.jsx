// Draws a product the way a slicer previews a 3D print: as a stack of
// thin layers seen from slightly above. Every shape below is described
// layer by layer, so it can also be "printed" on screen from the bed up.
import { useId, useMemo } from 'react';

const TILT = 0.4; // how far the camera looks down on the bed
const YAW = (34 * Math.PI) / 180; // boxes are turned so two sides show
const COS = Math.cos(YAW);
const SIN = Math.sin(YAW);
const HEX = /^#[0-9a-f]{6}$/i;
const FIXED_TONES = {
  dark: '#302d29',
  steel: '#bdb9ae',
  bed: '#4a463f',
  soil: '#3a2b21',
  leaf: '#3f9b57',
  accent: '#c9f23a',
  hole: '#161412',
};

// Mixes a colour towards white (amount > 0) or black (amount < 0).
export function mix(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const channel = (shift) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (target - c) * t).toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

// ---------- Building blocks (all sizes are in "model units") ----------

const range = (n) => Array.from({ length: n }, (_, i) => i);
const spin = (x, y) => [x * COS - y * SIN, x * SIN + y * COS];

const disc = (r, tone = 'body', x = 0, y = 0, extra) => ({ kind: 'disc', r, x, y, tone, ...extra });

function poly(pts, tone = 'body', extra) {
  const x = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
  const y = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  return { kind: 'poly', pts, x, y, tone, ...extra };
}

const ngon = (sides, r, turn = 0, tone = 'body', extra) =>
  poly(range(sides).map((j) => { const a = turn + (j / sides) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a)]; }), tone, extra);

const box = (w, d, tone = 'body', x = 0, y = 0, extra) =>
  poly([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([px, py]) => spin(x + px, y + py)), tone, extra);

function cog(teeth, outer, inner, turn = 0, tone = 'body') {
  const step = (Math.PI * 2) / teeth;
  const at = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  return poly(
    range(teeth).flatMap((k) => {
      const a = turn + k * step;
      return [at(inner, a), at(outer, a + step * 0.18), at(outer, a + step * 0.5), at(inner, a + step * 0.68)];
    }),
    tone
  );
}

// parts: [firstLayer, lastLayerExclusive, (layer, 0..1 progress) => shape or shapes]
function build(count, parts) {
  const layers = range(count).map(() => []);
  for (const [from, to, make] of parts) {
    for (let i = from; i < to; i++) {
      const t = to - from > 1 ? (i - from) / (to - from - 1) : 0;
      layers[i].push(...[].concat(make(i, t)));
    }
  }
  return layers;
}

const vaseRadius = (t) => 0.3 + 0.36 * Math.sin(Math.PI * t ** 0.7) ** 1.2 * (1 - 0.55 * t) + 0.22 * t ** 6;

// ---------- The models ----------

const MODELS = {
  // A reel of filament lying flat: two flanges with the coloured winding between.
  spool: () => ({
    unit: 62, lh: 3.2,
    layers: build(19, [[0, 2, () => disc(1, 'dark')], [2, 17, () => disc(0.84)], [17, 19, () => disc(1, 'dark')]]),
    top: [disc(0.6, 'body', 0, 0, { flat: true }), disc(0.3, 'dark', 0, 0, { flat: true }), disc(0.12, 'hole', 0, 0, { flat: true })],
  }),
  // A resin bottle: dark body, coloured label and cap.
  bottle: () => ({
    unit: 68, lh: 3.1,
    layers: build(35, [
      [0, 23, (i) => disc(0.5, i >= 6 && i < 17 ? 'body' : 'dark')],
      [23, 27, (i, t) => disc(0.5 - 0.28 * t, 'dark')],
      [27, 30, () => disc(0.2, 'dark')],
      [30, 35, () => disc(0.27)],
    ]),
    top: [],
  }),
  // A hot-end nozzle, tip up: thread, hex flats, then the cone.
  nozzle: () => ({
    unit: 72, lh: 3.2,
    layers: build(30, [
      [0, 10, () => disc(0.36)],
      [10, 17, () => ngon(6, 0.66, Math.PI / 6)],
      [17, 28, (i, t) => disc(0.52 - 0.4 * t)],
      [28, 30, () => disc(0.11)],
    ]),
    top: [disc(0.04, 'hole', 0, 0, { flat: true })],
  }),
  // A flexible build plate on its magnetic base, with the lifting tab.
  plate: () => ({
    unit: 66, lh: 3.4,
    layers: build(6, [
      [0, 3, () => box(1.72, 1.72, 'dark')],
      [3, 6, () => [box(1.64, 1.64), box(0.36, 0.2, 'body', 0, 0.9)]],
    ]),
    top: [box(1.36, 1.36, 'body', 0, 0, { line: true })],
  }),
  // A bed-slinger printer, caught halfway through a small print.
  printer: () => {
    const [px, py] = spin(0.02, 0.12);
    return {
      unit: 58, lh: 3,
      layers: build(40, [
        [0, 4, () => box(1.62, 1.3, 'dark')],
        [4, 6, () => box(1.08, 1.08, 'bed', 0, 0.12)],
        [6, 14, (i, t) => disc(0.2 - 0.05 * Math.sin(t * Math.PI), 'accent', px, py)],
        [4, 37, () => [box(0.14, 0.16, 'body', -0.72, -0.38), box(0.14, 0.16, 'body', 0.72, -0.38)]],
        [19, 27, () => box(0.3, 0.26, 'dark', -0.1, -0.2)],
        [22, 25, () => box(1.58, 0.1, 'steel', 0, -0.38)],
        [37, 40, () => box(1.62, 0.18, 'body', 0, -0.38)],
      ]),
      top: [],
    };
  },
  // A compact printer with a single arm.
  mini: () => {
    const [px, py] = spin(0.12, 0.08);
    return {
      unit: 64, lh: 3,
      layers: build(34, [
        [0, 4, () => box(1.2, 1.1, 'dark')],
        [4, 6, () => box(0.86, 0.86, 'bed', 0.1, 0.08)],
        [6, 12, () => disc(0.15, 'accent', px, py)],
        [4, 31, () => box(0.16, 0.18, 'body', -0.5, -0.36)],
        [18, 25, () => box(0.26, 0.24, 'dark', 0.14, -0.2)],
        [22, 25, () => box(1.0, 0.12, 'body', -0.02, -0.36)],
        [31, 34, () => box(0.22, 0.24, 'dark', -0.5, -0.36)],
      ]),
      top: [],
    };
  },
  // A resin printer: solid base under a see-through UV hood.
  resin: () => ({
    unit: 64, lh: 3,
    layers: build(40, [
      [0, 12, () => box(1.1, 1.1, 'dark')],
      [12, 14, () => box(0.56, 0.56, 'steel')],
      [14, 40, () => box(1.0, 1.0, 'body', 0, 0, { opacity: 0.8 })],
    ]),
    top: [box(0.72, 0.72, 'body', 0, 0, { line: true })],
  }),
  // A seven-sided vase that twists as it rises.
  vase: () => ({
    unit: 80, lh: 2.4,
    layers: build(56, [[0, 56, (i, t) => ngon(7, vaseRadius(t), t * 1.9)]]),
    top: [ngon(7, vaseRadius(1) * 0.8, 1.9, 'hollow', { flat: true })],
  }),
  // A faceted planter with something growing in it.
  planter: () => ({
    unit: 76, lh: 3,
    layers: build(26, [[0, 26, (i, t) => ngon(6, 0.5 + 0.3 * t, (Math.floor(i / 5) % 2) * (Math.PI / 6))]]),
    top: [
      ngon(6, 0.68, Math.PI / 6, 'soil', { flat: true }),
      disc(0.14, 'leaf', -0.12, 0.04, { flat: true }),
      disc(0.1, 'leaf', 0.1, -0.06, { flat: true }),
    ],
  }),
  // Two meshed-looking gears, one on top of the other.
  gear: () => ({
    unit: 68, lh: 3.4,
    layers: build(12, [[0, 6, () => cog(14, 0.98, 0.8)], [6, 12, () => cog(9, 0.56, 0.4, 0.2, 'body-')]]),
    top: [disc(0.13, 'hole', 0, 0, { flat: true })],
  }),
  // A stepper motor: steel end caps, dark body, shaft.
  motor: () => ({
    unit: 68, lh: 3,
    layers: build(34, [
      [0, 3, () => box(0.92, 0.92, 'steel')],
      [3, 19, () => box(0.92, 0.92)],
      [19, 22, () => box(0.92, 0.92, 'steel')],
      [22, 24, () => disc(0.26, 'steel')],
      [24, 34, () => disc(0.085, 'steel')],
    ]),
    top: [],
  }),
};

export const SHAPE_NAMES = {
  printer: 'Printer (frame)', mini: 'Printer (compact)', resin: 'Resin printer', spool: 'Filament spool',
  bottle: 'Bottle', nozzle: 'Nozzle', plate: 'Build plate', motor: 'Motor', vase: 'Vase', planter: 'Planter', gear: 'Gears',
};
export const layerCount = (shape) => (MODELS[shape] || MODELS.vase)().layers.length;

const reach = (p) => (p.kind === 'disc' ? Math.hypot(p.x, p.y) + p.r : Math.max(...p.pts.map(([x, y]) => Math.hypot(x, y))));
const footprint = (layer) => Math.max(...layer.map(reach));
// A shape's top face is visible when nothing sits directly on it.
const isCovered = (p, above) => above?.some((q) => Math.abs(q.x - p.x) < 0.06 && Math.abs(q.y - p.y) < 0.06);

export function PrintModel({ shape = 'vase', color = '#ff5a2b', shown, print = false, shifted = false, nozzle = false, label }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const model = useMemo(() => (MODELS[shape] || MODELS.vase)(), [shape]);
  const body = HEX.test(color) ? color : '#ff5a2b';
  const { unit, lh, layers, top } = model;
  const count = layers.length;
  const visible = shown === undefined ? count : Math.max(0, Math.min(count, Math.round(shown)));

  // Centre the object in the 200 x 200 drawing.
  const footR = footprint(layers[0]) * unit;
  const topR = footprint(layers[count - 1]) * unit;
  const baseY = 100 + (count * lh + topR * TILT - footR * TILT) / 2;

  const toneColor = (tone) =>
    tone === 'body' ? body : tone === 'body-' ? mix(body, -0.2) : tone === 'hollow' ? mix(body, -0.55) : FIXED_TONES[tone] || body;
  const tones = [...new Set(layers.flat().map((p) => p.tone))];
  // A failed print for the "page not found" screen: the layers slip sideways.
  const slip = (i) => (shifted ? (i > count * 0.5 ? 14 : 0) + (i > count * 0.78 ? -9 : 0) : 0);

  function draw(p, i, key, exposed) {
    const c = toneColor(p.tone);
    const y0 = baseY - i * lh;
    const paint = p.line
      ? { fill: 'none', stroke: mix(c, -0.3), strokeWidth: 0.9, strokeDasharray: '3 3' }
      : {
          fill: p.flat ? c : exposed ? mix(c, 0.16) : `url(#${uid}${p.tone}${i % 2})`,
          fillOpacity: p.opacity,
          stroke: mix(c, -0.34),
          strokeWidth: 0.55,
          strokeLinejoin: 'round',
        };
    if (p.kind === 'disc') {
      return <ellipse key={key} cx={100 + p.x * unit + slip(i)} cy={y0 + p.y * unit * TILT} rx={p.r * unit} ry={p.r * unit * TILT} {...paint} />;
    }
    const points = p.pts.map(([x, y]) => `${(100 + x * unit + slip(i)).toFixed(1)},${(y0 + y * unit * TILT).toFixed(1)}`).join(' ');
    return <polygon key={key} points={points} {...paint} />;
  }

  return (
    <svg className={`pm${print ? ' pm--print' : ''}`} viewBox="0 0 200 200" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        {tones.flatMap((tone) =>
          [0, 1].map((band) => {
            const c = mix(toneColor(tone), band ? -0.07 : 0);
            return (
              <linearGradient key={tone + band} id={`${uid}${tone}${band}`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor={mix(c, -0.3)} />
                <stop offset="0.4" stopColor={c} />
                <stop offset="0.76" stopColor={mix(c, 0.14)} />
                <stop offset="1" stopColor={mix(c, -0.12)} />
              </linearGradient>
            );
          })
        )}
      </defs>
      <ellipse cx={104} cy={baseY + 4} rx={footR * 1.06} ry={footR * TILT * 1.06} fill="#15130f" opacity="0.13" />
      {layers.slice(0, visible).map((layer, i) => (
        <g key={i} className="pm-layer" style={{ '--i': i }}>
          {[...layer].sort((a, b) => a.y - b.y).map((p, j) => draw(p, i, j, !isCovered(p, layers[i + 1])))}
        </g>
      ))}
      {visible === count && top.length > 0 && (
        <g className="pm-layer" style={{ '--i': count }}>
          {top.map((p, j) => draw(p, count - 1, j, false))}
        </g>
      )}
      {nozzle && visible < count && (
        <g transform={`translate(100 ${baseY - visible * lh - 3})`}>
          <g className="pm-nozzle">
            <rect x="-10" y="-30" width="20" height="16" fill="#302d29" />
            <rect x="-13" y="-34" width="26" height="5" fill="#bdb9ae" />
            <polygon points="-6,-14 6,-14 2,-3 -2,-3" fill="#c9a04a" />
            <circle cx="0" cy="-1.5" r="1.8" fill="#ff5a2b" />
          </g>
        </g>
      )}
    </svg>
  );
}
