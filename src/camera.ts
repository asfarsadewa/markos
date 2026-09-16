import * as T from "three";
import { damp, clamp } from "./flight.ts";
import type { Input } from "./input.ts";
import type { World } from "./asset-world.ts";
/** Keep a useful horizontal film gate when the game window becomes narrow. */
export function fitCameraFov(nominalFov: number, aspect: number) {
  return T.MathUtils.radToDeg(
    2 *
      Math.atan(
        Math.tan(T.MathUtils.degToRad(nominalFov) / 2) *
          Math.max(1, 1.05 / aspect),
      ),
  );
}
// Per-frame scratch. One rig updates at a time and never re-enters itself.
const delta = new T.Vector3(),
  direction = new T.Vector3(),
  flightUp = new T.Vector3(),
  right = new T.Vector3(),
  toward = new T.Vector3(),
  orbitRight = new T.Vector3(),
  backward = new T.Vector3(),
  desired = new T.Vector3(),
  radial = new T.Vector3(),
  offset = new T.Vector3(),
  destination = new T.Vector3(),
  fromUnit = new T.Vector3(),
  toUnit = new T.Vector3(),
  targetUp = new T.Vector3(),
  aim = new T.Vector3(),
  turn = new T.Quaternion(),
  step = new T.Quaternion(),
  rockOffset = new T.Vector3(),
  rockDirection = new T.Vector3(),
  above = new T.Vector3(),
  across = new T.Vector3(),
  candidate = new T.Vector3(),
  previous = new T.Vector3();
/** Spring chase with a full spherical orbit. Aircraft attitude and camera lag are separate. */
export class FlightCamera {
  static readonly names = ["CHASE", "WIDE", "CLOSE", "WINGMAN"];
  yaw = 0;
  pitch = 0;
  idle = 0;
  distanceMode = 0;
  lastTarget = 0;
  private transformShotBlocked = false;
  lastPosition: T.Vector3 | null = null;
  aimAhead = 10;
  aimHeight = 1.2;
  aimSide = 0;
  centering = false;
  autoReturn = true;
  nominalFov = 55;
  private lastPitch: number | null = null;
  private pitchRate = 0;
  tracking = false;
  private trackingYaw = 0;
  readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  readonly camera: T.PerspectiveCamera;
  constructor(camera: T.PerspectiveCamera) {
    this.camera = camera;
  }
  reset() {
    this.yaw = this.pitch = this.idle = 0;
    this.lastTarget = 0;
    this.transformShotBlocked = false;
    this.lastPosition = null;
    this.aimAhead = 10;
    this.aimHeight = 1.2;
    this.aimSide = 0;
    this.centering = false;
    this.nominalFov = 55;
    this.lastPitch = null;
    this.pitchRate = 0;
    this.tracking = false;
    this.trackingYaw = 0;
  }
  recenter() {
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.idle = 1;
    this.centering = true;
    this.transformShotBlocked = true;
  }
  cycle() {
    return this.select((this.distanceMode + 1) % FlightCamera.names.length);
  }
  select(index: number) {
    this.distanceMode = clamp(
      Math.round(index),
      0,
      FlightCamera.names.length - 1,
    );
    return FlightCamera.names[this.distanceMode];
  }
  update(
    dt: number,
    input: Input,
    world: World,
    pos: T.Vector3,
    forward: T.Vector3,
    radialUp: T.Vector3,
    aircraftPitch: number,
    bank: number,
    speed: number,
    boost: boolean,
    transformTarget: number,
    transform: number,
    focus: T.Vector3 | null = null,
  ) {
    const camera = this.camera;
    camera.clearViewOffset();
    if (dt > 0 && this.lastPitch !== null) {
      const delta = Math.atan2(
        Math.sin(aircraftPitch - this.lastPitch),
        Math.cos(aircraftPitch - this.lastPitch),
      );
      this.pitchRate = damp(this.pitchRate, Math.abs(delta) / dt, 12, dt);
    }
    this.lastPitch = aircraftPitch;
    // Follow translation directly; damp the orbit offset, avoiding speed-dependent camera drag.
    if (this.lastPosition)
      camera.position.add(delta.copy(pos).sub(this.lastPosition));
    if (!this.lastPosition) this.lastPosition = pos.clone();
    else this.lastPosition.copy(pos);
    if (transformTarget !== this.lastTarget) {
      this.transformShotBlocked = false;
      this.lastTarget = transformTarget;
    }
    const look = input.look;
    const manual = Math.abs(look.x) + Math.abs(look.y) > 0.001;
    if (manual) {
      this.centering = false;
      this.idle = 0;
      this.yaw += look.x * dt * 2.1;
      this.pitch = clamp(this.pitch + look.y * dt * 1.35, -1.15, 1.15);
    } else {
      this.idle += dt;
      if (this.idle > 0.7 && (this.autoReturn || this.centering)) {
        this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
        const returnRate = this.centering ? 6 : 2;
        this.yaw = damp(this.yaw, 0, returnRate, dt);
        this.pitch = damp(this.pitch, 0, returnRate, dt);
        if (Math.abs(this.yaw) + Math.abs(this.pitch) < 0.005)
          this.centering = false;
      }
    }
    const orbiting =
      manual || Math.abs(this.yaw) + Math.abs(this.pitch) > 0.025;
    direction
      .copy(forward)
      .multiplyScalar(Math.cos(aircraftPitch))
      .addScaledVector(radialUp, Math.sin(aircraftPitch))
      .normalize();
    flightUp
      .copy(radialUp)
      .multiplyScalar(Math.cos(aircraftPitch))
      .addScaledVector(forward, -Math.sin(aircraftPitch))
      .normalize();
    right.crossVectors(direction, flightUp).normalize();
    this.tracking =
      !!focus &&
      focus.distanceToSquared(pos) > 4 &&
      !manual &&
      !this.centering &&
      !input.down("KeyC");
    let trackingPitch = 0;
    if (this.tracking) {
      toward.copy(focus!).sub(pos).normalize();
      const x = toward.dot(right),
        z = toward.dot(direction);
      // At a vertical crossing, retain the last azimuth instead of choosing
      // a random side from a nearly zero horizontal projection.
      if (Math.hypot(x, z) > 0.01) this.trackingYaw = -Math.atan2(x, z);
      trackingPitch = clamp(
        Math.atan2(toward.dot(flightUp), Math.hypot(x, z)),
        -1.05,
        1.05,
      );
    }
    // Once the player takes the camera, do not reintroduce the automatic arc
    // during this transformation. A new transformation can start a new shot.
    if (orbiting || this.centering || this.tracking || input.down("KeyC"))
      this.transformShotBlocked = true;
    // Sample the same reversible progress as the baked mechanical sequence.
    // Squared sine eases both endpoints; reversing does not restart a timer.
    const transformShot =
      !this.reduced &&
      !orbiting &&
      !this.transformShotBlocked &&
      transform > 0 &&
      transform < 1
        ? Math.sin(transform * Math.PI) ** 2
        : 0;
    const sweep = transformShot * 1.05;
    const shotFocus = T.MathUtils.smoothstep(transformShot, 0, 0.25);
    const wingman = this.distanceMode === 3;
    // The side camera moves toward the front quarter as the upright frame
    // unfolds, revealing its cockpit and arms instead of only its back wings.
    const orbitYaw = input.down("KeyC")
      ? Math.PI
      : this.tracking
        ? this.trackingYaw
        : this.yaw + sweep + (wingman ? 0.95 + transform * 1.2 : 0);
    orbitRight.copy(right).applyAxisAngle(flightUp, orbitYaw);
    backward
      .copy(direction)
      .negate()
      .applyAxisAngle(flightUp, orbitYaw)
      .applyAxisAngle(orbitRight, this.tracking ? trackingPitch : this.pitch);
    const rush = clamp(
      (speed - (82 - transform * 54)) / (103 - transform * 46),
      0,
      1,
    );
    const baseHeight =
      [10, 14, 6, 5][this.distanceMode] * (1 - transform * 0.25);
    const height = this.tracking ? Math.min(5, baseHeight) : baseHeight;
    const baseDistance =
      [27, 43, 19, 30][this.distanceMode] +
      rush * 6 +
      transformShot * 2.5 +
      transform * 5;
    const distance = this.tracking
      ? Math.max(32 + transform * 4, baseDistance)
      : baseDistance;
    desired
      .copy(pos)
      .addScaledVector(backward, distance)
      .addScaledVector(flightUp, height);
    const clearance = world.terrainClearance(desired);
    if (clearance < 6)
      desired.addScaledVector(radial.copy(desired).normalize(), 6 - clearance);
    const pullInFrontOfRock = (point: T.Vector3) => {
      const hit = world.cameraObstruction(pos, point);
      if (hit === null) return;
      rockOffset.copy(point).sub(pos);
      // Keep a working shot beside a nearby cliff. Pulling straight toward the
      // aircraft can put the lens inside its wings even though the ray is clear.
      const radius = rockOffset.length();
      const minimum = Math.min(18, radius);
      if (hit - 2 < minimum) {
        rockDirection.copy(rockOffset).normalize();
        above
          .copy(radialUp)
          .addScaledVector(rockDirection, -radialUp.dot(rockDirection));
        if (above.lengthSq() < 0.001)
          above.copy(right).projectOnPlane(rockDirection);
        above.normalize();
        across.crossVectors(rockDirection, above).normalize();
        const clearCandidate = (candidate: T.Vector3) => {
          if (candidate.distanceTo(pos) < minimum - 0.001) return false;
          const obstruction = world.cameraObstruction(pos, candidate);
          const available = obstruction === null ? radius : obstruction - 2;
          if (available < minimum) return false;
          candidate.sub(pos).setLength(Math.min(radius, available)).add(pos);
          return world.terrainClearance(candidate) >= 2;
        };
        // Retain the previous clear angle while the obstruction persists. This
        // prevents neighboring rock faces from repeatedly swapping shoulders.
        previous.copy(camera.position).sub(pos).setLength(radius).add(pos);
        if (clearCandidate(previous)) {
          point.copy(previous);
          return;
        }
        for (const angle of [Math.PI / 6, Math.PI / 3, Math.PI / 2]) {
          for (const azimuth of [
            0,
            Math.PI / 4,
            -Math.PI / 4,
            Math.PI / 2,
            -Math.PI / 2,
            Math.PI,
          ]) {
            candidate
              .copy(rockDirection)
              .multiplyScalar(Math.cos(angle))
              .addScaledVector(above, Math.sin(angle) * Math.cos(azimuth))
              .addScaledVector(across, Math.sin(angle) * Math.sin(azimuth))
              .multiplyScalar(radius)
              .add(pos);
            if (clearCandidate(candidate)) {
              point.copy(candidate);
              return;
            }
          }
        }
      }
      point
        .copy(pos)
        .addScaledVector(rockOffset.normalize(), Math.max(0.05, hit - 2));
    };
    pullInFrontOfRock(desired);
    // Interpolate around the aircraft, not along a chord through it. A quick
    // return from the front hemisphere must keep its working camera distance.
    const follow = 1 - Math.exp(-(this.centering ? 8 : manual ? 6 : 3.6) * dt);
    offset.copy(camera.position).sub(pos);
    destination.copy(desired).sub(pos);
    const radius = offset.length(),
      desiredRadius = destination.length();
    if (radius > 0.001 && desiredRadius > 0.001) {
      turn.setFromUnitVectors(
        fromUnit.copy(offset).divideScalar(radius),
        toUnit.copy(destination).divideScalar(desiredRadius),
      );
      offset.applyQuaternion(step.identity().slerp(turn, follow));
      offset.setLength(T.MathUtils.lerp(radius, desiredRadius, follow));
      camera.position.copy(pos).add(offset);
    } else camera.position.lerp(desired, follow);
    // The smoothed path can cross a ridge even when its destination is clear.
    const actualClearance = world.terrainClearance(camera.position);
    if (actualClearance < 5)
      camera.position.addScaledVector(
        radial.copy(camera.position).normalize(),
        5 - actualClearance,
      );
    pullInFrontOfRock(camera.position);
    targetUp
      .copy(flightUp)
      .applyAxisAngle(direction, bank * (this.reduced ? 0 : 0.16));
    camera.up.lerp(targetUp, 1 - Math.exp(-3.5 * dt)).normalize();
    const focusScale = Math.min(
      1,
      camera.position.distanceTo(pos) / Math.hypot(distance, height),
    );
    const lookAhead =
      (orbiting || this.centering || this.tracking || input.down("KeyC")
        ? 0
        : wingman
          ? 2
          : 10 * (1 - 0.75 * clamp(this.pitchRate / 1.15, 0, 1))) *
      focusScale *
      (1 - shotFocus);
    if (focusScale < 0.8) this.aimAhead = Math.min(this.aimAhead, lookAhead);
    this.aimAhead = damp(this.aimAhead, lookAhead, 7, dt);
    this.aimHeight = damp(
      this.aimHeight,
      orbiting || this.centering || this.tracking
        ? 0
        : 1.2 * (1 - transform) * focusScale * (1 - shotFocus),
      7,
      dt,
    );
    // Give a turn a little leading room without dragging the chase rig away
    // from the aircraft. Free-look and transformation shots retain manual aim.
    this.aimSide = damp(
      this.aimSide,
      orbiting ||
        this.centering ||
        this.tracking ||
        wingman ||
        input.down("KeyC")
        ? 0
        : -bank * 3 * focusScale * (1 - shotFocus),
      4,
      dt,
    );
    if (focusScale < 0.8)
      this.aimSide = clamp(this.aimSide, -3 * focusScale, 3 * focusScale);
    aim
      .copy(pos)
      .addScaledVector(direction, this.aimAhead)
      .addScaledVector(flightUp, this.aimHeight)
      .addScaledVector(right, this.aimSide);
    camera.lookAt(aim);
    this.nominalFov = damp(
      this.nominalFov,
      (this.distanceMode === 1 ? 60 : wingman ? 50 : 55) +
        rush * (this.reduced ? 5 : 12),
      2.1,
      dt,
    );
    // Smooth speed/style changes in lens space; apply aspect compensation
    // immediately so resizing cannot crop a wing during the spring's catch-up.
    camera.fov = fitCameraFov(this.nominalFov, camera.aspect);
    camera.updateProjectionMatrix();
  }
}
