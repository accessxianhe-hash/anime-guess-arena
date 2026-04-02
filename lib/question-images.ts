export function buildQuestionImageSrc(
  imageStorageKey?: string | null,
  imageUrl?: string | null,
) {
  const storageKey = imageStorageKey?.trim();
  const sourceUrl = imageUrl?.trim();

  if (sourceUrl) {
    return sourceUrl;
  }

  if (!storageKey) {
    return "";
  }

  const params = new URLSearchParams();

  params.set("key", storageKey);

  return `/api/question-image?${params.toString()}`;
}
