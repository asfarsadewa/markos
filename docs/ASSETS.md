# Assets and attribution

MARKOS uses authored Blender exports for visible geometry. The runtime loads those exports and applies lighting, picture treatment, placement and animation; it does not build replacement visible objects from procedural primitives.

## Included runtime art

- MK–01 airframe: 232,138 triangles, 28 joints, two baked 2K paint maps and a reversible 2.4-second `Transform` clip. `AileronBank` and `RobotBank` provide baked control poses. The jet and robot share the same mechanical assemblies.
- Four island models, Blender-derived collision meshes, the Halcyon carrier and an enemy interceptor. `environment-layout.json` contains the fixed island/cloud placements and scenic approach points.
- Painted sky, cloud cards and ocean. The sea retains four Blender-baked shape targets in a 12-second `OceanSwells` loop, with calm coastal regions. The waterfall island has a baked `WaterFlow` animation.
- Blender-exported navigation gates, exhaust, tracers, contrails and sparks. Crash effects instance existing exported surfaces.
- Embedded paint textures, the coastal-light texture and its input-hash report. The report is retained because `tools/check-assets.mjs` checks that the bake matches the exported sea, islands and layout.

The files under `public/` are the canonical exports and are what the verification tools read. The production build writes meshopt-compressed, content-hashed copies of the whole-scene art (airframe, islands, carrier, interceptor, sky) into `dist/`; collision meshes, the painted ocean and the effect meshes are deployed unchanged. `tools/check-build.mjs` loads every compressed copy through the same Three.js path as the game and confirms it reproduces the export's geometry, skins and animation clips.

Editable `.blend` files and their packed materials are preserved in the maintainer's local authoring archive. That archive, generation requests/responses, intermediate models, historical authoring scripts and review captures are excluded from this checkout. The included GLBs are sufficient to run and verify the game; this is not a complete source archive for reproducing the original asset-generation process.

## Production tools

Reference art used GPT Image. Hunyuan 3D Pro 3.1 reconstructed the hard-surface and island models; Blender prepared the meshes, rigs, textures and animation bakes. Music used Lyria, sound effects used ElevenLabs, and the four English radio lines used Gemini TTS (Control: Leda; pilot: Orus). `public/audio/voices.json` records the spoken text, reviewed WAV hashes and durations.

These credits describe production provenance, not an additional grant of rights to the project's models, imagery or audio. No project-wide reuse licence has been selected.

## Runtime dependency notices

- Three.js — MIT; [licence](../third-party/three-LICENSE.txt).
- three-mesh-bvh — MIT; [licence](../third-party/three-mesh-bvh-LICENSE.txt).
- DM Sans — SIL Open Font License 1.1; [licence](../third-party/dm-sans-LICENSE.txt).
- Barlow Condensed — SIL Open Font License 1.1; [licence](../third-party/barlow-condensed-LICENSE.txt).

The exact package versions are recorded in `package-lock.json`. Build and development dependencies carry their own licence files in the packages installed by `npm ci`.
