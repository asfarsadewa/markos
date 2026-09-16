import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/** Hashed asset URLs injected by the production build; identity in dev and Node. */
const manifest: Record<string, string> =
  typeof __MARKOS_ASSETS__ === "undefined" ? {} : __MARKOS_ASSETS__;

/** Resolve a `/models/...`, `/audio/...` or `/textures/...` path to its deployed URL. */
export const assetUrl = (path: string) => manifest[path] ?? path;

/** GLTF loader able to read the meshopt-compressed exports the build produces. */
export function createGltfLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
