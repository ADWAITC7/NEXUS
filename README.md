# NEXUS

An interactive real-time 3D experience built with React, Three.js, and React Three Fiber. Procedural blocks traverse a diagonal track, transitioning into rich organic growth across an active growth threshold—featuring moss carpeting, sprouting vegetation, and procedural coiling vines.

All visuals are generated procedurally in the browser at runtime with no external 3D models or image textures.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5213.

Production build:

```bash
npm run build
npm run preview
```

`npm run build` type-checks before bundling, so a type error fails the build.

## How it works

**The belt is one line of math.** Each block's position along the rail is
`u = (phase + t / arcLength) mod 1`. A fixed stretch of `u` is the growth zone,
so any block crossing it greens over and wrapping past the end strips it bare
again. Every visual is a pure function of `u`, which means there is no timeline
to drift, no reset event and no state to get out of sync.

**The rail** is a diagonal smoothed through a centripetal Catmull-Rom curve,
resampled to 401 evenly spaced points carrying rotation-minimizing frames. A
Frenet frame would flip wherever the curvature changes sign and every block on
the belt would somersault with it. Lanes are the master rail slid sideways
along its own transported side vectors.

**The moss** is shell texturing. Each block's geometry is drawn several times,
each copy inflated a little further along its normals, and a coverage field
carves strands out of the stack: a domain-warped noise field decides where moss
grows at all, hashed cells decide individual strand positions, and any shell
above a strand's local height is discarded. The result reads as volume rather
than as a texture, and it costs one instanced draw call per shell layer.

**The plants** are placed entirely on the GPU. Four merged tuft archetypes are
instanced across every block, and each instance carries its own offset, surface
axis, randoms and growth value as vertex attributes. A plant appears when the
coverage field at its position passes its personal threshold, scaled by a
back-out ease so it pops rather than fades.

**The vines** are tubes re-skinned on the CPU every frame around a centreline
that is a pure function of position. A persistent transported normal is carried
between frames so the tube's twist can never pop. Leaves hold fixed, stratified
slots along the tube, sized small near the tip and full-grown toward the root.

**Everything eases in time, not per frame.** Smoothing uses
`value += (target - value) * (1 - exp(-k * dt))`, so a 144Hz display and a 60Hz
display settle at exactly the same rate. A plain per-frame fraction is roughly
three times twitchier at 144Hz, and on a scene this large it reads as shake.

## Tuning

Every dial lives in `src/params.ts` and can be overridden from the query string:

| Parameter | Effect |
| --- | --- |
| `?lite` | Low-cost preset: half resolution, fewer shells, fewer plants |
| `?qdpr=<n>` | Device pixel ratio |
| `?qshells=<n>` | Moss shell layers, the depth of the carpet |
| `?qsprigs=<n>` | Plants per block |

## Stack

React 19, TypeScript, Vite, Three.js via React Three Fiber.
