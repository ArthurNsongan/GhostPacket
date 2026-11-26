"use client";

// Full-page 3D backdrop (V6, Haunted Mode): a misty graveyard under a huge
// moon. Tombstones and crosses, dead trees, lit jack-o'-lanterns, translucent
// spectres with glowing eyes drifting between the graves, will-o'-the-wisps and
// bats circling the moon. The camera follows the pointer and walks into the
// graveyard as the page scrolls. Protocol moments: transmit → the spectres
// stir, verified → the wisps turn mist green, rejected / replay → blood moon,
// red fog and red eyes.
// three.js is loaded on demand (own chunk, same origin). The loop pauses in
// hidden tabs; reduced motion renders one still frame. Clean Field Mode
// unmounts it. Without WebGL, the CSS moon stays.
import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";

import { onSpectral } from "ghostpacket-sdk/effects";
import { currentTheme, hauntedMotion, onThemeChange } from "ghostpacket-sdk/theme";

type Three = typeof import("three");

export default function HauntedBackdrop3D() {
  const [haunted, setHaunted] = useState(false);
  useEffect(() => {
    setHaunted(currentTheme() === "haunted");
    return onThemeChange((t) => setHaunted(t === "haunted"));
  }, []);
  return haunted ? <Backdrop /> : null;
}

const VOID = 0x120e16;
const FOG = 0x1d1626;
const MOON = 0xfff3d6;
const BLOOD = 0xc4243f;
const EYE = 0xa8ffe0;
const EYE_ANGRY = 0xff3355;

/** Soft round sprite texture (fog, glow, halo). */
function softTexture(THREE: Three, inner = 1, outer = 0): InstanceType<Three["CanvasTexture"]> {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(255,255,255,${inner})`);
  grad.addColorStop(0.4, `rgba(255,255,255,${inner * 0.35})`);
  grad.addColorStop(1, `rgba(255,255,255,${outer})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Backdrop() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};

    void import("three").then((THREE) => {
      if (disposed) return;
      let renderer: InstanceType<Three["WebGLRenderer"]>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
      } catch {
        return;
      }
      const rnd = mulberry(1031);
      const R = (a: number, b: number) => a + rnd() * (b - a);
      renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
      renderer.setClearColor(VOID, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      el.appendChild(renderer.domElement);
      document.documentElement.classList.add("backdrop-3d");

      const scene = new THREE.Scene();
      const fog = new THREE.FogExp2(FOG, 0.052);
      scene.fog = fog;
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
      camera.position.set(0, 1.7, 9);

      scene.add(new THREE.HemisphereLight(0x6e6290, 0x0a070e, 0.75));
      const moonLight = new THREE.DirectionalLight(0xc4c8ff, 1.1);
      moonLight.position.set(10, 14, -30);
      scene.add(moonLight);

      const soft = softTexture(THREE);
      const dispose: { dispose: () => void }[] = [soft];
      const keep = <T extends { dispose: () => void }>(x: T) => (dispose.push(x), x);

      // ---- Moon + halo ----
      const moonMat = keep(new THREE.MeshBasicMaterial({ color: MOON, fog: false, toneMapped: false }));
      const moon = new THREE.Mesh(keep(new THREE.SphereGeometry(4.2, 32, 16)), moonMat);
      moon.position.set(30, 30, -70);
      scene.add(moon);
      const haloMat = keep(new THREE.SpriteMaterial({ map: soft, color: MOON, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(40);
      halo.position.copy(moon.position);
      scene.add(halo);

      // ---- Ground and far hills ----
      const groundGeo = keep(new THREE.PlaneGeometry(160, 160, 80, 80));
      const gp = groundGeo.attributes.position as InstanceType<Three["BufferAttribute"]>;
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i);
        const y = gp.getY(i);
        gp.setZ(i, Math.sin(x * 0.35) * 0.18 + Math.cos(y * 0.27) * 0.22 + Math.sin((x + y) * 0.9) * 0.05);
      }
      groundGeo.computeVertexNormals();
      const ground = new THREE.Mesh(groundGeo, keep(new THREE.MeshStandardMaterial({ color: 0x1a1222, roughness: 1 })));
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      const hillMat = keep(new THREE.MeshStandardMaterial({ color: 0x0e0a13, roughness: 1 }));
      const hillGeo = keep(new THREE.SphereGeometry(1, 24, 12));
      [[-30, -50, 16], [8, -58, 14], [34, -48, 18], [-8, -64, 20]].forEach(([x, z, r]) => {
        const h = new THREE.Mesh(hillGeo, hillMat);
        h.position.set(x!, -r! * 0.72, z!);
        h.scale.set(r! * 1.6, r!, r!);
        scene.add(h);
      });

      // ---- Tombstones and crosses (instanced) ----
      const stoneMat = keep(new THREE.MeshStandardMaterial({ color: 0x3b3447, roughness: 0.95 }));
      const tomb = new THREE.Shape();
      tomb.moveTo(-0.45, 0);
      tomb.lineTo(-0.45, 0.75);
      tomb.absarc(0, 0.75, 0.45, Math.PI, 0, true);
      tomb.lineTo(0.45, 0);
      tomb.lineTo(-0.45, 0);
      const tombGeo = keep(new THREE.ExtrudeGeometry(tomb, { depth: 0.16, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 12 }));
      const cross = new THREE.Shape();
      ([[-0.08, 0], [0.08, 0], [0.08, 0.9], [0.32, 0.9], [0.32, 1.06], [0.08, 1.06], [0.08, 1.4], [-0.08, 1.4], [-0.08, 1.06], [-0.32, 1.06], [-0.32, 0.9], [-0.08, 0.9]] as const).forEach(([x, y], i) => (i ? cross.lineTo(x, y) : cross.moveTo(x, y)));
      const crossGeo = keep(new THREE.ExtrudeGeometry(cross, { depth: 0.12, bevelEnabled: false }));
      const graves: [number, number][] = [];
      const place = (n: number, geo: InstanceType<Three["ExtrudeGeometry"]>) => {
        const mesh = new THREE.InstancedMesh(geo, stoneMat, n);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        for (let i = 0; i < n; i++) {
          let x = 0;
          let z = 0;
          do {
            x = R(-17, 17);
            z = R(-34, -3);
          } while ((Math.abs(x) < 3.2 && z > -16) || (z > -7 && Math.abs(x) < 7));
          graves.push([x, z]);
          const s = R(0.7, 1.35);
          e.set(R(-0.08, 0.08), R(-0.4, 0.4), R(-0.14, 0.14));
          q.setFromEuler(e);
          m.compose(new THREE.Vector3(x, -0.12, z), q, new THREE.Vector3(s, s, s));
          mesh.setMatrixAt(i, m);
        }
        scene.add(mesh);
      };
      place(38, tombGeo);
      place(12, crossGeo);

      // ---- Dead trees ----
      const barkMat = keep(new THREE.MeshStandardMaterial({ color: 0x110c17, roughness: 1 }));
      const branchGeo = keep(new THREE.CylinderGeometry(0.6, 1, 1, 6, 1));
      branchGeo.translate(0, 0.5, 0);
      const branch = (parent: InstanceType<Three["Object3D"]>, len: number, rad: number, depth: number) => {
        const b = new THREE.Mesh(branchGeo, barkMat);
        b.scale.set(rad, len, rad);
        parent.add(b);
        if (depth === 0) return;
        const tip = new THREE.Object3D();
        tip.position.y = len;
        parent.add(tip);
        const kids = depth > 2 ? 2 : 3;
        for (let k = 0; k < kids; k++) {
          const pivot = new THREE.Object3D();
          pivot.rotation.set(R(-0.3, 0.3), (k / kids) * Math.PI * 2 + R(0, 1), R(0.45, 0.95));
          tip.add(pivot);
          branch(pivot, len * R(0.55, 0.75), rad * 0.62, depth - 1);
        }
      };
      [[-9, -14, 4.2], [10.5, -19, 5], [-15, -27, 5.5], [5, -33, 4.6], [16, -9, 3.6]].forEach(([x, z, h]) => {
        const t = new THREE.Object3D();
        t.position.set(x!, -0.2, z!);
        t.rotation.y = R(0, Math.PI * 2);
        branch(t, h! * 0.5, 0.16, 4);
        scene.add(t);
      });

      // ---- Jack-o'-lanterns ----
      const pumpGeo = keep(new THREE.SphereGeometry(0.85, 40, 24));
      const pp = pumpGeo.attributes.position as InstanceType<Three["BufferAttribute"]>;
      const v = new THREE.Vector3();
      for (let i = 0; i < pp.count; i++) {
        v.fromBufferAttribute(pp, i);
        const rib = 1 - 0.075 * Math.pow(Math.abs(Math.sin(Math.atan2(v.z, v.x) * 4)), 0.5);
        pp.setXYZ(i, v.x * rib * 1.12, v.y * 0.78, v.z * rib * 1.12);
      }
      pumpGeo.computeVertexNormals();
      const pumpMat = keep(new THREE.MeshStandardMaterial({ color: 0xc85a14, roughness: 0.6, emissive: 0x4a1400, emissiveIntensity: 0.6 }));
      const fireMat = keep(new THREE.MeshBasicMaterial({ color: 0xffb347 }));
      const cut = (pts: [number, number][]) => {
        const sh = new THREE.Shape();
        pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
        const g = keep(new THREE.ShapeGeometry(sh));
        const a = g.attributes.position as InstanceType<Three["BufferAttribute"]>;
        for (let i = 0; i < a.count; i++) {
          const x = a.getX(i) / 0.952;
          const y = a.getY(i) / 0.663;
          a.setZ(i, 0.952 * Math.sqrt(Math.max(0, 1 - x * x - y * y)) + 0.012);
        }
        return g;
      };
      const faces = [
        cut([[-0.42, 0.1], [-0.12, 0.16], [-0.3, 0.38]]),
        cut([[0.12, 0.16], [0.42, 0.1], [0.3, 0.38]]),
        cut([[-0.5, -0.14], [-0.34, -0.24], [-0.22, -0.14], [-0.1, -0.28], [0.04, -0.16], [0.16, -0.3], [0.28, -0.16], [0.4, -0.25], [0.5, -0.12], [0.3, -0.44], [0, -0.5], [-0.3, -0.44]]),
      ];
      const lanterns: [number, number, number][] = [[-7.5, -6, 0.6], [7, -7, -0.5], [-9, -12, 0.3], [3.2, -15, -0.2], [11, -10, -0.7], [-12.5, -19, 0.4]];
      lanterns.forEach(([x, z, ry]) => {
        const p = new THREE.Group();
        p.add(new THREE.Mesh(pumpGeo, pumpMat));
        faces.forEach((f) => p.add(new THREE.Mesh(f, fireMat)));
        p.position.set(x, 0.35, z);
        p.rotation.y = ry;
        p.scale.setScalar(0.5);
        scene.add(p);
      });
      const candles = [new THREE.PointLight(0xff8a2a, 6, 7, 1.6), new THREE.PointLight(0xff8a2a, 5, 7, 1.6)];
      candles[0]!.position.set(-7.5, 0.9, -5.4);
      candles[1]!.position.set(7, 0.9, -6.4);
      candles.forEach((c) => scene.add(c));

      // ---- Spectres: tall translucent ghosts with tattered hems and glowing eyes ----
      const profile: InstanceType<Three["Vector2"]>[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * (Math.PI / 2);
        profile.push(new THREE.Vector2(Math.sin(a) * 0.62, 1.1 + Math.cos(a) * 0.62));
      }
      for (let i = 1; i <= 14; i++) profile.push(new THREE.Vector2(0.62 + i * 0.03, 1.1 - i * 0.16));
      profile.reverse();
      const spectreGeo = keep(new THREE.LatheGeometry(profile, 48));
      const sp = spectreGeo.attributes.position as InstanceType<Three["BufferAttribute"]>;
      for (let i = 0; i < sp.count; i++) {
        const y = sp.getY(i);
        if (y < 0.2) {
          const a = Math.atan2(sp.getZ(i), sp.getX(i));
          const k = (0.2 - y) / 1.25;
          sp.setY(i, y - Math.pow(Math.abs(Math.sin(a * 4.5)), 3) * 0.7 * k);
        }
      }
      const eyeMat = keep(new THREE.SpriteMaterial({ map: soft, color: EYE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      interface Spectre {
        g: InstanceType<Three["Group"]>;
        mat: InstanceType<Three["MeshBasicMaterial"]>;
        base: [number, number, number];
        seed: number;
        span: number;
      }
      const spectres: Spectre[] = [];
      const addSpectre = (x: number, y: number, z: number, s: number, span: number) => {
        const mat = keep(new THREE.MeshBasicMaterial({ color: 0xd8d0ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const g = new THREE.Group();
        g.add(new THREE.Mesh(spectreGeo, mat));
        [-0.2, 0.2].forEach((ex) => {
          const e = new THREE.Sprite(eyeMat);
          e.position.set(ex, 1.32, 0.56);
          e.scale.set(0.22, 0.3, 1);
          g.add(e);
        });
        g.scale.setScalar(s);
        g.position.set(x, y, z);
        scene.add(g);
        spectres.push({ g, mat, base: [x, y, z], seed: R(0, 100), span });
      };
      addSpectre(4.6, 1.2, -4.5, 1.25, 0.6);
      addSpectre(-5.5, 1.0, -9, 1, 2.4);
      addSpectre(7.5, 1.1, -15, 1.1, 3);
      addSpectre(-2.5, 1.3, -20, 1.2, 3.5);
      addSpectre(11, 1.0, -26, 1.3, 4);

      // ---- Fog banks ----
      const fogMat = keep(new THREE.SpriteMaterial({ map: soft, color: 0xb2a4d6, transparent: true, opacity: 0.075, depthWrite: false }));
      const fogs = Array.from({ length: 34 }, () => {
        const f = new THREE.Sprite(fogMat);
        const s = R(7, 14);
        f.scale.set(s * 1.8, s * 0.55, 1);
        f.position.set(R(-22, 22), R(0.2, 1.4), R(-36, 4));
        f.userData.v = R(0.004, 0.012);
        scene.add(f);
        return f;
      });

      // ---- Will-o'-the-wisps ----
      const N = 140;
      const wisp = new Float32Array(N * 3);
      const wispSeed = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        wisp[i * 3] = R(-18, 18);
        wisp[i * 3 + 1] = R(0.2, 2.4);
        wisp[i * 3 + 2] = R(-34, 4);
        wispSeed[i] = R(0, 100);
      }
      const wispGeo = keep(new THREE.BufferGeometry());
      wispGeo.setAttribute("position", new THREE.BufferAttribute(wisp, 3));
      const wispMat = keep(new THREE.PointsMaterial({ color: 0xffc070, size: 0.09, map: soft, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      scene.add(new THREE.Points(wispGeo, wispMat));

      // ---- Bats around the moon ----
      const bs = new THREE.Shape();
      bs.moveTo(0, 0);
      bs.quadraticCurveTo(-0.12, 0.12, -0.32, 0.06);
      bs.quadraticCurveTo(-0.24, -0.02, -0.2, -0.06);
      bs.quadraticCurveTo(-0.12, -0.02, -0.08, -0.08);
      bs.quadraticCurveTo(-0.04, -0.03, 0, -0.07);
      bs.quadraticCurveTo(0.04, -0.03, 0.08, -0.08);
      bs.quadraticCurveTo(0.12, -0.02, 0.2, -0.06);
      bs.quadraticCurveTo(0.24, -0.02, 0.32, 0.06);
      bs.quadraticCurveTo(0.12, 0.12, 0, 0);
      const batGeo = keep(new THREE.ShapeGeometry(bs));
      const batMat = keep(new THREE.MeshBasicMaterial({ color: 0x07050a, side: THREE.DoubleSide, fog: false }));
      const bats = Array.from({ length: 9 }, (_, i) => {
        const b = new THREE.Mesh(batGeo, batMat);
        b.scale.setScalar(R(2.2, 3.4));
        b.userData = { r: R(5.5, 11), sp: R(0.25, 0.55) * (i % 2 ? 1 : -1), ph: R(0, 6.28), h: R(-3, 4) };
        scene.add(b);
        return b;
      });

      // ---- Size, pointer, scroll ----
      const resize = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        if (still) render();
      };
      const aim = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => {
        aim.x = (e.clientX / window.innerWidth - 0.5) * 2;
        aim.y = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("resize", resize);

      // ---- Protocol moments ----
      const mood = { stir: 0, eye: new THREE.Color(EYE) };
      const offSpectral = onSpectral((e) => {
        if (e === "rejected" || e === "replay") {
          const c = { t: 0 };
          gsap.killTweensOf(c);
          gsap.to(c, {
            t: 1,
            duration: 0.25,
            yoyo: true,
            repeat: 1,
            repeatDelay: 1.3,
            onUpdate: () => {
              moonMat.color.set(MOON).lerp(new THREE.Color(BLOOD), c.t);
              haloMat.color.copy(moonMat.color);
              fog.color.set(FOG).lerp(new THREE.Color(0x3a0c16), c.t * 0.8);
              eyeMat.color.set(EYE).lerp(new THREE.Color(EYE_ANGRY), c.t);
            },
          });
        } else if (e === "transmit") {
          gsap.to(mood, { stir: 1, duration: 0.4, yoyo: true, repeat: 1, repeatDelay: 1.8 });
        } else if (e === "verified") {
          const c = { t: 0 };
          gsap.to(c, { t: 1, duration: 0.3, yoyo: true, repeat: 1, repeatDelay: 0.9, onUpdate: () => void wispMat.color.set(0xffc070).lerp(new THREE.Color(0x8fffd0), c.t) });
        }
      });

      // ---- Loop ----
      const still = !hauntedMotion();
      const clock = new THREE.Clock();
      const look = new THREE.Vector3();
      const render = () => {
        const t = clock.getElapsedTime();
        const scroll = Math.min(window.scrollY * 0.004, 5);
        camera.position.x += (aim.x * 0.9 - camera.position.x) * 0.04;
        camera.position.y += (1.7 - aim.y * 0.35 + scroll * 0.08 - camera.position.y) * 0.04;
        camera.position.z += (9 - scroll - camera.position.z) * 0.06;
        look.set(camera.position.x * 0.35, 2.1, camera.position.z - 18);
        camera.lookAt(look);

        spectres.forEach((s, i) => {
          const k = t * (0.12 + mood.stir * 0.25) + s.seed;
          s.g.position.set(s.base[0] + Math.sin(k) * s.span, s.base[1] + Math.sin(t * 0.9 + s.seed) * 0.18 + mood.stir * 0.3, s.base[2] + Math.cos(k * 0.7) * s.span * 0.6);
          s.g.rotation.y = Math.atan2(camera.position.x - s.g.position.x, camera.position.z - s.g.position.z) + Math.sin(t * 0.5 + i) * 0.2;
          s.g.rotation.z = Math.sin(t * 0.7 + s.seed) * 0.06;
          // Apparitions: they fade in and out, the nearest one stays.
          const fade = i === 0 ? 1 : Math.max(0, Math.sin(t * 0.25 + s.seed * 1.7)) ** 0.6;
          s.mat.opacity = (0.08 + fade * 0.2) * (1 + mood.stir * 0.6);
          s.g.visible = fade > 0.02 || i === 0;
        });
        eyeMat.opacity = 0.75 + Math.sin(t * 3.1) * 0.15 + mood.stir * 0.3;

        fogs.forEach((f) => {
          f.position.x += f.userData.v as number;
          if (f.position.x > 24) f.position.x = -24;
        });
        for (let i = 0; i < N; i++) {
          const s = wispSeed[i]!;
          wisp[i * 3] = wisp[i * 3]! + Math.sin(t * 0.6 + s) * 0.006;
          wisp[i * 3 + 1] = 0.3 + Math.abs(Math.sin(t * 0.3 + s)) * 2.1;
        }
        wispGeo.attributes.position!.needsUpdate = true;
        wispMat.opacity = 0.55 + Math.sin(t * 2.2) * 0.25;

        const flick = 5 + Math.sin(t * 9) * 1.2 + Math.sin(t * 23.7) * 0.8;
        candles.forEach((c, i) => (c.intensity = flick + i));
        fireMat.color.setRGB(1, 0.62 + Math.sin(t * 11) * 0.06, 0.25);

        bats.forEach((b) => {
          const { r, sp, ph, h } = b.userData as { r: number; sp: number; ph: number; h: number };
          const a = t * sp + ph;
          b.position.set(moon.position.x + Math.cos(a) * r, moon.position.y + h + Math.sin(a * 2) * 0.8, moon.position.z + 6 + Math.sin(a) * r * 0.4);
          b.rotation.z = Math.sin(a) * 0.3;
          b.scale.y = b.scale.x * (0.4 + Math.abs(Math.sin(t * 9 + ph)) * 0.8);
        });

        renderer.render(scene, camera);
      };
      resize();

      let raf: number | null = null;
      const loop = () => {
        render();
        raf = requestAnimationFrame(loop);
      };
      const play = () => {
        if (still) {
          // Settle the camera, then draw once.
          for (let i = 0; i < 120; i++) render();
          return;
        }
        if (raf === null && !document.hidden) raf = requestAnimationFrame(loop);
      };
      const pause = () => {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
      };
      const onVis = () => (document.hidden ? pause() : play());
      document.addEventListener("visibilitychange", onVis);
      gsap.fromTo(renderer.domElement, { opacity: 0 }, { opacity: 1, duration: 1.6, ease: "power2.out" });
      play();

      cleanup = () => {
        pause();
        offSpectral();
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("resize", resize);
        document.documentElement.classList.remove("backdrop-3d");
        dispose.forEach((d) => d.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={host} aria-hidden className="haunted-backdrop haunt-only" />;
}
