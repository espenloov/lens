import { rm } from "node:fs/promises";

// wasm-pack assumes generated packages will be rebuilt during deployment and
// therefore creates a `.gitignore` containing `*`. Lens intentionally versions
// this small browser package so frontend deployments do not need a Rust
// toolchain. Remove only wasm-pack's generated ignore file after each build.
const generatedIgnoreFiles = [
  "../apps/web/lib/wasm/lens/.gitignore",
  "../apps/web/lib/wasm/lens-node/.gitignore",
].map((path) => new URL(path, import.meta.url));

await Promise.all(
  generatedIgnoreFiles.map((path) => rm(path, { force: true })),
);
