export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export function flightProfile(transform, brake, thrust) {
  const t = clamp(transform, 0, 1);
  const blend = t * t * (3 - 2 * t);
  const mix = (a, b) => a + (b - a) * blend;
  const cruise = mix(82, 28),
    maximum = mix(185, 85);
  return {
    speed: brake
      ? mix(32, 8)
      : cruise + (maximum - cruise) * clamp(thrust, 0, 1),
    turnRate: mix(brake ? 1.6 : 1.05, 1.65),
    pitchRate: mix(1.15, 0.75),
  };
}
export function advanceAfterburner(energy, recovering, demand, dt) {
  demand = clamp(demand, 0, 1);
  // Hysteresis prevents alternating powered/unpowered frames at an empty tank.
  if (energy <= 0.005) recovering = true;
  if (recovering && energy >= 0.3) recovering = false;
  const thrust = recovering ? 0 : demand;
  energy = clamp(energy + (thrust > 0 ? -0.22 * thrust : 0.14) * dt, 0, 1);
  return { energy, recovering, thrust };
}
export function deadzone(x, y, zone = 0.15) {
  const length = Math.hypot(x, y);
  if (length <= zone) return [0, 0];
  const magnitude = clamp((length - zone) / (1 - zone), 0, 1);
  return [(x / length) * magnitude, (y / length) * magnitude];
}
/** Radial response preserves direction and full travel while easing fine input. */
export function stickResponse(x, y, zone = 0.15, precision = true) {
  const [a, b] = deadzone(x, y, zone);
  const magnitude = Math.hypot(a, b);
  const gain = precision ? 0.65 + 0.35 * magnitude * magnitude : 1;
  return [a * gain, b * gain];
}
export function advanceTransform(value, target, dt) {
  return value < target
    ? Math.min(target, value + dt / 2.4)
    : Math.max(target, value - dt / 2.4);
}
export function segmentDistance(point, start, end) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    dz = end.z - start.z;
  const l = dx * dx + dy * dy + dz * dz;
  const t = l
    ? clamp(
        ((point.x - start.x) * dx +
          (point.y - start.y) * dy +
          (point.z - start.z) * dz) /
          l,
        0,
        1,
      )
    : 0;
  return Math.hypot(
    point.x - start.x - dx * t,
    point.y - start.y - dy * t,
    point.z - start.z - dz * t,
  );
}

/** Earliest entry into a target volume, measured along the traveled segment. */
export function segmentSphereImpact(point, start, end, radius) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    dz = end.z - start.z;
  const mx = start.x - point.x,
    my = start.y - point.y,
    mz = start.z - point.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const c = mx * mx + my * my + mz * mz - radius * radius;
  if (c <= 0) return 0;
  if (lengthSq < 1e-12) return null;
  const b = mx * dx + my * dy + mz * dz,
    discriminant = b * b - lengthSq * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / lengthSq;
  return t >= 0 && t <= 1 ? t * Math.sqrt(lengthSq) : null;
}

/** A wall wins ties; array order cannot select an aircraft behind a nearer hit. */
export function firstProjectileImpact(
  start,
  end,
  terrainDistance,
  targets,
  radius,
) {
  let distance = terrainDistance ?? Infinity,
    targetIndex = -1;
  for (let index = 0; index < targets.length; index++) {
    const entry = segmentSphereImpact(targets[index], start, end, radius);
    if (entry !== null && entry < distance) {
      distance = entry;
      targetIndex = index;
    }
  }
  return Number.isFinite(distance) ? { distance, targetIndex } : null;
}

/** Constant-velocity lead, bounded by the projectile's actual lifetime. */
export function interceptTime(relative, velocity, speed, lifetime = 2.2) {
  const a = velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2 - speed ** 2;
  const b =
    2 *
    (relative.x * velocity.x +
      relative.y * velocity.y +
      relative.z * velocity.z);
  const c = relative.x ** 2 + relative.y ** 2 + relative.z ** 2;
  const roots = [];
  if (Math.abs(a) < 1e-8) {
    if (Math.abs(b) > 1e-8) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0)
      roots.push(
        (-b - Math.sqrt(discriminant)) / (2 * a),
        (-b + Math.sqrt(discriminant)) / (2 * a),
      );
  }
  const valid = roots.filter((t) => t >= 0 && t <= lifetime);
  return valid.length ? Math.min(...valid) : 0;
}
