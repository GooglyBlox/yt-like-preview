(() => {
  'use strict';

  const VIDEO_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'yt-lockup-view-model',
    'ytm-shorts-lockup-view-model',
    '.ytp-modern-videowall-still'
  ].join(',');

  const likesCache = new Map();
  const pendingFetches = new Set();
  const processingElements = new WeakSet();

  const formatCount = (count) => {
    const num = parseInt(count, 10);
    if (isNaN(num)) return count;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return num.toString();
  };

  const waitForCachedLikes = (videoId) => new Promise((resolve) => {
    const interval = setInterval(() => {
      if (likesCache.has(videoId)) {
        clearInterval(interval);
        resolve(likesCache.get(videoId));
      }
    }, 100);
    setTimeout(() => {
      clearInterval(interval);
      resolve(null);
    }, 10000);
  });

  const fetchLikes = async (videoId) => {
    if (likesCache.has(videoId)) return likesCache.get(videoId);
    if (pendingFetches.has(videoId)) return waitForCachedLikes(videoId);

    pendingFetches.add(videoId);

    try {
      const response = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20230327.07.00' } },
          videoId
        })
      });

      const data = await response.json();
      const likes = data?.microformat?.playerMicroformatRenderer?.likeCount;

      if (likes) likesCache.set(videoId, likes);
      return likes ?? null;
    } catch {
      return null;
    } finally {
      pendingFetches.delete(videoId);
    }
  };

  const extractVideoId = (el, selector, pattern) => {
    const target = el.querySelector(selector) || el.closest(selector);
    return target?.href?.match(pattern)?.[1] ?? target?.className?.match(pattern)?.[1];
  };

  const getVideoId = (el) => {
    if (el.classList.contains('ytp-modern-videowall-still') && el.href) {
      const match = el.href.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }

    const lockup = el.querySelector('[class*="content-id-"]') ||
      el.closest('[class*="content-id-"]');
    if (lockup) {
      const match = lockup.className.match(/content-id-([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }

    return extractVideoId(el, 'a[href*="/watch?v="]', /\/watch\?v=([a-zA-Z0-9_-]{11})/) ??
      extractVideoId(el, 'a[href*="/shorts/"]', /\/shorts\/([a-zA-Z0-9_-]{11})/);
  };

  const METADATA_ROW_SELECTOR =
    '.yt-content-metadata-view-model__metadata-row, .ytContentMetadataViewModelMetadataRow';
  const DELIMITER_SELECTOR =
    '.yt-content-metadata-view-model__delimiter, .ytContentMetadataViewModelDelimiter';

  const isDelimiter = (el) =>
    el.classList.contains('yt-content-metadata-view-model__delimiter') ||
    el.classList.contains('ytContentMetadataViewModelDelimiter');

  const getMetadataRow = (el) => {
    if (el.classList.contains('ytp-modern-videowall-still')) {
      return el.querySelector('.ytp-modern-videowall-still-info-content');
    }

    for (const row of el.querySelectorAll(METADATA_ROW_SELECTOR)) {
      if (/views|watching/i.test(row.textContent)) return row;
    }
    return el.querySelector('.shortsLockupViewModelHostMetadataSubhead') ??
      el.querySelector('#metadata-line');
  };

  const clearLikesElements = (row) => {
    const isPlayerSuggestion = row.classList.contains('ytp-modern-videowall-still-info-content');
    if (isPlayerSuggestion) {
      const viewCountSpan = row.querySelector('.ytp-modern-videowall-still-view-count-and-date-info');
      if (viewCountSpan?.dataset.originalText) {
        viewCountSpan.textContent = viewCountSpan.dataset.originalText;
        delete viewCountSpan.dataset.originalText;
      }
      return;
    }

    for (const node of row.querySelectorAll('.yt-likes-ext')) {
      node.remove();
    }
  };

  const createLikesSpan = (row, likes) => {
    const isPlayerSuggestion = row.classList.contains('ytp-modern-videowall-still-info-content');
    const existingSpan = row.querySelector(
      '.yt-core-attributed-string, .ytAttributedStringHost, .inline-metadata-item'
    );
    const span = document.createElement('span');

    if (isPlayerSuggestion) {
      span.className = 'ytp-modern-videowall-still-view-count-and-date-info yt-likes-ext';
    } else {
      span.className = `${existingSpan?.className ?? 'ytAttributedStringHost'} yt-likes-ext`;
    }

    span.textContent = `${formatCount(likes)} likes`;
    return span;
  };

  const insertLikesElement = (row, span) => {
    const isPlayerSuggestion = row.classList.contains('ytp-modern-videowall-still-info-content');
    const isShorts = row.classList.contains('shortsLockupViewModelHostMetadataSubhead');
    const isMetadataLine = row.id === 'metadata-line';
    const inlineItems = row.querySelectorAll('.inline-metadata-item');

    if (isPlayerSuggestion) {
      const viewCountSpan = row.querySelector('.ytp-modern-videowall-still-view-count-and-date-info');
      if (viewCountSpan && !viewCountSpan.dataset.originalText) {
        viewCountSpan.dataset.originalText = viewCountSpan.textContent;
        const text = viewCountSpan.textContent;
        const match = text.match(/^(.+?\s+views\s*•\s*)(.+)$/);
        if (match) {
          viewCountSpan.textContent = `${match[1]}${span.textContent} • ${match[2]}`;
        } else {
          viewCountSpan.textContent = `${text} • ${span.textContent}`;
        }
      }
      return;
    }

    if (isMetadataLine && inlineItems.length >= 2) {
      row.insertBefore(span, inlineItems[inlineItems.length - 1]);
      return;
    }

    const existingDelim = row.querySelector(DELIMITER_SELECTOR);
    const delimClass = existingDelim?.className.split(/\s+/).find(c =>
      c === 'yt-content-metadata-view-model__delimiter' || c === 'ytContentMetadataViewModelDelimiter'
    ) ?? 'ytContentMetadataViewModelDelimiter';

    const delimiter = document.createElement('span');
    delimiter.className = isShorts ? 'yt-likes-ext' : `${delimClass} yt-likes-ext`;
    delimiter.textContent = ' • ';

    const children = [...row.children];
    const lastDelimIdx = children.findLastIndex(c => isDelimiter(c));

    if (lastDelimIdx > 0) {
      row.insertBefore(delimiter, children[lastDelimIdx]);
      row.insertBefore(span, children[lastDelimIdx]);
    } else {
      row.append(delimiter, span);
    }
  };

  const processElement = async (el) => {
    const videoId = getVideoId(el);
    if (!videoId) return;

    const prevVideoId = el.dataset.ytLikesVideoId;
    if (prevVideoId === videoId || processingElements.has(el)) return;

    const row = getMetadataRow(el);
    if (!row) return;

    if (prevVideoId) {
      clearLikesElements(row);
    } else {
      const isPlayerSuggestion = row.classList.contains('ytp-modern-videowall-still-info-content');
      if (isPlayerSuggestion) {
        const viewCountSpan = row.querySelector('.ytp-modern-videowall-still-view-count-and-date-info');
        if (viewCountSpan?.dataset.originalText) return;
      } else if (row.querySelector('.yt-likes-ext')) {
        return;
      }
    }

    processingElements.add(el);
    el.dataset.ytLikesVideoId = videoId;

    const likes = await fetchLikes(videoId);
    processingElements.delete(el);

    if (el.dataset.ytLikesVideoId !== videoId || !likes) return;

    clearLikesElements(row);
    insertLikesElement(row, createLikesSpan(row, likes));
  };

  const scheduleProcess = (el) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => processElement(el), { timeout: 2000 });
    } else {
      setTimeout(() => processElement(el), 0);
    }
  };

  const processAll = () => {
    for (const el of document.querySelectorAll(VIDEO_SELECTORS)) {
      scheduleProcess(el);
    }
  };

  // this would be so much less hacky if youtube would actually update
  // data attributes with the proper video ID when sorting on channels
  const observer = new MutationObserver((mutations) => {
    const shouldProcess = mutations.some((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'href') return true;

      return [...mutation.addedNodes].some((node) =>
        node.nodeType === 1 && (
          node.matches?.(VIDEO_SELECTORS) ||
          node.querySelector?.(VIDEO_SELECTORS)
        )
      );
    });

    if (shouldProcess) {
      clearTimeout(window._ytLikesTimeout);
      window._ytLikesTimeout = setTimeout(processAll, 300);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href']
  });

  window.addEventListener('yt-navigate-finish', () => setTimeout(processAll, 500));
  processAll();
})();
