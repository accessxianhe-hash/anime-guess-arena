export type DeploymentStage = "development" | "preview" | "production" | "test";
export type StorageProvider = "local" | "s3";

type ReadinessIssue = {
  key: string;
  message: string;
};

type StorageConfigStatus = {
  provider: StorageProvider;
  keyPrefix: string;
  isReady: boolean;
  issues: ReadinessIssue[];
};

type DeploymentReadiness = {
  stage: DeploymentStage;
  appUrl: string | null;
  storage: StorageConfigStatus;
  issues: ReadinessIssue[];
};

function getOptionalEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeKeyPrefix(prefix: string) {
  const normalized = prefix.replace(/^\/+|\/+$/g, "");
  return normalized ? `${normalized}/` : "";
}

export function getDeploymentStage(): DeploymentStage {
  if (process.env.NODE_ENV === "test") {
    return "test";
  }

  if (process.env.VERCEL_ENV === "preview") {
    return "preview";
  }

  if (process.env.VERCEL_ENV === "production") {
    return "production";
  }

  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  return "development";
}

export function isHostedRuntime() {
  const stage = getDeploymentStage();
  return stage === "preview" || stage === "production";
}

export function getRequiredEnv(name: string, fallbackNames: string[] = []) {
  const value = getOptionalEnv(name, ...fallbackNames);
  if (!value) {
    const suffix =
      fallbackNames.length > 0 ? `（可替代：${fallbackNames.join("、")}）` : "";
    throw new Error(`缺少环境变量 ${name}${suffix}。`);
  }

  return value;
}

export function getAuthSecret() {
  return getOptionalEnv("NEXTAUTH_SECRET", "AUTH_SECRET");
}

export function getAppUrl() {
  const explicitUrl = getOptionalEnv("NEXTAUTH_URL", "AUTH_URL");
  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, "");
  }

  const vercelUrl = getOptionalEnv("VERCEL_URL");
  if (vercelUrl) {
    const normalizedHost = vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${normalizedHost}`;
  }

  return null;
}

export function assertAuthRuntimeReady() {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("缺少 NEXTAUTH_SECRET，Auth.js 无法在当前环境启动。");
  }

  const appUrl = getAppUrl();
  const trustHost =
    getOptionalEnv("AUTH_TRUST_HOST") === "true" || Boolean(getOptionalEnv("VERCEL"));

  if (!appUrl) {
    if (!trustHost && !isHostedRuntime()) {
      throw new Error(
        "缺少 NEXTAUTH_URL。生产或预览环境中请配置 NEXTAUTH_URL，或依赖 Vercel 提供的 VERCEL_URL。",
      );
    }
  }

  return {
    secret,
    appUrl,
    trustHost,
  };
}

export function getStorageProvider(): StorageProvider {
  const provider = getOptionalEnv("STORAGE_PROVIDER") ?? "local";

  if (provider !== "local" && provider !== "s3") {
    throw new Error("STORAGE_PROVIDER 仅支持 local 或 s3。");
  }

  return provider;
}

export function getDefaultStoragePrefix(stage = getDeploymentStage()) {
  switch (stage) {
    case "production":
      return "prod/";
    case "preview":
      return "preview/";
    case "test":
      return "test/";
    default:
      return "dev/";
  }
}

export function getStorageConfigStatus(): StorageConfigStatus {
  const provider = getStorageProvider();
  const stage = getDeploymentStage();
  const issues: ReadinessIssue[] = [];
  const keyPrefix = normalizeKeyPrefix(
    getOptionalEnv("S3_KEY_PREFIX") ?? getDefaultStoragePrefix(stage),
  );

  if (provider === "local") {
    if (isHostedRuntime()) {
      issues.push({
        key: "STORAGE_PROVIDER",
        message:
          "Preview 和 Production 环境不能使用本地磁盘存储，请把 STORAGE_PROVIDER 改成 s3。",
      });
    }

    return {
      provider,
      keyPrefix,
      isReady: issues.length === 0,
      issues,
    };
  }

  const requiredKeys = [
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ] as const;

  for (const key of requiredKeys) {
    if (!getOptionalEnv(key)) {
      issues.push({
        key,
        message: `缺少对象存储配置 ${key}。`,
      });
    }
  }

  if (!getOptionalEnv("S3_PUBLIC_BASE_URL") && !getOptionalEnv("S3_ENDPOINT")) {
    issues.push({
      key: "S3_PUBLIC_BASE_URL",
      message:
        "缺少 S3_PUBLIC_BASE_URL 或 S3_ENDPOINT，系统无法生成可访问的图片地址。",
    });
  }

  return {
    provider,
    keyPrefix,
    isReady: issues.length === 0,
    issues,
  };
}

export function assertStorageRuntimeReady() {
  const status = getStorageConfigStatus();
  if (!status.isReady) {
    throw new Error(status.issues[0]?.message ?? "对象存储配置不完整。");
  }

  return status;
}

export function assertDatabaseRuntimeReady() {
  return getRequiredEnv("DATABASE_URL");
}

export function getDeploymentReadiness(): DeploymentReadiness {
  const issues: ReadinessIssue[] = [];
  const appUrl = getAppUrl();
  const storage = getStorageConfigStatus();
  const stage = getDeploymentStage();

  if (!getOptionalEnv("DATABASE_URL")) {
    issues.push({
      key: "DATABASE_URL",
      message: "缺少 DATABASE_URL，Prisma 无法连接数据库。",
    });
  }

  if (!getAuthSecret()) {
    issues.push({
      key: "NEXTAUTH_SECRET",
      message: "缺少 NEXTAUTH_SECRET，后台登录无法工作。",
    });
  }

  if (!appUrl) {
    issues.push({
      key: "NEXTAUTH_URL",
      message:
        "缺少 NEXTAUTH_URL。生产或预览环境中请配置 NEXTAUTH_URL，或依赖 Vercel 的 VERCEL_URL。",
    });
  }

  issues.push(...storage.issues);

  return {
    stage,
    appUrl,
    storage,
    issues,
  };
}
