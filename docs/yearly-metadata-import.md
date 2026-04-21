# Yearly Metadata CSV Import

Use this flow after image import to batch assign metadata for yearly series:

- `authors` (high priority)
- `studios` (high priority)
- `themes / genres / bangumi_tags` (high priority for tag quality)
- additional labels and status

## 1. CSV Template

Recommended columns:

- `year` (required)
- `title` (required)
- `studios` (optional, multi-value)
- `authors` (optional, multi-value)
- `themes` (optional, multi-value)
- `genres` (optional, multi-value)
- `tags` (optional, multi-value)
- `bangumi_tags` (optional, multi-value)
- `extra_tags` (optional, multi-value)
- `active` (optional: `true/false`)
- `replace` (optional: `true/false`, row-level override)

Supported aliases:

- `release_year` as `year`
- `series_title` / `canonical_title` / `anime_title` as `title`
- `studio` / `production` / `制作社` as `studios`
- `author` / `staff` / `原作` / `作者` as `authors`
- `bgm_tags` as `bangumi_tags`

## 2. Multi-value Format

For all list fields (`studios`, `authors`, `themes`, `genres`, `tags`, `bangumi_tags`, `extra_tags`),
use any of these separators:

- `|`
- `,` or `，`
- `;` or `；`
- newline

`|` is recommended for clean export/import.

## 3. Example

```csv
year,title,studios,authors,themes,genres,bangumi_tags,extra_tags,active
2025,胆大党,Science SARU,龙幸伸,热血|战斗|超能力,喜剧|校园,日本|TV|漫画改|搞笑|战斗,妖怪|外星人,true
2025,碧蓝之海,Zero-G,井上坚二,日常|搞笑,青春|校园,日本|TV|漫画改|大学|社团,潜水|酒,false
```

## 4. Admin Page Usage

1. Open `/admin/import`
2. Select metadata CSV file
3. Optionally enable:
   - `允许创建缺失番剧（仅元数据，无图片）`
   - `覆盖已有 tags/studios/authors`
4. Click `批量写入番剧元数据`

By default the importer **merges** into existing data (incoming values have higher display priority).

