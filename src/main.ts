import "./style.css";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { loadFlightAssets, type FlightAssets } from "./flight-assets";
import { FlightCamera, fitCameraFov } from "./camera";
import { addAirframeInk } from "./airframe-ink";
import { analogFilmFragment } from "./analog-film";
import { createEngineExhaust, updateEngineExhaust } from "./engine-exhaust";
import { AileronControls } from "./aileron-controls";
import { RobotControls } from "./robot-controls";
import { Input } from "./input";
import {
  sweepTerrain,
  gentleRobotContact,
  type TerrainContact,
} from "./terrain-contact";
import { CrashEffects } from "./crash-effects";
import { ControllerMenu } from "./controller-menu";
import { defaults, loadPreferences, savePreferences } from "./preferences.mjs";
import { navigationMarker } from "./navigation.mjs";
import { HudGuidance } from "./hud-guidance";
import { cycleLandmark, landmarkGuidance } from "./landmarks.mjs";
import { cameraContact } from "./targeting.mjs";
import { Sound } from "./audio";
import { World, RADIUS, surface, toonRamp } from "./world";
import {
  damp,
  clamp,
  advanceTransform,
  firstProjectileImpact,
  flightProfile,
  advanceAfterburner,
  interceptTime,
} from "./flight.mjs";
const $ = <E extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as E;
const show = (id: string, value = true) =>
  $(id).classList.toggle("hidden", !value);
$("start-label").textContent = "Loading flight assets…";
let loadedFiles = 0;
const loadingProgress = () => {
  loadedFiles++;
  $("entry-status").textContent =
    `Preparing your flight · ${loadedFiles} files loaded`;
};
T.DefaultLoadingManager.onProgress = loadingProgress;
const scene = new T.Scene(),
  camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 14000);
const renderer = new T.WebGLRenderer({
  canvas: $<HTMLCanvasElement>("world"),
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
const world = new World(scene),
  input = new Input(),
  controllerMenu = new ControllerMenu(),
  sound = new Sound(),
  chaseCamera = new FlightCamera(camera);
const preferences = loadPreferences();
const hudGuidance = new HudGuidance($("target-marker"), $("hud"));
let rollAge = 2,
  rollDirection = 1,
  rollX = 0,
  rollY = 0;
let terrainProbeAge = 0,
  terrainHold = 0,
  terrainDistance: number | null = null;
const flightDirection = new T.Vector3();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const lens = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    bend: { value: 0.09 },
    aspect: { value: innerWidth / innerHeight },
    analog: { value: preferences.analog },
  },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: analogFilmFragment,
});
composer.addPass(lens);
composer.addPass(new OutputPass());
const hero = new T.Group();
scene.add(hero);
let model: T.Group | null = null,
  ailerons: AileronControls | null = null,
  robotControls: RobotControls | null = null,
  mixer: T.AnimationMixer | null = null,
  clip: T.AnimationClip | null = null,
  action: T.AnimationAction | null = null,
  ready = false;
type Mode =
  "entry" | "title" | "flight" | "paused" | "crash" | "result" | "hangar";
let mode: Mode = "entry";
let pausedFrom: "flight" | "crash" = "flight";
let entering = false;
let radioName = "";
let hangarYaw = 0,
  hangarHeight = 12,
  hangarIdle = 4;
let last = performance.now(),
  clock = 0,
  flightTime = 0,
  alt = 110,
  speed = 65,
  pitch = 0,
  bank = 0,
  boostEnergy = 1,
  boostRecovering = false,
  activeThrust = 0,
  hull = 100,
  transform = 0,
  transformTarget = 0,
  fireTimer = 0,
  radioTimer = 0,
  noticeTimer = 0,
  invulnerable = 0,
  mission = 0,
  checkpoint = 0,
  kills = 0,
  free = false,
  lookYaw = 0,
  lookPitch = 0,
  hideHud = false;
let position = surface(0, 180, 110),
  forward = new T.Vector3(0, 0, -1),
  up = position.clone().normalize();
forward.projectOnPlane(up).normalize();
const v = new T.Vector3(),
  w = new T.Vector3(),
  right = new T.Vector3(),
  basis = new T.Matrix4(),
  q = new T.Quaternion(),
  targetCamera = new T.Vector3();
const ringMat = new T.MeshBasicMaterial({
  color: "#fff0b6",
  transparent: true,
  opacity: 0.85,
});
const rings: T.Group[] = [];
const gatePositions = [
  surface(0, -155, 110),
  surface(30, -475, 118),
  surface(-45, -840, 135),
];
gatePositions.forEach((p, i) => {
  const g = new T.Group();
  g.position.copy(p);
  const dir = (gatePositions[i + 1] ?? surface(-60, -1200, 145))
    .clone()
    .sub(p)
    .normalize();
  g.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
  scene.add(g);
  rings.push(g);
});
const returnRing = new T.Group();
returnRing.position.copy(surface(100, -80, 125));
returnRing.visible = false;
scene.add(returnRing);
const trailCount = 95,
  trailLeft: T.Vector3[] = [],
  trailRight: T.Vector3[] = [];
let trailGeo: T.BufferGeometry;
let trailArray: Float32Array;
let trails: T.LineSegments | null = null;
const trailMat = new T.LineBasicMaterial({
  color: "#eff8e2",
  transparent: true,
  opacity: 0.34,
});
const exhausts: T.Mesh[] = [];
let flightAssets: FlightAssets;
let crashEffects: CrashEffects;
let impactLoss = false;
const crashCameraStart = new T.Vector3();
const crashCameraEnd = new T.Vector3();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function installFlightAssets(assets: FlightAssets) {
  flightAssets = assets;
  crashEffects = new CrashEffects(assets);
  scene.add(crashEffects.group);
  for (const gate of rings)
    gate.add(new T.Mesh(assets.geometry["nav-gate"], ringMat));
  const returnMesh = new T.Mesh(
    assets.geometry["nav-gate"],
    new T.MeshBasicMaterial({ color: "#bef8d0" }),
  );
  returnMesh.scale.setScalar(1.2);
  returnRing.add(returnMesh);
  trailGeo = assets.geometry.contrail.clone();
  trailGeo.setIndex(null);
  trailArray = trailGeo.attributes.position.array as Float32Array;
  trailGeo.setDrawRange(0, (trailCount - 1) * 2);
  trails = new T.LineSegments(trailGeo, trailMat);
  trails.frustumCulled = false;
  scene.add(trails);
}
type Enemy = {
  mesh: T.Group;
  center: T.Vector3;
  hp: number;
  phase: number;
  shot: number;
  mixer: T.AnimationMixer;
  velocity: T.Vector3;
  up: T.Vector3;
  tangent: T.Vector3;
  depth: T.Vector3;
};
const FRIENDLY_SPEED = 370;
const FRIENDLY_LIFETIME = 2.2;
const enemies: Enemy[] = [];
type Bolt = { mesh: T.Mesh; vel: T.Vector3; life: number; enemy: boolean };
const bolts: Bolt[] = [];
type Particle = { mesh: T.Mesh; vel: T.Vector3; life: number; max: number };
const particles: Particle[] = [];
const friendlyMat = new T.MeshBasicMaterial({ color: "#fff7ae" });
const hostileMat = new T.MeshBasicMaterial({ color: "#ff6c37" });
let locked: Enemy | null = null;
let cameraThreat: Enemy | null = null;
let landmarkIndex = 0;
let landmarkArrived = false;
function scenicGuidance() {
  const destination = free ? world.landmarks[landmarkIndex] : null;
  return destination
    ? landmarkGuidance(position, destination, flightDirection, RADIUS)
    : null;
}
function sortieGuidance() {
  if (free || mission === 1) return null;
  const point = mission === 0 ? rings[checkpoint]?.position : returnRing.position;
  return point
    ? landmarkGuidance(
        position,
        { approach: point, lookAt: point },
        flightDirection,
        RADIUS,
      )
    : null;
}
function selectLandmark(step: number) {
  if (!free || mode !== "flight") return;
  landmarkIndex = cycleLandmark(landmarkIndex, step, world.landmarks.length);
  landmarkArrived = false;
  updateDestination();
}
function updateDestination() {
  const landmark = world.landmarks[landmarkIndex];
  $("mission-kicker").textContent = "PELAGIC ISLANDS / FREE FLIGHT";
  $("mission-name").textContent = landmark?.name ?? "The open sky";
  $("mission-hint").textContent = landmark
    ? "Fly to the scenic approach · Hold X / T to look"
    : "Explore freely · Hold X / T to find Halcyon";
  $("landmark-count").textContent = landmark
    ? `${String(landmarkIndex + 1).padStart(2, "0")} / ${world.landmarks.length} · D-pad / [ ]`
    : "NO DESTINATION · D-pad / [ ]";
}
function guidanceTarget(): T.Vector3 | null {
  if (free)
    return (
      scenicGuidance()?.point ?? (input.track ? world.carrier.position : null)
    );
  if (mission !== 1) return sortieGuidance()?.point ?? null;
  const threat = cameraContact(
    enemies,
    locked,
    input.track ? cameraThreat : null,
    position,
  );
  return threat?.mesh.position ?? null;
}
const loader = new GLTFLoader();
async function load() {
  try {
    const [gltf, carrier, assets] = await Promise.all([
      loader.loadAsync("/models/markos.glb"),
      loader.loadAsync("/models/carrier.glb"),
      loadFlightAssets(),
      world.ready,
      sound.prepare(loadingProgress),
      // Hidden flight/menu text would otherwise load its font on first use.
      Promise.all(
        [
          '400 12px "DM Sans"',
          '500 12px "DM Sans"',
          '600 12px "DM Sans"',
          '700 12px "DM Sans"',
          '400 28px "Barlow Condensed"',
          '500 28px "Barlow Condensed"',
          '600 28px "Barlow Condensed"',
          '700 28px "Barlow Condensed"',
          'italic 900 70px "Barlow Condensed"',
        ].map((font) => document.fonts.load(font)),
      ),
    ]);
    installFlightAssets(assets);
    model = gltf.scene;
    model.traverse((o) => {
      if (o instanceof T.Mesh) {
        const src = o.material as T.MeshStandardMaterial;
        if (src.map) {
          src.map.anisotropy = Math.min(
            8,
            renderer.capabilities.getMaxAnisotropy(),
          );
        }
        const mat = new T.MeshToonMaterial({
          map: src.map,
          color: src.color,
          side: src.side,
          gradientMap: toonRamp,
        });
        o.material = mat;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    hero.add(model);
    addAirframeInk(model);
    exhausts.push(...createEngineExhaust(model, assets.geometry.exhaust));
    clip =
      gltf.animations.find((a) => a.name === "Transform") ?? gltf.animations[0];
    if (!clip) throw new Error("Transformation animation missing");
    mixer = new T.AnimationMixer(model);
    action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    mixer.update(0);
    ailerons = new AileronControls(model, gltf.animations);
    robotControls = new RobotControls(model, gltf.animations);
    const bounds = new T.Box3().setFromObject(carrier.scene),
      size = bounds.getSize(new T.Vector3());
    carrier.scene.scale.setScalar(145 / Math.max(size.x, size.y, size.z));
    carrier.scene.traverse((o) => {
      if (o instanceof T.Mesh) o.receiveShadow = true;
    });
    carrier.scene.rotation.y = Math.PI;
    world.carrier.add(carrier.scene);
    ready = true;
    $<HTMLButtonElement>("start").disabled = false;
    $<HTMLButtonElement>("hangar").disabled = false;
    $("start-label").textContent = "Begin sortie";
    $("entry-loading").classList.add("complete");
    $("entry-status").textContent =
      "Aircraft and islands ready. Your sky awaits.";
    $("entry-label").textContent = "Enter the sky";
    $<HTMLButtonElement>("enter-sky").disabled = false;
    $("enter-sky").focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    $("loading-error").textContent = ready
      ? "A required scene asset could not load. Reload to retry."
      : `Aircraft could not load. ${String(error)}\nReload to try again.`;
    show("loading-error");
    show("loading-retry");
    $("entry-status").textContent =
      "The flight could not be prepared. Please try again.";
    $("entry-loading").classList.add("failed");
  }
}
void load().then(
  () => ($<HTMLButtonElement>("title-freeflight").disabled = !ready),
);
$("title-freeflight").onclick = () => start(true);
async function enterSky(event: MouseEvent) {
  if (!ready || entering || mode !== "entry") return;
  // Gamepad polling alone is not a browser audio activation gesture.
  if (!event.isTrusted && sound.context?.state !== "running") {
    $("entry-hint").textContent =
      "Click Enter the sky or press Enter once to enable sound. Then use your controller.";
    show("entry-hint");
    show("enter-silent");
    return;
  }
  entering = true;
  $<HTMLButtonElement>("enter-sky").disabled = true;
  $("entry-label").textContent = "Opening the sky…";
  $("entry-status").textContent = "Starting the soundtrack…";
  const playing = await sound.unlock();
  entering = false;
  $<HTMLButtonElement>("enter-sky").disabled = false;
  $("entry-label").textContent = "Enter the sky";
  if (mode !== "entry") return;
  if (playing) revealTitle();
  else {
    $("entry-status").textContent = "Sound couldn’t start just yet.";
    $("entry-hint").textContent =
      "Click to retry, or enter quietly and enable sound later.";
    show("entry-hint");
    show("enter-silent");
    $("enter-sky").focus({ preventScroll: true });
  }
}
function revealTitle() {
  input.keys.clear();
  input.pending.clear();
  setMode("title");
  $("start").focus({ preventScroll: true });
}
$("enter-sky").onclick = enterSky;
$("enter-silent").onclick = () => {
  if (!ready || entering) return;
  if (!sound.muted) mute();
  revealTitle();
};
// Recover an interrupted context on a later real gesture, never before entry.
for (const event of ["pointerdown", "keydown"])
  document.addEventListener(event, () => {
    if (mode !== "entry" && !sound.muted && sound.context?.state !== "running")
      void sound.unlock();
  });
function radio(name: string, text: string, pilot = false) {
  radioName = name;
  $("radio-speaker").textContent = pilot
    ? "REN / MARKOS 01"
    : "LYRA / FLIGHT CONTROL";
  $("radio-text").textContent = text;
  show("radio");
  radioTimer = 6;
  sound.play(name, 0.85);
}
function notice(text: string, seconds = 3) {
  $("notice").textContent = text;
  noticeTimer = seconds;
}
function setMode(next: Mode) {
  mode = next;
  if (next === "title" || next === "hangar") {
    hero.visible = true;
    crashEffects?.clear();
    ailerons?.reset();
    robotControls?.reset();
  }
  if (next === "hangar") {
    hangarYaw = 0;
    hangarHeight = 12;
    hangarIdle = 4;
  }
  input.gameplay = next === "flight";
  if (input.gameplay && document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
  if (next === "title") {
    transform = transformTarget = 0;
    if (action && mixer) {
      action.time = 0;
      mixer.update(0);
    }
  }
  show("title", next === "title");
  show("entry", next === "entry");
  document.body.classList.toggle("awaiting-entry", next === "entry");
  document.body.classList.toggle("revealing-title", next === "title");
  show("hud", next === "flight" && !hideHud);
  show("pause-screen", next === "paused");
  show("result", next === "result");
  show("hangar-screen", next === "hangar");
  document.body.classList.toggle("playing", next === "flight");
}
function start(isFree = false) {
  if (!ready) return;
  void sound.unlock();
  reset();
  free = isFree;
  setMode("flight");
  show("landmark-controls", free);
  if (free) {
    rings.forEach((r) => (r.visible = false));
    updateDestination();
    show("progress", false);
  } else {
    updateMission();
    radio("launch", "Markos, your flight corridor is clear. Enjoy the sky.");
  }
  input.rumble(0.15, 180);
}
function reset() {
  hero.visible = true;
  crashEffects?.clear();
  impactLoss = false;
  sound.cancel(radioName);
  radioName = "";
  chaseCamera.reset();
  terrainProbeAge = terrainHold = 0;
  terrainDistance = null;
  show("terrain-cue", false);
  rollAge = 2;
  rollX = rollY = 0;
  cameraThreat = null;
  landmarkIndex = 0;
  landmarkArrived = false;
  position.copy(surface(0, 180, 110));
  up.copy(position).normalize();
  forward.set(0, 0, -1).projectOnPlane(up).normalize();
  alt = 110;
  speed = 65;
  pitch = bank = 0;
  ailerons?.reset();
  robotControls?.reset();
  transform = transformTarget = 0;
  hull = 100;
  boostEnergy = 1;
  boostRecovering = false;
  activeThrust = 0;
  kills = checkpoint = mission = 0;
  flightTime = 0;
  free = false;
  invulnerable = 3;
  fireTimer = 0;
  radioTimer = 0;
  noticeTimer = 0;
  $("notice").textContent = "";
  show("radio", false);
  show("transform-status", false);
  show("progress");
  lookYaw = lookPitch = 0;
  for (const e of enemies) disposeEnemy(e);
  enemies.length = 0;
  for (const b of bolts) scene.remove(b.mesh);
  bolts.length = 0;
  for (const p of particles) {
    scene.remove(p.mesh);
    (p.mesh.material as T.Material).dispose();
  }
  particles.length = 0;
  trailLeft.length = trailRight.length = 0;
  rings.forEach((r) => (r.visible = true));
  returnRing.visible = false;
  camera.position
    .copy(position)
    .addScaledVector(forward, -24)
    .addScaledVector(up, 9);
}
function updateMission() {
  const titles = [
    "Follow the wind",
    "Protect the Halcyon",
    "Bring your wings home",
  ];
  const hints = [
    "Fly through the three navigation gates.",
    "Transform for a wider lock. Clear six interceptor drones.",
    "Rendezvous with the carrier at the green beacon.",
  ];
  $("mission-kicker").textContent = [
    "01 / RECONNAISSANCE",
    "02 / INTERCEPTION",
    "03 / RENDEZVOUS",
  ][mission];
  $("mission-name").textContent = titles[mission];
  $("mission-hint").textContent = hints[mission];
  $("progress").innerHTML = Array.from(
    { length: mission === 1 ? 6 : 3 },
    (_, i) =>
      `<i class="${i < (mission === 1 ? kills : checkpoint) ? "done" : ""}"></i>`,
  ).join("");
}
function changeTransform() {
  if (!ready) return;
  transformTarget = transformTarget ? 0 : 1;
  sound.play("transformation", 0.65);
  if (transformTarget && mode === "flight")
    radio("transform", "Transformation. Combat configuration, online!", true);
  else if (!transformTarget) {
    sound.cancel("transform");
    if (radioName === "transform") {
      radioTimer = 0;
      radioName = "";
      show("radio", false);
    }
  }
  input.rumble(0.55, 700);
}
function pause(reason = "Take your time. The sky will wait.") {
  if (mode === "flight" || mode === "crash") {
    pausedFrom = mode;
    $("pause-reason").textContent = reason;
    setMode("paused");
    input.keys.clear();
  }
}
function resume() {
  void sound.unlock();
  setMode(pausedFrom);
  last = performance.now();
}
$("start").onclick = () => start();
$("pause").onclick = () => {
  if (mode === "flight" || mode === "crash") pause();
  else if (mode === "paused") resume();
};
$("resume").onclick = resume;
$("restart").onclick = () => start();
$("return-title").onclick = () => {
  reset();
  setMode("title");
};
$("again").onclick = () => start(free);
$("freeflight").onclick = () => start(true);
$("landmark-prev").onclick = () => selectLandmark(-1);
$("landmark-next").onclick = () => selectLandmark(1);
$("restart").onclick = () => start(free);
$("hangar").onclick = () => {
  void sound.unlock();
  transform = transformTarget = 0;
  setMode("hangar");
};
$("hangar-back").onclick = () => {
  transform = transformTarget = 0;
  setMode("title");
};
$("hangar-transform").onclick = changeTransform;
function mute() {
  if (!sound.muted && sound.context?.state !== "running" && mode !== "entry") {
    void sound.unlock();
    return;
  }
  const muted = sound.toggle();
  if (!muted && mode !== "entry") void sound.unlock();
  $("sound").textContent = muted ? "×" : "♪";
  $("sound").setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
}
$("sound").onclick = mute;
function cameraChanged(name: string) {
  $("camera-cycle").textContent = name;
  $<HTMLSelectElement>("camera-style").value = String(chaseCamera.distanceMode);
  preferences.cameraStyle = chaseCamera.distanceMode;
  savePreferences(preferences);
  const control = $("camera-cycle");
  control.setAttribute("aria-label", `Cycle camera: ${name}`);
  control.animate(
    [
      { backgroundColor: "#fff0bf66", borderColor: "#fff0bf" },
      { backgroundColor: "#163e5140", borderColor: "#fff4dc55" },
    ],
    { duration: reducedMotion ? 0 : 700 },
  );
}
$("camera-cycle").onclick = () => cameraChanged(chaseCamera.cycle());
$<HTMLSelectElement>("camera-style").onchange = (e) =>
  cameraChanged(
    chaseCamera.select(Number((e.target as HTMLSelectElement).value)),
  );
function applyPreferences() {
  input.sensitivity = preferences.sensitivity;
  input.cameraSensitivity = preferences.cameraSensitivity;
  input.deadZone = preferences.deadZone;
  input.precision = preferences.precision;
  input.invert = preferences.invert;
  input.invertCamera = preferences.invertCamera;
  chaseCamera.autoReturn = preferences.autoReturn;
  chaseCamera.select(preferences.cameraStyle);
  $("camera-cycle").textContent = FlightCamera.names[chaseCamera.distanceMode];
  $("camera-cycle").setAttribute(
    "aria-label",
    `Cycle camera: ${FlightCamera.names[chaseCamera.distanceMode]}`,
  );
  $<HTMLSelectElement>("camera-style").value = String(chaseCamera.distanceMode);
  sound.music(preferences.music);
  lens.uniforms.analog.value = preferences.analog;
}
const syncPreferenceControls: Array<() => void> = [];
for (const [id, key, format] of [
  ["sensitivity", "sensitivity", (v: number) => v.toFixed(1) + "×"],
  [
    "camera-sensitivity",
    "cameraSensitivity",
    (v: number) => v.toFixed(1) + "×",
  ],
  ["stick-deadzone", "deadZone", (v: number) => Math.round(v * 100) + "%"],
  ["music-volume", "music", (v: number) => Math.round(v * 100) + "%"],
  [
    "analog-finish",
    "analog",
    (v: number) => (v === 0 ? "Off" : Math.round(v * 100) + "%"),
  ],
] as const) {
  const control = $<HTMLInputElement>(id);
  const sync = () => {
    control.value = String(preferences[key]);
    $(id + "-value").textContent = format(preferences[key]);
  };
  syncPreferenceControls.push(sync);
  sync();
  control.oninput = () => {
    preferences[key] = Number(control.value);
    sync();
    applyPreferences();
    savePreferences(preferences);
  };
}
for (const [id, key] of [
  ["invert", "invert"],
  ["invert-camera", "invertCamera"],
  ["camera-auto-return", "autoReturn"],
  ["precision", "precision"],
] as const) {
  const control = $<HTMLInputElement>(id);
  const sync = () => {
    control.checked = preferences[key];
  };
  syncPreferenceControls.push(sync);
  sync();
  control.onchange = () => {
    preferences[key] = control.checked;
    applyPreferences();
    savePreferences(preferences);
  };
}
$("reset-settings").onclick = () => {
  Object.assign(preferences, defaults);
  for (const sync of syncPreferenceControls) sync();
  applyPreferences();
  savePreferences(preferences);
};
applyPreferences();
document.addEventListener("visibilitychange", () => {
  if (document.hidden)
    pause("Flight paused while this window is in the background.");
});
window.addEventListener("blur", () => pause());
function disposeEnemy(e: Enemy) {
  e.mixer.stopAllAction();
  scene.remove(e.mesh);
}
function patrolPoint(e: Enemy, ahead = 0) {
  const phase = e.phase + ahead * 0.55;
  return e.center
    .clone()
    .addScaledVector(e.tangent, Math.cos(phase) * 65)
    .addScaledVector(e.depth, Math.sin(phase) * 60)
    .addScaledVector(e.up, Math.sin(phase * 1.7) * 13);
}
function spawnEnemies() {
  for (let i = 0; i < 6; i++) {
    const g = clone(flightAssets.drone.scene) as T.Group;
    const patrol = new T.AnimationMixer(g);
    for (const clip of flightAssets.drone.animations)
      patrol.clipAction(clip).play();
    const center = position
      .clone()
      .addScaledVector(forward, 200 + i * 35)
      .addScaledVector(right, ((i % 3) - 1) * 85);
    center
      .normalize()
      .multiplyScalar(RADIUS + Math.max(240, alt + 90) + (i % 2) * 30);
    g.position.copy(center);
    scene.add(g);
    const eu = center.clone().normalize();
    const tangent = new T.Vector3(1, 0, 0).projectOnPlane(eu).normalize();
    const enemy: Enemy = {
      mesh: g,
      center,
      hp: 3,
      phase: i * 1.7,
      shot: 4 + i * 0.8,
      mixer: patrol,
      velocity: new T.Vector3(),
      up: eu,
      tangent,
      depth: new T.Vector3().crossVectors(tangent, eu).normalize(),
    };
    g.position.copy(patrolPoint(enemy));
    enemies.push(enemy);
  }
}
function shoot(origin: T.Vector3, direction: T.Vector3, enemy = false) {
  const mesh = new T.Mesh(
    flightAssets.geometry.tracer,
    enemy ? hostileMat : friendlyMat,
  );
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction);
  scene.add(mesh);
  bolts.push({
    mesh,
    vel: direction.clone().multiplyScalar(enemy ? 115 : FRIENDLY_SPEED),
    life: enemy ? 7 : FRIENDLY_LIFETIME,
    enemy,
  });
}
function burst(pos: T.Vector3, count = 16, color = "#ffd78d") {
  for (let i = 0; i < count; i++) {
    const material = new T.MeshBasicMaterial({
      map: flightAssets.cloud,
      color,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
    });
    const mesh = new T.Mesh(flightAssets.geometry.spark, material);
    mesh.position.copy(pos);
    const vel = new T.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5,
    )
      .normalize()
      .multiplyScalar(10 + Math.random() * 25);
    const life = 0.4 + Math.random() * 0.9;
    scene.add(mesh);
    particles.push({ mesh, vel, life, max: life });
  }
}
function finish(success: boolean) {
  setMode("result");
  $("result-kicker").textContent = success
    ? "PELAGIC ISLANDS / SORTIE COMPLETE"
    : "PELAGIC ISLANDS / SIGNAL LOST";
  $("result-title").innerHTML = success
    ? "A sky worth<br>coming home to."
    : "Every ace<br>starts somewhere.";
  $("result-body").textContent = success
    ? "The Halcyon is safe. Your wings have earned their rest."
    : impactLoss
      ? "Your airframe was lost on impact. Keep clear of terrain; only a slow, upright Battroid approach can absorb a landing."
      : "Your airframe was lost. Take another flight and keep moving under fire.";
  $("result-time").textContent = `${Math.floor(flightTime / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(flightTime % 60)
    .toString()
    .padStart(2, "0")}`;
  $("result-kills").textContent = `${kills} / 06`;
  $("result-hull").textContent = `${Math.round(hull)}%`;
  if (success) radio("complete", "All threats neutralized. This sky is ours.");
}
function crash(contact?: TerrainContact) {
  if (mode !== "flight") return;
  impactLoss = !!contact;
  hull = 0;
  activeThrust = 0;
  speed = 0;
  sound.cancel(radioName);
  radioName = "";
  radioTimer = 0;
  show("radio", false);
  sound.engine(0, true);
  sound.play("explosion", 0.9);
  input.rumble(1, 650);
  hero.visible = false;
  trailLeft.length = trailRight.length = 0;
  if (trails) trails.visible = false;
  for (const bolt of bolts) scene.remove(bolt.mesh);
  bolts.length = 0;
  crashEffects.start(position, contact?.normal ?? up, contact?.water ?? false);
  crashCameraStart.copy(camera.position);
  crashCameraEnd
    .copy(camera.position)
    .addScaledVector(camera.position.clone().sub(position).normalize(), 9)
    .addScaledVector(up, 5);
  const obstruction = world.cameraObstruction(crashCameraStart, crashCameraEnd);
  if (obstruction !== null)
    crashCameraEnd
      .copy(crashCameraStart)
      .addScaledVector(
        crashCameraEnd.clone().sub(crashCameraStart).normalize(),
        Math.max(0, obstruction - 1),
      );
  setMode("crash");
}
function crashShot(dt: number) {
  crashEffects.update(dt, camera);
  const t = clamp(crashEffects.age / crashEffects.duration, 0, 1);
  camera.position.lerpVectors(
    crashCameraStart,
    crashCameraEnd,
    1 - (1 - t) ** 3,
  );
  if (!reducedMotion)
    camera.position.addScaledVector(
      right,
      Math.sin(crashEffects.age * 74) * 0.3 * Math.exp(-crashEffects.age * 5),
    );
  camera.up.copy(up);
  camera.lookAt(position.clone().addScaledVector(up, 3 * t));
  camera.clearViewOffset();
  if (t >= 1) finish(false);
}
function hit(amount: number) {
  if (invulnerable > 0) return;
  hull = Math.max(0, hull - amount);
  invulnerable = 1.3;
  input.rumble(0.75, 250);
  burst(position, 8, "#ff8950");
  notice("AIRFRAME HIT · Break away and keep moving", 2);
  if (hull <= 0) crash();
}
function flight(dt: number) {
  flightTime += dt;
  const previousPosition = position.clone();
  const axes = input.axes;
  up.copy(position).normalize();
  right.crossVectors(forward, up).normalize();
  const brake =
    input.active("ControlLeft") ||
    input.active("ControlRight") ||
    !!input.pad?.buttons[1]?.pressed;
  const propulsion = advanceAfterburner(
    boostEnergy,
    boostRecovering,
    brake ? 0 : input.boostAmount,
    dt,
  );
  boostEnergy = propulsion.energy;
  boostRecovering = propulsion.recovering;
  activeThrust = propulsion.thrust;
  const boost = activeThrust > 0;
  const handling = flightProfile(transform, brake, activeThrust);
  forward
    .applyAxisAngle(up, -axes.x * dt * handling.turnRate)
    .projectOnPlane(up)
    .normalize();
  pitch += axes.y * dt * handling.pitchRate;
  pitch = Math.atan2(Math.sin(pitch), Math.cos(pitch));
  if (Math.abs(axes.y) < 0.001) pitch = damp(pitch, 0, 0.18, dt);
  bank = damp(bank, -axes.x * 0.85 * (1 - transform * 0.55), 3.8, dt);
  speed = damp(speed, handling.speed, boost ? 1.2 : 1.8, dt);
  alt = Math.min(alt + Math.sin(pitch) * speed * dt, 1000);
  if (alt > 992) {
    notice("UPPER ATMOSPHERE · Return to the islands", 0.5);
    pitch = damp(pitch, -0.12, 1, dt);
  }
  if (alt < 20) {
    notice("PULL UP · Low altitude", 0.5);
  }
  position
    .addScaledVector(forward, Math.cos(pitch) * speed * dt)
    .normalize()
    .multiplyScalar(RADIUS + alt);
  up.copy(position).normalize();
  forward.projectOnPlane(up).normalize();
  right.crossVectors(forward, up).normalize();
  flightDirection
    .copy(forward)
    .multiplyScalar(Math.cos(pitch))
    .addScaledVector(up, Math.sin(pitch))
    .normalize();
  terrainProbeAge -= dt;
  if (terrainProbeAge <= 0) {
    terrainProbeAge = 0.1;
    const ahead = world.flightTerrainAhead(position, forward, pitch, speed);
    if (ahead !== null) {
      terrainDistance = ahead;
      terrainHold = 0.3;
    }
  }
  terrainHold = Math.max(0, terrainHold - dt);
  if (!terrainHold) terrainDistance = null;
  if (
    rollAge >= 1.05 &&
    (input.pressed("KeyZ", 4) || input.pressed("KeyX", 5))
  ) {
    rollAge = 0;
    rollDirection = input.pressed("KeyZ", 4) ? 1 : -1;
    input.rumble(0.35, 180);
  }
  rollAge = Math.min(1.05, rollAge + dt);
  const rollProgress =
    (rollAge / 1.05) * (rollAge / 1.05) * (3 - (2 * rollAge) / 1.05);
  const roll = rollAge < 1.05 ? rollDirection * Math.PI * 2 * rollProgress : 0;
  const nextRollX =
      rollAge < 1.05
        ? Math.sin(rollProgress * Math.PI * 2) * rollDirection * 8
        : 0,
    nextRollY =
      rollAge < 1.05 ? (1 - Math.cos(rollProgress * Math.PI * 2)) * 3 : 0;
  position.addScaledVector(right, nextRollX - rollX);
  alt += nextRollY - rollY;
  position.normalize().multiplyScalar(RADIUS + alt);
  rollX = nextRollX;
  rollY = nextRollY;
  basis.makeBasis(right, up, forward.clone().negate());
  q.setFromRotationMatrix(basis);
  hero.position.copy(position);
  hero.quaternion.copy(q);
  hero.rotateX(pitch);
  hero.rotateZ(bank + roll);
  hero.scale.setScalar(1.35);

  const contact = sweepTerrain(
    world.colliders,
    previousPosition,
    position,
    RADIUS,
  );
  if (contact) {
    const velocity = position.clone().sub(previousPosition).divideScalar(dt);
    const bodyUp = new T.Vector3(0, 1, 0).applyQuaternion(hero.quaternion);
    const gentle = gentleRobotContact(contact, velocity, transform, bodyUp, up);
    position.copy(contact.point).addScaledVector(contact.normal, 6.12);
    alt = position.length() - RADIUS;
    hero.position.copy(position);
    if (!gentle) {
      crash(contact);
      return;
    }
    // Absorb the descent without launching the robot upward. Holding brake
    // keeps a slow skim; pitching up lifts off using the normal flight controls.
    pitch = Math.max(0, pitch);
    speed = Math.min(speed, 8);
    notice("GROUND CONTACT · Battroid stable", 1);
  }

  if (!free && mission === 0) {
    const gate = rings[checkpoint];
    if (gate && position.distanceTo(gate.position) < 34) {
      gate.visible = false;
      burst(gate.position, 12, "#fff2b6");
      checkpoint++;
      input.rumble(0.2, 100);
      notice(`NAVIGATION ${checkpoint} / 3 · Corridor confirmed`, 2);
      if (checkpoint === 3) {
        mission = 1;
        spawnEnemies();
        radio("contact", "Hostile drones inbound. Protect the carrier.");
      }
      updateMission();
    }
  }
  locked = null;
  let nearest = Infinity;
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const delta = e.mesh.position.clone().sub(position),
      dist = delta.length();
    if (
      dist < 650 &&
      delta.normalize().dot(flightDirection) >
        (transform > 0.5 ? 0.55 : 0.88) &&
      dist < nearest &&
      world.weaponObstruction(position, e.mesh.position) === null
    ) {
      nearest = dist;
      locked = e;
    }
  }
  fireTimer -= dt;
  if (input.fire && fireTimer <= 0) {
    fireTimer = transform > 0.5 ? 0.13 : 0.18;
    const origin = position.clone().addScaledVector(forward, 5);
    const aim = flightDirection.clone();
    if (locked) {
      let lead = interceptTime(
        locked.mesh.position.clone().sub(origin),
        locked.velocity,
        FRIENDLY_SPEED,
        FRIENDLY_LIFETIME,
      );
      // Refine the velocity estimate against the drone's curved patrol path.
      for (let iteration = 0; iteration < 3; iteration++)
        lead = Math.min(
          FRIENDLY_LIFETIME,
          origin.distanceTo(patrolPoint(locked, lead)) / FRIENDLY_SPEED,
        );
      aim.copy(patrolPoint(locked, lead)).sub(origin).normalize();
    }
    shoot(origin, aim);
    sound.play("laser", 0.19, 1 + Math.random() * 0.1);
    input.rumble(0.1, 40);
  }
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    e.phase += dt * 0.55;
    e.mixer.update(dt);
    e.mesh.position.copy(patrolPoint(e));
    e.velocity
      .copy(e.tangent)
      .multiplyScalar(-Math.sin(e.phase) * 65 * 0.55)
      .addScaledVector(e.depth, Math.cos(e.phase) * 60 * 0.55)
      .addScaledVector(e.up, Math.cos(e.phase * 1.7) * 13 * 1.7 * 0.55);
    e.mesh.up.copy(e.up);
    e.mesh.lookAt(position);
    e.mesh.rotateY(Math.PI);
    e.shot -= dt;
    if (e.shot < 0 && position.distanceTo(e.mesh.position) < 520) {
      shoot(
        e.mesh.position,
        position.clone().sub(e.mesh.position).normalize(),
        true,
      );
      e.shot = 3.4 + Math.random() * 2;
    }
  }
  if (mission === 1 && kills === 6) {
    mission = 2;
    returnRing.visible = true;
    updateMission();
    notice("AIRSPACE CLEAR · Rendezvous at the carrier", 5);
  }
  if (mission === 2 && position.distanceTo(returnRing.position) < 43)
    finish(true);
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i],
      old = b.mesh.position.clone();
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    const candidates = b.enemy ? [] : enemies.filter((e) => e.hp > 0);
    const impact = firstProjectileImpact(
      old,
      b.mesh.position,
      world.weaponObstruction(old, b.mesh.position),
      b.enemy ? [position] : candidates.map((e) => e.mesh.position),
      b.enemy ? 4 : 6,
    );
    if (impact) {
      const length = old.distanceTo(b.mesh.position);
      b.mesh.position.lerpVectors(
        old,
        b.mesh.position,
        length ? impact.distance / length : 0,
      );
      b.life = 0;
      if (impact.targetIndex < 0) {
        burst(
          b.mesh.position,
          4,
          b.mesh.position.length() < RADIUS + 1 ? "#b7efff" : "#ffd78d",
        );
      } else if (b.enemy) {
        hit(12);
        if (mode !== "flight") return;
      } else {
        const e = candidates[impact.targetIndex];
        e.hp--;
        burst(e.mesh.position, 4);
        if (e.hp === 0) {
          burst(e.mesh.position, 22);
          e.mesh.visible = false;
          kills++;
          sound.play("explosion", 0.45);
          input.rumble(0.4, 180);
          updateMission();
        }
      }
    }
    if (b.life <= 0) {
      scene.remove(b.mesh);
      bolts.splice(i, 1);
    }
  }
  for (const side of [-1, 1]) {
    const list = side < 0 ? trailLeft : trailRight;
    list.unshift(
      position
        .clone()
        .addScaledVector(right, side * (transform > 0.5 ? 1.4 : 5.4)),
    );
    if (list.length > trailCount) list.pop();
  }
  for (let i = 0; i < trailCount - 1; i++) {
    const l = i % 2 ? trailLeft : trailRight;
    const a = l[Math.floor(i / 2)] ?? position,
      b = l[Math.floor(i / 2) + 1] ?? position;
    a.toArray(trailArray, i * 6);
    b.toArray(trailArray, i * 6 + 3);
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailMat.opacity =
    (0.24 + activeThrust * 0.24) * (1 - transform) + 0.08 * transform;
  cameraThreat =
    input.track && !free && mission === 1
      ? cameraContact(enemies, locked, cameraThreat, position)
      : null;
  chaseCamera.update(
    dt,
    input,
    world,
    position,
    forward,
    up,
    pitch,
    bank,
    speed,
    boost,
    transformTarget,
    transform,
    input.track ? (scenicGuidance()?.focus ?? guidanceTarget()) : null,
  );
  $("camera-cycle").textContent = chaseCamera.tracking
    ? "TRACKING"
    : FlightCamera.names[chaseCamera.distanceMode];
  if (mode !== "flight") return;
  invulnerable = Math.max(0, invulnerable - dt);
  hud();
  sound.engine(speed, false);
}
const radar = $<HTMLCanvasElement>("radar").getContext("2d")!;
function hud() {
  $("speed").textContent = Math.round(speed * 3.6)
    .toString()
    .padStart(3, "0");
  $("altitude").textContent = Math.round(world.terrainClearance(position))
    .toString()
    .padStart(3, "0");
  $("bearing").textContent = (
    ((Math.atan2(forward.x, -forward.z) * 180) / Math.PI + 360) %
    360
  )
    .toFixed(0)
    .padStart(3, "0");
  $("boost-meter").style.width = `${boostEnergy * 100}%`;
  show("terrain-cue", terrainDistance !== null);
  $("terrain-cue").classList.toggle(
    "urgent",
    terrainDistance !== null && terrainDistance < speed * 1.15,
  );
  if (terrainDistance !== null)
    $("terrain-range").textContent =
      `${Math.max(0, Math.round(terrainDistance / 5) * 5)} M · CHANGE COURSE`;
  $("boost-label").textContent = boostRecovering
    ? "AFTERBURNER / RECHARGING"
    : "AFTERBURNER";
  $("boost-meter").style.background = boostRecovering ? "#ffd08a" : "#fff4dc";
  $("hull-meter").style.width = `${hull}%`;
  $("hull-meter").style.background = hull < 35 ? "#ff8d69" : "#fff4dc";
  $("hull-label").textContent = `AIRFRAME ${Math.round(hull)}%`;
  $("mode-label").textContent = transform > 0.5 ? "BATTROID" : "FIGHTER";
  $("kills").textContent = String(kills);
  $("reticle").classList.toggle("locked", !!locked);
  const target = guidanceTarget();
  const scenic = scenicGuidance();
  const route = scenic ?? sortieGuidance();
  if (scenic?.arrived && !landmarkArrived) {
    landmarkArrived = true;
    $("mission-hint").textContent =
      "Scenic approach reached · Hold X / T to look";
    notice(world.landmarks[landmarkIndex].name.toUpperCase(), 3);
  }
  if (target) {
    camera.updateMatrixWorld();
    const view = target.clone().applyMatrix4(camera.matrixWorldInverse);
    const marker = navigationMarker(
      view,
      camera.fov,
      camera.aspect,
      lens.uniforms.bend.value,
    );
    hudGuidance.place(marker);
    $("target-marker").classList.toggle("enemy", !free && mission === 1);
    const targetName = free
      ? scenic
        ? "SCENIC APPROACH"
        : "HALCYON"
      : mission === 0
        ? `NAV 0${checkpoint + 1}`
        : mission === 1
          ? locked && target === locked.mesh.position
            ? "LOCKED"
            : "HOSTILE"
          : "HALCYON";
    $("target-name").textContent = targetName;
    const behindAircraft =
      target.clone().sub(position).dot(flightDirection) < 0;
    $("target-direction").textContent = route?.beyondHorizon
      ? "BEYOND HORIZON"
      : scenic?.arrived
        ? "VIEWPOINT REACHED"
        : behindAircraft
          ? "TURN BACK"
          : marker.offscreen
            ? "OFF VIEW"
            : "";
    $("target-distance").textContent =
      `${Math.round(route?.distance ?? position.distanceTo(target))} m`;
    show("target-marker");
  } else show("target-marker", false);
  radar.clearRect(0, 0, 150, 150);
  radar.strokeStyle = "#fff4dc40";
  radar.lineWidth = 1;
  radar.fillStyle = "#17496335";
  radar.beginPath();
  radar.arc(75, 75, 63, 0, Math.PI * 2);
  radar.fill();
  radar.stroke();
  radar.beginPath();
  radar.arc(75, 75, 34, 0, Math.PI * 2);
  radar.stroke();
  radar.beginPath();
  radar.moveTo(12, 75);
  radar.lineTo(138, 75);
  radar.moveTo(75, 12);
  radar.lineTo(75, 138);
  radar.stroke();
  radar.fillStyle = "#fff4dc";
  radar.beginPath();
  radar.moveTo(75, 68);
  radar.lineTo(71, 80);
  radar.lineTo(79, 80);
  radar.fill();
  const points = [
    ...enemies
      .filter((e) => e.hp > 0)
      .map((e) => ({ p: e.mesh.position, color: "#ffa27b" })),
    ...(target ? [{ p: target, color: "#ffe4a5" }] : []),
  ];
  for (const point of points) {
    v.copy(point.p).sub(position);
    const rx = v.dot(right) * 0.08,
      ry = -v.dot(forward) * 0.08;
    const d = Math.hypot(rx, ry);
    const s = Math.min(1, 58 / d);
    radar.fillStyle = point.color;
    radar.fillRect(73 + rx * s, 73 + ry * s, 4, 4);
  }
}
function display(dt: number) {
  const isHangar = mode === "hangar";
  if (isHangar) {
    const look = input.look;
    if (Math.abs(look.x) + Math.abs(look.y) > 0.05) {
      hangarYaw -= look.x * dt * 1.5;
      hangarHeight = clamp(hangarHeight - look.y * dt * 12, -6, 25);
      hangarIdle = 4;
    } else {
      hangarIdle -= dt;
      if (hangarIdle <= 0) hangarYaw += dt * 0.08;
    }
  }
  const p = surface(0, 120, 125);
  up.copy(p).normalize();
  hero.position.copy(p);
  hero.scale.setScalar(mode === "hangar" ? 2.0 : 2.5);
  const tangent = new T.Vector3(0, 0, -1).projectOnPlane(up).normalize();
  right.crossVectors(tangent, up).normalize();
  basis.makeBasis(right, up, tangent.clone().negate());
  hero.quaternion.setFromRotationMatrix(basis);
  hero.rotateY(isHangar ? hangarYaw : Math.sin(clock * 0.1) * 0.12 - 0.3);
  hero.rotateZ(mode === "hangar" ? 0 : -0.12);
  hero.position.addScaledVector(up, Math.sin(clock * 0.6) * 0.6);
  targetCamera
    .copy(p)
    .addScaledVector(tangent, isHangar ? 22 : 18)
    .addScaledVector(right, isHangar ? 23 : 27)
    .addScaledVector(up, isHangar ? hangarHeight : 13);
  camera.position.lerp(targetCamera, 1 - Math.exp(-2 * dt));
  camera.up.copy(up);
  const aim = p.clone().addScaledVector(up, isHangar ? -1 : 1);
  camera.lookAt(aim);
  camera.setViewOffset(
    innerWidth,
    innerHeight,
    -innerWidth * 0.22 * clamp((camera.aspect - 0.7) / 0.7, 0, 1),
    0,
    innerWidth,
    innerHeight,
  );
  camera.fov = fitCameraFov(52, camera.aspect);
  camera.updateProjectionMatrix();
  if (trails) trails.visible = false;
  sound.engine(0, true);
  rings.forEach((r) => (r.visible = false));
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.045);
  last = now;
  if (mode !== "paused") clock += dt;
  input.poll();
  if (input.pad && !input.wasConnected) {
    $("device-title").textContent =
      "Controller connected · D-pad chooses · A confirms";
    $("controls-bar").innerHTML =
      "<span><kbd>LS</kbd> Steer</span><span><kbd>RS</kbd> Look</span><span><kbd>LT</kbd> Boost</span><span><kbd>RT</kbd> Fire</span><span><kbd>A</kbd> Transform</span><span><kbd>Y</kbd> Camera</span><span><kbd>X</kbd> Track (hold)</span><span><kbd>Start</kbd> Pause</span>";
    notice("CONTROLLER CONNECTED", 2);
  }
  if (!input.pad && input.wasConnected) {
    pause(
      "Controller disconnected. Reconnect it, or resume with the keyboard.",
    );
    $("device-title").textContent = "Controller recommended · Keyboard ready";
    $("controls-bar").innerHTML =
      "<span><kbd>W A S D</kbd> Steer</span><span><kbd>Shift</kbd> Boost</span><span><kbd>Space</kbd> Fire</span><span><kbd>F</kbd> Transform</span><span><kbd>Q E</kbd> Look</span><span><kbd>V</kbd> Camera</span><span><kbd>T</kbd> Track (hold)</span><span><kbd>Esc</kbd> Pause</span>";
  }
  if (mode !== "entry" && input.pressed("KeyM")) mute();
  const menuHandled = controllerMenu.update(
    mode === "flight" || mode === "crash"
      ? null
      : $(
          mode === "paused"
            ? "pause-screen"
            : mode === "hangar"
              ? "hangar-screen"
              : mode,
        ),
    input,
    dt,
    () => {
      if (mode === "paused") resume();
      else if (mode === "hangar" || mode === "result") setMode("title");
    },
  );
  if (!menuHandled) {
    if (mode === "title" && (input.pressed("Enter") || input.pressed("Space")))
      start();
    else if (mode === "flight") {
      if (input.landmarkStep) selectLandmark(input.landmarkStep);
      if (input.pressed("Escape", 9)) pause();
      else if (input.pressed("KeyF", 0)) changeTransform();
      if (input.pressed("KeyV", 3)) cameraChanged(chaseCamera.cycle());
      if (input.pressed("KeyR", 11)) {
        chaseCamera.recenter();
        notice("CAMERA RETURNING", 1.2);
      }
      if (input.pressed("KeyH")) {
        hideHud = !hideHud;
        show("hud", !hideHud);
      }
    } else if (
      mode === "paused" &&
      (input.pressed("Escape", 9) || input.pressed("Enter"))
    )
      resume();
    else if (mode === "hangar") {
      if (input.pressed("KeyF")) changeTransform();
      if (input.pressed("Escape")) {
        transform = transformTarget = 0;
        setMode("title");
      }
    } else if (mode === "crash" && input.pressed("Escape", 9)) pause();
    else if (mode === "result" && input.pressed("Enter")) start(free);
  }
  if (mode === "flight" || mode === "hangar") {
    transform = advanceTransform(transform, transformTarget, dt);
    if (action && clip && mixer) {
      action.time = transform * (clip.duration - 0.00001);
      mixer.update(0);
    }
    ailerons?.update(dt, mode === "flight" ? input.axes.x : 0, transform);
    robotControls?.update(dt, mode === "flight" ? input.axes.x : 0, transform);
    const moving = Math.abs(transform - transformTarget) > 0.001;
    show("transform-status", moving && mode === "flight");
    $("transform-meter").style.width = `${transform * 100}%`;
    $("transform-step").textContent = [
      "RELEASING WING LOCKS",
      "ROTATING ENGINE ASSEMBLIES",
      "DEPLOYING COMBAT ARMS",
      "FRAME LOCK · BATTROID",
    ][Math.min(3, Math.floor(transform * 4))];
    $("hangar-mode").textContent = moving
      ? "Transformation in progress"
      : transform > 0.5
        ? "Battroid combat frame"
        : "Atmospheric fighter";
  }
  if (mode === "flight") {
    if (trails) trails.visible = true;
    flight(dt);
  } else if (mode === "crash") crashShot(dt);
  else if (mode === "entry" || mode === "title" || mode === "hangar")
    display(dt);
  if (mode === "title") {
    const audioStatus = sound.muted
      ? "Soundtrack muted · ♪ to enable"
      : sound.musicVolume === 0
        ? "Soundtrack volume 0 · Adjust in the pause menu"
        : sound.context?.state === "running" && sound.musicStarted
          ? "♫ Skyward · Original soundtrack"
          : "Sound paused · Click ♪ to enable";
    if ($("audio-status").textContent !== audioStatus)
      $("audio-status").textContent = audioStatus;
    const audioLabel = sound.muted
      ? "Unmute audio"
      : sound.context?.state === "running"
        ? "Mute audio"
        : "Enable audio";
    $("sound").setAttribute("aria-label", audioLabel);
    $("sound").title = audioLabel;
  }
  if (mode !== "paused") {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.quaternion.copy(camera.quaternion);
      p.mesh.scale.setScalar(Math.max(0.01, (p.life / p.max) * 2.3));
      (p.mesh.material as T.MeshBasicMaterial).opacity = p.life / p.max;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        (p.mesh.material as T.Material).dispose();
        particles.splice(i, 1);
      }
    }
  }
  for (const plume of exhausts)
    updateEngineExhaust(
      plume,
      mode === "flight" || mode === "paused" ? activeThrust : 0,
      clock,
      mode !== "hangar",
    );
  if (radioTimer > 0 && mode !== "paused") {
    radioTimer -= dt;
    if (radioTimer <= 0) show("radio", false);
  }
  if (noticeTimer > 0 && mode !== "paused") {
    noticeTimer -= dt;
    if (noticeTimer <= 0) $("notice").textContent = "";
  }
  world.tick(clock, hero.position);
  lens.uniforms.time.value = clock;
  composer.render();
  input.end();
}
camera.position.copy(surface(35, 147, 142));
requestAnimationFrame(frame);
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = fitCameraFov(
    mode === "flight" || mode === "paused" || mode === "result"
      ? chaseCamera.nominalFov
      : 52,
    camera.aspect,
  );
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  lens.uniforms.aspect.value = camera.aspect;
});
// Read-only diagnostics for reproducible asset and runtime verification.
Object.defineProperty(window, "markos", {
  get: () => ({
    mode,
    ready,
    transform,
    transformTarget,
    mission,
    checkpoint,
    kills,
    hull,
    flightTime,
    position: position.toArray(),
    altitude: alt,
    controller: input.pad?.id ?? null,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    animation: clip?.name,
    bones: model
      ? (() => {
          const b: string[] = [];
          model.traverse((o) => {
            if (o instanceof T.Bone) b.push(o.name);
          });
          return b;
        })()
      : [],
    audio: [...sound.buffers.keys()],
  }),
});
