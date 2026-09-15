/** Keep a camera contact until release or destruction, independently of weapon lock. */
export function cameraContact(enemies, locked, previous, position) {
  const alive = (enemy) => enemy && enemy.hp > 0 && enemies.includes(enemy);
  if (alive(previous)) return previous;
  if (alive(locked)) return locked;
  return enemies.reduce(
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
