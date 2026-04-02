export function buildQuestionImageSrc(
  imageStorageKey?: string | null,
  imageUrl?: string | null,
) {
  const storageKey = imageStorageKey?.trim();
  const sourceUrl = imageUrl?.trim();

  if (!storageKey && !sourceUrl) {
    return "";
  }

  const params = new URLSearchParams();

  if (storageKey) {
    params.set("key", storageKey);
  }

  if (sourceUrl) {
    params.set("url", sourceUrl);
  }

  return `/api/question-image?${params.toString()}`;
}
