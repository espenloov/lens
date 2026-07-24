import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const configured = process.env.WASM_PACK_BIN?.trim();
const cargoBinary = join(
  homedir(),
  ".cargo",
  "bin",
  process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack",
);
const executable =
  configured && configured.length > 0
    ? configured
    : existsSync(cargoBinary)
      ? cargoBinary
      : "wasm-pack";
const rustupBin = [
  process.env.RUSTUP_HOME
    ? join(dirname(process.env.RUSTUP_HOME), "bin")
    : null,
  join(homedir(), ".cargo", "bin"),
  "/opt/homebrew/opt/rustup/bin",
  "/usr/local/opt/rustup/bin",
].find(
  (directory) =>
    directory !== null &&
    existsSync(
      join(directory, process.platform === "win32" ? "cargo.exe" : "cargo"),
    ) &&
    existsSync(
      join(directory, process.platform === "win32" ? "rustc.exe" : "rustc"),
    ),
);
const environment = {
  ...process.env,
  PATH:
    rustupBin === undefined
      ? process.env.PATH
      : `${rustupBin}${delimiter}${process.env.PATH ?? ""}`,
};
const result = spawnSync(executable, process.argv.slice(2), {
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  const message =
    result.error.code === "ENOENT"
      ? "wasm-pack is required. Install it with `cargo install wasm-pack` or set WASM_PACK_BIN."
      : result.error.message;
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
