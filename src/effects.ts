import * as T from "three";
import type { FlightAssets } from "./flight-assets.ts";

type Particle = { mesh: T.Mesh; vel: T.Vector3; life: number; max: number };

/** Short-lived painted sparks for hits, gates and kills; instances the exported spark mesh. */
export class Particles {
  private readonly scene: T.Scene;
  private assets: FlightAssets | null = null;
  private readonly particles: Particle[] = [];
  constructor(scene: T.Scene) {
    this.scene = scene;
  }
  install(assets: FlightAssets) {
    this.assets = assets;
  }
  burst(pos: T.Vector3, count = 16, color = "#ffd78d") {
    if (!this.assets) return;
    for (let i = 0; i < count; i++) {
      const material = new T.MeshBasicMaterial({
        map: this.assets.cloud,
        color,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
      });
      const mesh = new T.Mesh(this.assets.geometry.spark, material);
      mesh.position.copy(pos);
      const vel = new T.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      )
        .normalize()
        .multiplyScalar(10 + Math.random() * 25);
      const life = 0.4 + Math.random() * 0.9;
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life, max: life });
    }
  }
  update(dt: number, facing: T.Quaternion) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.quaternion.copy(facing);
      p.mesh.scale.setScalar(Math.max(0.01, (p.life / p.max) * 2.3));
      (p.mesh.material as T.MeshBasicMaterial).opacity = p.life / p.max;
      if (p.life <= 0) this.remove(i);
    }
  }
  clear() {
    for (let i = this.particles.length - 1; i >= 0; i--) this.remove(i);
  }
  private remove(index: number) {
    const p = this.particles[index];
    this.scene.remove(p.mesh);
    (p.mesh.material as T.Material).dispose();
    this.particles.splice(index, 1);
  }
}
