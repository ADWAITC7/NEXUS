import * as THREE from 'three';

/** Deterministic RNG: the scene is identical art on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smootherstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(b - a, 1e-6)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export interface Track {
  positions: THREE.Vector3[];
  tangents: THREE.Vector3[];
  ups: THREE.Vector3[];
  sides: THREE.Vector3[];
  arcLength: number;
}

interface TrackShape {
  angle: number;
  trackLength: number;
  bendAmp: number;
  bendFreq: number;
  depthAmp: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The master rail: a downhill diagonal, bent in-plane and in depth, smoothed
 * through a centripetal Catmull-Rom and resampled to 401 uniform points with
 * rotation-minimizing frames. Everything on the conveyor is positioned by
 * sampling this once-built table; nothing ever re-evaluates the curve.
 */
export function buildTrack(p: TrackShape): Track {
  const theta = (p.angle * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(theta), -Math.cos(theta), 0).normalize();
  const perp = new THREE.Vector3(-dir.y, dir.x, 0);

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 120; i++) {
    const a = i / 120;
    const along = (a - 0.5) * p.trackLength;
    const bend = Math.sin((a - 0.5) * p.bendFreq * Math.PI * 2) * p.bendAmp;
    const depth = p.depthAmp * ((a - 0.5) * 1.4 + 0.35 * Math.sin((a - 0.5) * 3));
    pts.push(
      new THREE.Vector3(
        p.offsetX + dir.x * along + perp.x * bend,
        p.offsetY + dir.y * along + perp.y * bend,
        depth,
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');

  const positions: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= 400; i++) {
    positions.push(curve.getPointAt(i / 400));
    tangents.push(curve.getTangentAt(i / 400).normalize());
  }

  /*
   * Parallel transport: carry one up vector along the rail, re-squaring it
   * against each tangent. A Frenet frame would flip wherever curvature
   * changes sign, and every block on the belt would somersault with it.
   */
  const ups: THREE.Vector3[] = [];
  const sides: THREE.Vector3[] = [];
  let up = new THREE.Vector3(0, 0, 1)
    .addScaledVector(tangents[0], -tangents[0].z)
    .normalize();
  for (const tan of tangents) {
    up = up.clone().addScaledVector(tan, -up.dot(tan)).normalize();
    ups.push(up);
    sides.push(new THREE.Vector3().crossVectors(tan, up).normalize());
  }

  return { positions, tangents, ups, sides, arcLength: curve.getLength() };
}

/** A lane: the master rail slid sideways along its transported side vectors. */
export function offsetTrack(track: Track, offset: number): Track {
  const positions = track.positions.map((pos, i) =>
    pos.clone().addScaledVector(track.sides[i], offset),
  );
  let arc = 0;
  for (let i = 1; i < positions.length; i++) arc += positions[i].distanceTo(positions[i - 1]);
  return { ...track, positions, arcLength: arc };
}

/** O(1) frame lookup; runs for every block every frame, so no allocation. */
export function sampleFrame(
  track: Track,
  u: number,
  outPos: THREE.Vector3,
  outTan: THREE.Vector3,
  outUp: THREE.Vector3,
  outSide: THREE.Vector3,
): void {
  const f = Math.min(Math.max(u, 0), 1) * 400;
  const i = Math.min(Math.floor(f), 399);
  const k = f - i;
  outPos.lerpVectors(track.positions[i], track.positions[i + 1], k);
  outTan.lerpVectors(track.tangents[i], track.tangents[i + 1], k).normalize();
  outUp.lerpVectors(track.ups[i], track.ups[i + 1], k).normalize();
  outSide.lerpVectors(track.sides[i], track.sides[i + 1], k).normalize();
}
