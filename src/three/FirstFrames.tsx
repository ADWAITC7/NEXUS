import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';

/**
 * The preloader's gate. Loading being finished is not the same as the
 * scene being watchable: shaders still compile on first use and the first
 * frames stutter. So the gate waits for the loaders to go quiet and then
 * for eight consecutive rendered frames before declaring the stage ready.
 * The caller holds a failsafe timer for machines where that never happens.
 */
export function FirstFramesGate({ onReady }: { onReady: () => void }) {
  const { active } = useProgress();
  const clean = useRef(0);
  const done = useRef(false);

  useFrame(() => {
    if (done.current) return;
    clean.current = active ? 0 : clean.current + 1;
    if (clean.current >= 8) {
      done.current = true;
      onReady();
    }
  });
  return null;
}
