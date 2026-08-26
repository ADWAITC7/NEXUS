/**
 * Every dial of the scene, with the tuning that produces the shipped
 * look. `?lite` drops resolution, shell count and plant density for slow
 * machines; individual overrides ride the same query string.
 */

export interface Params {
  // Track
  trackCount: number;
  spacing: number;
  angle: number;
  bendAmp: number;
  bendFreq: number;
  depthAmp: number;
  trackLength: number;
  offsetX: number;
  offsetY: number;
  // Blocks
  speed: number;
  blockLength: number;
  widthMult: number;
  blockHeight: number;
  gap: number;
  bevel: number;
  // Growth zone
  zoneStart: number;
  zoneEnd: number;
  spread: number;
  noiseScale: number;
  noiseWarp: number;
  noiseDetail: number;
  edgeBias: number;
  // Moss
  shellCount: number;
  mossHeight: number;
  lumpScale: number;
  strandDensity: number;
  aoStrength: number;
  mossVariety: number;
  // Plants
  sprigCount: number;
  sprigHeight: number;
  sprigTilt: number;
  windAmp: number;
  windSpeed: number;
  plantVariety: number;
  // Vines
  vineCount: number;
  vineOffset: number;
  vineCoils: number;
  vineThickness: number;
  vineTipThickness: number;
  vineTipTaper: number;
  vineClearance: number;
  vineTipU: number;
  vineLean: number;
  vineWobble: number;
  vineIrregular: number;
  vineLeafCount: number;
  vineLeafSize: number;
  vineKnobSize: number;
  vineConverge: number;
  vineTipGap: number;
  vineLift: number;
  vineSheen: number;
  vineBump: number;
  vineBranchCount: number;
  vineBranchLen: number;
  vineBranchWander: number;
  vineBranchThickness: number;
  // Camera & light
  fov: number;
  camDist: number;
  camYaw: number;
  camPitch: number;
  parallax: number;
  keyIntensity: number;
  lightAz: number;
  lightEl: number;
  shadowSoftness: number;
  groundY: number;
  groundShadow: number;
  groundBlur: number;
  exposure: number;
  envIntensity: number;
  envRotY: number;
  // Perf
  dpr: number;
}

export const DEFAULTS: Params = {
  trackCount: 4,
  spacing: 0.5,
  angle: 38,
  bendAmp: 1.5,
  bendFreq: 0.85,
  depthAmp: 3.45,
  trackLength: 17,
  offsetX: 0.3,
  offsetY: 1.2,

  speed: 0.51,
  blockLength: 1.03,
  widthMult: 0.74,
  blockHeight: 0.3,
  gap: 0.42,
  bevel: 0.043,

  zoneStart: 0.55,
  zoneEnd: 0.71,
  spread: 1,
  noiseScale: 12,
  noiseWarp: 3,
  noiseDetail: 1.5,
  edgeBias: 0.57,

  shellCount: 13,
  mossHeight: 0.03,
  lumpScale: 8,
  strandDensity: 80,
  aoStrength: 0.3,
  mossVariety: 1,

  sprigCount: 1000,
  sprigHeight: 0.05,
  sprigTilt: 0.37,
  windAmp: 0.035,
  windSpeed: 1.2,
  plantVariety: 1,

  vineCount: 4,
  vineOffset: 2.5,
  vineCoils: 1,
  vineThickness: 0.055,
  vineTipThickness: 0.005,
  vineTipTaper: 0.5,
  vineClearance: 0.48,
  vineTipU: 0.71,
  vineLean: 1.6,
  vineWobble: 0.125,
  vineIrregular: 1.1,
  vineLeafCount: 160,
  vineLeafSize: 0.355,
  vineKnobSize: 0.08,
  vineConverge: 1,
  vineTipGap: 1,
  vineLift: 0,
  vineSheen: 0.3,
  vineBump: 2.65,
  vineBranchCount: 4,
  vineBranchLen: 1.45,
  vineBranchWander: 0.55,
  vineBranchThickness: 0.11,

  fov: 33,
  camDist: 12.5,
  camYaw: 41,
  camPitch: -9.5,
  parallax: 1.5,
  keyIntensity: 4.6,
  lightAz: -31,
  lightEl: 85,
  shadowSoftness: 9.5,
  groundY: -3.25,
  groundShadow: 0.84,
  groundBlur: 3,
  exposure: 1.1,
  envIntensity: 0.55,
  envRotY: 4.76,

  dpr: 1.75,
};

export const COLORS = {
  background: '#d1d1d1',
  bgSpotA: '#cfe9b4',
  bgSpotB: '#dfdab9',
  bgSpotC: '#cee6b6',
  blockGloss: '#dde3d2',
  mossDeep: '#3a4519',
  mossBright: '#7f8f2e',
  mossFresh: '#b9c44f',
  mossDry: '#6f6136',
  sprigBase: '#98c059',
  sprigTip: '#a4b23f',
  vineBark: '#3a5110',
  vineTip: '#8fae4a',
} as const;

export function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const p = { ...DEFAULTS };
  if (q.has('lite')) {
    p.dpr = 0.5;
    p.shellCount = 8;
    p.sprigCount = 100;
  }
  const num = (key: string): number | null => {
    const v = q.get(key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dpr = num('qdpr');
  if (dpr !== null) p.dpr = dpr;
  const shells = num('qshells');
  if (shells !== null) p.shellCount = Math.max(2, Math.round(shells));
  const sprigs = num('qsprigs');
  if (sprigs !== null) p.sprigCount = Math.max(0, Math.round(sprigs));
  return p;
}
