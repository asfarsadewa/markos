import * as T from "three";

/** Diffuse the existing Blender cloud card before the camera crosses its plane. */
export function cloudPaint(texture: T.Texture, scale: number) {
  const material = new T.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.015,
    depthWrite: false,
    side: T.DoubleSide,
    forceSinglePass: true,
  });
  const softness = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cloudSoftness = softness;
    shader.uniforms.cloudFadeDistance = { value: scale * 0.95 };
    shader.vertexShader = `varying float cloudPlaneDistance;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      // The exported, anchor-rigged surface lies in local XY. Perpendicular
      // camera distance avoids a circular hole and works in every orbit view.
      vec3 cloudNormal = normalize(normalMatrix * vec3(0., 0., 1.));
      cloudPlaneDistance = abs(dot(modelViewMatrix[3].xyz, cloudNormal));`,
    );
    shader.fragmentShader = `
      uniform float cloudSoftness;
      uniform float cloudFadeDistance;
      varying float cloudPlaneDistance;
      ${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `float cloudVisibility = mix(1., smoothstep(24., cloudFadeDistance, cloudPlaneDistance), cloudSoftness);
       ${T.ShaderChunk.map_fragment.replace(
         "texture2D( map, vMapUv )",
         "texture2D( map, vMapUv, (1. - cloudVisibility) * 3.5 )",
       )}
       diffuseColor.a *= cloudVisibility;`,
    );
  };
  material.customProgramCacheKey = () => "markos-cloud-paint-1";
  return { material, softness };
}
