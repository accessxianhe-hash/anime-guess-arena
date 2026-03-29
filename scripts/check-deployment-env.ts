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
  const readiness = getDeploymentReadiness();
  const results: CheckResult[] = [
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
