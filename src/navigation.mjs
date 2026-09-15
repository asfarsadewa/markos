/** Match the displayed fisheye image and keep off-screen guidance directional. */
export function navigationMarker(view, fov, aspect, bend = 0.09) {
  const behind = view.z >= 0;
  const depth = Math.max(0.001, Math.abs(view.z));
  const focal = 1 / Math.tan((fov * Math.PI) / 360);
  let x = (view.x * focal) / (depth * aspect),
    y = (view.y * focal) / depth;
  // Rear objectives use a left/right turn cue. Their downward chord through
  // the spherical world must not suggest diving through the ocean to reach them.
  if (behind) {
    x = view.x < -0.001 ? -1 : 1;
    y = 0;
  }
  const rawRadius = Math.hypot(x, y);
  if (rawRadius > 0 && bend > 0) {
    // The lens samples source = output * (1 + bend*r^2)/(1 + 1.65*bend).
    // Invert that monotonic radial curve for the DOM marker's screen position.
    const goal = rawRadius * (1 + bend * 1.65);
    let radius = Math.min(goal, Math.cbrt(goal / bend));
    for (let step = 0; step < 12; step++)
      radius -=
        (radius + bend * radius ** 3 - goal) / (1 + 3 * bend * radius * radius);
    const scale = radius / rawRadius;
    x *= scale;
    y *= scale;
  }
  const limitX = 0.72,
    limitY = 0.65;
  const edge = Math.max(Math.abs(x) / limitX, Math.abs(y) / limitY);
  const offscreen = behind || edge > 1;
  const angle = Math.atan2(-y, x);
  if (offscreen) {
    const scale = 1 / Math.max(edge, 1e-8);
    x *= scale;
    y *= scale;
    // Leave room for the mission copy and airframe instruments on the left.
    if (x < -0.5) y = Math.max(-0.35, Math.min(0.3, y));
  }
  return { x, y, behind, offscreen, angle };
}

/** Keep a guidance card clear of fixed instruments without changing its bearing.
 * A displaced target becomes a directional arrow, never a false aim box. */
export function clearGuidancePosition(marker, width, height, regions) {
  const gutter = 12;
  const origin = { x: width / 2, y: height / 2 };
  const target = {
    x: (marker.x * 0.5 + 0.5) * width,
    y: (-marker.y * 0.5 + 0.5) * height,
  };
  const fits = (p, halfWidth, halfHeight) =>
    p.x >= halfWidth + gutter &&
    p.x <= width - halfWidth - gutter &&
    p.y >= halfHeight + gutter &&
    p.y <= height - halfHeight - gutter &&
    regions.every(
      (r) =>
        p.x + halfWidth + gutter <= r.left ||
        p.x - halfWidth - gutter >= r.right ||
        p.y + halfHeight + gutter <= r.top ||
        p.y - halfHeight - gutter >= r.bottom,
    );
  if (fits(target, 68, 54))
    return { ...target, moved: false, visible: true, compact: false };
  // Search inward along the same projected bearing. This keeps an edge cue on
  // the correct side while reserving space for mission/radio/safety messages.
  const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
  const steps = Math.max(1, Math.ceil(distance / 3));
  for (const compact of [false, true])
    for (let step = compact ? 0 : 1; step <= steps; step++) {
      const t = 1 - step / steps;
      const point = {
        x: origin.x + (target.x - origin.x) * t,
        y: origin.y + (target.y - origin.y) * t,
      };
      if (fits(point, compact ? 32 : 68, compact ? 24 : 54))
        return { ...point, moved: true, visible: true, compact };
    }
  // If the center itself is occupied, a nearby compact cue still guides the
  // player. Its arrow is aimed back at an on-screen target by HudGuidance.
  for (let radius = 16; radius <= 192; radius += 16) {
    for (let direction = 0; direction < 16; direction++) {
      const angle = (direction * Math.PI) / 8;
      const point = {
        x: target.x + Math.cos(angle) * radius,
        y: target.y + Math.sin(angle) * radius,
      };
      if (fits(point, 32, 24))
        return { ...point, moved: true, visible: true, compact: true };
    }
  }
  // Very short viewports can have no room for a full card. Preserve the
  // instruments rather than drawing unreadable guidance over them.
  return { ...target, moved: true, visible: false, compact: true };
}
