import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/csv";

type MetadataCsvRow = Record<string, string>;

type ImportError = {
  row: number;
  message: string;
};

type ImportOptions = {
  createMissing: boolean;
  replaceExisting: boolean;
};

export type YearlyMetadataImportResult = {
  totalRows: number;
  updatedSeries: number;
  createdSeries: number;
  skippedRows: number;
  errors: ImportError[];
};

function normalizeSeriesTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitMultiValue(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(/[\n|,;\uFF0C\uFF1B]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }

  return output;
}

function mergeWithPriority(incoming: string[], existing: string[]) {
  return dedupeCaseInsensitive([...incoming, ...existing]);
}

function parseBoolean(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function readFirstValue(row: MetadataCsvRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function parseYear(row: MetadataCsvRow) {
  const yearText = readFirstValue(row, ["year", "release_year"]);
  const year = Number(yearText);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return null;
  }
  return year;
}

function parseTitle(row: MetadataCsvRow) {
  return readFirstValue(row, ["title", "series_title", "canonical_title", "anime_title"]);
}

function parseTags(row: MetadataCsvRow) {
  const themes = splitMultiValue(readFirstValue(row, ["themes", "theme_tags"]));
  const genres = splitMultiValue(readFirstValue(row, ["genres", "genre_tags"]));
  const curated = splitMultiValue(readFirstValue(row, ["tags"]));
  const bangumi = splitMultiValue(readFirstValue(row, ["bangumi_tags", "bgm_tags"]));
  const extra = splitMultiValue(readFirstValue(row, ["extra_tags", "labels"]));

  return dedupeCaseInsensitive([...themes, ...genres, ...curated, ...bangumi, ...extra]);
}

function parseStudios(row: MetadataCsvRow) {
  return dedupeCaseInsensitive(
    splitMultiValue(readFirstValue(row, ["studios", "studio", "production"])),
  );
}

function parseAuthors(row: MetadataCsvRow) {
  return dedupeCaseInsensitive(
    splitMultiValue(readFirstValue(row, ["authors", "author", "staff", "original_author"])),
  );
}

export async function importYearlyMetadataFromCsv(
  file: File,
  options: Partial<ImportOptions> = {},
): Promise<YearlyMetadataImportResult> {
  const resolvedOptions: ImportOptions = {
    createMissing: options.createMissing ?? false,
    replaceExisting: options.replaceExisting ?? false,
  };

  const content = await file.text();
  const rows = parseCsv(content);
  const errors: ImportError[] = [];

  let updatedSeries = 0;
  let createdSeries = 0;
  let skippedRows = 0;

  for (const [index, rawRow] of rows.entries()) {
    const rowNumber = index + 2;
    const row = rawRow as MetadataCsvRow;

    try {
      const year = parseYear(row);
      if (!year) {
        errors.push({
          row: rowNumber,
          message: "Invalid year. Expected an integer between 1900 and 2100.",
        });
        continue;
      }

      const title = parseTitle(row);
      if (!title) {
        errors.push({
          row: rowNumber,
          message: "Missing title.",
        });
        continue;
      }

      const normalizedTitleRaw = readFirstValue(row, ["normalized_title"]);
      const normalizedTitle = normalizedTitleRaw
        ? normalizeSeriesTitle(normalizedTitleRaw)
        : normalizeSeriesTitle(title);

      const incomingTags = parseTags(row);
      const incomingStudios = parseStudios(row);
      const incomingAuthors = parseAuthors(row);
      const active = parseBoolean(readFirstValue(row, ["active"]));
      const replace =
        parseBoolean(readFirstValue(row, ["replace"])) ?? resolvedOptions.replaceExisting;

      if (
        incomingTags.length === 0 &&
        incomingStudios.length === 0 &&
        incomingAuthors.length === 0 &&
        active === null
      ) {
        skippedRows += 1;
        continue;
      }

      const existing = await prisma.yearlySeries.findUnique({
        where: {
          year_normalizedTitle: {
            year,
            normalizedTitle,
          },
        },
        select: {
          id: true,
          tags: true,
          studios: true,
          authors: true,
          active: true,
        },
      });

      if (!existing) {
        if (!resolvedOptions.createMissing) {
          skippedRows += 1;
          continue;
        }

        await prisma.yearlySeries.create({
          data: {
            year,
            title,
            normalizedTitle,
            tags: incomingTags,
            studios: incomingStudios,
            authors: incomingAuthors,
            active: active ?? true,
          },
        });
        createdSeries += 1;
        continue;
      }

      const nextTags = replace ? incomingTags : mergeWithPriority(incomingTags, existing.tags);
      const nextStudios = replace
        ? incomingStudios
        : mergeWithPriority(incomingStudios, existing.studios);
      const nextAuthors = replace
        ? incomingAuthors
        : mergeWithPriority(incomingAuthors, existing.authors);
      const nextActive = active ?? existing.active;

      const changed =
        JSON.stringify(nextTags) !== JSON.stringify(existing.tags) ||
        JSON.stringify(nextStudios) !== JSON.stringify(existing.studios) ||
        JSON.stringify(nextAuthors) !== JSON.stringify(existing.authors) ||
        nextActive !== existing.active;

      if (!changed) {
        skippedRows += 1;
        continue;
      }

      await prisma.yearlySeries.update({
        where: { id: existing.id },
        data: {
          tags: nextTags,
          studios: nextStudios,
          authors: nextAuthors,
          active: nextActive,
        },
      });
      updatedSeries += 1;
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return {
    totalRows: rows.length,
    updatedSeries,
    createdSeries,
    skippedRows,
    errors,
  };
}

