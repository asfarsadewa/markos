import * as T from "three";

export const exhaustSocketNames = [
  "exhaust_L_upper", "exhaust_L_lower", "exhaust_R_upper", "exhaust_R_lower",
];

/** Attach the Blender plume mesh to the authored, bone-parented nozzle sockets. */
export function createEngineExhaust(model: T.Object3D, geometry: T.BufferGeometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const base = bounds.min.z, length = bounds.max.z - base;
  return exhaustSocketNames.map((name, index) => {
    const socket = model.getObjectByName(name);
    if (!socket) throw new Error(`Missing Blender engine socket: ${name}`);
    const material = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      side: T.DoubleSide,
      uniforms: { time: { value: 0 }, thrust: { value: 0 },
        phase: { value: index * 1.7 }, plumeBase: { value: base }, plumeLength: { value: length } },
      vertexShader: `uniform float plumeBase; uniform float plumeLength; varying float along;
        void main(){along=clamp((position.z-plumeBase)/plumeLength,0.,1.);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform float time; uniform float thrust; uniform float phase;
        varying float along; void main(){
        float fade=pow(1.-along,1.65);
        float pulse=.88+.12*sin(along*28.-time*24.+phase);
        vec3 color=mix(vec3(.08,.3,1.),vec3(.28,.78,1.),fade);
        gl_FragColor=vec4(color,fade*pulse*(.12+.24*thrust));}`,
    });
    const plume = new T.Mesh(geometry, material);
    plume.name = `${name} plume`;
    plume.userData.base = base;
    socket.add(plume);
    updateEngineExhaust(plume, 0, 0, true);
    return plume;
  });
}

export function updateEngineExhaust(plume: T.Mesh, thrust: number, time: number, visible: boolean) {
  const power = T.MathUtils.clamp(thrust, 0, 1);
  const material = plume.material as T.ShaderMaterial;
  const stretch = 1 + power * 2;
  plume.visible = visible;
  // Extend along the exported nozzle axis while keeping the base at its socket.
  plume.scale.set(1, 1, stretch);
  plume.position.set(0, 0, -Number(plume.userData.base) * stretch);
  material.uniforms.time.value = time;
  material.uniforms.thrust.value = power;
}
