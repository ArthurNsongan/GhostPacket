"use client";

// Header switches (HALLOWEEN_REDESIGN_PLAN.md §4): Haunted / Clean Field mode,
// spooky sound effects and the crypt ambience. All off-by-default sounds are
// synthesized locally and muted while the modem or the microphone runs.
// V4: three quiet icon buttons; the "on" state is a tonal fill, never an outline.
import { useEffect, useState } from "react";

import { currentTheme, onThemeChange, setTheme, type Theme } from "ghostpacket-sdk/theme";
import { ambienceEnabled, onAmbienceChange, onSfxChange, refreshAmbience, setAmbience, setSfx, sfx, sfxEnabled } from "ghostpacket-sdk/ui-sfx";

const iconBtn = "grid h-8 w-8 place-items-center rounded-full transition-colors";
const on = "bg-accent/15 text-accent";
const off = "text-mute hover:bg-ink/[0.06] hover:text-ink";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const MOON = "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z";
const HALF = "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18";
const SPEAKER = "M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11";
const SPEAKER_OFF = "M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5";
const WIND = "M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7";

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
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => setTheme(haunted ? "clean" : "haunted")}
        aria-pressed={haunted}
        title={haunted ? "Haunted mode — switch to Clean Field Mode (no decoration, calm layout)" : "Clean Field Mode — switch to Haunted mode"}
        className={`${iconBtn} ${haunted ? on : off}`}
      >
        <Icon d={haunted ? MOON : HALF} />
        <span className="sr-only">{haunted ? "Haunted mode" : "Clean field mode"}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setSfx(!sfxOn);
          if (!sfxOn) setTimeout(() => void sfx("tap"), 0);
        }}
        aria-pressed={sfxOn}
        title={`${haunted ? "Spooky sound effects" : "Interface sounds"} ${sfxOn ? "on" : "off"}`}
        className={`${iconBtn} ${sfxOn ? on : off}`}
      >
        <Icon d={sfxOn ? SPEAKER : SPEAKER_OFF} />
        <span className="sr-only">
          {haunted ? "Spooky SFX" : "UI SFX"} {sfxOn ? "on" : "off"}
        </span>
      </button>
      {haunted && (
        <button
          type="button"
          onClick={() => setAmbience(!ambOn)}
          aria-pressed={ambOn}
          title={`Crypt ambience ${ambOn ? "on" : "off"} — low drone and night wind at −28 dB, silenced while the modem runs`}
          className={`${iconBtn} ${ambOn ? on : off}`}
        >
          <Icon d={WIND} />
          <span className="sr-only">Crypt ambience {ambOn ? "on" : "off"}</span>
        </button>
      )}
    </div>
  );
}
