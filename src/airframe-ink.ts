import * as T from "three";

/** Ink the exported armor silhouette with its existing geometry and skeleton. */
export function addAirframeInk(root: T.Object3D) {
  const viewport = new T.Vector2(1280, 720);
  const ink = new T.MeshBasicMaterial({
    color: "#253b4b",
    side: T.BackSide,
    depthWrite: true,
  });
  ink.onBeforeCompile = (shader) => {
    shader.uniforms.inkViewport = { value: viewport };
    shader.vertexShader = `uniform vec2 inkViewport;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vec3 inkNormal = normalize(normalMatrix * objectNormal);
      vec2 inkDirection = inkNormal.xy;
      // Retain projected normal length: front-facing facets receive little
      // expansion, while grazing silhouette edges retain the one-pixel ink.
      gl_Position.xy += inkDirection * (2.0 / inkViewport) * gl_Position.w;`,
    );
  };
  ink.customProgramCacheKey = () => "markos-armor-ink-2";
  const armor: T.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof T.SkinnedMesh) armor.push(object);
  });
  for (const source of armor) {
    const contour = source.clone(false);
    contour.name = `${source.name} ink contour`;
    contour.material = ink;
    contour.castShadow = false;
    contour.receiveShadow = false;
    contour.frustumCulled = false;
    contour.renderOrder = -1;
    contour.onBeforeRender = (renderer) => {
      renderer.getSize(viewport);
    };
    source.parent!.add(contour);
  }
}
