import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            "three",
            "three/addons/loaders/GLTFLoader.js",
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
