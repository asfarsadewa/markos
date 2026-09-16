import * as T from "three";
import { cycleLandmark, landmarkGuidance, type Guidance } from "./landmarks.ts";
import { RADIUS, surface, type World } from "./asset-world.ts";

/** 0 reconnaissance (gates), 1 interception (drones), 2 rendezvous (carrier). */
export type Stage = 0 | 1 | 2;
export type MissionEvents = {
  gateCleared(checkpoint: number, at: T.Vector3): void;
  interceptionBegins(): void;
  airspaceCleared(): void;
  rendezvous(): void;
  landmarkReached(name: string): void;
};
export type MissionDescription = {
  kicker: string;
  name: string;
  hint: string;
  /** Gate or drone tally for the sortie; null in free flight. */
  progress: { done: number; total: number } | null;
  /** Landmark selector caption in free flight; null during the sortie. */
  landmark: string | null;
};
const KICKERS = ["01 / RECONNAISSANCE", "02 / INTERCEPTION", "03 / RENDEZVOUS"];
const TITLES = [
  "Follow the wind",
  "Protect the Halcyon",
  "Bring your wings home",
];
const HINTS = [
  "Fly through the three navigation gates.",
  "Transform for a wider lock. Clear six interceptor drones.",
  "Rendezvous with the carrier at the green beacon.",
];
export const DRONE_COUNT = 6;

/** Objectives, progression and free-flight destinations. Emits events; plays nothing itself. */
export class MissionDirector {
  free = false;
  stage: Stage = 0;
  checkpoint = 0;
  kills = 0;
  landmarkIndex = 0;
  landmarkArrived = false;
  readonly rings: T.Group[] = [];
  readonly returnRing = new T.Group();
  private readonly world: World;
  private readonly events: MissionEvents;
  private readonly gateMaterial = new T.MeshBasicMaterial({
    color: "#fff0b6",
    transparent: true,
    opacity: 0.85,
  });
  constructor(scene: T.Scene, world: World, events: MissionEvents) {
    this.world = world;
    this.events = events;
    const gatePositions = [
      surface(0, -155, 110),
      surface(30, -475, 118),
      surface(-45, -840, 135),
    ];
    gatePositions.forEach((p, i) => {
      const gate = new T.Group();
      gate.position.copy(p);
      const direction = (gatePositions[i + 1] ?? surface(-60, -1200, 145))
        .clone()
        .sub(p)
        .normalize();
      gate.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
      scene.add(gate);
      this.rings.push(gate);
    });
    this.returnRing.position.copy(surface(100, -80, 125));
    this.returnRing.visible = false;
    scene.add(this.returnRing);
  }
  /** Attach the exported gate mesh once flight assets are available. */
  install(gate: T.BufferGeometry) {
    for (const ring of this.rings)
      ring.add(new T.Mesh(gate, this.gateMaterial));
    const returnMesh = new T.Mesh(
      gate,
      new T.MeshBasicMaterial({ color: "#bef8d0" }),
    );
    returnMesh.scale.setScalar(1.2);
    this.returnRing.add(returnMesh);
  }
  /** Start the sortie, or free flight with the first landmark selected. */
  begin(free: boolean) {
    this.free = free;
    this.stage = 0;
    this.checkpoint = 0;
    this.kills = 0;
    this.landmarkIndex = 0;
    this.landmarkArrived = false;
    this.showGates(!free);
    this.returnRing.visible = false;
  }
  showGates(visible: boolean) {
    for (const ring of this.rings) ring.visible = visible;
  }
  get inCombat() {
    return !this.free && this.stage === 1;
  }
  recordKill() {
    this.kills++;
  }
  selectLandmark(step: number) {
    if (!this.free) return;
    this.landmarkIndex = cycleLandmark(
      this.landmarkIndex,
      step,
      this.world.landmarks.length,
    );
    this.landmarkArrived = false;
  }
  /** Free-flight destination guidance, when a landmark is selected. */
  scenic(position: T.Vector3, flightDirection: T.Vector3): Guidance | null {
    const destination = this.free
      ? this.world.landmarks[this.landmarkIndex]
      : null;
    return destination
      ? landmarkGuidance(position, destination, flightDirection, RADIUS)
      : null;
  }
  /** Sortie waypoint guidance: the next gate, or the carrier beacon. */
  route(position: T.Vector3, flightDirection: T.Vector3): Guidance | null {
    if (this.free || this.stage === 1) return null;
    const point =
      this.stage === 0
        ? this.rings[this.checkpoint]?.position
        : this.returnRing.position;
    return point
      ? landmarkGuidance(
          position,
          { approach: point, lookAt: point },
          flightDirection,
          RADIUS,
        )
      : null;
  }
  /** Advance objectives from the aircraft's position; call once per flight frame. */
  update(position: T.Vector3, flightDirection: T.Vector3) {
    if (this.free) {
      const scenic = this.scenic(position, flightDirection);
      if (scenic?.arrived && !this.landmarkArrived) {
        this.landmarkArrived = true;
        this.events.landmarkReached(
          this.world.landmarks[this.landmarkIndex].name,
        );
      }
      return;
    }
    if (this.stage === 0) {
      const gate = this.rings[this.checkpoint];
      if (gate && position.distanceTo(gate.position) < 34) {
        gate.visible = false;
        this.checkpoint++;
        this.events.gateCleared(this.checkpoint, gate.position);
        if (this.checkpoint === this.rings.length) {
          this.stage = 1;
          this.events.interceptionBegins();
        }
      }
    } else if (this.stage === 1) {
      if (this.kills === DRONE_COUNT) {
        this.stage = 2;
        this.returnRing.visible = true;
        this.events.airspaceCleared();
      }
    } else if (position.distanceTo(this.returnRing.position) < 43)
      this.events.rendezvous();
  }
  describe(): MissionDescription {
    if (this.free) {
      const landmark = this.world.landmarks[this.landmarkIndex];
      return {
        kicker: "PELAGIC ISLANDS / FREE FLIGHT",
        name: landmark?.name ?? "The open sky",
        hint: landmark
          ? this.landmarkArrived
            ? "Scenic approach reached · Hold X / T to look"
            : "Fly to the scenic approach · Hold X / T to look"
          : "Explore freely · Hold X / T to find Halcyon",
        progress: null,
        landmark: landmark
          ? `${String(this.landmarkIndex + 1).padStart(2, "0")} / ${this.world.landmarks.length} · D-pad / [ ]`
          : "NO DESTINATION · D-pad / [ ]",
      };
    }
    return {
      kicker: KICKERS[this.stage],
      name: TITLES[this.stage],
      hint: HINTS[this.stage],
      progress:
        this.stage === 1
          ? { done: this.kills, total: DRONE_COUNT }
          : { done: this.checkpoint, total: this.rings.length },
      landmark: null,
    };
  }
}
