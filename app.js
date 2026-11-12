/* =====================================================================
   INVENTORY SCANNER – app.js
   Kiến trúc (các module tách riêng trong 1 file, dễ chuyển sang Android IME):
     1. Config / Settings   – cài đặt lưu localStorage
     2. Feedback            – âm thanh, rung, toast, hiệu ứng
     3. History / Stats     – lịch sử + thống kê
     4. Output              – "bộ xử lý đầu ra" (RAW/ENTER/TAB/CLIPBOARD/BATCH)
     5. Scanner             – camera + ZXing, chống trùng, vòng đời camera
     6. UI                  – gắn sự kiện, hiển thị
   Lưu ý: PWA KHÔNG thể gửi phím vào app/tab khác. Output chỉ hoạt động
   với input nằm trong cùng trang hoặc qua clipboard.
   ===================================================================== */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const ALL_FORMATS = ['QR_CODE', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39',
    'ITF', 'CODABAR', 'DATA_MATRIX', 'PDF_417', 'AZTEC'];

  /* ---------------- 1. SETTINGS ---------------- */
  const DEFAULTS = {
    deviceId: '', outputMode: 'enter', debounce: 1000, sound: true, vibrate: true,
    autoResume: true, autoSave: true, targetSelector: '#targetInput', formats: ALL_FORMATS.slice(),
  };
  const Settings = {
    data: { ...DEFAULTS },
    load() {
      try { Object.assign(this.data, JSON.parse(localStorage.getItem('inv.settings') || '{}')); } catch (e) { /* bỏ qua */ }
    },
    save() { try { localStorage.setItem('inv.settings', JSON.stringify(this.data)); } catch (e) { /* bỏ qua */ } },
  };

  /* ---------------- 2. FEEDBACK ---------------- */
  const Feedback = {
    ctx: null,
    beep() {
      if (!Settings.data.sound) return;
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'square'; o.frequency.value = 1100; g.gain.value = 0.08;
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + 0.09);
      } catch (e) { /* trình duyệt không hỗ trợ audio */ }
    },
    vibrate() { if (Settings.data.vibrate && navigator.vibrate) navigator.vibrate(60); },
    flash() {
      const f = $('#flash'); f.classList.add('show');
      setTimeout(() => f.classList.remove('show'), 60);
    },
    toastTimer: null,
    toast(msg) {
      const t = $('#toast'); t.textContent = msg; t.hidden = false;
      clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
    },
    success() { this.beep(); this.vibrate(); this.flash(); },
  };

  /* ---------------- 3. HISTORY & STATS ---------------- */
  const MAX_HISTORY = 30;
  const Store = {
    history: [], batch: [], stats: { total: 0, ok: 0, err: 0 },
    load() {
      try { this.history = JSON.parse(localStorage.getItem('inv.history') || '[]'); } catch (e) { this.history = []; }
      try { this.batch = JSON.parse(localStorage.getItem('inv.batch') || '[]'); } catch (e) { this.batch = []; }
    },
    persist() {
      try {
        localStorage.setItem('inv.history', JSON.stringify(this.history));
        localStorage.setItem('inv.batch', JSON.stringify(this.batch));
      } catch (e) { /* bỏ qua */ }
    },
    add(item) {
      this.history.unshift(item);                       // mới nhất trên cùng
      this.history = this.history.slice(0, MAX_HISTORY);
      if (Settings.data.autoSave) this.persist();
    },
    clearHistory() { this.history = []; this.persist(); },
  };

  /* ---------------- 4. OUTPUT (MODE A + MODE B) ----------------
     Mỗi chế độ là một "adapter". Sau này Android IME có thể thay
     bằng adapter commitText()/sendKeyEvent() mà không đổi Scanner. */
  const Output = {
    getTarget() {
      try { return document.querySelector(Settings.data.targetSelector || '#targetInput'); } catch (e) { return null; }
    },
    // Ghi giá trị vào input và phát sự kiện 'input' để framework (React/Vue...) nhận được
    setValue(el, text) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    pressKey(el, key, code, keyCode) {
      const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
    },
    focusNext(el) {
      const list = [...document.querySelectorAll('input:not([type=hidden]):not([disabled]), textarea, select')]
        .filter((n) => n.offsetParent !== null);
      const next = list[list.indexOf(el) + 1];
      if (next) next.focus({ preventScroll: true });
    },
    async copy(text) {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('Không thể truy cập clipboard (cần HTTPS).');
      await navigator.clipboard.writeText(text);
    },
    /** Trả về true nếu xuất thành công. Ném lỗi nếu thất bại. */
    async emit(code) {
      const mode = Settings.data.outputMode;
      if (mode === 'clipboard') { await this.copy(code); return true; }
      if (mode === 'batch') { Store.batch.push(code); Store.persist(); UI.renderBatch(); return true; }

      const el = this.getTarget();
      if (!el) throw new Error('Không tìm thấy input đích. Kiểm tra mục "Input đích" trong Cài đặt.');
      el.focus({ preventScroll: true });
      this.setValue(el, code);
      if (mode === 'enter') this.pressKey(el, 'Enter', 'Enter', 13);   // đúng 1 lần cho mỗi mã
      if (mode === 'tab') { this.pressKey(el, 'Tab', 'Tab', 9); this.focusNext(el); }
      if (mode !== 'enter' && mode !== 'tab') { /* RAW: chỉ ghi giá trị */ }
      el.focus({ preventScroll: true });                               // giữ focus ở trường nhập liệu
      return true;
    },
  };

  /* ---------------- 5. SCANNER ---------------- */
  const Scanner = {
    reader: null, controls: null, video: null,
    state: 'stopped',            // stopped | starting | running | paused
    seen: new Map(),             // code -> thời điểm thấy gần nhất (chống trùng)
    facing: 'environment',
    torchOn: false,

    buildReader() {
      const hints = new Map();
      const fmts = Settings.data.formats.map((f) => ZXing.BarcodeFormat[f]).filter((v) => v !== undefined);
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, fmts.length ? fmts : ALL_FORMATS.map((f) => ZXing.BarcodeFormat[f]));
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      return new ZXingBrowser.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 });
    },

    async start() {
      if (this.state === 'starting' || this.state === 'running' || this.state === 'paused') return; // chống vòng lặp song song
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return UI.showError('Trình duyệt không hỗ trợ camera (cần HTTPS và trình duyệt mới).');
      }
      if (typeof ZXingBrowser === 'undefined' || typeof ZXing === 'undefined') {
        return UI.showError('Không tải được thư viện nhận diện mã. Kiểm tra mạng rồi thử lại.');
      }
      this.state = 'starting'; UI.setState();
      UI.hideError();
      this.video = $('#video');
      try {
        this.reader = this.buildReader();
        const id = Settings.data.deviceId;
        const constraints = {
          audio: false,
          video: {
            ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: this.facing } }),
            width: { ideal: 1280 }, height: { ideal: 720 },
          },
        };
        this.seen.clear();
        this.controls = await this.reader.decodeFromConstraints(constraints, this.video, (result, err) => {
          if (result) this.onDetect(result);
          else if (err && err.name && !/NotFound|Checksum|Format/.test(err.name)) console.warn('scan error', err);
        });
        this.state = 'running'; UI.setState();
        UI.refreshDevices();
        this.checkTorch();
      } catch (e) {
        this.cleanup();
        this.state = 'stopped'; UI.setState();
        UI.showError(this.explain(e));
      }
    },

    explain(e) {
      const n = (e && e.name) || '';
      if (n === 'NotAllowedError' || n === 'SecurityError') return 'Bạn đã từ chối quyền camera. Hãy cấp quyền trong cài đặt trình duyệt rồi thử lại.';
      if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Không tìm thấy camera phù hợp trên thiết bị.';
      if (n === 'NotReadableError' || n === 'AbortError') return 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.';
      return 'Không thể khởi động camera: ' + (e && e.message ? e.message : n || 'lỗi không xác định');
    },

    /** Xử lý mỗi lần ZXing đọc được mã (có thể gọi nhiều lần/giây cho cùng 1 mã). */
    async onDetect(result) {
      if (this.state !== 'running') return;
      const code = (result.getText() || '').trim();
      const now = Date.now();
      if (!code) { Store.stats.err++; UI.renderStats(); return; }

      // Chống trùng: nếu cùng mã vẫn đang nằm trong camera, luôn cập nhật mốc thời gian.
      // Chỉ khi mã vắng mặt > debounce (đã đưa ra khỏi vùng camera) mới được nhận lại. Không khóa vĩnh viễn.
      const last = this.seen.get(code);
      this.seen.set(code, now);
      if (last !== undefined && now - last < Settings.data.debounce) return;

      const format = ZXing.BarcodeFormat[result.getBarcodeFormat()] || 'UNKNOWN';
      const item = { code, format, type: format === 'QR_CODE' ? 'QR' : 'Barcode', time: now };
      Store.stats.total++;
      try {
        await Output.emit(code);
        Store.stats.ok++;
        Feedback.success();
        Store.add(item);
        UI.showResult(item);
      } catch (e) {
        Store.stats.err++;
        UI.showError(e.message || 'Không thể xuất mã.', true);
        Store.add(item); UI.showResult(item);   // vẫn lưu mã đã quét được
      }
      UI.renderStats(); UI.renderHistory();
      // Camera KHÔNG dừng; tiếp tục quét mã kế tiếp (autoResume chỉ ảnh hưởng khi đang paused)
    },

    pause() {
      if (this.state !== 'running') return;
      this.state = 'paused';
      try { this.video.pause(); } catch (e) { /* bỏ qua */ }
      UI.setState();
    },
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'running';
      try { this.video.play(); } catch (e) { /* bỏ qua */ }
      this.seen.clear();
      UI.setState();
    },
    stop() {
      this.cleanup();
      this.state = 'stopped'; UI.setState();
    },

    /** Giải phóng MediaStream để tắt đèn camera. */
    cleanup() {
      try { if (this.controls) this.controls.stop(); } catch (e) { /* bỏ qua */ }
      this.controls = null;
      const v = this.video || $('#video');
      if (v && v.srcObject) {
        v.srcObject.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      }
      this.reader = null; this.torchOn = false;
      $('#btnTorch').hidden = true;
      $('#btnTorch').classList.remove('on');
    },

    async restart() { this.cleanup(); this.state = 'stopped'; await this.start(); },

    flip() {
      Settings.data.deviceId = '';
      this.facing = this.facing === 'environment' ? 'user' : 'environment';
      if (this.state !== 'stopped') this.restart();
    },

    track() { return this.video && this.video.srcObject ? this.video.srcObject.getVideoTracks()[0] : null; },
    checkTorch() {
      const t = this.track();
      const caps = t && t.getCapabilities ? t.getCapabilities() : {};
      $('#btnTorch').hidden = !caps.torch;   // chỉ hiện nếu thiết bị hỗ trợ
    },
    async toggleTorch() {
      const t = this.track();
      try {
        this.torchOn = !this.torchOn;
        await t.applyConstraints({ advanced: [{ torch: this.torchOn }] });
        $('#btnTorch').classList.toggle('on', this.torchOn);
      } catch (e) {
        this.torchOn = false;
        Feedback.toast('Thiết bị không hỗ trợ đèn Flash.');
      }
    },
  };

  /* ---------------- 6. UI ---------------- */
  const UI = {
    lastFailed: false,
    init() {
      Settings.load(); Store.load();
      this.bind(); this.buildSettings();
      this.renderStats(); this.renderHistory(); this.renderBatch(); this.setState();
      // Log kiểm thử Enter trên input tích hợp
      $('#targetInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const li = document.createElement('li'); li.textContent = e.target.value;
          const log = $('#targetLog'); log.prepend(li);
          while (log.children.length > 20) log.lastChild.remove();
          e.target.value = '';
        }
      });
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    },

    bind() {
      $('#btnStart').onclick = () => Scanner.start();
      $('#btnPause').onclick = () => Scanner.pause();
      $('#btnResume').onclick = () => Scanner.resume();
      $('#btnStop').onclick = () => Scanner.stop();
      $('#btnFlip').onclick = () => Scanner.flip();
      $('#btnTorch').onclick = () => Scanner.toggleTorch();
      $('#btnRetry').onclick = () => { this.hideError(); if (this.lastFailed) { this.lastFailed = false; } else Scanner.restart(); };
      $('#btnClear').onclick = () => this.clearHistory();
      $('#btnWipe').onclick = () => this.clearHistory();
      $('#btnExport').onclick = () => this.exportTxt();
      $('#btnBatchCopy').onclick = () => this.copyText(Store.batch.join('\n'));
      $('#btnBatchClear').onclick = () => { Store.batch = []; Store.persist(); this.renderBatch(); };
      $('#btnSettings').onclick = () => { $('#settings').hidden = false; this.refreshDevices(); };
      $('#btnCloseSettings').onclick = () => { $('#settings').hidden = true; };

      // Tắt camera khi ẩn trang để tránh giữ camera nền
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && Scanner.state === 'running') Scanner.pause();
        else if (!document.hidden && Scanner.state === 'paused' && Settings.data.autoResume) Scanner.resume();
      });
    },

    /* Trạng thái nút + badge */
    setState() {
      const s = Scanner.state;
      $('#btnStart').disabled = s !== 'stopped';
      $('#btnPause').disabled = s !== 'running';
      $('#btnResume').disabled = s !== 'paused';
      $('#btnStop').disabled = s === 'stopped';
      const cam = document.querySelector('.camera');
      cam.classList.toggle('active', s === 'running' || s === 'paused');
      cam.classList.toggle('paused', s === 'paused');
      const b = $('#camStatus');
      b.textContent = { stopped: 'Camera: tắt', starting: 'Camera: đang mở…', running: 'Camera: đang quét', paused: 'Camera: tạm dừng' }[s];
      b.classList.toggle('on', s === 'running');
    },

    showResult(it) {
      $('#resultCode').textContent = it.code;
      $('#resultMeta').textContent = `✔ Quét thành công · ${it.type} (${it.format}) · ${new Date(it.time).toLocaleTimeString()}`;
      $('.result').classList.add('ok');
    },
    showError(msg, outputError) {
      this.lastFailed = !!outputError;
      $('#errorText').textContent = msg; $('#errorBox').hidden = false;
    },
    hideError() { $('#errorBox').hidden = true; },

    renderStats() {
      $('#stTotal').textContent = Store.stats.total;
      $('#stOk').textContent = Store.stats.ok;
      $('#stErr').textContent = Store.stats.err;
    },

    renderHistory() {
      const ul = $('#historyList'); ul.textContent = '';
      if (!Store.history.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Chưa có lịch sử.'; ul.appendChild(li); return; }
      Store.history.forEach((it) => {
        const li = document.createElement('li');
        const meta = document.createElement('div'); meta.className = 'meta';
        const c = document.createElement('div'); c.className = 'code'; c.textContent = it.code;
        const s = document.createElement('div'); s.className = 'sub';
        s.textContent = `${it.type} · ${it.format} · ${new Date(it.time).toLocaleTimeString()}`;
        meta.append(c, s);
        const btn = document.createElement('button'); btn.textContent = 'Copy';
        btn.onclick = () => this.copyText(it.code);
        li.append(meta, btn); ul.appendChild(li);
      });
    },

    renderBatch() {
      $('#batchBox').hidden = Settings.data.outputMode !== 'batch' && !Store.batch.length;
      $('#batchCount').textContent = Store.batch.length;
    },

    async copyText(text) {
      if (!text) return Feedback.toast('Không có gì để sao chép.');
      try { await Output.copy(text); Feedback.toast('Đã sao chép.'); }
      catch (e) { this.showError(e.message || 'Không thể truy cập clipboard.', true); }
    },

    clearHistory() {
      Store.clearHistory(); this.renderHistory(); Feedback.toast('Đã xóa lịch sử.');
    },

    // Mode A: xuất file .txt (lô nếu đang ở chế độ BATCH, ngược lại là lịch sử)
    exportTxt() {
      const lines = Settings.data.outputMode === 'batch' && Store.batch.length
        ? Store.batch : Store.history.slice().reverse().map((h) => h.code);
      if (!lines.length) return Feedback.toast('Không có mã để xuất.');
      const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'inventory-scan.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    /* Settings */
    buildSettings() {
      const d = Settings.data;
      $('#setOutput').value = d.outputMode;
      $('#setDebounce').value = d.debounce;
      $('#setTarget').value = d.targetSelector;
      $('#setSound').checked = d.sound; $('#setVibrate').checked = d.vibrate;
      $('#setAutoResume').checked = d.autoResume; $('#setAutoSave').checked = d.autoSave;

      const box = $('#formatList'); box.textContent = '';
      ALL_FORMATS.forEach((f) => {
        const l = document.createElement('label');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = f; cb.checked = d.formats.includes(f);
        cb.onchange = () => {
          d.formats = [...box.querySelectorAll('input:checked')].map((x) => x.value);
          if (!d.formats.length) { cb.checked = true; d.formats = [f]; Feedback.toast('Cần chọn ít nhất 1 loại mã.'); }
          Settings.save(); if (Scanner.state !== 'stopped') Scanner.restart();
        };
        l.append(cb, document.createTextNode(f.replace('_', ' ')));
        box.appendChild(l);
      });

      const on = (id, key, fn) => { $(id).onchange = (e) => { d[key] = fn(e.target); Settings.save(); this.renderBatch(); }; };
      on('#setOutput', 'outputMode', (t) => t.value);
      on('#setDebounce', 'debounce', (t) => Math.min(10000, Math.max(200, parseInt(t.value, 10) || 1000)));
      on('#setTarget', 'targetSelector', (t) => t.value.trim() || '#targetInput');
      on('#setSound', 'sound', (t) => t.checked);
      on('#setVibrate', 'vibrate', (t) => t.checked);
      on('#setAutoResume', 'autoResume', (t) => t.checked);
      on('#setAutoSave', 'autoSave', (t) => t.checked);
      $('#setCamera').onchange = (e) => {
        d.deviceId = e.target.value; Settings.save();
        if (Scanner.state !== 'stopped') Scanner.restart();
      };
    },

    /* Liệt kê camera (nhãn chỉ có sau khi được cấp quyền) */
    async refreshDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'videoinput');
        const sel = $('#setCamera'); sel.textContent = '';
        const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Tự động (camera sau)'; sel.appendChild(auto);
        list.forEach((dv, i) => {
          const o = document.createElement('option'); o.value = dv.deviceId; o.textContent = dv.label || `Camera ${i + 1}`;
          sel.appendChild(o);
        });
        sel.value = Settings.data.deviceId;
      } catch (e) { /* bỏ qua */ }
    },
  };

  // API công khai để tích hợp vào website công ty (khi nhúng scanner cùng trang)
  window.InventoryScanner = {
    setTarget(selectorOrEl) {
      if (typeof selectorOrEl === 'string') Settings.data.targetSelector = selectorOrEl;
      else if (selectorOrEl) { selectorOrEl.id = selectorOrEl.id || 'inv-target'; Settings.data.targetSelector = '#' + selectorOrEl.id; }
      Settings.save();
    },
    start: () => Scanner.start(), stop: () => Scanner.stop(),
  };

  document.addEventListener('DOMContentLoaded', () => UI.init());
})();
