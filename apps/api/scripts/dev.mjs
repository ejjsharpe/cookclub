import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HYPERDRIVE_LOCAL_CONNECTION_STRING =
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const devVarsPath = join(appDir, ".dev.vars");

function parseDevVars(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separatorIndex = line.indexOf("=");

          if (separatorIndex === -1) {
            return [line, ""];
          }

          const key = line.slice(0, separatorIndex).trim();
          let value = line.slice(separatorIndex + 1).trim();

          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }

          return [key, value];
        }),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

const wranglerBin =
  process.env.WRANGLER_BIN ??
  join(
    appDir,
    "..",
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );

const devVars = parseDevVars(devVarsPath);
const env = {
  ...process.env,
};

const localConnectionString = [
  env[HYPERDRIVE_LOCAL_CONNECTION_STRING],
  devVars[HYPERDRIVE_LOCAL_CONNECTION_STRING],
  env.DATABASE_URL,
  devVars.DATABASE_URL,
].find((value) => typeof value === "string" && value.length > 0);

if (localConnectionString) {
  env[HYPERDRIVE_LOCAL_CONNECTION_STRING] = localConnectionString;
}

const wrangler = spawn(
  wranglerBin,
  [
    "dev",
    "--ip",
    "0.0.0.0",
    "--inspector-port",
    "9229",
    ...process.argv.slice(2),
  ],
  {
    cwd: appDir,
    env,
    stdio: "inherit",
  },
);

wrangler.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
