import { Vector3 } from "three";

export type Destination = { approach: Vector3; lookAt: Vector3 };
export type Guidance = {
  point: Vector3;
  focus: Vector3;
  distance: number;
  beyondHorizon: boolean;
  arrived: boolean;
};

/** Include an unmarked free-roam choice at -1. */
export function cycleLandmark(index: number, step: number, count: number) {
  return ((((index + 1 + step) % (count + 1)) + count + 1) % (count + 1)) - 1;
}

/** Guide across the sphere without pointing through the sea to far-side art. */
export function landmarkGuidance(
  position: Vector3,
  destination: Destination,
  forward: Vector3,
  radius: number,
): Guidance {
  const up = position.clone().normalize();
  const endUp = destination.approach.clone().normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(endUp))));
  const distance = Math.hypot(
    angle * radius,
    position.length() - destination.approach.length(),
  );
  const chord = destination.approach.clone().sub(position);
  const t = Math.max(
    0,
    Math.min(1, -position.dot(chord) / Math.max(1, chord.lengthSq())),
  );
  const beyondHorizon =
    position.clone().addScaledVector(chord, t).length() < radius + 12;
  if (!beyondHorizon)
    return {
      point: destination.approach,
      focus: destination.lookAt,
      distance,
      beyondHorizon,
      arrived: position.distanceTo(destination.approach) < 90,
    };

  const tangent = endUp.projectOnPlane(up);
  // At the antipode both routes are equally short: continue the pilot's heading.
  if (tangent.lengthSq() < 1e-8) tangent.copy(forward).projectOnPlane(up);
  if (tangent.lengthSq() < 1e-8)
    tangent
      .copy(Math.abs(up.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1))
      .projectOnPlane(up);
  const point = position
    .clone()
    .addScaledVector(tangent.normalize(), 600)
    .addScaledVector(up, Math.max(0, radius + 220 - position.length()));
  return { point, focus: point, distance, beyondHorizon, arrived: false };
}
