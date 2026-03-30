import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "../lib/prisma";
import { getDeploymentReadiness } from "../lib/runtime-config";

type CheckResult = {
  label: string;
  ok: boolean;
  detail: string;
};

function printResult(result: CheckResult) {
  const prefix = result.ok ? "[OK]" : "[FAIL]";
  console.log(`${prefix} ${result.label}: ${result.detail}`);
}

function parseArgs() {
  const envFlag = process.argv.find((arg) => arg.startsWith("--env-file="));
  const stageFlag = process.argv.find((arg) => arg.startsWith("--stage="));

  let envFile: string | null = null;
  let stage: string | null = stageFlag ? stageFlag.slice("--stage=".length) : null;

  if (envFlag) {
    envFile = envFlag.slice("--env-file=".length);
  }

  const envIndex = process.argv.findIndex((arg) => arg === "--env-file");
  if (envIndex >= 0 && process.argv[envIndex + 1]) {
    envFile = process.argv[envIndex + 1];
  }

  const stageIndex = process.argv.findIndex((arg) => arg === "--stage");
  if (stageIndex >= 0 && process.argv[stageIndex + 1]) {
    stage = process.argv[stageIndex + 1];
  }

  return {
    envFile,
    stage,
  };
}

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(envFile: string) {
  const resolvedPath = path.resolve(process.cwd(), envFile);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Env file not found: ${resolvedPath}`);
  }

  const content = readFileSync(resolvedPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
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
    process.env[key] = value;
  }

  return resolvedPath;
}

function applyStage(stage: string | null) {
  if (!stage) {
    return null;
  }

  if (stage !== "development" && stage !== "preview" && stage !== "production") {
    throw new Error(`Unsupported stage: ${stage}`);
  }

  if (stage === "preview") {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
  } else if (stage === "production") {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
  } else {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
  }

  return stage;
}

async function checkDatabase() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return {
      label: "database",
      ok: true,
      detail: "Database connection succeeded.",
    } satisfies CheckResult;
  } catch (error) {
    return {
      label: "database",
      ok: false,
      detail: error instanceof Error ? error.message : "Unknown database error.",
    } satisfies CheckResult;
  }
}

async function main() {
  const args = parseArgs();
  const loadedEnvFile = args.envFile ? loadEnvFile(args.envFile) : null;
  const appliedStage = applyStage(args.stage);
  const readiness = getDeploymentReadiness();
  const results: CheckResult[] = [
    ...(loadedEnvFile
      ? [
          {
            label: "env-file",
            ok: true,
            detail: loadedEnvFile,
          } satisfies CheckResult,
        ]
      : []),
    ...(appliedStage
      ? [
          {
            label: "forced-stage",
            ok: true,
            detail: appliedStage,
          } satisfies CheckResult,
        ]
      : []),
    {
      label: "stage",
      ok: true,
      detail: readiness.stage,
    },
    {
      label: "app-url",
      ok: Boolean(readiness.appUrl),
      detail: readiness.appUrl ?? "NEXTAUTH_URL / VERCEL_URL is missing.",
    },
    {
      label: "storage",
      ok: readiness.storage.isReady,
      detail: readiness.storage.isReady
        ? `${readiness.storage.provider} (${readiness.storage.keyPrefix || "(empty prefix)"})`
        : readiness.storage.issues.map((issue) => issue.message).join(" | "),
    },
  ];

  if (readiness.issues.length > 0) {
    for (const issue of readiness.issues) {
      results.push({
        label: issue.key,
        ok: false,
        detail: issue.message,
      });
    }
  }

  results.push(await checkDatabase());

  console.log("Deployment preflight for anime-guess-arena");
  console.log("------------------------------------------");
  for (const result of results) {
    printResult(result);
  }

  const hasFailure = results.some((result) => !result.ok);
  if (hasFailure) {
    process.exitCode = 1;
    return;
  }

  console.log("Preflight passed. The current environment looks ready for deployment.");
}

main()
  .catch((error) => {
    console.error("Preflight crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
