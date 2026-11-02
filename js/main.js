// Vanish: camera -> person mask -> learned background -> the person painted out. This file is the wiring (DOM, camera, loop, capture UI);
// the pixel work is in engine.js / bg.js, which node tests cover. Everything here needs a real device to verify.
import { fitSize, resampleMask, orientVote } from './bg.js';
import { Engine } from './engine.js';
import { Segmenter } from './seg.js';
import { cameraErrorMessage, errText, fmtBytes } from './util.js';
import { canvasBlob, canShareFile, download, share, VideoRecorder, GifRecorder } from './capture.js';
import { stampName } from './util.js';
import { registerWorker } from './pwa.js';

const $ = id => document.getElementById(id);
const QUALITY = { fast: 320, balanced: 480, sharp: 720 };
const MAX_BAD_FRAMES = 30;     // consecutive frames with no usable mask before the loop stops and says why
const MAX_REC_SECONDS = 60;

// ---- settings (remembered per device; the page works without storage) ----
const settings = { quality: 'balanced', learn: 'normal', showMask: false, invert: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('vanish.settings') || '{}')); } catch { /* ignore */ }
if (!QUALITY[settings.quality]) settings.quality = 'balanced';
const saveSettings = () => { try { localStorage.setItem('vanish.settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---- state ----
const video = $('cam'), view = $('view'), vctx = view.getContext('2d', { alpha: false });
const proc = document.createElement('canvas'), pctx = proc.getContext('2d', { willReadFrequently: true });
const segmenter = new Segmenter();
let stream = null, facing = 'user', wantRunning = false, running = false, gen = 0;
let engine = null, W = 0, H = 0, rawMask = null, outImg = null;
let segReady = false, segLoading = false, badFrames = 0, lastSegErr = null, fellBack = false, cpuSwitching = false;
let lastTs = 0, lastVideoTime = -1, grabBg = false, peek = false;
let orient = { decided: false, votes: 0, inverted: false };
let rec = null, gifRec = null, sheetUrl = null, sheetBlob = null, sheetName = '', busy = false;
const stats = { times: [], fps: 0, seg: 0, cpu: 0, cover: 0, n: 0, details: false, shown: 0 };

const mirror = () => facing === 'user';

// ---- status overlay: every failure ends up here with the real error text ----
function showStatus(title, msg, buttons = [], { err = false, over = false } = {}) {
  $('stTitle').textContent = title; $('stMsg').textContent = msg;
  const box = $('stBtns'); box.textContent = '';
  for (const [label, fn, primary] of buttons) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (primary === false ? '' : ' primary'); b.textContent = label; b.onclick = fn; box.append(b);
  }
  const s = $('status'); s.className = (err ? 'err ' : '') + (over ? 'over' : ''); s.hidden = false;
}
const hideStatus = () => { $('status').hidden = true; };
const fail = (title, e, retry = start) => { stopLoop(); releaseCamera(); $('bar').hidden = true; $('hud').hidden = true; showStatus(title, typeof e === 'string' ? e : errText(e), [['Try again', retry]], { err: true }); };

// ---- camera ----
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('navigator.mediaDevices is missing'), { name: 'NoMediaDevices' });
  releaseCamera();
  const my = ++gen;
  const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  if (my !== gen) { s.getTracks().forEach(t => t.stop()); throw Object.assign(new Error('cancelled'), { name: 'Cancelled' }); }
  stream = s;
  s.getVideoTracks()[0]?.addEventListener('ended', () => { if (stream === s) fail('The camera stopped', 'Another app took the camera, or permission was revoked.'); });
  video.srcObject = s;
  await video.play();
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
}
function releaseCamera() { gen++; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; lastVideoTime = -1; }

async function loadModel() {
  if (segReady || segLoading) return;
  segLoading = true;
  const t0 = performance.now();
  showHud('Loading the person model (the first time is about 9 MB)...');
  try { await segmenter.load(); segReady = true; setHint(''); }
  catch (e) { segLoading = false; return fail('The person model failed to load', e + '\nThe model is fetched from cdn.jsdelivr.net and storage.googleapis.com; check the connection.', () => { start(); }); }
  segLoading = false; stats.loadMs = performance.now() - t0;
}

async function start() {
  wantRunning = true;
  showStatus('Starting the camera...', 'Allow the camera when the browser asks.', [], { over: false });
  try { await openCamera(); }
  catch (e) { if (e?.name === 'Cancelled') return; return fail('No camera', cameraErrorMessage(e)); }
  hideStatus(); $('bar').hidden = false; $('hud').hidden = false;
  startLoop();
  loadModel();
}

// ---- engine sizing ----
function setup(vw, vh) {
  const { w, h } = fitSize(vw, vh, QUALITY[settings.quality]);
  W = w; H = h;
  proc.width = view.width = W; proc.height = view.height = H;
  engine = new Engine(W, H, { learn: settings.learn });
  rawMask = new Uint8Array(W * H);
  outImg = new ImageData(W, H);
  orient = { decided: false, votes: 0, inverted: false };
  stats.cover = 0;
}

// ---- the frame loop ----
function startLoop() {
  if (running) return;
  running = true;
  const my = gen;
  const tick = now => { if (!running || my !== gen) return; schedule(); try { process(now); } catch (e) { fail('The picture loop crashed', e); } };
  const schedule = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback((n) => tick(n)) : requestAnimationFrame(tick));
  schedule();
}
function stopLoop() { running = false; }

function process(now) {
  if (cpuSwitching) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || video.readyState < 2) return;
  if (!video.requestVideoFrameCallback && video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const fit = fitSize(vw, vh, QUALITY[settings.quality]);
  if (!engine || fit.w !== W || fit.h !== H) setup(vw, vh);
  const t0 = performance.now();

  if (mirror()) { pctx.setTransform(-1, 0, 0, 1, W, 0); pctx.drawImage(video, 0, 0, W, H); pctx.setTransform(1, 0, 0, 1, 0, 0); }
  else pctx.drawImage(video, 0, 0, W, H);
  const frame = pctx.getImageData(0, 0, W, H).data;

  let haveMask = false;
  const t1 = performance.now();
  if (segReady) {
    const ts = Math.max(performance.now(), lastTs + 1); lastTs = ts;
    try {
      haveMask = segmenter.segment(video, ts, (f, mw, mh) => {
        let inv = settings.invert;
        if (segmenter.maskCount === 1 && orient.decided && orient.inverted) inv = !inv;
        resampleMask(f, mw, mh, rawMask, W, H, { flip: mirror(), invert: inv });
      });
    } catch (e) { lastSegErr = e; }
    if (haveMask) {
      badFrames = 0;
      if (segmenter.maskCount === 1 && !orient.decided) learnOrientation();
    } else if (++badFrames >= MAX_BAD_FRAMES) {
      const e = lastSegErr || new Error('The model returned no mask');
      if (!fellBack && segmenter.delegate === 'GPU') {
        fellBack = true; cpuSwitching = true; badFrames = 0;
        segmenter.fallbackToCpu().then(() => { cpuSwitching = false; }).catch(err => { cpuSwitching = false; fail('Segmentation failed', errText(err)); });
      } else return fail('Segmentation is not working', errText(e) + `\n(delegate: ${segmenter.delegate})`);
    }
  }
  const t2 = performance.now();

  if (grabBg) { grabBg = false; engine.model.captureAll(frame); }
  engine.step(frame, haveMask ? rawMask : null, outImg.data);
  if (peek) outImg.data.set(frame);
  else if (settings.showMask && haveMask) tintMask(outImg.data, engine.alpha);
  vctx.putImageData(outImg, 0, 0);
  const t3 = performance.now();

  if (gifRec) { gifRec.tick(t3); updateGifButton(); if (gifRec.done) finishGif(); }
  record(now ?? t3, t1 - t0, t2 - t1, t3 - t2);
}

function learnOrientation() {
  // a model that gives a single mask: the person is in the middle, the border is background. Vote over a few frames, then lock.
  const v = orientVote(rawMask, W, H);
  if (!v) return;
  orient.votes += v;
  if (Math.abs(orient.votes) >= 8) { orient.decided = true; orient.inverted = orient.votes < 0; }
}

function tintMask(px, alpha) {
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) { const a = alpha[i]; if (a) { px[p] = px[p] + (((255 - px[p]) * a) >> 9); px[p + 1] >>= 1; px[p + 2] >>= 1; } }
}

// ---- numbers on screen ----
function record(now, cpuA, segMs, cpuB) {
  const t = stats.times; t.push(now); if (t.length > 30) t.shift();
  if (t.length > 5) stats.fps = 1000 * (t.length - 1) / (t[t.length - 1] - t[0]);
  const k = 0.1; stats.seg += (segMs - stats.seg) * k; stats.cpu += ((cpuA + cpuB) - stats.cpu) * k;
  if (++stats.n % 15 === 0 && engine) stats.cover = engine.model.coverage();
  const nowMs = performance.now();
  if (nowMs - stats.shown < 500) return;
  stats.shown = nowMs;
  const fps = $('fps');
  fps.textContent = stats.details
    ? `${stats.fps.toFixed(0)} fps | seg ${stats.seg.toFixed(0)} ms | pixels ${stats.cpu.toFixed(0)} ms | ${W}x${H} | ${segmenter.delegate || 'no model'} | masks ${segmenter.maskCount}${orient.decided && orient.inverted ? ' (auto-inverted)' : ''}`
    : `${stats.fps.toFixed(0)} fps`;
  if (segReady) {
    const c = Math.round(stats.cover * 100);
    setHint(c < 97 ? `Learning the room behind you: ${c}%. Move or step aside so the camera can see it.` : '');
  }
}
const showHud = msg => { $('hud').hidden = false; setHint(msg); };
function setHint(msg) { const h = $('hint'); h.textContent = msg; h.hidden = !msg; }
$('fps').onclick = () => { stats.details = !stats.details; stats.shown = 0; };

// ---- result sheet: save / share ----
function openSheet(blob, name, kind) {
  closeSheet();
  sheetBlob = blob; sheetName = name; sheetUrl = URL.createObjectURL(blob);
  const el = document.createElement(kind === 'video' ? 'video' : 'img');
  el.src = sheetUrl;
  if (kind === 'video') { el.controls = true; el.playsInline = true; el.loop = true; el.muted = true; el.autoplay = true; }
  else el.alt = 'Your capture';
  $('preview').replaceChildren(el);
  $('fileInfo').textContent = `${name} | ${fmtBytes(blob.size)}${kind === 'gif' ? ` | ${gifInfo}` : ''}${kind === 'video' ? ` | ${blob.type}` : ''}`;
  $('shareBtn').hidden = !canShareFile(new File([blob], name, { type: blob.type }));
  $('sheet').hidden = false;
}
function closeSheet() {
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = null; sheetBlob = null; $('sheet').hidden = true; $('preview').replaceChildren();
}
$('saveBtn').onclick = () => { if (sheetBlob) download(sheetBlob, sheetName); };
$('shareBtn').onclick = async () => { try { await share(sheetBlob, sheetName); } catch (e) { if (e?.name !== 'AbortError') setHint('Share failed: ' + errText(e)); } };
$('sheetClose').onclick = closeSheet;

// ---- capture buttons ----
$('photoBtn').onclick = async () => {
  if (!engine) return;
  try { openSheet(await canvasBlob(view, 'image/png'), stampName('png'), 'photo'); }
  catch (e) { setHint('Photo failed: ' + errText(e)); }
};

const recBtn = $('recBtn');
recBtn.onclick = async () => {
  if (rec) return stopRecording();
  try { rec = new VideoRecorder(view, 30); rec.start(); }
  catch (e) { rec = null; return setHint('Cannot record video: ' + errText(e)); }
  recBtn.classList.add('on'); busy = true;
  const timer = setInterval(() => {
    if (!rec) return clearInterval(timer);
    recBtn.textContent = `Stop ${Math.floor(rec.seconds / 60)}:${String(Math.floor(rec.seconds % 60)).padStart(2, '0')}`;
    if (rec.seconds >= MAX_REC_SECONDS) stopRecording();
  }, 250);
};
async function stopRecording() {
  const r = rec; rec = null; recBtn.classList.remove('on'); recBtn.textContent = 'Record';
  try { const { blob, name } = await r.stop(); busy = false; openSheet(blob, name, 'video'); }
  catch (e) { busy = false; setHint('Recording failed: ' + errText(e)); }
}

let gifInfo = '';
const gifBtn = $('gifBtn');
gifBtn.onclick = () => {
  if (gifRec || !engine) return;
  gifRec = new GifRecorder(view, { width: 240, fps: 10, seconds: 3 });
  gifBtn.disabled = true; busy = true;
};
function updateGifButton() { if (gifRec) gifBtn.textContent = `${Math.round(gifRec.progress * 100)}%`; }
async function finishGif() {
  const g = gifRec; gifRec = null; gifBtn.textContent = 'Making...';
  try {
    const t0 = performance.now();
    const { blob, name } = await g.encode();
    gifInfo = `${g.w}x${g.h}, ${g.frames.length} frames, encoded in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    openSheet(blob, name, 'gif');
  } catch (e) { setHint('GIF failed: ' + errText(e)); }
  gifBtn.textContent = 'GIF'; gifBtn.disabled = false; busy = false;
}

// ---- other controls ----
const peekOn = e => { e.preventDefault(); peek = true; }, peekOff = () => { peek = false; };
$('peekBtn').addEventListener('pointerdown', peekOn);
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('peekBtn').addEventListener(ev, peekOff);

$('bgBtn').onclick = () => {
  if (!engine || $('bgBtn').disabled) return;
  const b = $('bgBtn'), c = $('count'); b.disabled = true; c.hidden = false;
  let n = 3; c.textContent = n;
  const t = setInterval(() => {
    n--;
    if (n > 0) { c.textContent = n; return; }
    clearInterval(t); c.hidden = true; grabBg = true; b.disabled = false;
  }, 1000);
};

$('flipBtn').onclick = async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  engine = null;           // a different view: start learning again
  stopLoop();
  try { await openCamera(); startLoop(); } catch (e) { if (e?.name !== 'Cancelled') fail('Could not switch camera', cameraErrorMessage(e)); }
};

$('setBtn').onclick = () => { $('settings').hidden = false; };
$('setClose').onclick = () => { $('settings').hidden = true; };
$('qSel').value = settings.quality; $('lSel').value = settings.learn; $('maskChk').checked = settings.showMask; $('invChk').checked = settings.invert;
$('qSel').onchange = e => { settings.quality = e.target.value; saveSettings(); engine = null; };
$('lSel').onchange = e => { settings.learn = e.target.value; saveSettings(); engine?.setLearn(settings.learn); };
$('maskChk').onchange = e => { settings.showMask = e.target.checked; saveSettings(); };
$('invChk').onchange = e => { settings.invert = e.target.checked; saveSettings(); };
$('resetBtn').onclick = () => { engine?.model.reset(); stats.cover = 0; $('settings').hidden = true; };
$('startBtn').onclick = start;

// the camera is never left on in the background: home button, app switch or screen off turns it off, coming back turns it on again
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    if (rec) stopRecording();
    if (gifRec) { gifRec = null; gifBtn.textContent = 'GIF'; gifBtn.disabled = false; busy = false; }
    if (stream) { stopLoop(); releaseCamera(); }
  } else if (wantRunning && !stream && $('status').hidden) {
    try { await openCamera(); startLoop(); } catch (e) { if (e?.name !== 'Cancelled') fail('The camera did not come back', cameraErrorMessage(e)); }
  }
});

window.addEventListener('error', e => { if (!$('status').hidden && $('status').className.includes('err')) return; setHint('Error: ' + (e.message || 'unknown')); });
window.addEventListener('unhandledrejection', e => setHint('Error: ' + errText(e.reason)));

registerWorker({ busy: () => busy || !$('sheet').hidden });
if (new URLSearchParams(location.search).has('autostart')) start();
