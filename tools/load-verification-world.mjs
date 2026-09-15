import fs from "node:fs";
import ts from "typescript";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
fs.mkdirSync("output/verification", { recursive: true });
fs.writeFileSync(
  "output/verification/cloud-paint.mjs",
  ts.transpile(fs.readFileSync("src/cloud-paint.ts", "utf8"), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  }),
);
fs.writeFileSync(
  "output/verification/asset-world.mjs",
  ts
    .transpile(fs.readFileSync("src/asset-world.ts", "utf8"), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    })
    .replace('"./cloud-paint"', '"./cloud-paint.mjs"'),
);
const { World, RADIUS } =
  await import("../output/verification/asset-world.mjs");
// Load real exported collision geometry without the renderer or image dependencies.
const world = Object.create(World.prototype);
world.colliders = [];
world.ray = new T.Raycaster();
world.ray.firstHitOnly = true;
world.local = new T.Vector3();
const loader = new GLTFLoader();
const layout = JSON.parse(
  fs.readFileSync("public/models/environment-layout.json", "utf8"),
);
const cache = new Map();
for (const placement of layout.islands) {
  if (!cache.has(placement.asset)) {
    const bytes = fs.readFileSync(
      `public/models/${placement.asset}-collider.glb`,
    );
    cache.set(
      placement.asset,
      (
        await loader.parseAsync(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          "",
        )
      ).scene,
    );
  }
  const root = new T.Group();
  root.position.fromArray(placement.position);
  root.quaternion.fromArray(placement.quaternion);
  const source = cache.get(placement.asset).clone(true);
  root.add(source);
  root.updateMatrixWorld(true);
  source.traverse((mesh) => {
    if (!(mesh instanceof T.Mesh)) return;
    if (!mesh.geometry.boundsTree)
      mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
    mesh.raycast = acceleratedRaycast;
    mesh.material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere
      .clone()
      .applyMatrix4(mesh.matrixWorld);
    world.colliders.push({
      mesh,
      center: sphere.center,
      radius: sphere.radius,
      inverse: mesh.matrixWorld.clone().invert(),
      name: placement.name,
    });
  });
}

export { world, World, RADIUS };
