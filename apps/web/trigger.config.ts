import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project:
    process.env.TRIGGER_PROJECT_REF ?? "proj_wikhrlbpdylrzwffjbhw",
  runtime: "node",
  logLevel: "log",
  legacyDevProcessCwdBehaviour: false,
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      additionalFiles({
        files: [
          "./lib/wasm/lens-node/lens_wasm_node.js",
          "./lib/wasm/lens-node/lens_wasm_node_bg.wasm",
        ],
      }),
    ],
  },
});
