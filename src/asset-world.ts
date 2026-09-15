import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { cloudPaint } from "./cloud-paint";
export const RADIUS = 1800;
const Y = new T.Vector3(0, 1, 0);
export const surface = (x: number, z: number, h = 0) =>
  new T.Vector3(x, RADIUS, z).normalize().multiplyScalar(RADIUS + h);
export const toonRamp = new T.DataTexture(
  new Uint8Array([100, 164, 220, 255]),
  4,
  1,
  T.RedFormat,
);
toonRamp.needsUpdate = true;
toonRamp.minFilter = toonRamp.magFilter = T.NearestFilter;
type Placement = {
  name: string;
  asset: string;
  position: number[];
  quaternion: number[];
  approach: number[];
  lookAt: number[];
};
type Collider = {
  mesh: T.Mesh;
  center: T.Vector3;
  radius: number;
  inverse: T.Matrix4;
};
/** All art geometry, textures, rigs and placements come from Blender exports. */
export class World {
  root = new T.Group();
  carrier = new T.Group();
  sky: T.Object3D | null = null;
  clouds: T.Object3D[] = [];
  colliders: Collider[] = [];
  landmarks: { name: string; approach: T.Vector3; lookAt: T.Vector3 }[] = [];
  oceanTexture: T.Texture | null = null;
  oceanMaterial: T.ShaderMaterial | null = null;
  sun = new T.DirectionalLight("#fff0d1", 2);
  ambient = new T.HemisphereLight("#fff3d5", "#327c94", 1.35);
  ready: Promise<void>;
  private ambientMixers: T.AnimationMixer[] = [];
  private readonly reducedMotion = matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  private ray = new T.Raycaster();
  private local = new T.Vector3();
  constructor(scene: T.Scene) {
    scene.add(this.root, this.sun, this.sun.target, this.ambient);
    // A small shadow map follows only the animated aircraft. Scenery keeps
    // its baked lighting; no extra geometry or island shadow passes are needed.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -24,
      right: 24,
      top: 24,
      bottom: -24,
      near: 1,
      far: 4500,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.000015;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 3;
    this.sun.shadow.intensity = 0.38;
    scene.background = new T.Color("#74b7d0");
    scene.fog = new T.Fog("#94c6cf", 1100, 3100);
    this.carrier.position.copy(surface(110, 80, 110));
    this.carrier.quaternion.setFromUnitVectors(
      Y,
      this.carrier.position.clone().normalize(),
    );
    this.root.add(this.carrier);
    this.ray.firstHitOnly = true;
    this.ready = this.load(scene);
  }
  private async load(scene: T.Scene) {
    const loader = new GLTFLoader();
    const response = await fetch("/models/environment-layout.json");
    if (!response.ok) throw new Error("Blender world layout could not load");
    const layout = (await response.json()) as {
      islands: Placement[];
      clouds: { position: number[]; scale: number }[];
    };
    const names = [...new Set(layout.islands.map((p) => p.asset))];
    const assets = await Promise.all(
      names.map(async (name) => ({
        name,
        art: await loader.loadAsync(`/models/${name}.glb`),
        collision: await loader.loadAsync(`/models/${name}-collider.glb`),
      })),
    );
    for (const placement of layout.islands) {
      this.landmarks.push({
        name: placement.name,
        approach: new T.Vector3().fromArray(placement.approach),
        lookAt: new T.Vector3().fromArray(placement.lookAt),
      });
      const source = assets.find((a) => a.name === placement.asset)!;
      const root = new T.Group();
      root.name = placement.name;
      root.position.fromArray(placement.position);
      root.quaternion.fromArray(placement.quaternion);
      const art = clone(source.art.scene);
      const flow = source.art.animations.find(
        (clip) => clip.name === "WaterFlow",
      );
      if (flow) {
        const mixer = new T.AnimationMixer(art);
        mixer.clipAction(flow).play();
        this.ambientMixers.push(mixer);
      }
      art.traverse((o) => {
        if (o instanceof T.Mesh) {
          const mat = o.material as T.MeshStandardMaterial;
          if (mat.map) mat.map.anisotropy = 8;
          o.material = new T.MeshLambertMaterial({
            map: mat.map,
            color: "#ffffff",
          });
          o.receiveShadow = true;
        }
      });
      root.add(art);
      this.root.add(root);
      const collision = source.collision.scene.clone(true);
      root.add(collision);
      root.updateMatrixWorld(true);
      collision.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        if (!o.geometry.boundsTree)
          o.geometry.boundsTree = new MeshBVH(o.geometry);
        o.raycast = acceleratedRaycast;
        o.material = new T.MeshBasicMaterial({ side: T.DoubleSide });
        o.visible = false;
        o.geometry.computeBoundingSphere();
        const sphere = o.geometry
          .boundingSphere!.clone()
          .applyMatrix4(o.matrixWorld);
        this.colliders.push({
          mesh: o,
          center: sphere.center,
          radius: sphere.radius,
          inverse: o.matrixWorld.clone().invert(),
        });
      });
    }
    const [sky, sea, cloud, coastalLight] = await Promise.all([
      loader.loadAsync("/models/painted-sky.glb"),
      loader.loadAsync("/models/painted-ocean.glb"),
      loader.loadAsync("/models/cloud-bank.glb"),
      new T.TextureLoader().loadAsync("/textures/ocean-coastal-light.png"),
    ]);
    // Blender baked the actual island occlusion onto this sea's existing UVs.
    // GLTFLoader uses top-left texture coordinates; match its image orientation.
    coastalLight.flipY = false;
    coastalLight.colorSpace = T.NoColorSpace;
    coastalLight.wrapS = T.RepeatWrapping;
    coastalLight.anisotropy = 8;
    this.sky = sky.scene;
    this.sky.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const texture = (o.material as T.MeshStandardMaterial).map!;
      texture.wrapS = T.RepeatWrapping;
      texture.repeat.x = 1;
      o.material = new T.MeshBasicMaterial({
        map: texture,
        side: T.BackSide,
        depthWrite: false,
        fog: false,
      });
      o.renderOrder = -10;
      o.frustumCulled = false;
    });
    scene.add(this.sky);
    sea.scene.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const texture = (o.material as T.MeshStandardMaterial).map!;
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.repeat.set(1, 1);
      texture.anisotropy = 8;
      this.oceanTexture = texture;
      this.oceanMaterial = new T.ShaderMaterial({
        lights: true,
        uniforms: {
          ...T.UniformsUtils.clone(T.UniformsLib.lights),
          paint: { value: texture },
          time: { value: 0 },
          coastalLight: { value: coastalLight },
          coastalStrength: { value: 1 },
        },
        vertexShader: `
          #include <common>
          #include <morphtarget_pars_vertex>
          #include <skinning_pars_vertex>
          #include <shadowmap_pars_vertex>
          varying vec3 p;
          varying vec3 n;
          varying vec3 swellNormal;
          varying vec3 seaPosition;
          varying vec2 coastUv;
          void main() {
            #include <beginnormal_vertex>
            #include <morphnormal_vertex>
            #include <skinbase_vertex>
            #include <skinnormal_vertex>
            #include <begin_vertex>
            #include <morphtarget_vertex>
            #include <skinning_vertex>
            p=position;
            n=normal;
            swellNormal=objectNormal;
            seaPosition=(modelMatrix*vec4(transformed,1.)).xyz;
            vec4 worldPosition=vec4(seaPosition,1.);
            vec3 transformedNormal=normalMatrix*objectNormal;
            #include <shadowmap_vertex>
            coastUv=uv;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(transformed,1.);
          }`,
        fragmentShader: `
          #include <common>
          #include <packing>
          #include <shadowmap_pars_fragment>
          uniform bool receiveShadow;
          #include <shadowmask_pars_fragment>
          uniform sampler2D paint;
          uniform sampler2D coastalLight;
          uniform float coastalStrength;
          uniform float time;
          varying vec3 p;
          varying vec3 n;
          varying vec3 swellNormal;
          varying vec3 seaPosition;
          varying vec2 coastUv;
          void main() {
            vec3 w=pow(abs(n),vec3(8.));
            w/=w.x+w.y+w.z;
            vec2 drift=vec2(time*.0008,time*.00015);
            vec3 c=texture2D(paint,p.zy*.003+drift).rgb*w.x
              +texture2D(paint,p.xz*.003+drift).rgb*w.y
              +texture2D(paint,p.xy*.003+drift).rgb*w.z;
            // A soft painted wash follows the normals of Blender's baked swells.
            // The original paint coordinates stay anchored to the rest surface.
            float slope=dot(normalize(swellNormal)-normalize(n),normalize(vec3(-.65,.8,.45)));
            c*=1.+clamp(slope*3.2,-.20,.20);
            c=mix(c,vec3(.60,.84,.78),smoothstep(.018,.09,slope)*.12);
            float coast=mix(1.,texture2D(coastalLight,coastUv).r,coastalStrength);
            c*=mix(vec3(.24,.43,.68),vec3(1.),coast);
            c*=mix(vec3(.15,.25,.40),vec3(1.),getShadowMask());
            float distanceToEye=length(cameraPosition-seaPosition);
            c=mix(c,vec3(.36,.60,.66),smoothstep(450.,2400.,distanceToEye));
            gl_FragColor=vec4(c,1.);
          }`,
      });
      o.material = this.oceanMaterial;
      o.receiveShadow = true;
    });
    const swells = sea.animations.find((clip) => clip.name === "OceanSwells");
    if (!swells) throw new Error("Blender ocean swell animation is missing");
    const seaMixer = new T.AnimationMixer(sea.scene);
    seaMixer.clipAction(swells).play();
    this.ambientMixers.push(seaMixer);
    this.root.add(sea.scene);
    for (const placement of layout.clouds) {
      const bank = clone(cloud.scene);
      bank.position.fromArray(placement.position);
      bank.scale.setScalar(placement.scale);
      bank.traverse((o) => {
        if (o instanceof T.Mesh) {
          const texture = (o.material as T.MeshStandardMaterial).map!;
          o.material = cloudPaint(texture, placement.scale).material;
          o.frustumCulled = false;
        }
      });
      this.root.add(bank);
      this.clouds.push(bank);
    }
  }
  tick(time: number, player: T.Vector3) {
    const shadowFade =
      1 - T.MathUtils.smoothstep(player.length() - RADIUS, 160, 400);
    this.sun.shadow.intensity = 0.38 * shadowFade;
    this.sun.shadow.autoUpdate = shadowFade > 0;
    for (const mixer of this.ambientMixers)
      mixer.setTime(this.reducedMotion ? 0 : time);
    const up = player.clone().normalize();
    this.ambient.position.copy(up);
    this.sun.position
      .copy(player)
      .addScaledVector(up, 2300)
      .add(new T.Vector3(-800, 0, 500));
    this.sun.target.position.copy(player);
    if (this.sky) {
      this.sky.position.copy(player);
      this.sky.quaternion.setFromUnitVectors(Y, up);
      this.sky.rotateY(0.4);
    }
    if (this.oceanMaterial)
      this.oceanMaterial.uniforms.time.value = this.reducedMotion ? 0 : time;
    for (const cloud of this.clouds) {
      cloud.up.copy(up);
      cloud.lookAt(player);
    }
  }
  terrainClearance(p: T.Vector3) {
    let clearance = p.length() - RADIUS;
    this.ray.set(p, p.clone().normalize().negate());
    this.ray.far = Math.max(0, clearance + 10);
    for (const collider of this.colliders) {
      if (
        p.distanceTo(collider.center) >
        collider.radius + Math.max(20, clearance)
      )
        continue;
      const hit = this.ray.intersectObject(collider.mesh, false)[0];
      if (hit) clearance = Math.min(clearance, hit.distance);
      this.local.copy(p).applyMatrix4(collider.inverse);
      const near = (
        collider.mesh.geometry.boundsTree as MeshBVH
      ).closestPointToPoint(this.local, undefined, 0, 8);
      if (near) clearance = Math.min(clearance, near.distance);
    }
    return clearance;
  }
  /** First rock surface between the aircraft and its camera. */
  cameraObstruction(from: T.Vector3, to: T.Vector3): number | null {
    return this.rockObstruction(from, to);
  }
  /** First solid surface along a weapon ray, including the spherical sea. */
  weaponObstruction(from: T.Vector3, to: T.Vector3): number | null {
    let nearest = this.rockObstruction(from, to) ?? Infinity;
    const offset = to.clone().sub(from),
      distance = offset.length();
    const c = from.lengthSq() - RADIUS * RADIUS;
    if (c <= 0) return 0;
    if (distance > 0.001) {
      offset.divideScalar(distance);
      const b = from.dot(offset),
        discriminant = b * b - c;
      if (discriminant >= 0) {
        const hit = -b - Math.sqrt(discriminant);
        if (hit >= 0 && hit <= distance) nearest = Math.min(nearest, hit);
      }
    }
    return Number.isFinite(nearest) ? nearest : null;
  }
  /** Forecast released-stick flight, including gentle pitch leveling and curvature. */
  flightTerrainAhead(
    from: T.Vector3,
    tangent: T.Vector3,
    pitch: number,
    speed: number,
  ): number | null {
    const velocity = Math.max(1, speed);
    const duration = Math.max(2.4, 60 / velocity),
      dt = duration / 12;
    const point = from.clone(),
      forward = tangent.clone();
    let radius = point.length(),
      traveled = 0;
    for (let step = 0; step < 12; step++) {
      const next = point.clone(),
        substep = dt / 4;
      for (let sample = 0; sample < 4; sample++) {
        const midPitch = pitch * Math.exp(-0.18 * substep * 0.5);
        radius += Math.sin(midPitch) * velocity * substep;
        next
          .addScaledVector(forward, Math.cos(midPitch) * velocity * substep)
          .normalize()
          .multiplyScalar(radius);
        forward.projectOnPlane(next.clone().normalize()).normalize();
        pitch *= Math.exp(-0.18 * substep);
      }
      const direction = next.clone().sub(point),
        length = direction.length();
      const hit = this.terrainAhead(point, direction.normalize(), length);
      if (hit !== null) return traveled + hit;
      traveled += length;
      point.copy(next);
    }
    return null;
  }
  /** Probe the flight path at the center and the armor's outer extents. */
  terrainAhead(
    from: T.Vector3,
    direction: T.Vector3,
    range: number,
  ): number | null {
    const heading = direction.clone().normalize();
    const up = from.clone().normalize();
    const right = new T.Vector3().crossVectors(heading, up);
    if (right.lengthSq() < 0.0001)
      right.crossVectors(
        heading,
        Math.abs(heading.x) < 0.9
          ? new T.Vector3(1, 0, 0)
          : new T.Vector3(0, 0, 1),
      );
    right.normalize();
    const vertical = new T.Vector3().crossVectors(right, heading).normalize();
    let nearest = Infinity;
    for (const offset of [
      new T.Vector3(),
      right.clone().multiplyScalar(6),
      right.clone().multiplyScalar(-6),
      vertical.clone().multiplyScalar(3),
      vertical.clone().multiplyScalar(-3),
    ]) {
      const origin = from.clone().add(offset);
      const to = origin.clone().addScaledVector(heading, range);
      const rock = this.rockObstruction(origin, to);
      if (rock !== null) nearest = Math.min(nearest, rock);
      // The sea is spherical; solve its intersection rather than flattening
      // distant water into a plane that would warn during safe level flight.
      const b = origin.dot(heading),
        c = origin.lengthSq() - (RADIUS + 8) ** 2;
      const discriminant = b * b - c;
      if (c <= 0) nearest = 0;
      else if (discriminant >= 0) {
        const hit = -b - Math.sqrt(discriminant);
        if (hit >= 0 && hit <= range) nearest = Math.min(nearest, hit);
      }
    }
    return Number.isFinite(nearest) ? nearest : null;
  }
  private rockObstruction(from: T.Vector3, to: T.Vector3): number | null {
    const distance = from.distanceTo(to);
    if (distance < 0.001) return null;
    this.ray.set(
      from,
      to
        .clone()
        .sub(from)
        .multiplyScalar(1 / distance),
    );
    this.ray.far = distance;
    let nearest = Infinity;
    for (const collider of this.colliders) {
      if (from.distanceTo(collider.center) > collider.radius + distance)
        continue;
      const hit = this.ray.intersectObject(collider.mesh, false)[0];
      if (hit) nearest = Math.min(nearest, hit.distance);
    }
    return Number.isFinite(nearest) ? nearest : null;
  }
}
