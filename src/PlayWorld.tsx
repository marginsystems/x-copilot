import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { autoOrbit, cameraFromOrbit, type PlayOrbit } from "./lib/playWorld";

const PLANE = "/play-assets/cesium-air.glb";
const WINGSPAN = 8;

type Props = {
  lit: boolean;
  reducedMotion: boolean;
  orbitRef: React.MutableRefObject<PlayOrbit>;
  orbitingRef: React.MutableRefObject<boolean>;
};

function duskSky(lit: boolean): number {
  return lit ? 0x1c2240 : 0x0b101c;
}

function duskFog(lit: boolean): number {
  return lit ? 0x2a2038 : 0x0b101c;
}

function addApron(scene: THREE.Scene, lit: boolean): THREE.Group {
  const root = new THREE.Group();
  root.name = "apron";

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 90),
    new THREE.MeshStandardMaterial({ color: 0x2c2e36, roughness: 0.92 }),
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, 0.01, -18);
  root.add(runway);

  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 18),
    new THREE.MeshStandardMaterial({ color: 0x32343c, roughness: 0.9 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.015, 4);
  root.add(pad);

  const dashMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2b8,
    emissive: lit ? 0x3a3420 : 0x000000,
    roughness: 0.7,
  });
  for (let i = -10; i <= 8; i += 1) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 1.6), dashMat);
    dash.position.set(0, 0.03, -4 - i * 3.4);
    root.add(dash);
  }

  const hangar = new THREE.Group();
  hangar.position.set(-11, 0, 6);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a414c, roughness: 0.75, metalness: 0.2 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.35, 12), metal);
  roof.position.set(0, 5.1, 0);
  hangar.add(roof);
  const back = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 0.35), metal);
  back.position.set(0, 2.5, -5.8);
  hangar.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5, 12), metal);
  left.position.set(-4.8, 2.5, 0);
  hangar.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5, 12), metal);
  right.position.set(4.8, 2.5, 0);
  hangar.add(right);
  const interior = new THREE.PointLight(0xffc27a, lit ? 1.4 : 0.15, 16, 2);
  interior.position.set(0, 3.4, 0);
  hangar.add(interior);
  root.add(hangar);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a4e56 }),
  );
  pole.position.set(8.4, 2.1, 7.2);
  root.add(pole);
  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0xc45a3a, roughness: 0.6 }),
  );
  sock.rotation.z = Math.PI / 2;
  sock.position.set(9.2, 3.9, 7.2);
  sock.name = "windsock";
  root.add(sock);

  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: lit ? 0xffc15a : 0x000000,
    emissiveIntensity: lit ? 1.6 : 0,
  });
  for (const x of [-4.1, 4.1]) {
    for (let z = 12; z >= -48; z -= 6) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), lampMat);
      lamp.position.set(x, 0.18, z);
      root.add(lamp);
    }
  }

  scene.add(root);
  return root;
}

function fitPlane(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 0.001);
  model.scale.setScalar(WINGSPAN / span);
  const grounded = new THREE.Box3().setFromObject(model);
  model.position.y -= grounded.min.y;
  model.position.z = 2.2;
}

export function PlayWorld(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<{
    scene: THREE.Scene;
    hemi: THREE.HemisphereLight;
    sun: THREE.DirectionalLight;
    setLit: (lit: boolean) => void;
    render: () => void;
  } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const host = wrap;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(duskSky(props.lit));
    scene.fog = new THREE.Fog(duskFog(props.lit), 28, 90);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 160);
    const hemi = new THREE.HemisphereLight(0xffc9a8, 0x1a1524, props.lit ? 0.95 : 0.4);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xff9a62, props.lit ? 1.15 : 0.25);
    sun.position.set(-18, 8, 10);
    scene.add(sun);

    const apron = addApron(scene, props.lit);

    let mixer: THREE.AnimationMixer | null = null;
    const loader = new GLTFLoader();

    let alive = true;
    let raf = 0;
    let last = performance.now();
    let idleSec = 0;

    function renderFrame() {
      const cam = cameraFromOrbit(props.orbitRef.current);
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.lookX, cam.lookY, cam.lookZ);
      renderer.render(scene, camera);
    }

    function resize() {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 2 || h < 2) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (props.reducedMotion) renderFrame();
    }

    const setLit = (lit: boolean) => {
      scene.background = new THREE.Color(duskSky(lit));
      scene.fog = new THREE.Fog(duskFog(lit), 28, 90);
      hemi.intensity = lit ? 0.95 : 0.4;
      sun.intensity = lit ? 1.15 : 0.25;
      apron.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (!mat?.emissive) return;
        if (mesh.geometry?.type === "SphereGeometry") {
          mat.emissive.setHex(lit ? 0xffc15a : 0x000000);
          mat.emissiveIntensity = lit ? 1.6 : 0;
        } else {
          mat.emissive.setHex(lit ? 0x3a3420 : 0x000000);
        }
      });
      scene.traverse((obj) => {
        if (obj instanceof THREE.PointLight) obj.intensity = lit ? 1.4 : 0.15;
      });
      renderFrame();
    };

    worldRef.current = { scene, hemi, sun, setLit, render: renderFrame };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    loader.load(
      PLANE,
      (gltf) => {
        if (!alive) return;
        fitPlane(gltf.scene);
        scene.add(gltf.scene);
        if (gltf.animations.length > 0 && !props.reducedMotion) {
          mixer = new THREE.AnimationMixer(gltf.scene);
          for (const clip of gltf.animations) mixer.clipAction(clip).play();
        }
        renderFrame();
      },
      undefined,
      () => {
        if (!alive) return;
        const fallback = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 0.7, 4.4),
          new THREE.MeshStandardMaterial({ color: 0x7eb8dc }),
        );
        fallback.position.set(0, 0.35, 2.2);
        scene.add(fallback);
        renderFrame();
      },
    );

    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (props.orbitingRef.current) idleSec = 0;
      else idleSec += dt;
      if (!props.reducedMotion) {
        props.orbitRef.current = autoOrbit(
          props.orbitRef.current,
          dt,
          idleSec,
          false,
        );
        mixer?.update(dt);
      }
      renderFrame();
      raf = requestAnimationFrame(tick);
    };

    renderFrame();
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      worldRef.current = null;
      mixer?.stopAllAction();
      ro.disconnect();
      renderer.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
    };
  }, [props.reducedMotion, props.orbitRef, props.orbitingRef]);

  useEffect(() => {
    worldRef.current?.setLit(props.lit);
  }, [props.lit]);

  return (
    <div className="play-world-stage" ref={wrapRef}>
      <canvas ref={canvasRef} className="play-world-canvas" />
    </div>
  );
}
