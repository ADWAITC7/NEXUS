import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { Params } from '../params';
import { buildTrack, offsetTrack } from '../lib/track';
import { Blocks } from './Blocks';
import { Vines } from './Vines';
import { BeltClock } from './BeltClock';
import { FirstFramesGate } from './FirstFrames';

/**
 * The stage: an orthodox R3F canvas with one strong shadow key almost
 * overhead, a soft fill, an environment for the clearcoat reflections and
 * a faked contact shadow under everything. The camera never animates on
 * its own; it parallaxes against the pointer and always re-aims at the
 * origin, which is what turns cursor movement into depth.
 */

function CameraRig({ p }: { p: Params }) {
  const { camera } = useThree();
  // Start AT the base viewpoint: the rig eases pointer deltas, never an
  // approach from the mount position, so the scene never flies in.
  useEffect(() => {
    const yaw = (p.camYaw * Math.PI) / 180;
    const pitch = (p.camPitch * Math.PI) / 180;
    const cp = Math.cos(pitch);
    camera.position.set(
      Math.sin(yaw) * cp * p.camDist,
      Math.sin(pitch) * p.camDist,
      Math.cos(yaw) * cp * p.camDist,
    );
    camera.lookAt(0, 0, 0);
  }, [camera, p]);
  useFrame((state, dt) => {
    const yaw = (p.camYaw * Math.PI) / 180;
    const pitch = (p.camPitch * Math.PI) / 180;
    const cp = Math.cos(pitch);
    const bx = Math.sin(yaw) * cp * p.camDist;
    const by = Math.sin(pitch) * p.camDist;
    const bz = Math.cos(yaw) * cp * p.camDist;
    const tx = bx + state.pointer.x * p.parallax;
    const ty = by + state.pointer.y * p.parallax * 0.5;
    /* Exponential smoothing in dt, never a per-frame fraction: a per-frame
       lerp is 3.5x twitchier at 144Hz than at 60Hz, and the resulting sway,
       amplified by the lookAt re-aim, reads as the whole scene shaking. */
    const k = 1 - Math.exp(-2.4 * Math.min(dt, 0.1));
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (bz - camera.position.z) * k;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** Exposure and tone mapping, set once. */
function Grade({ p }: { p: Params }) {
  const { gl } = useThree();
  useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = p.exposure;
  }, [gl, p.exposure]);
  return null;
}

/** Debug handle: the live scene graph and camera, same surface as `__nexus.stats`. */
function SceneTap() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const w = window as unknown as { __nexusScene?: THREE.Scene; __nexusCam?: THREE.Camera };
  w.__nexusScene = scene;
  w.__nexusCam = camera;
  return null;
}

/**
 * The environment map arrives over the network; if it never does, the
 * scene must still light. The boundary swallows the load failure and the
 * hemisphere light below keeps carrying the ambience.
 */
class EnvBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Scene({ p, onReady }: { p: Params; onReady: () => void }) {
  const lanes = useMemo(() => {
    const master = buildTrack(p);
    return Array.from({ length: p.trackCount }, (_, i) =>
      offsetTrack(master, (i - (p.trackCount - 1) / 2) * p.spacing),
    );
  }, [p]);
  const laneSpan = (p.trackCount - 1) * p.spacing;
  const lightRef = useRef<THREE.DirectionalLight>(null);
  // One conveyor distance, shared by the blocks and the vines.
  const belt = useRef(0);

  const az = (p.lightAz * Math.PI) / 180;
  const el = (p.lightEl * Math.PI) / 180;
  const lightPos: [number, number, number] = [
    Math.sin(az) * Math.cos(el) * 11,
    Math.sin(el) * 11,
    Math.cos(az) * Math.cos(el) * 11,
  ];

  return (
    <Canvas
      shadows={{ enabled: true, type: THREE.PCFShadowMap }}
      dpr={p.dpr}
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: p.fov, position: [0, 0, p.camDist], near: 0.1, far: 100 }}
      style={{ position: 'fixed', inset: 0 }}
    >
      {/* Mounted first so its frame callback advances the belt before any
          consumer reads it: equal-priority callbacks run in mount order. */}
      <BeltClock belt={belt} speed={p.speed} />
      <Grade p={p} />
      <hemisphereLight args={['#e8ecdf', '#8a8f7f', 0.55]} />
      <directionalLight
        ref={lightRef}
        castShadow
        position={lightPos}
        intensity={p.keyIntensity}
        color="#fffdf4"
        shadow-radius={p.shadowSoftness}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[4, -1, -3]} intensity={p.keyIntensity * 0.3} color="#eef1e9" />

      <EnvBoundary>
        <Suspense fallback={null}>
          <Environment
            preset="studio"
            environmentIntensity={p.envIntensity}
            environmentRotation={[0, p.envRotY, 0]}
          />
        </Suspense>
      </EnvBoundary>

      <ContactShadows
        position={[0, p.groundY, 0]}
        opacity={p.groundShadow}
        scale={30}
        blur={p.groundBlur}
        far={12}
        resolution={512}
        frames={Infinity}
        color="#1c211c"
      />

      <CameraRig p={p} />
      <SceneTap />
      <Blocks p={p} lanes={lanes} belt={belt} />
      <Vines
        p={p}
        track={lanes[Math.floor(lanes.length / 2)]}
        laneSpan={laneSpan}
        belt={belt}
      />
      <FirstFramesGate onReady={onReady} />
    </Canvas>
  );
}
