// Shot list of the demo video, in order. Each scene has:
//   id         file name of its clip, narration and subtitles
//   narration  English voice-over (TTS placeholder, or video/voice/<id>.wav if present)
//   card       title card parameters (rendered from cards/card.html), or
//   path       page to open before recording (omit to continue on the current page)
//   setup(d)   actions before recording starts (not filmed)
//   run(d)     filmed actions; the clip then holds until the narration ends
//   speed      playback speed-up for long real-time waits (1 = real time)
//   optional   footage file under video/footage/ used instead of a recording, if present
//   maxSeconds longest part of that footage kept
// Target: under 3 minutes in total (judges may stop at 3:00).

const PASS = "baobab moon harmattan";

/** Waits for the session-key gate of an issuer app and takes the one-click path. */
async function sessionKey(d) {
  await d.until(`document.body.innerText.includes("Continue with a session key")`, 20_000);
  await d.click("Continue with a session key", { pause: 600 });
}

export const scenes = [
  {
    id: "01-open",
    card: { kicker: "Kiroween 2026 · Skeleton Crew", title: "GhostPacket:", accent: "signed documents over sound and light.", sub: "No network. No server. No pairing." },
    narration: "Two phones. No network, no server, no pairing. Can one still trust a document from the other? GhostPacket says yes.",
  },
  {
    id: "02-problem",
    path: "/",
    async run(d) {
      await d.sleep(1500);
      await d.scrollBy(520);
      await d.sleep(2500);
      await d.scrollBy(-520);
    },
    narration:
      "In a rural clinic, or a savings group in Dakar, the network drops. GhostPacket turns a prescription, a receipt or a photo into a frame signed with Ed25519, and sends it through the air: speaker to microphone, or screen to camera.",
  },
  {
    id: "03-one-click",
    path: "/",
    async run(d) {
      await d.until(`!!document.querySelector('a[href*="simulation/?run=1"]')`, 10_000);
      await d.click("", { selector: 'a[href*="simulation/?run=1"]', pause: 300 });
      await d.until(`[...document.querySelectorAll('[role=status]')].some((e) => e.textContent.includes("Full scenario"))`, 40_000);
      await d.sleep(1500);
    },
    narration:
      "One click runs the whole system in the browser. The Rust core, compiled to WebAssembly, sings the frame as sound, streams it as fountain-coded QR codes with a third of them lost, and verifies the signature. Then it flips a single bit, and the frame is rejected.",
  },
  {
    id: "04-clinic",
    path: "/clinic/",
    setup: sessionKey,
    async run(d) {
      await d.until(`document.body.innerText.includes("Mariama Ba")`, 20_000);
      await d.sleep(800);
      await d.click("Prescribe", { pause: 700 });
      await d.click("Sign the prescription", { pause: 900 });
      await d.click("Hand over to the pharmacy");
      await d.until(`document.body.innerText.includes("Dispense the medicines")`, 30_000);
      await d.sleep(900);
      await d.click("Dispense the medicines", { pause: 1200 });
      await d.click("Dispensed ✓", { pause: 300 });
      await d.until(`/REPLAY/.test(document.body.innerText)`, 5000);
      await d.sleep(1800);
    },
    narration:
      "GhostClinic is built from the same skeleton. The nurse signs a prescription and hands it to the pharmacy phone. The pharmacy checks the signature and dispenses once. Present the same prescription again, even offline, and it is refused.",
  },
  {
    id: "05-clinic-photo",
    async run(d) {
      await d.click("Prescribe & hand over", { pause: 700 });
      await d.click("Use the sample", { pause: 900 });
      await d.until(`/\\d+×\\d+ · [\\d.]+ KB/.test(document.body.innerText)`, 15_000);
      await d.click("Sign the photo for", { pause: 900 });
      await d.click("Hand over the photo");
      await d.until(`document.body.innerText.includes("Signed attachment for RX-") && [...document.images].some((i) => i.src.startsWith("blob:") && i.naturalWidth > 0)`, 60_000);
      await d.sleep(2000);
    },
    narration:
      "The photo of the rapid test travels too, as ChromaCrypt color matrices: eight calibrated colors, Reed-Solomon, and a fountain code. Thirty percent of the matrices are lost. The image still materializes, and is shown only once its signature checks out.",
  },
  {
    id: "06-tontine",
    path: "/tontine/",
    setup: sessionKey,
    async run(d) {
      await d.until(`document.body.innerText.includes("Aminata Diop")`, 20_000);
      await d.sleep(600);
      await d.click("Record every remaining contribution", { pause: 900 });
      await d.click("Seal the round ledger", { pause: 1000 });
      await d.click("Broadcast the round ledger");
      await d.until(`/Round \\d+ ledger kept/.test(document.body.innerText)`, 60_000);
      await d.sleep(2200);
    },
    narration:
      "GhostTontine runs a savings group. At the end of the meeting, the treasurer seals the whole round into one signed ledger, and broadcasts it as an OFDM chord. Every phone in the room hears it at once, and checks its own receipt against the list.",
  },
  {
    id: "07-chimera",
    path: "/simulation/",
    async setup(d) {
      await d.until(`document.body.innerText.includes("V3 high-speed lab")`, 20_000);
      await d.scrollTo("V3 high-speed lab");
    },
    speed: 1.35,
    async run(d) {
      await d.click("Use the sample", { pause: 800 });
      await d.ev(`[...document.querySelectorAll('input[aria-label="Encrypt the payload"]')].at(-1).click()`);
      await d.sleep(300);
      await d.type("Encryption passphrase", PASS);
      await d.click("Sign and encrypt the image", { pause: 900 });
      await d.click("Chimera Turbo (both)", { pause: 600 });
      await d.click("Send through Chimera Turbo");
      await d.until(`/Chimera Turbo · [\\d.]+ KB in/.test(document.body.innerText)`, 90_000);
      await d.sleep(1200);
      await d.type("Receiver passphrase", PASS);
      await d.click("Decrypt and verify");
      await d.sleep(2200);
    },
    narration:
      "Bigger files get Chimera Turbo. The same droplets leave as light and as sound, into one decoder. Here the camera is covered for six seconds: sound keeps the transfer alive, then light finishes it. The photo was end-to-end encrypted, so it opens only with the shared passphrase.",
  },
  {
    id: "08-lan-whisper",
    async run(d) {
      await d.click("WebRTC LAN", { pause: 500 });
      await d.click("Send over a virtual WebRTC LAN link");
      await d.until(`/delivered in \\d+ ms/.test(document.body.innerText)`, 45_000);
      await d.sleep(1500);
      await d.scrollTo("Ultrasonic Whisper");
      await d.click("Whisper the identity card");
      await d.until(`document.body.innerText.includes("IDENTITY CARD · ED25519 VERIFIED")`, 30_000);
      await d.click("The fingerprints match: pin this key", { pause: 1500 });
    },
    narration:
      "Two devices on the same hotspot pair over the air and open a local WebRTC link, with no server: ten kilobytes in ten milliseconds. And a key can be exchanged in a near-silent whisper, above seventeen kilohertz.",
  },
  {
    id: "09-field",
    optional: "field.mp4",
    maxSeconds: 10,
    narration: "On real devices, the same frames cross from a laptop to a phone, with nothing but a speaker, a screen, and a camera.",
  },
  {
    id: "10-kiro",
    optional: "kiro.mp4",
    maxSeconds: 14,
    card: {
      kicker: "Built with Kiro",
      title: "Specs, steering and hooks,",
      accent: "then an auditor.",
      items: "EARS specs for every feature|Steering: no panic in WASM, bounded memory|Hooks: channel fuzzing on every save|MCP inspector + DSP security agent",
      mono: "104 Rust tests · 66 browser checks · 285 KB WebAssembly",
    },
    narration:
      "We built it with Kiro: a spec for every feature, steering rules that forbid any panic in the WebAssembly core, hooks that fuzz the channels on every save, an MCP inspector, and a custom security agent that reviewed each phase.",
  },
  {
    id: "11-outro",
    card: { kicker: "Open source · offline · live", title: "Try it", accent: "in one click.", mono: "arthurnsongan.github.io/GhostPacket · github.com/ArthurNsongan/GhostPacket" },
    narration: "GhostPacket. Open source, offline, and live on GitHub Pages. Try it in one click.",
  },
];
