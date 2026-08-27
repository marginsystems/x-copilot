import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  aimMove,
  cameraFollow,
  stepMove,
  type PlayVec2,
} from "./lib/playWorld";

const ASSET = (name: string) => `/play-assets/${name}`;

type Props = {
  lit: boolean;
  reducedMotion: boolean;
  inputRef: React.MutableRefObject<PlayVec2>;
  orbitRef: React.MutableRefObject<number>;
};

export function PlayWorld(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<{
    scene: THREE.Scene;
    hemi: THREE.HemisphereLight;
    sun: THREE.DirectionalLight;
    render: () => void;
  } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

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
    scene.background = new THREE.Color(props.lit ? 0x87b8dc : 0x4a6280);
    scene.fog = new THREE.Fog(scene.background, 14, 32);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    const hemi = new THREE.HemisphereLight(0xe8f2ff, 0x3d5a32, props.lit ? 1.15 : 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4d6, props.lit ? 1.1 : 0.45);
    sun.position.set(8, 14, 6);
    scene.add(sun);

    const player = new THREE.Group();
    player.position.set(0, 0, 2.4);
    scene.add(player);

    const pet = new THREE.Group();
    pet.position.set(1.6, 0, -1.2);
    scene.add(pet);

    const loader = new GLTFLoader();
    const load = (file: string) =>
      new Promise<THREE.Group | null>((resolve) => {
        loader.load(
          ASSET(file),
          (gltf) => resolve(gltf.scene),
          undefined,
          () => resolve(null),
        );
      });

    let alive = true;
    let raf = 0;
    let last = performance.now();
    let yaw = 0;
    let lastOrbit = props.orbitRef.current;
    const pos: PlayVec2 = { x: 0, z: 2.4 };

    const host = wrap;
    function renderFrame() {
      const cam = cameraFollow(pos, props.orbitRef.current);
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
    worldRef.current = { scene, hemi, sun, render: renderFrame };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    void (async () => {
      const [
        grass,
        grassLarge,
        fence,
        fenceCorner,
        tree,
        pine,
        tuft,
        flowers,
        chest,
        crate,
        flag,
        hero,
        buddy,
      ] = await Promise.all([
        load("block-grass.glb"),
        load("block-grass-large.glb"),
        load("fence-straight.glb"),
        load("fence-corner.glb"),
        load("tree.glb"),
        load("tree-pine.glb"),
        load("grass.glb"),
        load("flowers.glb"),
        load("chest.glb"),
        load("crate.glb"),
        load("flag.glb"),
        load("character-ooli.glb"),
        load("character-oobi.glb"),
      ]);
      if (!alive) return;

      const tile = 1.05;
      for (let ix = -7; ix <= 7; ix += 1) {
        for (let iz = -7; iz <= 7; iz += 1) {
          const g = (Math.abs(ix) + Math.abs(iz)) % 3 === 0 ? grassLarge : grass;
          if (!g) continue;
          const n = g.clone();
          n.position.set(ix * tile, 0, iz * tile);
          scene.add(n);
        }
      }

      const placeFence = (x: number, z: number, rot: number, corner = false) => {
        const f = corner ? fenceCorner : fence;
        if (!f) return;
        const n = f.clone();
        n.position.set(x, 0, z);
        n.rotation.y = rot;
        scene.add(n);
      };
      const edge = 7.4;
      for (let i = -6; i <= 6; i += 1) {
        placeFence(i * tile, -edge, 0);
        placeFence(i * tile, edge, Math.PI);
        placeFence(-edge, i * tile, Math.PI / 2);
        placeFence(edge, i * tile, -Math.PI / 2);
      }
      placeFence(-edge, -edge, 0, true);
      placeFence(edge, -edge, -Math.PI / 2, true);
      placeFence(-edge, edge, Math.PI / 2, true);
      placeFence(edge, edge, Math.PI, true);

      const deco = [
        { m: tree, x: -9.2, z: -8.4 },
        { m: pine, x: 9.4, z: -7.8 },
        { m: tree, x: -8.8, z: 9.1 },
        { m: pine, x: 9.6, z: 8.6 },
        { m: tuft, x: -2.2, z: 3.1 },
        { m: flowers, x: 2.8, z: 2.4 },
        { m: tuft, x: -3.4, z: -2.6 },
        { m: flowers, x: 3.6, z: -3.2 },
      ];
      for (const row of deco) {
        if (!row.m) continue;
        const n = row.m.clone();
        n.position.set(row.x, 0, row.z);
        scene.add(n);
      }

      if (chest) {
        chest.position.set(0, 0, -1.4);
        scene.add(chest);
      }
      if (crate) {
        crate.position.set(-2.1, 0, -1.1);
        scene.add(crate);
      }
      if (flag) {
        flag.position.set(2.2, 0, -1.6);
        scene.add(flag);
      }

      if (hero) {
        hero.rotation.y = Math.PI;
        player.add(hero);
      }
      if (buddy) {
        buddy.rotation.y = Math.PI * 0.2;
        pet.add(buddy);
      }
      if (props.reducedMotion) renderFrame();
    })();

    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const input = props.inputRef.current;
      const orbit = props.orbitRef.current;
      if (
        props.reducedMotion &&
        input.x === 0 &&
        input.z === 0 &&
        orbit === lastOrbit
      ) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastOrbit = orbit;
      const next = stepMove(pos, aimMove(input, orbit), dt, yaw);
      pos.x = next.pos.x;
      pos.z = next.pos.z;
      if (next.moving) yaw = next.yaw;
      player.position.set(pos.x, 0, pos.z);
      player.rotation.y = yaw;
      pet.position.y = 0.04 * Math.sin(now / 280);
      const cam = cameraFollow(pos, orbit);
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.lookX, cam.lookY, cam.lookZ);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    if (props.reducedMotion) {
      renderFrame();
    }
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      worldRef.current = null;
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
  }, [props.reducedMotion, props.inputRef, props.orbitRef]);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.scene.background = new THREE.Color(props.lit ? 0x87b8dc : 0x4a6280);
    world.scene.fog?.color.copy(world.scene.background);
    world.hemi.intensity = props.lit ? 1.15 : 0.7;
    world.sun.intensity = props.lit ? 1.1 : 0.45;
    world.render();
  }, [props.lit]);

  return (
    <div className="play-world-stage" ref={wrapRef}>
      <canvas ref={canvasRef} className="play-world-canvas" />
    </div>
  );
}
