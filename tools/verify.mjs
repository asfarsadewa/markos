// Run the unit tests and every asset/animation/flight/camera check in order,
// stopping at the first failure and summarising timings.
import { spawnSync } from "node:child_process";

const steps = [
  ["Unit tests", ["--test", "tests/*.test.mjs"]],
  ["Asset gate", ["tools/check-assets.mjs"]],
  ["Camera", ["tools/verify-camera.mjs"]],
  ["Transformation camera", ["tools/verify-transform-camera.mjs"]],
  ["Camera near terrain", ["tools/verify-camera-terrain.mjs"]],
  ["Airframe", ["tools/verify-airframe.mjs"]],
  ["Framing", ["tools/verify-framing.mjs"]],
  ["Engine exhaust", ["tools/verify-exhaust.mjs"]],
  ["Ailerons", ["tools/verify-ailerons.mjs"]],
  ["Robot controls", ["tools/verify-robot-controls.mjs"]],
  ["Flight stance", ["tools/verify-stance.mjs"]],
  ["Airframe shadow", ["tools/verify-airframe-shadow.mjs"]],
  ["Waterfall", ["tools/verify-waterfall.mjs"]],
  ["Ocean", ["tools/verify-ocean.mjs"]],
  ["World", ["tools/verify-world.mjs"]],
  ["Crash", ["tools/verify-crash.mjs"]],
  ["Landmarks", ["tools/verify-landmarks.mjs"]],
];
const quiet = process.argv.includes("--quiet");
const timings = [];
for (const [name, args] of steps) {
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  timings.push([name, seconds]);
  if (result.status !== 0) {
    if (quiet) process.stderr.write(result.stdout + result.stderr);
    console.error(`\n✖ ${name} failed after ${seconds}s`);
    process.exit(result.status ?? 1);
  }
}
console.log("\nVerification passed:");
for (const [name, seconds] of timings)
  console.log(`  ✔ ${name.padEnd(24)} ${seconds.padStart(5)}s`);
