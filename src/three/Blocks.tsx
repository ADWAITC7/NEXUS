import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import { COLORS, type Params } from '../params';
import { mulberry32, sampleFrame, smootherstep, type Track } from '../lib/track';
import { COVERAGE_GLSL, NOISE_GLSL } from '../lib/glsl';
import { sprigArchetypes } from '../lib/geometry';

/**
 * The conveyor: blocks riding the rail, a moss carpet carved out of shell
 * layers, and a thousand potential plants per block placed on the GPU.
 *
 * The whole loop is the one line in the frame callback:
 * u = (phase + t / arcLength) mod 1. A fixed stretch of the rail is the
 * growth zone; any block crossing it greens over, and wrapping past the end
 * strips it bare again because every visual is a pure function of u. No
 * timeline, no reset event, nothing to drift.
 */

interface BlockDef {
  lane: number;
  phase: number;
  slot: number;
  seed: number;
}

interface SprigSlot {
  archetype: number;
  index: number;
}

const SPRIG_SHARES = [0.55, 0.25, 0.12, 0.08];

export function Blocks({
  p,
  lanes,
  belt,
}: {
  p: Params;
  lanes: Track[];
  belt: { current: number };
}) {
  const glossRef = useRef<THREE.InstancedMesh>(null);
  const shellRef = useRef<THREE.InstancedMesh>(null);
  const sprigRefs = useRef<(THREE.InstancedMesh | null)[]>([null, null, null, null]);

  const built = useMemo(() => {
    const rng = mulberry32(1337);
    const blocks: BlockDef[] = [];
    let slot = 0;
    lanes.forEach((lane, li) => {
      const n = Math.max(2, Math.floor(lane.arcLength / (p.blockLength + p.gap)));
      for (let i = 0; i < n; i++) {
        blocks.push({
          lane: li,
          phase: i / n + (li % 2 ? 0.5 / n : 0),
          slot: slot++,
          seed: rng(),
        });
      }
    });
    const total = blocks.length;

    const width = p.spacing * p.widthMult;
    const blockGeo = new RoundedBoxGeometry(p.blockLength, p.blockHeight, width, 3, p.bevel);

    /* ── Shells: the moss volume, block geometry stacked N deep ──────── */
    const shellGeo = blockGeo.clone();
    const shellTotal = total * p.shellCount;
    const aShell = new Float32Array(shellTotal);
    const aShellSeed = new Float32Array(shellTotal);
    const aShellGrowth = new Float32Array(shellTotal);
    for (let b = 0; b < total; b++) {
      for (let s = 0; s < p.shellCount; s++) {
        aShell[b * p.shellCount + s] = s;
        aShellSeed[b * p.shellCount + s] = blocks[b].seed;
      }
    }
    shellGeo.setAttribute('aShell', new THREE.InstancedBufferAttribute(aShell, 1));
    shellGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aShellSeed, 1));
    const shellGrowthAttr = new THREE.InstancedBufferAttribute(aShellGrowth, 1);
    shellGrowthAttr.setUsage(THREE.DynamicDrawUsage);
    shellGeo.setAttribute('aGrowth', shellGrowthAttr);

    /* ── Sprigs: instanced tufts, placed on block surfaces ───────────── */
    const archetypes = sprigArchetypes();
    const perBlock = p.sprigCount;
    const sprigCounts = SPRIG_SHARES.map((share) => Math.round(perBlock * share));
    const sprigTotalPer = sprigCounts.map((c) => c * total);
    const sprigData = sprigTotalPer.map((count) => ({
      offset: new Float32Array(count * 3),
      axis: new Float32Array(count * 3),
      rand: new Float32Array(count * 4),
      seed: new Float32Array(count),
      growth: new Float32Array(count),
    }));
    /** For every block: which instance slots belong to it, per archetype. */
    const blockSprigs: SprigSlot[][] = blocks.map(() => []);
    const cursor = [0, 0, 0, 0];

    const srng = mulberry32(9241);
    const half = { x: p.blockLength / 2, y: p.blockHeight / 2, z: width / 2 };
    for (let b = 0; b < total; b++) {
      // Plants cluster into a handful of seeded patches per block instead
      // of raining down uniformly; growth in nature is colonial.
      const patches = Array.from({ length: 9 }, () => ({
        x: (srng() * 2 - 1) * half.x * 0.9,
        z: (srng() * 2 - 1) * half.z * 0.9,
      }));
      for (let a = 0; a < 4; a++) {
        for (let k = 0; k < sprigCounts[a]; k++) {
          const i = cursor[a]++;
          const d = sprigData[a];
          const face = srng();
          const patch = patches[Math.floor(srng() * patches.length)];
          const jx = patch.x + (srng() * 2 - 1) * half.x * 0.35;
          const jz = patch.z + (srng() * 2 - 1) * half.z * 0.6;
          let ox = 0, oy = 0, oz = 0, ax = 0, ay = 0, az = 0;
          if (face < 0.8) {
            ox = jx; oy = half.y; oz = jz; ay = 1; // top
          } else if (face < 0.88) {
            ox = jx; oy = (srng() * 2 - 1) * half.y * 0.8; oz = half.z; az = 1;
          } else if (face < 0.96) {
            ox = jx; oy = (srng() * 2 - 1) * half.y * 0.8; oz = -half.z; az = -1;
          } else if (face < 0.98) {
            ox = half.x; oy = (srng() * 2 - 1) * half.y * 0.8; oz = jz; ax = 1;
          } else {
            ox = -half.x; oy = (srng() * 2 - 1) * half.y * 0.8; oz = jz; ax = -1;
          }
          d.offset.set([ox, oy, oz], i * 3);
          d.axis.set([ax, ay, az], i * 3);
          d.rand.set([srng(), srng(), srng(), srng()], i * 4);
          d.seed[i] = blocks[b].seed;
          blockSprigs[b].push({ archetype: a, index: i });
        }
      }
    }

    const sprigGeos = archetypes.map((geo, a) => {
      const g = geo;
      const d = sprigData[a];
      g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(d.offset, 3));
      g.setAttribute('aAxis', new THREE.InstancedBufferAttribute(d.axis, 3));
      g.setAttribute('aRand', new THREE.InstancedBufferAttribute(d.rand, 4));
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(d.seed, 1));
      const growth = new THREE.InstancedBufferAttribute(d.growth, 1);
      growth.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aGrowth', growth);
      return g;
    });

    return { blocks, total, blockGeo, shellGeo, sprigGeos, sprigTotalPer, blockSprigs, width };
  }, [p, lanes]);

  /* ── Materials ─────────────────────────────────────────────────────── */

  const glossMat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: COLORS.blockGloss,
      roughness: 0.18,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.25,
    });
    return m;
  }, []);

  const coverageUniforms = useMemo(
    () => ({
      uNoiseScale: { value: p.noiseScale },
      uNoiseWarp: { value: p.noiseWarp },
      uNoiseDetail: { value: p.noiseDetail },
      uSpread: { value: p.spread },
      uEdgeBias: { value: p.edgeBias },
      uBlockLen: { value: p.blockLength },
    }),
    [p],
  );

  const mossMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
    const uniforms = {
      ...coverageUniforms,
      uShellCount: { value: p.shellCount },
      uMossHeight: { value: p.mossHeight },
      uLumpScale: { value: p.lumpScale },
      uStrandDensity: { value: p.strandDensity },
      uAo: { value: p.aoStrength },
      uMossVar: { value: p.mossVariety },
      uMossDeep: { value: new THREE.Color(COLORS.mossDeep) },
      uMossBright: { value: new THREE.Color(COLORS.mossBright) },
      uMossFresh: { value: new THREE.Color(COLORS.mossFresh) },
      uMossDry: { value: new THREE.Color(COLORS.mossDry) },
    };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader =
        `attribute float aShell;\nattribute float aSeed;\nattribute float aGrowth;\n` +
        `uniform float uShellCount;\nuniform float uMossHeight;\nuniform float uLumpScale;\n` +
        `varying float vMossH;\nvarying vec3 vMossLocal;\nvarying float vMossGrowth;\nvarying float vMossSeed;\n` +
        NOISE_GLSL +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vMossH = aShell / max(uShellCount - 1.0, 1.0);
          vMossLocal = position;
          vMossGrowth = aGrowth;
          vMossSeed = aSeed;
          float mossLump = 0.55 + 0.9 * vnoise(position * uLumpScale + aSeed * 5.13);
          transformed += normal * (vMossH * uMossHeight * mossLump + 0.004);
          `,
        );
      shader.fragmentShader =
        `uniform float uStrandDensity;\nuniform float uAo;\nuniform float uMossVar;\n` +
        `uniform vec3 uMossDeep;\nuniform vec3 uMossBright;\nuniform vec3 uMossFresh;\nuniform vec3 uMossDry;\n` +
        `varying float vMossH;\nvarying vec3 vMossLocal;\nvarying float vMossGrowth;\nvarying float vMossSeed;\n` +
        NOISE_GLSL + COVERAGE_GLSL +
        shader.fragmentShader
          .replace(
            '#include <clipping_planes_fragment>',
            /* glsl */ `
            #include <clipping_planes_fragment>
            float mossC = coverage(vMossLocal, vMossGrowth, vMossSeed);
            if (mossC <= 0.05) discard;
            vec3 mossSp = vMossLocal * uStrandDensity + vMossSeed * 3.71;
            vec3 mossCell = floor(mossSp);
            vec3 mossJit = vec3(hash13(mossCell + 1.3), hash13(mossCell + 2.6), hash13(mossCell + 4.2)) - 0.5;
            vec3 mossRp = fract(mossSp) - 0.5 - mossJit * 0.7;
            float mossStrand = hash13(mossCell);
            float mossSmoothN = vnoise(mossSp * 0.9);
            float mossLocalH = clamp(mossC, 0.0, 1.0) * (0.35 + 0.65 * (0.6 * mossStrand + 0.4 * mossSmoothN));
            if (vMossH > mossLocalH) discard;
            float mossRel = vMossH / max(mossLocalH, 1e-4);
            if (vMossH > 0.1 && length(mossRp) * 1.55 > mix(1.1, 0.4, mossRel)) discard;
            `,
          )
          .replace(
            '#include <color_fragment>',
            /* glsl */ `
            #include <color_fragment>
            {
              float mossTone = hash13(mossCell + 17.0);
              vec3 mossAlbedo = mix(uMossDeep, uMossBright, clamp(vMossH * 0.75 + mossTone * 0.35, 0.0, 1.0));
              float mossDry = smoothstep(0.35, 0.75, fbm(vMossLocal * 1.6 + vMossSeed * 3.1 + 4.7));
              mossAlbedo = mix(mossAlbedo, uMossDry, mossDry * 0.55);
              float mossFreshT = smoothstep(0.45, 0.02, mossC);
              mossAlbedo = mix(mossAlbedo, uMossFresh, mossFreshT * 0.65);
              float mossVarN = fbm(vMossLocal * 3.1 + vMossSeed * 2.7 + 21.0);
              mossAlbedo *= 1.0 + (mossVarN - 0.5) * 1.6 * uMossVar;
              float mossAo = mix(1.0 - uAo, 1.0, vMossH);
              diffuseColor.rgb = mossAlbedo * mossAo;
            }
            `,
          )
          .replace(
            '#include <normal_fragment_begin>',
            /* glsl */ `
            #include <normal_fragment_begin>
            normal = normalize(normal + 0.6 * (vec3(
              vnoise(vMossLocal * 14.0 + vMossSeed),
              vnoise(vMossLocal * 14.0 + vMossSeed + 5.0),
              vnoise(vMossLocal * 14.0 + vMossSeed + 9.0)) - 0.5));
            `,
          );
    };
    m.customProgramCacheKey = () => 'moss-shell';
    return m;
  }, [coverageUniforms, p]);

  const sprigUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uTilt: { value: p.sprigTilt },
      uSprigH: { value: p.sprigHeight },
      uWindAmp: { value: p.windAmp },
      uWindSpeed: { value: p.windSpeed },
      uSprigVar: { value: p.plantVariety },
      uBaseColor: { value: new THREE.Color(COLORS.sprigBase) },
      uTipColor: { value: new THREE.Color(COLORS.sprigTip) },
    }),
    [p],
  );

  const sprigMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    const uniforms = { ...coverageUniforms, ...sprigUniforms };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader =
        `attribute vec3 aOffset;\nattribute vec3 aAxis;\nattribute vec4 aRand;\n` +
        `attribute float aSeed;\nattribute float aGrowth;\n` +
        `uniform float uTime;\nuniform float uTilt;\nuniform float uSprigH;\n` +
        `uniform float uWindAmp;\nuniform float uWindSpeed;\nuniform float uSprigVar;\n` +
        `varying float vSprigY;\nvarying float vSprigTone;\nvarying float vSprigFresh;\nvarying float vSprigShade;\n` +
        NOISE_GLSL + COVERAGE_GLSL +
        /* glsl */ `
        float backout(float x) {
          x = clamp(x, 0.0, 1.0);
          float c1 = 1.70158;
          float c3 = c1 + 1.0;
          float xm = x - 1.0;
          return 1.0 + c3 * xm * xm * xm + c1 * xm * xm;
        }
        ` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          float sprigC = coverage(aOffset, aGrowth, aSeed);
          float sprigThr = 0.22 + aRand.z * 0.65;
          float sprigAppear = smoothstep(sprigThr, sprigThr + 0.2, sprigC);
          float sprigS = backout(sprigAppear);

          vec3 sprigTiltRnd = normalize(vec3(aRand.x - 0.5, aRand.y - 0.5, aRand.w - 0.5) + 1e-3);
          vec3 sprigAxis = normalize(aAxis + sprigTiltRnd * uTilt);
          vec3 sprigHelper = abs(sprigAxis.y) > 0.98 ? vec3(1, 0, 0) : vec3(0, 1, 0);
          vec3 sprigT = normalize(cross(sprigHelper, sprigAxis));
          vec3 sprigB = cross(sprigAxis, sprigT);
          float sprigAng = aRand.x * 6.28318;
          vec3 sprigTr = sprigT * cos(sprigAng) + sprigB * sin(sprigAng);
          vec3 sprigBr = -sprigT * sin(sprigAng) + sprigB * cos(sprigAng);

          // Side-face plants stay stubby so the belt's gaps read clean.
          float sprigScale = uSprigH * (0.4 + 0.8 * aRand.y) * sprigS
                             * mix(0.55, 1.0, clamp(aAxis.y, 0.0, 1.0));
          float sprigSway = sin(uTime * uWindSpeed + aRand.x * 6.2831 + (aOffset.x + aOffset.y) * 2.0)
                            * uWindAmp * position.y * position.y;
          transformed = aOffset
            + sprigTr * (position.x * sprigScale + sprigSway)
            + sprigAxis * (position.y * sprigScale)
            + sprigBr * (position.z * sprigScale);

          vSprigY = clamp(position.y / 1.1, 0.0, 1.0);
          vSprigTone = aRand.w;
          vSprigFresh = smoothstep(0.5, 0.05, sprigC);
          vSprigShade = 1.0 + (vnoise(aOffset * 3.0 + aSeed * 1.9) - 0.5) * 0.8 * uSprigVar;
          `,
        );
      shader.fragmentShader =
        `uniform vec3 uBaseColor;\nuniform vec3 uTipColor;\n` +
        `varying float vSprigY;\nvarying float vSprigTone;\nvarying float vSprigFresh;\nvarying float vSprigShade;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          /* glsl */ `
          #include <color_fragment>
          {
            vec3 sprigAlbedo = mix(uBaseColor, uTipColor, pow(vSprigY, 1.6) * (0.6 + 0.4 * vSprigTone));
            sprigAlbedo = mix(sprigAlbedo, uTipColor * 1.1, vSprigFresh * 0.35);
            diffuseColor.rgb = sprigAlbedo * (0.45 + 0.5 * vSprigY) * vSprigShade;
          }
          `,
        );
    };
    m.customProgramCacheKey = () => 'sprig-tuft';
    return m;
  }, [coverageUniforms, sprigUniforms]);

  useEffect(
    () => () => {
      built.blockGeo.dispose();
      built.shellGeo.dispose();
      for (const g of built.sprigGeos) g.dispose();
      glossMat.dispose();
      mossMat.dispose();
      sprigMat.dispose();
    },
    [built, glossMat, mossMat, sprigMat],
  );

  /* ── The belt ──────────────────────────────────────────────────────── */

  const scratch = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      arr: new Float32Array(16),
      pos: new THREE.Vector3(),
      tan: new THREE.Vector3(),
      up: new THREE.Vector3(),
      side: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((state) => {
    const gloss = glossRef.current;
    const shell = shellRef.current;
    if (!gloss || !shell) return;

    // Advanced by BeltClock, never here: the vines read the same number.
    const t = belt.current;
    const { m, arr, pos, tan, up, side } = scratch;

    const shellGrowth = built.shellGeo.getAttribute('aGrowth') as THREE.InstancedBufferAttribute;
    const sprigGrowths = built.sprigGeos.map(
      (g) => g.getAttribute('aGrowth') as THREE.InstancedBufferAttribute,
    );
    const sprigMeshes = sprigRefs.current;

    for (const block of built.blocks) {
      const lane = lanes[block.lane];
      const u = (((block.phase + t / lane.arcLength) % 1) + 1) % 1;
      sampleFrame(lane, u, pos, tan, up, side);
      m.makeBasis(tan, up, side).setPosition(pos);
      m.toArray(arr);

      (gloss.instanceMatrix.array as Float32Array).set(arr, block.slot * 16);
      for (let s = 0; s < p.shellCount; s++) {
        (shell.instanceMatrix.array as Float32Array).set(arr, (block.slot * p.shellCount + s) * 16);
      }

      const growth = smootherstep(p.zoneStart, p.zoneEnd, u);
      (shellGrowth.array as Float32Array).fill(
        growth,
        block.slot * p.shellCount,
        (block.slot + 1) * p.shellCount,
      );
      for (const s of built.blockSprigs[block.slot]) {
        const mesh = sprigMeshes[s.archetype];
        if (mesh) (mesh.instanceMatrix.array as Float32Array).set(arr, s.index * 16);
        (sprigGrowths[s.archetype].array as Float32Array)[s.index] = growth;
      }
    }

    gloss.instanceMatrix.needsUpdate = true;
    shell.instanceMatrix.needsUpdate = true;
    shellGrowth.needsUpdate = true;
    for (let a = 0; a < 4; a++) {
      const mesh = sprigMeshes[a];
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
      sprigGrowths[a].needsUpdate = true;
    }
    sprigUniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      <instancedMesh
        ref={glossRef}
        args={[built.blockGeo, glossMat, built.total]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={shellRef}
        args={[built.shellGeo, mossMat, built.total * p.shellCount]}
        receiveShadow
        frustumCulled={false}
      />
      {built.sprigGeos.map((geo, a) => (
        <instancedMesh
          key={a}
          ref={(mesh) => {
            sprigRefs.current[a] = mesh;
          }}
          args={[geo, sprigMat, built.sprigTotalPer[a]]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
