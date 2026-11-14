// The landing hero as a small 3D city: six friends, the roads between them, and the fair middle.
// Loaded on demand. It opens as the flat plan the page already shows (same city, seen from straight
// above), rises into 3D, and settles back into the plan as it scrolls away.
// The camera is shifted every frame so the fair middle lands under `target` (the standing pig).
import {
  AmbientLight, BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, SRGBColorSpace, Scene, SphereGeometry, Sprite, SpriteMaterial,
  Vector3, WebGLRenderer,
} from 'three';
import { BLOCK, COLOURS, CREW, DASH, DISC, FOV, MIDDLE, PIN, WATER, cells, dashes as dashSpots, distance, route as routeOf } from './city';

const INK = 0x0b0b0d;
const PINK = 0xffa6fc;

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

const route = (x: number, z: number): Vector3[] => routeOf(x, z).map((p) => new Vector3(p.x, 0, p.z));

function along(path: Vector3[], t: number, out: Vector3): Vector3 {
  const a = path[0]!.distanceTo(path[1]!);
  const b = path[1]!.distanceTo(path[2]!);
  const d = t * (a + b);
  return d <= a ? out.lerpVectors(path[0]!, path[1]!, a ? d / a : 0) : out.lerpVectors(path[1]!, path[2]!, b ? (d - a) / b : 0);
}

/**
 * Draws the scene into `box`. The fair middle is kept under the bottom centre of `target`, so the
 * page's own mascot stands on it. Returns a function that stops and frees everything.
 */
export function mountHero(box: HTMLElement, target: HTMLElement | null, onReady: () => void): () => void {
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
  const water = new Mesh(new PlaneGeometry(160, WATER.depth), new MeshBasicMaterial({ color: COLOURS.water }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.01, WATER.z + WATER.depth / 2);
  city.add(water);

  // Blocks, in one draw call, flat-shaded so a block seen from above is the plan's flat colour.
  const all = cells();
  const blocks = new InstancedMesh(new BoxGeometry(BLOCK, 1, BLOCK), new MeshLambertMaterial({ color: 0xffffff }), all.length);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const tint = new Color();
  all.forEach((c, i) => {
    m4.compose(new Vector3(c.x, c.height / 2, c.z), q, new Vector3(1, c.height, 1));
    blocks.setMatrixAt(i, m4);
    blocks.setColorAt(i, c.park ? tint.set(COLOURS.park) : tint.set(COLOURS.block).offsetHSL(0, 0, c.shade));
  });
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  city.add(blocks);

  // The fair middle: a soft pink disc that breathes.
  const disc = new Mesh(new CircleGeometry(DISC, 64), new MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.42, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(MIDDLE.x, 0.2, MIDDLE.z);
  city.add(disc);

  // Routes: dashes laid on the road, and one walker per friend heading for the middle.
  const paths = CREW.map(([, x, z]) => route(x, z));
  const spots = dashSpots();
  const dashes = new InstancedMesh(new BoxGeometry(DASH.length, 0.02, DASH.width), new MeshBasicMaterial({ color: INK }), spots.length);
  const quarter = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  spots.forEach((d, i) => {
    m4.compose(new Vector3(d.x, 0.03, d.z), d.alongX ? q : quarter, new Vector3(1, 1, 1));
    dashes.setMatrixAt(i, m4);
  });
  city.add(dashes);
  const walkerGeo = new SphereGeometry(0.13, 16, 12);
  const walkerMat = new MeshBasicMaterial({ color: INK });
  const walkers = paths.map(() => { const w = new Mesh(walkerGeo, walkerMat); city.add(w); return w; });

  // The friends: black map pins with their initial.
  const head = new SphereGeometry(PIN.head, 28, 20);
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

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 160);
  let w = 0;
  let h = 0;
  // Where the middle should land, in pixels inside the box.
  let tx = 0;
  let ty = 0;
  const fit = () => {
    w = box.clientWidth;
    h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const b = box.getBoundingClientRect();
    const r = target?.getBoundingClientRect();
    tx = r && r.width ? r.left + r.width / 2 - b.left : w / 2;
    ty = r && r.height ? r.bottom - r.height * 0.06 - b.top : h * 0.62;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(box);
  if (target) ro.observe(target);
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
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
  const PLAN = Math.PI / 2 - 0.0005; // straight down: a flat city seen this way is exactly the drawn plan
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden || !w || !h) return;
    const t = (now - start) / 1000;
    // Design reviews can hold a frame with window.__hero = { a, s }. It only changes what is drawn.
    const freeze = (window as unknown as { __hero?: { a: number; s?: number } }).__hero;
    // Arrival: the city starts as the flat plan (matching the drawn map) and rises over 1.8 s.
    const arrive = freeze ? freeze.a : ease((t - 0.1) / 1.8);
    // Scroll: as the map leaves the middle of the screen, it settles back into the flat plan.
    const b = box.getBoundingClientRect();
    const away = freeze?.s !== undefined ? freeze.s : Math.min(Math.max((window.innerHeight / 2 - (b.top + b.height / 2)) / (window.innerHeight * 0.6), 0), 1);
    const flat = Math.max(1 - arrive, ease(away));
    easedX += (pointerX - easedX) * 0.05;
    easedY += (pointerY - easedY) * 0.05;
    const dist = distance(w, flat);
    const lift = 0.86 + (PLAN - 0.86) * flat + easedY * 0.05 * (1 - flat);
    const turn = ((w < 600 ? 0.3 : 0.5) + Math.sin(t * 0.12) * 0.07 + easedX * 0.22) * (1 - flat); // phones turn less, so the right-hand friends stay in the narrow frame
    blocks.scale.y = Math.max(1 - flat, 0.02);
    look.set(MIDDLE.x, 0, MIDDLE.z);
    camera.position.set(look.x + Math.sin(turn) * Math.cos(lift) * dist, Math.sin(lift) * dist, look.z + Math.cos(turn) * Math.cos(lift) * dist);
    camera.lookAt(look);
    camera.clearViewOffset();
    camera.updateMatrixWorld();
    feet.copy(look).project(camera);
    camera.setViewOffset(w, h, ((feet.x + 1) / 2) * w - tx, ((1 - feet.y) / 2) * h - ty, w, h);
    disc.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06 * (1 - flat));
    // Seen from above, a pin is the drawn map's circle and letter, so pins stay put throughout.
    pins.forEach((p, i) => { p.position.y = 0.12 + Math.sin(t * 1.4 + i * 1.3) * 0.08 * (1 - flat); });
    walkers.forEach((wk, i) => { along(paths[i]!, (t * 0.11 + i * 0.21) % 1, spot); wk.position.set(spot.x, 0.13, spot.z); wk.visible = arrive > 0.9; });
    renderer.render(scene, camera);
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
  };
}
