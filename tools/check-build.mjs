// Gate a production build: every runtime asset must be hashed, the URL map must
// be baked into the bundle, and each compressed export must load through the
// same Three.js path the game uses and reproduce the original geometry.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  compressible,
  prepareAssets,
  runtimeAssets,
} from "./asset-pipeline.mjs";

globalThis.ProgressEvent ??= class extends Event {
  constructor(type, values) {
    super(type);
    Object.assign(this, values);
  }
};
const outDir = "dist";
assert.ok(
  fs.existsSync(path.join(outDir, "index.html")),
  "run `npm run build` first",
);
const { manifest, files } = await prepareAssets();

// 1. Placement: hashed copies present, plain copies gone, bundle carries the map.
for (const file of files) {
  assert.ok(
    fs.existsSync(path.join(outDir, file.hashed)),
    `${file.hashed} missing from ${outDir}`,
  );
  assert.ok(
    !fs.existsSync(path.join(outDir, file.relative)),
    `${file.relative} should only exist under its hashed name`,
  );
  assert.equal(
    fs.statSync(path.join(outDir, file.hashed)).size,
    file.bytes,
    `${file.hashed} size mismatch`,
  );
}
assert.deepEqual(
  runtimeAssets("public")
    .map((relative) => `/${relative}`)
    .sort(),
  Object.keys(manifest).sort(),
  "every runtime asset is in the manifest",
);
const bundle = fs
  .readdirSync(path.join(outDir, "assets"))
  .filter((name) => /^index-.*\.js$/.test(name))
  .map((name) => fs.readFileSync(path.join(outDir, "assets", name), "utf8"))
  .join("\n");
for (const url of Object.values(manifest))
  assert.ok(bundle.includes(url), `bundle lacks hashed URL ${url}`);
const headers = fs.readFileSync(path.join(outDir, "_headers"), "utf8");
for (const prefix of ["/models/*", "/audio/*", "/textures/*"])
  assert.match(
    headers,
    new RegExp(
      `${prefix.replace("*", "\\*")}\\n\\s+Cache-Control: public, max-age=31536000, immutable`,
    ),
    `${prefix} must be immutable now that names are hashed`,
  );

// 2. Fidelity: load each compressed GLB through GLTFLoader + meshopt, then
// compare rest-pose world-space geometry against the original export.
function parse(bytes, meshopt) {
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  json.buffers[0].uri =
    "data:application/octet-stream;base64," +
    bytes.subarray(28 + length).toString("base64");
  delete json.materials;
  delete json.images;
  delete json.textures;
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  const loader = new GLTFLoader();
  if (meshopt) loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(JSON.stringify(json), "");
}
function describe(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  const vertex = new T.Vector3();
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const position = object.geometry.attributes.position;
    const box = new T.Box3();
    const centroid = new T.Vector3();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      if (object.isSkinnedMesh) object.applyBoneTransform(i, vertex);
      vertex.applyMatrix4(object.matrixWorld);
      box.expandByPoint(vertex);
      centroid.add(vertex);
    }
    centroid.divideScalar(position.count);
    meshes.push({
      name: object.name,
      vertices: position.count,
      triangles: object.geometry.index.count / 3,
      targets: object.geometry.morphAttributes.position?.length ?? 0,
      joints: object.skeleton?.bones.length ?? 0,
      box,
      centroid,
    });
  });
  meshes.sort((a, b) => a.name.localeCompare(b.name));
  return {
    meshes,
    animations: gltf.animations.map((clip) => ({
      name: clip.name,
      duration: Number(clip.duration.toFixed(4)),
      tracks: clip.tracks.length,
    })),
  };
}
let checked = 0;
for (const file of files) {
  if (!compressible(file.relative)) continue;
  const original = describe(
    await parse(fs.readFileSync(path.join("public", file.relative)), false),
  );
  const compressed = describe(
    await parse(fs.readFileSync(path.join(outDir, file.hashed)), true),
  );
  assert.deepEqual(
    compressed.animations,
    original.animations,
    `${file.relative}: animation clips changed`,
  );
  assert.equal(compressed.meshes.length, original.meshes.length);
  for (let i = 0; i < original.meshes.length; i++) {
    const a = original.meshes[i],
      b = compressed.meshes[i];
    for (const key of ["name", "vertices", "triangles", "targets", "joints"])
      assert.equal(b[key], a[key], `${file.relative}: ${a.name} ${key}`);
    // 16-bit quantization within each mesh's bounds; allow a handful of steps.
    const extent = a.box.getSize(new T.Vector3()).length();
    const tolerance = Math.max(0.01, extent / 8192);
    assert.ok(
      a.box.min.distanceTo(b.box.min) <= tolerance &&
        a.box.max.distanceTo(b.box.max) <= tolerance &&
        a.centroid.distanceTo(b.centroid) <= tolerance,
      `${file.relative}: ${a.name} moved by more than ${tolerance.toFixed(4)} m`,
    );
  }
  checked++;
}
const total = files.reduce((sum, file) => sum + file.bytes, 0);
console.log(
  `Build verified: ${files.length} hashed runtime assets (${(total / 1048576).toFixed(1)} MB), ${checked} compressed exports reproduce the originals.`,
);
