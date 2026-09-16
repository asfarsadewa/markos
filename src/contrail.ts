import * as T from "three";

/** Wingtip vapour lines drawn through the exported contrail geometry. */
export class Contrail {
  static readonly count = 95;
  private readonly left: T.Vector3[] = [];
  private readonly right: T.Vector3[] = [];
  private readonly scene: T.Scene;
  private geometry: T.BufferGeometry | null = null;
  private array: Float32Array | null = null;
  private lines: T.LineSegments | null = null;
  private readonly material = new T.LineBasicMaterial({
    color: "#eff8e2",
    transparent: true,
    opacity: 0.34,
  });
  constructor(scene: T.Scene) {
    this.scene = scene;
  }
  install(source: T.BufferGeometry) {
    this.geometry = source.clone();
    this.geometry.setIndex(null);
    this.array = this.geometry.attributes.position.array as Float32Array;
    this.geometry.setDrawRange(0, (Contrail.count - 1) * 2);
    this.lines = new T.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
  }
  set visible(value: boolean) {
    if (this.lines) this.lines.visible = value;
  }
  reset() {
    this.left.length = this.right.length = 0;
  }
  update(
    position: T.Vector3,
    right: T.Vector3,
    transform: number,
    activeThrust: number,
  ) {
    if (!this.geometry || !this.array) return;
    for (const side of [-1, 1]) {
      const list = side < 0 ? this.left : this.right;
      list.unshift(
        position
          .clone()
          .addScaledVector(right, side * (transform > 0.5 ? 1.4 : 5.4)),
      );
      if (list.length > Contrail.count) list.pop();
    }
    for (let i = 0; i < Contrail.count - 1; i++) {
      const l = i % 2 ? this.left : this.right;
      const a = l[Math.floor(i / 2)] ?? position,
        b = l[Math.floor(i / 2) + 1] ?? position;
      a.toArray(this.array, i * 6);
      b.toArray(this.array, i * 6 + 3);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.material.opacity =
      (0.24 + activeThrust * 0.24) * (1 - transform) + 0.08 * transform;
  }
}
