import type { Vector3 } from "three";

type Contact = { hp: number; mesh: { position: Vector3 } };

/** Keep a camera contact until release or destruction, independently of weapon lock. */
export function cameraContact<E extends Contact>(
  enemies: E[],
  locked: E | null,
  previous: E | null,
  position: Vector3,
): E | null {
  const alive = (enemy: E | null): enemy is E =>
    !!enemy && enemy.hp > 0 && enemies.includes(enemy);
  if (alive(previous)) return previous;
  if (alive(locked)) return locked;
  return enemies.reduce<E | null>(
    (best, enemy) =>
      enemy.hp > 0 &&
      (!best ||
        enemy.mesh.position.distanceToSquared(position) <
          best.mesh.position.distanceToSquared(position))
        ? enemy
        : best,
    null,
  );
}
