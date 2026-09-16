import "./style.css";
import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { assetUrl, createGltfLoader } from "./assets.ts";
import { loadFlightAssets, type FlightAssets } from "./flight-assets.ts";
import { FlightCamera, fitCameraFov } from "./camera.ts";
import { addAirframeInk } from "./airframe-ink.ts";
import { analogFilmFragment } from "./analog-film.ts";
import { createEngineExhaust, updateEngineExhaust } from "./engine-exhaust.ts";
import { AileronControls } from "./aileron-controls.ts";
import { RobotControls } from "./robot-controls.ts";
import { Input } from "./input.ts";
import {
  sweepTerrain,
  gentleRobotContact,
  type TerrainContact,
} from "./terrain-contact.ts";
import { CrashEffects } from "./crash-effects.ts";
import { ControllerMenu } from "./controller-menu.ts";
import { loadPreferences, savePreferences } from "./preferences.ts";
import { Sound } from "./audio.ts";
import { World, RADIUS, surface, toonRamp } from "./asset-world.ts";
import {
  damp,
  clamp,
  advanceTransform,
  flightProfile,
  advanceAfterburner,
} from "./flight.ts";
import { $, show, setText } from "./dom.ts";
import { GameSession, type Mode } from "./session.ts";
import { MissionDirector } from "./mission.ts";
import { CombatSystem } from "./combat.ts";
import { Particles } from "./effects.ts";
import { Contrail } from "./contrail.ts";
import { Hud } from "./hud.ts";
import { bindSettingsPanel } from "./settings-panel.ts";

// ---------------------------------------------------------------------------
// Renderer, scene and subsystems
// ---------------------------------------------------------------------------
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
const hud = new Hud();
const session = new GameSession(applyMode);
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
let entering = false;
let radioName = "";
let hangarYaw = 0,
  hangarHeight = 12,
  hangarIdle = 4;

// ---------------------------------------------------------------------------
// Flight state
// ---------------------------------------------------------------------------
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
  radioTimer = 0,
  noticeTimer = 0,
  invulnerable = 0,
  hideHud = false;
let rollAge = 2,
  rollDirection = 1,
  rollX = 0,
  rollY = 0;
let terrainProbeAge = 0,
  terrainHold = 0,
  terrainDistance: number | null = null;
const position = surface(0, 180, 110),
  forward = new T.Vector3(0, 0, -1),
  up = position.clone().normalize();
forward.projectOnPlane(up).normalize();
const flightDirection = new T.Vector3();
const right = new T.Vector3(),
  basis = new T.Matrix4(),
  q = new T.Quaternion(),
  targetCamera = new T.Vector3(),
  previousPosition = new T.Vector3(),
  bodyUp = new T.Vector3(),
  velocity = new T.Vector3();
const exhausts: T.Mesh[] = [];
let crashEffects: CrashEffects;
let impactLoss = false;
const crashCameraStart = new T.Vector3();
const crashCameraEnd = new T.Vector3();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const particles = new Particles(scene);
const contrail = new Contrail(scene);
const mission = new MissionDirector(scene, world, {
  gateCleared(checkpoint, at) {
    particles.burst(at, 12, "#fff2b6");
    input.rumble(0.2, 100);
    notice(`NAVIGATION ${checkpoint} / 3 · Corridor confirmed`, 2);
  },
  interceptionBegins() {
    combat.spawn(position, forward, right, alt);
    radio("contact", "Hostile drones inbound. Protect the carrier.");
  },
  airspaceCleared() {
    notice("AIRSPACE CLEAR · Rendezvous at the carrier", 5);
  },
  rendezvous() {
    finish(true);
  },
  landmarkReached(name) {
    notice(name.toUpperCase(), 3);
  },
});
const combat = new CombatSystem(scene, world, particles, {
  shot() {
    sound.play("laser", 0.19, 1 + Math.random() * 0.1);
    input.rumble(0.1, 40);
  },
  playerHit(amount) {
    hit(amount);
    return session.mode === "flight";
  },
  enemyDestroyed() {
    mission.recordKill();
    sound.play("explosion", 0.45);
    input.rumble(0.4, 180);
  },
});

function installFlightAssets(assets: FlightAssets) {
  crashEffects = new CrashEffects(assets);
  scene.add(crashEffects.group);
  mission.install(assets.geometry["nav-gate"]);
  contrail.install(assets.geometry.contrail);
  particles.install(assets);
  combat.install(assets);
}

// ---------------------------------------------------------------------------
// Loading and entry
// ---------------------------------------------------------------------------
const loader = createGltfLoader();
async function load() {
  try {
    const [gltf, carrier, assets] = await Promise.all([
      loader.loadAsync(assetUrl("/models/markos.glb")),
      loader.loadAsync(assetUrl("/models/carrier.glb")),
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
    $("loading-error").textContent =
      `Aircraft could not load. ${String(error)}\nReload to try again.`;
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
  if (!ready || entering || session.mode !== "entry") return;
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
  if (session.mode !== "entry") return;
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
  session.set("title");
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
    if (
      session.mode !== "entry" &&
      !sound.muted &&
      sound.context?.state !== "running"
    )
      void sound.unlock();
  });

// ---------------------------------------------------------------------------
// Messages and modes
// ---------------------------------------------------------------------------
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
/** Presentation for each session mode; the session owns the transition rules. */
function applyMode(next: Mode) {
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
  mission.begin(isFree);
  session.set("flight");
  if (!isFree)
    radio("launch", "Markos, your flight corridor is clear. Enjoy the sky.");
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
  flightTime = 0;
  invulnerable = 3;
  radioTimer = 0;
  noticeTimer = 0;
  $("notice").textContent = "";
  show("radio", false);
  show("transform-status", false);
  combat.clear();
  particles.clear();
  contrail.reset();
  mission.begin(false);
  camera.position
    .copy(position)
    .addScaledVector(forward, -24)
    .addScaledVector(up, 9);
}
function changeTransform() {
  if (!ready) return;
  transformTarget = transformTarget ? 0 : 1;
  sound.play("transformation", 0.65);
  if (transformTarget && session.mode === "flight")
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
  if (!session.inAction) return;
  $("pause-reason").textContent = reason;
  session.pause();
  input.keys.clear();
}
function resume() {
  void sound.unlock();
  session.resume();
  last = performance.now();
}
$("start").onclick = () => start();
$("pause").onclick = () => {
  if (session.inAction) pause();
  else if (session.mode === "paused") resume();
};
$("resume").onclick = resume;
$("return-title").onclick = () => {
  reset();
  session.set("title");
};
$("again").onclick = () => start(mission.free);
$("freeflight").onclick = () => start(true);
$("landmark-prev").onclick = () => selectLandmark(-1);
$("landmark-next").onclick = () => selectLandmark(1);
$("restart").onclick = () => start(mission.free);
$("hangar").onclick = () => {
  void sound.unlock();
  transform = transformTarget = 0;
  session.set("hangar");
};
$("hangar-back").onclick = () => {
  transform = transformTarget = 0;
  session.set("title");
};
$("hangar-transform").onclick = changeTransform;
function selectLandmark(step: number) {
  if (session.mode !== "flight") return;
  mission.selectLandmark(step);
}
function mute() {
  if (
    !sound.muted &&
    sound.context?.state !== "running" &&
    session.mode !== "entry"
  ) {
    void sound.unlock();
    return;
  }
  const muted = sound.toggle();
  if (!muted && session.mode !== "entry") void sound.unlock();
  $("sound").textContent = muted ? "×" : "♪";
  $("sound").setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
}
$("sound").onclick = mute;

// ---------------------------------------------------------------------------
// Camera style and preferences
// ---------------------------------------------------------------------------
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
bindSettingsPanel(preferences, () => {
  applyPreferences();
  savePreferences(preferences);
});
applyPreferences();
document.addEventListener("visibilitychange", () => {
  if (document.hidden)
    pause("Flight paused while this window is in the background.");
});
window.addEventListener("blur", () => pause());

// ---------------------------------------------------------------------------
// Results and damage
// ---------------------------------------------------------------------------
function finish(success: boolean) {
  session.set("result");
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
  $("result-kills").textContent = `${mission.kills} / 06`;
  $("result-hull").textContent = `${Math.round(hull)}%`;
  if (success) radio("complete", "All threats neutralized. This sky is ours.");
}
function crash(contact?: TerrainContact) {
  if (session.mode !== "flight") return;
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
  contrail.reset();
  contrail.visible = false;
  combat.clearBolts();
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
  session.set("crash");
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
  particles.burst(position, 8, "#ff8950");
  notice("AIRFRAME HIT · Break away and keep moving", 2);
  if (hull <= 0) crash();
}

// ---------------------------------------------------------------------------
// Flight integration
// ---------------------------------------------------------------------------
function flight(dt: number) {
  flightTime += dt;
  previousPosition.copy(position);
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
    velocity.copy(position).sub(previousPosition).divideScalar(dt);
    bodyUp.set(0, 1, 0).applyQuaternion(hero.quaternion);
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

  mission.update(position, flightDirection);
  combat.acquireLock(position, flightDirection, transform);
  combat.fire(dt, input.fire, position, forward, flightDirection, transform);
  combat.updateEnemies(dt, position);
  if (!combat.updateBolts(dt, position)) return;
  contrail.update(position, right, transform, activeThrust);
  combat.updateCameraThreat(input.track, mission.inCombat, position);
  const scenic = mission.scenic(position, flightDirection);
  const route = mission.route(position, flightDirection);
  const target = mission.free
    ? (scenic?.point ?? (input.track ? world.carrier.position : null))
    : mission.inCombat
      ? (combat.threat(input.track, position)?.mesh.position ?? null)
      : (route?.point ?? null);
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
    input.track ? (scenic?.focus ?? target) : null,
  );
  setText(
    $("camera-cycle"),
    chaseCamera.tracking
      ? "TRACKING"
      : FlightCamera.names[chaseCamera.distanceMode],
  );
  if (session.mode !== "flight") return;
  invulnerable = Math.max(0, invulnerable - dt);
  hud.render({
    speed,
    clearance: world.terrainClearance(position),
    forward,
    right,
    position,
    flightDirection,
    boostEnergy,
    boostRecovering,
    terrainDistance,
    hull,
    transform,
    kills: mission.kills,
    locked: combat.locked?.mesh.position ?? null,
    target,
    scenic,
    route,
    free: mission.free,
    stage: mission.stage,
    checkpoint: mission.checkpoint,
    contacts: combat.contacts(),
    camera,
    bend: lens.uniforms.bend.value,
    mission: mission.describe(),
  });
  sound.engine(speed, false);
}

// ---------------------------------------------------------------------------
// Title, entry and hangar display
// ---------------------------------------------------------------------------
function display(dt: number) {
  const isHangar = session.mode === "hangar";
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
  hero.scale.setScalar(isHangar ? 2.0 : 2.5);
  const tangent = new T.Vector3(0, 0, -1).projectOnPlane(up).normalize();
  right.crossVectors(tangent, up).normalize();
  basis.makeBasis(right, up, tangent.clone().negate());
  hero.quaternion.setFromRotationMatrix(basis);
  hero.rotateY(isHangar ? hangarYaw : Math.sin(clock * 0.1) * 0.12 - 0.3);
  hero.rotateZ(isHangar ? 0 : -0.12);
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
  contrail.visible = false;
  sound.engine(0, true);
  mission.showGates(false);
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.045);
  last = now;
  const mode = session.mode;
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
    session.inAction
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
      if (session.mode === "paused") resume();
      else if (session.mode === "hangar" || session.mode === "result")
        session.set("title");
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
        session.set("title");
      }
    } else if (mode === "crash" && input.pressed("Escape", 9)) pause();
    else if (mode === "result" && input.pressed("Enter")) start(mission.free);
  }
  const current = session.mode;
  if (current === "flight" || current === "hangar") {
    transform = advanceTransform(transform, transformTarget, dt);
    if (action && clip && mixer) {
      action.time = transform * (clip.duration - 0.00001);
      mixer.update(0);
    }
    const steering = current === "flight" ? input.axes.x : 0;
    ailerons?.update(dt, steering, transform);
    robotControls?.update(dt, steering, transform);
    const moving = Math.abs(transform - transformTarget) > 0.001;
    show("transform-status", moving && current === "flight");
    $("transform-meter").style.width = `${transform * 100}%`;
    setText(
      $("transform-step"),
      [
        "RELEASING WING LOCKS",
        "ROTATING ENGINE ASSEMBLIES",
        "DEPLOYING COMBAT ARMS",
        "FRAME LOCK · BATTROID",
      ][Math.min(3, Math.floor(transform * 4))],
    );
    setText(
      $("hangar-mode"),
      moving
        ? "Transformation in progress"
        : transform > 0.5
          ? "Battroid combat frame"
          : "Atmospheric fighter",
    );
  }
  if (current === "flight") {
    contrail.visible = true;
    flight(dt);
  } else if (current === "crash") crashShot(dt);
  else if (session.onDisplay) display(dt);
  if (session.mode === "title") {
    const audioStatus = sound.muted
      ? "Soundtrack muted · ♪ to enable"
      : sound.musicVolume === 0
        ? "Soundtrack volume 0 · Adjust in the pause menu"
        : sound.context?.state === "running" && sound.musicStarted
          ? "♫ Skyward · Original soundtrack"
          : "Sound paused · Click ♪ to enable";
    setText($("audio-status"), audioStatus);
    const audioLabel = sound.muted
      ? "Unmute audio"
      : sound.context?.state === "running"
        ? "Mute audio"
        : "Enable audio";
    $("sound").setAttribute("aria-label", audioLabel);
    $("sound").title = audioLabel;
  }
  if (session.mode !== "paused") particles.update(dt, camera.quaternion);
  const thrusting = session.mode === "flight" || session.mode === "paused";
  for (const plume of exhausts)
    updateEngineExhaust(
      plume,
      thrusting ? activeThrust : 0,
      clock,
      session.mode !== "hangar",
    );
  if (radioTimer > 0 && session.mode !== "paused") {
    radioTimer -= dt;
    if (radioTimer <= 0) show("radio", false);
  }
  if (noticeTimer > 0 && session.mode !== "paused") {
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
  const mode = session.mode;
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
    mode: session.mode,
    ready,
    transform,
    transformTarget,
    mission: mission.stage,
    checkpoint: mission.checkpoint,
    kills: mission.kills,
    hull,
    flightTime,
    position: position.toArray(),
    altitude: alt,
    contacts: combat.contacts().map((p) => p.toArray()),
    locked: !!combat.locked,
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
