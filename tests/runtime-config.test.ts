import { afterEach, describe, expect, it } from "vitest";

import {
  getAppUrl,
  getDefaultStoragePrefix,
  getDeploymentStage,
  getStorageConfigStatus,
} from "@/lib/runtime-config";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

afterEach(() => {
  resetEnv();
});

describe("runtime config", () => {
  it("detects preview stage from vercel env", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.NODE_ENV = "production";

    expect(getDeploymentStage()).toBe("preview");
  });

  it("falls back to vercel url for app url", () => {
    process.env.VERCEL_URL = "anime-guess-preview.vercel.app";
    delete process.env.NEXTAUTH_URL;
    delete process.env.AUTH_URL;

    expect(getAppUrl()).toBe("https://anime-guess-preview.vercel.app");
  });

  it("uses prod prefix for production by default", () => {
    expect(getDefaultStoragePrefix("production")).toBe("prod/");
    expect(getDefaultStoragePrefix("preview")).toBe("preview/");
    expect(getDefaultStoragePrefix("development")).toBe("dev/");
  });

  it("rejects local storage in hosted runtime", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.STORAGE_PROVIDER = "local";

    const status = getStorageConfigStatus();
    expect(status.isReady).toBe(false);
    expect(status.issues[0]?.message).toContain("不能使用本地磁盘存储");
  });

  it("accepts local storage in development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    process.env.STORAGE_PROVIDER = "local";

    const status = getStorageConfigStatus();
    expect(status.isReady).toBe(true);
  });
});
