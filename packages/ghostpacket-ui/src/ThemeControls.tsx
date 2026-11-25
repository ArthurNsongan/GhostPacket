"use client";

// Header switches (HALLOWEEN_REDESIGN_PLAN.md §4): Haunted / Clean Field mode,
// spooky sound effects and the crypt ambience. All off-by-default sounds are
// synthesized locally and muted while the modem or the microphone runs.
import { useEffect, useState } from "react";

import { currentTheme, onThemeChange, setTheme, type Theme } from "ghostpacket-sdk/theme";
import { ambienceEnabled, onAmbienceChange, onSfxChange, refreshAmbience, setAmbience, setSfx, sfx, sfxEnabled } from "ghostpacket-sdk/ui-sfx";

const pill = "rounded-full px-2.5 py-1 font-mono text-[10px] ring-1 transition";

export default function ThemeControls() {
  const [theme, setThemeState] = useState<Theme>("haunted");
  const [sfxOn, setSfxOn] = useState(false);
  const [ambOn, setAmbOn] = useState(false);

  useEffect(() => {
    setThemeState(currentTheme());
    setSfxOn(sfxEnabled());
    setAmbOn(ambienceEnabled());
    const a = onThemeChange((t) => {
      setThemeState(t);
      refreshAmbience();
    });
    const b = onSfxChange(setSfxOn);
    const c = onAmbienceChange(setAmbOn);
    return () => {
      a();
      b();
      c();
    };
  }, []);

  const haunted = theme === "haunted";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setTheme(haunted ? "clean" : "haunted")}
        aria-pressed={haunted}
        title={haunted ? "Switch to Clean Field Mode (no decoration, calm layout)" : "Switch to Haunted Mode"}
        className={`${pill} ${haunted ? "text-amber ring-amber/50" : "text-ink ring-grid"}`}
      >
        {haunted ? "☾ HAUNTED" : "◐ CLEAN FIELD"}
      </button>
      <button
        type="button"
        onClick={() => {
          setSfx(!sfxOn);
          if (!sfxOn) setTimeout(() => void sfx("tap"), 0);
        }}
        aria-pressed={sfxOn}
        className={`${pill} ${sfxOn ? "text-ion ring-ion/50" : "text-mute ring-grid"}`}
      >
        {haunted ? "SPOOKY SFX" : "UI SFX"} {sfxOn ? "ON" : "OFF"}
      </button>
      {haunted && (
        <button
          type="button"
          onClick={() => setAmbience(!ambOn)}
          aria-pressed={ambOn}
          title="Low drone and night wind at −28 dB, silenced while the modem runs"
          className={`${pill} ${ambOn ? "text-ion ring-ion/50" : "text-mute ring-grid"}`}
        >
          CRYPT AMBIENCE {ambOn ? "ON" : "OFF"}
        </button>
      )}
    </div>
  );
}
