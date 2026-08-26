import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';
import { mulberry32 } from './track';

/**
 * Every leaf and blade on the page comes out of these few functions. No
 * model files: a plane with its vertices pushed around is a leaf at the
 * scale this scene shows them, and staying procedural keeps the whole
 * site's download to one script.
 */

/** A grass blade: a narrow plane that tapers and bows forward. */
export function bladeGeometry(height: number, width: number, curl: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 1, 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + height / 2; // 0 at root
    // The buffer stores float32: y can come back as -1e-8 at the root, and
    // pow(negative, fractional) is NaN. Clamp the tip coordinate to [0, 1].
    const a = Math.min(Math.max(y / height, 0), 1);
    pos.setX(i, pos.getX(i) * (1 - Math.pow(a, 1.2) * 0.9));
    pos.setZ(i, a * a * curl);
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A broad leaf: widest mid-rib, creased down the middle, curled at the tip. */
export function leafGeometry(height: number, width: number, curl: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 2, 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + height / 2;
    const a = Math.min(Math.max(y / height, 0), 1);
    const x = pos.getX(i) * Math.pow(Math.sin(Math.PI * Math.min(Math.max(a, 0.02), 0.98)), 0.65);
    pos.setX(i, x);
    pos.setZ(i, Math.abs(x) * 0.35 + a * a * curl);
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * The four tuft archetypes the sprig instancer scatters: small bunches of
 * blades and leaves, each merged into one geometry so a thousand plants on
 * a block still cost one instanced draw per archetype.
 */
export function sprigArchetypes(): THREE.BufferGeometry[] {
  const rng = mulberry32(4517);
  const archetypes: THREE.BufferGeometry[] = [];
  const specs = [
    { blades: 5, leaves: 0, scale: 0.7 },
    { blades: 4, leaves: 1, scale: 0.85 },
    { blades: 2, leaves: 3, scale: 0.95 },
    { blades: 7, leaves: 1, scale: 1.1 },
  ];
  for (const spec of specs) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < spec.blades; i++) {
      const g = bladeGeometry(0.9 + rng() * 0.5, 0.08 + rng() * 0.05, 0.2 + rng() * 0.4);
      g.rotateY(rng() * Math.PI * 2);
      g.rotateZ((rng() - 0.5) * 0.9);
      g.translate((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2);
      parts.push(g);
    }
    for (let i = 0; i < spec.leaves; i++) {
      const g = leafGeometry(0.5 + rng() * 0.35, 0.22 + rng() * 0.12, 0.3 + rng() * 0.5);
      g.rotateY(rng() * Math.PI * 2);
      g.rotateZ((rng() - 0.5) * 0.7);
      g.translate((rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25);
      parts.push(g);
    }
    const merged = mergeBufferGeometries(parts, false);
    if (!merged) throw new Error('Sprig archetype merge failed.');
    merged.scale(spec.scale, spec.scale, spec.scale);
    archetypes.push(merged);
    for (const g of parts) g.dispose();
  }
  return archetypes;
}

/**
 * The vine's leaf: a teardrop blade on a short bent stem.
 *
 * The profile is deliberately widest BELOW the midpoint (the `n^0.72` inside
 * the sine) and comes to a sharp point, which is what separates a leaf
 * silhouette from an ellipse. The blade also curls forward strongly toward
 * the tip, so leaves catch the key light along their length instead of
 * reading as flat cards.
 */
export function vineLeafGeometry(): THREE.BufferGeometry {
  const blade = new THREE.PlaneGeometry(0.9, 1, 4, 6);
  blade.translate(0, 0.5, 0); // root at y = 0
  const bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    // Clamped before the fractional power: a float32 y of -1e-8 at the root
    // would otherwise make pow() return NaN and delete the whole leaf.
    const n = Math.min(Math.max(bp.getY(i), 0), 1);
    const r = bp.getX(i) / 0.45;
    const profile = Math.pow(Math.sin(Math.PI * Math.min(Math.pow(n, 0.72), 0.999)), 0.8);
    bp.setX(i, bp.getX(i) * profile);
    bp.setZ(i, Math.abs(r) * profile * 0.16 + n * n * 0.42);
  }
  blade.translate(0, 0.24, -0.03);

  const stem = new THREE.CylinderGeometry(0.016, 0.024, 0.28, 5, 3);
  stem.translate(0, 0.14, 0);
  const sp = stem.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const t = Math.min(Math.max(sp.getY(i) / 0.28, 0), 1);
    sp.setZ(i, sp.getZ(i) - t * t * 0.05);
  }

  const merged = mergeBufferGeometries([blade, stem], false);
  if (!merged) throw new Error('Vine leaf merge failed.');
  merged.computeVertexNormals();
  blade.dispose();
  stem.dispose();
  return merged;
}

/**
 * The leaf surface: a PALE sage sheet with lighter veins.
 *
 * The green does not live here. It arrives per instance as a mid-dark tint
 * that multiplies this sheet, which is the only ordering that produces
 * varied, believable foliage: a dark texture multiplied by pale tints
 * collapses to one muddy olive, because multiply can only ever darken.
 */
export function leafTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const rng = mulberry32(7919);
    ctx.fillStyle = 'rgb(205, 214, 196)';
    ctx.fillRect(0, 0, size, size);

    // Barely-there mottle: value variation only, alternating darker/lighter.
    for (let i = 0; i < 60; i++) {
      const cx = rng() * size;
      const cy = rng() * size;
      const rad = 20 + rng() * 50;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, i % 2 ? 'rgba(235, 240, 226, 0.10)' : 'rgba(150, 162, 140, 0.10)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }

    /* Veins sweep toward the tip. The texture's top edge is the tip once
       three.js flips the canvas, so "toward the tip" is up-canvas. */
    ctx.lineCap = 'round';
    const pair = (y: number, reach: number, rise: number) => {
      ctx.beginPath();
      ctx.moveTo(size / 2, y);
      ctx.quadraticCurveTo(size / 2 + reach * 0.55, y - rise * 0.35, size / 2 + reach, y - rise);
      ctx.moveTo(size / 2, y);
      ctx.quadraticCurveTo(size / 2 - reach * 0.55, y - rise * 0.35, size / 2 - reach, y - rise);
      ctx.stroke();
    };
    for (let v = 0; v < 7; v++) {
      const y = ((v + 1) / 8) * size;
      const reach = (0.34 - v * 0.03) * size;
      const rise = 0.22 * size;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(150, 160, 140, 0.25)';
      pair(y + 1.5, reach, rise);
      ctx.strokeStyle = `rgba(226, 233, 215, ${(0.8 - v * 0.06).toFixed(3)})`;
      pair(y, reach, rise);
    }

    // Midrib, thinning toward the tip.
    ctx.strokeStyle = 'rgb(232, 238, 222)';
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const y0 = size - (i / steps) * size;
      const y1 = size - ((i + 1) / steps) * size;
      ctx.lineWidth = 5 * (1 - i / steps) + 0.6;
      ctx.beginPath();
      ctx.moveTo(size / 2, y0);
      ctx.lineTo(size / 2, y1);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The bark surface, used as both bump and roughness map.
 *
 * Strands run lengthwise because the tube's U axis follows the vine, so
 * horizontal strokes here become fibres running along the stem. Without
 * this the bark shader's colour variation has no relief to sit on and the
 * vine reads as a smooth plastic pipe.
 */
export function barkTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const rng = mulberry32(3313);
    ctx.fillStyle = '#eff0ea';
    ctx.fillRect(0, 0, size, size);

    const strands = ['#191c16', '#3a3f37', '#565b52', '#8b9187', '#c3c8bb', '#4d5b3f'];
    ctx.lineCap = 'round';
    for (let i = 0; i < 420; i++) {
      const y = rng() * size;
      const len = size * (0.18 + rng() * 0.7);
      const x0 = rng() * size - len * 0.2;
      ctx.strokeStyle = strands[Math.floor(rng() * strands.length)];
      ctx.globalAlpha = 0.18 + rng() * 0.5;
      ctx.lineWidth = 0.6 + rng() * 2.6;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      // Slight wander so fibres are not perfectly parallel rules.
      const midDrift = (rng() - 0.5) * 9;
      const endDrift = (rng() - 0.5) * 14;
      ctx.quadraticCurveTo(x0 + len * 0.5, y + midDrift, x0 + len, y + endDrift);
      ctx.stroke();
    }

    // Knots: the occasional hard node in the grain.
    for (let i = 0; i < 20; i++) {
      const cx = rng() * size;
      const cy = rng() * size;
      const rad = 6 + rng() * 22;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, 'rgba(25, 28, 22, 0.75)');
      g.addColorStop(0.6, 'rgba(86, 91, 82, 0.35)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad * 1.6, rad, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
