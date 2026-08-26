import { useFrame } from '@react-three/fiber';

/**
 * One clock for the whole conveyor.
 *
 * Blocks, vines, leaves, nodes and twigs all derive their position from this
 * single accumulated distance, so nothing can drift out of step with the
 * belt. It is advanced here and nowhere else: this component is mounted
 * first inside the canvas, and frame callbacks of equal priority run in
 * mount order, so every consumer reads a value already advanced for the
 * current frame.
 *
 * The per-step clamp keeps a stalled tab (or a breakpoint) from teleporting
 * the entire scene forward when the tab wakes up.
 */
export function BeltClock({ belt, speed }: { belt: { current: number }; speed: number }) {
  useFrame((_, dt) => {
    belt.current += Math.min(dt, 0.1) * speed;
  });
  return null;
}
