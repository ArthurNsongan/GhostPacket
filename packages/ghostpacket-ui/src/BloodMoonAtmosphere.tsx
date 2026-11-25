// Pale moon that turns garnet for the Blood Moon alert (HALLOWEEN_REDESIGN_PLAN.md, V4).
// Pure CSS driven by the `blood-moon` class that `bloodMoon()` sets on <html> after
// any rejection. Hidden in Clean Field Mode (`haunt-only`).
export default function BloodMoonAtmosphere() {
  return (
    <div aria-hidden className="haunt-only">
      <div className="moon" />
    </div>
  );
}
