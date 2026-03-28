import { parse } from "csv-parse/sync";

export function parseCsv(content: string) {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;
}

