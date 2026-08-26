/**
 * The shared shader vocabulary. One hash, one value noise, one fbm, and the
 * coverage field that decides where moss exists; the shells, the plants and
 * the fresh-growth tinting all read the same field, which is why every
 * layer of vegetation agrees about where the green is.
 */

export const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.17 + 11.3; a *= 0.5; }
  return s / 0.875;
}
`;

/**
 * Where moss exists on a block, as a signed field swept positive by growth.
 * The noise is SUBTRACTED, so low-noise pockets green up first and the
 * carpet creeps in patches instead of fading in evenly; the edge term makes
 * it advance from one end of the block.
 */
export const COVERAGE_GLSL = /* glsl */ `
uniform float uNoiseScale;
uniform float uNoiseWarp;
uniform float uNoiseDetail;
uniform float uSpread;
uniform float uEdgeBias;
uniform float uBlockLen;

float coverage(vec3 lp, float growth, float seed) {
  vec3 q = lp * uNoiseScale + seed * 7.31;
  vec3 w = vec3(vnoise(q * 1.7 + 3.1), vnoise(q * 1.7 + 7.7), vnoise(q * 1.7 + 13.2)) - 0.5;
  q += w * uNoiseWarp;
  float n = fbm(q);
  n += (vnoise(q * 5.0) - 0.5) * uNoiseDetail;
  float edgePen = (0.5 - lp.x / max(uBlockLen, 1e-4)) * uEdgeBias;
  return growth * (1.0 + uSpread) - n * uSpread - max(edgePen, 0.0);
}
`;
