// Build-time asset preparation shared by the Vite config and the build check.
// `public/` keeps the canonical Blender exports; only the deployed copies in
// `dist/` are meshopt-compressed and renamed with a content hash so the CDN can
// cache them immutably.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const CACHE_VERSION = "meshopt-1";

/** Files the game requests at runtime, relative to `public/`. Other files in
 * these folders (bake reports, intermediate paint images) are development
 * artefacts that `public/.assetsignore` keeps out of the deployment. */
export function runtimeAssets(publicDir = "public") {
  const list = (dir, test) =>
    fs.existsSync(path.join(publicDir, dir))
      ? fs
          .readdirSync(path.join(publicDir, dir))
          .filter(test)
          .sort()
          .map((name) => `${dir}/${name}`)
      : [];
  return [
    ...list("models", (n) => n.endsWith(".glb")),
    ...list("models", (n) => n === "environment-layout.json"),
    ...list("audio", (n) => /\.(mp3|wav)$/.test(n)),
    ...list("textures", (n) => n === "ocean-coastal-light.png"),
  ];
}

/**
 * Only whole-scene art is meshopt-compressed. Quantized positions live in a
 * normalized local space that the loader dequantizes through the node or skin,
 * so anything that reads raw attributes or reuses a geometry without its node
 * must keep the original export or gain nothing from it: collision meshes (BVH distances are compared
 * with world metres), the painted ocean (its shader samples raw position and
 * normal), and the small effect meshes that main.ts instances by geometry.
 */
export function compressible(relative) {
  if (!relative.endsWith(".glb")) return false;
  const name = relative.slice(relative.lastIndexOf("/") + 1, -4);
  if (name.endsWith("-collider")) return false;
  return ![
    "painted-ocean",
    "cloud-bank",
    "nav-gate",
    "exhaust",
    "tracer",
    "spark",
    "contrail",
  ].includes(name);
}

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function hashedName(relative, bytes) {
  const extension = path.extname(relative);
  return `${relative.slice(0, -extension.length)}.${sha256(bytes).slice(0, 10)}${extension}`;
}

let io;
export function gltfIO() {
  if (!io)
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      "meshopt.decoder": MeshoptDecoder,
    });
  return io;
}

/** Meshopt-compress a GLB. Geometry, morph targets, skins and animation survive;
 * positions are quantized to 16 bits within each mesh's bounds. */
export async function compressGlb(bytes) {
  await MeshoptEncoder.ready;
  const document = await gltfIO().readBinary(new Uint8Array(bytes));
  await document.transform(
    meshopt({ encoder: MeshoptEncoder, level: "high", quantizePosition: 16 }),
  );
  return gltfIO().writeBinary(document);
}

/**
 * Compress and hash every runtime asset. Compressed GLBs are cached under
 * `cacheDir` by source hash so repeated builds only redo changed exports.
 * Returns the URL manifest and the list of files to place in the output.
 */
export async function prepareAssets({
  publicDir = "public",
  cacheDir = ".cache/assets",
  log = () => {},
} = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const indexPath = path.join(cacheDir, "index.json");
  const index = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
    : {};
  if (index.version !== CACHE_VERSION) {
    for (const key of Object.keys(index)) delete index[key];
    index.version = CACHE_VERSION;
  }
  const manifest = {};
  const files = [];
  for (const relative of runtimeAssets(publicDir)) {
    const sourcePath = path.join(publicDir, relative);
    const source = fs.readFileSync(sourcePath);
    let output = source,
      outputPath = sourcePath;
    if (compressible(relative)) {
      const key = sha256(source);
      const cached = index[key] && path.join(cacheDir, index[key]);
      if (cached && fs.existsSync(cached)) {
        output = fs.readFileSync(cached);
        outputPath = cached;
      } else {
        const started = performance.now();
        output = await compressGlb(source);
        const cacheName = `${key}.glb`;
        fs.writeFileSync(path.join(cacheDir, cacheName), output);
        index[key] = cacheName;
        outputPath = path.join(cacheDir, cacheName);
        log(
          `${relative}: ${(source.length / 1048576).toFixed(2)} MB → ${(output.length / 1048576).toFixed(2)} MB in ${((performance.now() - started) / 1000).toFixed(1)}s`,
        );
      }
    }
    const hashed = hashedName(relative, output);
    manifest[`/${relative}`] = `/${hashed}`;
    files.push({
      relative,
      hashed,
      sourcePath: outputPath,
      bytes: output.length,
    });
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return { manifest, files };
}

/** Replace the plain public copies in `outDir` with the prepared, hashed files. */
export function installAssets(outDir, files) {
  for (const file of files) {
    const plain = path.join(outDir, file.relative);
    if (fs.existsSync(plain)) fs.rmSync(plain);
    const target = path.join(outDir, file.hashed);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.sourcePath, target);
  }
}
