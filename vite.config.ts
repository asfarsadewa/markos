import { defineConfig, type Plugin } from "vite";
import { installAssets, prepareAssets } from "./tools/asset-pipeline.mjs";

/**
 * Production builds compress the Blender exports with meshopt and rename every
 * runtime asset with a content hash. `public/` stays canonical for the verify
 * tools; only `dist/` receives the compressed, hashed copies. The URL map is
 * injected as `__MARKOS_ASSETS__` so `src/assets.ts` can resolve paths.
 */
function hashedAssets(): Plugin {
  let prepared: Awaited<ReturnType<typeof prepareAssets>> | null = null;
  return {
    name: "markos-hashed-assets",
    apply: "build",
    async config() {
      prepared = await prepareAssets({
        log: (line) => console.log(`[assets] ${line}`),
      });
      return {
        define: { __MARKOS_ASSETS__: JSON.stringify(prepared.manifest) },
      };
    },
    closeBundle() {
      if (prepared) installAssets("dist", prepared.files);
    },
  };
}

export default defineConfig({
  plugins: [hashedAssets()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            "three",
            "three/addons/loaders/GLTFLoader.js",
            "three/addons/libs/meshopt_decoder.module.js",
            "three/addons/postprocessing/EffectComposer.js",
            "three/addons/postprocessing/RenderPass.js",
            "three/addons/postprocessing/ShaderPass.js",
            "three/addons/postprocessing/OutputPass.js",
          ],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
