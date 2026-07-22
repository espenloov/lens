import { rm } from "node:fs/promises";

// wasm-pack assumes generated packages will be rebuilt during deployment and
// therefore creates a `.gitignore` containing `*`. Lens intentionally versions
// this small browser package so frontend deployments do not need a Rust
// toolchain. Remove only wasm-pack's generated ignore file after each build.
const generatedIgnoreFile = new URL(
  "../apps/web/lib/wasm/lens/.gitignore",
  import.meta.url,
);

await rm(generatedIgnoreFile, { force: true });
