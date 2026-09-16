import * as T from "three";
import { damp } from "./flight.ts";

/** Sample the Blender-baked control poses after the main transformation pose. */
export class AileronControls {
  amount = 0;
  private readonly duration: number;
  private readonly surfaces: {
    bone: T.Object3D;
    motion: T.QuaternionLinearInterpolant;
  }[];
  constructor(model: T.Object3D, animations: T.AnimationClip[]) {
    const clip = animations.find(
      (candidate) => candidate.name === "AileronBank",
    );
    if (!clip) throw new Error("Blender aileron control clip is missing");
    this.duration = clip.duration;
    this.surfaces = ["L", "R"].map((side) => {
      const name = `aileron_${side}`;
      const bone = model.getObjectByName(name);
      const track = clip.tracks.find(
        (candidate) => candidate.name === `${name}.quaternion`,
      );
      if (!bone || !track)
        throw new Error(`Blender control surface missing: ${name}`);
      return {
        bone,
        motion: new T.QuaternionLinearInterpolant(track.times, track.values, 4),
      };
    });
    this.reset();
  }
  reset() {
    this.amount = 0;
    this.apply(0);
  }
  private apply(amount: number) {
    const time = (amount + 1) * 0.5 * this.duration;
    for (const { bone, motion } of this.surfaces)
      bone.quaternion.fromArray(motion.evaluate(time)).normalize();
  }
  update(dt: number, steering: number, transform: number) {
    this.amount = damp(this.amount, T.MathUtils.clamp(steering, -1, 1), 9, dt);
    const deployed = 1 - T.MathUtils.smoothstep(transform, 0, 0.25);
    this.apply(this.amount * deployed);
  }
}
