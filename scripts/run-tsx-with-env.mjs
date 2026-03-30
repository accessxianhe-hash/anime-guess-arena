import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readEnvFile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Env file not found: ${resolved}`);
  }

  const loaded = { ...process.env };
  for (const rawLine of readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripQuotes(line.slice(separatorIndex + 1).trim());
    loaded[key] = value;
  }

  return {
    resolved,
    loaded,
  };
}

async function main() {
  const [, , envFile, scriptPath, ...scriptArgs] = process.argv;
  if (!envFile || !scriptPath) {
    console.error(
      "Usage: node scripts/run-tsx-with-env.mjs <env-file> <tsx-script> [script-args...]",
    );
    process.exit(1);
  }

  const { resolved, loaded } = readEnvFile(envFile);
  console.log(`Loaded env file: ${resolved}`);

  const tsxCli = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const targetScript = path.resolve(process.cwd(), scriptPath);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, targetScript, ...scriptArgs], {
      stdio: "inherit",
      env: loaded,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`tsx script exited with code ${code ?? "unknown"}`));
    });

    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
