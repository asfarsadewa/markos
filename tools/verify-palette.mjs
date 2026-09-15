import fs from "node:fs";
import assert from "node:assert/strict";
function read(filename) {
  const bytes = fs.readFileSync(filename);
  const length = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.toString("utf8", 20, 20 + length)),
    bin: bytes.subarray(28 + length) };
}
const previous = read(process.argv[2]);
const current = read(process.argv[3]);
for (const key of ["nodes", "skins", "meshes", "animations", "accessors"])
  assert.deepEqual(current.json[key], previous.json[key], `${key} remain unchanged`);
// Compare all non-image accessor storage, including vertices, UVs, skin weights,
// inverse bind matrices, and sampled animation values. Image bytes may differ.
for (const accessor of previous.json.accessors) {
  const index = accessor.bufferView;
  const a = previous.json.bufferViews[index], b = current.json.bufferViews[index];
  assert.deepEqual({ ...b, byteOffset: 0 }, { ...a, byteOffset: 0 },
    "Accessor layout remains unchanged apart from image-induced relocation");
  assert.ok(previous.bin.subarray(a.byteOffset, a.byteOffset + a.byteLength)
    .equals(current.bin.subarray(b.byteOffset, b.byteOffset + b.byteLength)),
    `Geometry or animation data changed in buffer view ${index}`);
}
console.log(`Palette-only export verified: ${current.json.accessors.length} accessors, nodes, meshes, skins and animations match the preserved source exactly.`);
