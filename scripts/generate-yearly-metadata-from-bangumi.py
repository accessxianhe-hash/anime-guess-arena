#!/usr/bin/env python3
"""Generate yearly metadata CSV skeleton + Bangumi-enriched CSV.

Usage:
  python scripts/generate-yearly-metadata-from-bangumi.py \
    --source-dir "D:\\桌面\\存\\2025" \
    --year 2025 \
    --output-dir "starter-packs"
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any


API_SEARCH = "https://api.bgm.tv/v0/search/subjects?limit={limit}&offset=0"
API_SUBJECT = "https://api.bgm.tv/v0/subjects/{subject_id}"
API_LEGACY_SEARCH = "https://api.bgm.tv/search/subject/{keyword}?type=2&responseGroup=large&max_results={limit}"
UA = "anime-guess-arena/metadata-generator"

CSV_IMPORT_COLUMNS = [
    "year",
    "title",
    "studios",
    "authors",
    "themes",
    "genres",
    "tags",
    "bangumi_tags",
    "extra_tags",
    "active",
]

# Extra columns are ignored by the importer but useful for review.
CSV_EXTRA_COLUMNS = [
    "bgm_subject_id",
    "bgm_url",
    "matched_name_cn",
    "matched_name",
    "match_score",
    "match_level",
]

STUDIO_KEYS = [
    "动画制作",
    "动画製作",
    "制作公司",
    "製作会社",
    "制作",
    "製作",
    "制作スタジオ",
    "アニメーション制作",
    "studio",
    "animation production",
]

AUTHOR_KEYS = [
    "原作",
    "作者",
    "漫画",
    "小說",
    "小说",
    "轻小说",
    "ライトノベル",
    "original",
]

GENRE_KEYS = [
    "类型",
    "题材",
    "ジャンル",
    "genre",
]

THEME_VOCAB = {
    "恋爱",
    "爱情",
    "校园",
    "日常",
    "搞笑",
    "喜剧",
    "治愈",
    "奇幻",
    "科幻",
    "冒险",
    "动作",
    "战斗",
    "热血",
    "悬疑",
    "推理",
    "惊悚",
    "恐怖",
    "魔法",
    "异世界",
    "青春",
    "运动",
    "音乐",
    "机战",
    "历史",
    "战争",
    "美食",
    "职场",
    "百合",
    "后宫",
    "超能力",
    "剧情",
    "萌",
    "泡面番",
    "短篇",
}

# Folder names can be typo/alias. We keep folder title in CSV, only use this for searching.
TITLE_SEARCH_OVERRIDE = {
    "妙屋少女的呢喃": "薬屋のひとりごと",
    "乱马二分之一": "らんま1/2",
    "时光荏苒饭菜依旧": "日々は過ぎれど飯うまし",
}


def normalize_text(value: str) -> str:
    return re.sub(r"[\s\-_·:：,，.!?！？'\"“”‘’/\\()（）\[\]【】]+", "", value).lower()


def clean_piece(value: str) -> str:
    value = re.sub(r"\(.*?\)|（.*?）|\[.*?]|\{.*?}", "", value)
    value = value.strip()
    # remove obvious role prefix, keep the right side
    value = re.sub(r"^(cv|cast|staff)\s*[:：]\s*", "", value, flags=re.IGNORECASE)
    return value


def split_multi(value: str) -> list[str]:
    parts = re.split(r"[\n|,，;；/&＆、・]+", value)
    return [clean_piece(p) for p in parts if clean_piece(p)]


def dedupe(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def is_probable_studio(value: str) -> bool:
    text = value.strip()
    if not text:
        return False
    noise_keywords = [
        "製作委員会",
        "制作委員会",
        "委員会",
        "担当",
        "協力",
        "协力",
        "音楽",
        "音乐",
        "プロデューサー",
        "制作進行",
        "制作进行",
        "宣伝",
        "製作:",
        "制作:",
    ]
    for bad in noise_keywords:
        if bad in text:
            return False
    if len(text) > 40:
        return False
    positive_hints = [
        "studio",
        "works",
        "pictures",
        "films",
        "animation",
        "アニメーション",
        "スタジオ",
        "動画",
        "动画",
        "映像",
        "プロダクション",
        "production",
        "京都",
        "京阿尼",
        "mappa",
        "olm",
        "cloverworks",
        "wit",
        "a-1",
        "p.a.",
        "p.a works",
        "shaft",
        "trigger",
        "madhouse",
        "sunrise",
        "bones",
        "tms",
        "engi",
        "lidenfilms",
        "science saru",
        "サイエンスsaru",
        "ライデンフィルム",
        "ゼロジー",
        "シンエイ",
        "cygamespictures",
        "bibury",
        "トムス",
        "feel.",
    ]
    lower = text.lower()
    if any(h in lower for h in positive_hints):
        return True
    # Allow short studio names in JP/CN scripts.
    if 2 <= len(text) <= 18 and re.fullmatch(r"[A-Za-z0-9 ._\-ァ-ヴーぁ-ん一-龥々]+", text):
        return True
    return False


def json_request(url: str, *, method: str = "GET", body: dict[str, Any] | None = None, timeout: int = 20) -> dict[str, Any]:
    payload = None
    headers = {
        "User-Agent": UA,
        "Accept": "application/json",
    }
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8"))


def legacy_search(keyword: str, limit: int, timeout: int = 20) -> list[dict[str, Any]]:
    encoded = urllib.parse.quote(keyword)
    url = API_LEGACY_SEARCH.format(keyword=encoded, limit=limit)
    payload = json_request(url, method="GET", timeout=timeout)
    items = payload.get("list") or []
    if isinstance(items, list):
        return [it for it in items if isinstance(it, dict)]
    return []


def list_titles(source_dir: str) -> list[str]:
    names: list[str] = []
    for entry in os.scandir(source_dir):
        if entry.is_dir():
            names.append(entry.name.strip())
    return sorted([n for n in names if n], key=lambda s: s.lower())


def key_hit(key: str, patterns: list[str]) -> bool:
    key_norm = key.strip().lower()
    for p in patterns:
        if p.lower() in key_norm:
            return True
    return False


def normalize_infobox_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return split_multi(value)
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if isinstance(item, str):
                out.extend(split_multi(item))
            elif isinstance(item, dict):
                # Common shape: {"v": "..."} or {"k": "...", "v": "..."}
                v = item.get("v")
                if isinstance(v, str):
                    out.extend(split_multi(v))
                elif isinstance(v, list):
                    for child in v:
                        if isinstance(child, str):
                            out.extend(split_multi(child))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for _, v in value.items():
            if isinstance(v, str):
                out.extend(split_multi(v))
        return out
    return []


def score_candidate(folder_title: str, candidate: dict[str, Any]) -> float:
    title_n = normalize_text(folder_title)
    names = [
        str(candidate.get("name_cn") or ""),
        str(candidate.get("name") or ""),
    ]

    best = 0.0
    for name in names:
        name_n = normalize_text(name)
        if not name_n:
            continue
        sim = SequenceMatcher(None, title_n, name_n).ratio()
        score = sim * 100
        if name_n == title_n:
            score += 60
        if title_n and title_n in name_n:
            score += 35
        if name_n and name_n in title_n:
            score += 20
        best = max(best, score)

    rank = (
        ((candidate.get("rating") or {}).get("rank"))
        if isinstance(candidate.get("rating"), dict)
        else None
    )
    if isinstance(rank, int) and rank > 0:
        # Slightly prefer better-ranked entries.
        best += max(0.0, 15.0 - rank / 300.0)

    return best


def choose_best_candidate(folder_title: str, items: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, float]:
    best_item = None
    best_score = -1.0
    for item in items:
        score = score_candidate(folder_title, item)
        if score > best_score:
            best_item = item
            best_score = score
    return best_item, best_score


def extract_metadata_from_subject(subject: dict[str, Any]) -> tuple[list[str], list[str], list[str], list[str], list[str]]:
    infobox = subject.get("infobox") or []
    studios: list[str] = []
    authors: list[str] = []
    genres: list[str] = []

    for node in infobox:
        if not isinstance(node, dict):
            continue
        key = str(node.get("key") or "")
        value = node.get("value")
        values = normalize_infobox_value(value)
        if not values:
            continue

        if key_hit(key, STUDIO_KEYS):
            studios.extend(values)
        if key_hit(key, AUTHOR_KEYS):
            authors.extend(values)
        if key_hit(key, GENRE_KEYS):
            genres.extend(values)

    tags_raw = subject.get("tags") or []
    tags_sorted = sorted(
        [t for t in tags_raw if isinstance(t, dict) and isinstance(t.get("name"), str)],
        key=lambda x: int(x.get("count") or 0),
        reverse=True,
    )

    bangumi_tags: list[str] = []
    for t in tags_sorted:
        name = clean_piece(str(t.get("name") or ""))
        if not name:
            continue
        if re.fullmatch(r"\d{4}", name):
            continue
        bangumi_tags.append(name)

    bangumi_tags = dedupe(bangumi_tags)[:35]
    genres = dedupe(genres)
    studios = [item for item in dedupe(studios) if is_probable_studio(item)]
    studios = studios[:8]
    authors = dedupe(authors)

    # themes: prefer vocab hits from tags + genres
    themes: list[str] = []
    for item in genres + bangumi_tags:
        for keyword in THEME_VOCAB:
            if keyword in item:
                themes.append(item)
                break
    themes = dedupe(themes)[:12]

    if not genres:
        # fallback: use top few thematic tags
        genres = themes[:6]

    tags = dedupe(themes + genres + bangumi_tags)[:50]
    return studios, authors, themes, genres, bangumi_tags, tags


@dataclass
class MatchResult:
    title: str
    subject_id: int | None
    subject_name_cn: str
    subject_name: str
    subject_url: str
    score: float
    level: str
    studios: list[str]
    authors: list[str]
    themes: list[str]
    genres: list[str]
    bangumi_tags: list[str]
    tags: list[str]


def level_from_score(score: float) -> str:
    if score >= 120:
        return "high"
    if score >= 85:
        return "medium"
    return "low"


def fetch_match(title: str, limit: int, sleep_sec: float) -> MatchResult:
    search_keywords = [title]
    override = TITLE_SEARCH_OVERRIDE.get(title)
    if override and override != title:
        search_keywords.insert(0, override)

    items: list[dict[str, Any]] = []
    for keyword in search_keywords:
        try:
            for candidate in legacy_search(keyword, limit=limit):
                items.append(candidate)
        except Exception:
            # keep fallback below
            pass

    if not items:
        # fallback to v0 search
        query = {
            "keyword": override or title,
            "sort": "rank",
            "filter": {"type": [2]},
        }
        search = json_request(API_SEARCH.format(limit=limit), method="POST", body=query)
        items = search.get("data") or []

    if not isinstance(items, list) or len(items) == 0:
        return MatchResult(
            title=title,
            subject_id=None,
            subject_name_cn="",
            subject_name="",
            subject_url="",
            score=0.0,
            level="none",
            studios=[],
            authors=[],
            themes=[],
            genres=[],
            bangumi_tags=[],
            tags=[],
        )

    candidate, score = choose_best_candidate(title, dedupe_candidates(items))
    if not candidate:
        return MatchResult(
            title=title,
            subject_id=None,
            subject_name_cn="",
            subject_name="",
            subject_url="",
            score=0.0,
            level="none",
            studios=[],
            authors=[],
            themes=[],
            genres=[],
            bangumi_tags=[],
            tags=[],
        )

    subject_id = int(candidate.get("id"))
    time.sleep(sleep_sec)
    detail = json_request(API_SUBJECT.format(subject_id=subject_id), method="GET")
    studios, authors, themes, genres, bangumi_tags, tags = extract_metadata_from_subject(detail)
    return MatchResult(
        title=title,
        subject_id=subject_id,
        subject_name_cn=str(detail.get("name_cn") or candidate.get("name_cn") or ""),
        subject_name=str(detail.get("name") or candidate.get("name") or ""),
        subject_url=f"https://bgm.tv/subject/{subject_id}",
        score=score,
        level=level_from_score(score),
        studios=studios,
        authors=authors,
        themes=themes,
        genres=genres,
        bangumi_tags=bangumi_tags,
        tags=tags,
    )


def dedupe_candidates(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        ident = item.get("id")
        if not isinstance(ident, int):
            try:
                ident = int(ident)
            except Exception:
                continue
        if ident in seen:
            continue
        seen.add(ident)
        out.append(item)
    return out


def write_csv(path: str, columns: list[str], rows: list[dict[str, str]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as fp:
        writer = csv.DictWriter(fp, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--year", type=int, default=2025)
    parser.add_argument("--output-dir", default="starter-packs")
    parser.add_argument("--search-limit", type=int, default=10)
    parser.add_argument("--sleep-sec", type=float, default=0.35)
    args = parser.parse_args()

    source_dir = os.path.abspath(args.source_dir)
    output_dir = os.path.abspath(args.output_dir)

    if not os.path.isdir(source_dir):
        print(f"[ERROR] source dir not found: {source_dir}")
        return 1

    titles = list_titles(source_dir)
    if not titles:
        print(f"[ERROR] no directory titles found in: {source_dir}")
        return 1

    print(f"[INFO] found {len(titles)} titles in {source_dir}")

    skeleton_rows: list[dict[str, str]] = []
    full_rows: list[dict[str, str]] = []
    report_rows: list[dict[str, Any]] = []

    for idx, title in enumerate(titles, start=1):
        print(f"[INFO] ({idx}/{len(titles)}) matching: {title}")
        skeleton_rows.append(
            {
                "year": str(args.year),
                "title": title,
                "studios": "",
                "authors": "",
                "themes": "",
                "genres": "",
                "tags": "",
                "bangumi_tags": "",
                "extra_tags": "",
                "active": "true",
            }
        )

        try:
            match = fetch_match(title, limit=args.search_limit, sleep_sec=args.sleep_sec)
        except urllib.error.HTTPError as exc:
            print(f"[WARN] HTTP error for {title}: {exc}")
            match = MatchResult(
                title=title,
                subject_id=None,
                subject_name_cn="",
                subject_name="",
                subject_url="",
                score=0.0,
                level="none",
                studios=[],
                authors=[],
                themes=[],
                genres=[],
                bangumi_tags=[],
                tags=[],
            )
        except Exception as exc:
            print(f"[WARN] error for {title}: {exc}")
            match = MatchResult(
                title=title,
                subject_id=None,
                subject_name_cn="",
                subject_name="",
                subject_url="",
                score=0.0,
                level="none",
                studios=[],
                authors=[],
                themes=[],
                genres=[],
                bangumi_tags=[],
                tags=[],
            )

        full_rows.append(
            {
                "year": str(args.year),
                "title": title,
                "studios": "|".join(match.studios),
                "authors": "|".join(match.authors),
                "themes": "|".join(match.themes),
                "genres": "|".join(match.genres),
                "tags": "|".join(match.tags),
                "bangumi_tags": "|".join(match.bangumi_tags),
                "extra_tags": "",
                "active": "true",
                "bgm_subject_id": str(match.subject_id or ""),
                "bgm_url": match.subject_url,
                "matched_name_cn": match.subject_name_cn,
                "matched_name": match.subject_name,
                "match_score": f"{match.score:.2f}",
                "match_level": match.level,
            }
        )
        report_rows.append(
            {
                "title": title,
                "subject_id": match.subject_id,
                "subject_url": match.subject_url,
                "subject_name_cn": match.subject_name_cn,
                "subject_name": match.subject_name,
                "match_score": round(match.score, 2),
                "match_level": match.level,
            }
        )

    skeleton_path = os.path.join(output_dir, f"yearly-metadata-{args.year}-skeleton.csv")
    full_path = os.path.join(output_dir, f"yearly-metadata-{args.year}-bangumi.csv")
    report_path = os.path.join(output_dir, f"yearly-metadata-{args.year}-bangumi-report.json")

    write_csv(skeleton_path, CSV_IMPORT_COLUMNS, skeleton_rows)
    write_csv(full_path, CSV_IMPORT_COLUMNS + CSV_EXTRA_COLUMNS, full_rows)
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as fp:
        json.dump(
            {
                "source_dir": source_dir,
                "year": args.year,
                "total_titles": len(titles),
                "generated_at_unix": int(time.time()),
                "matches": report_rows,
            },
            fp,
            ensure_ascii=False,
            indent=2,
        )

    low_count = sum(1 for row in report_rows if row["match_level"] in {"none", "low"})
    print(f"[OK] skeleton: {skeleton_path}")
    print(f"[OK] bangumi : {full_path}")
    print(f"[OK] report  : {report_path}")
    print(f"[INFO] low/none confidence: {low_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
