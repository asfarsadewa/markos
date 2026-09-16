import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
function glb(path) {
  const b = fs.readFileSync(path);
  assert.equal(b.toString("ascii", 0, 4), "glTF");
  return JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)).trim());
}
const model = glb("public/models/markos.glb");
assert.ok(model.skins?.length, "Hero must have a real skin");
assert.ok(model.animations?.length, "Hero must have a baked animation");
const skin = model.skins[0];
assert.ok(skin.joints.length >= 9);
const anim = model.animations.find((a) => a.name === "Transform");
assert.ok(anim, "Transform clip is named");
assert.ok(anim.channels.length >= 16, "All assemblies must animate");
let faces = 0;
for (const m of model.meshes)
  for (const p of m.primitives) {
    assert.ok(
      p.attributes.TEXCOORD_0 !== undefined,
      "Every mesh must have UVs",
    );
    assert.ok(
      p.attributes.JOINTS_0 !== undefined,
      "Every hero mesh must be skinned",
    );
    faces += model.accessors[p.indices].count / 3;
  }
// Closed armor interiors and precise mechanical cut planes are retained for
// orbit and transformation close-ups. The reviewed v11 export has 220,208 tris.
assert.ok(faces < 250000, "Detailed airframe runtime mesh budget");
assert.ok(
  fs.statSync("public/models/markos.glb").size < 25 * 1024 * 1024,
  "Airframe fits the deployment asset limit",
);
for (const name of [
  "skyward.mp3",
  "engine.mp3",
  "laser.mp3",
  "explosion.mp3",
  "transformation.mp3",
  "launch.wav",
  "transform.wav",
  "contact.wav",
  "complete.wav",
])
  assert.ok(fs.statSync("public/audio/" + name).size > 1000);
const voices = JSON.parse(fs.readFileSync("public/audio/voices.json", "utf8"));
assert.equal(voices.language, "en-US", "Markos dialogue is English");
const gameSource = fs
  .readdirSync("src")
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(`src/${name}`, "utf8"))
  .join("\n");
for (const line of voices.lines) {
  assert.ok(
    gameSource.includes(JSON.stringify(line.text)),
    "Voice transcript must match its in-game caption",
  );
  assert.equal(
    createHash("sha256")
      .update(fs.readFileSync("public/audio/" + line.file))
      .digest("hex"),
    line.sha256,
    "Voice recording must match its reviewed English take",
  );
  assert.ok(
    line.durationSeconds > 0 && line.durationSeconds < 6,
    "Voice fits the six-second radio caption",
  );
}
const carrier = glb("public/models/carrier.glb");
const coastal = JSON.parse(
  fs.readFileSync("public/models/ocean-coastal-light-report.json", "utf8"),
);
const coastalImage = fs.readFileSync("public/textures/ocean-coastal-light.png");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
assert.equal(coastalImage.toString("hex", 0, 8), "89504e470d0a1a0a");
assert.deepEqual(
  [coastalImage.readUInt32BE(16), coastalImage.readUInt32BE(20)],
  coastal.size,
);
assert.equal(
  sha256(coastalImage),
  coastal.textureSha256,
  "Coastal texture matches its reviewed Blender bake",
);
for (const [path, hash] of Object.entries(coastal.inputs)) {
  assert.equal(
    sha256(fs.readFileSync(path)),
    hash,
    "Rebake coastal lighting after changing " + path,
  );
}
console.log(
  "Coastal bake matches the current sea, all island assets and authored placements.",
);
assert.ok(carrier.meshes.length);
assert.ok(carrier.skins?.length, "Carrier must have its Blender rig");
const exportedArt = [
  "island-cliffs",
  "island-port",
  "island-sanctuary",
  "island-waterfall",
  "interceptor",
  "painted-sky",
  "painted-ocean",
  "cloud-bank",
  "nav-gate",
  "exhaust",
  "tracer",
  "spark",
  "contrail",
];
for (const name of exportedArt) {
  const asset = glb(`public/models/${name}.glb`);
  assert.ok(asset.skins?.length, `${name} is rigged in Blender`);
  for (const mesh of asset.meshes)
    for (const primitive of mesh.primitives) {
      assert.ok(
        primitive.attributes.TEXCOORD_0 !== undefined,
        `${name} has authored UVs`,
      );
      assert.ok(
        primitive.attributes.JOINTS_0 !== undefined,
        `${name} retains its rig binding`,
      );
    }
  assert.ok(
    fs.statSync(`public/models/${name}.glb`).size < 25 * 1024 * 1024,
    `${name} fits the deployment asset limit`,
  );
}
for (const filename of fs
  .readdirSync("src")
  .filter((n) => /\.(ts|mjs)$/.test(n))) {
  assert.ok(
    !/new\s+T\.\w*Geometry\s*\(/.test(
      fs.readFileSync(`src/${filename}`, "utf8"),
    ),
    `${filename} must load Blender geometry instead of manufacturing visible objects`,
  );
}
console.log(
  `All ${exportedArt.length} replacement art exports retain rigs and UVs; runtime primitive builders are absent.`,
);
console.log(
  JSON.stringify(
    {
      heroTriangles: faces,
      heroBones: skin.joints.length,
      clip: anim.name,
      channels: anim.channels.length,
      carrierMeshes: carrier.meshes.length,
      audioFiles: 9,
    },
    null,
    2,
  ),
);
