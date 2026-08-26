import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Scene } from './three/Scene';
import { Overlay } from './ui/Overlay';
import { readParams } from './params';

declare global {
  interface Window {
    __nexus?: {
      stats: () => Record<string, number | boolean>;
    };
  }
}

export default function App() {
  const p = useMemo(readParams, []);
  const ready = useRef(false);

  /*
   * The preloader leaves when fonts are in AND the stage has produced its
   * first clean frames, with a nine second failsafe for machines where one
   * of those signals never arrives. A preloader that can hang forever is
   * worse than no preloader.
   */
  const dismiss = useCallback(() => {
    if (ready.current) return;
    ready.current = true;
    document.getElementById('preloader')?.classList.add('preloader-done');
    window.setTimeout(() => document.getElementById('preloader')?.remove(), 800);
  }, []);

  const onSceneReady = useCallback(() => {
    void document.fonts.ready.then(dismiss);
  }, [dismiss]);

  useEffect(() => {
    const failsafe = window.setTimeout(dismiss, 9000);
    return () => window.clearTimeout(failsafe);
  }, [dismiss]);

  useEffect(() => {
    window.__nexus = {
      stats: () => ({
        ready: ready.current,
        dpr: p.dpr,
        shells: p.shellCount,
        sprigsPerBlock: p.sprigCount,
        vines: p.vineCount,
      }),
    };
  }, [p]);

  return (
    <>
      <Overlay />
      <Scene p={p} onReady={onSceneReady} />
    </>
  );
}
