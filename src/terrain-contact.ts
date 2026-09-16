import * as T from "three";
import type { MeshBVH } from "three-mesh-bvh";

type Collider = {
  mesh: T.Mesh;
  center: T.Vector3;
  radius: number;
  inverse: T.Matrix4;
};
export type TerrainContact = {
  fraction: number;
  center: T.Vector3;
  point: T.Vector3;
  normal: T.Vector3;
  water: boolean;
};

// Per-call scratch. The sweep runs once per frame and never re-enters itself.
const delta = new T.Vector3(),
  seaNormal = new T.Vector3(),
  seaPoint = new T.Vector3(),
  start = new T.Vector3(),
  end = new T.Vector3(),
  movement = new T.Vector3(),
  scale = new T.Vector3(),
  surface = new T.Vector3(),
  path = new T.Vector3(),
  crossing = new T.Vector3(),
  probe = new T.Vector3(),
  closest = new T.Vector3(),
  normal = new T.Vector3(),
  worldPoint = new T.Vector3(),
  segment = new T.Line3(),
  bounds = new T.Box3(),
  ray = new T.Ray(),
  normalMatrix = new T.Matrix3();

/** Sweep the airframe's clearance volume through the whole step, including rolls.
 * Collision math only: all terrain triangles come from the Blender exports. */
export function sweepTerrain(
  colliders: Collider[],
  from: T.Vector3,
  to: T.Vector3,
  seaRadius: number,
  radius = 6,
): TerrainContact | null {
  delta.copy(to).sub(from);
  const length = delta.length();
  let nearest: TerrainContact | null = null;
  const accept = (
    fraction: number,
    point: T.Vector3,
    normal: T.Vector3,
    water: boolean,
  ) => {
    if (
      fraction < 0 ||
      fraction > 1 ||
      (nearest && fraction >= nearest.fraction)
    )
      return;
    // A resting surface must allow the aircraft to lift away from it.
    if (fraction === 0 && delta.dot(normal) >= -0.00001) return;
    nearest = {
      fraction,
      center: from.clone().addScaledVector(delta, fraction),
      point: point.clone(),
      normal: normal.clone(),
      water,
    };
  };
  const sea = seaRadius + radius,
    c = from.lengthSq() - sea * sea;
  if (c <= 0) {
    seaNormal.copy(from).normalize();
    accept(
      0,
      seaPoint.copy(seaNormal).multiplyScalar(seaRadius),
      seaNormal,
      true,
    );
  } else if (length > 0) {
    const b = from.dot(delta),
      disc = b * b - length * length * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (length * length);
      seaNormal.copy(from).addScaledVector(delta, t).normalize();
      accept(
        t,
        seaPoint.copy(seaNormal).multiplyScalar(seaRadius),
        seaNormal,
        true,
      );
    }
  }
  for (const collider of colliders) {
    if (from.distanceTo(collider.center) > collider.radius + length + radius)
      continue;
    start.copy(from).applyMatrix4(collider.inverse);
    end.copy(to).applyMatrix4(collider.inverse);
    // Exported placements currently have unit scale. Keep clearance conservative
    // if a future placement uses scale, including a nonuniform one.
    scale.setFromMatrixScale(collider.mesh.matrixWorld);
    const localRadius = radius / Math.min(scale.x, scale.y, scale.z);
    segment.set(start, end);
    movement.copy(end).sub(start);
    const movementLength = movement.length();
    bounds
      .makeEmpty()
      .expandByPoint(start)
      .expandByPoint(end)
      .expandByScalar(localRadius);
    ray.origin.copy(start);
    ray.direction.copy(movement).normalize();
    normalMatrix.getNormalMatrix(collider.mesh.matrixWorld);
    (collider.mesh.geometry.boundsTree as MeshBVH).shapecast({
      intersectsBounds: (box) => box.intersectsBox(bounds),
      intersectsTriangle: (triangle) => {
        const distance = triangle.closestPointToSegment(segment, surface, path);
        let target = segment.closestPointToPointParameter(path, true);
        // The segment-distance helper covers edges and endpoints; explicitly
        // include a face crossing so a fast step cannot tunnel through a cliff.
        const face = ray.intersectTriangle(
          triangle.a,
          triangle.b,
          triangle.c,
          false,
          crossing,
        );
        if (face && crossing.distanceTo(start) <= movementLength)
          target = segment.closestPointToPointParameter(crossing, true);
        else if (distance > localRadius) return false;
        triangle.closestPointToPoint(start, closest);
        let lo = 0,
          hi = target;
        if (start.distanceTo(closest) <= localRadius) hi = 0;
        else
          for (let i = 0; i < 22; i++) {
            const mid = (lo + hi) / 2;
            probe.copy(start).addScaledVector(movement, mid);
            triangle.closestPointToPoint(probe, closest);
            if (probe.distanceTo(closest) <= localRadius) hi = mid;
            else lo = mid;
          }
        probe.copy(start).addScaledVector(movement, hi);
        triangle.closestPointToPoint(probe, closest);
        normal.copy(probe).sub(closest);
        if (normal.lengthSq() < 1e-10) {
          triangle.getNormal(normal);
          if (normal.dot(movement) > 0) normal.negate();
        }
        normal.normalize().applyNormalMatrix(normalMatrix);
        accept(
          hi,
          worldPoint.copy(closest).applyMatrix4(collider.mesh.matrixWorld),
          normal,
          false,
        );
        return false;
      },
    });
  }
  return nearest;
}

/** Only a completed, upright robot frame can absorb a slow land contact. */
export function gentleRobotContact(
  contact: TerrainContact,
  velocity: T.Vector3,
  transform: number,
  aircraftUp: T.Vector3,
  planetUp: T.Vector3,
) {
  return (
    !contact.water &&
    transform >= 0.98 &&
    velocity.length() <= 12 &&
    Math.max(0, -velocity.dot(contact.normal)) <= 5 &&
    contact.normal.dot(planetUp) >= 0.75 &&
    aircraftUp.dot(planetUp) >= 0.85
  );
}
