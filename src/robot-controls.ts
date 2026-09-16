import * as T from "three";
import { damp } from "./flight.ts";

/** Apply Blender-authored bracing relative to the current transformation pose. */
export class RobotControls {
  amount = 0;
  private readonly duration: number;
  private readonly transformDuration: number;
  private readonly delta = new T.Quaternion();
  private readonly joints: {
    bone: T.Object3D;
    motion: T.QuaternionLinearInterpolant;
    base: T.QuaternionLinearInterpolant;
    neutralInverse: T.Quaternion;
  }[];
  constructor(model: T.Object3D, animations: T.AnimationClip[]) {
    const motion = animations.find((a) => a.name === "RobotBank");
    const transform = animations.find((a) => a.name === "Transform");
    if (!motion || !transform)
      throw new Error("Blender robot steering poses are missing");
    this.duration = motion.duration;
    this.transformDuration = transform.duration;
    this.joints = ["head", "arm_L", "arm_R", "forearm_L", "forearm_R"].map(
      (name) => {
        const bone = model.getObjectByName(name);
        const track = motion.tracks.find(
          (t) => t.name === name + ".quaternion",
        );
        const baseTrack = transform.tracks.find(
          (t) => t.name === name + ".quaternion",
        );
        if (!bone || !track || !baseTrack)
          throw new Error("Robot steering joint missing: " + name);
        const sampler = new T.QuaternionLinearInterpolant(
          track.times,
          track.values,
          4,
        );
        return {
          bone,
          motion: sampler,
          base: new T.QuaternionLinearInterpolant(
            baseTrack.times,
            baseTrack.values,
            4,
          ),
          neutralInverse: new T.Quaternion()
            .fromArray(sampler.evaluate(this.duration * 0.5))
            .invert(),
        };
      },
    );
  }
  reset() {
    this.amount = 0;
  }
  update(dt: number, steering: number, transform: number) {
    this.amount = damp(this.amount, T.MathUtils.clamp(steering, -1, 1), 7, dt);
    const t = T.MathUtils.clamp(transform, 0, 1);
    const weight = T.MathUtils.smoothstep(t, 0.65, 1);
    const time = (1 + this.amount * weight) * 0.5 * this.duration;
    for (const joint of this.joints) {
      this.delta
        .fromArray(joint.motion.evaluate(time))
        .premultiply(joint.neutralInverse);
      // Sample the immutable base each frame; multiplying the live bone would
      // accumulate rotation while the paused Transform action is unchanged.
      joint.bone.quaternion
        .fromArray(joint.base.evaluate(t * (this.transformDuration - 0.00001)))
        .multiply(this.delta)
        .normalize();
    }
  }
}
