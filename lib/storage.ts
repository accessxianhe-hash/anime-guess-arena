import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  assertStorageRuntimeReady,
  getStorageProvider,
} from "@/lib/runtime-config";

type UploadResult = {
  storageKey: string;
  publicUrl: string;
};

type DownloadResult = {
  body: Uint8Array;
  contentType: string;
};

export type StorageProbeResult = {
  ok: boolean;
  provider: "local" | "s3";
  elapsedMs: number;
  message: string;
};

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, "-").replace(/-+/g, "-");
}

function getS3Client() {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const forcePathStyleOverride = process.env.S3_FORCE_PATH_STYLE;
  const forcePathStyle =
    forcePathStyleOverride === "true"
      ? true
      : forcePathStyleOverride === "false"
        ? false
        : endpoint
          ? !endpoint.includes(".myqcloud.com")
          : false;

  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint,
    forcePathStyle,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

function guessContentType(filename: string) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  if (lower.endsWith(".gif")) {
    return "image/gif";
  }

  if (lower.endsWith(".avif")) {
    return "image/avif";
  }

  return "application/octet-stream";
}

export async function uploadQuestionImage(
  input: Buffer,
  originalFilename: string,
  contentType: string,
): Promise<UploadResult> {
  const storageStatus = assertStorageRuntimeReady();
  const storageProvider = getStorageProvider();
  const safeFilename = sanitizeFilename(originalFilename);
  const storageKey =
    storageProvider === "s3"
      ? path.posix.join(
          storageStatus.keyPrefix,
          "questions",
          `${randomUUID()}-${safeFilename}`,
        )
      : `questions/${randomUUID()}-${safeFilename}`;

  if (storageProvider === "s3") {
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: storageKey,
        Body: input,
        ContentType: contentType,
      }),
    );

    const baseUrl =
      process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "") ??
      `${process.env.S3_ENDPOINT?.replace(/\/$/, "")}/${process.env.S3_BUCKET}`;

    return {
      storageKey,
      publicUrl: `${baseUrl}/${storageKey}`,
    };
  }

  const target = path.join(process.cwd(), "public", "uploads", storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, input);

  return {
    storageKey,
    publicUrl: `/uploads/${storageKey}`,
  };
}

export async function deleteQuestionImage(storageKey: string | null | undefined) {
  if (!storageKey) {
    return;
  }

  const storageProvider = getStorageProvider();

  if (storageProvider === "s3") {
    const client = getS3Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: storageKey,
      }),
    );
    return;
  }

  const target = path.join(process.cwd(), "public", "uploads", storageKey);
  await rm(target, { force: true });
}

export async function downloadQuestionImage(
  storageKey: string,
): Promise<DownloadResult> {
  const storageProvider = getStorageProvider();

  if (storageProvider === "s3") {
    const client = getS3Client();
    const result = await client.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: storageKey,
      }),
    );

    const body = result.Body;
    if (!body || !("transformToByteArray" in body)) {
      throw new Error("Unable to read object body from storage.");
    }

    return {
      body: await body.transformToByteArray(),
      contentType: result.ContentType ?? guessContentType(storageKey),
    };
  }

  const target = path.join(process.cwd(), "public", "uploads", storageKey);

  return {
    body: await readFile(target),
    contentType: guessContentType(storageKey),
  };
}

export async function probeStorageConnectivity(): Promise<StorageProbeResult> {
  const startedAt = Date.now();
  const provider = getStorageProvider();

  try {
    if (provider === "s3") {
      assertStorageRuntimeReady();
      const client = getS3Client();
      const probeKey = `${process.env.S3_KEY_PREFIX?.replace(/^\/+|\/+$/g, "") || "health"}/health/probe-${randomUUID()}.txt`;

      await client.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: probeKey,
          Body: Buffer.from("ok"),
          ContentType: "text/plain",
        }),
      );

      await client.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: probeKey,
        }),
      );

      return {
        ok: true,
        provider,
        elapsedMs: Date.now() - startedAt,
        message: "S3 write/delete probe succeeded.",
      };
    }

    const probeDir = path.join(process.cwd(), "tmp", "health-probe");
    const probeFile = path.join(probeDir, `${randomUUID()}.txt`);
    await mkdir(probeDir, { recursive: true });
    await writeFile(probeFile, Buffer.from("ok"));
    await rm(probeFile, { force: true });

    return {
      ok: true,
      provider,
      elapsedMs: Date.now() - startedAt,
      message: "Local storage write/delete probe succeeded.",
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Unknown storage probe failure.",
    };
  }
}
