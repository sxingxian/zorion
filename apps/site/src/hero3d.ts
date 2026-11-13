// The landing hero as a small 3D city: five friends, the roads between them, and the fair middle.
// Loaded on demand. If WebGL is missing or the visitor prefers reduced motion, the drawn map stays.
import {
  AmbientLight, BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, SRGBColorSpace, Scene, SphereGeometry, Sprite, SpriteMaterial,
  Vector3, WebGLRenderer,
} from 'three';

const INK = 0x0b0b0d;
const PINK = 0xffa6fc;

// Blocks sit on whole numbers, so roads run along the halves. Everything that walks stays on a half.
const COLS = 17; // blocks reach from -COLS to COLS on x
const ROWS = 13; // and from -ROWS to ROWS on z
const MIDDLE = new Vector3(1.5, 0, -0.5);
const CREW: Array<[letter: string, x: number, z: number]> = [['M', -4.5, -2.5], ['S', -1.5, -3.5], ['A', 4.5, -3.5], ['L', 6.5, 0.5], ['P', -0.5, 3.5]];

/** Same numbers on every visit, so the skyline does not reshuffle. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function letterSprite(letter: string): Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.font = '700 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.62, 0.62, 1);
  s.renderOrder = 5;
  return s;
}

/** Along the road to the middle's street, then down that street: the way a person would walk it. */
const route = (x: number, z: number): Vector3[] => [new Vector3(x, 0, z), new Vector3(MIDDLE.x, 0, z), new Vector3(MIDDLE.x, 0, MIDDLE.z)];

function along(path: Vector3[], t: number, out: Vector3): Vector3 {
  const a = path[0]!.distanceTo(path[1]!);
  const b = path[1]!.distanceTo(path[2]!);
  const d = t * (a + b);
  return d <= a ? out.lerpVectors(path[0]!, path[1]!, a ? d / a : 0) : out.lerpVectors(path[1]!, path[2]!, b ? (d - a) / b : 0);
}

/**
 * Draws the scene into `box`. `anchor`, if given, is moved every frame to stand on the fair middle,
 * so the page's own mascot can stand in the scene. Returns a function that stops and frees everything.
 */
export function mountHero(box: HTMLElement, anchor: HTMLElement | null, onReady: () => void): () => void {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  box.appendChild(canvas);

  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 2.1));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 12, 5);
  scene.add(sun);
  const city = new Group();
  scene.add(city);

  // Ground: white roads. Water along the near edge, like the drawn map.
  const ground = new Mesh(new PlaneGeometry(160, 160), new MeshBasicMaterial({ color: 0xffffff }));
  ground.rotation.x = -Math.PI / 2;
  city.add(ground);
  const water = new Mesh(new PlaneGeometry(160, 60), new MeshBasicMaterial({ color: 0xdce6f2 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.01, ROWS + 30.6);
  city.add(water);

  // Blocks, in one draw call. Low near the middle so the meeting point reads clearly.
  const rand = seeded(20261113);
  const cells: Array<[x: number, z: number, h: number, park: boolean]> = [];
  for (let x = -COLS; x <= COLS; x++) for (let z = -ROWS; z <= ROWS; z++) {
    const near = Math.hypot(x - MIDDLE.x, z - MIDDLE.z);
    const park = x >= 5 && x <= 7 && z >= -7 && z <= -6;
    cells.push([x, z, park ? 0.04 : near < 2.6 ? 0.12 : 0.14 + rand() * rand() * 0.9, park]);
  }
  const blocks = new InstancedMesh(new BoxGeometry(0.78, 1, 0.78), new MeshLambertMaterial({ color: 0xffffff }), cells.length);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const tint = new Color();
  cells.forEach(([x, z, h, park], i) => {
    m4.compose(new Vector3(x, h / 2, z), q, new Vector3(1, h, 1));
    blocks.setMatrixAt(i, m4);
    blocks.setColorAt(i, park ? tint.set(0xdcebd6) : tint.set(0xececf0).offsetHSL(0, 0, (rand() - 0.5) * 0.03));
  });
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  city.add(blocks);

  // The fair middle: a soft pink disc that breathes.
  const disc = new Mesh(new CircleGeometry(2.3, 64), new MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.42, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(MIDDLE.x, 0.2, MIDDLE.z);
  city.add(disc);

  // Routes: dashes laid on the road, and one walker per friend heading for the middle.
  const paths = CREW.map(([, x, z]) => route(x, z));
  const dashAt: Array<[Vector3, boolean]> = [];
  for (const p of paths) for (let leg = 0; leg < 2; leg++) {
    const from = p[leg]!;
    const to = p[leg + 1]!;
    const len = from.distanceTo(to);
    for (let d = 0.55; d < len - 0.3; d += 0.42) dashAt.push([new Vector3().lerpVectors(from, to, d / len), leg === 0]);
  }
  const dashes = new InstancedMesh(new BoxGeometry(0.24, 0.02, 0.07), new MeshBasicMaterial({ color: INK }), dashAt.length);
  const quarter = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  dashAt.forEach(([at, alongX], i) => {
    m4.compose(new Vector3(at.x, 0.03, at.z), alongX ? q : quarter, new Vector3(1, 1, 1));
    dashes.setMatrixAt(i, m4);
  });
  city.add(dashes);
  const walkerGeo = new SphereGeometry(0.13, 16, 12);
  const walkerMat = new MeshBasicMaterial({ color: INK });
  const walkers = paths.map(() => { const w = new Mesh(walkerGeo, walkerMat); city.add(w); return w; });

  // The friends: black map pins with their initial.
  const head = new SphereGeometry(0.46, 28, 20);
  const tip = new ConeGeometry(0.3, 0.62, 24);
  const pinMat = new MeshLambertMaterial({ color: INK });
  const pins = CREW.map(([letter, x, z]) => {
    const g = new Group();
    const ball = new Mesh(head, pinMat);
    ball.position.y = 1.02;
    const cone = new Mesh(tip, pinMat);
    cone.rotation.x = Math.PI;
    cone.position.y = 0.36;
    const label = letterSprite(letter);
    label.position.y = 1.02;
    g.add(ball, cone, label);
    g.position.set(x, 0, z);
    city.add(g);
    return g;
  });

  const camera = new PerspectiveCamera(30, 1, 0.1, 120);
  let w = 0;
  let h = 0;
  let wide = true;
  const fit = () => {
    w = box.clientWidth;
    h = box.clientHeight;
    if (!w || !h) return;
    wide = w / h > 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Leave room for the headline card: scene to the right on wide screens, to the top on tall ones.
    if (wide) camera.setViewOffset(w, h, -w * 0.17, h * 0.02, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.16, w, h);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(box);
  fit();

  let pointerX = 0;
  let pointerY = 0;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    pointerX = e.clientX / window.innerWidth - 0.5;
    pointerY = e.clientY / window.innerHeight - 0.5;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  let visible = true;
  const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); }, { threshold: 0 });
  io.observe(box);

  const look = new Vector3();
  const spot = new Vector3();
  const feet = new Vector3();
  let easedX = 0;
  let easedY = 0;
  let raf = 0;
  let first = true;
  const start = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden || !w || !h) return;
    const t = (now - start) / 1000;
    const scrolled = Math.min(Math.max(window.scrollY / Math.max(h, 1), 0), 1);
    easedX += (pointerX - easedX) * 0.05;
    easedY += (pointerY - easedY) * 0.05;
    // A slow drift, a nudge from the pointer, and a dive toward street level as the page scrolls.
    const dist = wide ? 21 : 38;
    const lift = 0.86 - scrolled * 0.34 + easedY * 0.05;
    const turn = 0.5 + Math.sin(t * 0.12) * 0.07 + easedX * 0.22 + scrolled * 0.35;
    look.set(MIDDLE.x, 0, MIDDLE.z);
    camera.position.set(look.x + Math.sin(turn) * Math.cos(lift) * dist, Math.sin(lift) * dist, look.z + Math.cos(turn) * Math.cos(lift) * dist);
    camera.lookAt(look);
    disc.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06);
    pins.forEach((p, i) => { p.position.y = 0.12 + Math.sin(t * 1.4 + i * 1.3) * 0.08; });
    walkers.forEach((wk, i) => { along(paths[i]!, (t * 0.11 + i * 0.21) % 1, spot); wk.position.set(spot.x, 0.13, spot.z); });
    renderer.render(scene, camera);
    if (anchor) {
      feet.set(MIDDLE.x, 0.2, MIDDLE.z).project(camera);
      anchor.style.transform = `translate3d(${((feet.x + 1) / 2) * w}px, ${((1 - feet.y) / 2) * h}px, 0)`;
    }
    if (first) {
      first = false;
      onReady();
    }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener('pointermove', onMove);
    scene.traverse((o) => {
      const mesh = o as Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as { dispose?: () => void; map?: { dispose(): void } } | undefined;
      mat?.map?.dispose();
      mat?.dispose?.();
    });
    renderer.dispose();
    canvas.remove();
    if (anchor) anchor.style.transform = '';
  };
}
