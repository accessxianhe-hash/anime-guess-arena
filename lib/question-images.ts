function encodeStorageKey(storageKey: string) {
  return storageKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildQuestionImageSrc(
  imageStorageKey?: string | null,
  imageUrl?: string | null,
) {
  const storageKey = imageStorageKey?.trim();
  const sourceUrl = imageUrl?.trim();

  if (!storageKey) {
    return sourceUrl || "";
  }

  const encodedKey = encodeStorageKey(storageKey);
  const storageProvider = process.env.STORAGE_PROVIDER?.trim() ?? "local";

  if (storageProvider === "local") {
    return `/uploads/${encodedKey}`;
  }

  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (publicBaseUrl) {
    return `${publicBaseUrl}/${encodedKey}`;
  }

  const params = new URLSearchParams();
  params.set("key", storageKey);

  if (sourceUrl) {
    params.set("url", sourceUrl);
  }

  return `/api/question-image?${params.toString()}`;
}
