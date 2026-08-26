import { COLORS } from '../params';

/**
 * Everything readable. The type sits in the DOM above a transparent
 * canvas: selectable, indexable, and reachable by screen readers, while
 * the growth runs behind it. The wrapper ignores the pointer so the canvas
 * receives every move; only the links opt back in.
 */

/** Film grain as an inline SVG turbulence tile; no asset, no shader pass. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter>` +
    `<rect width='160' height='160' filter='url(%23n)' opacity='0.55'/></svg>`,
)}")`;

export function Overlay() {
  const bg = [
    `radial-gradient(55% 65% at 16% 20%, ${COLORS.bgSpotA} 0%, transparent 62%)`,
    `radial-gradient(48% 58% at 84% 26%, ${COLORS.bgSpotB} 0%, transparent 66%)`,
    `radial-gradient(65% 75% at 58% 88%, ${COLORS.bgSpotC} 0%, transparent 62%)`,
    COLORS.background,
  ].join(', ');

  return (
    <>
      <div className="bg" style={{ background: bg }} aria-hidden="true" />
      <div className="grain" style={{ backgroundImage: GRAIN }} aria-hidden="true" />

      <div className="ui">
        <header className="ui__bar">
          <a className="ui__brand" href="/">
            <span className="ui__spark" aria-hidden="true">
              ✦
            </span>
            NEXUS <sup>°</sup>
          </a>
          <nav className="ui__nav" aria-label="Primary">
            <a href="#overview">Overview</a>
            <a href="#material">Material</a>
            <a href="#notes">Field Notes</a>
            <a className="ui__contact" href="#contact">
              Contact
            </a>
          </nav>
        </header>

        <div className="ui__copy">
          <p className="ui__eyebrow">Regenerative-material lab, est. 2031</p>
          <h1>
            Let it
            <br />
            run <em>wild.</em>
          </h1>
          <p className="ui__lede">
            We seed dormant structures with engineered moss, then let a century
            of growth happen in seconds. Watch the line: everything that
            crosses it comes back green.
          </p>
          <div className="ui__actions">
            <a className="ui__primary" href="#watch">
              Watch it grow
            </a>
            <a className="ui__secondary" href="#notes">
              Read the field notes <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <footer className="ui__foot">
          <span className="ui__index">01</span> Bio-substrate shells
        </footer>
      </div>
    </>
  );
}
