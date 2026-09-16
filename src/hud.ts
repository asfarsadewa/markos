import * as T from "three";
import { $, setText, show } from "./dom.ts";
import { HudGuidance } from "./hud-guidance.ts";
import { navigationMarker } from "./navigation.ts";
import type { Guidance } from "./landmarks.ts";
import type { MissionDescription, Stage } from "./mission.ts";

export type HudFrame = {
  speed: number;
  clearance: number;
  forward: T.Vector3;
  right: T.Vector3;
  position: T.Vector3;
  flightDirection: T.Vector3;
  boostEnergy: number;
  boostRecovering: boolean;
  terrainDistance: number | null;
  hull: number;
  transform: number;
  kills: number;
  /** Position of the locked drone, if any (identity-compared with `target`). */
  locked: T.Vector3 | null;
  target: T.Vector3 | null;
  scenic: Guidance | null;
  route: Guidance | null;
  free: boolean;
  stage: Stage;
  checkpoint: number;
  contacts: T.Vector3[];
  camera: T.PerspectiveCamera;
  bend: number;
  mission: MissionDescription;
};

/** Flight instruments. Pure rendering of a frame snapshot; writes only what changed. */
export class Hud {
  private readonly guidance = new HudGuidance($("target-marker"), $("hud"));
  private readonly radar = $<HTMLCanvasElement>("radar").getContext("2d")!;
  private readonly view = new T.Vector3();
  private readonly relative = new T.Vector3();
  private progressKey = "";
  private readonly el = {
    speed: $("speed"),
    altitude: $("altitude"),
    bearing: $("bearing"),
    boostMeter: $("boost-meter"),
    boostLabel: $("boost-label"),
    terrainCue: $("terrain-cue"),
    terrainRange: $("terrain-range"),
    hullMeter: $("hull-meter"),
    hullLabel: $("hull-label"),
    modeLabel: $("mode-label"),
    kills: $("kills"),
    reticle: $("reticle"),
    targetMarker: $("target-marker"),
    targetName: $("target-name"),
    targetDirection: $("target-direction"),
    targetDistance: $("target-distance"),
    missionKicker: $("mission-kicker"),
    missionName: $("mission-name"),
    missionHint: $("mission-hint"),
    progress: $("progress"),
    landmarkCount: $("landmark-count"),
  };
  render(f: HudFrame) {
    const el = this.el;
    setText(
      el.speed,
      Math.round(f.speed * 3.6)
        .toString()
        .padStart(3, "0"),
    );
    setText(el.altitude, Math.round(f.clearance).toString().padStart(3, "0"));
    setText(
      el.bearing,
      (((Math.atan2(f.forward.x, -f.forward.z) * 180) / Math.PI + 360) % 360)
        .toFixed(0)
        .padStart(3, "0"),
    );
    el.boostMeter.style.width = `${f.boostEnergy * 100}%`;
    show("terrain-cue", f.terrainDistance !== null);
    el.terrainCue.classList.toggle(
      "urgent",
      f.terrainDistance !== null && f.terrainDistance < f.speed * 1.15,
    );
    if (f.terrainDistance !== null)
      setText(
        el.terrainRange,
        `${Math.max(0, Math.round(f.terrainDistance / 5) * 5)} M · CHANGE COURSE`,
      );
    setText(
      el.boostLabel,
      f.boostRecovering ? "AFTERBURNER / RECHARGING" : "AFTERBURNER",
    );
    el.boostMeter.style.background = f.boostRecovering ? "#ffd08a" : "#fff4dc";
    el.hullMeter.style.width = `${f.hull}%`;
    el.hullMeter.style.background = f.hull < 35 ? "#ff8d69" : "#fff4dc";
    setText(el.hullLabel, `AIRFRAME ${Math.round(f.hull)}%`);
    setText(el.modeLabel, f.transform > 0.5 ? "BATTROID" : "FIGHTER");
    setText(el.kills, String(f.kills));
    el.reticle.classList.toggle("locked", !!f.locked);
    this.renderMission(f.mission);
    this.renderTarget(f);
    this.renderRadar(f);
  }
  private renderMission(mission: MissionDescription) {
    const el = this.el;
    setText(el.missionKicker, mission.kicker);
    setText(el.missionName, mission.name);
    setText(el.missionHint, mission.hint);
    show("landmark-controls", mission.landmark !== null);
    if (mission.landmark !== null) setText(el.landmarkCount, mission.landmark);
    show("progress", mission.progress !== null);
    if (mission.progress) {
      const key = `${mission.progress.done}/${mission.progress.total}`;
      if (key !== this.progressKey) {
        this.progressKey = key;
        el.progress.innerHTML = Array.from(
          { length: mission.progress.total },
          (_, i) =>
            `<i class="${i < mission.progress!.done ? "done" : ""}"></i>`,
        ).join("");
      }
    }
  }
  private renderTarget(f: HudFrame) {
    const el = this.el;
    if (!f.target) {
      show("target-marker", false);
      return;
    }
    f.camera.updateMatrixWorld();
    this.view.copy(f.target).applyMatrix4(f.camera.matrixWorldInverse);
    const marker = navigationMarker(
      this.view,
      f.camera.fov,
      f.camera.aspect,
      f.bend,
    );
    this.guidance.place(marker);
    el.targetMarker.classList.toggle("enemy", !f.free && f.stage === 1);
    const name = f.free
      ? f.scenic
        ? "SCENIC APPROACH"
        : "HALCYON"
      : f.stage === 0
        ? `NAV 0${f.checkpoint + 1}`
        : f.stage === 1
          ? f.locked && f.target === f.locked
            ? "LOCKED"
            : "HOSTILE"
          : "HALCYON";
    setText(el.targetName, name);
    const behindAircraft =
      this.relative.copy(f.target).sub(f.position).dot(f.flightDirection) < 0;
    setText(
      el.targetDirection,
      f.route?.beyondHorizon
        ? "BEYOND HORIZON"
        : f.scenic?.arrived
          ? "VIEWPOINT REACHED"
          : behindAircraft
            ? "TURN BACK"
            : marker.offscreen
              ? "OFF VIEW"
              : "",
    );
    setText(
      el.targetDistance,
      `${Math.round(f.route?.distance ?? f.position.distanceTo(f.target))} m`,
    );
    show("target-marker");
  }
  private renderRadar(f: HudFrame) {
    const radar = this.radar;
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
    const blip = (p: T.Vector3, color: string) => {
      this.relative.copy(p).sub(f.position);
      const rx = this.relative.dot(f.right) * 0.08,
        ry = -this.relative.dot(f.forward) * 0.08;
      const d = Math.hypot(rx, ry);
      const s = Math.min(1, 58 / d);
      radar.fillStyle = color;
      radar.fillRect(73 + rx * s, 73 + ry * s, 4, 4);
    };
    for (const contact of f.contacts) blip(contact, "#ffa27b");
    if (f.target) blip(f.target, "#ffe4a5");
  }
}
