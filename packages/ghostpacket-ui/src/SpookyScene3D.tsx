"use client";

// 3D hero scene (V5): a friendly ghost floating over a glowing carved pumpkin,
// little bats in orbit and drifting fireflies. three.js is loaded on demand
// (its own chunk, same origin), only in Haunted Mode, and the loop pauses when
// the scene is off screen or the tab is hidden. Pointer = parallax; clicking
// the ghost makes it twirl and say boo. Reduced motion: one still frame.
import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";

import { currentTheme, hauntedMotion, onThemeChange } from "ghostpacket-sdk/theme";
import { funSfx } from "ghostpacket-sdk/ui-sfx";

export default function SpookyScene3D({ className = "" }: { className?: string }) {
  const [haunted, setHaunted] = useState(false);
  useEffect(() => {
    setHaunted(currentTheme() === "haunted");
    return onThemeChange((t) => setHaunted(t === "haunted"));
  }, []);
  return haunted ? <Scene className={className} /> : null;
}

function Scene({ className }: { className: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};

    void import("three").then((THREE) => {
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        return; // No WebGL: the hero simply has no 3D scene.
      }
      renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
      camera.position.set(0, 0.35, 8.2);
      const rig = new THREE.Group();
      scene.add(rig);

      // Light: moon rim, aubergine fill, candle inside the pumpkin, violet ghost glow.
      scene.add(new THREE.HemisphereLight(0xd8d2f0, 0x2a1630, 0.9));
      const moon = new THREE.DirectionalLight(0xe9e4ff, 1.6);
      moon.position.set(3, 4, 3);
      scene.add(moon);
      const candle = new THREE.PointLight(0xffa040, 14, 6, 1.6);
      candle.position.set(0.7, -0.85, 1.2);
      rig.add(candle);
      const glow = new THREE.PointLight(0xa070ff, 9, 5, 1.8);
      glow.position.set(-0.6, 0.9, 1.4);
      rig.add(glow);

      // ---- Ghost: lathe body with a wavy, breathing hem ----
      const profile: InstanceType<typeof THREE.Vector2>[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * (Math.PI / 2);
        profile.push(new THREE.Vector2(Math.sin(a) * 0.78, 0.55 + Math.cos(a) * 0.78));
      }
      for (let i = 1; i <= 10; i++) profile.push(new THREE.Vector2(0.78 + i * 0.022, 0.55 - i * 0.13));
      profile.reverse();
      const bodyGeo = new THREE.LatheGeometry(profile, 64);
      const pos = bodyGeo.attributes.position as InstanceType<typeof THREE.BufferAttribute>;
      const base = Float32Array.from(pos.array as Float32Array);
      const ghostMat = new THREE.MeshStandardMaterial({ color: 0xf6f2ff, roughness: 0.35, metalness: 0, emissive: 0x6a40c0, emissiveIntensity: 0.12, side: THREE.DoubleSide });
      const ghost = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, ghostMat);
      ghost.add(body);
      const dark = new THREE.MeshStandardMaterial({ color: 0x140d1c, roughness: 0.2 });
      const eyeGeo = new THREE.SphereGeometry(0.1, 24, 16);
      [-0.24, 0.24].forEach((x) => {
        const eye = new THREE.Mesh(eyeGeo, dark);
        eye.scale.set(0.95, 1.45, 0.5);
        eye.position.set(x, 0.72, 0.72);
        ghost.add(eye);
        const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        shine.position.set(x + 0.03, 0.8, 0.765);
        ghost.add(shine);
        const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshBasicMaterial({ color: 0xff8fb8, transparent: true, opacity: 0.45 }));
        cheek.position.set(x * 1.55, 0.52, 0.71);
        cheek.rotation.y = Math.atan2(x * 1.55, 0.69);
        cheek.scale.y = 0.6;
        ghost.add(cheek);
      });
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), dark);
      mouth.scale.set(1, 0.85, 0.4);
      mouth.position.set(0, 0.48, 0.79);
      ghost.add(mouth);
      // Little arms.
      [-1, 1].forEach((s) => {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.28, 6, 12), ghostMat);
        arm.position.set(s * 0.86, 0.2, 0.05);
        arm.rotation.z = s * 1.0;
        ghost.add(arm);
      });
      ghost.position.set(-0.55, 0.6, 0);
      ghost.scale.setScalar(0.95);
      rig.add(ghost);

      // ---- Carved pumpkin with a lit face ----
      const pumpGeo = new THREE.SphereGeometry(0.85, 72, 40);
      const pp = pumpGeo.attributes.position as InstanceType<typeof THREE.BufferAttribute>;
      const v = new THREE.Vector3();
      for (let i = 0; i < pp.count; i++) {
        v.fromBufferAttribute(pp, i);
        const phi = Math.atan2(v.z, v.x);
        const rib = 1 - 0.075 * Math.pow(Math.abs(Math.sin(phi * 4)), 0.5);
        v.x *= rib * 1.12;
        v.z *= rib * 1.12;
        v.y *= 0.78;
        pp.setXYZ(i, v.x, v.y, v.z);
      }
      pumpGeo.computeVertexNormals();
      const pumpkin = new THREE.Group();
      pumpkin.add(new THREE.Mesh(pumpGeo, new THREE.MeshStandardMaterial({ color: 0xe8701a, roughness: 0.55, emissive: 0x5a1a00, emissiveIntensity: 0.25 })));
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.32, 10), new THREE.MeshStandardMaterial({ color: 0x4b5d2a, roughness: 0.8 }));
      stem.position.y = 0.72;
      stem.rotation.z = -0.25;
      pumpkin.add(stem);
      const fire = new THREE.MeshBasicMaterial({ color: 0xffc35a });
      const tri = (pts: [number, number][]) => {
        const sh = new THREE.Shape();
        pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
        // Wrap the flat cut-out onto the pumpkin's front surface (ellipsoid 0.952 × 0.663).
        const g = new THREE.ShapeGeometry(sh);
        const a = g.attributes.position as InstanceType<typeof THREE.BufferAttribute>;
        for (let i = 0; i < a.count; i++) {
          const x = a.getX(i) / 0.952;
          const y = a.getY(i) / 0.663;
          a.setZ(i, 0.952 * Math.sqrt(Math.max(0, 1 - x * x - y * y)) + 0.012);
        }
        return g;
      };
      const face = new THREE.Group();
      face.add(new THREE.Mesh(tri([[-0.42, 0.12], [-0.12, 0.12], [-0.27, 0.36]]), fire));
      face.add(new THREE.Mesh(tri([[0.12, 0.12], [0.42, 0.12], [0.27, 0.36]]), fire));
      face.add(new THREE.Mesh(tri([[-0.08, -0.02], [0.08, -0.02], [0, 0.1]]), fire));
      face.add(
        new THREE.Mesh(
          tri([[-0.5, -0.16], [-0.34, -0.26], [-0.22, -0.18], [-0.1, -0.3], [0.04, -0.2], [0.16, -0.32], [0.28, -0.2], [0.4, -0.27], [0.5, -0.14], [0.3, -0.42], [0, -0.48], [-0.3, -0.42]]),
          fire,
        ),
      );
      pumpkin.add(face);
      pumpkin.position.set(0.85, -0.95, 0.2);
      pumpkin.scale.setScalar(0.9);
      pumpkin.rotation.y = -0.35;
      rig.add(pumpkin);

      // ---- Bats in orbit (flat silhouettes, flapping) ----
      const batShape = new THREE.Shape();
      batShape.moveTo(0, 0);
      batShape.quadraticCurveTo(-0.12, 0.12, -0.32, 0.06);
      batShape.quadraticCurveTo(-0.24, -0.02, -0.2, -0.06);
      batShape.quadraticCurveTo(-0.12, -0.02, -0.08, -0.08);
      batShape.quadraticCurveTo(-0.04, -0.03, 0, -0.07);
      batShape.quadraticCurveTo(0.04, -0.03, 0.08, -0.08);
      batShape.quadraticCurveTo(0.12, -0.02, 0.2, -0.06);
      batShape.quadraticCurveTo(0.24, -0.02, 0.32, 0.06);
      batShape.quadraticCurveTo(0.12, 0.12, 0, 0);
      const batGeo = new THREE.ShapeGeometry(batShape);
      const batMat = new THREE.MeshBasicMaterial({ color: 0x1a1024, side: THREE.DoubleSide });
      const bats = Array.from({ length: 5 }, (_, i) => {
        const b = new THREE.Mesh(batGeo, batMat);
        b.userData = { r: 1.7 + (i % 3) * 0.35, speed: 0.35 + i * 0.07, phase: (i / 5) * Math.PI * 2, h: 0.4 + (i % 2) * 0.7 };
        rig.add(b);
        return b;
      });

      // ---- Fireflies ----
      const N = 70;
      const fly = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        fly[i * 3] = (Math.random() - 0.5) * 6;
        fly[i * 3 + 1] = (Math.random() - 0.5) * 4;
        fly[i * 3 + 2] = (Math.random() - 0.5) * 3;
      }
      const flyGeo = new THREE.BufferGeometry();
      flyGeo.setAttribute("position", new THREE.BufferAttribute(fly, 3));
      const flyMat = new THREE.PointsMaterial({ color: 0xffcf7a, size: 0.045, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
      const flies = new THREE.Points(flyGeo, flyMat);
      rig.add(flies);

      // ---- Size, pointer, click ----
      const resize = () => {
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);

      const aim = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => {
        aim.x = (e.clientX / window.innerWidth - 0.5) * 2;
        aim.y = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let twirl = false;
      const onClick = (e: MouseEvent) => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.intersectObject(ghost, true).length && !twirl) {
          twirl = true;
          void funSfx("boo");
          gsap.delayedCall(0.3, () => void funSfx("giggle"));
          gsap.to(mouth.scale, { x: 1.8, y: 2.2, duration: 0.15, yoyo: true, repeat: 1, repeatDelay: 0.5 });
          gsap.to(ghost.rotation, { y: ghost.rotation.y + Math.PI * 2, duration: 1.1, ease: "back.inOut(1.6)", onComplete: () => void (twirl = false) });
          gsap.fromTo(ghost.scale, { x: 1.15, y: 0.8 }, { x: 0.95, y: 0.95, duration: 0.9, ease: "elastic.out(1, 0.35)" });
        } else if (ray.intersectObject(pumpkin, true).length) {
          void funSfx("pop");
          gsap.fromTo(pumpkin.scale, { x: 1.02, y: 0.78, z: 1.02 }, { x: 0.9, y: 0.9, z: 0.9, duration: 0.7, ease: "elastic.out(1.1, 0.3)" });
          gsap.fromTo(candle, { intensity: 40 }, { intensity: 14, duration: 0.8 });
        }
      };
      renderer.domElement.addEventListener("click", onClick);

      // ---- Loop ----
      const still = !hauntedMotion();
      let raf: number | null = null;
      let visible = true;
      const clock = new THREE.Clock();
      const render = () => {
        const t = clock.getElapsedTime();
        // Breathing hem.
        for (let i = 0; i < pos.count; i++) {
          const by = base[i * 3 + 1]!;
          if (by < 0.4) {
            const bx = base[i * 3]!;
            const bz = base[i * 3 + 2]!;
            const a = Math.atan2(bz, bx);
            const k = (0.4 - by) / 1.3;
            pos.setY(i, by + Math.sin(a * 7 + t * 3.2) * 0.07 * k);
            pos.setX(i, bx * (1 + Math.sin(t * 1.6 + a * 2) * 0.03 * k));
            pos.setZ(i, bz * (1 + Math.sin(t * 1.6 + a * 2) * 0.03 * k));
          }
        }
        pos.needsUpdate = true;
        ghost.position.y = 0.6 + Math.sin(t * 1.4) * 0.14;
        ghost.rotation.z = Math.sin(t * 0.9) * 0.06;
        if (!twirl) ghost.rotation.y = Math.sin(t * 0.5) * 0.25;
        candle.intensity = gsap.isTweening(candle) ? candle.intensity : 13 + Math.sin(t * 9) * 1.5 + Math.sin(t * 23) * 1;
        bats.forEach((b) => {
          const { r, speed, phase, h } = b.userData as { r: number; speed: number; phase: number; h: number };
          const a = t * speed + phase;
          b.position.set(Math.cos(a) * r, h + Math.sin(a * 2) * 0.2, Math.sin(a) * r * 0.6);
          b.rotation.y = -a + Math.PI / 2;
          b.scale.y = 0.55 + Math.abs(Math.sin(t * 14 + phase)) * 0.9;
        });
        for (let i = 0; i < N; i++) {
          fly[i * 3 + 1] = fly[i * 3 + 1]! + 0.003;
          if (fly[i * 3 + 1]! > 2) fly[i * 3 + 1] = -2;
        }
        flyGeo.attributes.position!.needsUpdate = true;
        flyMat.opacity = 0.55 + Math.sin(t * 2) * 0.25;
        rig.rotation.y += (aim.x * 0.35 - rig.rotation.y) * 0.05;
        rig.rotation.x += (aim.y * 0.12 - rig.rotation.x) * 0.05;
        renderer.render(scene, camera);
      };
      const loop = () => {
        render();
        raf = requestAnimationFrame(loop);
      };
      const play = () => {
        if (still) return render();
        if (raf === null && visible && !document.hidden) raf = requestAnimationFrame(loop);
      };
      const pause = () => {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
      };
      const io = new IntersectionObserver(([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) play();
        else pause();
      });
      io.observe(el);
      const onVis = () => (document.hidden ? pause() : play());
      document.addEventListener("visibilitychange", onVis);
      gsap.from(rig.position, { y: -1.5, duration: 1.4, ease: "back.out(1.4)" });
      gsap.from(rig.scale, { x: 0.6, y: 0.6, z: 0.6, duration: 1.4, ease: "back.out(1.4)" });
      play();

      cleanup = () => {
        pause();
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("click", onClick);
        gsap.killTweensOf([ghost.rotation, ghost.scale, mouth.scale, pumpkin.scale, candle, rig.position, rig.scale]);
        scene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          m.geometry?.dispose();
          const mat = m.material as InstanceType<typeof THREE.Material> | InstanceType<typeof THREE.Material>[] | undefined;
          (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={host} className={`spooky-scene haunt-only ${className}`} aria-hidden title="Click the ghost" />;
}
