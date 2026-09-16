import * as T from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { FlightAssets } from "./flight-assets.ts";
import type { World } from "./asset-world.ts";
import { RADIUS } from "./asset-world.ts";
import { firstProjectileImpact, interceptTime } from "./flight.ts";
import { cameraContact } from "./targeting.ts";
import type { Particles } from "./effects.ts";
import { DRONE_COUNT } from "./mission.ts";

export type Enemy = {
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
type Bolt = { mesh: T.Mesh; vel: T.Vector3; life: number; enemy: boolean };
export type CombatEvents = {
  shot(): void;
  /** Returns whether the aircraft is still flying afterwards. */
  playerHit(amount: number): boolean;
  enemyDestroyed(): void;
};
export const FRIENDLY_SPEED = 370;
export const FRIENDLY_LIFETIME = 2.2;
const HOSTILE_SPEED = 115;
const HOSTILE_LIFETIME = 7;

/** Drones, bolts, lock-on and impacts. Sound, rumble and scoring go through events. */
export class CombatSystem {
  readonly enemies: Enemy[] = [];
  locked: Enemy | null = null;
  cameraThreat: Enemy | null = null;
  private readonly bolts: Bolt[] = [];
  private fireTimer = 0;
  private assets: FlightAssets | null = null;
  private readonly scene: T.Scene;
  private readonly world: World;
  private readonly particles: Particles;
  private readonly events: CombatEvents;
  private readonly friendlyMaterial = new T.MeshBasicMaterial({
    color: "#fff7ae",
  });
  private readonly hostileMaterial = new T.MeshBasicMaterial({
    color: "#ff6c37",
  });
  private readonly delta = new T.Vector3();
  private readonly origin = new T.Vector3();
  private readonly aim = new T.Vector3();
  private readonly previous = new T.Vector3();
  constructor(
    scene: T.Scene,
    world: World,
    particles: Particles,
    events: CombatEvents,
  ) {
    this.scene = scene;
    this.world = world;
    this.particles = particles;
    this.events = events;
  }
  install(assets: FlightAssets) {
    this.assets = assets;
  }
  /** Alive drone positions, for the radar. */
  contacts() {
    return this.enemies.filter((e) => e.hp > 0).map((e) => e.mesh.position);
  }
  /** The contact the camera should present: held, locked or nearest. */
  threat(track: boolean, position: T.Vector3) {
    return cameraContact(
      this.enemies,
      this.locked,
      track ? this.cameraThreat : null,
      position,
    );
  }
  updateCameraThreat(track: boolean, inCombat: boolean, position: T.Vector3) {
    this.cameraThreat =
      track && inCombat
        ? cameraContact(this.enemies, this.locked, this.cameraThreat, position)
        : null;
  }
  spawn(
    position: T.Vector3,
    forward: T.Vector3,
    right: T.Vector3,
    alt: number,
  ) {
    if (!this.assets) return;
    for (let i = 0; i < DRONE_COUNT; i++) {
      const g = clone(this.assets.drone.scene) as T.Group;
      const patrol = new T.AnimationMixer(g);
      for (const clip of this.assets.drone.animations)
        patrol.clipAction(clip).play();
      const center = position
        .clone()
        .addScaledVector(forward, 200 + i * 35)
        .addScaledVector(right, ((i % 3) - 1) * 85);
      center
        .normalize()
        .multiplyScalar(RADIUS + Math.max(240, alt + 90) + (i % 2) * 30);
      g.position.copy(center);
      this.scene.add(g);
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
      g.position.copy(this.patrolPoint(enemy));
      this.enemies.push(enemy);
    }
  }
  clear() {
    for (const e of this.enemies) {
      e.mixer.stopAllAction();
      this.scene.remove(e.mesh);
    }
    this.enemies.length = 0;
    this.clearBolts();
    this.locked = null;
    this.cameraThreat = null;
    this.fireTimer = 0;
  }
  clearBolts() {
    for (const b of this.bolts) this.scene.remove(b.mesh);
    this.bolts.length = 0;
  }
  private patrolPoint(e: Enemy, ahead = 0) {
    const phase = e.phase + ahead * 0.55;
    return e.center
      .clone()
      .addScaledVector(e.tangent, Math.cos(phase) * 65)
      .addScaledVector(e.depth, Math.sin(phase) * 60)
      .addScaledVector(e.up, Math.sin(phase * 1.7) * 13);
  }
  private shoot(origin: T.Vector3, direction: T.Vector3, enemy: boolean) {
    if (!this.assets) return;
    const mesh = new T.Mesh(
      this.assets.geometry.tracer,
      enemy ? this.hostileMaterial : this.friendlyMaterial,
    );
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction);
    this.scene.add(mesh);
    this.bolts.push({
      mesh,
      vel: direction
        .clone()
        .multiplyScalar(enemy ? HOSTILE_SPEED : FRIENDLY_SPEED),
      life: enemy ? HOSTILE_LIFETIME : FRIENDLY_LIFETIME,
      enemy,
    });
  }
  /** Nearest exposed drone inside the lock cone; wider once transformed. */
  acquireLock(
    position: T.Vector3,
    flightDirection: T.Vector3,
    transform: number,
  ) {
    this.locked = null;
    let nearest = Infinity;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      this.delta.copy(e.mesh.position).sub(position);
      const dist = this.delta.length();
      if (
        dist < 650 &&
        this.delta.normalize().dot(flightDirection) >
          (transform > 0.5 ? 0.55 : 0.88) &&
        dist < nearest &&
        this.world.weaponObstruction(position, e.mesh.position) === null
      ) {
        nearest = dist;
        this.locked = e;
      }
    }
  }
  fire(
    dt: number,
    trigger: boolean,
    position: T.Vector3,
    forward: T.Vector3,
    flightDirection: T.Vector3,
    transform: number,
  ) {
    this.fireTimer -= dt;
    if (!trigger || this.fireTimer > 0) return;
    this.fireTimer = transform > 0.5 ? 0.13 : 0.18;
    const origin = this.origin.copy(position).addScaledVector(forward, 5);
    const aim = this.aim.copy(flightDirection);
    const locked = this.locked;
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
          origin.distanceTo(this.patrolPoint(locked, lead)) / FRIENDLY_SPEED,
        );
      aim.copy(this.patrolPoint(locked, lead)).sub(origin).normalize();
    }
    this.shoot(origin, aim, false);
    this.events.shot();
  }
  updateEnemies(dt: number, position: T.Vector3) {
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      e.phase += dt * 0.55;
      e.mixer.update(dt);
      e.mesh.position.copy(this.patrolPoint(e));
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
        this.shoot(
          e.mesh.position,
          position.clone().sub(e.mesh.position).normalize(),
          true,
        );
        e.shot = 3.4 + Math.random() * 2;
      }
    }
  }
  /** Advance bolts and resolve impacts. Returns false once a hit ends the flight. */
  updateBolts(dt: number, position: T.Vector3) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const old = this.previous.copy(b.mesh.position);
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      const candidates = b.enemy ? [] : this.enemies.filter((e) => e.hp > 0);
      const impact = firstProjectileImpact(
        old,
        b.mesh.position,
        this.world.weaponObstruction(old, b.mesh.position),
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
          this.particles.burst(
            b.mesh.position,
            4,
            b.mesh.position.length() < RADIUS + 1 ? "#b7efff" : "#ffd78d",
          );
        } else if (b.enemy) {
          if (!this.events.playerHit(12)) return false;
        } else {
          const e = candidates[impact.targetIndex];
          e.hp--;
          this.particles.burst(e.mesh.position, 4);
          if (e.hp === 0) {
            this.particles.burst(e.mesh.position, 22);
            e.mesh.visible = false;
            this.events.enemyDestroyed();
          }
        }
      }
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }
    return true;
  }
}
