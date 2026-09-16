import * as T from "three";
import type { FlightAssets } from "./flight-assets.ts";

/** Expanding fire, painted smoke and sparks instance the existing Blender mesh
 * and cloud paint. No new visible geometry is constructed at runtime. */
export class CrashEffects {
  group = new T.Group();
  age = 0;
  readonly duration = 2.8;
  private pieces: {
    mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
    velocity: T.Vector3;
    delay: number;
    life: number;
    size: number;
    smoke: boolean;
    spark: boolean;
    water: boolean;
    rotation: number;
  }[] = [];
  private readonly assets: FlightAssets;
  constructor(assets: FlightAssets) {
    this.assets = assets;
  }
  start(point: T.Vector3, normal: T.Vector3, water: boolean) {
    this.clear();
    this.group.position.copy(point);
    for (let i = 0; i < 46; i++) {
      const smoke = i >= 14 && i < 32,
        spark = i >= 32;
      const material = new T.MeshBasicMaterial({
        map: this.assets.cloud,
        color: smoke
          ? water
            ? "#d9eeee"
            : "#54465b"
          : water && spark
            ? "#c9f4ff"
            : "#fff0b1",
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: smoke ? T.NormalBlending : T.AdditiveBlending,
      });
      const mesh = new T.Mesh(this.assets.geometry.spark, material);
      const direction = new T.Vector3(
        Math.sin(i * 2.4),
        Math.cos(i * 3.1),
        Math.sin(i * 4.7),
      ).normalize();
      if (direction.dot(normal) < 0) direction.reflect(normal);
      const velocity = direction
        .multiplyScalar(spark ? 27 : smoke ? 5 : 9)
        .addScaledVector(normal, smoke ? 6 : 3);
      this.pieces.push({
        mesh,
        velocity,
        delay: smoke ? 0.12 + (i - 14) * 0.02 : spark ? 0 : i * 0.013,
        life: smoke ? 2.65 : spark ? 0.9 : 0.85,
        size: smoke ? 14 : spark ? 1.8 : 10,
        smoke,
        spark,
        water,
        rotation: i * 2.4,
      });
      this.group.add(mesh);
      mesh.visible = false;
    }
  }
  update(dt: number, camera: T.Camera) {
    this.age += dt;
    for (const p of this.pieces) {
      const t = this.age - p.delay,
        progress = t / p.life;
      p.mesh.visible = t >= 0 && progress < 1;
      if (!p.mesh.visible) continue;
      p.mesh.position.copy(p.velocity).multiplyScalar(t * (p.smoke ? 0.7 : 1));
      p.mesh.quaternion.copy(camera.quaternion);
      p.mesh.rotateZ(p.rotation + t * (p.smoke ? 0.08 : 0.3));
      p.mesh.scale.setScalar(
        p.size *
          (p.smoke
            ? 0.25 + progress
            : 0.3 + Math.sin(progress * Math.PI) * 0.7),
      );
      if (p.spark) {
        p.mesh.scale.x *= 0.18;
        p.mesh.scale.y *= 2.2;
        const localVelocity = p.velocity
          .clone()
          .applyQuaternion(camera.quaternion.clone().invert());
        p.mesh.quaternion.copy(camera.quaternion);
        p.mesh.rotateZ(Math.atan2(-localVelocity.x, localVelocity.y));
      }
      p.mesh.material.opacity =
        (1 - progress) * (p.smoke ? Math.min(1, progress * 12) * 0.75 : 1);
      if (!p.smoke && !(p.water && p.spark))
        p.mesh.material.color.setRGB(1, Math.max(0.12, 0.85 - progress), 0.08);
    }
  }
  clear() {
    for (const p of this.pieces) p.mesh.material.dispose();
    this.pieces.length = 0;
    this.group.clear();
    this.age = 0;
  }
}
