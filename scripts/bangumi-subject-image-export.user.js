// ==UserScript==
// @name         Bangumi Subject Image Export
// @namespace    https://anime-guess-arena.local/
// @version      0.1.4
// @description  Export user-posted images for a single Bangumi subject with source manifests.
// @author       Codex
// @match        https://bgm.tv/subject/*
// @match        https://bangumi.tv/subject/*
// @match        https://chii.in/subject/*
// @match        https://bgm.tv/ep/*
// @match        https://bangumi.tv/ep/*
// @match        https://chii.in/ep/*
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const EXPORT_ROOT = "bangumi-export";
  const SCRIPT_VERSION = "0.1.4";
  const IMAGE_DIR = "images";
  const MIN_PAGE_DELAY_MS = 420;
  const MAX_PAGE_DELAY_MS = 980;
  const EP_ONLY_MIN_PAGE_DELAY_MS = 120;
  const EP_ONLY_MAX_PAGE_DELAY_MS = 360;
  const PAGE_FETCH_TIMEOUT_MS = 14000;
  const IMAGE_DOWNLOAD_CONCURRENCY = 3;
  const MAX_IMAGE_DOWNLOAD_RETRIES = 1;
  const IMAGE_REQUEST_TIMEOUT_MS = 6500;
  const PAGE_PROCESS_TIMEOUT_MS = 35000;
  const PAGE_MAX_RETRIES = 2;
  const STALL_AUTO_RESET_MS = 45000;
  const IMAGE_HOST_FAIL_THRESHOLD = 3;
  const IMAGE_HOST_COOLDOWN_MS = 120000;
  const MAX_PAGE_ERROR_STREAK = 3;
  const SMALL_IMAGE_MAX_EDGE = 72;
  const MIN_IMAGE_BYTES = 12 * 1024;
  const MIN_IMAGE_WIDTH = 320;
  const MIN_IMAGE_HEIGHT = 180;
  const MIN_IMAGE_AREA = MIN_IMAGE_WIDTH * MIN_IMAGE_HEIGHT;
  const MIN_IMAGE_ASPECT_RATIO = 0.45;
  const MAX_IMAGE_ASPECT_RATIO = 2.4;
  const QUALITY_SAMPLE_MAX_EDGE = 256;
  const MIN_IMAGE_EDGE_SCORE = 8;
  const PANEL_ACCEPTED_PREVIEW_LIMIT = 60;
  const MAX_PAGE_QUEUE = 180;
  const MAX_COMMENT_PAGE = 12;
  const MAX_REVIEW_PAGE = 8;
  const ENABLE_SUBJECT_COMMENTS_CRAWL = false;
  const ENABLE_SUBJECT_REVIEWS_CRAWL = false;
  const STATUS_ID = "bangumi-image-export-status";
  const PANEL_ID = "bangumi-image-export-panel";
  const PANEL_COLLAPSE_STORAGE_KEY = "bangumi-image-export-panel-collapsed";
  const PANEL_POSITION_STORAGE_KEY = "bangumi-image-export-panel-position";
  const CRAWL_MODE_STORAGE_KEY = "bangumi-image-export-crawl-mode";
  const CRAWL_MODE_EP_ONLY = "ep-only";
  const CRAWL_MODE_ALL = "all";
  const SAME_ORIGIN = location.origin;
  const CONTENT_SCOPE_SELECTORS = [
    ".postTopic .topic_content",
    ".topic_reply .reply_content",
    ".topic_reply .message",
    ".topic_sub_reply .message",
    "#comment_box .item .message",
    "#comment_box .row_reply .message",
    ".cmt_sub_content",
    ".blog_entry",
    ".review_content",
  ];
  const PAGE_TYPE_CONTENT_SCOPE_SELECTORS = {
    episode: [
      ".postTopic .topic_content",
      ".topic_reply .reply_content",
      ".topic_reply .message",
      ".topic_sub_reply .message",
      "#comment_box .item .message",
      "#comment_box .row_reply .message",
      ".cmt_sub_content",
    ],
    blog: [
      ".blog_main #entry_content",
      "#entry_content",
      "#comment_box .item .message",
      "#comment_box .row_reply .message",
      "#comment_box .item .cmt_sub_content",
      "#comment_box .row_reply .cmt_sub_content",
      ".cmt_sub_content",
      ".topic_sub_reply .message",
    ],
  };
  const POST_CONTAINER_SELECTORS = [
    ".postTopic",
    ".topic_reply",
    ".topic_sub_reply",
    "#comment_box .item",
    "#comment_box .row_reply",
    ".row_reply",
    ".item",
    ".blog_main",
    ".review_content",
    "#entry_content",
  ];
  const PAGE_TYPE_POST_CONTAINER_SELECTORS = {
    episode: [
      ".postTopic",
      ".topic_reply",
      ".topic_sub_reply",
      "#comment_box .item",
      "#comment_box .row_reply",
    ],
    blog: [
      ".blog_main",
      "#entry_content",
      ".postTopic",
      "#comment_box .item",
      "#comment_box .row_reply",
      ".topic_sub_reply",
    ],
  };
  const DEFAULT_POST_URL_SELECTORS = [
    "a.floor-anchor",
    "a[href*='/blog/']",
    "a[href*='/topic/']",
    "a[href*='/ep/']",
    "a[href*='/rakuen/topic/']",
  ];
  const PAGE_TYPE_POST_URL_SELECTORS = {
    episode: [
      ".re_info a.floor-anchor",
      ".post_actions a.floor-anchor",
      ".topic_actions a.floor-anchor",
      "a[href*='/topic/']",
      "a[href*='/ep/']",
      ...DEFAULT_POST_URL_SELECTORS,
    ],
    blog: [
      ".blog_actions a[href*='/blog/']",
      ".re_info a[href*='/blog/']",
      "a[href*='/blog/']",
      "a.floor-anchor",
      ...DEFAULT_POST_URL_SELECTORS,
    ],
  };
  const DEFAULT_POST_AUTHOR_SELECTORS = [
    ".tip_j a.l",
    ".tip_j a",
    ".avatarNeue + a",
    "a.avatar + span a",
    ".inner strong a",
    "strong a.l",
    ".user a.l",
    ".user a",
  ];
  const PAGE_TYPE_POST_AUTHOR_SELECTORS = {
    episode: [
      ".tip_j a.l",
      ".tip_j a[href*='/user/']",
      ".post_actions a[href*='/user/']",
      ".user a[href*='/user/']",
      ...DEFAULT_POST_AUTHOR_SELECTORS,
    ],
    blog: [
      ".blog_main .tip_j a.l",
      ".blog_main .tip_j a[href*='/user/']",
      ".blog_actions a[href*='/user/']",
      ".postTopic .tip_j a.l",
      ...DEFAULT_POST_AUTHOR_SELECTORS,
    ],
  };
  const DEFAULT_POST_TIME_SELECTORS = [
    ".re_info",
    ".post_actions time",
    ".time",
    "small",
    ".tip_j",
  ];
  const PAGE_TYPE_POST_TIME_SELECTORS = {
    episode: [
      ".re_info",
      ".post_actions time",
      ".post_actions",
      ".tip_j",
      ...DEFAULT_POST_TIME_SELECTORS,
    ],
    blog: [
      ".blog_actions time",
      ".blog_actions",
      ".re_info",
      ".tip_j",
      ...DEFAULT_POST_TIME_SELECTORS,
    ],
  };
  const NON_CONTENT_ANCESTOR_SELECTORS = [
    ".avatar",
    ".avatarNeue",
    ".avatarNeuePop",
    ".reply_avatar",
    ".userImage",
    ".userContainer",
    ".pictureFrame",
    ".pictureFrameGroup",
    ".cover",
    ".subjectCover",
    ".tinyCover",
    ".browserCoverMedium",
    ".coversSmall",
    ".headerAvatar",
    ".tip_i",
    ".tip_j",
    ".re_info",
    ".post_actions",
    ".blog_actions",
    ".review_actions",
    ".icon",
    ".icons",
    "#headerSubject",
    "#subject_inner_info",
    "#subject_detail",
    "#columnSubjectHomeA",
  ];
  const ALL_CONTENT_SCOPE_SELECTORS = Array.from(
    new Set([
      ...CONTENT_SCOPE_SELECTORS,
      ...Object.values(PAGE_TYPE_CONTENT_SCOPE_SELECTORS).flat(),
    ])
  );
  const PAGE_TYPE_PATTERNS = [
    { type: "subject", pattern: /\/subject\/\d+(?:\/?$|[?#])/ },
    { type: "episode", pattern: /\/ep\/\d+(?:\/?$|[?#])/ },
    { type: "subject_topic", pattern: /\/subject\/topic\/\d+(?:\/?$|[?#])/ },
    { type: "blog", pattern: /\/blog\/\d+(?:\/?$|[?#])/ },
    { type: "comment", pattern: /\/subject\/\d+\/comments(?:\/?$|[?#])/ },
    { type: "review", pattern: /\/subject\/\d+\/reviews(?:\/?$|[?#])/ },
    { type: "board", pattern: /\/subject\/\d+\/board(?:\/?$|[?#])/ },
    { type: "rakuen", pattern: /\/rakuen\/topic\/subject\/\d+(?:\/?$|[?#])/ },
  ];
  const UI_IMAGE_PATTERNS = [
    /\/pic\/user\//i,
    /\/pic\/cover\//i,
    /\/smiles?\//i,
    /avatar/i,
    /gravatar/i,
    /icon/i,
    /emoji/i,
    /favicon/i,
    /logo/i,
  ];

  const state = {
    running: false,
    paused: false,
    pageQueue: [],
    seenPages: new Set(),
    seenImageUrls: new Set(),
    seenImageHashes: new Map(),
    manifest: [],
    crawlLog: [],
    pageErrorStreak: 0,
    currentSubject: null,
    exportHandle: null,
    subjectDirHandle: null,
    imageDirHandle: null,
    imageCounter: 0,
    filteredImages: 0,
    processedPages: 0,
    recentAcceptedPreviews: [],
    recentFilteredPreviews: [],
    manualIncludedPreviewIds: new Set(),
    manualIncludeInFlightIds: new Set(),
    imageHostFailures: new Map(),
    statusText: "待命",
    statusKind: "idle",
    crawlMode: readCrawlMode(),
    panelCollapsed: readPanelCollapsed(),
    panelPosition: readPanelPosition(),
    panelScrollTop: 0,
    panelScrollTopPinned: null,
    pageAttemptMap: new Map(),
    lastProgressAt: Date.now(),
  };

  class PauseError extends Error {
    constructor(message) {
      super(message);
      this.name = "PauseError";
    }
  }

  function handleStartFromPanel() {
    if (state.running) {
      if (state.paused) {
        state.paused = false;
        updateStatus("已恢复抓取。", "active");
        return;
      }
      updateStatus("抓取已在进行中。", "warning");
      return;
    }

    startCrawl().catch((error) => {
      logError("fatal", {
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
      updateStatus(`鎶撳彇澶辫触锛${error?.message || "鏈煡閿欒"}`, "error");
    });
  }

  class PageProcessTimeoutError extends Error {
    constructor(pageUrl) {
      super(`页面处理超时（>${Math.round(PAGE_PROCESS_TIMEOUT_MS / 1000)}s）: ${pageUrl}`);
      this.name = "PageProcessTimeoutError";
      this.pageUrl = pageUrl;
    }
  }

  function pinPanelScrollFromDom() {
    const root = document.getElementById(PANEL_ID);
    const body = root?.querySelector?.('[data-panel-body]');
    const scrollTop = body?.scrollTop;
    if (Number.isFinite(scrollTop)) {
      state.panelScrollTop = scrollTop;
      state.panelScrollTopPinned = scrollTop;
    }
  }

  function handleResetFromPanel() {
    if (state.running) {
      state.running = false;
      state.paused = false;
    }
    resetState();
    updateStatus("已重置抓取状态，可重新开始。", "idle");
  }

  function handlePauseToggleFromPanel() {
    if (!state.running) {
      updateStatus("当前没有进行中的抓取任务。", "idle");
      return;
    }

    state.paused = !state.paused;
    updateStatus(state.paused ? "已暂停抓取。" : "已恢复抓取。", state.paused ? "warning" : "active");
  }

  function handleToggleModeFromPanel() {
    if (state.running) {
      updateStatus("抓取运行中无法切换模式，请先暂停后再切换。", "warning");
      return;
    }
    state.crawlMode = isEpOnlyMode() ? CRAWL_MODE_ALL : CRAWL_MODE_EP_ONLY;
    writeCrawlMode(state.crawlMode);
    updateStatus(
      isEpOnlyMode() ? "已切换为：只抓 EP 模式（推荐）。" : "已切换为：全站点相关页模式。",
      "done"
    );
  }

  async function handleExportFromPanel() {
    if (!state.currentSubject) {
      updateStatus("当前没有可导出的抓取任务。", "idle");
      return;
    }

    if (state.subjectDirHandle) {
      await writeJsonFile("crawl-log.json", state.crawlLog);
      await writeJsonFile("manifest.json", state.manifest);
      await writeTextFile("manifest.csv", buildManifestCsv(state.manifest));
      updateStatus("已将当前日志写入导出目录。", "done");
      return;
    }

    downloadText(buildManifestCsv(state.manifest), `${state.currentSubject.slug}-manifest.csv`, "text/csv;charset=utf-8");
    downloadText(JSON.stringify(state.manifest, null, 2), `${state.currentSubject.slug}-manifest.json`, "application/json;charset=utf-8");
    downloadText(JSON.stringify(state.crawlLog, null, 2), `${state.currentSubject.slug}-crawl-log.json`, "application/json;charset=utf-8");
    updateStatus("已导出当前抓取日志。", "done");
  }

  GM_registerMenuCommand("寮€濮嬫姄鍙栨湰浣滃搧鍥剧墖", () => {
    startCrawl().catch((error) => {
      logError("fatal", {
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
      updateStatus(`鎶撳彇澶辫触锛${error?.message || "鏈煡閿欒"}`, "error");
    });
  });

  GM_registerMenuCommand("鏆傚仠/鎭㈠鎶撳彇", () => {
    if (!state.running) {
      updateStatus("当前没有进行中的抓取任务。", "idle");
      return;
    }

    state.paused = !state.paused;
    updateStatus(state.paused ? "已暂停抓取。" : "已恢复抓取。", state.paused ? "warning" : "active");
  });

  GM_registerMenuCommand("切换抓取模式（只抓EP/全量）", () => {
    handleToggleModeFromPanel();
  });

  GM_registerMenuCommand("瀵煎嚭褰撳墠鎶撳彇鏃ュ織", async () => {
    if (!state.currentSubject) {
      updateStatus("当前没有可导出的抓取任务。", "idle");
      return;
    }

    if (state.subjectDirHandle) {
      await writeJsonFile("crawl-log.json", state.crawlLog);
      await writeJsonFile("manifest.json", state.manifest);
      await writeTextFile("manifest.csv", buildManifestCsv(state.manifest));
      updateStatus("已将当前日志写入导出目录。", "done");
      return;
    }

    downloadText(buildManifestCsv(state.manifest), `${state.currentSubject.slug}-manifest.csv`, "text/csv;charset=utf-8");
    downloadText(JSON.stringify(state.manifest, null, 2), `${state.currentSubject.slug}-manifest.json`, "application/json;charset=utf-8");
    downloadText(JSON.stringify(state.crawlLog, null, 2), `${state.currentSubject.slug}-crawl-log.json`, "application/json;charset=utf-8");
    updateStatus("已导出当前抓取日志。", "done");
  });

  async function startCrawl() {
    if (state.running) {
      updateStatus("抓取已在进行中。", "warning");
      return;
    }

    const subject = extractSubjectMeta(document, location.href);
    if (!subject) {
      throw new Error("当前页面不是可识别的 Bangumi 条目页。");
    }

    resetState();
    state.running = true;
    state.currentSubject = subject;
    markProgress();
    updateStatus(`正在准备导出目录：${subject.title}`, "active");

    await setupExportHandles(subject);
    const startPageType = classifyPageType(location.href);
    if (isEpOnlyMode() && startPageType === "subject") {
      const seededEpisodeUrls = collectEpisodeUrlsFromSubjectDoc(document, subject.id, location.href);
      for (const episodeUrl of seededEpisodeUrls) {
        enqueuePage(episodeUrl);
      }
      if (seededEpisodeUrls.length === 0) {
        enqueuePage(location.href);
      }
    } else {
      enqueuePage(location.href);
      // 作品页启动时，强制把可见的单集链接全部作为种子页入队，避免漏抓 ep。
      const seededEpisodeUrls = collectEpisodeUrlsFromSubjectDoc(document, subject.id, location.href);
      for (const episodeUrl of seededEpisodeUrls) {
        enqueuePage(episodeUrl);
      }
    }
    updateStatus(`开始抓取《${subject.title}》相关页面…`, "active");

    while (state.pageQueue.length > 0) {
      await waitIfPaused();
      maybeAutoRecoverStall();
      const pageUrl = state.pageQueue.shift();
      if (!pageUrl) {
        continue;
      }

      try {
        await processPageWithTimeout(pageUrl);
        state.pageAttemptMap.delete(pageUrl);
        state.pageErrorStreak = 0;
        state.processedPages += 1;
        markProgress();
        renderPanel();
      } catch (error) {
        if (error instanceof PauseError) {
          state.pageQueue.unshift(pageUrl);
          renderPanel();
          continue;
        }

        if (error instanceof PageProcessTimeoutError) {
          const attempts = (state.pageAttemptMap.get(pageUrl) || 0) + 1;
          state.pageAttemptMap.set(pageUrl, attempts);
          logError("page_timeout", {
            pageUrl,
            attempts,
            message: error.message,
          });
          if (attempts <= PAGE_MAX_RETRIES) {
            state.pageQueue.push(pageUrl);
            updateStatus(`页面超时，已自动重试 (${attempts}/${PAGE_MAX_RETRIES})`, "warning");
          } else {
            updateStatus("页面多次超时，已自动跳过并继续。", "warning");
          }
          renderPanel();
          continue;
        }

        state.pageErrorStreak += 1;
        logError("page", {
          pageUrl,
          message: error?.message || String(error),
          stack: error?.stack || null,
        });

        if (state.pageErrorStreak >= MAX_PAGE_ERROR_STREAK) {
          state.paused = true;
          updateStatus("连续页面异常，已自动暂停，请检查后继续。", "error");
          GM_notification({
            title: "Bangumi 抓图已暂停",
            text: "连续页面异常，脚本已暂停。请检查日志后在菜单里恢复。",
            timeout: 8000,
          });
          throw new Error("连续页面异常，任务已暂停。");
        }
      }

      const [delayMin, delayMax] = getPageDelayRange();
      await randomDelay(delayMin, delayMax);
    }

    await finalizeExport();
    state.running = false;
    updateStatus(`抓取完成，共保存 ${state.manifest.length} 条图片记录。`, "done");
    GM_notification({
      title: "Bangumi 鎶撳浘瀹屾垚",
      text: `《${state.currentSubject.title}》抓取完成，共保存 ${state.manifest.length} 条记录。`,
      timeout: 8000,
    });
  }

  function resetState() {
    state.running = false;
    state.paused = false;
    state.pageQueue = [];
    state.seenPages = new Set();
    state.seenImageUrls = new Set();
    state.seenImageHashes = new Map();
    state.manifest = [];
    state.crawlLog = [];
    state.pageErrorStreak = 0;
    state.currentSubject = null;
    state.exportHandle = null;
    state.subjectDirHandle = null;
    state.imageDirHandle = null;
    state.imageCounter = 0;
    state.filteredImages = 0;
    state.processedPages = 0;
    revokePreviewList(state.recentAcceptedPreviews);
    revokePreviewList(state.recentFilteredPreviews);
    state.recentAcceptedPreviews = [];
    state.recentFilteredPreviews = [];
    state.manualIncludedPreviewIds = new Set();
    state.manualIncludeInFlightIds = new Set();
    state.imageHostFailures = new Map();
    state.pageAttemptMap = new Map();
    state.statusText = "待命";
    state.statusKind = "idle";
    state.panelScrollTop = 0;
    state.lastProgressAt = Date.now();
  }

  async function setupExportHandles(subject) {
    const supportsFsApi = typeof window.showDirectoryPicker === "function";
    if (!supportsFsApi) {
      updateStatus("当前浏览器不支持目录写入，将在结束时导出 manifest 文件。", "warning");
      return;
    }

    const rootHandle = await window.showDirectoryPicker({
      mode: "readwrite",
      startIn: "downloads",
    });
    state.exportHandle = rootHandle;
    const exportRoot = await getOrCreateDir(rootHandle, EXPORT_ROOT);
    state.subjectDirHandle = await getOrCreateDir(exportRoot, `subject-${subject.id}-${subject.slug}`);
    state.imageDirHandle = await getOrCreateDir(state.subjectDirHandle, IMAGE_DIR);
  }

  async function processPage(pageUrl) {
    updateStatus(`鎶撳彇椤甸潰锛${pageUrl}`, "active");

    const html = pageUrl === location.href ? document.documentElement.outerHTML : await fetchHtml(pageUrl);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const pageSubject = extractSubjectMeta(doc, pageUrl) || state.currentSubject;
    if (!pageSubject || pageSubject.id !== state.currentSubject.id) {
      return;
    }

    discoverLinksFromDocument(doc, pageUrl, pageSubject.id).forEach(enqueuePage);
    const imageCandidates = extractImageCandidatesFromDocument(doc, pageUrl);
    if (imageCandidates.length === 0) {
      return;
    }

    await downloadImageCandidates(imageCandidates, pageSubject);
  }

  async function processPageWithTimeout(pageUrl) {
    return withTimeout(processPage(pageUrl), PAGE_PROCESS_TIMEOUT_MS, () => new PageProcessTimeoutError(pageUrl));
  }

  async function withTimeout(promise, timeoutMs, createError) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(createError ? createError() : new Error("Timed out"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  function markProgress() {
    state.lastProgressAt = Date.now();
  }

  function maybeAutoRecoverStall() {
    if (!state.running || state.paused) {
      return;
    }
    const now = Date.now();
    if (now - state.lastProgressAt < STALL_AUTO_RESET_MS) {
      return;
    }
    const dropped = state.pageQueue.shift();
    if (dropped) {
      logError("stall_recover", {
        action: "drop_stalled_page",
        droppedPage: dropped,
        queueLength: state.pageQueue.length,
      });
      updateStatus("检测到长时间无进度，已自动跳过一个卡住页面继续。", "warning");
      markProgress();
      renderPanel();
    }
  }

  function getPageDelayRange() {
    if (isEpOnlyMode()) {
      return [EP_ONLY_MIN_PAGE_DELAY_MS, EP_ONLY_MAX_PAGE_DELAY_MS];
    }
    return [MIN_PAGE_DELAY_MS, MAX_PAGE_DELAY_MS];
  }

  async function downloadImageCandidates(candidates, subject) {
    let index = 0;
    const workers = Array.from({ length: IMAGE_DOWNLOAD_CONCURRENCY }, async () => {
      while (index < candidates.length) {
        const current = candidates[index++];
        if (!current) {
          return;
        }

        await waitIfPaused();

        try {
          await processImageCandidate(current, subject);
        } catch (error) {
          logError("image", {
            imageUrl: current.imageUrl,
            postUrl: current.postUrl,
            message: error?.message || String(error),
            stack: error?.stack || null,
          });
        }
      }
    });

    await Promise.all(workers);
  }

  async function processImageCandidate(candidate, subject, options = {}) {
    const bypassQuality = Boolean(options?.bypassQuality);
    const forceInclude = Boolean(options?.forceInclude);
    const normalizedUrl = normalizeImageUrl(candidate.imageUrl);
    if (!normalizedUrl || (state.seenImageUrls.has(normalizedUrl) && !forceInclude)) {
      return;
    }

    if (isImageHostTemporarilyBlocked(normalizedUrl) && !forceInclude) {
      return;
    }

    state.seenImageUrls.add(normalizedUrl);
    let imageResult;
    try {
      imageResult = await downloadImageWithRetries(normalizedUrl, MAX_IMAGE_DOWNLOAD_RETRIES);
      clearImageHostFailure(normalizedUrl);
    } catch (error) {
      noteImageHostFailure(normalizedUrl, error);
      throw error;
    }
    const quality = await inspectImageQuality(imageResult.buffer, imageResult.mimeType);

    if (!quality.ok && !bypassQuality) {
      state.filteredImages += 1;
      pushPreviewRecord(
        "recentFilteredPreviews",
        createPreviewRecord(imageResult.buffer, imageResult.mimeType, candidate, subject, quality, {
          badge: "已过滤",
          reason: getQualityReasonLabel(quality.rejectReason),
          canInclude: true,
        }),
      );
      logError("image_filtered", {
        pageUrl: candidate.pageUrl,
        postUrl: candidate.postUrl,
        pageType: candidate.pageType,
        imageUrl: normalizedUrl,
        reason: quality.rejectReason,
        width: quality.width ?? null,
        height: quality.height ?? null,
        bytes: quality.bytes ?? imageResult.buffer.byteLength,
        aspectRatio: quality.aspectRatio ?? null,
        clarityScore: quality.clarityScore ?? null,
      });
      markProgress();
      renderPanel();
      return;
    }

    const imageHash = await sha256Hex(imageResult.buffer);
    const qualityForManifest = quality?.ok
      ? quality
      : {
          ok: true,
          bytes: quality?.bytes ?? imageResult.buffer.byteLength,
          width: quality?.width ?? null,
          height: quality?.height ?? null,
          area: quality?.area ?? null,
          aspectRatio: quality?.aspectRatio ?? null,
          clarityScore: quality?.clarityScore ?? null,
        };

    if (state.seenImageHashes.has(imageHash)) {
      const existingPath = state.seenImageHashes.get(imageHash);
      state.manifest.push(
        buildManifestEntry(candidate, subject, normalizedUrl, existingPath, imageResult.ext, imageHash, qualityForManifest)
      );
      pushPreviewRecord(
        "recentAcceptedPreviews",
        createPreviewRecord(imageResult.buffer, imageResult.mimeType, candidate, subject, qualityForManifest, {
          badge: forceInclude ? "手动收录" : "重复图",
        })
      );
      markProgress();
      renderPanel();
      return;
    }

    const fileName = `${String(++state.imageCounter).padStart(6, "0")}.${imageResult.ext}`;
    const imageSavedPath = `${IMAGE_DIR}/${fileName}`;
    state.seenImageHashes.set(imageHash, imageSavedPath);

    if (state.imageDirHandle) {
      await writeBinaryFile(state.imageDirHandle, fileName, imageResult.buffer);
    } else {
      downloadBinary(imageResult.buffer, fileName, imageResult.mimeType);
    }

    state.manifest.push(
      buildManifestEntry(candidate, subject, normalizedUrl, imageSavedPath, imageResult.ext, imageHash, qualityForManifest)
    );
    pushPreviewRecord(
      "recentAcceptedPreviews",
      createPreviewRecord(imageResult.buffer, imageResult.mimeType, candidate, subject, qualityForManifest, {
        badge: forceInclude ? "手动收录" : "已保存",
      })
    );
    markProgress();
    renderPanel();
  }

  async function inspectImageQuality(buffer, mimeType) {
    const bytes = buffer.byteLength;
    if (bytes < MIN_IMAGE_BYTES) {
      return rejectImageQuality("too_small_bytes", { bytes });
    }

    let decoded;
    try {
      decoded = await decodeImageBinary(buffer, mimeType);
    } catch (error) {
      return rejectImageQuality("decode_failed", {
        bytes,
        message: error?.message || String(error),
      });
    }

    const { width, height, metrics } = decoded;
    const area = width * height;
    const aspectRatio = width / height;
    const clarityScore = metrics.clarityScore;

    if (width < MIN_IMAGE_WIDTH) {
      return rejectImageQuality("too_narrow", { bytes, width, height, area, aspectRatio, clarityScore });
    }

    if (height < MIN_IMAGE_HEIGHT) {
      return rejectImageQuality("too_short", { bytes, width, height, area, aspectRatio, clarityScore });
    }

    if (area < MIN_IMAGE_AREA) {
      return rejectImageQuality("too_small_area", { bytes, width, height, area, aspectRatio, clarityScore });
    }

    if (aspectRatio < MIN_IMAGE_ASPECT_RATIO || aspectRatio > MAX_IMAGE_ASPECT_RATIO) {
      return rejectImageQuality("bad_aspect_ratio", { bytes, width, height, area, aspectRatio, clarityScore });
    }

    if (clarityScore < MIN_IMAGE_EDGE_SCORE) {
      return rejectImageQuality("too_blurry", { bytes, width, height, area, aspectRatio, clarityScore });
    }

    return {
      ok: true,
      bytes,
      width,
      height,
      area,
      aspectRatio: roundQualityNumber(aspectRatio, 4),
      clarityScore: roundQualityNumber(clarityScore, 3),
    };
  }

  function rejectImageQuality(reason, details = {}) {
    return {
      ok: false,
      rejectReason: reason,
      bytes: details.bytes ?? null,
      width: details.width ?? null,
      height: details.height ?? null,
      area: details.area ?? null,
      aspectRatio: details.aspectRatio ?? null,
      clarityScore: details.clarityScore ?? null,
      message: details.message ?? null,
    };
  }

  async function decodeImageBinary(buffer, mimeType) {
    const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    let drawable = null;
    let cleanup = null;

    try {
      if (typeof createImageBitmap === "function") {
        drawable = await createImageBitmap(blob);
        cleanup = () => drawable.close?.();
      } else {
        drawable = await loadImageElementFromBlob(blob);
        cleanup = () => URL.revokeObjectURL(drawable.__objectUrl);
      }

      const naturalWidth = drawable.width || drawable.naturalWidth || 0;
      const naturalHeight = drawable.height || drawable.naturalHeight || 0;
      if (!naturalWidth || !naturalHeight) {
        throw new Error("decoded image has no size");
      }

      const metrics = extractImageMetricsFromDrawable(drawable, naturalWidth, naturalHeight);
      return {
        width: naturalWidth,
        height: naturalHeight,
        metrics,
      };
    } finally {
      cleanup?.();
    }
  }

  function loadImageElementFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = "async";
      image.__objectUrl = objectUrl;
      image.onload = () => resolve(image);
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("image element failed to load"));
      };
      image.src = objectUrl;
    });
  }

  function extractImageMetricsFromDrawable(drawable, width, height) {
    const scale = Math.min(1, QUALITY_SAMPLE_MAX_EDGE / Math.max(width, height));
    const sampleWidth = Math.max(1, Math.round(width * scale));
    const sampleHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      throw new Error("canvas 2d context unavailable");
    }

    context.drawImage(drawable, 0, 0, sampleWidth, sampleHeight);
    const imageData = context.getImageData(0, 0, sampleWidth, sampleHeight);
    const clarityScore = computeEdgeScore(imageData.data, sampleWidth, sampleHeight);
    return {
      sampleWidth,
      sampleHeight,
      clarityScore,
    };
  }

  function computeEdgeScore(pixels, width, height) {
    if (width < 2 || height < 2) {
      return 0;
    }

    let totalDifference = 0;
    let comparisons = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;

        if (x + 1 < width) {
          const rightIndex = index + 4;
          const rightLuminance =
            pixels[rightIndex] * 0.299 + pixels[rightIndex + 1] * 0.587 + pixels[rightIndex + 2] * 0.114;
          totalDifference += Math.abs(luminance - rightLuminance);
          comparisons += 1;
        }

        if (y + 1 < height) {
          const bottomIndex = index + width * 4;
          const bottomLuminance =
            pixels[bottomIndex] * 0.299 + pixels[bottomIndex + 1] * 0.587 + pixels[bottomIndex + 2] * 0.114;
          totalDifference += Math.abs(luminance - bottomLuminance);
          comparisons += 1;
        }
      }
    }

    return comparisons ? totalDifference / comparisons : 0;
  }

  function roundQualityNumber(value, digits = 2) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }

    return Number(value.toFixed(digits));
  }

  async function finalizeExport() {
    const manifestCsv = buildManifestCsv(state.manifest);

    if (state.subjectDirHandle) {
      await writeTextFile("manifest.csv", manifestCsv);
      await writeJsonFile("manifest.json", state.manifest);
      await writeJsonFile("crawl-log.json", state.crawlLog);
      return;
    }

    const baseName = `${state.currentSubject.slug}-${Date.now()}`;
    downloadText(manifestCsv, `${baseName}-manifest.csv`, "text/csv;charset=utf-8");
    downloadText(JSON.stringify(state.manifest, null, 2), `${baseName}-manifest.json`, "application/json;charset=utf-8");
    downloadText(JSON.stringify(state.crawlLog, null, 2), `${baseName}-crawl-log.json`, "application/json;charset=utf-8");
  }

  function extractSubjectMeta(doc, pageUrl) {
    const idMatch = pageUrl.match(/\/subject\/(\d+)/);
    let id = idMatch?.[1] || null;
    if (!id) {
      const anchors = Array.from(doc.querySelectorAll("a[href]"));
      for (const anchor of anchors) {
        const href = anchor.getAttribute("href") || "";
        const matched = href.match(/\/subject\/(\d+)/);
        if (matched?.[1]) {
          id = matched[1];
          break;
        }
      }
    }
    if (!id) {
      return null;
    }

    const titleNode = doc.querySelector(
      "h1.nameSingle a, h1.nameSingle, #headerSubject h1 a, #headerSubject h1, #columnEpA h1 a, #columnEpA h1"
    );
    const title = cleanText(titleNode?.textContent) || `subject-${id}`;
    const slug = slugify(title || id);
    return { id, title, slug };
  }

  function classifyPageType(url) {
    for (const entry of PAGE_TYPE_PATTERNS) {
      if (entry.pattern.test(url)) {
        return entry.type;
      }
    }
    return "unknown";
  }

  function discoverLinksFromDocument(doc, pageUrl, subjectId) {
    if (isEpOnlyMode() && classifyPageType(pageUrl) === "episode") {
      return new Set();
    }

    const links = new Set();
    const currentPageType = classifyPageType(pageUrl);
    const anchors = Array.from(doc.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      if (isInsideUserContent(anchor) || anchor.closest(NON_CONTENT_ANCESTOR_SELECTORS.join(","))) {
        continue;
      }

      const href = anchor.getAttribute("href");
      const absolute = normalizePageUrl(href, pageUrl);
      if (!absolute) {
        continue;
      }

      if (!isAllowedInScope(absolute, subjectId, currentPageType)) {
        continue;
      }

      if (/(?:page=\d+|topic|blog|review|comment|comments|board|ep\/|\/ep\/)/i.test(absolute) || absolute.includes(`/subject/${subjectId}`)) {
        links.add(absolute);
      }
    }

    return links;
  }

  function collectEpisodeUrlsFromSubjectDoc(doc, subjectId, baseUrl) {
    const result = new Set();
    const seenEpisodeIds = new Set();
    const selectors = [
      "#subject_detail .prg_list a[href*='/ep/']",
      "#subject_detail a[href*='/ep/']",
      "#subjectPanelIndex a[href*='/ep/']",
      ".load-epinfo a[href*='/ep/']",
      "a[href*='/ep/']",
    ];

    for (const selector of selectors) {
      for (const anchor of doc.querySelectorAll(selector)) {
        const href = anchor.getAttribute("href");
        const absolute = normalizePageUrl(href, baseUrl);
        if (!absolute) {
          continue;
        }
        if (!/\/ep\/\d+/.test(absolute)) {
          continue;
        }
        if (!isAllowedInScope(absolute, subjectId, "subject")) {
          continue;
        }
        const epMatch = absolute.match(/\/ep\/(\d+)/);
        const epId = epMatch?.[1];
        if (!epId || seenEpisodeIds.has(epId)) {
          continue;
        }
        seenEpisodeIds.add(epId);
        result.add(canonicalizeEpisodeUrl(absolute));
      }
    }

    return Array.from(result);
  }

  function extractImageCandidatesFromDocument(doc, pageUrl) {
    const pageType = classifyPageType(pageUrl);
    let scopes = collectContentScopes(doc, pageUrl, pageType);
    if (scopes.length === 0) {
      scopes = collectFallbackContentScopes(doc);
    }
    const candidates = [];
    const seenCandidateUrls = new Set();

    const pushCandidate = (candidate, imageUrl) => {
      if (!imageUrl) {
        return;
      }
      const normalized = normalizeImageUrl(imageUrl, pageUrl);
      if (!normalized || seenCandidateUrls.has(normalized)) {
        return;
      }
      seenCandidateUrls.add(normalized);
      candidates.push({
        ...candidate,
        imageUrl: normalized,
      });
    };

    for (const scope of scopes) {
      const postMeta = extractPostMeta(scope, pageUrl, pageType);
      const candidateBase = {
        pageType: classifyPageType(pageUrl),
        pageUrl,
        postUrl: postMeta.postUrl,
        postAuthor: postMeta.postAuthor,
        postTime: postMeta.postTime,
      };
      const mediaNodes = Array.from(scope.querySelectorAll("img, picture source"));

      for (const mediaNode of mediaNodes) {
        const imageUrl = extractImageUrlFromNode(mediaNode, pageUrl);
        if (!imageUrl || isIgnoredImage(imageUrl, mediaNode)) {
          continue;
        }
        pushCandidate(candidateBase, imageUrl);
      }

      // 补充：很多 Bangumi 页面把原图放在链接里（非 img src）。
      const imageAnchors = Array.from(scope.querySelectorAll("a[href]"));
      for (const anchor of imageAnchors) {
        const href = anchor.getAttribute("href");
        if (!href) {
          continue;
        }
        const normalizedHref = normalizeImageUrl(href, pageUrl);
        if (!normalizedHref) {
          continue;
        }
        if (!/\.(?:jpe?g|png|gif|webp|avif)(?:[?#].*)?$/i.test(normalizedHref)) {
          continue;
        }
        if (isIgnoredImage(normalizedHref, anchor)) {
          continue;
        }
        pushCandidate(candidateBase, normalizedHref);
      }

      // 补充：部分站点把大图放在 data-original / data-zoom 属性里。
      const datasetNodes = Array.from(scope.querySelectorAll("[data-original], [data-zoom], [data-src]"));
      for (const node of datasetNodes) {
        const attrs = [
          node.getAttribute("data-original"),
          node.getAttribute("data-zoom"),
          node.getAttribute("data-src"),
        ];
        for (const value of attrs) {
          const normalizedValue = normalizeImageUrl(value, pageUrl);
          if (!normalizedValue) {
            continue;
          }
          if (isIgnoredImage(normalizedValue, node)) {
            continue;
          }
          pushCandidate(candidateBase, normalizedValue);
        }
      }

      // 补充：背景图容器（background-image:url(...)）。
      const bgNodes = Array.from(scope.querySelectorAll("[style*='background-image']"));
      for (const bgNode of bgNodes) {
        const styleValue = bgNode.getAttribute("style") || "";
        const matches = Array.from(styleValue.matchAll(/url\((['"]?)(.*?)\1\)/gi));
        for (const match of matches) {
          const raw = match?.[2];
          const normalizedBg = normalizeImageUrl(raw, pageUrl);
          if (!normalizedBg) {
            continue;
          }
          if (isIgnoredImage(normalizedBg, bgNode)) {
            continue;
          }
          pushCandidate(candidateBase, normalizedBg);
        }
      }
    }

    if (pageType === "episode" && isEpOnlyMode()) {
      const episodeWideCandidates = extractEpisodeWideImageCandidates(doc, pageUrl);
      for (const candidate of episodeWideCandidates) {
        pushCandidate(candidate, candidate.imageUrl);
      }
    }

    return candidates;
  }

  function extractEpisodeWideImageCandidates(doc, pageUrl) {
    const roots = collectEpisodeImageRoots(doc);
    const result = [];
    const seen = new Set();
    const pageMeta = {
      pageType: "episode",
      pageUrl,
      postUrl: pageUrl,
      postAuthor: "",
      postTime: "",
    };

    const pushUrl = (rawUrl, node) => {
      const normalized = normalizeImageUrl(rawUrl, pageUrl);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      if (isIgnoredImage(normalized, node)) {
        return;
      }
      seen.add(normalized);
      result.push({
        ...pageMeta,
        imageUrl: normalized,
      });
    };

    for (const root of roots) {
      const mediaNodes = root.querySelectorAll("img, picture source");
      for (const mediaNode of mediaNodes) {
        pushUrl(extractImageUrlFromNode(mediaNode, pageUrl), mediaNode);

        const extraAttrs = [
          mediaNode.getAttribute?.("data-original"),
          mediaNode.getAttribute?.("data-full"),
          mediaNode.getAttribute?.("data-large"),
          mediaNode.getAttribute?.("data-zoom"),
          mediaNode.getAttribute?.("data-zoom-src"),
          mediaNode.getAttribute?.("data-file"),
        ];
        for (const attrValue of extraAttrs) {
          pushUrl(attrValue, mediaNode);
        }
      }

      const anchorNodes = root.querySelectorAll("a[href]");
      for (const anchorNode of anchorNodes) {
        const href = anchorNode.getAttribute("href");
        if (!href) {
          continue;
        }

        // Bangumi 常见截图链接基本都在 /pic/ 或直接图片扩展名上。
        if (
          /\/pic\//i.test(href) ||
          /\.(?:jpe?g|png|gif|webp|avif)(?:[?#].*)?$/i.test(href)
        ) {
          pushUrl(href, anchorNode);
        }
      }

      const bgNodes = root.querySelectorAll("[style*='background-image']");
      for (const bgNode of bgNodes) {
        const styleValue = bgNode.getAttribute("style") || "";
        const matches = Array.from(styleValue.matchAll(/url\((['"]?)(.*?)\1\)/gi));
        for (const match of matches) {
          pushUrl(match?.[2], bgNode);
        }
      }
    }

    return result;
  }

  function collectEpisodeImageRoots(doc) {
    const selectorList = [
      "#columnEpA",
      "#columnInSubjectA",
      "#columnA",
      "#subject_detail",
      ".episode",
      ".epDesc",
      ".blog_entry",
      ".topic_content",
      ".reply_content",
      "#comment_box",
      "main",
      "body",
    ];
    const roots = [];
    const seen = new Set();

    for (const selector of selectorList) {
      const node = doc.querySelector(selector);
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      if (seen.has(node)) {
        continue;
      }
      seen.add(node);
      roots.push(node);
    }

    if (roots.length === 0 && doc.body) {
      roots.push(doc.body);
    }

    return roots;
  }

  function extractPostMeta(scope, pageUrl, pageType) {
    const postContainer = getPostMetaRoot(scope, pageType);
    const postUrlNode = findFirstMatch(postContainer, getPostUrlSelectors(pageType));
    const authorNode = findFirstMatch(postContainer, getPostAuthorSelectors(pageType));
    const timeNode = findFirstMatch(postContainer, getPostTimeSelectors(pageType));
    return {
      postUrl: normalizePageUrl(postUrlNode?.getAttribute("href"), pageUrl) || pageUrl,
      postAuthor: cleanText(authorNode?.textContent),
      postTime: cleanText(timeNode?.textContent),
    };
  }

  function extractImageUrlFromNode(node, pageUrl) {
    if (node.tagName.toLowerCase() === "source") {
      const srcset = node.getAttribute("srcset");
      if (!srcset) {
        return null;
      }
      const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      return normalizeImageUrl(first, pageUrl);
    }

    const direct = node.getAttribute("src") || node.getAttribute("data-src") || node.getAttribute("data-cfsrc");
    return normalizeImageUrl(direct, pageUrl);
  }

  function isIgnoredImage(imageUrl, node) {
    if (!imageUrl) {
      return true;
    }

    if (UI_IMAGE_PATTERNS.some((pattern) => pattern.test(imageUrl))) {
      return true;
    }

    if (node.closest(NON_CONTENT_ANCESTOR_SELECTORS.join(","))) {
      return true;
    }

    const classSignature = [
      node.className || "",
      node.parentElement?.className || "",
      node.closest("a")?.className || "",
    ].join(" ");
    if (/(avatar|cover|icon|logo|smile|emoji|userimage|pictureframe|thumb|badge)/i.test(classSignature)) {
      return true;
    }

    const width = parseInt(node.getAttribute("width") || "0", 10);
    const height = parseInt(node.getAttribute("height") || "0", 10);
    if ((width && width <= SMALL_IMAGE_MAX_EDGE) || (height && height <= SMALL_IMAGE_MAX_EDGE)) {
      return true;
    }

    const alt = cleanText(node.getAttribute("alt"));
    if (alt && /(澶村儚|avatar|灏侀潰|cover|icon|emoji|logo)/i.test(alt)) {
      return true;
    }

    return false;
  }

  function isInsideUserContent(node) {
    return Boolean(node.closest(ALL_CONTENT_SCOPE_SELECTORS.join(",")));
  }

  function collectContentScopes(doc, pageUrl, pageType) {
    const scopes = [];
    const seen = new Set();
    const selectors = getContentScopeSelectors(doc, pageType);
    const postUrlSelectors = getPostUrlSelectors(pageType);
    for (const selector of selectors) {
      for (const scope of doc.querySelectorAll(selector)) {
        if (!(scope instanceof HTMLElement)) {
          continue;
        }

        if (scope.closest(NON_CONTENT_ANCESTOR_SELECTORS.join(","))) {
          continue;
        }

        if (!scope.querySelector("img, picture source")) {
          continue;
        }

        if (!isScopeAllowedForPageType(scope, pageType, pageUrl)) {
          continue;
        }

        const postContainer = getPostMetaRoot(scope, pageType);
        const key = normalizePageUrl(
          findFirstMatch(postContainer, postUrlSelectors)?.getAttribute("href"),
          pageUrl
        ) || `${scope.tagName}:${scope.className}:${cleanText(scope.textContent).slice(0, 60)}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        scopes.push(scope);
      }
    }

    return scopes;
  }

  function collectFallbackContentScopes(doc) {
    const roots = [];
    const seen = new Set();
    const selectors = [
      ".postTopic",
      ".topic_reply",
      ".topic_sub_reply",
      "#comment_box .item",
      "#comment_box .row_reply",
      ".row_reply",
      ".item",
      ".blog_main",
      "#entry_content",
      ".blog_entry",
      ".review_content",
    ];

    for (const selector of selectors) {
      for (const node of doc.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.closest(NON_CONTENT_ANCESTOR_SELECTORS.join(","))) {
          continue;
        }
        if (!node.querySelector("img, picture source")) {
          continue;
        }

        const key = `${node.tagName}:${node.className}:${cleanText(node.textContent).slice(0, 80)}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        roots.push(node);
      }
    }

    return roots;
  }

  function getContentScopeSelectors(doc, pageType) {
    const specific = uniqueSelectors(PAGE_TYPE_CONTENT_SCOPE_SELECTORS[pageType] || []);
    if (!specific.length) {
      return CONTENT_SCOPE_SELECTORS;
    }

    const hasSpecificMatches = specific.some((selector) => {
      try {
        return Boolean(doc.querySelector(selector));
      } catch (_error) {
        return false;
      }
    });

    return hasSpecificMatches ? specific : CONTENT_SCOPE_SELECTORS;
  }

  function getPostContainerSelectors(pageType) {
    return uniqueSelectors([
      ...(PAGE_TYPE_POST_CONTAINER_SELECTORS[pageType] || []),
      ...POST_CONTAINER_SELECTORS,
    ]);
  }

  function getPostUrlSelectors(pageType) {
    return uniqueSelectors([
      ...(PAGE_TYPE_POST_URL_SELECTORS[pageType] || []),
      ...DEFAULT_POST_URL_SELECTORS,
    ]);
  }

  function getPostAuthorSelectors(pageType) {
    return uniqueSelectors([
      ...(PAGE_TYPE_POST_AUTHOR_SELECTORS[pageType] || []),
      ...DEFAULT_POST_AUTHOR_SELECTORS,
    ]);
  }

  function getPostTimeSelectors(pageType) {
    return uniqueSelectors([
      ...(PAGE_TYPE_POST_TIME_SELECTORS[pageType] || []),
      ...DEFAULT_POST_TIME_SELECTORS,
    ]);
  }

  function getPostMetaRoot(scope, pageType) {
    if (pageType === "blog") {
      if (scope.matches("#entry_content") || scope.closest("#entry_content")) {
        return (
          scope.closest(".blog_main") ||
          scope.ownerDocument.querySelector(".blog_main") ||
          scope.closest("#entry_content") ||
          scope
        );
      }
    }

    return findClosestBySelectors(scope, getPostContainerSelectors(pageType)) || scope;
  }

  function isScopeAllowedForPageType(scope, pageType, pageUrl) {
    switch (pageType) {
      case "episode":
        return isEpisodeContentScope(scope, pageUrl);
      case "blog":
        return isBlogContentScope(scope, pageUrl);
      default:
        return true;
    }
  }

  function isEpisodeContentScope(scope, pageUrl) {
    if (isEpOnlyMode()) {
      const inKnownEpisodeBodyFast = Boolean(
        scope.closest(
          ".postTopic, .postTopic .topic_content, .topic_reply, .topic_reply .reply_content, .topic_reply .message, .topic_sub_reply, .topic_sub_reply .message, #comment_box .item, #comment_box .item .message, #comment_box .row_reply, #comment_box .row_reply .message, .cmt_sub_content"
        )
      );
      if (inKnownEpisodeBodyFast && scope.querySelector("img, picture source")) {
        return true;
      }
    }

    const container = findClosestBySelectors(scope, PAGE_TYPE_POST_CONTAINER_SELECTORS.episode);
    if (!container) {
      return false;
    }

    const inKnownEpisodeBody = Boolean(
      scope.closest(".postTopic .topic_content, .topic_reply .reply_content, .topic_reply .message, .topic_sub_reply .message, #comment_box .item .message, #comment_box .row_reply .message, .cmt_sub_content")
    );
    if (!inKnownEpisodeBody) {
      return false;
    }

    return hasPostSignals(container, "episode", pageUrl);
  }

  function isBlogContentScope(scope, pageUrl) {
    const inEntryBody = scope.matches("#entry_content") || Boolean(scope.closest("#entry_content"));
    if (inEntryBody) {
      const blogRoot = getPostMetaRoot(scope, "blog");
      return hasPostSignals(blogRoot, "blog", pageUrl);
    }

    const commentContainer = findClosestBySelectors(scope, [
      "#comment_box .item",
      "#comment_box .row_reply",
      ".topic_sub_reply",
    ]);
    if (!commentContainer) {
      return false;
    }

    const inKnownBlogCommentBody = Boolean(
      scope.closest("#comment_box .item .message, #comment_box .row_reply .message, #comment_box .item .cmt_sub_content, #comment_box .row_reply .cmt_sub_content, .topic_sub_reply .message, .cmt_sub_content")
    );
    if (!inKnownBlogCommentBody) {
      return false;
    }

    return hasPostSignals(commentContainer, "blog", pageUrl);
  }

  function hasPostSignals(root, pageType, pageUrl) {
    if (!(root instanceof Element)) {
      return false;
    }

    return Boolean(
      findFirstMatch(root, getPostUrlSelectors(pageType)) ||
      findFirstMatch(root, getPostAuthorSelectors(pageType)) ||
      findFirstMatch(root, getPostTimeSelectors(pageType)) ||
      normalizePageUrl(root.getAttribute("href"), pageUrl)
    );
  }

  function findClosestBySelectors(node, selectors) {
    for (const selector of selectors) {
      const matched = node.closest(selector);
      if (matched) {
        return matched;
      }
    }
    return null;
  }

  function findFirstMatch(root, selectors) {
    for (const selector of selectors) {
      const matched = root.querySelector(selector);
      if (matched) {
        return matched;
      }
    }
    return null;
  }

  function uniqueSelectors(selectors) {
    return Array.from(new Set(selectors.filter(Boolean)));
  }

  function enqueuePage(url) {
    const normalized = normalizePageUrl(url, location.href);
    if (!normalized || state.seenPages.has(normalized)) {
      return;
    }
    if (state.pageQueue.length >= MAX_PAGE_QUEUE) {
      return;
    }
    state.seenPages.add(normalized);
    state.pageQueue.push(normalized);
    renderPanel();
  }

  function isAllowedInScope(url, subjectId, currentPageType = "unknown") {
    if (!url.startsWith(SAME_ORIGIN)) {
      return false;
    }

    if (isEpOnlyMode()) {
      return /\/ep\/\d+/.test(url);
    }

    if (url.includes(`/subject/${subjectId}`)) {
      if (url.includes(`/subject/${subjectId}/comments`)) {
        if (!ENABLE_SUBJECT_COMMENTS_CRAWL) {
          return false;
        }
        const pageNo = getUrlPageNo(url);
        return pageNo <= MAX_COMMENT_PAGE;
      }
      if (url.includes(`/subject/${subjectId}/reviews`)) {
        if (!ENABLE_SUBJECT_REVIEWS_CRAWL) {
          return false;
        }
        const pageNo = getUrlPageNo(url);
        return pageNo <= MAX_REVIEW_PAGE;
      }
      return true;
    }
    if (/\/ep\/\d+/.test(url)) {
      return true;
    }
    if (/\/subject\/topic\/\d+/.test(url)) {
      return true;
    }
    if (/\/rakuen\/topic\/subject\/\d+/.test(url)) {
      return true;
    }

    // 避免从博客/讨论页无限外扩到站内无关页面，导致待抓队列膨胀。
    if (/\/blog\/\d+/.test(url)) {
      return currentPageType === "subject";
    }

    return false;
  }

  function getUrlPageNo(url) {
    try {
      const parsed = new URL(url, location.href);
      const page = Number(parsed.searchParams.get("page") || "1");
      return Number.isFinite(page) && page > 0 ? page : 1;
    } catch {
      return 1;
    }
  }

  function isEpOnlyMode() {
    return state.crawlMode === CRAWL_MODE_EP_ONLY;
  }

  function getImageHostKey(url) {
    try {
      return new URL(url, location.href).host;
    } catch {
      return "";
    }
  }

  function isImageHostTemporarilyBlocked(url) {
    const host = getImageHostKey(url);
    if (!host) {
      return false;
    }
    const record = state.imageHostFailures.get(host);
    if (!record?.blockedUntil) {
      return false;
    }
    if (Date.now() >= record.blockedUntil) {
      state.imageHostFailures.delete(host);
      return false;
    }
    return true;
  }

  function noteImageHostFailure(url, error) {
    const host = getImageHostKey(url);
    if (!host) {
      return;
    }
    const current = state.imageHostFailures.get(host) || { fails: 0, blockedUntil: 0 };
    const nextFails = (current.fails || 0) + 1;
    const shouldBlock = nextFails >= IMAGE_HOST_FAIL_THRESHOLD;
    const nextRecord = {
      fails: shouldBlock ? 0 : nextFails,
      blockedUntil: shouldBlock ? Date.now() + IMAGE_HOST_COOLDOWN_MS : 0,
    };
    state.imageHostFailures.set(host, nextRecord);
    if (shouldBlock) {
      logError("image_host_blocked", {
        host,
        cooldown_ms: IMAGE_HOST_COOLDOWN_MS,
        message: error?.message || String(error),
      });
    }
  }

  function clearImageHostFailure(url) {
    const host = getImageHostKey(url);
    if (!host) {
      return;
    }
    state.imageHostFailures.delete(host);
  }

  function readCrawlMode() {
    const value = localStorage.getItem(CRAWL_MODE_STORAGE_KEY);
    return value === CRAWL_MODE_ALL ? CRAWL_MODE_ALL : CRAWL_MODE_EP_ONLY;
  }

  function writeCrawlMode(mode) {
    localStorage.setItem(CRAWL_MODE_STORAGE_KEY, mode === CRAWL_MODE_ALL ? CRAWL_MODE_ALL : CRAWL_MODE_EP_ONLY);
  }

  async function fetchHtml(url) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), PAGE_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: abortController.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`页面请求超时（>${Math.round(PAGE_FETCH_TIMEOUT_MS / 1000)}s）`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`椤甸潰璇锋眰澶辫触锛${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    if (/(captcha|verify|登录|login)/i.test(html) && !html.includes("subject")) {
      throw new Error("页面可能出现登录失效或风控。");
    }
    return html;
  }

  async function downloadImageWithRetries(url, retries) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await gmDownloadBinary(url);
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await sleep(300 + attempt * 400);
        }
      }
    }
    throw lastError || new Error("鍥剧墖涓嬭浇澶辫触");
  }

  function gmDownloadBinary(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: IMAGE_REQUEST_TIMEOUT_MS,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`鍥剧墖璇锋眰澶辫触锛${response.status} ${response.statusText || ""}`.trim()));
            return;
          }

          const mimeType = response.responseHeaders
            ?.split(/\r?\n/)
            .find((line) => /^content-type:/i.test(line))
            ?.split(":")[1]
            ?.trim() || "application/octet-stream";
          const ext = inferExtension(url, mimeType);
          resolve({
            buffer: response.response,
            mimeType,
            ext,
          });
        },
        onerror(error) {
          reject(new Error(error?.error || "鍥剧墖涓嬭浇澶辫触"));
        },
        ontimeout() {
          reject(new Error(`图片下载超时（>${Math.round(IMAGE_REQUEST_TIMEOUT_MS / 1000)}s）`));
        },
      });
    });
  }

  function inferExtension(url, mimeType) {
    if (mimeType.includes("jpeg")) {
      return "jpg";
    }
    if (mimeType.includes("png")) {
      return "png";
    }
    if (mimeType.includes("webp")) {
      return "webp";
    }
    if (mimeType.includes("gif")) {
      return "gif";
    }
    const match = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
    return match ? match[1].toLowerCase() : "bin";
  }

  function buildManifestEntry(candidate, subject, originalUrl, savedPath, ext, imageHash, quality) {
    return {
      subject_id: subject.id,
      subject_title: subject.title,
      page_type: candidate.pageType,
      page_url: candidate.pageUrl,
      post_url: candidate.postUrl,
      post_author: candidate.postAuthor,
      post_time: candidate.postTime,
      image_original_url: originalUrl,
      image_saved_path: savedPath,
      image_ext: ext,
      image_width: quality?.width ?? "",
      image_height: quality?.height ?? "",
      image_bytes: quality?.bytes ?? "",
      image_aspect_ratio: quality?.aspectRatio ?? "",
      image_clarity_score: quality?.clarityScore ?? "",
      image_hash: imageHash,
      crawl_time: new Date().toISOString(),
    };
  }

  function buildManifestCsv(entries) {
    const headers = [
      "subject_id",
      "subject_title",
      "page_type",
      "page_url",
      "post_url",
      "post_author",
      "post_time",
        "image_original_url",
        "image_saved_path",
        "image_ext",
        "image_width",
        "image_height",
        "image_bytes",
        "image_aspect_ratio",
        "image_clarity_score",
        "image_hash",
        "crawl_time",
      ];

    const rows = entries.map((entry) =>
      headers
        .map((key) => csvEscape(entry[key] ?? ""))
        .join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  }

  async function writeBinaryFile(dirHandle, fileName, buffer) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
  }

  async function writeTextFile(fileName, content) {
    const fileHandle = await state.subjectDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async function writeJsonFile(fileName, data) {
    await writeTextFile(fileName, JSON.stringify(data, null, 2));
  }

  async function getOrCreateDir(parentHandle, dirName) {
    return parentHandle.getDirectoryHandle(dirName, { create: true });
  }

  async function waitIfPaused() {
    while (state.paused) {
      updateStatus("抓取已暂停，等待恢复…", "warning");
      await sleep(500);
    }
    if (!state.running) {
      throw new PauseError("抓取任务已暂停。");
    }
  }

  function logError(type, payload) {
    state.crawlLog.push({
      type,
      ...payload,
      time: new Date().toISOString(),
    });
    renderPanel();
  }

  function updateStatus(text, kind) {
    state.statusText = text;
    state.statusKind = kind || "idle";
    renderPanel();

    let root = document.getElementById(STATUS_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = STATUS_ID;
      root.style.position = "fixed";
      root.style.right = "16px";
      root.style.bottom = "16px";
      root.style.zIndex = "2147483647";
      root.style.maxWidth = "360px";
      root.style.padding = "12px 14px";
      root.style.borderRadius = "12px";
      root.style.fontSize = "13px";
      root.style.lineHeight = "1.5";
      root.style.boxShadow = "0 18px 40px rgba(0,0,0,.25)";
      root.style.backdropFilter = "blur(8px)";
      root.style.color = "#fff";
      root.style.pointerEvents = "none";
      document.body.appendChild(root);
    }

    const palette = {
      idle: "rgba(83, 93, 119, 0.88)",
      active: "rgba(57, 112, 212, 0.88)",
      warning: "rgba(204, 135, 34, 0.9)",
      error: "rgba(171, 46, 69, 0.92)",
      done: "rgba(39, 125, 82, 0.9)",
    };
    root.style.background = palette[kind] || palette.idle;
    root.textContent = text;
  }

  function readPanelCollapsed() {
    try {
      return localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setPanelCollapsed(next) {
    state.panelCollapsed = next;
    try {
      localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage write failures.
    }
    renderPanel();
  }

  function readPanelPosition() {
    try {
      const raw = localStorage.getItem(PANEL_POSITION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
        return null;
      }
      return {
        left: parsed.left,
        top: parsed.top,
      };
    } catch {
      return null;
    }
  }

  function clampPanelPosition(position, root) {
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) {
      return null;
    }
    const width = root?.offsetWidth || 328;
    const height = root?.offsetHeight || 220;
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const maxTop = Math.max(12, window.innerHeight - height - 12);
    return {
      left: Math.min(Math.max(12, position.left), maxLeft),
      top: Math.min(Math.max(12, position.top), maxTop),
    };
  }

  function applyPanelPosition(root) {
    const normalized = clampPanelPosition(state.panelPosition, root);
    if (normalized) {
      root.style.left = `${normalized.left}px`;
      root.style.top = `${normalized.top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      state.panelPosition = normalized;
      return;
    }
    root.style.top = "18px";
    root.style.right = "18px";
    root.style.left = "auto";
    root.style.bottom = "auto";
  }

  function setPanelPosition(next) {
    const normalized = clampPanelPosition(next);
    state.panelPosition = normalized;
    try {
      if (normalized) {
        localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify(normalized));
      } else {
        localStorage.removeItem(PANEL_POSITION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage write failures.
    }
    const root = document.getElementById(PANEL_ID);
    if (root) {
      applyPanelPosition(root);
    }
  }

  function attachPanelDrag(root) {
    if (!root || root.dataset.dragBound === "1") {
      return;
    }
    root.dataset.dragBound = "1";

    let dragging = null;

    const stopDragging = () => {
      if (!dragging) {
        return;
      }
      if (dragging.current) {
        setPanelPosition(dragging.current);
      }
      dragging = null;
      root.style.cursor = "";
    };

    root.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("[data-drag-handle='panel']");
      if (!handle) {
        return;
      }
      if (event.target.closest("button,a,input,textarea,select,label")) {
        return;
      }
      const rect = root.getBoundingClientRect();
      dragging = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        current: {
          left: rect.left,
          top: rect.top,
        },
      };
      root.style.cursor = "grabbing";
      if (typeof root.setPointerCapture === "function") {
        root.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    });

    root.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      const next = clampPanelPosition(
        {
          left: event.clientX - dragging.offsetX,
          top: event.clientY - dragging.offsetY,
        },
        root,
      );
      if (!next) {
        return;
      }
      dragging.current = next;
      root.style.left = `${next.left}px`;
      root.style.top = `${next.top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    });

    root.addEventListener("pointerup", stopDragging);
    root.addEventListener("pointercancel", stopDragging);
    window.addEventListener("resize", () => applyPanelPosition(root));
  }

  function getStatusLabel(kind) {
    const labels = {
      idle: "待命",
      active: "运行中",
      warning: "已暂停",
      error: "异常",
      done: "完成",
    };
    return labels[kind] || "待命";
  }

  function getStatusBadgeStyle(kind) {
    const styles = {
      idle: "background:#edf2ff;color:#46507a;",
      active: "background:#e2efff;color:#2754a6;",
      warning: "background:#fff1d6;color:#9b5b00;",
      error: "background:#ffe3e6;color:#a13a4f;",
      done: "background:#dff4ea;color:#1f7a57;",
    };
    return styles[kind] || styles.idle;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function revokePreviewRecord(record) {
    if (!record?.previewUrl) {
      return;
    }
    if (record.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(record.previewUrl);
    }
  }

  function revokePreviewList(records) {
    (records || []).forEach(revokePreviewRecord);
  }

  function getQualityReasonLabel(reason) {
    const labels = {
      too_small_bytes: "文件过小",
      decode_failed: "解码失败",
      too_narrow: "宽度不足",
      too_short: "高度不足",
      too_small_area: "面积过小",
      bad_aspect_ratio: "比例异常",
      too_blurry: "清晰度不足",
    };
    return labels[reason] || "质量不达标";
  }

  function formatPreviewMeta(quality) {
    const parts = [];
    if (quality?.width && quality?.height) {
      parts.push(`${quality.width}×${quality.height}`);
    }
    if (Number.isFinite(quality?.bytes)) {
      parts.push(`${Math.max(1, Math.round(quality.bytes / 1024))} KB`);
    }
    if (Number.isFinite(quality?.clarityScore)) {
      parts.push(`清晰度 ${quality.clarityScore.toFixed(2)}`);
    }
    return parts.join(" · ");
  }

  function createPreviewRecord(buffer, mimeType, candidate, subject, quality, extra = {}) {
    const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      previewUrl: URL.createObjectURL(blob),
      badge: extra.badge || "",
      reason: extra.reason || "",
      meta: formatPreviewMeta(quality),
      pageType: candidate?.pageType || "",
      pageUrl: candidate?.pageUrl || candidate?.postUrl || "",
      postUrl: candidate?.postUrl || candidate?.pageUrl || "",
      author: candidate?.postAuthor || "",
      subjectTitle: subject?.title || "",
      subjectId: subject?.id || "",
      imageUrl: candidate?.imageUrl || "",
      mimeType: mimeType || "application/octet-stream",
      ext: inferExtension(candidate?.imageUrl || "", mimeType || "application/octet-stream"),
      canInclude: Boolean(extra.canInclude),
    };
  }

  function findPreviewRecordById(previewId) {
    if (!previewId) {
      return null;
    }
    const merged = [...(state.recentFilteredPreviews || []), ...(state.recentAcceptedPreviews || [])];
    return merged.find((item) => item?.id === previewId) || null;
  }

  function removePreviewRecordById(previewId) {
    if (!previewId) {
      return;
    }

    const removeFrom = (list) => {
      if (!Array.isArray(list) || !list.length) {
        return list;
      }
      const next = [];
      for (const item of list) {
        if (item?.id === previewId) {
          revokePreviewRecord(item);
        } else {
          next.push(item);
        }
      }
      return next;
    };

    state.recentFilteredPreviews = removeFrom(state.recentFilteredPreviews);
    state.recentAcceptedPreviews = removeFrom(state.recentAcceptedPreviews);
  }

  async function includePreviewRecordById(previewId) {
    pinPanelScrollFromDom();
    const record = findPreviewRecordById(previewId);
    if (!record) {
      updateStatus("未找到可收录的预览记录。", "warning");
      return;
    }
    if (!record.imageUrl) {
      updateStatus("该记录缺少原图链接，无法手动收录。", "warning");
      return;
    }
    if (!state.currentSubject) {
      updateStatus("当前没有可写入的抓取任务。", "warning");
      return;
    }
    if (state.manualIncludedPreviewIds.has(previewId)) {
      updateStatus("该图片已手动收录，已跳过重复操作。", "warning");
      return;
    }
    if (state.manualIncludeInFlightIds.has(previewId)) {
      updateStatus("该图片正在收录中，请稍候。", "active");
      return;
    }

    const candidate = {
      pageType: record.pageType || "unknown",
      pageUrl: record.pageUrl || record.postUrl || location.href,
      postUrl: record.postUrl || record.pageUrl || location.href,
      postAuthor: record.author || "",
      postTime: "",
      imageUrl: record.imageUrl,
    };
    const subject = {
      id: state.currentSubject.id,
      title: state.currentSubject.title,
      slug: state.currentSubject.slug,
    };

    try {
      state.manualIncludeInFlightIds.add(previewId);
      await processImageCandidate(candidate, subject, { bypassQuality: true, forceInclude: true });
      state.manualIncludedPreviewIds.add(previewId);
      removePreviewRecordById(previewId);
      renderPanel();
      updateStatus("已手动收录该图片。", "done");
    } catch (error) {
      logError("manual_include_failed", {
        previewId,
        imageUrl: record.imageUrl,
        message: error?.message || String(error),
      });
      updateStatus("手动收录失败，请稍后重试。", "error");
    } finally {
      state.manualIncludeInFlightIds.delete(previewId);
    }
  }

  function getPreviewListLimit(key) {
    if (key === "recentFilteredPreviews") {
      return Number.POSITIVE_INFINITY;
    }
    if (key === "recentAcceptedPreviews") {
      return PANEL_ACCEPTED_PREVIEW_LIMIT;
    }
    return 20;
  }

  function pushPreviewRecord(key, record) {
    if (!record) {
      return;
    }
    const list = Array.isArray(state[key]) ? state[key].slice() : [];
    list.unshift(record);
    const limit = getPreviewListLimit(key);
    if (Number.isFinite(limit)) {
      while (list.length > limit) {
        const removed = list.pop();
        revokePreviewRecord(removed);
      }
    }
    state[key] = list;
  }

  function renderPreviewCard(record) {
    const meta = record?.meta ? `<div style="font-size:11px;color:#7a869e;">${escapeHtml(record.meta)}</div>` : "";
    const reason = record?.reason ? `<div style="font-size:11px;color:#b04b4b;">${escapeHtml(record.reason)}</div>` : "";
    const badge = record?.badge
      ? `<span style="padding:4px 8px;border-radius:999px;background:#fff2e2;color:#8d4d11;font-size:11px;font-weight:700;">${escapeHtml(record.badge)}</span>`
      : "";
    const author = record?.author ? ` · ${escapeHtml(record.author)}` : "";
    const pageType = record?.pageType ? escapeHtml(record.pageType) : "page";
    const sourceUrl = escapeHtml(record?.postUrl || record?.pageUrl || record?.imageUrl || "");
    const includeButton = record?.canInclude
      ? `
            <button
              type="button"
              data-action="preview-include"
              data-preview-id="${escapeHtml(record.id)}"
              style="border:0;border-radius:8px;padding:4px 8px;background:#dff4ea;color:#1f7a57;font-size:11px;font-weight:700;cursor:pointer;"
            >
              收录并移除
            </button>
          `
      : "";

    return `
      <div style="display:flex;flex-direction:column;gap:8px;align-items:stretch;">
        <div style="width:100%;aspect-ratio:16/9;min-height:176px;border-radius:12px;overflow:hidden;background:#eef2f7;flex:0 0 auto;border:1px solid rgba(70,82,112,.14);">
          <img src="${escapeHtml(record.previewUrl)}" alt="preview" style="width:100%;height:100%;object-fit:cover;display:block;" />
        </div>
        <div style="min-width:0;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            ${badge}
            <span style="font-size:11px;color:#6b7591;">${pageType}${author}</span>
          </div>
          ${meta}
          ${reason}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <button
              type="button"
              data-action="preview-open-image"
              data-preview-url="${escapeHtml(record.previewUrl)}"
              style="border:0;border-radius:8px;padding:4px 8px;background:#f2edff;color:#5b4399;font-size:11px;font-weight:700;cursor:pointer;"
            >
              看大图
            </button>
            <button
              type="button"
              data-action="preview-open"
              data-source-url="${sourceUrl}"
              style="border:0;border-radius:8px;padding:4px 8px;background:#e9efff;color:#2f4a8a;font-size:11px;font-weight:700;cursor:pointer;"
            >
              打开原帖
            </button>
            <button
              type="button"
              data-action="preview-copy"
              data-source-url="${sourceUrl}"
              style="border:0;border-radius:8px;padding:4px 8px;background:#f3f5f9;color:#44506f;font-size:11px;font-weight:700;cursor:pointer;"
            >
              复制来源
            </button>
            <button
              type="button"
              data-action="preview-copy-csv"
              data-source-url="${sourceUrl}"
              data-subject-title="${escapeHtml(record?.subjectTitle || "")}"
              data-page-type="${escapeHtml(record?.pageType || "")}"
              data-author="${escapeHtml(record?.author || "")}"
              style="border:0;border-radius:8px;padding:4px 8px;background:#eaf7ef;color:#2f6a48;font-size:11px;font-weight:700;cursor:pointer;"
            >
              复制CSV行
            </button>
            ${includeButton}
          </div>
        </div>
      </div>
    `;
  }

  function buildPreviewCsvRow(sourceUrl, subjectTitle, pageType, author) {
    const tags = [pageType, author].filter(Boolean).join("|");
    return [sourceUrl || "", subjectTitle || "", tags]
      .map((value) => csvEscape(value))
      .join(",");
  }

  function buildPreviewCsvBlock(records, limit = 4) {
    const header = ["source_url", "subject_title", "tags"].join(",");
    const rows = [];
    const seen = new Set();
    for (const record of records || []) {
      if (rows.length >= limit) {
        break;
      }
      const sourceUrl = record?.postUrl || record?.pageUrl || record?.imageUrl || "";
      const subjectTitle = record?.subjectTitle || "";
      if (!sourceUrl || !subjectTitle) {
        continue;
      }
      const key = `${sourceUrl}@@${subjectTitle}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push(buildPreviewCsvRow(sourceUrl, subjectTitle, record?.pageType || "", record?.author || ""));
    }
    return rows.length ? `${header}\n${rows.join("\n")}` : "";
  }

  async function copyTextToClipboard(text) {
    if (!text) {
      return false;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "readonly");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    return true;
  }

  function renderPreviewSection(title, description, items, emptyText, options = {}) {
    const columnCount = Math.max(1, Math.min(3, Number(options.columnCount) || 1));
    const cardMinWidth = Number(options.cardMinWidth) || 180;
    const body = items?.length
      ? `<div style="display:grid;grid-template-columns:repeat(${columnCount}, minmax(${cardMinWidth}px, 1fr));gap:10px;">${items
          .map(
            (item) =>
              `<div style="border:1px solid rgba(79,93,133,.12);border-radius:12px;padding:10px;background:#ffffff;">${renderPreviewCard(item)}</div>`
          )
          .join("")}</div>`
      : `<div style="font-size:11px;color:#8a93ab;">${escapeHtml(emptyText)}</div>`;

    return `
      <div style="margin-top:14px;padding:12px;border-radius:14px;border:1px solid rgba(79,93,133,.12);background:#fbfcff;">
        <div style="font-size:12px;font-weight:700;color:#1f2840;">${escapeHtml(title)}</div>
        <div style="margin-top:4px;font-size:11px;color:#7a86a2;">${escapeHtml(description)}</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">
          ${body}
        </div>
      </div>
    `;
  }

  function ensurePanel() {
    let root = document.getElementById(PANEL_ID);
    if (root) {
      return root;
    }

    root = document.createElement("aside");
    root.id = PANEL_ID;
    root.style.position = "fixed";
    root.style.zIndex = "2147483646";
    root.style.width = "920px";
    root.style.maxWidth = "calc(100vw - 24px)";
    root.style.borderRadius = "18px";
    root.style.border = "1px solid rgba(62,78,120,.14)";
    root.style.background = "rgba(255,255,255,.96)";
    root.style.boxShadow = "0 22px 55px rgba(19,28,48,.18)";
    root.style.backdropFilter = "blur(14px)";
    root.style.color = "#1f2840";
    root.style.fontFamily = "\"PingFang SC\",\"Microsoft YaHei\",sans-serif";
    root.style.overflow = "hidden";
    root.style.touchAction = "none";
    document.body.appendChild(root);
    applyPanelPosition(root);
    attachPanelDrag(root);
    return root;
  }

  function renderPanel() {
    const root = ensurePanel();
    const previousBody = root.querySelector('[data-panel-body]');
    if (previousBody) {
      state.panelScrollTop = previousBody.scrollTop || 0;
    }
    const subjectTitle = state.currentSubject?.title || "等待开始";
    const subjectMeta = state.currentSubject ? `subject #${state.currentSubject.id}` : "打开作品页后开始抓取";
    const statusLabel = getStatusLabel(state.statusKind);
    const statusStyle = getStatusBadgeStyle(state.statusKind);
    const modeLabel = isEpOnlyMode() ? "模式：只抓EP" : "模式：全量";
    const startButtonLabel = state.running ? (state.paused ? "继续抓取" : "抓取中") : "开始抓取";
    const pauseButtonLabel = state.running ? (state.paused ? "继续抓取" : "暂停抓取") : "暂停抓取";
    const bodyDisplay = state.panelCollapsed ? "none" : "block";

    root.innerHTML = `
      <div data-drag-handle="panel" style="padding:14px 16px 12px;border-bottom:1px solid rgba(84,97,142,.1);display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:move;user-select:none;">
        <div style="min-width:0;">
          <div style="font-size:15px;font-weight:700;letter-spacing:.02em;">Bangumi 抓图器 v${escapeHtml(SCRIPT_VERSION)}</div>
          <div style="margin-top:4px;font-size:12px;color:#697391;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(subjectTitle)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;${statusStyle}">${escapeHtml(statusLabel)}</span>
          <button type="button" data-action="toggle-collapse" style="border:0;background:#f4f6fb;color:#485371;border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer;">${state.panelCollapsed ? "展开" : "收起"}</button>
        </div>
      </div>
      <div data-panel-body style="display:${bodyDisplay};padding:14px 16px 16px;max-height:70vh;overflow:auto;">
        <div style="font-size:12px;line-height:1.6;color:#5b6683;">${escapeHtml(state.statusText || "等待开始")}</div>
        <div style="margin-top:6px;font-size:11px;color:#8b94ad;">${escapeHtml(subjectMeta)} · ${escapeHtml(modeLabel)}</div>
        <div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
          ${buildStatCard("待抓页面", state.pageQueue.length)}
          ${buildStatCard("已处理页面", state.processedPages)}
          ${buildStatCard("已保存图片", state.manifest.length)}
          ${buildStatCard("质量过滤", state.filteredImages)}
          ${buildStatCard("异常记录", state.crawlLog.length)}
        </div>
        <div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
          <button type="button" data-action="start" style="${buildPanelButtonStyle("#2f5ec4", "#ffffff")}">${escapeHtml(startButtonLabel)}</button>
          <button type="button" data-action="pause" style="${buildPanelButtonStyle("#eef2ff", "#33406a")}">${escapeHtml(pauseButtonLabel)}</button>
          <button type="button" data-action="toggle-mode" style="${buildPanelButtonStyle("#ecf5ff", "#1f5fbf")}">${escapeHtml(modeLabel)}</button>
          <button type="button" data-action="export" style="${buildPanelButtonStyle("#fff2e2", "#8d4d11")}">导出日志</button>
          <button type="button" data-action="refresh" style="${buildPanelButtonStyle("#f3f5f9", "#49526c")}">刷新面板</button>
          <button type="button" data-action="preview-copy-csv-batch" style="${buildPanelButtonStyle("#eaf7ef", "#2f6a48")}">批量复制CSV(4条)</button>
          <button type="button" data-action="reset" style="${buildPanelButtonStyle("#ffe9ec", "#a34152")}">强制重置</button>
        </div>
        ${renderPreviewSection(
          `最新已保存（${state.recentAcceptedPreviews.length}）`,
          "最近通过质量检查的图片",
          state.recentAcceptedPreviews,
          "暂无预览",
          { columnCount: 2, cardMinWidth: 300 }
        )}
        ${renderPreviewSection(
          `最近被过滤（全部 ${state.recentFilteredPreviews.length}）`,
          "质量未通过的图片（本次任务全部记录）",
          state.recentFilteredPreviews,
          "暂无记录",
          { columnCount: 3, cardMinWidth: 250 }
        )}
        <div style="margin-top:12px;border-radius:14px;background:#f7f9fc;padding:10px 12px;font-size:11px;line-height:1.7;color:#6a728a;">
          建议使用专用账号、单作品、低并发运行。若遇到验证码、403/429 或登录失效，请先暂停后再继续。
        </div>
      </div>
    `;

    const currentBody = root.querySelector('[data-panel-body]');
    if (currentBody) {
      const nextScrollTop =
        state.panelScrollTopPinned !== null && state.panelScrollTopPinned !== undefined
          ? state.panelScrollTopPinned
          : state.panelScrollTop;
      currentBody.scrollTop = Math.max(0, nextScrollTop || 0);
      state.panelScrollTopPinned = null;
      currentBody.addEventListener("scroll", () => {
        state.panelScrollTop = currentBody.scrollTop || 0;
      });
    }

    root.querySelector('[data-action="toggle-collapse"]').addEventListener("click", () => setPanelCollapsed(!state.panelCollapsed));
    root.querySelector('[data-action="start"]').addEventListener("click", handleStartFromPanel);
    root.querySelector('[data-action="pause"]').addEventListener("click", handlePauseToggleFromPanel);
    root.querySelector('[data-action="reset"]').addEventListener("click", handleResetFromPanel);
    root.querySelector('[data-action="toggle-mode"]').addEventListener("click", handleToggleModeFromPanel);
    root.querySelector('[data-action="export"]').addEventListener("click", () => {
      handleExportFromPanel().catch((error) => {
        logError("panel_export", {
          message: error?.message || String(error),
          stack: error?.stack || null,
        });
        updateStatus(`导出失败：${error?.message || "未知错误"}`, "error");
      });
    });
    root.querySelector('[data-action="refresh"]').addEventListener("click", renderPanel);
    root.querySelectorAll('[data-action="preview-open-image"]').forEach((button) => {
      button.addEventListener("click", () => {
        const previewUrl = button.getAttribute("data-preview-url");
        if (!previewUrl) {
          updateStatus("该预览没有可用大图。", "warning");
          return;
        }
        window.open(previewUrl, "_blank", "noopener,noreferrer");
      });
    });
    root.querySelectorAll('[data-action="preview-open"]').forEach((button) => {
      button.addEventListener("click", () => {
        const sourceUrl = button.getAttribute("data-source-url");
        if (!sourceUrl) {
          updateStatus("该预览没有可用来源链接。", "warning");
          return;
        }
        window.open(sourceUrl, "_blank", "noopener,noreferrer");
        updateStatus("已打开来源页面。", "active");
      });
    });
    root.querySelectorAll('[data-action="preview-copy"]').forEach((button) => {
      button.addEventListener("click", async () => {
        const sourceUrl = button.getAttribute("data-source-url");
        if (!sourceUrl) {
          updateStatus("该预览没有可用来源链接。", "warning");
          return;
        }
        try {
          await copyTextToClipboard(sourceUrl);
          updateStatus("已复制来源链接。", "done");
        } catch (error) {
          logError("copy_source_url", {
            sourceUrl,
            message: error?.message || String(error),
          });
          updateStatus("复制失败，请手动打开原帖复制。", "error");
        }
      });
    });
    root.querySelectorAll('[data-action="preview-copy-csv"]').forEach((button) => {
      button.addEventListener("click", async () => {
        const sourceUrl = button.getAttribute("data-source-url") || "";
        const subjectTitle = button.getAttribute("data-subject-title") || "";
        const pageType = button.getAttribute("data-page-type") || "";
        const author = button.getAttribute("data-author") || "";
        if (!sourceUrl || !subjectTitle) {
          updateStatus("CSV 行缺少关键字段，无法复制。", "warning");
          return;
        }
        const csvRow = buildPreviewCsvRow(sourceUrl, subjectTitle, pageType, author);
        try {
          await copyTextToClipboard(csvRow);
          updateStatus("已复制 CSV 行（来源,作品名,标签）。", "done");
        } catch (error) {
          logError("copy_preview_csv", {
            sourceUrl,
            subjectTitle,
            pageType,
            author,
            message: error?.message || String(error),
          });
          updateStatus("复制 CSV 行失败。", "error");
        }
      });
    });
    root.querySelectorAll('[data-action="preview-include"]').forEach((button) => {
      button.addEventListener("click", async () => {
        const previewId = button.getAttribute("data-preview-id") || "";
        if (!previewId) {
          updateStatus("无法识别预览记录。", "warning");
          return;
        }
        pinPanelScrollFromDom();
        button.disabled = true;
        try {
          await includePreviewRecordById(previewId);
        } finally {
          button.disabled = false;
        }
      });
    });
    root.querySelector('[data-action="preview-copy-csv-batch"]')?.addEventListener("click", async () => {
      const merged = [...(state.recentAcceptedPreviews || []), ...(state.recentFilteredPreviews || [])];
      const csvBlock = buildPreviewCsvBlock(merged, 4);
      if (!csvBlock) {
        updateStatus("当前没有可批量复制的预览记录。", "warning");
        return;
      }
      try {
        await copyTextToClipboard(csvBlock);
        updateStatus("已复制带表头 CSV（最多4条）。", "done");
      } catch (error) {
        logError("copy_preview_csv_batch", {
          message: error?.message || String(error),
        });
        updateStatus("批量复制 CSV 失败。", "error");
      }
    });
    attachPanelDrag(root);
  }

  function buildPanelButtonStyle(background, color) {
    return [
      "border:0",
      "border-radius:12px",
      "padding:10px 12px",
      "font-size:13px",
      "font-weight:700",
      "cursor:pointer",
      `background:${background}`,
      `color:${color}`,
      "box-shadow:inset 0 0 0 1px rgba(70,82,112,.08)",
    ].join(";");
  }

  function buildStatCard(label, value) {
    return `
      <div style="border-radius:14px;border:1px solid rgba(79,93,133,.12);background:#fbfcff;padding:10px 12px;">
        <div style="font-size:11px;color:#7c86a1;letter-spacing:.02em;">${escapeHtml(label)}</div>
        <div style="margin-top:6px;font-size:22px;font-weight:800;color:#1f2840;">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function normalizePageUrl(url, baseUrl) {
    if (!url) {
      return null;
    }
    try {
      const resolved = new URL(url, baseUrl || location.href);
      resolved.hash = "";
      if (/\/ep\/\d+/.test(resolved.pathname)) {
        return canonicalizeEpisodeUrl(resolved.toString());
      }
      return resolved.toString();
    } catch {
      return null;
    }
  }

  function canonicalizeEpisodeUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      const matched = parsed.pathname.match(/\/ep\/(\d+)/);
      if (!matched?.[1]) {
        parsed.hash = "";
        return parsed.toString();
      }
      return `${parsed.origin}/ep/${matched[1]}`;
    } catch {
      return url;
    }
  }

  function normalizeImageUrl(url, baseUrl) {
    if (!url) {
      return null;
    }
    try {
      const resolved = new URL(url, baseUrl || location.href);
      resolved.hash = "";
      return resolved.toString();
    } catch {
      return null;
    }
  }

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function slugify(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "subject";
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function randomDelay(min, max) {
    const duration = min + Math.random() * (max - min);
    await sleep(duration);
  }

  function downloadText(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, fileName);
  }

  function downloadBinary(buffer, fileName, mimeType) {
    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, fileName);
  }

  function triggerDownload(url, fileName) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  renderPanel();
})();


