// Pale moon, wrought-iron gate silhouette and the lightning flash of the
// Blood Moon alert (HALLOWEEN_REDESIGN_PLAN.md §3.3). Pure CSS driven by the
// `blood-moon` class that `bloodMoon()` sets on <html> after any rejection.
// Hidden in Clean Field Mode (`haunt-only`).
export default function BloodMoonAtmosphere() {
  return (
    <div aria-hidden className="haunt-only">
      <div className="moon" />
      <svg className="iron-gate" viewBox="0 0 1200 120" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M0 110H1200M0 40H1200" />
        {Array.from({ length: 41 }, (_, i) => {
          const x = i * 30;
          return <path key={i} d={`M${x} 120V22l-4 6M${x} 22l4 6M${x - 3} 14l3-8 3 8z`} />;
        })}
        {Array.from({ length: 20 }, (_, i) => (
          <path key={`c${i}`} d={`M${15 + i * 60} 40c-9 10-9 24 0 34 9-10 9-24 0-34z`} />
        ))}
      </svg>
      <div className="lightning" />
    </div>
  );
}
