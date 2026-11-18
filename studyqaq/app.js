/* Study QAQ — web (PWA) client.
   Same Firebase project (hwsh-gaoyi), same REST approach and the same
   payload formats as the Android app (app.hwsh.gaoyi v3.2.x): data read
   or written here is byte-compatible with the Android serializers. */
'use strict';

/* ============================== config ============================== */
var CFG = {
  projectId: 'hwsh-gaoyi',
  apiKey: 'AIzaSyALza790k3Yn_t8_EuuhuU44RSQ0OKmAoY',
  identityBase: 'https://identitytoolkit.googleapis.com/v1',
  secureTokenUrl: 'https://securetoken.googleapis.com/v1/token'
};
CFG.firestoreBase = 'https://firestore.googleapis.com/v1/projects/' +
  CFG.projectId + '/databases/(default)/documents';

var SUBJECTS = ['國文', '英文', '數學', '自然', '社會', '其他'];
var CAUSES = ['粗心大意', '概念不清', '計算錯誤', '看錯題目', '完全不會'];
var SOURCES = ['段考', '小考', '作業', '課外/自學'];
var STICKER_IDS = [
  'noto_1f600','noto_1f601','noto_1f602','noto_1f923','noto_1f60a','noto_1f60d',
  'noto_1f618','noto_1f60e','noto_1f914','noto_1f605','noto_1f62d','noto_1f631',
  'noto_1f929','noto_1f973','noto_1f60b','noto_1f61c','noto_1f92a','noto_1f634',
  'noto_1f62e','noto_1f615','noto_1f621','noto_1f624','noto_1f97a','noto_1f913',
  'noto_1f92f','noto_1f635','noto_1f970','noto_1f917','noto_1f44d','noto_1f44e',
  'noto_1f44f','noto_1f64f','noto_1f4aa','noto_1f525','noto_2764','noto_1f494',
  'noto_1f4af','noto_2728','noto_1f389','noto_1f440','noto_1f4da','noto_270f',
  'noto_1f3c6','noto_1f680','noto_2b50','noto_1f31f','noto_1f4a1','noto_2615'
];

/* ============================== utils ============================== */
function $(sel, root) { return (root || document).querySelector(sel); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toast(msg) {
  var root = $('#toast-root');
  root.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { root.innerHTML = ''; }, 2600);
}
/* Base64 exactly like java.util.Base64.getEncoder()/getDecoder():
   standard alphabet, padded, UTF-8 bytes. */
function b64enc(str) {
  var bytes = new TextEncoder().encode(str);
  var bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function b64dec(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
/* java.time epoch day of the device's local today. */
function epochDayToday() {
  var d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function epochDayOf(ms) {
  var d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function fmtTime(ms) {
  var d = new Date(ms);
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
function fmtDay(epochDay) {
  var d = new Date(epochDay * 86400000);
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
}
function fmtElapsed(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return h > 0 ? h + ':' + p(m) + ':' + p(ss) : p(m) + ':' + p(ss);
}
function newId() { return Date.now(); }
function avatarColor(name) {
  var cols = ['#5B6B8C', '#7A5C48', '#4F6B5A', '#6E5570', '#71624A', '#54626E', '#7C5A54', '#5E6650'];
  var h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return cols[h % cols.length];
}
function avatarHtml(name, cls) {
  var n = (name || '?').trim();
  return '<div class="avatar ' + (cls || '') + '" style="background:' +
    avatarColor(n) + '">' + esc(n.charAt(0) || '?') + '</div>';
}

/* ============================== ReviewEngine (port of the Kotlin) == */
var LADDER = [1, 3, 7, 14, 30, 60, 120];
function reviewIsDue(state, today) { return state.due <= today; }
function reviewSchedule(state, grade, today) {
  if (grade === 'KNOWN') {
    var streak = state.streak + 1;
    var interval = LADDER[Math.min(streak - 1, LADDER.length - 1)];
    return { interval: interval, due: today + interval, streak: streak };
  }
  if (grade === 'FUZZY') {
    var iv = state.interval <= 0 ? 1 : Math.max(1, Math.floor(state.interval / 2));
    return { interval: iv, due: today + iv, streak: state.streak };
  }
  return { interval: 1, due: today + 1, streak: 0 }; /* UNKNOWN */
}

/* ============================== payload codecs =====================
   Line formats are byte-identical to the Android cores:
   fields TAB-joined, strings base64, one entry per line, trailing \n. */
function parseNotes(text) {
  var out = [];
  if (!text) return out;
  text.split('\n').forEach(function (line) {
    if (!line.trim()) return;
    var p = line.split('\t');
    if (p.length !== 7) return;
    try {
      out.push({
        id: +p[0], title: b64dec(p[1]), body: b64dec(p[2]), subject: b64dec(p[3]),
        photoName: p[4] ? p[4] : null, createdAt: +p[5], updatedAt: +p[6]
      });
    } catch (e) { /* skip corrupt line */ }
  });
  out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  return out;
}
function writeNotes(items) {
  return items.map(function (n) {
    return [n.id, b64enc(n.title), b64enc(n.body), b64enc(n.subject),
      n.photoName || '', n.createdAt, n.updatedAt].join('\t');
  }).join('\n') + (items.length ? '\n' : '');
}
function parseMistakes(text) {
  var out = [];
  if (!text) return out;
  text.split('\n').forEach(function (line) {
    if (!line.trim()) return;
    var p = line.split('\t');
    if (p.length !== 9 && p.length !== 13 && p.length !== 16) return;
    try {
      out.push({
        id: +p[0], subject: b64dec(p[1]), question: b64dec(p[2]),
        myAnswer: b64dec(p[3]), correctAnswer: b64dec(p[4]), note: b64dec(p[5]),
        photoName: p[6] ? p[6] : null, mastered: p[7] === '1', createdAt: +p[8],
        cause: p.length >= 13 ? b64dec(p[9]) : '',
        source: p.length >= 13 ? b64dec(p[10]) : '',
        reviewCount: p.length >= 13 ? +p[11] : 0,
        lastReviewedAt: p.length >= 13 ? +p[12] : 0,
        reviewIntervalDays: p.length === 16 ? +p[13] : 0,
        reviewDueEpochDay: p.length === 16 ? +p[14] : 0,
        reviewStreak: p.length === 16 ? +p[15] : 0
      });
    } catch (e) { /* skip */ }
  });
  return out;
}
function writeMistakes(items) {
  return items.map(function (m) {
    return [m.id, b64enc(m.subject), b64enc(m.question), b64enc(m.myAnswer),
      b64enc(m.correctAnswer), b64enc(m.note), m.photoName || '',
      m.mastered ? '1' : '0', m.createdAt, b64enc(m.cause || ''),
      b64enc(m.source || ''), m.reviewCount || 0, m.lastReviewedAt || 0,
      m.reviewIntervalDays || 0, m.reviewDueEpochDay || 0, m.reviewStreak || 0
    ].join('\t');
  }).join('\n') + (items.length ? '\n' : '');
}
function parseFlashcards(text) {
  var out = [];
  if (!text) return out;
  text.split('\n').forEach(function (line) {
    if (!line.trim()) return;
    var p = line.split('\t');
    if (p.length !== 6 && p.length !== 9) return;
    try {
      out.push({
        id: +p[0], front: b64dec(p[1]), back: b64dec(p[2]), subject: b64dec(p[3]),
        mastered: p[4] === '1', createdAt: +p[5],
        reviewIntervalDays: p.length === 9 ? +p[6] : 0,
        reviewDueEpochDay: p.length === 9 ? +p[7] : 0,
        reviewStreak: p.length === 9 ? +p[8] : 0
      });
    } catch (e) { /* skip */ }
  });
  return out;
}
function writeFlashcards(items) {
  return items.map(function (c) {
    return [c.id, b64enc(c.front), b64enc(c.back), b64enc(c.subject),
      c.mastered ? '1' : '0', c.createdAt, c.reviewIntervalDays || 0,
      c.reviewDueEpochDay || 0, c.reviewStreak || 0].join('\t');
  }).join('\n') + (items.length ? '\n' : '');
}
function parseFocus(text) {
  var out = [];
  if (!text) return out;
  text.split('\n').forEach(function (line) {
    if (!line.trim()) return;
    var p = line.split('\t');
    if (p.length !== 5) return;
    try {
      out.push({
        id: +p[0], subject: b64dec(p[1]), minutes: +p[2],
        dateEpochDay: +p[3], createdAt: +p[4]
      });
    } catch (e) { /* skip */ }
  });
  return out;
}
function writeFocus(items) {
  return items.map(function (s) {
    return [s.id, b64enc(s.subject), s.minutes, s.dateEpochDay, s.createdAt].join('\t');
  }).join('\n') + (items.length ? '\n' : '');
}
function parseStudyDays(text) {
  var out = [];
  if (!text) return out;
  text.split('\n').forEach(function (line) {
    var v = parseInt(line.trim(), 10);
    if (!isNaN(v) && out.indexOf(v) < 0) out.push(v);
  });
  return out.sort(function (a, b) { return a - b; });
}
function writeStudyDays(days) {
  return days.slice().sort(function (a, b) { return a - b; }).join('\n');
}
/* Block list payload (users/{uid}/data/blocks): "uid<TAB>nickname" lines. */
function parseBlocks(text) {
  var out = [];
  if (!text) return out;
  text.split('\n').forEach(function (line) {
    var p = line.split('\t');
    if (p.length === 2 && p[0]) out.push({ uid: p[0], nickname: p[1] });
  });
  return out;
}
function writeBlocks(entries) {
  return entries.map(function (e) { return e.uid + '\t' + e.nickname; }).join('\n');
}

/* ============================== photos (Firestore docs) ============
   Byte-compatible with the Android photo sync (v3.0+): one doc per
   photo at users/{uid}/photos/{docId}, docId = {feature}__{safeName}
   where safeName keeps only [A-Za-z0-9._-] and maps everything else
   to '_' (Android PhotoDocIds). Fields: name (string), data (base64
   of the cloud copy), size (integer, cloud-copy bytes), updatedAt
   (integer ms) — the Android FirestoreClient.buildPhotoDocBody shape.
   The cloud copy is a recompressed JPEG: long edge ≤1280 at q75, one
   retry at 960/q65 when its base64 would exceed 900,000 chars (the
   Firestore 1 MiB document cap) — Android PhotoCompressPolicy.
   Entries reference photos by file name inside the payload's photo
   field: names joined with ',' (Android PhotoList, cap 20 per
   entry); a single photo serializes as its plain name, no photos as
   the empty field. Web-generated names use the Android shape
   <entryId>_<millis>_<seq>.jpg. */
var PHOTO_MAX_PER_ENTRY = 20;
var PHOTO_BASE64_CAP = 900000;
var PHOTO_COMPRESS_STEPS = [[1280, 75], [960, 65]];

function photoNamesOf(raw) {
  if (!raw) return [];
  return String(raw).split(',').filter(function (s) { return s.length > 0; });
}
function photoFieldOf(names) {
  var clean = (names || []).filter(function (n) {
    return n && n.indexOf(',') < 0 && n.indexOf('\t') < 0 && n.indexOf('\n') < 0;
  }).slice(0, PHOTO_MAX_PER_ENTRY);
  return clean.length ? clean.join(',') : null;
}
function photoSafeName(name) {
  var s = String(name == null ? '' : name), out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    out += /[A-Za-z0-9._-]/.test(ch) ? ch : '_';
  }
  return (!out || out === '.' || out === '..') ? 'photo' : out;
}
function photoDocId(feature, name) { return feature + '__' + photoSafeName(name); }
function photoDocPath(feature, name) {
  return 'users/' + Auth.uid + '/photos/' + photoDocId(feature, name);
}
function b64ToBytes(b64) {
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64ToBlob(b64, type) {
  return new Blob([b64ToBytes(b64)], { type: type || 'application/octet-stream' });
}
function bytesToB64(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null,
      bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(bin);
}
function blobToB64(blob) {
  return blob.arrayBuffer().then(function (buf) { return bytesToB64(new Uint8Array(buf)); });
}
/* In-memory cache of fetched photo docs (docId -> {name, b64, size,
   updatedAt}); photos are immutable per name, so no invalidation is
   needed beyond put/remove updating the entry themselves. */
var PhotoStore = {
  cache: {},
  get: function (feature, name) {
    var docId = photoDocId(feature, name);
    if (this.cache[docId]) return Promise.resolve(this.cache[docId]);
    var self = this;
    return FS.getDoc(photoDocPath(feature, name)).then(function (f) {
      if (!f || typeof f.data !== 'string' || !f.data) return null;
      var rec = {
        name: typeof f.name === 'string' && f.name ? f.name : name,
        b64: f.data, size: f.size || 0, updatedAt: f.updatedAt || 0
      };
      self.cache[docId] = rec;
      return rec;
    }).catch(function () { return null; });
  },
  dataUrl: function (rec) { return 'data:image/jpeg;base64,' + rec.b64; },
  blob: function (rec) { return b64ToBlob(rec.b64, 'image/jpeg'); },
  put: function (feature, name, b64, size) {
    var now = Date.now(), self = this;
    return FS.patchDoc(photoDocPath(feature, name),
      { name: name, data: b64, size: size, updatedAt: now }, null)
      .then(function () {
        self.cache[photoDocId(feature, name)] =
          { name: name, b64: b64, size: size, updatedAt: now };
      });
  },
  remove: function (feature, name) {
    delete this.cache[photoDocId(feature, name)];
    return FS.deleteDoc(photoDocPath(feature, name)).catch(function () {});
  }
};
/* Android AiImagePolicy.scaledSize: shrink so the long edge is at
   most maxEdge; never upscale. */
function scaledSizeJs(width, height, maxEdge) {
  if (width <= 0 || height <= 0) return [width, height];
  var le = Math.max(width, height);
  if (le <= maxEdge) return [width, height];
  var r = maxEdge / le;
  return [Math.max(1, Math.round(width * r)), Math.max(1, Math.round(height * r))];
}
function loadImageViaTag(blob) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      resolve({
        draw: img, width: img.naturalWidth, height: img.naturalHeight,
        close: function () { URL.revokeObjectURL(url); }
      });
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('照片讀取失敗')); };
    img.src = url;
  });
}
function loadImageSource(blob) {
  if (window.createImageBitmap) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' })
      .then(function (bmp) {
        return {
          draw: bmp, width: bmp.width, height: bmp.height,
          close: function () { bmp.close(); }
        };
      }).catch(function () { return loadImageViaTag(blob); });
  }
  return loadImageViaTag(blob);
}
function encodeJpeg(blob, maxEdge, quality) {
  return loadImageSource(blob).then(function (src) {
    var size = scaledSizeJs(src.width, src.height, maxEdge);
    var canvas = document.createElement('canvas');
    canvas.width = size[0]; canvas.height = size[1];
    canvas.getContext('2d').drawImage(src.draw, 0, 0, size[0], size[1]);
    src.close();
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('照片處理失敗'));
        }, 'image/jpeg', quality / 100);
      } else {
        resolve(b64ToBlob(canvas.toDataURL('image/jpeg', quality / 100).split(',')[1],
          'image/jpeg'));
      }
    });
  });
}
function b64CharCount(byteSize) { return Math.ceil(byteSize / 3) * 4; }
/* Android PhotoCompressPolicy: the first step whose base64 fits the
   cap wins; null when even the last step stays too big (the photo is
   skipped, as on Android). */
function compressPhotoCopy(file) {
  var stepIdx = 0;
  function attempt() {
    var step = PHOTO_COMPRESS_STEPS[stepIdx];
    return encodeJpeg(file, step[0], step[1]).then(function (blob) {
      return blobToB64(blob).then(function (b64) {
        if (b64CharCount(blob.size) <= PHOTO_BASE64_CAP) {
          return { blob: blob, b64: b64, size: blob.size };
        }
        stepIdx++;
        return stepIdx < PHOTO_COMPRESS_STEPS.length ? attempt() : null;
      });
    });
  }
  return attempt();
}
/* Android AiImagePolicy.planFor: few photos keep the larger size,
   5+ shrink so the total request payload stays reasonable. */
function aiPlanFor(count) {
  return count <= 4 ? { maxEdge: 1600, quality: 80 } : { maxEdge: 1024, quality: 70 };
}
/* Prepares an entry's photos for one AI call, in display order. The
   web's source bytes are the cloud copies (already ≤1280px), where
   Android starts from the phone's originals — the request shape is
   identical either way. */
function prepareAiImages(feature, names) {
  var plan = aiPlanFor(names.length);
  return Promise.all(names.map(function (name) {
    return PhotoStore.get(feature, name).then(function (rec) {
      if (!rec) throw new Error('有一張照片讀不到，請再試一次');
      return encodeJpeg(PhotoStore.blob(rec), plan.maxEdge, plan.quality)
        .then(blobToB64);
    });
  }));
}

/* ============================== AI prompts & calls =================
   The prompts are byte-identical copies of Android AiPrompts
   (NOTE_PROMPT / MISTAKE_PROMPT); the request body mirrors Android
   OpenAiCompatClient.buildRequestJson: the study-guard system
   message first, then one user message whose content is a parts
   array — the prompt text, then one image_url data-URI part per
   photo, in order. Text-only requests use the same one-part shape. */
var NOTE_PROMPT = '你是學習助理。請把這份內容（照片或文字）整理成繁體中文筆記，嚴格照下面格式輸出，不要加開場白、結尾或格式以外的文字：\n【摘要】\n用 3–5 句話講完整份內容在說什麼，120 字以內，不要條列。\n【重點】\n最多 7 條，每條一行、以「・」開頭、每條 30 字以內，只留核心觀念、公式、定義與年份；不要寫例子、不要逐句抄原文、不要客套話；內容太多時合併條目，不可以超過 7 條。';
var MISTAKE_PROMPT = '請看這張題目照片，用繁體中文說明，不要客套話，嚴格照下面三段輸出，每條以 30 字以內為原則：\n【觀念】\n最多 2 條，先講這題在考什麼觀念。\n【解法步驟】\n最多 5 行短句，條列正確的解法步驟。\n【易錯點】\n最多 3 條，列出最容易錯的地方。';
function buildAiRequestBody(model, prompt, imagesB64) {
  var content = [{ type: 'text', text: prompt }];
  (imagesB64 || []).forEach(function (b64) {
    content.push({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,' + b64 }
    });
  });
  return {
    model: model,
    messages: [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      { role: 'user', content: content }
    ]
  };
}
/* Android OpenAiCompatClient.httpError wording: plain reason +
   （錯誤代碼 N） + the server's own short hint. */
function aiHttpErrorMessage(status, serverMsg) {
  var reason;
  if (status === 400) reason = '請求格式有問題';
  else if (status === 401) reason = 'Key 被拒絕了，請檢查 Key 有沒有貼對';
  else if (status === 402) reason = '餘額不足，要先在這個服務儲值才能用';
  else if (status === 429) reason = '請求太頻繁或額度受限，晚點再試';
  else if (status === 404) reason = '找不到這個 AI 模型';
  else if (status >= 500 && status <= 599) reason = 'AI 伺服器暫時出問題';
  else reason = 'AI 回應怪怪的，請再試一次';
  var detail = reason + '（錯誤代碼 ' + status + '）';
  var hint = String(serverMsg || '').trim().replace(/\n/g, ' ').slice(0, 80);
  if (hint) detail += ' ' + hint;
  return detail;
}
function aiTypedError(msg) { var e = new Error(msg); e.aiTyped = true; return e; }
/* One chat-completions call with the account's effective settings.
   Mirrors the Android client: a 5xx answer is retried once after a
   pause; failures reject with the plain-language Android wording;
   the API key is stripped if it ever echoes back in an error. */
function aiChat(prompt, imagesB64) {
  var ai = loadAiSettings();
  if (!ai.key) return Promise.reject(aiTypedError('這個帳號還沒有 AI 設定'));
  var body = JSON.stringify(buildAiRequestBody(ai.model, prompt, imagesB64));
  function attempt(n) {
    return fetch(aiEndpoint(ai.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.key },
      body: body
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          if (r.status >= 500 && r.status <= 599 && n < 2) {
            return new Promise(function (res) { setTimeout(res, 2000); })
              .then(function () { return attempt(n + 1); });
          }
          var msg = data && data.error && data.error.message ? data.error.message : '';
          var text = aiHttpErrorMessage(r.status, msg);
          if (text.indexOf(ai.key) >= 0) text = 'AI 回應怪怪的，請再試一次';
          throw aiTypedError(text);
        }
        if (data && data.error) throw aiTypedError('AI 回應怪怪的，請再試一次');
        var text2 = data && data.choices && data.choices[0] && data.choices[0].message
          ? String(data.choices[0].message.content || '').trim() : '';
        if (!text2) throw aiTypedError('AI 沒有回傳內容，再試一次');
        return text2;
      });
    }).catch(function (e) {
      if (e && e.aiTyped) throw e;
      throw aiTypedError('網路連不上，請檢查連線後再試一次');
    });
  }
  return attempt(1);
}

/* ============================== photo UI ========================== */
/* Thumbnail strip for list cards & review: up to maxShow photos of
   an entry; tapping one opens the viewer with the entry's full set. */
function photoStripHtml(feature, entry, maxShow) {
  var names = photoNamesOf(entry.photoName);
  if (!names.length) return '';
  var show = names.slice(0, maxShow || 3);
  var html = '<div class="photostrip" style="margin-top:10px">' + show.map(function (n, i) {
    return '<img class="phthumb sm" data-phname="' + esc(n) + '" data-phfeat="' + feature +
      '" data-phentry="' + entry.id + '" data-phidx="' + i + '" alt="照片">';
  }).join('');
  if (names.length > show.length) {
    html += '<span class="dim small">＋' + (names.length - show.length) + ' 張</span>';
  }
  return html + '</div>';
}
function hydrateThumbs(container, onTap) {
  Array.prototype.forEach.call(container.querySelectorAll('img[data-phname]'), function (img) {
    var feature = img.getAttribute('data-phfeat');
    var name = img.getAttribute('data-phname');
    PhotoStore.get(feature, name).then(function (rec) {
      if (rec) img.src = PhotoStore.dataUrl(rec);
    });
    if (onTap) {
      img.addEventListener('click', function () { onTap(img); });
    }
  });
}
function wirePhotoThumbs(rootEl) {
  hydrateThumbs(rootEl, function (img) {
    var feature = img.getAttribute('data-phfeat');
    var entryId = +img.getAttribute('data-phentry');
    var list = feature === 'notes' ? App.data.notes : App.data.mistakes;
    var entry = list.find(function (x) { return x.id === entryId; });
    if (entry) {
      openPhotoViewer(feature, photoNamesOf(entry.photoName),
        +img.getAttribute('data-phidx'));
    }
  });
}
/* Full-screen viewer with prev/next, mirroring Android PhotoViewer
   (「第 n 張／共 N 張」). Lives outside #modal-root so it can open
   over an editor modal without disturbing it. */
function openPhotoViewer(feature, names, index) {
  closePhotoViewer();
  if (!names.length) return;
  var idx = Math.min(Math.max(index || 0, 0), names.length - 1);
  var ov = document.createElement('div');
  ov.className = 'photoviewer'; ov.id = 'photoviewer';
  ov.innerHTML = '<div class="pvbar"><span id="pv-count"></span>' +
    '<button class="btn ghost small" id="pv-close">✕</button></div>' +
    '<img id="pv-img" alt="照片">' +
    '<div class="pvnav"><button class="btn ghost" id="pv-prev">‹ 上一張</button>' +
    '<button class="btn ghost" id="pv-next">下一張 ›</button></div>';
  document.body.appendChild(ov);
  function show() {
    $('#pv-count', ov).textContent = '第 ' + (idx + 1) + ' 張 / 共 ' + names.length + ' 張';
    $('#pv-prev', ov).disabled = idx <= 0;
    $('#pv-next', ov).disabled = idx >= names.length - 1;
    var img = $('#pv-img', ov);
    img.removeAttribute('src');
    PhotoStore.get(feature, names[idx]).then(function (rec) {
      if (rec && document.body.contains(ov)) img.src = PhotoStore.dataUrl(rec);
    });
  }
  $('#pv-close', ov).addEventListener('click', closePhotoViewer);
  ov.addEventListener('click', function (e) { if (e.target === ov) closePhotoViewer(); });
  $('#pv-prev', ov).addEventListener('click', function () { if (idx > 0) { idx--; show(); } });
  $('#pv-next', ov).addEventListener('click', function () {
    if (idx < names.length - 1) { idx++; show(); }
  });
  show();
}
function closePhotoViewer() {
  var ov = document.getElementById('photoviewer');
  if (ov) ov.remove();
}
/* The AI-result placement choice (Android AppDialog.choose over the
   editor): resolves 'append' / 'replace' / null (cancelled). Also an
   overlay outside #modal-root so the editor underneath survives. */
function chooseAiApply(title, message, replaceLabel) {
  return new Promise(function (resolve) {
    var ov = document.createElement('div');
    ov.className = 'modal overlay2';
    ov.innerHTML = '<div class="sheet"><h3>' + esc(title) + '</h3>' +
      '<p class="hint">' + esc(message) + '</p><div style="height:14px"></div>' +
      '<button class="btn cta" id="ac-append">加在後面</button><div style="height:10px"></div>' +
      '<button class="btn peri block" id="ac-replace">' + esc(replaceLabel) + '</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn ghost block" id="ac-cancel">取消</button></div>';
    document.body.appendChild(ov);
    function done(v) { ov.remove(); resolve(v); }
    $('#ac-append', ov).addEventListener('click', function () { done('append'); });
    $('#ac-replace', ov).addEventListener('click', function () { done('replace'); });
    $('#ac-cancel', ov).addEventListener('click', function () { done(null); });
    ov.addEventListener('click', function (e) { if (e.target === ov) done(null); });
  });
}
/* The editor photo working set. Photos picked in the editor upload
   to the cloud at once (like the Android editor copies the file in
   immediately); removals of pre-existing photos only delete their
   cloud docs when the entry is saved (commit). Closing the modal
   without saving deletes the session's uploads again (rollback), so
   no unreferenced doc is left behind. */
var photoNameSeq = 0;
function editorPhotos(feature, entry) {
  var state = {
    names: photoNamesOf(entry.photoName),
    added: [], removed: [], busy: false
  };
  function html() {
    return '<label class="flabel">照片（' + state.names.length + '/' +
      PHOTO_MAX_PER_ENTRY + '）</label>' +
      '<div class="photostrip">' + state.names.map(function (n, i) {
        return '<div class="phcell"><img class="phthumb" data-phname="' + esc(n) +
          '" data-phfeat="' + feature + '" data-phidx="' + i + '" alt="照片">' +
          '<button class="phx" data-phrm="' + i + '" aria-label="移除照片">✕</button></div>';
      }).join('') +
      (state.names.length < PHOTO_MAX_PER_ENTRY
        ? '<button class="phadd" id="ph-add">' + (state.busy ? '上傳中…' : '＋ 加照片') + '</button>'
        : '') +
      '</div>' +
      '<input type="file" id="ph-file" accept="image/*" multiple style="display:none">' +
      '<div class="dim small" style="margin-top:6px">點照片看大圖；照片會存到你的雲端帳號。</div>';
  }
  function render(container) {
    container.innerHTML = html();
    hydrateThumbs(container, function (img) {
      openPhotoViewer(feature, state.names.slice(), +img.getAttribute('data-phidx'));
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-phrm]'), function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-phrm');
        var name = state.names[i];
        state.names.splice(i, 1);
        var ai = state.added.indexOf(name);
        if (ai >= 0) { state.added.splice(ai, 1); PhotoStore.remove(feature, name); }
        else state.removed.push(name);
        render(container);
      });
    });
    var add = $('#ph-add', container), file = $('#ph-file', container);
    if (add && file) {
      add.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        var files = Array.prototype.slice.call(file.files || []);
        file.value = '';
        if (!files.length) return;
        var room = PHOTO_MAX_PER_ENTRY - state.names.length;
        var taken = files.slice(0, room);
        if (files.length > taken.length) {
          toast('每則最多 ' + PHOTO_MAX_PER_ENTRY + ' 張，只加了前 ' + taken.length + ' 張');
        }
        if (!taken.length) return;
        state.busy = true; render(container);
        var chain = Promise.resolve(), failed = 0;
        taken.forEach(function (f) {
          chain = chain.then(function () {
            return compressPhotoCopy(f).then(function (res) {
              if (!res) { failed++; return; }
              var name = entry.id + '_' + Date.now() + '_' + (photoNameSeq++) + '.jpg';
              return PhotoStore.put(feature, name, res.b64, res.size).then(function () {
                state.names.push(name); state.added.push(name);
              }).catch(function () { failed++; });
            }).catch(function () { failed++; });
          });
        });
        chain.then(function () {
          state.busy = false;
          if (failed > 0) toast('有 ' + failed + ' 張照片上傳失敗，其他已加入');
          render(container);
        });
      });
    }
  }
  return {
    state: state,
    render: render,
    commit: function () {
      state.removed.forEach(function (n) { PhotoStore.remove(feature, n); });
      state.removed = []; state.added = [];
    },
    rollback: function () {
      state.added.forEach(function (n) { PhotoStore.remove(feature, n); });
      state.added = [];
    }
  };
}
function noteDisplayTitle(n) {
  if (n.title) return n.title;
  var lines = n.body.split('\n').map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  if (lines.length) return lines[0].length > 20 ? lines[0].slice(0, 20) + '…' : lines[0];
  return '（只有照片）';
}
/* StudyStats port: streak over the union of focus days + review days. */
function studyStreak(focusSessions, studyDays, today) {
  var set = {};
  focusSessions.forEach(function (s) { set[s.dateEpochDay] = true; });
  studyDays.forEach(function (d) { set[d] = true; });
  var n = 0, d = today;
  if (!set[d]) d = today - 1;
  while (set[d]) { n++; d--; }
  return n;
}
function minutesOn(focusSessions, day) {
  return focusSessions.filter(function (s) { return s.dateEpochDay === day; })
    .reduce(function (a, s) { return a + s.minutes; }, 0);
}
function weekMinutes(focusSessions, anyDay) {
  var monday = anyDay - ((anyDay + 3) % 7);
  var out = [];
  for (var i = 0; i < 7; i++) out.push(minutesOn(focusSessions, monday + i));
  return out;
}

/* ============================== auth (Identity Toolkit REST) ======= */
var Auth = {
  session: null, /* {uid, email, idToken, refreshToken, expiresAt} */
  load: function () {
    try { this.session = JSON.parse(localStorage.getItem('sq_session') || 'null'); }
    catch (e) { this.session = null; }
    return this.session;
  },
  save: function (s) {
    this.session = s;
    if (s) localStorage.setItem('sq_session', JSON.stringify(s));
    else localStorage.removeItem('sq_session');
  },
  get signedIn() { return !!this.session; },
  get uid() { return this.session ? this.session.uid : null; },
  get email() { return this.session ? this.session.email : ''; },
  _apply: function (email, resp) {
    var s = {
      uid: resp.localId || resp.user_id,
      email: email,
      idToken: resp.idToken || resp.id_token,
      refreshToken: resp.refreshToken || resp.refresh_token,
      expiresAt: Date.now() + (parseInt(resp.expiresIn || resp.expires_in, 10) || 3600) * 1000
    };
    this.save(s);
    return s;
  },
  _authError: function (data, status) {
    var code = data && data.error && data.error.message ? data.error.message : '';
    var map = {
      'EMAIL_EXISTS': '這個 email 已註冊過，直接登入就好',
      'EMAIL_NOT_FOUND': 'email 或密碼錯誤',
      'INVALID_PASSWORD': 'email 或密碼錯誤',
      'INVALID_LOGIN_CREDENTIALS': 'email 或密碼錯誤',
      'WEAK_PASSWORD': '密碼太弱，至少要 6 碼',
      'INVALID_EMAIL': 'email 格式不對',
      'USER_DISABLED': '這個帳號已被停用',
      'TOO_MANY_ATTEMPTS_TRY_LATER': '試太多次了，先等一下再試'
    };
    var head = code.split(':')[0].trim();
    var err = new Error(map[head] || '登入失敗，請再試一次');
    err.code = head || ('HTTP ' + status);
    return err;
  },
  _post: function (url, body, isForm) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: isForm ? body : JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) throw Auth._authError(data, r.status);
        return data;
      });
    }).catch(function (e) {
      if (e instanceof Error && e.code) throw e;
      var err = new Error('網路連不上，請檢查連線再試'); err.code = 'NETWORK'; throw err;
    });
  },
  signUp: function (email, password) {
    var self = this;
    return this._post(CFG.identityBase + '/accounts:signUp?key=' + CFG.apiKey,
      { email: email, password: password, returnSecureToken: true })
      .then(function (d) { return self._apply(email, d); });
  },
  signIn: function (email, password) {
    var self = this;
    return this._post(CFG.identityBase + '/accounts:signInWithPassword?key=' + CFG.apiKey,
      { email: email, password: password, returnSecureToken: true })
      .then(function (d) { return self._apply(email, d); });
  },
  refresh: function () {
    var self = this;
    if (!this.session) return Promise.reject(new Error('not signed in'));
    var body = 'grant_type=refresh_token&refresh_token=' +
      encodeURIComponent(this.session.refreshToken);
    return this._post(CFG.secureTokenUrl + '?key=' + CFG.apiKey, body, true)
      .then(function (d) { return self._apply(self.session.email, d); });
  },
  /* Valid idToken, refreshing 60 s early like the Android client. */
  token: function () {
    if (!this.session) return Promise.reject(new Error('not signed in'));
    if (Date.now() < this.session.expiresAt - 60000) {
      return Promise.resolve(this.session.idToken);
    }
    return this.refresh().then(function (s) { return s.idToken; });
  },
  signOut: function () { this.save(null); DataStore.clearCache(); }
};

/* ============================== Firestore REST ===================== */
function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(Math.trunc(v)) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  return { stringValue: String(v) };
}
function fsFields(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { out[k] = fsValue(obj[k]); });
  return out;
}
function parseFsValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10) || 0;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) {
    return ((v.arrayValue && v.arrayValue.values) || []).map(parseFsValue);
  }
  return null;
}
function parseFsFields(fields) {
  var out = {};
  if (!fields) return out;
  Object.keys(fields).forEach(function (k) { out[k] = parseFsValue(fields[k]); });
  return out;
}
function fsError(status, body) {
  var st = body && body.error && body.error.status ? body.error.status : '';
  var err = new Error(
    st === 'PERMISSION_DENIED'
      ? '社群功能需要先在 Firebase 更新一次權限設定，更新後就能用了'
      : '雲端連線失敗，請再試一次');
  err.status = st; err.http = status;
  return err;
}
var FS = {
  _req: function (method, url, body) {
    return Auth.token().then(function (token) {
      var opts = {
        method: method,
        headers: { 'Authorization': 'Bearer ' + token }
      };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      return fetch(url, opts).then(function (r) {
        if (r.status === 404) return null;
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) throw fsError(r.status, data);
          return data;
        });
      });
    });
  },
  docUrl: function (path) { return CFG.firestoreBase + '/' + path; },
  getDoc: function (path) {
    return this._req('GET', this.docUrl(path)).then(function (doc) {
      return doc ? parseFsFields(doc.fields) : null;
    });
  },
  patchDoc: function (path, fieldsObj, mask) {
    var url = this.docUrl(path);
    if (mask && mask.length) {
      url += '?' + mask.map(function (f) {
        return 'updateMask.fieldPaths=' + encodeURIComponent(f);
      }).join('&');
    }
    return this._req('PATCH', url, { fields: fsFields(fieldsObj) });
  },
  deleteDoc: function (path) {
    return this._req('DELETE', this.docUrl(path)).catch(function (e) {
      if (e && e.http === 404) return null;
      throw e;
    });
  },
  /* POST creates a doc with a server-generated id (messages). */
  postDoc: function (collectionPath, fieldsObj) {
    return this._req('POST', this.docUrl(collectionPath), { fields: fsFields(fieldsObj) })
      .then(function (doc) {
        if (!doc) throw fsError(0, null);
        var id = (doc.name || '').split('/').pop();
        return { id: id, fields: parseFsFields(doc.fields) };
      });
  },
  listCollection: function (path, query) {
    var url = this.docUrl(path) + '?' + (query || 'pageSize=300');
    return this._req('GET', url).then(function (data) {
      var docs = (data && data.documents) || [];
      return docs.map(function (d) {
        return { id: (d.name || '').split('/').pop(), fields: parseFsFields(d.fields) };
      });
    });
  },
  runQuery: function (collectionId, field, op, value, limit) {
    var body = {
      structuredQuery: {
        from: [{ collectionId: collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: field }, op: op, value: fsValue(value)
          }
        },
        limit: limit || 100
      }
    };
    return Auth.token().then(function (token) {
      return fetch(CFG.firestoreBase + ':runQuery', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) throw fsError(r.status, Array.isArray(data) ? data[0] : data);
          var out = [];
          (data || []).forEach(function (row) {
            if (row.document) {
              out.push({
                id: (row.document.name || '').split('/').pop(),
                fields: parseFsFields(row.document.fields)
              });
            }
          });
          return out;
        });
      });
    });
  },
  /* users/{uid}/data/{feature} payload docs (Android FirestoreClient). */
  getData: function (feature) {
    var uid = Auth.uid;
    return this.getDoc('users/' + uid + '/data/' + feature).then(function (f) {
      if (!f || typeof f.payload !== 'string') return null;
      return { payload: f.payload, updatedAt: f.updatedAt || 0 };
    });
  },
  putData: function (feature, payload, updatedAt) {
    var uid = Auth.uid;
    return this.patchDoc('users/' + uid + '/data/' + feature,
      { payload: payload, updatedAt: updatedAt }, null);
  }
};

/* ============================== DataStore ==========================
   Per-feature payload with the Android last-write-wins rule: the local
   cache (localStorage) carries the updatedAt it was synced at; a cloud
   doc wins when its updatedAt is newer, local edits upload at once. */
var DataStore = {
  _key: function (feature) { return 'sq_data_' + Auth.uid + '_' + feature; },
  readCache: function (feature) {
    try {
      var raw = localStorage.getItem(this._key(feature));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  writeCache: function (feature, payload, updatedAt) {
    localStorage.setItem(this._key(feature),
      JSON.stringify({ payload: payload, updatedAt: updatedAt }));
  },
  /* Resolve the effective payload: cloud vs cache by updatedAt. */
  load: function (feature) {
    var cache = this.readCache(feature);
    if (!Auth.signedIn) {
      return Promise.resolve(cache ? cache.payload : null);
    }
    var self = this;
    return FS.getData(feature).then(function (cloud) {
      if (!cloud) {
        if (cache && cache.payload != null) {
          /* Cloud doc absent: seed it from the local cache. */
          return FS.putData(feature, cache.payload, cache.updatedAt || Date.now())
            .then(function () { return cache.payload; })
            .catch(function () { return cache.payload; });
        }
        return null;
      }
      if (cache && cache.payload === cloud.payload) {
        self.writeCache(feature, cloud.payload, cloud.updatedAt);
        return cloud.payload;
      }
      if (!cache || cloud.updatedAt > (cache.updatedAt || 0)) {
        self.writeCache(feature, cloud.payload, cloud.updatedAt);
        return cloud.payload;
      }
      /* Local newer, or tied timestamps with different payloads:
         the local side wins (same rule as Android v3.0.1). */
      return FS.putData(feature, cache.payload, cache.updatedAt || Date.now())
        .then(function () { return cache.payload; })
        .catch(function () { return cache.payload; });
    }).catch(function () { return cache ? cache.payload : null; });
  },
  save: function (feature, payload) {
    var now = Date.now();
    this.writeCache(feature, payload, now);
    if (!Auth.signedIn) return Promise.resolve();
    return FS.putData(feature, payload, now).catch(function () { /* retried next load */ });
  },
  clearCache: function () {
    Object.keys(localStorage).filter(function (k) { return k.indexOf('sq_data_') === 0; })
      .forEach(function (k) { localStorage.removeItem(k); });
  }
};

/* ============================== social (port of SocialClient) ====== */
var FRIEND_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function friendCodeDerive(uid, salt) {
  return crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(uid + '#' + (salt || 0))).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var out = '';
      for (var i = 0; i < 8; i++) out += FRIEND_ALPHABET[bytes[i] % FRIEND_ALPHABET.length];
      return out;
    });
}
function friendCodeFormat(code) {
  return code && code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : code;
}
function friendCodeNormalize(raw) {
  return (raw || '').toUpperCase().split('').filter(function (ch) {
    return FRIEND_ALPHABET.indexOf(ch) >= 0;
  }).join('');
}
function nicknameValidate(raw) {
  if (raw == null) return null;
  var n = String(raw).trim();
  if (!n || n.length > 20) return null;
  if (/[\n\r\t]/.test(n)) return null;
  return n;
}
function nicknameSuggest(email) {
  var prefix = (email || '').split('@')[0].trim().replace(/[\s\n\r\t]/g, '');
  return nicknameValidate(prefix) || '同學';
}
var Social = {
  getProfile: function (uid) {
    return FS.getDoc('profiles/' + uid).then(function (f) {
      if (!f || !f.nickname || !f.friendCode) return null;
      return { uid: uid, nickname: f.nickname, friendCode: f.friendCode, updatedAt: f.updatedAt || 0 };
    });
  },
  saveProfile: function (p) {
    return FS.patchDoc('profiles/' + p.uid,
      { nickname: p.nickname, friendCode: p.friendCode, updatedAt: p.updatedAt }, null);
  },
  findByFriendCode: function (code) {
    return FS.runQuery('profiles', 'friendCode', 'EQUAL', code, 5).then(function (rows) {
      if (!rows.length) return null;
      var f = rows[0].fields;
      if (!f.nickname || !f.friendCode) return null;
      return { uid: rows[0].id, nickname: f.nickname, friendCode: f.friendCode, updatedAt: f.updatedAt || 0 };
    });
  },
  ensureProfile: function (uid, nickname, now) {
    var self = this;
    return this.getProfile(uid).then(function (existing) {
      if (existing) {
        if (existing.nickname === nickname) return existing;
        var updated = { uid: uid, nickname: nickname, friendCode: existing.friendCode, updatedAt: now };
        return self.saveProfile(updated).then(function () { return updated; });
      }
      var salt = 0;
      function trySalt() {
        if (salt >= 8) {
          return friendCodeDerive(uid, 0).then(function (code) {
            var p = { uid: uid, nickname: nickname, friendCode: code, updatedAt: now };
            return self.saveProfile(p).then(function () { return p; });
          });
        }
        return friendCodeDerive(uid, salt).then(function (code) {
          return self.findByFriendCode(code).then(function (owner) {
            if (!owner || owner.uid === uid) {
              var p = { uid: uid, nickname: nickname, friendCode: code, updatedAt: now };
              return self.saveProfile(p).then(function () { return p; });
            }
            salt++;
            return trySalt();
          });
        });
      }
      return trySalt();
    });
  },
  /* ---- friend requests / friendships ---- */
  _parseRequest: function (f) {
    if (!f.fromUid || !f.toUid) return null;
    return {
      fromUid: f.fromUid, toUid: f.toUid, fromNick: f.fromNick || '',
      toNick: f.toNick || '', status: f.status || 'PENDING', createdAt: f.createdAt || 0,
      id: f.fromUid + '__' + f.toUid
    };
  },
  sendRequest: function (req) {
    return FS.patchDoc('friend_requests/' + req.fromUid + '__' + req.toUid, {
      fromUid: req.fromUid, toUid: req.toUid, fromNick: req.fromNick,
      toNick: req.toNick, status: req.status, createdAt: req.createdAt
    }, null);
  },
  listIncoming: function (uid) {
    var self = this;
    return FS.runQuery('friend_requests', 'toUid', 'EQUAL', uid, 100)
      .then(function (rows) { return rows.map(function (r) { return self._parseRequest(r.fields); }).filter(Boolean); });
  },
  listOutgoing: function (uid) {
    var self = this;
    return FS.runQuery('friend_requests', 'fromUid', 'EQUAL', uid, 100)
      .then(function (rows) { return rows.map(function (r) { return self._parseRequest(r.fields); }).filter(Boolean); });
  },
  setRequestStatus: function (req, status) {
    if (req.status !== 'PENDING' || (status !== 'ACCEPTED' && status !== 'DECLINED')) {
      return Promise.reject(new Error('illegal friend request transition'));
    }
    return FS.patchDoc('friend_requests/' + req.id, { status: status }, ['status']);
  },
  createFriendship: function (fs) {
    return FS.patchDoc('friendships/' + fs.uidA + '__' + fs.uidB, {
      uidA: fs.uidA, uidB: fs.uidB, nickA: fs.nickA, nickB: fs.nickB, since: fs.since
    }, null);
  },
  listFriendships: function (uid) {
    function parse(f) {
      if (!f.uidA || !f.uidB) return null;
      return { uidA: f.uidA, uidB: f.uidB, nickA: f.nickA || '', nickB: f.nickB || '', since: f.since || 0 };
    }
    var byId = {};
    return Promise.all([
      FS.runQuery('friendships', 'uidA', 'EQUAL', uid, 200),
      FS.runQuery('friendships', 'uidB', 'EQUAL', uid, 200)
    ]).then(function (res) {
      res[0].concat(res[1]).forEach(function (r) {
        var f = parse(r.fields);
        if (f) byId[f.uidA + '__' + f.uidB] = f;
      });
      return Object.keys(byId).map(function (k) { return byId[k]; });
    });
  },
  /* ---- presence ---- */
  putPresence: function (e) {
    return FS.patchDoc('presence/' + e.uid, {
      nickname: e.nickname, subject: e.subject,
      startedAt: e.startedAt, heartbeatAt: e.heartbeatAt
    }, null);
  },
  heartbeat: function (uid, now) {
    return FS.patchDoc('presence/' + uid, { heartbeatAt: now }, ['heartbeatAt']);
  },
  deletePresence: function (uid) {
    return FS.deleteDoc('presence/' + uid);
  },
  listPresence: function () {
    return FS.listCollection('presence',
      'pageSize=300&mask.fieldPaths=nickname&mask.fieldPaths=subject&mask.fieldPaths=startedAt&mask.fieldPaths=heartbeatAt')
      .then(function (rows) {
        return rows.map(function (r) {
          var f = r.fields;
          if (!f.nickname) return null;
          return {
            uid: r.id, nickname: f.nickname, subject: f.subject || '',
            startedAt: f.startedAt || 0, heartbeatAt: f.heartbeatAt || 0
          };
        }).filter(Boolean);
      });
  },
  /* ---- threads + messages ---- */
  _parseThread: function (f) {
    if (!f.uidLo || !f.uidHi) return null;
    return {
      uidLo: f.uidLo, uidHi: f.uidHi, nickLo: f.nickLo || '', nickHi: f.nickHi || '',
      createdBy: f.createdBy || '', lastText: f.lastText || '',
      lastType: f.lastType || 'TEXT', lastFrom: f.lastFrom || '', lastAt: f.lastAt || 0,
      acceptedLo: !!f.acceptedLo, acceptedHi: !!f.acceptedHi,
      hiddenLo: !!f.hiddenLo, hiddenHi: !!f.hiddenHi,
      readLo: f.readLo || 0, readHi: f.readHi || 0,
      unreadLo: f.unreadLo || 0, unreadHi: f.unreadHi || 0,
      id: f.uidLo + '__' + f.uidHi
    };
  },
  getThread: function (id) {
    var self = this;
    return FS.getDoc('threads/' + id).then(function (f) {
      return f ? self._parseThread(f) : null;
    });
  },
  putThread: function (t) {
    return FS.patchDoc('threads/' + t.id, {
      participants: [t.uidLo, t.uidHi], uidLo: t.uidLo, uidHi: t.uidHi,
      nickLo: t.nickLo, nickHi: t.nickHi, createdBy: t.createdBy,
      lastText: t.lastText, lastType: t.lastType, lastFrom: t.lastFrom, lastAt: t.lastAt,
      acceptedLo: t.acceptedLo, acceptedHi: t.acceptedHi,
      hiddenLo: t.hiddenLo, hiddenHi: t.hiddenHi,
      readLo: t.readLo, readHi: t.readHi, unreadLo: t.unreadLo, unreadHi: t.unreadHi
    }, null);
  },
  patchThread: function (id, fieldsObj, mask) {
    return FS.patchDoc('threads/' + id, fieldsObj, mask);
  },
  listThreads: function (uid) {
    var self = this;
    return FS.runQuery('threads', 'participants', 'ARRAY_CONTAINS', uid, 100)
      .then(function (rows) {
        return rows.map(function (r) { return self._parseThread(r.fields); })
          .filter(Boolean)
          .sort(function (a, b) { return b.lastAt - a.lastAt; });
      });
  },
  listMessages: function (threadId, limit) {
    return FS.listCollection('threads/' + threadId + '/messages',
      'pageSize=' + (limit || 100) + '&orderBy=' + encodeURIComponent('createdAt desc'))
      .then(function (rows) {
        return rows.map(function (r) {
          var f = r.fields;
          if (!f.fromUid) return null;
          return {
            id: r.id, fromUid: f.fromUid, type: f.type || 'TEXT',
            text: f.text || '', stickerId: f.stickerId || '', createdAt: f.createdAt || 0
          };
        }).filter(Boolean).reverse();
      });
  },
  postMessage: function (threadId, msg) {
    return FS.postDoc('threads/' + threadId + '/messages', {
      fromUid: msg.fromUid, type: msg.type, text: msg.text,
      stickerId: msg.stickerId, createdAt: msg.createdAt
    });
  },
  /* ---- block list (own tree data doc, feature "blocks") ---- */
  getBlocks: function () {
    return FS.getData('blocks').then(function (d) {
      return d ? parseBlocks(d.payload) : [];
    });
  },
  putBlocks: function (entries, now) {
    return FS.putData('blocks', writeBlocks(entries), now);
  }
};
/* Thread helpers (port of ThreadDoc / ThreadClassifier). */
function threadOtherUid(t, me) { return me === t.uidLo ? t.uidHi : t.uidLo; }
function threadOtherNick(t, me) { return me === t.uidLo ? t.nickHi : t.nickLo; }
function threadSuffix(t, uid) { return uid === t.uidLo ? 'Lo' : 'Hi'; }
function threadAcceptedBy(t, uid) { return uid === t.uidLo ? t.acceptedLo : t.acceptedHi; }
function threadHiddenFor(t, uid) { return uid === t.uidLo ? t.hiddenLo : t.hiddenHi; }
function threadUnreadFor(t, uid) { return uid === t.uidLo ? t.unreadLo : t.unreadHi; }
function threadClassify(t, me, friendUids, blockedUids) {
  if (threadHiddenFor(t, me)) return 'HIDDEN';
  var other = threadOtherUid(t, me);
  if (blockedUids.indexOf(other) >= 0) return 'HIDDEN';
  if (friendUids.indexOf(other) >= 0) return 'MAIN';
  if (threadAcceptedBy(t, me)) return 'MAIN';
  if (t.createdBy === me) return 'MAIN';
  return 'STRANGER';
}
function threadWaitingAcceptance(t, me, friendUids) {
  if (t.createdBy !== me) return false;
  var other = threadOtherUid(t, me);
  return friendUids.indexOf(other) < 0 && !threadAcceptedBy(t, other);
}
function threadFresh(me, myNick, other, otherNick) {
  var loFirst = me < other;
  return {
    uidLo: loFirst ? me : other, uidHi: loFirst ? other : me,
    nickLo: loFirst ? myNick : otherNick, nickHi: loFirst ? otherNick : myNick,
    createdBy: me, lastText: '', lastType: 'TEXT', lastFrom: '', lastAt: 0,
    acceptedLo: loFirst, acceptedHi: !loFirst,
    hiddenLo: false, hiddenHi: false, readLo: 0, readHi: 0, unreadLo: 0, unreadHi: 0,
    id: (loFirst ? me : other) + '__' + (loFirst ? other : me)
  };
}
var PRESENCE_STALE_MS = 180000;
function presenceLive(list, now) {
  return list.filter(function (e) { return now - e.heartbeatAt <= PRESENCE_STALE_MS; });
}

/* ============================== app state / shell ================== */
var App = {
  tab: 'home',
  profile: null,
  ai: null, /* effective AI settings applied from the cloud account */
  friendships: [],
  blocks: [],
  threads: [],
  presence: [],
  announcements: null,
  data: { notes: [], mistakes: [], flashcards: [], focus: [], studyDays: [] },
  dataReady: false,
  timers: [],
  chatPeer: null, /* {uid, nick} when a chat is open */
  msgZone: 'MAIN'
};
function clearTimers() {
  App.timers.forEach(function (t) { clearInterval(t); });
  App.timers = [];
}
function every(sec, fn) {
  var t = setInterval(fn, sec * 1000);
  App.timers.push(t);
  return t;
}
function friendUids() {
  if (!Auth.uid) return [];
  return App.friendships.map(function (f) { return f.uidA === Auth.uid ? f.uidB : f.uidA; });
}
function blockedUids() { return App.blocks.map(function (b) { return b.uid; }); }
function totalUnread() {
  if (!Auth.uid) return 0;
  var fu = friendUids(), bu = blockedUids(), me = Auth.uid, n = 0;
  App.threads.forEach(function (t) {
    if (threadClassify(t, me, fu, bu) !== 'HIDDEN') n += threadUnreadFor(t, me);
  });
  return n;
}
function loadSocialBasics() {
  if (!Auth.signedIn) return Promise.resolve();
  var me = Auth.uid;
  return Promise.all([
    Social.getProfile(me).then(function (p) { App.profile = p; }).catch(function () {}),
    Social.listFriendships(me).then(function (f) { App.friendships = f; }).catch(function () {}),
    Social.getBlocks().then(function (b) { App.blocks = b; }).catch(function () {}),
    Social.listThreads(me).then(function (t) { App.threads = t; }).catch(function () {})
  ]);
}
function loadStudyData() {
  if (!Auth.signedIn) { App.dataReady = true; return Promise.resolve(); }
  return Promise.all([
    DataStore.load('notes'), DataStore.load('mistakes'),
    DataStore.load('flashcards'), DataStore.load('focus'),
    DataStore.load('study_days')
  ]).then(function (r) {
    App.data.notes = parseNotes(r[0]);
    App.data.mistakes = parseMistakes(r[1]);
    App.data.flashcards = parseFlashcards(r[2]);
    App.data.focus = parseFocus(r[3]);
    App.data.studyDays = parseStudyDays(r[4]);
    App.dataReady = true;
  });
}
function saveFeature(feature, payload) { return DataStore.save(feature, payload); }
function recordStudyDay() {
  var today = epochDayToday();
  if (App.data.studyDays.indexOf(today) < 0) {
    App.data.studyDays.push(today);
    return saveFeature('study_days', writeStudyDays(App.data.studyDays));
  }
  return Promise.resolve();
}

var TABS = [
  { id: 'home', icon: '🏠', label: '首頁' },
  { id: 'room', icon: '📚', label: '一起讀書' },
  { id: 'learn', icon: '✏️', label: '學習' },
  { id: 'msg', icon: '💬', label: '訊息' },
  { id: 'me', icon: '👤', label: '我的' }
];
function renderTabbar() {
  var unread = totalUnread();
  $('#tabbar').innerHTML = '<div class="inner">' + TABS.map(function (t) {
    var badge = t.id === 'msg' && unread > 0
      ? '<span class="badge nbadge">' + (unread > 99 ? '99+' : unread) + '</span>' : '';
    return '<button data-tab="' + t.id + '" class="' + (App.tab === t.id ? 'on' : '') + '">' +
      '<span class="ic">' + t.icon + '</span>' + esc(t.label) + badge + '</button>';
  }).join('') + '</div>';
  Array.prototype.forEach.call($('#tabbar').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { go(b.getAttribute('data-tab')); });
  });
}
function go(tab) {
  App.tab = tab;
  App.chatPeer = null;
  clearTimers();
  renderTabbar();
  var root = $('#app');
  window.scrollTo(0, 0);
  if (tab === 'home') viewHome(root);
  else if (tab === 'room') viewRoom(root);
  else if (tab === 'learn') viewLearn(root);
  else if (tab === 'msg') viewMessages(root);
  else if (tab === 'me') viewMe(root);
}
function brandHeader(extra) {
  return '<header class="brand"><h1>Study QAQ</h1>' +
    '<div class="sub">惠文高一公告 ・ 學習 ・ 一起讀書</div>' + (extra || '') + '</header>';
}
function needLoginHtml(what) {
  return brandHeader() + '<div class="card"><h3>先登入才能用' + esc(what) + '</h3>' +
    '<p class="hint">登入後就能使用學習與社群功能，資料會跟著你的帳號同步。</p>' +
    '<button class="btn cta" onclick="go(\'me\')">去登入 / 註冊</button></div>';
}
/* Set by editors that need cleanup when the modal closes without
   saving (photo editors roll back their session uploads). Cleared by
   the editor itself once it has saved. */
var ModalOnClose = null;
function openModal(html) {
  $('#modal-root').innerHTML = '<div class="modal"><div class="sheet">' + html + '</div></div>';
  $('.modal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });
}
function closeModal() {
  $('#modal-root').innerHTML = '';
  if (ModalOnClose) {
    var f = ModalOnClose; ModalOnClose = null;
    try { f(); } catch (e) { /* cleanup is best-effort */ }
  }
}
function modalHead(title, sub) {
  return '<div class="rowline"><div class="grow"><h3>' + esc(title) + '</h3>' +
    (sub ? '<div class="dim small">' + esc(sub) + '</div>' : '') + '</div>' +
    '<button class="btn ghost small" onclick="closeModal()">✕</button></div>';
}

/* ============================== home =============================== */
function viewHome(root) {
  var name = App.profile ? App.profile.nickname
    : (Auth.signedIn ? nicknameSuggest(Auth.email) : '同學');
  root.innerHTML = brandHeader(
    '<div class="greet">嗨，' + esc(name) + ' 👋</div><div class="chips" id="home-chips">' +
    '<span class="chip">載入中…</span></div>') +
    '<div class="card"><a class="biglink" href="javascript:void(0)" id="go-room">' +
    '<div style="font-size:30px">📚</div><div class="grow"><div class="ttl">一起讀書</div>' +
    '<div class="dim small" id="room-line">看看誰正在讀書</div></div>' +
    '<div class="chev">›</div></a></div>' +
    '<div class="card"><a class="biglink" href="javascript:void(0)" id="go-msg">' +
    '<div style="font-size:30px">💬</div><div class="grow"><div class="ttl">訊息 <span id="msg-badge"></span></div>' +
    '<div class="dim small" id="msg-line">好友與陌生訊息</div></div>' +
    '<div class="chev">›</div></a></div>' +
    '<h2 class="secttl">期限雷達</h2><div id="radar"><div class="card sub"><span class="dim">載入公告中…</span></div></div>' +
    '<h2 class="secttl">公告</h2><div id="annc-list"></div>' +
    '<footer class="legal">資料來源：臺中市立惠文高中官網，每兩天巡查更新（<span id="annc-date"></span>）。點公告會開官網原文。</footer>';
  $('#go-room').addEventListener('click', function () { go('room'); });
  $('#go-msg').addEventListener('click', function () { go('msg'); });

  /* chips from study data */
  loadStudyData().then(function () {
    var today = epochDayToday();
    var due = App.data.flashcards.filter(function (c) {
      return reviewIsDue({ interval: c.reviewIntervalDays, due: c.reviewDueEpochDay, streak: c.reviewStreak }, today);
    }).length + App.data.mistakes.filter(function (m) {
      return reviewIsDue({ interval: m.reviewIntervalDays, due: m.reviewDueEpochDay, streak: m.reviewStreak }, today);
    }).length;
    var streak = studyStreak(App.data.focus, App.data.studyDays, today);
    var mins = minutesOn(App.data.focus, today);
    var chips = '';
    if (streak > 0) chips += '<span class="chip hot">🔥 連續學習 <b>' + streak + ' 天</b></span>';
    chips += due > 0
      ? '<span class="chip hot">📖 今日複習 <b>' + due + ' 項</b></span>'
      : '<span class="chip">📖 今日複習 <b>完成</b></span>';
    chips += '<span class="chip">⏱ 今日專注 <b>' + mins + ' 分鐘</b></span>';
    var box = $('#home-chips');
    if (box) box.innerHTML = chips;
  });
  /* social summary lines */
  if (Auth.signedIn) {
    loadSocialBasics().then(function () {
      renderTabbar();
      var un = totalUnread();
      var ml = $('#msg-line'), mb = $('#msg-badge');
      if (ml) ml.textContent = un > 0 ? '有 ' + un + ' 則未讀訊息' : '沒有未讀訊息';
      if (mb && un > 0) mb.innerHTML = '<span class="badge">' + un + '</span>';
    });
    Social.listPresence().then(function (list) {
      var live = presenceLive(list, Date.now())
        .filter(function (e) { return e.uid !== Auth.uid; }).length;
      var rl = $('#room-line');
      if (rl) rl.textContent = live > 0 ? '目前 ' + live + ' 人正在讀書' : '目前還沒有人在讀書，來當第一個';
    }).catch(function () {});
  }
  /* announcements */
  fetch('announcements.json').then(function (r) { return r.json(); }).then(function (data) {
    App.announcements = data;
    renderAnnouncements();
  }).catch(function () {
    var r = $('#radar');
    if (r) r.innerHTML = '<div class="card sub"><span class="dim">公告載入失敗（可能離線），下拉重整再試。</span></div>';
  });
}
function renderAnnouncements() {
  var data = App.announcements;
  if (!data) return;
  var dateEl = $('#annc-date');
  if (dateEl) dateEl.textContent = '更新：' + (data.updatedAt || '');
  var todayStr = new Date().toISOString().slice(0, 10);
  var items = data.items.slice();
  var withDl = items.filter(function (x) { return x.deadline && x.deadline >= todayStr; })
    .sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
  function daysLeft(dl) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var target = new Date(dl + 'T00:00:00');
    return Math.round((target - t) / 86400000);
  }
  var radar = $('#radar');
  if (radar) {
    if (!withDl.length) {
      radar.innerHTML = '<div class="card sub"><span class="dim">目前沒有即將到期的期限。</span></div>';
    } else {
      var first = withDl[0], dl0 = daysLeft(first.deadline);
      var html = '<div class="card"><div class="dim small">' + esc(first.deadline_label || '截止') +
        ' ・ ' + esc(first.deadline) + '</div><div class="countbig">' + dl0 + ' 天</div>' +
        '<div style="font-size:17px;font-weight:600;line-height:1.45">' + esc(first.title) + '</div></div>';
      html += withDl.slice(1, 6).map(function (x) {
        var d = daysLeft(x.deadline);
        return '<div class="card sub annc ' + (d <= 3 ? 'urgent' : (d <= 10 ? 'soon' : '')) + '">' +
          '<div class="rowline"><div class="grow ttl" style="font-size:15px">' + esc(x.title) + '</div>' +
          '<b class="' + (d <= 10 ? 'salmon' : '') + '">' + d + ' 天</b></div>' +
          '<div class="dim small">' + esc(x.deadline_label || '') + ' ・ ' + esc(x.deadline) + '</div></div>';
      }).join('');
      radar.innerHTML = html;
    }
  }
  var list = $('#annc-list');
  if (list) {
    list.innerHTML = items.map(function (x) {
      var d = x.deadline ? daysLeft(x.deadline) : null;
      var urg = d !== null && d >= 0 ? (d <= 3 ? 'urgent' : (d <= 10 ? 'soon' : '')) : '';
      return '<div class="card annc ' + urg + '"><div class="rowline">' +
        '<span class="pill line">' + esc(x.topic || '其他') + '</span>' +
        (x.isNew ? '<span class="pill salmon">NEW</span>' : '') +
        (x.deadline ? '<span class="dim small">' + esc(x.deadline_label || '') + ' ' + esc(x.deadline) +
          (d !== null && d >= 0 ? '（剩 ' + d + ' 天）' : '') + '</span>' : '') + '</div>' +
        '<div class="ttl" style="margin-top:8px"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' +
        esc(x.title) + '</a></div>' +
        (x.summary ? '<div class="sum">' + esc(x.summary) + '</div>' : '') + '</div>';
    }).join('');
  }
}

/* ============================== me / account ======================= */
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t);
  }
  return new Promise(function (resolve, reject) {
    var ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
    catch (e) { reject(e); }
    document.body.removeChild(ta);
  });
}
function viewMe(root) {
  if (!Auth.signedIn) {
    root.innerHTML = brandHeader() +
      '<div class="card"><h3 id="auth-title">登入</h3>' +
      '<p class="hint">用你的 email 帳號登入。第一次用請先註冊，資料會跟著帳號同步。</p>' +
      '<label class="flabel">Email</label><input id="auth-email" type="email" autocomplete="email" placeholder="you@example.com">' +
      '<label class="flabel">密碼</label><input id="auth-pass" type="password" autocomplete="current-password" placeholder="至少 6 碼">' +
      '<div class="err" id="auth-err" style="margin-top:10px"></div>' +
      '<div style="height:12px"></div>' +
      '<button class="btn cta" id="auth-go">登入</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn ghost block" id="auth-swap">還沒有帳號？改成註冊</button></div>' +
      '<footer class="legal">登入後：公告、筆記、錯題、閃卡、專注紀錄都會跟著你的帳號同步；好友、一起讀書、訊息也都能使用。</footer>';
    var mode = 'in';
    $('#auth-swap').addEventListener('click', function () {
      mode = mode === 'in' ? 'up' : 'in';
      $('#auth-title').textContent = mode === 'in' ? '登入' : '註冊';
      $('#auth-go').textContent = mode === 'in' ? '登入' : '註冊';
      this.textContent = mode === 'in' ? '還沒有帳號？改成註冊' : '已經有帳號？改成登入';
    });
    $('#auth-go').addEventListener('click', function () {
      var email = $('#auth-email').value.trim();
      var pass = $('#auth-pass').value;
      var err = $('#auth-err');
      err.textContent = '';
      if (!email || !pass) { err.textContent = 'email 和密碼都要填'; return; }
      this.disabled = true;
      var p = mode === 'in' ? Auth.signIn(email, pass) : Auth.signUp(email, pass);
      p.then(function () {
        return Promise.all([loadSocialBasics(), loadStudyData(), syncAiSettings()]);
      }).then(function () { toast('登入成功'); go('me'); })
        .catch(function (e) { err.textContent = e.message || '失敗，請再試一次'; })
        .finally(function () { var b = $('#auth-go'); if (b) b.disabled = false; });
    });
    return;
  }
  var me = Auth.uid;
  root.innerHTML = brandHeader() +
    '<div class="card"><h3>帳號詳情</h3>' +
    '<label class="flabel">登入 email</label><div style="font-size:16px">' + esc(Auth.email) + '</div>' +
    '<p class="hint" style="margin-top:10px">別人看到的只有暱稱與好友代碼，不會看到你的 email。</p>' +
    '<label class="flabel">暱稱（公開顯示）</label><input id="nick" maxlength="20" value="' +
    esc(App.profile ? App.profile.nickname : nicknameSuggest(Auth.email)) + '">' +
    '<label class="flabel">我的好友代碼</label>' +
    '<div class="rowline"><div class="serif grow" style="font-size:26px;letter-spacing:2px" id="mycode">' +
    (App.profile ? esc(friendCodeFormat(App.profile.friendCode)) : '（儲存暱稱後產生）') + '</div>' +
    '<button class="btn peri" id="copy-code"' + (App.profile ? '' : ' disabled') + '>複製</button></div>' +
    '<div style="height:12px"></div><button class="btn peri block" id="save-nick">儲存暱稱</button>' +
    '<div class="err" id="nick-err"></div></div>' +
    '<div class="card"><h3>加好友</h3>' +
    '<label class="flabel">輸入對方的好友代碼</label>' +
    '<div class="rowline"><input id="add-code" class="grow" placeholder="例如 ABCD-EFGH" autocapitalize="characters">' +
    '<button class="btn peri" id="add-btn">搜尋</button></div>' +
    '<div id="add-result" style="margin-top:10px"></div></div>' +
    '<div class="card"><h3>好友邀請</h3><div id="req-list"><span class="dim">載入中…</span></div></div>' +
    '<div class="card"><h3>好友</h3><div id="friend-list"><span class="dim">載入中…</span></div></div>' +
    '<div class="card"><h3>設定</h3>' +
    '<button class="btn ghost block" id="signout">登出</button></div>' +
    '<div class="card sub"><h3>把 Study QAQ 加到主畫面</h3>' +
    '<p class="hint">iPhone：用 Safari 開這個頁面 → 點分享鈕 →「加入主畫面」，桌面就會出現 Study QAQ 圖示，點開跟 App 一樣全螢幕。</p></div>' +
    '<footer class="legal">貼圖：Noto Emoji（Google）— Apache License 2.0，來源 github.com/googlefonts/noto-emoji（網頁版使用同一套圖稿的 SVG 版本）。<br>' +
    '公告資料來源：臺中市立惠文高中官網。登入的帳號與資料會在各裝置間同步。</footer>';
  $('#signout').addEventListener('click', function () {
    Auth.signOut();
    App.ai = null; /* the key leaves memory on sign-out */
    App.profile = null; App.friendships = []; App.threads = []; App.blocks = [];
    App.data = { notes: [], mistakes: [], flashcards: [], focus: [], studyDays: [] };
    renderTabbar(); go('home'); toast('已登出');
  });
  $('#copy-code').addEventListener('click', function () {
    if (!App.profile) return;
    copyText(friendCodeFormat(App.profile.friendCode)).then(function () {
      toast('好友代碼已複製');
    }).catch(function () { toast('複製失敗，請手動抄下代碼'); });
  });
  $('#save-nick').addEventListener('click', function () {
    var nick = nicknameValidate($('#nick').value);
    var err = $('#nick-err');
    if (!nick) { err.textContent = '暱稱要 1–20 字，不能有換行'; return; }
    err.textContent = '';
    this.disabled = true;
    Social.ensureProfile(me, nick, Date.now()).then(function (p) {
      App.profile = p;
      $('#mycode').textContent = friendCodeFormat(p.friendCode);
      var cb = $('#copy-code'); if (cb) cb.disabled = false;
      toast('暱稱已儲存');
    }).catch(function (e) { err.textContent = e.message; })
      .finally(function () { var b = $('#save-nick'); if (b) b.disabled = false; });
  });
  $('#add-btn').addEventListener('click', function () { addFriendByCode(); });
  loadRequestsAndFriends();
}
/* ============================== AI settings sync ===================
   The 自訂 API (OpenAI-compatible) settings follow the cloud account
   in the users/{uid}/data/ai_settings doc. Payload = four lines —
     line 1: legacy source field — encode always writes "deepseek"
             and decode ignores the value entirely (older payloads
             may carry other values; every payload now means the
             自訂 API)
     line 2: 自訂 API key
     line 3: 自訂 API base URL
     line 4: 自訂 API model
   An account's own key only ever lives in that account's Firestore
   doc and this device's local cache. There is deliberately no
   settings form: sign-in applies the account's settings
   automatically. When neither the account nor the cache supplies
   settings, loadAiSettings falls back to a built-in shared default
   (see builtinAiSettings below); the fallback is assembled at
   runtime, is never written to the local cache, and so can never
   seed-upload into anyone's cloud doc. */
function aiSettingsEncode(p) {
  return [
    'deepseek',
    (p.key || '').trim(),
    (p.baseUrl || '').trim(),
    (p.model || '').trim()
  ].join('\n');
}
/* Parses a cloud payload; null when blank / unusable. Line 1 is the
   legacy source field and is ignored — any value (or none) decodes
   to the 自訂 API; missing lines are ''. */
function aiSettingsDecode(payload) {
  if (!payload || !String(payload).trim()) return null;
  var lines = String(payload).split('\n');
  function line(i) { return i < lines.length ? lines[i].trim() : ''; }
  return {
    source: 'deepseek',
    key: line(1),
    baseUrl: line(2),
    model: line(3)
  };
}
/* The device-local cache (sq_ai). Written only from applied cloud
   settings (or a pre-sync form save); kept across sign-out, like the
   Android device stores — sign-out clears only the in-memory copy. */
function readLocalAi() {
  try {
    var saved = JSON.parse(localStorage.getItem('sq_ai') || 'null');
    if (!saved) return null;
    return {
      key: saved.key || '', baseUrl: saved.baseUrl || '', model: saved.model || ''
    };
  } catch (e) { return null; }
}
function applyAiSettings(p) {
  App.ai = p;
  try {
    localStorage.setItem('sq_ai', JSON.stringify({
      baseUrl: p.baseUrl, model: p.model, key: p.key
    }));
  } catch (e) { /* the cache is best-effort */ }
}
/* Runs on sign-in (and at boot with a restored session): a cloud
   payload wins — it is applied and cached locally; no cloud doc but
   a stored local cache seeds the cloud once (the Android seed rule).
   The seed decision reads only the real local cache — the built-in
   fallback is never seeded. Neither side has anything → App.ai
   stays null and loadAiSettings falls back to the built-in default.
   A network failure leaves the local cache in charge (see
   loadAiSettings). */
function syncAiSettings() {
  if (!Auth.signedIn) return Promise.resolve(null);
  return FS.getData('ai_settings').then(function (cloud) {
    var p = cloud ? aiSettingsDecode(cloud.payload) : null;
    if (p) { applyAiSettings(p); return p; }
    var local = readLocalAi();
    if (local && (local.key || local.baseUrl || local.model)) {
      var seeded = {
        source: 'deepseek', key: local.key,
        baseUrl: local.baseUrl, model: local.model
      };
      applyAiSettings(seeded);
      return FS.putData('ai_settings', aiSettingsEncode(seeded), Date.now())
        .then(function () { return seeded; })
        .catch(function () { return seeded; });
    }
    App.ai = null;
    return null;
  }).catch(function () { return App.ai; });
}
/* Built-in shared fallback settings (owner-provided): used only for
   fields that neither the cloud account nor the device cache
   supplies. The key is stored Base64-wrapped and split into
   segments, assembled here at runtime. Read-only: it is never
   passed to applyAiSettings, so it never enters the local cache
   and never reaches the cloud seed path. */
var BUILTIN_AI_KEY_PARTS = ['c2stZGNlYTIyMzBjYWE', '1YmE2Y2I0ZDIzNTY4OT', 'hlNGMxNDRiMWQwOWI4Z', 'WM0NGUzZmIzMWVkNTk4', 'MTA1ZGVkNWY5Mw=='];
function builtinAiSettings() {
  var key = '';
  try { key = atob(BUILTIN_AI_KEY_PARTS.join('')); } catch (e) { key = ''; }
  return {
    source: 'deepseek',
    key: key,
    baseUrl: 'https://www.wujie-api.com/v1',
    model: 'DeepSeek V4.1 Flash'
  };
}
/* Effective settings for the AI features, in priority order: the
   applied cloud settings, else the device cache, else the built-in
   shared default. Per field, an empty value falls through to the
   built-in default, so AI works for every account out of the box.
   The "no AI settings" guard in the AI views remains as a last
   line of defence should every source come back empty. */
function loadAiSettings() {
  var d = builtinAiSettings();
  var src = App.ai || readLocalAi();
  if (src) {
    if (src.baseUrl) d.baseUrl = src.baseUrl;
    if (src.model) d.model = src.model;
    if (src.key) d.key = src.key;
  }
  return { baseUrl: d.baseUrl, model: d.model, key: d.key };
}
function addFriendByCode() {
  var box = $('#add-result');
  var code = friendCodeNormalize($('#add-code').value);
  if (!App.profile) { box.innerHTML = '<span class="err">先儲存你的暱稱，才能加好友</span>'; return; }
  if (code.length !== 8) { box.innerHTML = '<span class="err">代碼格式不對（8 碼）</span>'; return; }
  box.innerHTML = '<span class="dim">搜尋中…</span>';
  var me = Auth.uid;
  Social.findByFriendCode(code).then(function (target) {
    if (!target) { box.innerHTML = '<span class="err">找不到這個代碼的人</span>'; return; }
    return Promise.all([Social.listOutgoing(me), Social.listIncoming(me)]).then(function (res) {
      var outgoing = res[0], incoming = res[1];
      var fu = friendUids();
      var decision = 'OK';
      if (target.uid === me) decision = 'SELF';
      else if (fu.indexOf(target.uid) >= 0) decision = 'ALREADY_FRIENDS';
      else if (outgoing.some(function (r) { return r.toUid === target.uid && r.status === 'PENDING'; })) decision = 'ALREADY_SENT';
      else if (incoming.some(function (r) { return r.fromUid === target.uid && r.status === 'PENDING'; })) decision = 'INCOMING_PENDING';
      var msgs = {
        SELF: '這是你自己的代碼', ALREADY_FRIENDS: '你們已經是好友了',
        ALREADY_SENT: '已經送出邀請，等對方同意', INCOMING_PENDING: '對方已經邀請你，去下面同意就好'
      };
      if (decision !== 'OK') { box.innerHTML = '<span class="err">' + msgs[decision] + '</span>'; return; }
      box.innerHTML = '<div class="rowline">' + avatarHtml(target.nickname, 'sm') +
        '<div class="grow"><b>' + esc(target.nickname) + '</b></div>' +
        '<button class="btn peri small" id="send-req">送出邀請</button></div>';
      $('#send-req').addEventListener('click', function () {
        Social.sendRequest({
          fromUid: me, toUid: target.uid, fromNick: App.profile.nickname,
          toNick: target.nickname, status: 'PENDING', createdAt: Date.now()
        }).then(function () {
          box.innerHTML = '<span class="okmsg">邀請已送出，等對方同意</span>';
        }).catch(function (e) { box.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
      });
    });
  }).catch(function (e) { box.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
}
function loadRequestsAndFriends() {
  var me = Auth.uid;
  var reqBox = $('#req-list'), friendBox = $('#friend-list');
  Promise.all([
    Social.listIncoming(me), Social.listOutgoing(me),
    Social.listFriendships(me), Social.listPresence().catch(function () { return []; })
  ]).then(function (res) {
    App.friendships = res[2];
    var live = presenceLive(res[3], Date.now());
    var liveByUid = {};
    live.forEach(function (e) { liveByUid[e.uid] = e; });
    var incoming = res[0].filter(function (r) { return r.status === 'PENDING'; });
    var outgoing = res[1].filter(function (r) { return r.status === 'PENDING'; });
    if (reqBox) {
      if (!incoming.length && !outgoing.length) {
        reqBox.innerHTML = '<span class="dim">目前沒有待處理的邀請</span>';
      } else {
        reqBox.innerHTML = incoming.map(function (r) {
          return '<div class="listrow">' + avatarHtml(r.fromNick, 'sm') +
            '<div class="grow ellipsis"><b>' + esc(r.fromNick) + '</b> <span class="dim small">想加你好友</span></div>' +
            '<button class="btn peri small" data-acc="' + esc(r.id) + '">同意</button>' +
            '<button class="btn ghost small" data-dec="' + esc(r.id) + '">拒絕</button></div>';
        }).join('') + outgoing.map(function (r) {
          return '<div class="listrow">' + avatarHtml(r.toNick, 'sm') +
            '<div class="grow ellipsis"><b>' + esc(r.toNick) + '</b> <span class="dim small">等待對方同意…</span></div></div>';
        }).join('');
        incoming.forEach(function (r) {
          var acc = reqBox.querySelector('[data-acc="' + r.id + '"]');
          var dec = reqBox.querySelector('[data-dec="' + r.id + '"]');
          if (acc) acc.addEventListener('click', function () {
            Social.setRequestStatus(r, 'ACCEPTED').then(function () {
              var a = me < r.fromUid ? me : r.fromUid;
              var b = me < r.fromUid ? r.fromUid : me;
              return Social.createFriendship({
                uidA: a, uidB: b,
                nickA: a === me ? (App.profile ? App.profile.nickname : '') : r.fromNick,
                nickB: b === me ? (App.profile ? App.profile.nickname : '') : r.fromNick,
                since: Date.now()
              });
            }).then(function () { toast('已成為好友'); loadRequestsAndFriends(); renderTabbar(); })
              .catch(function (e) { toast(e.message); });
          });
          if (dec) dec.addEventListener('click', function () {
            Social.setRequestStatus(r, 'DECLINED').then(function () {
              toast('已拒絕'); loadRequestsAndFriends();
            }).catch(function (e) { toast(e.message); });
          });
        });
      }
    }
    if (friendBox) {
      if (!App.friendships.length) {
        friendBox.innerHTML = '<span class="dim">還沒有好友，用上面的代碼加第一個吧</span>';
      } else {
        friendBox.innerHTML = App.friendships.map(function (f) {
          var other = f.uidA === me ? f.uidB : f.uidA;
          var nick = f.uidA === me ? f.nickB : f.nickA;
          var p = liveByUid[other];
          return '<div class="listrow">' + avatarHtml(nick, 'sm') +
            '<div class="grow ellipsis"><b>' + esc(nick) + '</b>' +
            (p ? '<div class="small salmon">📚 讀書中 ・ ' + esc(p.subject) + ' ・ ' + fmtElapsed(Date.now() - p.startedAt) + '</div>' : '') +
            '</div><button class="btn peri small" data-msg="' + esc(other) + '" data-nick="' + esc(nick) + '">傳訊息</button></div>';
        }).join('');
        Array.prototype.forEach.call(friendBox.querySelectorAll('[data-msg]'), function (b) {
          b.addEventListener('click', function () {
            openChat(b.getAttribute('data-msg'), b.getAttribute('data-nick'));
          });
        });
      }
    }
  }).catch(function (e) {
    if (reqBox) reqBox.innerHTML = '<span class="err">' + esc(e.message) + '</span>';
  });
}

/* ============================== learn ============================== */
function backToLearn() {
  clearTimers();
  viewLearn($('#app'));
  window.scrollTo(0, 0);
}
function subHead(title) {
  return '<div class="rowline" style="margin:8px 0 14px">' +
    '<button class="btn ghost small" onclick="backToLearn()">‹ 學習</button>' +
    '<h2 class="serif" style="margin:0;font-size:24px">' + esc(title) + '</h2></div>';
}
function dueFlashcards() {
  var today = epochDayToday();
  return App.data.flashcards.filter(function (c) {
    return reviewIsDue({ interval: c.reviewIntervalDays, due: c.reviewDueEpochDay, streak: c.reviewStreak }, today);
  }).sort(function (a, b) { return (a.reviewDueEpochDay - b.reviewDueEpochDay) || (a.createdAt - b.createdAt); });
}
function dueMistakes() {
  var today = epochDayToday();
  return App.data.mistakes.filter(function (m) {
    return reviewIsDue({ interval: m.reviewIntervalDays, due: m.reviewDueEpochDay, streak: m.reviewStreak }, today);
  }).sort(function (a, b) { return (a.reviewDueEpochDay - b.reviewDueEpochDay) || (a.createdAt - b.createdAt); });
}
function applyFlashcardReview(card, grade) {
  var today = epochDayToday();
  var s = reviewSchedule({ interval: card.reviewIntervalDays, due: card.reviewDueEpochDay, streak: card.reviewStreak }, grade, today);
  card.reviewIntervalDays = s.interval; card.reviewDueEpochDay = s.due; card.reviewStreak = s.streak;
  card.mastered = grade === 'KNOWN';
  return saveFeature('flashcards', writeFlashcards(App.data.flashcards));
}
function applyMistakeReview(m, grade) {
  var today = epochDayToday();
  var s = reviewSchedule({ interval: m.reviewIntervalDays, due: m.reviewDueEpochDay, streak: m.reviewStreak }, grade, today);
  m.reviewIntervalDays = s.interval; m.reviewDueEpochDay = s.due; m.reviewStreak = s.streak;
  m.mastered = grade === 'KNOWN';
  m.reviewCount = (m.reviewCount || 0) + 1;
  m.lastReviewedAt = Date.now();
  return saveFeature('mistakes', writeMistakes(App.data.mistakes));
}
function viewLearn(root) {
  if (!Auth.signedIn) { root.innerHTML = needLoginHtml('學習功能'); return; }
  root.innerHTML = brandHeader() + '<div id="learn-body"><div class="card sub"><span class="dim">載入學習資料中…</span></div></div>';
  loadStudyData().then(function () { renderLearnHub(); });
}
function renderLearnHub() {
  var body = $('#learn-body');
  if (!body) return;
  var today = epochDayToday();
  var dc = dueFlashcards().length, dm = dueMistakes().length;
  var streak = studyStreak(App.data.focus, App.data.studyDays, today);
  var mins = minutesOn(App.data.focus, today);
  body.innerHTML =
    '<div class="card"><h3>📖 今日複習</h3>' +
    '<p class="hint">到期的閃卡 ' + dc + ' 張、錯題 ' + dm + ' 題（間隔複習排程跟著帳號同步）。</p>' +
    '<button class="btn cta" id="lh-review" ' + ((dc + dm) === 0 ? 'disabled' : '') + '>開始今日複習</button></div>' +
    '<div class="card"><h3>⏱ 專注計時</h3>' +
    '<p class="hint">今日已專注 ' + mins + ' 分鐘' + (streak > 0 ? ' ・ 🔥 連續學習 ' + streak + ' 天' : '') + '</p>' +
    '<button class="btn peri block" id="lh-focus">開始專注</button></div>' +
    '<div class="card"><h3>🃏 閃卡</h3>' +
    '<p class="hint">共 ' + App.data.flashcards.length + ' 張 ・ 今日到期 ' + dc + ' 張</p>' +
    '<div class="rowline"><button class="btn peri grow" id="lh-cards">管理閃卡</button>' +
    '<button class="btn ghost grow" id="lh-selftest">自測模式</button></div></div>' +
    '<div class="card"><h3>📝 錯題本</h3>' +
    '<p class="hint">共 ' + App.data.mistakes.length + ' 題 ・ 還沒搞懂 ' +
    App.data.mistakes.filter(function (m) { return !m.mastered; }).length + ' 題</p>' +
    '<button class="btn peri block" id="lh-mistakes">管理錯題</button></div>' +
    '<div class="card"><h3>📒 筆記</h3>' +
    '<p class="hint">共 ' + App.data.notes.length + ' 則</p>' +
    '<button class="btn peri block" id="lh-notes">管理筆記</button></div>' +
    '<div class="card"><h3>🤖 AI 學習</h3>' +
    '<p class="hint">用 AI 問問題、整理重點，設定會跟著你的帳號自動帶入。</p>' +
    '<button class="btn peri block" id="lh-ai">開啟 AI</button></div>';
  $('#lh-review').addEventListener('click', startTodayReview);
  $('#lh-focus').addEventListener('click', function () { viewFocus($('#app')); });
  $('#lh-cards').addEventListener('click', function () { viewFlashcards($('#app')); });
  $('#lh-selftest').addEventListener('click', startSelfTestPicker);
  $('#lh-mistakes').addEventListener('click', function () { viewMistakes($('#app')); });
  $('#lh-notes').addEventListener('click', function () { viewNotes($('#app')); });
  $('#lh-ai').addEventListener('click', function () { viewAi($('#app')); });
}
/* ---- today review session (flashcards first, then mistakes) ---- */
function startTodayReview() {
  var queue = dueFlashcards().map(function (c) { return { kind: 'card', item: c }; })
    .concat(dueMistakes().map(function (m) { return { kind: 'mistake', item: m }; }));
  runReviewSession(queue, '今日複習');
}
function runReviewSession(queue, title) {
  var root = $('#app');
  clearTimers();
  var idx = 0, flipped = false, stats = { KNOWN: 0, FUZZY: 0, UNKNOWN: 0 };
  function gradeButtons() {
    return '<div class="rowline" style="margin-top:14px">' +
      '<button class="btn ghost grow" data-g="UNKNOWN">不會</button>' +
      '<button class="btn ghost grow" data-g="FUZZY">模糊</button>' +
      '<button class="btn peri grow" data-g="KNOWN">會</button></div>';
  }
  function render() {
    if (idx >= queue.length) {
      recordStudyDay();
      root.innerHTML = subHead(title) + '<div class="card"><h3>複習完成 🎉</h3>' +
        '<p class="hint">會 ' + stats.KNOWN + ' ・ 模糊 ' + stats.FUZZY + ' ・ 不會 ' + stats.UNKNOWN +
        '。排程已更新，下次到期會再出現。</p>' +
        '<button class="btn cta" onclick="backToLearn()">回學習</button></div>';
      return;
    }
    var q = queue[idx], it = q.item;
    var head = subHead(title) + '<div class="dim small" style="margin-bottom:10px">第 ' +
      (idx + 1) + ' 項 / 共 ' + queue.length + ' 項</div>';
    if (q.kind === 'card') {
      root.innerHTML = head +
        '<div class="flip' + (flipped ? ' flipped' : '') + '" id="flipbox"><div class="flip-inner">' +
        '<div class="flip-face">' + esc(it.front) + '</div>' +
        '<div class="flip-face back">' + esc(it.back) + '</div></div></div>' +
        (flipped ? gradeButtons()
          : '<button class="btn cta" style="margin-top:14px" id="rv-flip">翻面看答案</button>');
      var fb = $('#rv-flip');
      if (fb) fb.addEventListener('click', function () { flipped = true; render(); });
    } else {
      root.innerHTML = head + '<div class="card"><span class="pill line">' + esc(it.subject) + '</span>' +
        photoStripHtml('mistakes', it, 3) +
        '<div style="font-size:18px;line-height:1.55;margin-top:10px;white-space:pre-wrap">' + esc(it.question) + '</div>' +
        (it.myAnswer ? '<div class="dim" style="margin-top:10px">我的答案：' + esc(it.myAnswer) + '</div>' : '') +
        (flipped
          ? '<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">' +
            '<div><b>正確答案</b></div><div style="white-space:pre-wrap;line-height:1.55">' + esc(it.correctAnswer) + '</div>' +
            (it.note ? '<div class="dim" style="margin-top:8px;white-space:pre-wrap">' + esc(it.note) + '</div>' : '') + '</div>' + gradeButtons()
          : '<button class="btn cta" style="margin-top:14px" id="rv-flip">看答案</button>') + '</div>';
      var fb2 = $('#rv-flip');
      if (fb2) fb2.addEventListener('click', function () { flipped = true; render(); });
      wirePhotoThumbs(root);
    }
    Array.prototype.forEach.call(root.querySelectorAll('[data-g]'), function (b) {
      b.addEventListener('click', function () {
        var g = b.getAttribute('data-g');
        stats[g]++;
        var p = q.kind === 'card' ? applyFlashcardReview(it, g) : applyMistakeReview(it, g);
        p.then(function () { idx++; flipped = false; render(); });
      });
    });
  }
  render();
}
/* ---- flashcard self-test (Quizlet-style, 會/不會) ---- */
function startSelfTestPicker() {
  openModal(modalHead('閃卡自測', '翻面後自評會 / 不會，結果直接更新複習排程') +
    '<div style="height:8px"></div>' +
    '<button class="btn cta" id="st-due">今日到期（' + dueFlashcards().length + ' 張）</button>' +
    '<div style="height:10px"></div>' +
    '<button class="btn peri block" id="st-all">全部閃卡（' + App.data.flashcards.length + ' 張）</button>');
  $('#st-due').addEventListener('click', function () { closeModal(); runSelfTest(dueFlashcards()); });
  $('#st-all').addEventListener('click', function () { closeModal(); runSelfTest(App.data.flashcards.slice()); });
}
function runSelfTest(queue) {
  var root = $('#app');
  clearTimers();
  if (!queue.length) { toast('沒有閃卡可以自測'); return; }
  var idx = 0, flipped = false, known = 0, unknown = 0;
  function render() {
    if (idx >= queue.length) {
      if (known + unknown > 0) recordStudyDay();
      root.innerHTML = subHead('自測結果') + '<div class="card"><h3>自測完成</h3>' +
        '<p class="hint">共 ' + queue.length + ' 張 ・ 會 ' + known + ' ・ 不會 ' + unknown + '</p>' +
        '<button class="btn cta" onclick="backToLearn()">回學習</button></div>';
      return;
    }
    var c = queue[idx];
    root.innerHTML = subHead('閃卡自測') +
      '<div class="dim small" style="margin-bottom:10px">第 ' + (idx + 1) + ' 張 / 共 ' + queue.length + ' 張</div>' +
      '<div class="flip' + (flipped ? ' flipped' : '') + '"><div class="flip-inner">' +
      '<div class="flip-face">' + esc(c.front) + '</div>' +
      '<div class="flip-face back">' + esc(c.back) + '</div></div></div>' +
      (flipped
        ? '<div class="rowline" style="margin-top:14px"><button class="btn ghost grow" id="st-no">不會</button>' +
          '<button class="btn peri grow" id="st-yes">會</button></div>'
        : '<button class="btn cta" style="margin-top:14px" id="st-flip">翻面</button>');
    var f = $('#st-flip');
    if (f) f.addEventListener('click', function () { flipped = true; render(); });
    var y = $('#st-yes'), n = $('#st-no');
    if (y) y.addEventListener('click', function () {
      known++; applyFlashcardReview(c, 'KNOWN').then(function () { idx++; flipped = false; render(); });
    });
    if (n) n.addEventListener('click', function () {
      unknown++; applyFlashcardReview(c, 'UNKNOWN').then(function () { idx++; flipped = false; render(); });
    });
  }
  render();
}

/* ---- managers: flashcards / mistakes / notes ---- */
function subjChipsHtml(selected, includeNone) {
  var opts = (includeNone ? [''] : []).concat(SUBJECTS);
  return '<div class="subj" id="subj-chips">' + opts.map(function (s) {
    return '<button data-s="' + esc(s) + '" class="' + (s === selected ? 'on' : '') + '">' +
      (s === '' ? '不選' : esc(s)) + '</button>';
  }).join('') + '</div>';
}
function wireSubjChips(container, onPick) {
  Array.prototype.forEach.call(container.querySelectorAll('[data-s]'), function (b) {
    b.addEventListener('click', function () {
      container.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      onPick(b.getAttribute('data-s'));
    });
  });
}
function viewFlashcards(root) {
  clearTimers();
  var subject = null, query = '';
  function render() {
    var items = App.data.flashcards.filter(function (c) {
      var q = query.trim().toLowerCase();
      return (subject === null || c.subject === subject) &&
        (!q || c.front.toLowerCase().indexOf(q) >= 0 || c.back.toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    root.innerHTML = subHead('閃卡') +
      '<button class="btn cta" id="fc-add">＋ 新增閃卡</button><div style="height:12px"></div>' +
      '<input id="fc-q" placeholder="搜尋正反面…" value="' + esc(query) + '">' +
      '<div style="height:10px"></div>' + subjChipsHtml(subject || '', true).replace('data-s=""', 'data-s="__ALL__"') +
      '<div style="height:12px"></div>' +
      (items.length ? '' : '<div class="card sub"><span class="dim">沒有符合的閃卡</span></div>') +
      items.map(function (c) {
        var due = reviewIsDue({ interval: c.reviewIntervalDays, due: c.reviewDueEpochDay, streak: c.reviewStreak }, epochDayToday());
        return '<div class="card sub"><div class="rowline"><span class="pill line">' + esc(c.subject) + '</span>' +
          (c.mastered ? '<span class="pill">已記住</span>' : '') +
          (due ? '<span class="pill salmon">今日到期</span>' : '<span class="dim small">下次 ' + fmtDay(c.reviewDueEpochDay) + '</span>') + '</div>' +
          '<div style="font-size:17px;margin-top:8px">' + esc(c.front) + '</div>' +
          '<div class="dim" style="margin-top:2px">' + esc(c.back) + '</div>' +
          '<div class="rowline" style="margin-top:10px"><button class="btn ghost small" data-edit="' + c.id + '">編輯</button>' +
          '<button class="btn ghost small" data-del="' + c.id + '">刪除</button></div></div>';
      }).join('');
    $('#fc-add').addEventListener('click', function () { flashcardEditor(null, render); });
    $('#fc-q').addEventListener('input', function () { query = this.value; render(); var q = $('#fc-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
    var chips = $('#subj-chips');
    if (chips) wireSubjChips(chips, function (s) { subject = s === '__ALL__' || s === '' ? null : s; render(); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        var c = App.data.flashcards.find(function (x) { return x.id === +b.getAttribute('data-edit'); });
        flashcardEditor(c, render);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = +b.getAttribute('data-del');
        App.data.flashcards = App.data.flashcards.filter(function (x) { return x.id !== id; });
        saveFeature('flashcards', writeFlashcards(App.data.flashcards)).then(render);
      });
    });
  }
  render();
}
function flashcardEditor(card, done) {
  var isNew = !card;
  card = card || { id: newId(), front: '', back: '', subject: '英文', mastered: false, createdAt: Date.now(), reviewIntervalDays: 0, reviewDueEpochDay: 0, reviewStreak: 0 };
  var subject = card.subject;
  openModal(modalHead(isNew ? '新增閃卡' : '編輯閃卡') +
    '<label class="flabel">正面</label><textarea id="fe-front" rows="2">' + esc(card.front) + '</textarea>' +
    '<label class="flabel">背面</label><textarea id="fe-back" rows="2">' + esc(card.back) + '</textarea>' +
    '<label class="flabel">科目</label>' + subjChipsHtml(subject, false) +
    '<div style="height:16px"></div><button class="btn cta" id="fe-save">儲存</button>');
  wireSubjChips($('#subj-chips'), function (s) { subject = s; });
  $('#fe-save').addEventListener('click', function () {
    var front = $('#fe-front').value.trim(), back = $('#fe-back').value.trim();
    if (!front || !back) { toast('正反面都要填'); return; }
    card.front = front; card.back = back; card.subject = subject;
    if (isNew) App.data.flashcards.push(card);
    saveFeature('flashcards', writeFlashcards(App.data.flashcards)).then(function () {
      closeModal(); toast('已儲存'); done();
    });
  });
}
function viewMistakes(root) {
  clearTimers();
  var subject = null, onlyOpen = false;
  function render() {
    var items = App.data.mistakes.filter(function (m) {
      return (subject === null || m.subject === subject) && (!onlyOpen || !m.mastered);
    });
    root.innerHTML = subHead('錯題本') +
      '<button class="btn cta" id="mk-add">＋ 新增錯題</button><div style="height:12px"></div>' +
      '<label class="rowline" style="gap:8px"><input type="checkbox" id="mk-open" style="width:auto" ' + (onlyOpen ? 'checked' : '') + '> 只看還沒搞懂</label>' +
      '<div style="height:10px"></div>' + subjChipsHtml(subject || '', true).replace('data-s=""', 'data-s="__ALL__"') +
      '<div style="height:12px"></div>' +
      (items.length ? '' : '<div class="card sub"><span class="dim">沒有符合的錯題</span></div>') +
      items.map(function (m) {
        var photos = photoNamesOf(m.photoName).length;
        return '<div class="card sub"><div class="rowline"><span class="pill line">' + esc(m.subject) + '</span>' +
          (m.mastered ? '<span class="pill">已搞懂</span>' : '<span class="pill salmon">還沒搞懂</span>') +
          (photos ? '<span class="pill line">📷 照片 ×' + photos + '</span>' : '') + '</div>' +
          '<div style="font-size:16px;margin-top:8px;line-height:1.5" class="ellipsis">' + esc(m.question) + '</div>' +
          photoStripHtml('mistakes', m, 3) +
          (m.cause || m.source ? '<div class="dim small" style="margin-top:4px">' +
            esc([m.cause, m.source].filter(Boolean).join(' ・ ')) + ' ・ 已複習 ' + (m.reviewCount || 0) + ' 次</div>' : '') +
          '<div class="rowline" style="margin-top:10px"><button class="btn ghost small" data-edit="' + m.id + '">編輯</button>' +
          '<button class="btn ghost small" data-del="' + m.id + '">刪除</button></div></div>';
      }).join('');
    $('#mk-add').addEventListener('click', function () { mistakeEditor(null, render); });
    $('#mk-open').addEventListener('change', function () { onlyOpen = this.checked; render(); });
    var chips = $('#subj-chips');
    if (chips) wireSubjChips(chips, function (s) { subject = s === '__ALL__' || s === '' ? null : s; render(); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        mistakeEditor(App.data.mistakes.find(function (x) { return x.id === +b.getAttribute('data-edit'); }), render);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = +b.getAttribute('data-del');
        var victim = App.data.mistakes.find(function (x) { return x.id === id; });
        App.data.mistakes = App.data.mistakes.filter(function (x) { return x.id !== id; });
        saveFeature('mistakes', writeMistakes(App.data.mistakes)).then(render);
        if (victim) {
          photoNamesOf(victim.photoName).forEach(function (n) {
            PhotoStore.remove('mistakes', n);
          });
        }
      });
    });
    wirePhotoThumbs(root);
  }
  render();
}
function mistakeEditor(m, done) {
  var isNew = !m;
  m = m || { id: newId(), subject: '數學', question: '', myAnswer: '', correctAnswer: '', note: '', photoName: null, mastered: false, createdAt: Date.now(), cause: '', source: '', reviewCount: 0, lastReviewedAt: 0, reviewIntervalDays: 0, reviewDueEpochDay: 0, reviewStreak: 0 };
  var subject = m.subject, cause = m.cause || '', source = m.source || '';
  function chipRow(id, opts, val) {
    return '<div class="subj" id="' + id + '">' + opts.map(function (s) {
      return '<button data-s="' + esc(s) + '" class="' + (s === val ? 'on' : '') + '">' + (s === '' ? '不選' : esc(s)) + '</button>';
    }).join('') + '</div>';
  }
  var ph = editorPhotos('mistakes', m);
  openModal(modalHead(isNew ? '新增錯題' : '編輯錯題', '') +
    '<label class="flabel">科目</label>' + chipRow('mk-subj', SUBJECTS, subject) +
    '<label class="flabel">題目</label><textarea id="mk-q" rows="3">' + esc(m.question) + '</textarea>' +
    '<label class="flabel">我的答案</label><textarea id="mk-my" rows="2">' + esc(m.myAnswer) + '</textarea>' +
    '<label class="flabel">正確答案</label><textarea id="mk-ca" rows="2">' + esc(m.correctAnswer) + '</textarea>' +
    '<label class="flabel">解析 / 備註</label><textarea id="mk-note" rows="2">' + esc(m.note) + '</textarea>' +
    '<div id="ph-wrap"></div>' +
    '<label class="flabel">錯因</label>' + chipRow('mk-cause', [''].concat(CAUSES), cause) +
    '<label class="flabel">來源</label>' + chipRow('mk-source', [''].concat(SOURCES), source) +
    '<label class="rowline" style="gap:8px;margin-top:14px"><input type="checkbox" id="mk-mast" style="width:auto" ' + (m.mastered ? 'checked' : '') + '> 已搞懂</label>' +
    '<div style="height:16px"></div><button class="btn peri block" id="mk-ai">AI 解題重點</button>' +
    '<div style="height:10px"></div><button class="btn cta" id="mk-save">儲存</button>');
  ModalOnClose = function () { ph.rollback(); };
  ph.render($('#ph-wrap'));
  wireSubjChips($('#mk-subj'), function (s) { subject = s; });
  wireSubjChips($('#mk-cause'), function (s) { cause = s; });
  wireSubjChips($('#mk-source'), function (s) { source = s; });
  function setAiBusy(busy) {
    var a = $('#mk-ai'), s = $('#mk-save');
    if (a) { a.disabled = busy; a.textContent = busy ? 'AI 整理中…' : 'AI 解題重點'; }
    if (s) s.disabled = busy;
  }
  $('#mk-ai').addEventListener('click', function () {
    var photos = ph.state.names.slice();
    if (!photos.length) { toast('先附上題目照片，才能用 AI 解題重點'); return; }
    if (!loadAiSettings().key) { toast('這個帳號還沒有 AI 設定'); return; }
    setAiBusy(true);
    prepareAiImages('mistakes', photos).then(function (imgs) {
      return aiChat(MISTAKE_PROMPT, imgs);
    }).then(function (reply) {
      setAiBusy(false);
      var cur = $('#mk-note').value;
      if (!cur.trim()) { $('#mk-note').value = reply; toast('AI 整理完成'); return; }
      chooseAiApply('AI 解題重點好了', '解析欄位已經有文字，要怎麼放這次的結果？', '取代解析')
        .then(function (pick) {
          if (pick === 'append') $('#mk-note').value = cur.replace(/\s+$/, '') + '\n\n' + reply;
          else if (pick === 'replace') $('#mk-note').value = reply;
        });
    }).catch(function (e) {
      setAiBusy(false);
      toast(e.message || 'AI 整理失敗，請再試一次');
    });
  });
  $('#mk-save').addEventListener('click', function () {
    if (ph.state.busy) { toast('照片上傳中，等一下再儲存'); return; }
    var q = $('#mk-q').value.trim(), ca = $('#mk-ca').value.trim();
    if (!q && !ph.state.names.length) { toast('題目或照片至少要有一項'); return; }
    if (!ca) { toast('正確答案必填'); return; }
    m.subject = subject; m.question = q; m.myAnswer = $('#mk-my').value;
    m.correctAnswer = ca; m.note = $('#mk-note').value;
    m.cause = cause; m.source = source; m.mastered = $('#mk-mast').checked;
    m.photoName = photoFieldOf(ph.state.names);
    if (isNew) App.data.mistakes.push(m);
    saveFeature('mistakes', writeMistakes(App.data.mistakes)).then(function () {
      ph.commit(); ModalOnClose = null;
      closeModal(); toast('已儲存'); done();
    });
  });
}
function viewNotes(root) {
  clearTimers();
  function render() {
    var items = App.data.notes;
    root.innerHTML = subHead('筆記') +
      '<button class="btn cta" id="nt-add">＋ 新增筆記</button><div style="height:12px"></div>' +
      (items.length ? '' : '<div class="card sub"><span class="dim">還沒有筆記</span></div>') +
      items.map(function (n) {
        var photos = photoNamesOf(n.photoName).length;
        return '<div class="card sub"><div class="rowline">' +
          (n.subject ? '<span class="pill line">' + esc(n.subject) + '</span>' : '') +
          (photos ? '<span class="pill line">📷 照片 ×' + photos + '</span>' : '') +
          '<span class="dim small">' + fmtDay(epochDayOf(n.updatedAt)) + ' ' + fmtTime(n.updatedAt) + '</span></div>' +
          '<div style="font-size:17px;font-weight:600;margin-top:8px">' + esc(noteDisplayTitle(n)) + '</div>' +
          (n.body ? '<div class="dim" style="margin-top:4px;line-height:1.5">' + esc(n.body.split('\n')[0].slice(0, 60)) + '</div>' : '') +
          photoStripHtml('notes', n, 3) +
          '<div class="rowline" style="margin-top:10px"><button class="btn ghost small" data-edit="' + n.id + '">編輯</button>' +
          '<button class="btn ghost small" data-del="' + n.id + '">刪除</button></div></div>';
      }).join('');
    $('#nt-add').addEventListener('click', function () { noteEditor(null, render); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        noteEditor(App.data.notes.find(function (x) { return x.id === +b.getAttribute('data-edit'); }), render);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = +b.getAttribute('data-del');
        var victim = App.data.notes.find(function (x) { return x.id === id; });
        App.data.notes = App.data.notes.filter(function (x) { return x.id !== id; });
        saveFeature('notes', writeNotes(App.data.notes)).then(render);
        if (victim) {
          photoNamesOf(victim.photoName).forEach(function (nm) {
            PhotoStore.remove('notes', nm);
          });
        }
      });
    });
    wirePhotoThumbs(root);
  }
  render();
}
function noteEditor(n, done) {
  var isNew = !n;
  n = n || { id: newId(), title: '', body: '', subject: '', photoName: null, createdAt: Date.now(), updatedAt: Date.now() };
  var subject = n.subject;
  var ph = editorPhotos('notes', n);
  openModal(modalHead(isNew ? '新增筆記' : '編輯筆記', '') +
    '<label class="flabel">標題（可空）</label><input id="nt-title" value="' + esc(n.title) + '">' +
    '<label class="flabel">科目</label>' + subjChipsHtml(subject, true) +
    '<label class="flabel">內文</label><textarea id="nt-body" rows="8">' + esc(n.body) + '</textarea>' +
    '<div id="ph-wrap"></div>' +
    '<div style="height:16px"></div><button class="btn peri block" id="nt-ai">AI 整理（摘要＋重點）</button>' +
    '<div style="height:10px"></div><button class="btn cta" id="nt-save">儲存</button>');
  ModalOnClose = function () { ph.rollback(); };
  ph.render($('#ph-wrap'));
  wireSubjChips($('#subj-chips'), function (s) { subject = s; });
  function setAiBusy(busy) {
    var a = $('#nt-ai'), s = $('#nt-save');
    if (a) { a.disabled = busy; a.textContent = busy ? 'AI 整理中…' : 'AI 整理（摘要＋重點）'; }
    if (s) s.disabled = busy;
  }
  $('#nt-ai').addEventListener('click', function () {
    var photos = ph.state.names.slice();
    var bodyText = $('#nt-body').value.trim();
    if (!photos.length && !bodyText) {
      toast('先附上一張照片，或先寫一點內文，再用 AI 整理'); return;
    }
    if (!loadAiSettings().key) { toast('這個帳號還沒有 AI 設定'); return; }
    var prompt = photos.length ? NOTE_PROMPT : NOTE_PROMPT + '\n\n以下是內容：\n' + bodyText;
    setAiBusy(true);
    var prep = photos.length ? prepareAiImages('notes', photos) : Promise.resolve([]);
    prep.then(function (imgs) { return aiChat(prompt, imgs); }).then(function (reply) {
      setAiBusy(false);
      var cur = $('#nt-body').value;
      if (!cur.trim()) { $('#nt-body').value = reply; toast('AI 整理完成'); return; }
      chooseAiApply('AI 整理好了', '內文已經有文字，要怎麼放這次的整理結果？', '取代內文')
        .then(function (pick) {
          if (pick === 'append') $('#nt-body').value = cur.replace(/\s+$/, '') + '\n\n' + reply;
          else if (pick === 'replace') $('#nt-body').value = reply;
        });
    }).catch(function (e) {
      setAiBusy(false);
      toast(e.message || 'AI 整理失敗，請再試一次');
    });
  });
  $('#nt-save').addEventListener('click', function () {
    if (ph.state.busy) { toast('照片上傳中，等一下再儲存'); return; }
    var body = $('#nt-body').value;
    if (!body.trim() && !ph.state.names.length) { toast('內文或照片至少要有一項'); return; }
    n.title = $('#nt-title').value; n.body = body; n.subject = subject;
    n.photoName = photoFieldOf(ph.state.names);
    n.updatedAt = Date.now();
    if (isNew) App.data.notes.push(n);
    App.data.notes.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    saveFeature('notes', writeNotes(App.data.notes)).then(function () {
      ph.commit(); ModalOnClose = null;
      closeModal(); toast('已儲存'); done();
    });
  });
}

/* ---- focus timer ---- */
function focusKey() { return 'sq_focus_timer_' + Auth.uid; }
function roomKey() { return 'sq_room_' + Auth.uid; }
function getFocusState() {
  try { return JSON.parse(localStorage.getItem(focusKey()) || 'null'); } catch (e) { return null; }
}
function getRoomState() {
  try { return JSON.parse(localStorage.getItem(roomKey()) || 'null'); } catch (e) { return null; }
}
function viewFocus(root) {
  clearTimers();
  var room = getRoomState();
  if (room) {
    root.innerHTML = subHead('專注計時') + '<div class="card"><h3>📚 讀書房進行中</h3>' +
      '<p class="hint">你正在一起讀書（' + esc(room.subject) + '），已讀 ' +
      '<b id="room-elapsed">' + fmtElapsed(Date.now() - room.startedAt) + '</b>。專注計時跟讀書房是同一件事，不能同時開兩個。</p>' +
      '<button class="btn cta" onclick="go(\'room\')">前往讀書房</button></div>';
    every(1, function () {
      var e = $('#room-elapsed');
      if (e) e.textContent = fmtElapsed(Date.now() - room.startedAt);
    });
    return;
  }
  var subject = SUBJECTS[2];
  var minutes = 25;
  var st = getFocusState();
  function statsHtml() {
    var today = epochDayToday();
    var week = weekMinutes(App.data.focus, today);
    var max = Math.max.apply(null, week.concat([1]));
    var labels = ['一', '二', '三', '四', '五', '六', '日'];
    return '<div class="card sub"><h3>統計</h3>' +
      '<p class="hint">今日專注 ' + minutesOn(App.data.focus, today) + ' 分鐘 ・ 🔥 連續學習 ' +
      studyStreak(App.data.focus, App.data.studyDays, today) + ' 天</p>' +
      '<div class="weekbars">' + week.map(function (m, i) {
        return '<div class="wb"><div class="bar" style="height:' + Math.round(m / max * 52) + 'px"></div>' +
          '<div class="lb">週' + labels[i] + '<br>' + m + '</div></div>';
      }).join('') + '</div></div>';
  }
  function renderIdle() {
    root.innerHTML = subHead('專注計時') +
      '<div class="card"><h3>選科目與時間</h3>' +
      '<label class="flabel">科目</label>' + subjChipsHtml(subject, false) +
      '<label class="flabel">時間</label><div class="rowline">' +
      '<button class="btn ' + (minutes === 25 ? 'peri' : 'ghost') + ' grow" data-min="25">25 分鐘</button>' +
      '<button class="btn ' + (minutes === 50 ? 'peri' : 'ghost') + ' grow" data-min="50">50 分鐘</button></div>' +
      '<label class="flabel">自訂分鐘（5–180）</label><input id="fo-custom" type="number" min="5" max="180" placeholder="例如 40">' +
      '<div style="height:14px"></div><button class="btn cta" id="fo-start">開始專注</button></div>' +
      statsHtml();
    wireSubjChips($('#subj-chips'), function (s) { subject = s; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-min]'), function (b) {
      b.addEventListener('click', function () { minutes = +b.getAttribute('data-min'); renderIdle(); });
    });
    $('#fo-start').addEventListener('click', function () {
      var custom = parseInt($('#fo-custom').value, 10);
      var mins = !isNaN(custom) ? custom : minutes;
      if (mins < 5 || mins > 180) { toast('時間要在 5–180 分鐘之間'); return; }
      var state = { subject: subject, minutes: mins, endAt: Date.now() + mins * 60000 };
      localStorage.setItem(focusKey(), JSON.stringify(state));
      renderRunning(state);
    });
  }
  function renderRunning(state) {
    clearTimers();
    var total = state.minutes * 60000;
    root.innerHTML = subHead('專注計時') +
      '<div class="card"><div class="hint" style="text-align:center">' + esc(state.subject) + ' ・ 專注中</div>' +
      '<div class="ringwrap"><svg class="ring" width="200" height="200" viewBox="0 0 200 200">' +
      '<circle class="track" cx="100" cy="100" r="84" fill="none" stroke-width="12"/>' +
      '<circle class="arc" id="ring-arc" cx="100" cy="100" r="84" fill="none" stroke-width="12" ' +
      'stroke-dasharray="527.8" stroke-dashoffset="527.8"/></svg></div>' +
      '<div class="ringnum" id="ring-num">--:--</div>' +
      '<button class="btn ghost block" id="fo-cancel">取消（不記錄）</button></div>';
    function tick() {
      var remain = state.endAt - Date.now();
      if (remain <= 0) { completeFocus(state); return; }
      var num = $('#ring-num'), arc = $('#ring-arc');
      if (!num) return;
      num.textContent = fmtElapsed(remain + 999);
      var used = 1 - remain / total;
      arc.setAttribute('stroke-dashoffset', String(527.8 * (1 - used)));
    }
    tick();
    every(1, tick);
    $('#fo-cancel').addEventListener('click', function () {
      localStorage.removeItem(focusKey());
      clearTimers(); renderIdle();
    });
  }
  function completeFocus(state) {
    clearTimers();
    localStorage.removeItem(focusKey());
    var session = {
      id: Date.now(), subject: state.subject, minutes: state.minutes,
      dateEpochDay: epochDayToday(), createdAt: Date.now()
    };
    /* Re-read the cloud payload first so an Android-side session is not lost. */
    DataStore.load('focus').then(function (payload) {
      App.data.focus = parseFocus(payload);
      App.data.focus.push(session);
      return saveFeature('focus', writeFocus(App.data.focus));
    }).then(function () {
      return recordStudyDay();
    }).then(function () {
      if (navigator.vibrate) navigator.vibrate(400);
      root.innerHTML = subHead('專注計時') + '<div class="card"><h3>完成 🎉</h3>' +
        '<p class="hint">' + esc(state.subject) + ' 專注了 ' + state.minutes + ' 分鐘，已記錄。</p>' +
        '<button class="btn cta" onclick="backToLearn()">回學習</button></div>' + statsHtml();
    });
  }
  if (st) {
    if (st.endAt > Date.now()) renderRunning(st);
    else completeFocus(st);
  } else {
    renderIdle();
  }
}
/* ---- AI (custom OpenAI-compatible API; settings follow the account) -- */
function aiEndpoint(base) {
  var b = (base || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  return b + '/chat/completions';
}
/* Persona guardrail sent as the first (system) message on every AI
   call: study-only scope with a fixed refusal line, Traditional
   Chinese (Taiwan) replies, and no model/technical disclosure. */
var AI_SYSTEM_PROMPT = '你是 Study QAQ 的學習助手。只協助與學習有關的事：學科知識、課業與考試問題、課文與題目解說、讀書方法、出題練習。若使用者的要求與學習無關，不要回答該問題，只回覆『我只是學習助手，可能幫不上你的忙。』一律使用繁體中文（台灣用語）回答，即使使用者用簡體或外語提問。不要透露你使用的模型名稱或技術細節。';
function viewAi(root) {
  clearTimers();
  var ai = loadAiSettings();
  root.innerHTML = subHead('AI 學習') +
    '<div class="card"><h3>問 AI</h3>' +
    (ai.key
      ? '<p class="hint">AI 已就緒，設定跟著你的帳號同步</p>'
      : '<p class="hint salmon">這個帳號還沒有 AI 設定，AI 功能暫時不能用。</p>') +
    '<textarea id="ai-q" rows="5" placeholder="貼上課文、題目，或直接問問題…"></textarea>' +
    '<div style="height:12px"></div><button class="btn cta" id="ai-go" ' + (ai.key ? '' : 'disabled') + '>送出</button>' +
    '<div class="err" id="ai-err" style="margin-top:10px"></div>' +
    '<div id="ai-out" style="margin-top:14px"></div></div>';
  $('#ai-go').addEventListener('click', function () {
    var q = $('#ai-q').value.trim();
    var err = $('#ai-err'), out = $('#ai-out');
    err.textContent = '';
    if (!ai.key) { err.textContent = '這個帳號還沒有 AI 設定'; return; }
    if (!q) { err.textContent = '先輸入內容'; return; }
    this.disabled = true;
    out.innerHTML = '<span class="dim">AI 處理中…</span>';
    /* Same shared call path as the note/mistake AI buttons: the
       request body is the Android shape (guard system message +
       one-part content array for a text-only call). */
    aiChat(q, []).then(function (text) {
      out.innerHTML = '<div class="card sub" style="white-space:pre-wrap;line-height:1.65">' + esc(text) + '</div>';
    }).catch(function (e) {
      out.innerHTML = '';
      err.textContent = e.message || '連不上 AI 伺服器';
    }).finally(function () { var b = $('#ai-go'); if (b) b.disabled = false; });
  });
}

/* ============================== study room ========================= */
function viewRoom(root) {
  if (!Auth.signedIn) { root.innerHTML = needLoginHtml('一起讀書'); return; }
  clearTimers();
  var me = Auth.uid;
  if (!App.profile) {
    root.innerHTML = brandHeader() + '<div class="card"><h3>先設定暱稱</h3>' +
      '<p class="hint">一起讀書會公開顯示你的暱稱（不是本名、不是 email）。去「我的」頁設定後回來。</p>' +
      '<button class="btn cta" onclick="go(\'me\')">去設定暱稱</button></div>';
    loadSocialBasics().then(function () { if (App.profile && App.tab === 'room') viewRoom(root); });
    return;
  }
  var state = getRoomState();
  var subject = SUBJECTS[2];
  function listsHtml() {
    return '<h2 class="secttl" style="font-size:20px">同科目正在讀書</h2><div id="room-same"><div class="card sub"><span class="dim">載入中…</span></div></div>' +
      '<h2 class="secttl" style="font-size:20px">好友正在讀書</h2><div id="room-friends"><div class="card sub"><span class="dim">載入中…</span></div></div>';
  }
  function personRow(e, isFriend) {
    return '<div class="card sub"><div class="rowline">' + avatarHtml(e.nickname, 'sm') +
      '<div class="grow ellipsis"><b>' + esc(e.nickname) + '</b>' +
      (isFriend ? ' <span class="pill">⭐ 好友</span>' : '') +
      '<div class="dim small">' + esc(e.subject) + ' ・ 已讀 ' + fmtElapsed(Date.now() - e.startedAt) + '</div></div>' +
      '<button class="btn peri small" data-chat="' + esc(e.uid) + '" data-nick="' + esc(e.nickname) + '">傳訊息</button></div></div>';
  }
  function refreshLists() {
    Social.listPresence().then(function (list) {
      var now = Date.now();
      var live = presenceLive(list, now).filter(function (e) { return e.uid !== me; });
      App.presence = live;
      var fu = friendUids();
      var sameBox = $('#room-same'), frBox = $('#room-friends');
      var curSubject = state ? state.subject : subject;
      if (sameBox) {
        var same = live.filter(function (e) { return e.subject === curSubject; })
          .sort(function (a, b) { return a.startedAt - b.startedAt; });
        sameBox.innerHTML = same.length
          ? same.map(function (e) { return personRow(e, fu.indexOf(e.uid) >= 0); }).join('')
          : '<div class="card sub"><span class="dim">🌱 目前沒有其他人在讀 ' + esc(curSubject) + (state ? '' : '，開始讀書來當第一個') + '</span></div>';
      }
      if (frBox) {
        var fr = live.filter(function (e) { return fu.indexOf(e.uid) >= 0; });
        frBox.innerHTML = fr.length
          ? fr.map(function (e) { return personRow(e, true); }).join('')
          : '<div class="card sub"><span class="dim">🌙 好友目前都沒有在讀書</span></div>';
      }
      Array.prototype.forEach.call(root.querySelectorAll('[data-chat]'), function (b) {
        b.addEventListener('click', function () {
          openChat(b.getAttribute('data-chat'), b.getAttribute('data-nick'));
        });
      });
    }).catch(function () {});
  }
  if (state) {
    root.innerHTML = brandHeader() +
      '<div class="card"><h3>📚 讀書中 ・ ' + esc(state.subject) + '</h3>' +
      '<div class="ringnum" style="margin:10px 0 0" id="room-clock">' + fmtElapsed(Date.now() - state.startedAt) + '</div>' +
      '<p class="hint" style="text-align:center">其他人現在看得到你正在讀 ' + esc(state.subject) + '</p>' +
      '<button class="btn cta" id="room-stop">結束讀書並記錄</button></div>' + listsHtml();
    Social.putPresence({
      uid: me, nickname: App.profile.nickname, subject: state.subject,
      startedAt: state.startedAt, heartbeatAt: Date.now()
    }).catch(function () {});
    every(1, function () {
      var c = $('#room-clock');
      if (c) c.textContent = fmtElapsed(Date.now() - state.startedAt);
    });
    every(60, function () {
      Social.putPresence({
        uid: me, nickname: App.profile.nickname, subject: state.subject,
        startedAt: state.startedAt, heartbeatAt: Date.now()
      }).catch(function () {});
    });
    every(20, refreshLists);
    refreshLists();
    $('#room-stop').addEventListener('click', function () {
      var minutes = Math.floor((Date.now() - state.startedAt) / 60000);
      var subj = state.subject;
      localStorage.removeItem(roomKey());
      clearTimers();
      Social.deletePresence(me).catch(function () {});
      if (minutes >= 1) {
        DataStore.load('focus').then(function (payload) {
          App.data.focus = parseFocus(payload);
          App.data.focus.push({
            id: Date.now(), subject: subj, minutes: minutes,
            dateEpochDay: epochDayToday(), createdAt: Date.now()
          });
          return saveFeature('focus', writeFocus(App.data.focus));
        }).then(function () { return recordStudyDay(); })
          .then(function () { toast('已記錄 ' + minutes + ' 分鐘'); viewRoom(root); });
      } else {
        toast('不到 1 分鐘，不記錄');
        viewRoom(root);
      }
    });
    return;
  }
  var focus = getFocusState();
  if (focus && focus.endAt > Date.now()) {
    root.innerHTML = brandHeader() + '<div class="card"><h3>⏱ 專注計時進行中</h3>' +
      '<p class="hint">你正在專注計時（' + esc(focus.subject) + '），跟讀書房是同一件事，不能同時開始。</p>' +
      '<button class="btn cta" onclick="go(\'learn\')">去看專注計時</button></div>' + listsHtml();
    every(20, refreshLists);
    refreshLists();
    return;
  }
  root.innerHTML = brandHeader() +
    '<div class="card"><h3>選科目開始讀書</h3>' +
    '<p class="hint">開始後，同科目正在讀書的人會互相看得到（暱稱＋已讀時間）。</p>' +
    subjChipsHtml(subject, false) +
    '<div style="height:14px"></div><button class="btn cta" id="room-start">開始讀書</button></div>' +
    listsHtml();
  wireSubjChips($('#subj-chips'), function (s) { subject = s; refreshLists(); });
  every(20, refreshLists);
  refreshLists();
  $('#room-start').addEventListener('click', function () {
    var now = Date.now();
    var st = { subject: subject, startedAt: now };
    localStorage.setItem(roomKey(), JSON.stringify(st));
    Social.putPresence({
      uid: me, nickname: App.profile.nickname, subject: subject,
      startedAt: now, heartbeatAt: now
    }).then(function () { viewRoom(root); })
      .catch(function (e) { localStorage.removeItem(roomKey()); toast(e.message); });
  });
}
/* ============================== messages =========================== */
function viewMessages(root) {
  if (!Auth.signedIn) { root.innerHTML = needLoginHtml('訊息'); return; }
  clearTimers();
  root.innerHTML = brandHeader() + '<div id="msg-body"><div class="card sub"><span class="dim">載入訊息中…</span></div></div>';
  Social.listThreads(Auth.uid).then(function (threads) {
    App.threads = threads;
    renderTabbar();
    renderThreadList(root);
  }).catch(function (e) {
    var b = $('#msg-body');
    if (b) b.innerHTML = '<div class="card sub"><span class="err">' + esc(e.message) + '</span></div>';
  });
  /* Friendships/blocks decide the zones: re-render once they arrive. */
  loadSocialBasics().then(function () {
    if (App.tab === 'msg' && !App.chatPeer) {
      Social.listThreads(Auth.uid).then(function (threads) {
        App.threads = threads;
        renderTabbar();
        renderThreadList(root);
      }).catch(function () {});
    }
  });
}
function renderThreadList(root) {
  var body = $('#msg-body');
  if (!body) return;
  var me = Auth.uid, fu = friendUids(), bu = blockedUids();
  var zones = { MAIN: [], STRANGER: [] };
  App.threads.forEach(function (t) {
    var z = threadClassify(t, me, fu, bu);
    if (z !== 'HIDDEN') zones[z].push(t);
  });
  function unreadOf(list) {
    return list.reduce(function (a, t) { return a + threadUnreadFor(t, me); }, 0);
  }
  var zone = App.msgZone;
  var list = zones[zone];
  body.innerHTML =
    '<div class="seg"><button data-z="MAIN" class="' + (zone === 'MAIN' ? 'on' : '') + '">訊息' +
    (unreadOf(zones.MAIN) ? ' ・ ' + unreadOf(zones.MAIN) : '') + '</button>' +
    '<button data-z="STRANGER" class="' + (zone === 'STRANGER' ? 'on' : '') + '">陌生訊息' +
    (unreadOf(zones.STRANGER) ? ' ・ ' + unreadOf(zones.STRANGER) : '') + '</button></div>' +
    (zone === 'STRANGER' ? '<p class="dim small" style="margin:0 2px 10px">還不是好友的人傳來的訊息會放在這裡。接受後會移到「訊息」，也可以刪除或封鎖。</p>' : '') +
    (list.length ? '' : '<div class="card sub"><span class="dim">' +
      (zone === 'MAIN' ? '還沒有對話，去好友或讀書房找人聊吧' : '沒有陌生訊息') + '</span></div>') +
    list.map(function (t) {
      var other = threadOtherUid(t, me), nick = threadOtherNick(t, me);
      var unread = threadUnreadFor(t, me);
      var preview = t.lastType === 'STICKER' ? '[貼圖]' : t.lastText;
      var when = t.lastAt ? (epochDayOf(t.lastAt) === epochDayToday() ? fmtTime(t.lastAt) : fmtDay(epochDayOf(t.lastAt)) + ' ' + fmtTime(t.lastAt)) : '';
      return '<div class="card sub" data-open="' + esc(other) + '" data-nick="' + esc(nick) + '" style="cursor:pointer">' +
        '<div class="rowline">' + avatarHtml(nick) +
        '<div class="grow ellipsis"><b style="font-size:17px">' + esc(nick) + '</b>' +
        (threadWaitingAcceptance(t, me, fu) ? ' <span class="pill">等待對方接受</span>' : '') +
        '<div class="' + (unread ? '' : 'dim') + ' small ellipsis" style="' + (unread ? 'font-weight:700' : '') + '">' +
        esc(preview || '（尚無訊息）') + '</div></div>' +
        '<div style="text-align:right"><div class="dim tiny">' + esc(when) + '</div>' +
        (unread ? '<span class="badge" style="margin-top:4px">' + unread + '</span>' : '') + '</div>' +
        '</div></div>';
    }).join('');
  Array.prototype.forEach.call(body.querySelectorAll('[data-z]'), function (b) {
    b.addEventListener('click', function () { App.msgZone = b.getAttribute('data-z'); renderThreadList(root); });
  });
  Array.prototype.forEach.call(body.querySelectorAll('[data-open]'), function (c) {
    c.addEventListener('click', function () {
      openChat(c.getAttribute('data-open'), c.getAttribute('data-nick'));
    });
  });
}
/* ============================== chat =============================== */
function openChat(peerUid, peerNick) {
  if (!Auth.signedIn) { go('me'); return; }
  if (!App.profile) { toast('先去「我的」頁設定暱稱才能傳訊息'); go('me'); return; }
  clearTimers();
  App.tab = 'msg';
  renderTabbar();
  var root = $('#app');
  var me = Auth.uid;
  var threadId = (me < peerUid ? me : peerUid) + '__' + (me < peerUid ? peerUid : me);
  var thread = null;
  var showStickers = false;
  root.innerHTML =
    '<div class="rowline" style="margin:8px 0 12px">' +
    '<button class="btn ghost small" id="chat-back">‹ 訊息</button>' +
    '<div class="grow ellipsis"><b style="font-size:19px">' + esc(peerNick) + '</b></div></div>' +
    '<div id="chat-actions"></div>' +
    '<div id="chat-list"><div class="card sub"><span class="dim">載入中…</span></div></div>' +
    '<div id="chat-stk"></div>' +
    '<div class="chatbar"><button class="btn ghost" id="chat-stkbtn" style="min-width:52px">😀</button>' +
    '<textarea id="chat-in" rows="1" maxlength="1000" placeholder="輸入訊息…"></textarea>' +
    '<button class="btn peri" id="chat-send" style="min-width:64px">傳送</button></div>';
  $('#chat-back').addEventListener('click', function () { go('msg'); });
  function isStrangerPending() {
    if (!thread) return false;
    return threadClassify(thread, me, friendUids(), blockedUids()) === 'STRANGER';
  }
  function renderActions() {
    var box = $('#chat-actions');
    if (!box) return;
    if (isStrangerPending()) {
      box.innerHTML = '<div class="card sub"><div class="hint" style="margin-bottom:10px">這是陌生訊息。接受後會移到主訊息區。</div>' +
        '<div class="rowline"><button class="btn peri grow" id="ca-acc">接受</button>' +
        '<button class="btn ghost grow" id="ca-del">刪除</button>' +
        '<button class="btn ghost grow" id="ca-block">封鎖</button></div></div>';
      $('#ca-acc').addEventListener('click', function () {
        var suf = threadSuffix(thread, me);
        var fields = {}; fields['accepted' + suf] = true;
        Social.patchThread(threadId, fields, ['accepted' + suf]).then(function () {
          thread['accepted' + suf] = true; renderActions(); toast('已接受');
        }).catch(function (e) { toast(e.message); });
      });
      $('#ca-del').addEventListener('click', function () {
        var suf = threadSuffix(thread, me);
        var fields = {}; fields['hidden' + suf] = true;
        Social.patchThread(threadId, fields, ['hidden' + suf]).then(function () { go('msg'); })
          .catch(function (e) { toast(e.message); });
      });
      $('#ca-block').addEventListener('click', function () {
        var entries = App.blocks.filter(function (b) { return b.uid !== peerUid; });
        entries.push({ uid: peerUid, nickname: peerNick });
        Social.putBlocks(entries, Date.now()).then(function () {
          App.blocks = entries;
          var suf = threadSuffix(thread, me);
          var fields = {}; fields['hidden' + suf] = true;
          return Social.patchThread(threadId, fields, ['hidden' + suf]);
        }).then(function () { toast('已封鎖'); go('msg'); })
          .catch(function (e) { toast(e.message); });
      });
    } else {
      box.innerHTML = '';
    }
  }
  function renderMessages(msgs) {
    var box = $('#chat-list');
    if (!box) return;
    if (!msgs.length) {
      box.innerHTML = '<div class="card sub"><span class="dim">還沒有訊息，傳第一句話吧</span></div>';
      return;
    }
    box.innerHTML = msgs.map(function (m) {
      var mine = m.fromUid === me;
      if (m.type === 'STICKER') {
        if (STICKER_IDS.indexOf(m.stickerId) >= 0) {
          return '<div class="bubble sticker" style="' + (mine ? 'margin-left:auto' : 'margin-right:auto') + '">' +
            '<img src="stickers/' + esc(m.stickerId) + '.svg" alt="貼圖"></div>';
        }
        return '<div class="bubble ' + (mine ? 'me' : 'them') + '">[貼圖]</div>';
      }
      return '<div class="bubble ' + (mine ? 'me' : 'them') + '">' + esc(m.text) + '</div>';
    }).join('');
    window.scrollTo(0, document.body.scrollHeight);
  }
  function markRead() {
    if (!thread) return;
    var suf = threadSuffix(thread, me);
    if (threadUnreadFor(thread, me) === 0) return;
    var fields = {};
    fields['read' + suf] = Date.now();
    fields['unread' + suf] = 0;
    Social.patchThread(threadId, fields, ['read' + suf, 'unread' + suf]).then(function () {
      thread['unread' + suf] = 0;
      var t = App.threads.find(function (x) { return x.id === threadId; });
      if (t) t['unread' + suf] = 0;
      renderTabbar();
    }).catch(function () {});
  }
  function loadAll() {
    return Promise.all([
      Social.getThread(threadId),
      Social.listMessages(threadId, 100)
    ]).then(function (res) {
      if (res[0]) thread = res[0];
      renderActions();
      renderMessages(res[1]);
      markRead();
    }).catch(function () {});
  }
  loadAll();
  every(7, loadAll);
  function ensureThread() {
    if (thread) return Promise.resolve(thread);
    var t = threadFresh(me, App.profile.nickname, peerUid, peerNick);
    return Social.putThread(t).then(function () { thread = t; return t; });
  }
  function send(type, text, stickerId) {
    var sendBtn = $('#chat-send');
    if (sendBtn) sendBtn.disabled = true;
    ensureThread().then(function (t) {
      var now = Date.now();
      return Social.postMessage(threadId, {
        fromUid: me, type: type, text: text, stickerId: stickerId, createdAt: now
      }).then(function () {
        var preview = type === 'STICKER' ? '[貼圖]' : text;
        var mySuf = threadSuffix(t, me), otherSuf = threadSuffix(t, peerUid);
        var fields = {
          lastText: preview, lastType: type, lastFrom: me, lastAt: now,
          hiddenLo: false, hiddenHi: false
        };
        fields['accepted' + mySuf] = true;
        fields['read' + mySuf] = now;
        fields['unread' + mySuf] = 0;
        fields['unread' + otherSuf] = threadUnreadFor(t, peerUid) + 1;
        var mask = ['lastText', 'lastType', 'lastFrom', 'lastAt', 'accepted' + mySuf,
          'hiddenLo', 'hiddenHi', 'read' + mySuf, 'unread' + mySuf, 'unread' + otherSuf];
        return Social.patchThread(threadId, fields, mask).then(function () {
          t.lastText = preview; t.lastType = type; t.lastFrom = me; t.lastAt = now;
          t['unread' + otherSuf] = threadUnreadFor(t, peerUid) + 1;
          t['unread' + mySuf] = 0;
          thread = t;
          return loadAll();
        });
      });
    }).catch(function (e) { toast(e.message); })
      .finally(function () { var b = $('#chat-send'); if (b) b.disabled = false; });
  }
  $('#chat-send').addEventListener('click', function () {
    var input = $('#chat-in');
    var text = input.value.trim();
    if (!text) return;
    if (text.length > 1000) { toast('訊息太長（上限 1000 字）'); return; }
    input.value = '';
    send('TEXT', text, '');
  });
  $('#chat-stkbtn').addEventListener('click', function () {
    showStickers = !showStickers;
    var box = $('#chat-stk');
    if (!box) return;
    box.innerHTML = showStickers
      ? '<div class="stkgrid">' + STICKER_IDS.map(function (id) {
          return '<button data-stk="' + id + '"><img src="stickers/' + id + '.svg" alt="' + id + '"></button>';
        }).join('') + '</div><div class="dim tiny">貼圖：Noto Emoji（Google，Apache 2.0）</div>'
      : '';
    Array.prototype.forEach.call(box.querySelectorAll('[data-stk]'), function (b) {
      b.addEventListener('click', function () { send('STICKER', '', b.getAttribute('data-stk')); });
    });
  });
}
/* ============================== boot =============================== */
Auth.load();
renderTabbar();
if (Auth.signedIn) {
  loadSocialBasics().then(function () { renderTabbar(); });
  syncAiSettings();
}
go('home');
