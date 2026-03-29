import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, "-").replace(/-+/g, "-");
}

function getS3Client() {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
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
