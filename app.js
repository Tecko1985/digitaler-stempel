pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ---------- Helpers ----------
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("de-DE") + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

// ---------- Gateway-Nutzer / App-Status ----------
let currentUsername = null;
let currentIsAdmin = false;
let currentVorname = null;
let currentNachname = null;
let appData = { documents: [] };

function displayName(entry) {
  return (entry.vorname || entry.nachname) ? `${entry.vorname || ""} ${entry.nachname || ""}`.trim() : entry.username;
}

async function saveWithConflictRetry(mutate) {
  mutate(appData);
  try {
    await gatewaySave(appData);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    const data = await gatewayLoad();
    appData = data && typeof data === "object" ? data : { documents: [] };
    if (!Array.isArray(appData.documents)) appData.documents = [];
    mutate(appData);
    await gatewaySave(appData);
  }
}

// ---------- Stempel-Editor-Elemente ----------
const pdfInput = document.getElementById('pdfInput');
const stampInput = document.getElementById('stampInput');
const editor = document.getElementById('editor');
const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvasWrap');
const stampOverlay = document.getElementById('stampOverlay');
const resizeHandle = document.getElementById('resizeHandle');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageIndicator = document.getElementById('pageIndicator');
const rotationInput = document.getElementById('rotation');
const opacityInput = document.getElementById('opacity');
const pageScopeSelect = document.getElementById('pageScope');
const customPagesInput = document.getElementById('customPages');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');

let pdfFile = null;
let pdfJsDoc = null;
let numPages = 0;
let currentPage = 1;
let renderToken = 0;

let stampFile = null;
let stampNaturalW = 0;
let stampNaturalH = 0;
let stampReady = false;

const stamp = { cx: 0.5, cy: 0.5, w: 0.3, rotation: 0, opacity: 100 };

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

pdfInput.addEventListener('change', async () => {
  const file = pdfInput.files[0];
  if (!file) return;
  setStatus('PDF wird geladen…');
  try {
    pdfFile = file;
    const buf = await file.arrayBuffer();
    pdfJsDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    numPages = pdfJsDoc.numPages;
    currentPage = 1;
    editor.hidden = false;
    await renderPage(currentPage);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('PDF konnte nicht geladen werden: ' + err.message, true);
  }
  maybeEnableDownload();
});

stampInput.addEventListener('change', () => {
  const file = stampInput.files[0];
  if (!file) return;
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    setStatus('Bitte ein PNG- oder JPG-Bild als Stempel wählen.', true);
    stampInput.value = '';
    return;
  }
  stampFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    stampOverlay.onload = () => {
      stampNaturalW = stampOverlay.naturalWidth;
      stampNaturalH = stampOverlay.naturalHeight;
      stampReady = true;
      stampOverlay.hidden = false;
      resizeHandle.hidden = false;
      positionStampOverlay();
      maybeEnableDownload();
      setStatus('');
    };
    stampOverlay.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function maybeEnableDownload() {
  downloadBtn.disabled = !(pdfFile && stampReady);
}

let activeRenderTask = null;

async function renderPage(pageNum) {
  const token = ++renderToken;

  if (activeRenderTask) {
    activeRenderTask.cancel();
    await activeRenderTask.promise.catch(() => {});
  }
  if (token !== renderToken) return;

  const page = await pdfJsDoc.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  const targetWidth = Math.min(820, canvasWrap.parentElement.clientWidth || 820);
  const scale = targetWidth / unscaled.width;
  const viewport = page.getViewport({ scale });
  if (token !== renderToken) return;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvasWrap.style.width = viewport.width + 'px';
  canvasWrap.style.height = viewport.height + 'px';

  activeRenderTask = page.render({ canvasContext: ctx, viewport });
  try {
    await activeRenderTask.promise;
  } catch (err) {
    if (err && err.name === 'RenderingCancelledException') return;
    throw err;
  }
  activeRenderTask = null;
  if (token !== renderToken) return;
  pageIndicator.textContent = `Seite ${currentPage} / ${numPages}`;
  positionStampOverlay();
}

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    renderPage(currentPage);
  }
});

nextPageBtn.addEventListener('click', () => {
  if (currentPage < numPages) {
    currentPage++;
    renderPage(currentPage);
  }
});

function positionStampOverlay() {
  if (!stampReady) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const w = stamp.w * cw;
  const h = w * (stampNaturalH / stampNaturalW);
  const left = stamp.cx * cw - w / 2;
  const top = stamp.cy * ch - h / 2;
  stampOverlay.style.width = w + 'px';
  stampOverlay.style.height = h + 'px';
  stampOverlay.style.left = left + 'px';
  stampOverlay.style.top = top + 'px';
  stampOverlay.style.transform = `rotate(${stamp.rotation}deg)`;
  stampOverlay.style.opacity = String(stamp.opacity / 100);
  resizeHandle.style.left = (left + w - 8) + 'px';
  resizeHandle.style.top = (top + h - 8) + 'px';
}

let dragState = null;
stampOverlay.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  stampOverlay.setPointerCapture(e.pointerId);
  dragState = { startX: e.clientX, startY: e.clientY, startCx: stamp.cx, startCy: stamp.cy };
});
stampOverlay.addEventListener('pointermove', (e) => {
  if (!dragState) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const dx = (e.clientX - dragState.startX) / cw;
  const dy = (e.clientY - dragState.startY) / ch;
  stamp.cx = clamp(dragState.startCx + dx, 0, 1);
  stamp.cy = clamp(dragState.startCy + dy, 0, 1);
  positionStampOverlay();
});
function endDrag(e) {
  if (dragState) {
    stampOverlay.releasePointerCapture(e.pointerId);
    dragState = null;
  }
}
stampOverlay.addEventListener('pointerup', endDrag);
stampOverlay.addEventListener('pointercancel', endDrag);

let resizeState = null;
resizeHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resizeHandle.setPointerCapture(e.pointerId);
  resizeState = { startX: e.clientX, startW: stamp.w };
});
resizeHandle.addEventListener('pointermove', (e) => {
  if (!resizeState) return;
  const cw = canvas.clientWidth;
  if (!cw) return;
  const dx = (e.clientX - resizeState.startX) / cw;
  stamp.w = clamp(resizeState.startW + dx, 0.03, 1.5);
  positionStampOverlay();
});
function endResize(e) {
  if (resizeState) {
    resizeHandle.releasePointerCapture(e.pointerId);
    resizeState = null;
  }
}
resizeHandle.addEventListener('pointerup', endResize);
resizeHandle.addEventListener('pointercancel', endResize);

rotationInput.addEventListener('input', () => {
  stamp.rotation = Number(rotationInput.value);
  positionStampOverlay();
});
opacityInput.addEventListener('input', () => {
  stamp.opacity = Number(opacityInput.value);
  positionStampOverlay();
});
pageScopeSelect.addEventListener('change', () => {
  customPagesInput.hidden = pageScopeSelect.value !== 'custom';
});

function parsePageRange(str, max) {
  const set = new Set();
  str.split(',').forEach((part) => {
    part = part.trim();
    if (!part) return;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= max) set.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= max) set.add(n);
    }
  });
  return Array.from(set).sort((a, b) => a - b);
}

function targetPages() {
  if (pageScopeSelect.value === 'all') {
    return Array.from({ length: numPages }, (_, i) => i + 1);
  }
  if (pageScopeSelect.value === 'current') {
    return [currentPage];
  }
  const pages = parsePageRange(customPagesInput.value, numPages);
  return pages.length ? pages : [currentPage];
}

async function buildStampedPdfBytes() {
  const pdfBytes = await pdfFile.arrayBuffer();
  const stampBytes = await stampFile.arrayBuffer();
  const { PDFDocument, degrees } = PDFLib;
  const doc = await PDFDocument.load(pdfBytes);
  const embedded = stampFile.type === 'image/png'
    ? await doc.embedPng(stampBytes)
    : await doc.embedJpg(stampBytes);

  const pages = doc.getPages();
  const targets = targetPages();
  // CSS rotate() is clockwise-positive in a Y-down system; PDF space is Y-up
  // with counterclockwise-positive rotation, so the sign flips here.
  const angleDeg = -stamp.rotation;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);

  targets.forEach((pageNum) => {
    const page = pages[pageNum - 1];
    if (!page) return;
    const { width: pw, height: ph } = page.getSize();
    const w = stamp.w * pw;
    const h = w * (stampNaturalH / stampNaturalW);
    const cx = stamp.cx * pw;
    const cy = (1 - stamp.cy) * ph;
    const halfW = w / 2, halfH = h / 2;
    // pdf-lib rotates the image around (x,y), its own bottom-left corner
    // pre-rotation - solve for the (x,y) that puts the true center at (cx,cy).
    const x = cx - (halfW * cos - halfH * sin);
    const y = cy - (halfW * sin + halfH * cos);
    page.drawImage(embedded, {
      x, y, width: w, height: h,
      rotate: degrees(angleDeg),
      opacity: stamp.opacity / 100
    });
  });

  return doc.save();
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

downloadBtn.addEventListener('click', async () => {
  if (!pdfFile || !stampReady) return;
  downloadBtn.disabled = true;
  setStatus('PDF wird gestempelt…');
  try {
    const outBytes = await buildStampedPdfBytes();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');
    const filename = `${baseName}-gestempelt.pdf`;

    setStatus('Dokument wird im Archiv abgelegt…');
    const id = uuid();
    await gatewayUploadFile(id, blob, filename);

    const now = new Date().toISOString();
    const who = { username: currentUsername, vorname: currentVorname, nachname: currentNachname };
    await saveWithConflictRetry((data) => {
      if (!Array.isArray(data.documents)) data.documents = [];
      data.documents.push({
        id,
        filename,
        stampedBy: who,
        stampedAt: now,
        downloads: [{ ...who, at: now }]
      });
    });

    triggerDownload(blob, filename);
    renderArchiv();
    setStatus('Fertig! Die gestempelte PDF wurde archiviert und heruntergeladen.');
  } catch (err) {
    console.error(err);
    setStatus('Fehler beim Erzeugen der PDF: ' + err.message, true);
  } finally {
    downloadBtn.disabled = false;
  }
});

window.addEventListener('resize', () => {
  clearTimeout(window.__stempelResizeDebounce);
  window.__stempelResizeDebounce = setTimeout(() => {
    if (pdfJsDoc) renderPage(currentPage);
  }, 200);
});

// ---------- Archiv ----------
async function downloadArchivDoc(docEntry) {
  try {
    const blob = await gatewayFetchFileBlob(docEntry.id);
    triggerDownload(blob, docEntry.filename);
    const now = new Date().toISOString();
    const who = { username: currentUsername, vorname: currentVorname, nachname: currentNachname };
    await saveWithConflictRetry((data) => {
      const entry = (data.documents || []).find((d) => d.id === docEntry.id);
      if (entry) {
        if (!Array.isArray(entry.downloads)) entry.downloads = [];
        entry.downloads.push({ ...who, at: now });
      }
    });
    renderArchiv();
  } catch (e) {
    console.error('Archiv-Download fehlgeschlagen', e);
    alert('Die Datei konnte nicht geladen werden: ' + e.message);
  }
}

function renderArchiv() {
  const rowsEl = document.getElementById('archiv-rows');
  const emptyEl = document.getElementById('archiv-empty');
  const subtitleEl = document.getElementById('archiv-subtitle');
  const titleEl = document.getElementById('archiv-title');
  if (!rowsEl) return;

  subtitleEl.textContent = currentIsAdmin
    ? 'Alle im Verein gestempelten Dokumente (Admin-Ansicht).'
    : 'Alle mit deinem Konto gestempelten Dokumente.';
  titleEl.textContent = currentIsAdmin ? 'Archiv (alle Nutzer)' : 'Archiv';

  const all = Array.isArray(appData.documents) ? appData.documents : [];
  const visible = (currentIsAdmin ? all : all.filter((d) => d.stampedBy && d.stampedBy.username === currentUsername))
    .slice()
    .sort((a, b) => String(b.stampedAt || '').localeCompare(String(a.stampedAt || '')));

  emptyEl.style.display = visible.length === 0 ? '' : 'none';

  rowsEl.innerHTML = visible.map((d) => {
    const downloads = Array.isArray(d.downloads) ? d.downloads : [];
    const detailId = 'dl-detail-' + escapeHtml(d.id);
    const detailRows = downloads.map((dl) => `
      <div>${escapeHtml(displayName(dl))} — ${escapeHtml(fmtDate(dl.at))}</div>
    `).join('');
    return `
      <div class="archiv-row" data-id="${escapeHtml(d.id)}">
        <div class="archiv-row-main">
          <div class="archiv-row-info">
            <span class="archiv-filename">${escapeHtml(d.filename)}</span>
            <span class="muted">Gestempelt von ${escapeHtml(displayName(d.stampedBy || {}))} — ${escapeHtml(fmtDate(d.stampedAt))}</span>
          </div>
          <button type="button" class="btn secondary small btn-archiv-download" data-id="${escapeHtml(d.id)}">Herunterladen</button>
        </div>
        <button type="button" class="archiv-downloads-toggle" data-target="${detailId}">${downloads.length}× heruntergeladen — Details</button>
        <div class="archiv-downloads-detail" id="${detailId}" style="display:none;">${detailRows || '<div>Noch keine Downloads erfasst.</div>'}</div>
      </div>
    `;
  }).join('');
}

document.getElementById('archiv-rows').addEventListener('click', (e) => {
  const dlBtn = e.target.closest('.btn-archiv-download');
  if (dlBtn) {
    const entry = (appData.documents || []).find((d) => d.id === dlBtn.dataset.id);
    if (entry) downloadArchivDoc(entry);
    return;
  }
  const toggle = e.target.closest('.archiv-downloads-toggle');
  if (toggle) {
    const detail = document.getElementById(toggle.dataset.target);
    if (detail) detail.style.display = detail.style.display === 'none' ? '' : 'none';
  }
});

// ---------- Versionshistorie ----------
function renderChangelog() {
  const list = document.getElementById('changelog-list');
  if (!list) return;
  list.innerHTML = APP_CHANGELOG.map((entry) => `
    <div class="changelog-entry">
      <span class="cv">Version ${escapeHtml(entry.version)}</span>
      ${entry.groups.map((g) => `
        <div class="changelog-group">
          <div class="cg-title">${escapeHtml(g.title)}</div>
          <ul class="cg-items">${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ---------- Header / Tabs / Start ----------
function renderHeaderUser() {
  const el = document.getElementById('header-user');
  if (!el) return;
  if (!currentUsername) { el.textContent = ''; return; }
  const name = displayName({ username: currentUsername, vorname: currentVorname, nachname: currentNachname });
  el.textContent = '👤 ' + name + (currentIsAdmin ? ' (Admin)' : '');
}

function activateTab(name) {
  document.querySelectorAll('nav button[data-tab]').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-section').forEach((s) => s.classList.remove('active'));
  const btn = document.querySelector('nav button[data-tab="' + name + '"]');
  if (btn) btn.classList.add('active');
  const section = document.getElementById('tab-' + name);
  if (section) section.classList.add('active');
  if (name === 'archiv') renderArchiv();
}

function setupTabs() {
  document.querySelectorAll('nav button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function showConnectScreen(errorMsg) {
  document.getElementById('connect-screen').style.display = '';
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('cloud-error').textContent = errorMsg ? 'Fehler: ' + errorMsg : '';
}

function startApp() {
  document.getElementById('connect-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = '';
  document.getElementById('version-badge').textContent = 'v' + APP_VERSION;
  document.getElementById('version-badge-2').textContent = 'v' + APP_VERSION;
  renderHeaderUser();
  renderChangelog();
}

async function init() {
  setupTabs();
  if (!getSessionToken()) { showConnectScreen(); return; }
  try {
    const [me, data] = await Promise.all([fetchMe(), gatewayLoad()]);
    currentUsername = me.username;
    currentIsAdmin = !!me.isAdmin;
    currentVorname = me.vorname || null;
    currentNachname = me.nachname || null;
    appData = data && typeof data === 'object' ? data : { documents: [] };
    if (!Array.isArray(appData.documents)) appData.documents = [];
    startApp();
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      showConnectScreen();
    } else {
      console.error('Laden fehlgeschlagen', e);
      showConnectScreen(e.message);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => { init(); });
