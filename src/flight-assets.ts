import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
export type FlightAssets = {
  drone: GLTF;
  geometry: Record<string, T.BufferGeometry>;
  cloud: T.Texture;
};
export async function loadFlightAssets(): Promise<FlightAssets> {
  const loader = new GLTFLoader();
  const names = [
    "nav-gate",
    "exhaust",
    "tracer",
    "spark",
    "contrail",
    "cloud-bank",
  ];
  const [drone, ...effects] = await Promise.all(
    ["interceptor", ...names].map((name) =>
      loader.loadAsync(`/models/${name}.glb`),
    ),
  );
  const geometry: Record<string, T.BufferGeometry> = {};
  let cloud!: T.Texture;
  effects.forEach((gltf, i) => {
    let mesh: T.Mesh | undefined;
    gltf.scene.traverse((o) => {
      if (o instanceof T.Mesh && !mesh) mesh = o;
    });
    if (!mesh) throw new Error(`Blender asset ${names[i]} contains no mesh`);
    geometry[names[i]] = mesh.geometry;
    if (names[i] === "cloud-bank")
      cloud = (mesh.material as T.MeshStandardMaterial).map!;
  });
  return { drone, geometry, cloud };
}
