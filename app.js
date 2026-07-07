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
let appData = { documents: [], stampImages: [] };

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
    if (!Array.isArray(appData.stampImages)) appData.stampImages = [];
    mutate(appData);
    await gatewaySave(appData);
  }
}

// ---------- Stempel-Editor-Elemente ----------
const pdfInput = document.getElementById('pdfInput');
const docxInput = document.getElementById('docxInput');
const editor = document.getElementById('editor');
const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const docxContainer = document.getElementById('docxContainer');
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

// docType unterscheidet, welcher der beiden Editor-Pfade (PDF via pdf.js/pdf-lib,
// Word via docx-preview/JSZip) gerade aktiv ist - beide teilen sich Canvas-Wrap,
// Stempel-Overlay und die stamp{}-Fraktionen (cx/cy/w/rotation/opacity).
let docType = null; // 'pdf' | 'docx'

let pdfFile = null;
let pdfJsDoc = null;
let numPages = 0;
let currentPage = 1;
let renderToken = 0;

let docxFile = null;
let docxSections = []; // aktuell gerenderte section.docx-Elemente (eine je Vorschau-Seite)

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
    docType = 'pdf';
    docxFile = null;
    docxInput.value = '';
    docxContainer.hidden = true;
    canvas.hidden = false;
    updatePageScopeOptions();
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

docxInput.addEventListener('change', async () => {
  const file = docxInput.files[0];
  if (!file) return;
  setStatus('Word-Datei wird geladen…');
  try {
    docType = 'docx';
    pdfFile = null;
    pdfJsDoc = null;
    pdfInput.value = '';
    canvas.hidden = true;
    docxContainer.hidden = false;
    updatePageScopeOptions();
    docxFile = file;
    const buf = await file.arrayBuffer();
    editor.hidden = false;
    await renderDocxPreview(buf);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Word-Datei konnte nicht geladen werden: ' + err.message, true);
  }
  maybeEnableDownload();
});

function updatePageScopeOptions() {
  if (docType === 'docx') {
    pageScopeSelect.innerHTML =
      '<option value="all">Alle Seiten (Kopfzeile)</option>' +
      '<option value="first">Nur erste Seite</option>';
  } else {
    pageScopeSelect.innerHTML =
      '<option value="all">Alle Seiten</option>' +
      '<option value="current">Nur aktuelle Seite</option>' +
      '<option value="custom">Bestimmte Seiten</option>';
  }
  customPagesInput.hidden = pageScopeSelect.value !== 'custom';
}

// CSS-Längen wie "793.7pt"/"8.5in"/"210mm", die docx-preview auf die
// section.docx-Elemente schreibt, in echte CSS-Pixel umrechnen (96 CSS-px/Zoll,
// browserweit fest definiert - unabhängig vom tatsächlichen Bildschirm-DPI).
function parseCssLength(str) {
  const m = String(str || '').match(/^([\d.]+)(pt|in|mm|cm|px)$/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const pxPerUnit = { pt: 96 / 72, in: 96, mm: 96 / 25.4, cm: 96 / 2.54, px: 1 };
  return val * (pxPerUnit[m[2]] || 1);
}

function currentPageBox() {
  const el = docType === 'docx' ? docxContainer : canvas;
  return { w: el.clientWidth, h: el.clientHeight };
}

function layoutDocxScale() {
  const wrapperEl = docxContainer.querySelector('.docx-wrapper');
  if (!wrapperEl || !docxSections.length) return;
  wrapperEl.style.transform = 'none';
  const firstSec = docxSections[0];
  const naturalW = firstSec.getBoundingClientRect().width;
  const naturalH = firstSec.getBoundingClientRect().height;
  const targetWidth = Math.min(820, canvasWrap.parentElement.clientWidth || 820);
  const factor = naturalW ? targetWidth / naturalW : 1;
  wrapperEl.style.transformOrigin = 'top left';
  wrapperEl.style.transform = `scale(${factor})`;
  canvasWrap.style.width = targetWidth + 'px';
  canvasWrap.style.height = (naturalH * factor) + 'px';
}

function showDocxPage(pageNum) {
  docxSections.forEach((sec, i) => { sec.style.display = (i === pageNum - 1) ? '' : 'none'; });
  pageIndicator.textContent = `Seite ${pageNum} / ${numPages}`;
  positionStampOverlay();
}

async function renderDocxPreview(buf) {
  docxContainer.innerHTML = '';
  await docx.renderAsync(buf, docxContainer, docxContainer, {
    inWrapper: true,
    breakPages: true,
    ignoreWidth: false,
    ignoreHeight: false
  });
  docxSections = Array.from(docxContainer.querySelectorAll('section.docx'));
  if (docxSections.length === 0) throw new Error('Word-Datei enthält keine erkennbaren Seiten.');
  // Feste, sichtbar begrenzte Seitenhöhe erzwingen (docx-preview setzt nur
  // min-height, echter Inhalt kann also über die Seite hinausragen).
  docxSections.forEach((sec) => {
    const hPx = parseCssLength(sec.style.minHeight) || sec.getBoundingClientRect().height;
    sec.style.height = hPx + 'px';
    sec.style.overflow = 'hidden';
  });
  numPages = docxSections.length;
  currentPage = 1;
  layoutDocxScale();
  showDocxPage(currentPage);
}

// ---------- Stempel-Bibliothek (geteilte, benannte Stempelbilder) ----------
// Statt jedes Mal eine Datei auszuwählen: einmal Bild+Name hinterlegen (jeder
// Tool-Nutzer darf das), danach reicht ein Klick auf den Namen. Löschen bleibt
// Admins vorbehalten (gleiche Rechte-Logik wie im Archiv).
let activeStampId = null;
let activeStampObjectUrl = null;

function renderStampLibrary() {
  const el = document.getElementById('stampLibrary');
  if (!el) return;
  const list = Array.isArray(appData.stampImages) ? appData.stampImages : [];
  if (list.length === 0) {
    el.innerHTML = '<p class="muted">Noch keine Stempelbilder hinterlegt.</p>';
    return;
  }
  const sorted = list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  el.innerHTML = sorted.map((s) => `
    <span class="stamp-chip${s.id === activeStampId ? ' active' : ''}">
      <button type="button" class="stamp-chip-btn" data-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>
      ${currentIsAdmin ? `<button type="button" class="stamp-chip-delete" data-id="${escapeHtml(s.id)}" title="Stempelbild löschen">×</button>` : ''}
    </span>
  `).join('');
}

async function selectStampFromLibrary(id) {
  const entry = (appData.stampImages || []).find((s) => s.id === id);
  if (!entry) return;
  setStatus('Stempelbild wird geladen…');
  try {
    const raw = await gatewayFetchFileBlob(id);
    // contentType aus den eigenen Metadaten nehmen statt aus raw.type: die Datei
    // liegt bei Nextcloud ohne Endung (nur die UUID als Name), der Content-Type
    // beim GET ist daher nicht garantiert identisch zum PUT.
    const known = entry.contentType === 'image/png' || entry.contentType === 'image/jpeg';
    stampFile = known ? new Blob([raw], { type: entry.contentType }) : raw;
    activeStampId = id;
    if (activeStampObjectUrl) URL.revokeObjectURL(activeStampObjectUrl);
    activeStampObjectUrl = URL.createObjectURL(stampFile);
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
    stampOverlay.src = activeStampObjectUrl;
    renderStampLibrary();
  } catch (err) {
    console.error(err);
    setStatus('Stempelbild konnte nicht geladen werden: ' + err.message, true);
  }
}

document.getElementById('stampLibrary').addEventListener('click', (e) => {
  const delBtn = e.target.closest('.stamp-chip-delete');
  if (delBtn) {
    const id = delBtn.dataset.id;
    const entry = (appData.stampImages || []).find((s) => s.id === id);
    if (!entry) return;
    if (!confirm(`Stempelbild "${entry.name}" wirklich löschen?`)) return;
    (async () => {
      try {
        await gatewayDeleteFile(id);
        await saveWithConflictRetry((data) => {
          data.stampImages = (data.stampImages || []).filter((s) => s.id !== id);
        });
        if (activeStampId === id) {
          activeStampId = null;
          stampFile = null;
          stampReady = false;
          stampOverlay.hidden = true;
          resizeHandle.hidden = true;
          maybeEnableDownload();
        }
        renderStampLibrary();
      } catch (err) {
        alert('Löschen fehlgeschlagen: ' + err.message);
      }
    })();
    return;
  }
  const chipBtn = e.target.closest('.stamp-chip-btn');
  if (chipBtn) selectStampFromLibrary(chipBtn.dataset.id);
});

const btnAddStamp = document.getElementById('btnAddStamp');
const stampAddForm = document.getElementById('stampAddForm');
const stampAddFile = document.getElementById('stampAddFile');
const stampAddName = document.getElementById('stampAddName');
const stampAddError = document.getElementById('stampAddError');

function closeStampAddForm() {
  stampAddForm.hidden = true;
  btnAddStamp.hidden = false;
  stampAddFile.value = '';
  stampAddName.value = '';
  stampAddError.style.display = 'none';
}

btnAddStamp.addEventListener('click', () => {
  stampAddForm.hidden = false;
  btnAddStamp.hidden = true;
});
document.getElementById('btnStampAddCancel').addEventListener('click', closeStampAddForm);

document.getElementById('btnStampAddSave').addEventListener('click', async () => {
  const file = stampAddFile.files[0];
  const name = stampAddName.value.trim();
  stampAddError.style.display = 'none';
  if (!file) {
    stampAddError.textContent = 'Bitte ein Bild auswählen.';
    stampAddError.style.display = '';
    return;
  }
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    stampAddError.textContent = 'Bitte ein PNG- oder JPG-Bild wählen.';
    stampAddError.style.display = '';
    return;
  }
  if (!name) {
    stampAddError.textContent = 'Bitte einen Namen eingeben.';
    stampAddError.style.display = '';
    return;
  }

  const saveBtn = document.getElementById('btnStampAddSave');
  saveBtn.disabled = true;
  try {
    const id = uuid();
    await gatewayUploadFile(id, file, file.name, file.type);
    const now = new Date().toISOString();
    const who = { username: currentUsername, vorname: currentVorname, nachname: currentNachname };
    await saveWithConflictRetry((data) => {
      if (!Array.isArray(data.stampImages)) data.stampImages = [];
      data.stampImages.push({ id, name, contentType: file.type, addedBy: who, addedAt: now });
    });
    closeStampAddForm();
    renderStampLibrary();
    await selectStampFromLibrary(id);
  } catch (err) {
    stampAddError.textContent = 'Fehler: ' + err.message;
    stampAddError.style.display = '';
  } finally {
    saveBtn.disabled = false;
  }
});

function maybeEnableDownload() {
  const hasDoc = docType === 'docx' ? !!docxFile : !!pdfFile;
  downloadBtn.disabled = !(hasDoc && stampReady);
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
    if (docType === 'docx') showDocxPage(currentPage); else renderPage(currentPage);
  }
});

nextPageBtn.addEventListener('click', () => {
  if (currentPage < numPages) {
    currentPage++;
    if (docType === 'docx') showDocxPage(currentPage); else renderPage(currentPage);
  }
});

function positionStampOverlay() {
  if (!stampReady) return;
  const { w: cw, h: ch } = currentPageBox();
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
  const { w: cw, h: ch } = currentPageBox();
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
  const cw = currentPageBox().w;
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

// ---------- Word (.docx) Stempel-Export ----------
// Word-Dateien bleiben eine editierbare .docx (User-Entscheidung), es wird also
// direkt an der Original-OOXML operiert statt wie beim PDF-Pfad ein neues Dokument
// zu erzeugen. Da Word Text erst beim Öffnen selbst umbricht, gibt es (anders als
// bei PDF-Seiten) keine zuverlässige Möglichkeit, "Seite 3" gezielt zu treffen -
// deshalb nur zwei robuste Modi: "alle Seiten" (Bild in der Kopfzeile jedes
// Abschnitts, wiederholt sich automatisch) und "nur erste Seite" (Bild im ersten
// Absatz des Dokumenttexts, der immer auf Seite 1 liegt). Alle XML-Teile werden
// per DOMParser/XMLSerializer strukturell bearbeitet (nicht per Text-Ersetzung),
// um die OOXML-Schema-Reihenfolge nicht zu verletzen.
const EMU_PER_TWIP = 635; // 1 twip = 1/1440 Zoll, 1 Zoll = 914400 EMU
const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HEADER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const HEADER_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_PAGE_EMU = { w: 11906 * EMU_PER_TWIP, h: 16838 * EMU_PER_TWIP }; // A4-Fallback

function randomHex(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s.toUpperCase();
}

async function loadXmlPart(zip, path) {
  const entry = zip.file(path);
  if (!entry) throw new Error(`Fehlendes Word-Teil: ${path}`);
  return new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
}

async function loadOrCreateRelsPart(zip, path) {
  const entry = zip.file(path);
  if (entry) return new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  return new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="${PKG_REL_NS}"></Relationships>`,
    'application/xml'
  );
}

function serializeXmlPart(xmlDoc) {
  // Manche Browser (Chrome) geben bei serializeToString() bereits selbst eine
  // <?xml ...?>-Deklaration aus, wenn das geparste Dokument eine hatte - vorher
  // strippen, damit nicht am Ende zwei Deklarationen im Part landen (ungueltiges XML).
  const serialized = new XMLSerializer().serializeToString(xmlDoc).replace(/^<\?xml[^>]*\?>\s*/, '');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + serialized;
}

function toRelsPath(partPath) {
  const idx = partPath.lastIndexOf('/');
  return partPath.slice(0, idx + 1) + '_rels/' + partPath.slice(idx + 1) + '.rels';
}

function addRelationship(relsDoc, type, target) {
  const root = relsDoc.documentElement;
  const existingIds = Array.from(root.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))
    .map((r) => parseInt((r.getAttribute('Id') || '').replace(/^rId/, ''), 10))
    .filter((n) => !isNaN(n));
  const nextId = 'rId' + (existingIds.length ? Math.max(...existingIds) + 1 : 1);
  const rel = relsDoc.createElementNS(PKG_REL_NS, 'Relationship');
  rel.setAttribute('Id', nextId);
  rel.setAttribute('Type', type);
  rel.setAttribute('Target', target);
  root.appendChild(rel);
  return nextId;
}

function findRelationshipTarget(relsDoc, id) {
  const rel = Array.from(relsDoc.getElementsByTagNameNS(PKG_REL_NS, 'Relationship')).find((r) => r.getAttribute('Id') === id);
  return rel ? rel.getAttribute('Target') : null;
}

function ensureDefaultContentType(ctDoc, ext, mime) {
  const root = ctDoc.documentElement;
  const exists = Array.from(root.getElementsByTagNameNS(CT_NS, 'Default'))
    .some((d) => (d.getAttribute('Extension') || '').toLowerCase() === ext.toLowerCase());
  if (exists) return;
  const el = ctDoc.createElementNS(CT_NS, 'Default');
  el.setAttribute('Extension', ext);
  el.setAttribute('ContentType', mime);
  root.appendChild(el);
}

function addContentTypeOverride(ctDoc, partName, mime) {
  const root = ctDoc.documentElement;
  const exists = Array.from(root.getElementsByTagNameNS(CT_NS, 'Override')).some((o) => o.getAttribute('PartName') === partName);
  if (exists) return;
  const el = ctDoc.createElementNS(CT_NS, 'Override');
  el.setAttribute('PartName', partName);
  el.setAttribute('ContentType', mime);
  root.appendChild(el);
}

function countHeaderParts(zip) {
  return Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/.test(n)).length;
}

function uniqueMediaName(zip, ext) {
  let n = 1;
  while (zip.file(`word/media/stempelbild_${n}.${ext}`)) n++;
  return `stempelbild_${n}.${ext}`;
}

function findSectPrList(docXmlDoc) {
  return Array.from(docXmlDoc.getElementsByTagNameNS(WNS, 'sectPr'));
}

function getSectPrPageSizeEMU(sectPr) {
  const pgSz = sectPr.getElementsByTagNameNS(WNS, 'pgSz')[0];
  const wTwips = pgSz ? parseInt(pgSz.getAttributeNS(WNS, 'w'), 10) : NaN;
  const hTwips = pgSz ? parseInt(pgSz.getAttributeNS(WNS, 'h'), 10) : NaN;
  if (!wTwips || !hTwips) return DEFAULT_PAGE_EMU;
  return { w: wTwips * EMU_PER_TWIP, h: hTwips * EMU_PER_TWIP };
}

// Gleiche Fraktionen (stamp.cx/cy/w) wie beim PDF-Pfad, aber OOXML dreht ein
// a:xfrm-Shape (anders als pdf-lib) um seinen eigenen Mittelpunkt und misst
// Rotation im Uhrzeigersinn - das entspricht direkt CSS rotate(), keine
// Vorzeichen-/Pivot-Korrektur wie bei buildStampedPdfBytes nötig.
function computeStampGeometry(pageEMU) {
  const wEmu = stamp.w * pageEMU.w;
  const hEmu = wEmu * (stampNaturalH / stampNaturalW);
  const xEmu = stamp.cx * pageEMU.w - wEmu / 2;
  const yEmu = stamp.cy * pageEMU.h - hEmu / 2;
  let rotUnits = Math.round(stamp.rotation * 60000) % 21600000;
  if (rotUnits < 0) rotUnits += 21600000;
  const alphaAmt = clamp(stamp.opacity, 0, 100) * 1000;
  return { wEmu, hEmu, xEmu, yEmu, rotUnits, alphaAmt };
}

function buildDrawingRunXml({ wEmu, hEmu, xEmu, yEmu, rotUnits, alphaAmt, relId, docPrId }) {
  return (
    `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>` +
    `<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ` +
    `distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" ` +
    `behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" ` +
    `wp14:anchorId="${randomHex(8)}" wp14:editId="${randomHex(8)}">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(xEmu)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(yEmu)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${Math.round(wEmu)}" cy="${Math.round(hEmu)}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/>` +
    `<wp:docPr id="${docPrId}" name="Stempel${docPrId}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Stempelbild"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}" xmlns:r="${RNS}"><a:alphaModFix amt="${Math.round(alphaAmt)}"/></a:blip>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm rot="${rotUnits}"><a:off x="0" y="0"/><a:ext cx="${Math.round(wEmu)}" cy="${Math.round(hEmu)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

function insertRunIntoFirstParagraph(xmlDoc, containerEl, runXmlString) {
  let p = Array.from(containerEl.children).find((el) => el.localName === 'p');
  if (!p) {
    p = xmlDoc.createElementNS(WNS, 'w:p');
    containerEl.insertBefore(p, containerEl.firstChild);
  }
  const wrapped = `<w:tmp xmlns:w="${WNS}">${runXmlString}</w:tmp>`;
  const parsedRun = new DOMParser().parseFromString(wrapped, 'application/xml').documentElement.firstElementChild;
  p.insertBefore(xmlDoc.importNode(parsedRun, true), p.firstChild);
}

// Liefert die Pfad(e) des Default-Headers eines Abschnitts, legt bei Bedarf
// einen neuen (leeren) Header-Part an und verdrahtet document.xml + Content-Types.
async function resolveOrCreateDefaultHeaderPaths(zip, docXmlDoc, docRelsDoc, ctDoc, sectPr) {
  const existing = Array.from(sectPr.getElementsByTagNameNS(WNS, 'headerReference'));
  if (existing.length > 0) {
    return existing
      .map((href) => findRelationshipTarget(docRelsDoc, href.getAttributeNS(RNS, 'id')))
      .filter(Boolean)
      .map((target) => 'word/' + target.replace(/^\.\//, ''));
  }
  const idx = countHeaderParts(zip) + 1;
  const headerPath = `word/header${idx}.xml`;
  zip.file(headerPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:hdr xmlns:w="${WNS}" xmlns:r="${RNS}"></w:hdr>`);
  addContentTypeOverride(ctDoc, `/${headerPath}`, HEADER_MIME);
  const relId = addRelationship(docRelsDoc, HEADER_REL_TYPE, `header${idx}.xml`);
  const headerRefNode = docXmlDoc.createElementNS(WNS, 'w:headerReference');
  headerRefNode.setAttributeNS(WNS, 'w:type', 'default');
  headerRefNode.setAttributeNS(RNS, 'r:id', relId);
  sectPr.insertBefore(headerRefNode, sectPr.firstChild);
  return [headerPath];
}

async function buildStampedDocxBytes() {
  const zip = await JSZip.loadAsync(await docxFile.arrayBuffer());
  const stampBytes = await stampFile.arrayBuffer();
  const isPng = stampFile.type === 'image/png';
  const imgExt = isPng ? 'png' : 'jpeg';
  const imgName = uniqueMediaName(zip, imgExt);
  zip.file(`word/media/${imgName}`, stampBytes);

  const ctDoc = await loadXmlPart(zip, '[Content_Types].xml');
  ensureDefaultContentType(ctDoc, imgExt, isPng ? 'image/png' : 'image/jpeg');

  const docXmlDoc = await loadXmlPart(zip, 'word/document.xml');
  const docRelsDoc = await loadOrCreateRelsPart(zip, 'word/_rels/document.xml.rels');
  const sectPrList = findSectPrList(docXmlDoc);
  if (sectPrList.length === 0) throw new Error('Kein Abschnitt (sectPr) in der Word-Datei gefunden - unerwartetes Dateiformat.');
  let nextDocPrId = 900001 + Math.floor(Math.random() * 8000);

  if (pageScopeSelect.value === 'first') {
    const geo = computeStampGeometry(getSectPrPageSizeEMU(sectPrList[0]));
    const relId = addRelationship(docRelsDoc, IMAGE_REL_TYPE, `media/${imgName}`);
    const runXml = buildDrawingRunXml({ ...geo, relId, docPrId: nextDocPrId++ });
    const bodyEl = docXmlDoc.getElementsByTagNameNS(WNS, 'body')[0];
    insertRunIntoFirstParagraph(docXmlDoc, bodyEl, runXml);
  } else {
    const stampedHeaders = new Set();
    for (const sectPr of sectPrList) {
      const geo = computeStampGeometry(getSectPrPageSizeEMU(sectPr));
      const headerPaths = await resolveOrCreateDefaultHeaderPaths(zip, docXmlDoc, docRelsDoc, ctDoc, sectPr);
      for (const headerPath of headerPaths) {
        if (stampedHeaders.has(headerPath)) continue;
        stampedHeaders.add(headerPath);
        const headerXmlDoc = await loadXmlPart(zip, headerPath);
        const headerRelsPath = toRelsPath(headerPath);
        const headerRelsDoc = await loadOrCreateRelsPart(zip, headerRelsPath);
        const relId = addRelationship(headerRelsDoc, IMAGE_REL_TYPE, `media/${imgName}`);
        const runXml = buildDrawingRunXml({ ...geo, relId, docPrId: nextDocPrId++ });
        const hdrEl = headerXmlDoc.getElementsByTagNameNS(WNS, 'hdr')[0];
        insertRunIntoFirstParagraph(headerXmlDoc, hdrEl, runXml);
        zip.file(headerPath, serializeXmlPart(headerXmlDoc));
        zip.file(headerRelsPath, serializeXmlPart(headerRelsDoc));
      }
    }
  }

  zip.file('[Content_Types].xml', serializeXmlPart(ctDoc));
  zip.file('word/document.xml', serializeXmlPart(docXmlDoc));
  zip.file('word/_rels/document.xml.rels', serializeXmlPart(docRelsDoc));

  return zip.generateAsync({ type: 'uint8array', mimeType: DOCX_MIME });
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
  const hasDoc = docType === 'docx' ? !!docxFile : !!pdfFile;
  if (!hasDoc || !stampReady) return;
  downloadBtn.disabled = true;
  setStatus(docType === 'docx' ? 'Word-Datei wird gestempelt…' : 'PDF wird gestempelt…');
  try {
    let blob, baseName, filename, contentType;
    if (docType === 'docx') {
      const outBytes = await buildStampedDocxBytes();
      contentType = DOCX_MIME;
      blob = new Blob([outBytes], { type: contentType });
      baseName = docxFile.name.replace(/\.docx$/i, '');
      filename = `${baseName}-gestempelt.docx`;
    } else {
      const outBytes = await buildStampedPdfBytes();
      contentType = 'application/pdf';
      blob = new Blob([outBytes], { type: contentType });
      baseName = pdfFile.name.replace(/\.pdf$/i, '');
      filename = `${baseName}-gestempelt.pdf`;
    }

    setStatus('Dokument wird im Archiv abgelegt…');
    const id = uuid();
    await gatewayUploadFile(id, blob, filename, contentType);

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
    setStatus(docType === 'docx' ? 'Fertig! Die gestempelte Word-Datei wurde archiviert und heruntergeladen.' : 'Fertig! Die gestempelte PDF wurde archiviert und heruntergeladen.');
  } catch (err) {
    console.error(err);
    setStatus('Fehler beim Erzeugen des Dokuments: ' + err.message, true);
  } finally {
    downloadBtn.disabled = false;
  }
});

window.addEventListener('resize', () => {
  clearTimeout(window.__stempelResizeDebounce);
  window.__stempelResizeDebounce = setTimeout(() => {
    if (docType === 'pdf' && pdfJsDoc) renderPage(currentPage);
    else if (docType === 'docx' && docxSections.length) { layoutDocxScale(); showDocxPage(currentPage); }
  }, 200);
});

// ---------- Archiv ----------
async function deleteArchivDoc(docEntry) {
  if (!confirm(`"${docEntry.filename}" wirklich unwiderruflich aus dem Archiv löschen?`)) return;
  try {
    await gatewayDeleteFile(docEntry.id);
    await saveWithConflictRetry((data) => {
      data.documents = (data.documents || []).filter((d) => d.id !== docEntry.id);
    });
    renderArchiv();
  } catch (e) {
    console.error('Archiv-Löschen fehlgeschlagen', e);
    alert('Löschen fehlgeschlagen: ' + e.message);
  }
}

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
          <div class="archiv-row-actions">
            <button type="button" class="btn secondary small btn-archiv-download" data-id="${escapeHtml(d.id)}">Herunterladen</button>
            ${currentIsAdmin ? `<button type="button" class="btn small danger btn-archiv-delete" data-id="${escapeHtml(d.id)}">Löschen</button>` : ''}
          </div>
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
  const delBtn = e.target.closest('.btn-archiv-delete');
  if (delBtn) {
    const entry = (appData.documents || []).find((d) => d.id === delBtn.dataset.id);
    if (entry) deleteArchivDoc(entry);
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
  renderStampLibrary();
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
    if (!Array.isArray(appData.stampImages)) appData.stampImages = [];
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
