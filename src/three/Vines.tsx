import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, type Params } from '../params';
import { mulberry32, sampleFrame, smootherstep, type Track } from '../lib/track';
import { vineLeafGeometry, leafTexture, barkTexture } from '../lib/geometry';

/**
 * The vines: tubes whose vertices are re-skinned on the CPU every frame.
 *
 * That expense buys what no static mesh can. The helix angle unwinds with
 * the distance the belt has travelled, so the whole vine screws forward
 * around the passing blocks. The wobble, the radius lumps and the bark
 * pattern are all anchored to that same travelled distance, so the surface
 * flows WITH the motion instead of swimming against it. Leaves, their nodes
 * and the side twigs all recycle along the tube parametrically, born tiny at
 * the tip and grown by the time they reach the root, exactly like the blocks'
 * own loop.
 *
 * Everything here is a pure function of one number: the belt distance. There
 * is no timeline to drift and no reset event to miss.
 */

const RINGS = 521;
const SEGMENTS = 9;
const BRANCH_RINGS = 27;
const BRANCH_SEGMENTS = 5;

/* Two gains the reference bundle did not surrender: the knob dial and the
   twig dial are both expressed relative to the stem radius, but the constant
   that turns them into world units was not recoverable. Both are tuned so a
   node just clears the bark and a twig starts at roughly half the stem. */
const KNOB_GAIN = 3;
const BRANCH_GAIN = 4;

interface LeafDef {
  s0: number;
  size: number;
  angOff: number;
  droop: number;
  twist: number;
  phase: number;
  growVar: number;
}

interface BranchDef {
  s0: number;
  growVar: number;
  local: Float32Array;
  geo: THREE.BufferGeometry;
  centers: THREE.Vector3[];
  radii: Float32Array;
  phases: Float32Array;
  seedNormal: THREE.Vector3;
}

/** A ring-grid tube: dynamic position and normal, static uv and index. */
function makeTubeGeometry(rings: number, segments: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(rings * segments * 3);
  const normals = new Float32Array(rings * segments * 3);
  const uvs = new Float32Array(rings * segments * 2);
  const indices: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      uvs[(i * segments + s) * 2] = i / (rings - 1);
      uvs[(i * segments + s) * 2 + 1] = s / segments;
      if (i < rings - 1) {
        const a = i * segments + s;
        const b = i * segments + ((s + 1) % segments);
        const c = (i + 1) * segments + s;
        const d = (i + 1) * segments + ((s + 1) % segments);
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const nrmAttr = new THREE.BufferAttribute(normals, 3);
  nrmAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', nrmAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  // Rebuilt every frame; a recomputed bound would always be one frame stale.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return geo;
}

export function Vines({
  p,
  track,
  laneSpan,
  belt,
}: {
  p: Params;
  track: Track;
  laneSpan: number;
  belt: { current: number };
}) {
  const barkTex = useMemo(() => barkTexture(), []);

  const built = useMemo(() => {
    const vines = Array.from({ length: p.vineCount }, (_, vi) => {
      const geo = makeTubeGeometry(RINGS, SEGMENTS);
      const rng = mulberry32(4517 + vi * 7919);

      /* Leaves alternate to opposite sides of the stem at roughly 63 degrees
         off the outward direction. Random full-circle angles look like debris
         blown onto a stick; two alternating ranks look like a plant. */
      const leaves: LeafDef[] = Array.from({ length: p.vineLeafCount }, (_, li) => ({
        s0: (li + 0.12 + rng() * 0.76) / Math.max(p.vineLeafCount, 1),
        angOff: (li % 2 === 0 ? 1 : -1) * (1.1 + (rng() - 0.5) * 0.7),
        droop: 0.35 + rng() * 0.55,
        size: 0.55 + rng() * 0.9,
        growVar: 0.45 + rng() * 0.7,
        twist: (rng() - 0.5) * 0.9,
        phase: rng() * Math.PI * 2,
      }));

      /* Side twigs: a short random walk smoothed into a curve, stored in the
         anchor's local frame. Each one unrolls from a nub to a full curl as
         it drifts from the tip toward the root, then wraps and respawns. */
      const branches: BranchDef[] = Array.from({ length: p.vineBranchCount }, (_, bi) => {
        const brng = mulberry32(9000 + bi * 61 + vi * 3331);
        const s0 = brng();
        const dir = new THREE.Vector3(
          (brng() - 0.5) * 0.9,
          0.8 + brng() * 0.4,
          (brng() - 0.5) * 0.9,
        ).normalize();
        const stepLen = p.vineBranchLen / 6;
        const pts = [new THREE.Vector3()];
        const cur = new THREE.Vector3();
        for (let e = 0; e < 7; e++) {
          dir.x += (brng() - 0.5) * p.vineBranchWander * 2.2;
          dir.y += (brng() - 0.5) * p.vineBranchWander * 2.2 + 0.1 * e;
          dir.z += (brng() - 0.5) * p.vineBranchWander * 2.2;
          dir.normalize();
          cur.addScaledVector(dir, stepLen);
          pts.push(cur.clone());
        }
        const sampled = new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(
          BRANCH_RINGS - 1,
        );
        const local = new Float32Array(BRANCH_RINGS * 3);
        for (let e = 0; e < BRANCH_RINGS; e++) {
          local[e * 3] = sampled[e].x;
          local[e * 3 + 1] = sampled[e].y;
          local[e * 3 + 2] = sampled[e].z;
        }
        return {
          s0,
          growVar: 0.5 + brng() * 0.7,
          local,
          geo: makeTubeGeometry(BRANCH_RINGS, BRANCH_SEGMENTS),
          centers: Array.from({ length: BRANCH_RINGS }, () => new THREE.Vector3()),
          radii: new Float32Array(BRANCH_RINGS),
          phases: new Float32Array(BRANCH_RINGS),
          seedNormal: new THREE.Vector3(0, 0, 1),
        };
      });

      /* One bark material PER VINE. They share a compiled program, but each
         needs its own uDistM or all four show the same frozen grain. */
      const barkUniforms = {
        uBark: { value: new THREE.Color(COLORS.vineBark) },
        uTip: { value: new THREE.Color(COLORS.vineTip) },
        uDistM: { value: 0 },
        uCoverLen: { value: 1 },
        uColorVar: { value: 1 },
      };
      const barkMat = new THREE.MeshStandardMaterial({
        color: COLORS.vineBark,
        roughness: 0.85,
        metalness: 0,
        bumpMap: barkTex,
        bumpScale: 0.35 * p.vineBump,
        roughnessMap: barkTex,
      });
      barkMat.envMapIntensity = p.vineSheen;
      /* Required, and not optional just because bumpMap is present: three
         declares a SEPARATE varying per map slot (vBumpMapUv and friends)
         and only emits `vUv` when USE_UV is defined. Without this the
         injected bark shader below references an undeclared vUv and the
         whole fragment program fails to compile. */
      barkMat.defines = { USE_UV: '' };
      barkMat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, barkUniforms);
        shader.fragmentShader =
          `uniform vec3 uBark;\nuniform vec3 uTip;\nuniform float uDistM;\nuniform float uCoverLen;\nuniform float uColorVar;\n` +
          /* glsl */ `
          float vineHash(vec2 p) {
            p = fract(p * vec2(157.31, 411.79));
            p += dot(p, p + 43.17);
            return fract(p.x * p.y);
          }
          float vnoise2(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = vineHash(i);
            float b = vineHash(i + vec2(1, 0));
            float c = vineHash(i + vec2(0, 1));
            float d = vineHash(i + vec2(1, 1));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          ` +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            /* glsl */ `
            #include <color_fragment>
            {
              // Gradient stretched along the stem so the body reads as sage
              // rather than going fully dark within the first third.
              diffuseColor.rgb = mix(uTip, uBark, smoothstep(0.02, 0.55, vUv.x));
              diffuseColor.rgb *= 0.94 + 0.06 * sin(vUv.y * 18.85);
              float vineMc = vUv.x * uCoverLen - uDistM;
              float vn1 = vnoise2(vec2(vineMc * 1.2, vUv.y * 3.0));
              float vn2 = vnoise2(vec2(vineMc * 5.0 + 7.0, vUv.y * 6.0));
              diffuseColor.rgb *= 1.0 + ((vn1 - 0.5) * 1.1 + (vn2 - 0.5) * 0.5) * uColorVar;
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.78, 0.58),
                                     smoothstep(0.62, 0.9, vn1) * uColorVar * 0.7);
            }
            `,
          );
      };
      barkMat.customProgramCacheKey = () => 'vine-stem-v3';
      barkMat.name = `vine-stem-${vi}`;

      return {
        geo,
        leaves,
        branches,
        barkUniforms,
        barkMat,
        seedNormal: new THREE.Vector3(0, 0, 1),
        centers: Array.from({ length: RINGS }, () => new THREE.Vector3()),
        outward: Array.from({ length: RINGS }, () => new THREE.Vector3()),
        frameT: new Float32Array(RINGS * 3),
        radii: new Float32Array(RINGS),
        phases: new Float32Array(RINGS),
        lean: new THREE.Vector3(),
      };
    });

    const leafGeo = vineLeafGeometry();
    const knobGeo = new THREE.SphereGeometry(1, 8, 6);
    knobGeo.scale(1.3, 0.95, 0.95);
    return { vines, leafGeo, knobGeo };
  }, [p, barkTex]);

  const leafMat = useMemo(() => {
    const tex = leafTexture();
    /* White base: the pale texture carries only value and veins, and the
       per-instance tint supplies the green. Clearcoat is what gives the
       waxy highlight that separates a leaf from a paper cutout. */
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: tex,
      bumpMap: tex,
      bumpScale: 0.6,
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
      side: THREE.DoubleSide,
    });
    /* Held back from full strength: at 1.0 the studio environment stacks on
       top of a 4.6-intensity key and every leaf facing the light clips to
       white, losing the tint the instance colours just supplied. */
    m.envMapIntensity = 0.6;
    m.name = 'vine-leaf';
    return m;
  }, []);

  // Nodes and twigs share one material, a shade under the bark so the buds
  // read as darker beads against the stem rather than lighter ones.
  const knobMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(COLORS.vineBark).multiplyScalar(0.92),
      roughness: 0.9,
    });
    m.name = 'vine-node';
    return m;
  }, []);

  const leafRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const knobRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  // Leaf colour variety is static; write it once per mesh.
  useEffect(() => {
    built.vines.forEach((vine, vi) => {
      const mesh = leafRefs.current[vi];
      if (!mesh) return;
      const rng = mulberry32(211 + vi * 31);
      const c = new THREE.Color();
      for (let i = 0; i < vine.leaves.length; i++) {
        /* The colour space argument is load-bearing. setHSL defaults to the
           WORKING space, which is linear, so a lightness of 0.4 would display
           at about 0.66 and wash every leaf out to mint. These are sRGB
           readings and have to be declared as such. */
        c.setHSL(
          0.24 + (rng() - 0.5) * 0.05,
          0.5 + rng() * 0.15,
          0.32 + rng() * 0.16,
          THREE.SRGBColorSpace,
        );
        mesh.setColorAt(i, c);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [built]);

  useEffect(
    () => () => {
      for (const vine of built.vines) {
        vine.geo.dispose();
        vine.barkMat.dispose();
        for (const br of vine.branches) br.geo.dispose();
      }
      built.leafGeo.dispose();
      built.knobGeo.dispose();
      leafMat.map?.dispose();
      leafMat.dispose();
      knobMat.dispose();
    },
    [built, leafMat, knobMat],
  );

  useEffect(() => () => barkTex.dispose(), [barkTex]);

  const scratch = useMemo(
    () => ({
      gp: new THREE.Vector3(),
      gt: new THREE.Vector3(),
      gu: new THREE.Vector3(),
      gs: new THREE.Vector3(),
      o: new THREE.Vector3(),
      leanTarget: new THREE.Vector3(),
      T: new THREE.Vector3(),
      N: new THREE.Vector3(),
      B: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      m: new THREE.Matrix4(),
      rot: new THREE.Matrix4(),
      prevT: new THREE.Vector3(),
      x: new THREE.Vector3(),
      y: new THREE.Vector3(),
      z: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
      iC: new THREE.Vector3(),
      iT: new THREE.Vector3(),
      lp: new THREE.Vector3(),
      bx: new THREE.Vector3(),
      by: new THREE.Vector3(),
      bz: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((state, dt) => {
    const time = state.clock.elapsedTime;
    const pointer = state.pointer;
    const beltD = belt.current;
    const coverLen = Math.max(track.arcLength * (1 - p.vineTipU), 0.5);
    // Lateral reach clears the OUTER lane, not the lane centreline.
    const R = laneSpan / 2 + (p.spacing * p.widthMult) / 2 + p.vineClearance;
    const Rv = p.blockHeight * 0.75 + p.vineClearance;
    const lift = p.vineLift * p.blockHeight * 0.5;
    const knobBase = p.vineThickness * p.vineKnobSize * KNOB_GAIN;
    const branchBase = p.vineThickness * p.vineBranchThickness * BRANCH_GAIN;

    // The screw: one term, and the reason the vine reads as alive.
    const screw = (beltD / coverLen) * p.vineCoils * Math.PI * 2;

    built.vines.forEach((vine, vi) => {
      const d = beltD + vi * p.vineOffset;
      vine.barkUniforms.uDistM.value = d;
      vine.barkUniforms.uCoverLen.value = coverLen;

      const { gp, gt, gu, gs, o, leanTarget } = scratch;

      leanTarget.set(
        pointer.x * p.vineLean + Math.sin(time * 0.6) * 0.07,
        pointer.y * p.vineLean * 0.9 + Math.cos(time * 0.83) * 0.05,
        0.2 * p.vineLean,
      );
      vine.lean.lerp(leanTarget, 1 - Math.exp(-5 * dt));

      /* The four vines bundle together near the tip and fan apart toward the
         root. Evenly spaced phases the whole way down read as four parallel
         garlands instead of one rope unwinding. */
      const fan = vi * (p.vineOffset / coverLen) * p.vineCoils * Math.PI * 2;
      const tipStagger = vi * (p.vineTipGap / Math.max(R, 0.2));

      for (let i = 0; i < RINGS; i++) {
        const n = i / (RINGS - 1);
        sampleFrame(track, p.vineTipU + n * (1 - p.vineTipU), gp, gt, gu, gs);
        const spread = tipStagger + fan * smootherstep(0, p.vineConverge, n);
        const ang = n * p.vineCoils * Math.PI * 2 - screw + spread;
        // Material coordinate: travels with the belt, so the surface flows.
        const f = n * coverLen - d;
        const wobX = Math.sin(f * 1.35 + 0.7) * p.vineWobble;
        const wobY = Math.cos(f * 1.9 + 2.3) * p.vineWobble * 0.8;

        o.set(0, 0, 0)
          .addScaledVector(gs, Math.cos(ang) * R + wobX)
          .addScaledVector(gu, Math.sin(ang) * Rv + wobY);
        vine.outward[i].copy(o).normalize();

        const cursorFall = Math.max(0, 1 - n / 0.32) ** 2;
        vine.centers[i]
          .copy(gp)
          .add(o)
          .addScaledVector(gu, lift)
          .addScaledVector(vine.lean, cursorFall);

        const taper =
          p.vineTipThickness +
          (p.vineThickness - p.vineTipThickness) * smootherstep(0.004, p.vineTipTaper, n);
        vine.radii[i] =
          taper * (0.82 + 0.13 * Math.sin(f * 1.9 + 1.3) + 0.09 * Math.sin(f * 4.3 + 0.4));
        vine.phases[i] = f * 2.6;
      }

      skinTube(
        vine.geo,
        vine.centers,
        vine.radii,
        vine.phases,
        p.vineIrregular,
        vine.seedNormal,
        scratch,
        RINGS,
        SEGMENTS,
        vine.frameT,
      );

      /* Leaves and their nodes recycle: born at the tip, grown by the root,
         wrapping past the end and starting again. */
      const leafMesh = leafRefs.current[vi];
      const knobMesh = knobRefs.current[vi];
      for (let i = 0; i < vine.leaves.length; i++) {
        const leaf = vine.leaves[i];
        const n = (leaf.s0 + d / coverLen) % 1;
        const radius = sampleTube(vine, n, scratch);
        const grow =
          smootherstep(0.004, 0.07, n) * (0.28 + 0.72 * Math.pow(n, leaf.growVar));
        const size = p.vineLeafSize * leaf.size * grow;

        if (leafMesh) {
          if (size < 1e-4) {
            scratch.m.makeScale(0, 0, 0);
          } else {
            placeLeaf(leaf, radius, size, time, p, scratch);
          }
          leafMesh.setMatrixAt(i, scratch.m);
        }
        if (knobMesh) {
          const ks = knobBase * smootherstep(0.004, 0.05, n);
          if (ks < 1e-5) {
            scratch.m.makeScale(0, 0, 0);
          } else {
            // Node sits at the leaf's base, aligned to the stem.
            scratch.bx.crossVectors(scratch.iT, scratch.iC).normalize();
            scratch.m
              .makeBasis(scratch.iT, scratch.iC, scratch.bx)
              .setPosition(
                scratch.pos.copy(scratch.anchor).addScaledVector(scratch.iC, radius * 0.85),
              )
              .scale(scratch.scale.set(ks, ks, ks));
          }
          knobMesh.setMatrixAt(i, scratch.m);
        }
      }
      if (leafMesh) leafMesh.instanceMatrix.needsUpdate = true;
      if (knobMesh) knobMesh.instanceMatrix.needsUpdate = true;

      // Side twigs: same recycle, but they unroll as they age.
      for (const br of vine.branches) {
        const n = (br.s0 + d / coverLen) % 1;
        const radius = sampleTube(vine, n, scratch);
        const fade = smootherstep(0.01, 0.08, n);
        const grow = fade * (0.25 + 0.75 * Math.pow(n, br.growVar));
        const unrolled = Math.max(grow * (BRANCH_RINGS - 1), 0.001);

        // Anchor frame: along-tube, outward, and their cross product.
        scratch.by.copy(scratch.iC);
        scratch.bx
          .copy(scratch.iT)
          .addScaledVector(scratch.by, -scratch.iT.dot(scratch.by));
        if (scratch.bx.lengthSq() < 1e-10) scratch.bx.set(1, 0, 0);
        scratch.bx.normalize();
        scratch.bz.crossVectors(scratch.bx, scratch.by);
        scratch.pos.copy(scratch.anchor).addScaledVector(scratch.by, radius * 0.4);

        for (let e = 0; e < BRANCH_RINGS; e++) {
          const k = Math.min(e, unrolled);
          const ri = Math.min(Math.floor(k), BRANCH_RINGS - 2);
          const fr = k - ri;
          const lx = br.local[ri * 3] + (br.local[(ri + 1) * 3] - br.local[ri * 3]) * fr;
          const ly =
            br.local[ri * 3 + 1] + (br.local[(ri + 1) * 3 + 1] - br.local[ri * 3 + 1]) * fr;
          const lz =
            br.local[ri * 3 + 2] + (br.local[(ri + 1) * 3 + 2] - br.local[ri * 3 + 2]) * fr;
          br.centers[e]
            .copy(scratch.pos)
            .addScaledVector(scratch.bx, lx)
            .addScaledVector(scratch.by, ly)
            .addScaledVector(scratch.bz, lz);
          br.radii[e] = Math.max(
            branchBase * (1 - (k / Math.max(unrolled, 1)) * 0.8) * fade,
            0.0015,
          );
        }
        skinTube(
          br.geo,
          br.centers,
          br.radii,
          br.phases,
          0,
          br.seedNormal,
          scratch,
          BRANCH_RINGS,
          BRANCH_SEGMENTS,
        );
      }
    });
  });

  return (
    <group>
      {built.vines.map((vine, vi) => (
        <group key={vi}>
          <mesh geometry={vine.geo} material={vine.barkMat} castShadow frustumCulled={false} />
          {vine.branches.map((br, bi) => (
            <mesh
              key={bi}
              geometry={br.geo}
              material={knobMat}
              receiveShadow
              frustumCulled={false}
            />
          ))}
          <instancedMesh
            ref={(mesh) => {
              leafRefs.current[vi] = mesh;
            }}
            args={[built.leafGeo, leafMat, vine.leaves.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={(mesh) => {
              knobRefs.current[vi] = mesh;
            }}
            args={[built.knobGeo, knobMat, vine.leaves.length]}
            frustumCulled={false}
          />
        </group>
      ))}
    </group>
  );
}

interface VineState {
  centers: THREE.Vector3[];
  outward: THREE.Vector3[];
  frameT: Float32Array;
  radii: Float32Array;
}

type Scratch = {
  T: THREE.Vector3;
  N: THREE.Vector3;
  B: THREE.Vector3;
  dir: THREE.Vector3;
  m: THREE.Matrix4;
  rot: THREE.Matrix4;
  prevT: THREE.Vector3;
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  pos: THREE.Vector3;
  scale: THREE.Vector3;
  gp: THREE.Vector3;
  gt: THREE.Vector3;
  gu: THREE.Vector3;
  gs: THREE.Vector3;
  o: THREE.Vector3;
  leanTarget: THREE.Vector3;
  anchor: THREE.Vector3;
  iC: THREE.Vector3;
  iT: THREE.Vector3;
  lp: THREE.Vector3;
  bx: THREE.Vector3;
  by: THREE.Vector3;
  bz: THREE.Vector3;
};

/**
 * Read the skinned tube at a fractional position, writing anchor / outward /
 * tangent into scratch and returning the radius there.
 *
 * Interpolating between rings rather than rounding to the nearest one is what
 * stops leaves and twigs from stair-stepping visibly as they slide along a
 * 521-ring tube.
 */
function sampleTube(vine: VineState, n: number, s: Scratch): number {
  const r = Math.min(Math.max(n, 0), 1) * (RINGS - 1);
  const i = Math.min(Math.floor(r), RINGS - 2);
  const a = r - i;
  s.anchor.lerpVectors(vine.centers[i], vine.centers[i + 1], a);
  s.iC.lerpVectors(vine.outward[i], vine.outward[i + 1], a);
  if (s.iC.lengthSq() < 1e-12) s.iC.copy(vine.outward[i]);
  s.iC.normalize();
  const j = i * 3;
  const k = (i + 1) * 3;
  s.iT.set(
    vine.frameT[j] + (vine.frameT[k] - vine.frameT[j]) * a,
    vine.frameT[j + 1] + (vine.frameT[k + 1] - vine.frameT[j + 1]) * a,
    vine.frameT[j + 2] + (vine.frameT[k + 2] - vine.frameT[j + 2]) * a,
  );
  if (s.iT.lengthSq() < 1e-12) s.iT.set(0, 1, 0);
  s.iT.normalize();
  return vine.radii[i] + (vine.radii[i + 1] - vine.radii[i]) * a;
}

/**
 * Skin a ring grid around a centreline with a persistent transported normal.
 *
 * The carried normal survives between frames, so the tube's twist cannot pop
 * when the curve moves. The cross-section is made non-circular by low-order
 * angular harmonics whose phase scrolls with travelled distance.
 */
function skinTube(
  geo: THREE.BufferGeometry,
  centers: THREE.Vector3[],
  radii: Float32Array,
  phases: Float32Array,
  irregular: number,
  seedNormal: THREE.Vector3,
  s: Scratch,
  rings: number,
  segments: number,
  outFrameT?: Float32Array,
): void {
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrmAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
  const pos = posAttr.array as Float32Array;
  const nrm = nrmAttr.array as Float32Array;
  const { T, N, B, dir, prevT } = s;

  /* The carried normal is persistent, so a single degenerate ring (tangent
     momentarily parallel to the normal, or two coincident centres) would
     write NaN into it and poison every later frame. Both collapses are
     caught and rebuilt instead of normalised into NaN. */
  if (
    !Number.isFinite(seedNormal.x + seedNormal.y + seedNormal.z) ||
    seedNormal.lengthSq() < 1e-10
  ) {
    seedNormal.set(0, 0, 1);
  }
  N.copy(seedNormal);
  prevT.set(0, 0, 0);
  for (let i = 0; i < rings; i++) {
    const prev = centers[Math.max(0, i - 1)];
    const next = centers[Math.min(rings - 1, i + 1)];
    T.subVectors(next, prev);
    if (T.lengthSq() > 1e-12) T.normalize();
    else if (prevT.lengthSq() > 0) T.copy(prevT);
    else T.set(0, 1, 0);
    prevT.copy(T);
    if (outFrameT) {
      outFrameT[i * 3] = T.x;
      outFrameT[i * 3 + 1] = T.y;
      outFrameT[i * 3 + 2] = T.z;
    }
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-10) {
      N.set(0, 1, 0).addScaledVector(T, -T.y);
      if (N.lengthSq() < 1e-10) N.set(1, 0, 0).addScaledVector(T, -T.x);
    }
    N.normalize();
    if (i === 0) seedNormal.copy(N);
    B.crossVectors(T, N);

    for (let seg = 0; seg < segments; seg++) {
      const a = (seg / segments) * Math.PI * 2;
      dir
        .set(0, 0, 0)
        .addScaledVector(N, Math.cos(a))
        .addScaledVector(B, Math.sin(a));
      const r =
        radii[i] *
        (irregular
          ? 1 +
            irregular *
              (0.38 * Math.sin(2 * a + phases[i]) +
                0.3 * Math.sin(3 * a - phases[i] * 1.7) +
                0.18 * Math.sin(5 * a + phases[i] * 0.6)) *
              0.2
          : 1);
      const idx = (i * segments + seg) * 3;
      nrm[idx] = dir.x;
      nrm[idx + 1] = dir.y;
      nrm[idx + 2] = dir.z;
      pos[idx] = centers[i].x + dir.x * r;
      pos[idx + 1] = centers[i].y + dir.y * r;
      pos[idx + 2] = centers[i].z + dir.z * r;
    }
  }
  posAttr.needsUpdate = true;
  nrmAttr.needsUpdate = true;
}

/**
 * Compose a leaf matrix from the frame already written into scratch by
 * sampleTube.
 *
 * The leaf's up axis swings out from the stem at its own fixed angle, then is
 * pulled DOWN in world space. Drooping along the tube instead (as a purely
 * local frame would) makes leaves hang sideways or skyward wherever the vine
 * twists, which is the tell of a fake plant.
 */
function placeLeaf(
  leaf: LeafDef,
  radius: number,
  size: number,
  time: number,
  p: Params,
  s: Scratch,
): void {
  const sway = Math.sin(time * p.windSpeed + leaf.phase) * p.windAmp * 1.5;
  s.z.crossVectors(s.iT, s.iC).normalize();
  s.x
    .copy(s.iC)
    .multiplyScalar(Math.cos(leaf.angOff + sway))
    .addScaledVector(s.z, Math.sin(leaf.angOff + sway));
  s.x.y -= leaf.droop;
  if (s.x.lengthSq() < 1e-12) s.x.copy(s.iC);
  s.x.normalize();

  s.y.copy(s.iT).addScaledVector(s.x, -s.x.dot(s.iT));
  if (s.y.lengthSq() < 1e-12) s.y.set(0, 0, 1).addScaledVector(s.x, -s.x.z);
  s.y.normalize().applyAxisAngle(s.x, leaf.twist);
  s.z.crossVectors(s.y, s.x).normalize();

  s.pos.copy(s.anchor).addScaledVector(s.iC, radius * 0.9);
  s.m
    .makeBasis(s.y, s.x, s.z)
    .setPosition(s.pos)
    .scale(s.scale.set(size, size, size));
}
