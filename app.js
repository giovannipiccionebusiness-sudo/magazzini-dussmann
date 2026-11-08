const API_URL = "https://script.google.com/macros/s/AKfycbyTV9tRU9WmmYjt1n2ayLRNck3QxOyVw_bq40FYYIXXcbr6o7GoVhiYMFkMl5VuqURy/exec";

let APP = {
  user: null,
  actionType: null,
  scanner: null,
  scannerRunning: false,
  progressTimer: null
};

function $(id){ return document.getElementById(id); }

function show(id){ $(id).classList.remove("hidden"); }
function hide(id){ $(id).classList.add("hidden"); }

function setMsg(id, text, cls){
  const el = $(id);
  el.className = "msg " + cls;
  el.innerHTML = text;
  el.classList.remove("hidden");
}

function startProgress(title, text){
  $("progressTitle").textContent = title || "Operazione in corso…";
  $("progressText").textContent = text || "Attendere qualche secondo…";
  $("progressBar").style.width = "12%";
  show("progressOverlay");

  let p = 12;
  clearInterval(APP.progressTimer);

  APP.progressTimer = setInterval(() => {
    if (p < 86) {
      p += Math.random() * 12;
      if (p > 86) p = 86;
      $("progressBar").style.width = p + "%";
    }
  }, 350);
}

function stopProgress(finalText){
  clearInterval(APP.progressTimer);
  $("progressBar").style.width = "100%";
  if (finalText) $("progressText").textContent = finalText;

  setTimeout(() => {
    hide("progressOverlay");
    $("progressBar").style.width = "0%";
  }, 350);
}

function saveLoginSession(user){
  localStorage.setItem("magazzino_user", JSON.stringify(user));
}

function loadLoginSession(){
  try {
    const raw = localStorage.getItem("magazzino_user");
    return raw ? JSON.parse(raw) : null;
  } catch(e){
    return null;
  }
}

function clearLoginSession(){
  localStorage.removeItem("magazzino_user");
}

function restoreSessionIfAvailable(){
  const saved = loadLoginSession();
  if (!saved) return false;

  APP.user = saved;
  $("chipOperatore").textContent = "Operatore: " + (saved.nome || "--");
  $("chipRuolo").textContent = "Ruolo: " + (saved.role || "--");
  loadSedi(saved.sediDisponibili || []);

  hide("loginCard");
  show("appCard");
  setMsg("mainMsg", "Sessione ripristinata.", "ok");

  return true;
}

function jsonpRequest(params){
  return new Promise((resolve, reject) => {
    const callbackName = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    params.callback = callbackName;

    const query = new URLSearchParams(params).toString();
    const script = document.createElement("script");
    script.src = API_URL + "?" + query;

    let finished = false;

    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    };

    window[callbackName] = function(data){
      finished = true;
      cleanup();
      resolve(data);
    };

    script.onerror = function(){
      if (!finished) {
        cleanup();
        reject(new Error("Errore di comunicazione con Apps Script"));
      }
    };

    document.body.appendChild(script);

    setTimeout(() => {
      if (!finished) {
        cleanup();
        reject(new Error("Timeout di comunicazione con Apps Script"));
      }
    }, 20000);
  });
}

async function initApp(){
  try {
    startProgress("Avvio app", "Caricamento operatori…");

    const data = await jsonpRequest({ action: "init" });

    const sel = $("operatoreSelect");
    sel.innerHTML = '<option value="">Seleziona operatore</option>';

    (data.operatori || []).forEach(op => {
      const opt = document.createElement("option");
      opt.value = op.id;
      opt.textContent = op.nome + (op.sedeAssegnata ? " - " + op.sedeAssegnata : "");
      sel.appendChild(opt);
    });

    restoreSessionIfAvailable();
    stopProgress("Operatori caricati");

  } catch (err) {
    stopProgress();
    setMsg("loginMsg", err.message, "err");
  }
}

async function doLogin(){
  const operatoreId = $("operatoreSelect").value;
  const pin = $("pinOperatore").value.trim();

  if (!operatoreId) {
    setMsg("loginMsg", "Seleziona un operatore.", "err");
    return;
  }

  if (!pin) {
    setMsg("loginMsg", "Inserisci il PIN.", "err");
    return;
  }

  try {
    startProgress("Accesso", "Verifica credenziali…");

    const data = await jsonpRequest({
      action: "login",
      operatoreId: operatoreId,
      pin: pin
    });

    if (!data.ok) throw new Error(data.error || "Login non riuscito");

    APP.user = data;
    saveLoginSession(data);

    $("chipOperatore").textContent = "Operatore: " + (data.nome || "--");
    $("chipRuolo").textContent = "Ruolo: " + (data.role || "--");

    loadSedi(data.sediDisponibili || []);

    hide("loginCard");
    show("appCard");

    setMsg("mainMsg", "Accesso effettuato correttamente.", "ok");
    stopProgress("Accesso completato");

  } catch (err) {
    stopProgress();
    setMsg("loginMsg", err.message, "err");
  }
}

function logoutApp(){
  stopScanner();
  clearLoginSession();

  APP.user = null;

  show("loginCard");
  hide("appCard");
  hide("movementCard");
  closeDdtModal();
  hide("orderModal");
  hide("receiveModal");
  hide("deliveryModal");

  $("pinOperatore").value = "";
  setMsg("loginMsg", "Sessione chiusa.", "info");
}

function loadSedi(sedi){
  const sel = $("sede");
  sel.innerHTML = "";

  sedi.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
}

function hideAllModals(){
  hide("movementCard");
  closeDdtModal();
  hide("orderModal");
  hide("receiveModal");
  hide("deliveryModal");
  hide("adminDashboardModal");
}

function openAction(tipo){
  stopScanner();

  APP.actionType = tipo;

  $("movementTitle").textContent = tipo === "CARICO" ? "Carica Prodotto" : "Scarica Prodotto";
  $("barcode").value = "";
  $("qty").value = 1;
  $("noteMov").value = "";

  hide("productMsg");
  hide("reader");
  hideAllModals();
  show("movementCard");
}

function closeMovement(){
  stopScanner();
  hide("movementCard");
}

function openDdtModal(){
  if (!APP.user || !APP.user.operatoreId) {
    setMsg("mainMsg", "Sessione non valida.", "err");
    return;
  }

  const sede = $("sede").value;

  if (!sede) {
    setMsg("mainMsg", "Seleziona una sede.", "err");
    return;
  }

  $("ddtCamera").value = "";
  $("ddtFile").value = "";
  $("ddtSaveBtn").disabled = false;
  $("ddtNote").value = "";
  $("ddtNotes").open = false;
  $("ddtPreview").removeAttribute("src");
  hide("ddtPreview");
  hide("ddtMsg");

  hideAllModals();
  show("ddtModal");
  $("ddtScroll").scrollTop = 0;
}

function closeDdtModal(){
  closeDdtCamera();
  hide("ddtNativeCameraBtn");
  clearDdtScan();
  hide("ddtModal");
}

let ddtCameraRequest;

async function openDdtCamera(){
  if (ddtCameraRequest) return;

  const request = {};
  ddtCameraRequest = request;
  const video = $("ddtCameraVideo");
  $("ddtCaptureBtn").disabled = true;
  hide("ddtNativeCameraBtn");
  hide("ddtMsg");
  show("ddtCameraPanel");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } }
    });

    if (ddtCameraRequest !== request) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    video.srcObject = stream;
    await video.play();
    if (ddtCameraRequest === request) $("ddtCaptureBtn").disabled = false;
  } catch {
    if (ddtCameraRequest !== request) return;
    closeDdtCamera();
    setMsg("ddtMsg", "Fotocamera integrata non disponibile. Puoi usare la fotocamera del telefono o caricare un’immagine.", "info");
    show("ddtNativeCameraBtn");
  }
}

function closeDdtCamera(){
  ddtCameraRequest = undefined;
  const video = $("ddtCameraVideo");
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  hide("ddtCameraPanel");
}

function captureDdtPhoto(){
  const request = ddtCameraRequest;
  const video = $("ddtCameraVideo");
  if (!request || !video.videoWidth || !video.videoHeight) return;

  const captureButton = $("ddtCaptureBtn");
  captureButton.disabled = true;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);

  canvas.toBlob(blob => {
    if (ddtCameraRequest !== request) return;
    if (!blob) {
      captureButton.disabled = false;
      setMsg("ddtMsg", "Foto non acquisita. Riprova.", "err");
      return;
    }

    const files = new DataTransfer();
    files.items.add(new File([blob], "ddt.jpg", { type: "image/jpeg" }));
    const input = $("ddtFile");
    input.files = files.files;
    previewDdt(input);
  }, "image/jpeg", 0.92);
}

window.addEventListener("pagehide", closeDdtCamera);

let ddtScan;

function clearDdtScan(){
  if (ddtScan) ddtScan.urls.forEach(url => URL.revokeObjectURL(url));
  ddtScan = undefined;
  hide("ddtScanOptions");
  hide("ddtPreview");
  hide("ddtReview");
  hide("ddtFooter");
  show("ddtSourceActions");
  $("ddtReplaceBtn").setAttribute("aria-expanded", "false");
}

function toggleDdtSources(){
  const button = $("ddtReplaceBtn");
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  if (expanded) {
    closeDdtCamera();
    hide("ddtNativeCameraBtn");
    hide("ddtSourceActions");
  } else {
    show("ddtSourceActions");
    $("ddtScroll").scrollTop = 0;
  }
}

async function previewDdt(input){
  const file = input.files[0];
  if (!file) return;
  const cameraInput = $("ddtCamera");
  if (input === cameraInput) $("ddtFile").files = cameraInput.files;
  cameraInput.value = "";
  closeDdtCamera();
  hide("ddtNativeCameraBtn");
  clearDdtScan();

  hide("ddtSourceActions");
  $("ddtScroll").scrollTop = 0;

  const saveButton = $("ddtSaveBtn");
  saveButton.disabled = true;
  setMsg("ddtMsg", "Preparazione scansione…", "info");
  const url = URL.createObjectURL(file);
  const scan = { original: file, urls: [url] };
  ddtScan = scan;

  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = scanDdtDocument(image);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.94));
    if (ddtScan !== scan) return;
    if (!blob) throw new Error("Scansione non disponibile");
    scan.improved = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    scan.urls.push(URL.createObjectURL(scan.improved));
    showDdtScan(true);
    show("ddtScanOptions");
    hide("ddtMsg");
  } catch {
    if (ddtScan !== scan) return;
    showDdtScan(false);
    setMsg("ddtMsg", "È stata mantenuta l’immagine originale.", "info");
  } finally {
    if (ddtScan === scan) {
      saveButton.disabled = false;
      show("ddtReview");
      show("ddtFooter");
    }
  }
}

function showDdtScan(improved){
  if (!ddtScan) return;
  const file = improved ? ddtScan.improved : ddtScan.original;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $("ddtFile").files = transfer.files;
  $("ddtPreview").src = ddtScan.urls[Number(improved)];
  $("ddtOriginalBtn").setAttribute("aria-pressed", String(!improved));
  $("ddtImprovedBtn").setAttribute("aria-pressed", String(improved));
  show("ddtPreview");
}

function scanDdtDocument(image){
  const source = document.createElement("canvas");
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  source.width = Math.max(1, Math.round(image.naturalWidth * scale));
  source.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const sourceContext = source.getContext("2d");
  sourceContext.fillStyle = "#fff";
  sourceContext.fillRect(0, 0, source.width, source.height);
  sourceContext.drawImage(image, 0, 0, source.width, source.height);

  const sample = document.createElement("canvas");
  const sampleScale = Math.min(1, 360 / Math.max(source.width, source.height));
  sample.width = Math.max(1, Math.round(source.width * sampleScale));
  sample.height = Math.max(1, Math.round(source.height * sampleScale));
  const context = sample.getContext("2d");
  context.drawImage(source, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  const detected = Math.min(sample.width, sample.height) >= 40
    ? findDdtCorners(pixels, sample.width, sample.height) : null;
  const result = detected ? straightenDdt(source, detected.map(point => ({
    x: point.x * source.width / sample.width,
    y: point.y * source.height / sample.height
  }))) : source;
  improveDdtLighting(result);
  return result;
}

function straightenDdt(source, [topLeft, topRight, bottomRight, bottomLeft]){
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const output = document.createElement("canvas");
  output.width = Math.max(2, Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))));
  output.height = Math.max(2, Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))));
  const input = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
  const context = output.getContext("2d");
  const result = context.createImageData(output.width, output.height);

  // Inverse projective map from the rectangular output to the detected page.
  const rightX = topRight.x - bottomRight.x;
  const leftX = bottomLeft.x - bottomRight.x;
  const rightY = topRight.y - bottomRight.y;
  const leftY = bottomLeft.y - bottomRight.y;
  const dx = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const determinant = rightX * leftY - leftX * rightY;
  if (Math.abs(determinant) < 1) return source;
  const g = (dx * leftY - leftX * dy) / determinant;
  const h = (rightX * dy - dx * rightY) / determinant;
  const ax = topRight.x * (1 + g) - topLeft.x;
  const bx = bottomLeft.x * (1 + h) - topLeft.x;
  const ay = topRight.y * (1 + g) - topLeft.y;
  const by = bottomLeft.y * (1 + h) - topLeft.y;

  for (let y = 0; y < output.height; y++) {
    const v = y / (output.height - 1);
    for (let x = 0; x < output.width; x++) {
      const u = x / (output.width - 1);
      const divisor = 1 + g * u + h * v;
      const sx = Math.max(0, Math.min(source.width - 1, (ax * u + bx * v + topLeft.x) / divisor));
      const sy = Math.max(0, Math.min(source.height - 1, (ay * u + by * v + topLeft.y) / divisor));
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      const left = (iy * source.width + ix) * 4;
      const right = left + (ix < source.width - 1 ? 4 : 0);
      const row = iy < source.height - 1 ? source.width * 4 : 0;
      const target = (y * output.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const top = input[left + channel] * (1 - fx) + input[right + channel] * fx;
        const bottom = input[left + row + channel] * (1 - fx) + input[right + row + channel] * fx;
        result.data[target + channel] = top * (1 - fy) + bottom * fy;
      }
      result.data[target + 3] = 255;
    }
  }
  context.putImageData(result, 0, 0);
  return output;
}

function improveDdtLighting(canvas){
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;
  const columns = Math.min(32, width);
  const rows = Math.min(32, height);
  const background = new Uint8Array(columns * rows);

  // Estimate the brightness of the paper in each tile while ignoring dark print.
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const values = [];
      for (let y = Math.floor(row * height / rows); y < Math.floor((row + 1) * height / rows); y += 3) {
        for (let x = Math.floor(column * width / columns); x < Math.floor((column + 1) * width / columns); x += 3) {
          const i = (y * width + x) * 4;
          values.push((data[i] * 2 + data[i + 1] * 5 + data[i + 2]) / 8);
        }
      }
      values.sort((a, b) => a - b);
      background[row * columns + column] = values[Math.floor((values.length - 1) * 0.82)];
    }
  }

  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, Math.min(rows - 1, y * rows / height - 0.5));
    const top = Math.floor(sy);
    const bottom = Math.min(rows - 1, top + 1);
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(columns - 1, x * columns / width - 0.5));
      const left = Math.floor(sx);
      const right = Math.min(columns - 1, left + 1);
      const fraction = sx - left;
      const upper = background[top * columns + left] * (1 - fraction) + background[top * columns + right] * fraction;
      const lower = background[bottom * columns + left] * (1 - fraction) + background[bottom * columns + right] * fraction;
      const paper = upper * (1 - (sy - top)) + lower * (sy - top);
      const gain = Math.min(1.85, Math.max(1, 238 / Math.max(1, paper)));
      const i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        data[i + channel] = Math.max(0, (data[i + channel] - 8) * gain + 8);
      }
    }
  }
  context.putImageData(image, 0, 0);
}

function findDdtCorners(pixels, width, height){
  function fitEdge(horizontal, farSide){
    const length = horizontal ? width : height;
    const depth = horizontal ? height : width;
    const points = [];
    for (let line = 0; line < 25; line++) {
      const along = Math.round(length * (0.28 + line * 0.44 / 24));
      const candidates = [];
      for (let offset = 4; offset < depth * 0.36; offset++) {
        const across = farSide ? depth - 1 - offset : offset;
        const pixel = horizontal ? across * width + along : along * width + across;
        const step = horizontal ? width : 1;
        const before = (pixel - 3 * step) * 4;
        const after = (pixel + 3 * step) * 4;
        const contrast = (
          Math.abs(pixels[after] - pixels[before]) +
          Math.abs(pixels[after + 1] - pixels[before + 1]) +
          Math.abs(pixels[after + 2] - pixels[before + 2])
        ) / 3;
        const score = contrast * (1 - 0.55 * offset / depth);
        if (score > 22) candidates.push({ edge: across, score });
      }
      candidates.sort((a, b) => b.score - a.score);
      const edges = [];
      for (const { edge } of candidates) {
        if (edges.some(other => Math.abs(other - edge) < 7)) continue;
        edges.push(edge);
        if (edges.length === 4) break;
      }
      if (edges.length) points.push({ along, edges });
    }

    let best;
    let bestCount = 0;
    const tolerance = Math.max(2, depth * 0.013);
    for (const first of points) {
      for (const last of points) {
        if (last.along - first.along < length * 0.20) continue;
        for (const firstEdge of first.edges) {
          for (const lastEdge of last.edges) {
            const slope = (lastEdge - firstEdge) / (last.along - first.along);
            if (Math.abs(slope) > 0.4) continue;
            const intercept = firstEdge - slope * first.along;
            let count = 0;
            for (const point of points) {
              const expected = slope * point.along + intercept;
              if (point.edges.some(edge => Math.abs(edge - expected) <= tolerance)) count++;
            }
            if (count > bestCount) {
              best = { slope, intercept };
              bestCount = count;
            }
          }
        }
      }
    }
    return bestCount >= 15 ? best : null;
  }

  const top = fitEdge(true, false);
  const bottom = fitEdge(true, true);
  const left = fitEdge(false, false);
  const right = fitEdge(false, true);
  if (!top || !bottom || !left || !right) return null;

  function intersect(horizontal, vertical){
    const x = (vertical.intercept + vertical.slope * horizontal.intercept) /
      (1 - vertical.slope * horizontal.slope);
    return { x, y: horizontal.slope * x + horizontal.intercept };
  }

  const corners = [intersect(top, left), intersect(top, right), intersect(bottom, right), intersect(bottom, left)];
  if (corners.some(({ x, y }) => x < 0 || y < 0 || x >= width || y >= height)) return null;
  const area = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % corners.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  if (area < width * height * 0.24 || area > width * height * 0.94) return null;
  return corners;
}

function resizeImageToJpegBase64(file, maxWidth = 1400, quality = 0.78){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function(e){
      const img = new Image();

      img.onload = function(){
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      img.onerror = reject;
      img.src = e.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveDdt(){
  const file = $("ddtFile").files && $("ddtFile").files[0];
  const note = $("ddtNote").value.trim();
  const sede = $("sede").value;

  if (!APP.user || !APP.user.operatoreId) {
    setMsg("ddtMsg", "Sessione non valida.", "err");
    return;
  }

  if (!file) {
    setMsg("ddtMsg", "Seleziona una foto del DDT.", "err");
    return;
  }

  try {
    startProgress("Preparazione DDT", "Compressione immagine in corso…");

    const dataUrl = await resizeImageToJpegBase64(file);

    startProgress("Salvataggio DDT", "Invio al backend…");

    await postDdtForm({
      operatoreId: APP.user.operatoreId,
      sede: sede,
      note: note,
      dataUrl: dataUrl,
      fileName: file.name || "ddt.jpg"
    });

    stopProgress("DDT salvato");

    setMsg("ddtMsg", "DDT salvato correttamente.", "ok");

    setTimeout(() => {
      closeDdtModal();
      setMsg("mainMsg", "DDT salvato correttamente.", "ok");
    }, 900);

  } catch (err) {
    stopProgress();
    setMsg("ddtMsg", err.message, "err");
  }
}

function postDdtForm(payload){
  return new Promise((resolve, reject) => {
    const iframeName = "ddt_upload_iframe_" + Date.now();

    const iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.style.display = "none";

    const form = document.createElement("form");
    form.method = "POST";
    form.action = API_URL;
    form.target = iframeName;
    form.style.display = "none";

    const fields = {
      action: "uploadDdtPost",
      operatoreId: payload.operatoreId,
      sede: payload.sede,
      note: payload.note,
      dataUrl: payload.dataUrl,
      fileName: payload.fileName
    };

    Object.keys(fields).forEach(key => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = fields[key] || "";
      form.appendChild(input);
    });

    let submitted = false;

    iframe.onload = function(){
      if (!submitted) return;

      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        if (form.parentNode) form.parentNode.removeChild(form);
      }, 500);

      resolve({ ok: true });
    };

    iframe.onerror = function(){
      reject(new Error("Errore caricamento DDT"));
    };

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    setTimeout(() => {
      submitted = true;
      form.submit();
    }, 100);
  });
}

function startScanner(){
  const readerId = "reader";

  show(readerId);

  if (APP.scannerRunning) return;

  APP.scanner = new Html5Qrcode(readerId, {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.ITF
    ]
  });

  Html5Qrcode.getCameras().then(cameras => {
    if (!cameras || !cameras.length) {
      setMsg("productMsg", "Nessuna fotocamera disponibile.", "err");
      return;
    }

    APP.scanner.start(
      { facingMode: "environment" },
      {
        fps: 12,
        qrbox: { width: 280, height: 140 },
        aspectRatio: 1.7778
      },
      decodedText => {
        $("barcode").value = decodedText;
        setMsg("productMsg", "Codice a barre rilevato: <b>" + decodedText + "</b>", "ok");
        stopScanner();
      },
      () => {}
    ).then(() => {
      APP.scannerRunning = true;
      setMsg("productMsg", "Scanner attivo. Inquadra il codice a barre del prodotto.", "info");
    }).catch(err => {
      setMsg("productMsg", "Errore fotocamera/scanner: " + err, "err");
    });

  }).catch(err => {
    setMsg("productMsg", "Errore fotocamera: " + err, "err");
  });
}

function stopScanner(){
  if (APP.scanner && APP.scannerRunning) {
    APP.scanner.stop().then(() => {
      APP.scannerRunning = false;
      hide("reader");
      APP.scanner.clear();
    }).catch(() => {
      APP.scannerRunning = false;
      hide("reader");
    });
  } else {
    APP.scannerRunning = false;
    hide("reader");
  }
}

async function lookupProduct(){
  const sede = $("sede").value;
  const barcode = $("barcode").value.trim();

  if (!barcode) {
    setMsg("productMsg", "Inserisci il codice.", "err");
    return;
  }

  try {
    startProgress("Verifica prodotto", "Ricerca del prodotto in magazzino…");

    const res = await jsonpRequest({
      action: "verificaProdotto",
      sede: sede,
      barcode: barcode,
      operatoreId: APP.user.operatoreId
    });

    stopProgress("Prodotto verificato");

    if (!res.found) {
      setMsg("productMsg", "Prodotto non presente in questa sede.", "warn");
      return;
    }

    setMsg(
      "productMsg",
      "<b>Prodotto:</b> " + res.product.prodotto + "<br>" +
      "<b>Codice:</b> " + res.product.barcode + "<br>" +
      "<b>Unità:</b> " + (res.product.unita || "-") + "<br>" +
      "<b>Giacenza:</b> " + res.product.giacenza + "<br>" +
      "<b>Scorta minima:</b> " + res.product.scortaMinima + "<br>" +
      "<b>Fornitore:</b> " + (res.product.fornitore || "-"),
      "ok"
    );

  } catch (err) {
    stopProgress();
    setMsg("productMsg", err.message, "err");
  }
}

async function saveMovement(){
  const sede = $("sede").value;
  const barcode = $("barcode").value.trim();
  const qta = Number($("qty").value || 0);
  const note = $("noteMov").value.trim();

  if (!barcode) {
    setMsg("mainMsg", "Codice mancante.", "err");
    return;
  }

  if (!qta || qta <= 0) {
    setMsg("mainMsg", "Quantità non valida.", "err");
    return;
  }

  try {
    startProgress("Salvataggio movimento", "Aggiornamento giacenza e storico…");

    const res = await jsonpRequest({
      action: "movimento",
      sede: sede,
      barcode: barcode,
      qta: qta,
      tipo: APP.actionType,
      note: note,
      operatoreId: APP.user.operatoreId
    });

    if (!res.ok) throw new Error(res.error || "Movimento non salvato");

    stopProgress("Movimento salvato");

    let msg =
      "Movimento registrato.<br>" +
      "<b>Prodotto:</b> " + res.prodotto + "<br>" +
      "<b>Giacenza precedente:</b> " + res.giacenzaPrecedente + "<br>" +
      "<b>Nuova giacenza:</b> " + res.giacenzaNuova;

    if (res.sottoScorta) {
      setMsg("mainMsg", msg + "<br><b>Attenzione:</b> sotto scorta minima.", "warn");
    } else {
      setMsg("mainMsg", msg, "ok");
    }

    closeMovement();

  } catch (err) {
    stopProgress();
    setMsg("mainMsg", err.message, "err");
  }
}

async function openDeliveryModal(){
  if (!APP.user || !APP.user.operatoreId) {
    setMsg("mainMsg", "Sessione non valida.", "err");
    return;
  }

  const sede = $("sede").value;

  if (!sede) {
    setMsg("mainMsg", "Seleziona una sede.", "err");
    return;
  }

  $("deliveryOperatoreBox").textContent = "Operatore: " + APP.user.nome;
  $("deliverySedeBox").textContent = "Sede: " + sede;
  $("deliveryList").innerHTML = "";
  $("deliveryNote").value = "";
  hide("deliveryMsg");

  hideAllModals();
  show("deliveryModal");

  try {
    startProgress("Caricamento prodotti", "Carico i prodotti disponibili…");

    const res = await jsonpRequest({
      action: "getDeliveryProducts",
      sede: sede,
      operatoreId: APP.user.operatoreId
    });

    if (!res.ok) throw new Error(res.error || "Errore caricamento prodotti");

    stopProgress("Prodotti caricati");

    renderDeliveryProducts(res.products || []);

  } catch (err) {
    stopProgress();
    setMsg("deliveryMsg", err.message, "err");
  }
}

function closeDeliveryModal(){
  hide("deliveryModal");
}

function safeId(value){
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function renderDeliveryProducts(products){
  const box = $("deliveryList");
  box.innerHTML = "";

  if (!products.length) {
    box.innerHTML = '<div class="msg warn">Nessun prodotto disponibile da consegnare.</div>';
    return;
  }

  products.forEach(p => {
    const sid = safeId(p.barcode);
    const img = p.linkFoto
      ? '<img class="delivery-img" src="' + p.linkFoto + '" alt="Foto prodotto">'
      : '';

    const html = `
      <div class="delivery-item">
        ${img}
        <div class="delivery-title">${p.prodotto}</div>
        <div class="delivery-small">
          Codice: ${p.barcode}<br>
          Fornitore: ${p.fornitore || "-"}<br>
          Disponibile: ${p.giacenza} ${p.unita || ""}
        </div>

        <div class="qty-row">
          <button class="qty-btn" onclick="changeDeliveryQty('${sid}', -1)">−</button>
          <div class="qty-value" id="delqty_${sid}">0</div>
          <button class="qty-btn" onclick="changeDeliveryQty('${sid}', 1)">+</button>
        </div>

        <input
          type="hidden"
          class="delivery-qty"
          id="delinput_${sid}"
          value="0"
          data-barcode="${p.barcode}"
          data-prodotto="${p.prodotto}"
          data-max="${p.giacenza}">
      </div>
    `;

    box.insertAdjacentHTML("beforeend", html);
  });
}

function changeDeliveryQty(sid, delta){
  const input = $("delinput_" + sid);
  const label = $("delqty_" + sid);

  if (!input || !label) return;

  const max = Number(input.dataset.max || 0);
  let val = Number(input.value || 0);

  val += Number(delta || 0);

  if (val < 0) val = 0;
  if (val > max) val = max;

  input.value = val;
  label.textContent = val;
}

async function saveDelivery(){
  const sede = $("sede").value;
  const note = $("deliveryNote").value.trim();
  const inputs = document.querySelectorAll(".delivery-qty");

  const items = [];

  inputs.forEach(input => {
    const qta = Number(input.value || 0);

    if (qta > 0) {
      items.push({
        barcode: input.dataset.barcode,
        prodotto: input.dataset.prodotto,
        qta: qta
      });
    }
  });

  if (!items.length) {
    setMsg("deliveryMsg", "Seleziona almeno un prodotto da consegnare.", "err");
    return;
  }

  try {
    startProgress("Salvataggio consegna", "Aggiornamento giacenze…");

    const res = await jsonpRequest({
      action: "saveDelivery",
      sede: sede,
      operatoreId: APP.user.operatoreId,
      note: note,
      items: JSON.stringify(items)
    });

    if (!res.ok) throw new Error(res.error || "Errore salvataggio consegna");

    stopProgress("Consegna salvata");

    setMsg("deliveryMsg", "Consegna materiale salvata correttamente.", "ok");

    setTimeout(() => {
      closeDeliveryModal();
      setMsg("mainMsg", "Consegna materiale registrata correttamente.", "ok");
    }, 900);

  } catch (err) {
    stopProgress();
    setMsg("deliveryMsg", err.message, "err");
  }
}

async function openOrderModal(){
  if (!APP.user || !APP.user.operatoreId) {
    setMsg("mainMsg", "Sessione non valida.", "err");
    return;
  }

  const sede = $("sede").value;

  if (!sede) {
    setMsg("mainMsg", "Seleziona una sede.", "err");
    return;
  }

  $("orderOperatoreBox").textContent = "Operatore: " + APP.user.nome;
  $("orderSedeBox").textContent = "Sede: " + sede;
  $("orderNote").value = "";
  $("orderList").innerHTML = "";
  hide("orderMsg");

  hideAllModals();
  show("orderModal");

  try {
    startProgress("Caricamento prodotti", "Ricerca prodotti sotto scorta…");

    const res = await jsonpRequest({
      action: "getOrderProducts",
      sede: sede,
      operatoreId: APP.user.operatoreId
    });

    if (!res.ok) throw new Error(res.error || "Errore prodotti ordine");

    stopProgress("Prodotti caricati");
    renderOrderProducts(res.products || []);

  } catch (err) {
    stopProgress();
    setMsg("orderMsg", err.message, "err");
  }
}

function closeOrderModal(){
  hide("orderModal");
}

function buildQtyOptions(qtaSuggerita, minOrdine, multiploOrdine){
  minOrdine = Number(minOrdine || 1);
  multiploOrdine = Number(multiploOrdine || 1);

  let options = `<option value="0" selected>0</option>`;

  let start = minOrdine;

  if (multiploOrdine > 1) {
    start = Math.ceil(minOrdine / multiploOrdine) * multiploOrdine;
  }

  for (let i = 0; i < 30; i++) {
    const value = start + (i * multiploOrdine);
    options += `<option value="${value}">${value}</option>`;
  }

  return options;
}

function renderOrderProducts(products){
  const box = $("orderList");
  box.innerHTML = "";

  if (!products.length) {
    box.innerHTML = '<div class="msg ok">Nessun prodotto sotto scorta.</div>';
    return;
  }

  products.forEach(p => {
    const minOrdine = Number(p.minOrdine || 1);
    const multiploOrdine = Number(p.multiploOrdine || 1);
    const qtaSuggerita = Number(p.qtaSuggerita || minOrdine);

    const sottoScorta = Number(p.giacenza || 0) <= Number(p.scortaMinima || 0);
    const alertClass = sottoScorta ? " order-alert" : "";

    const img = p.linkFoto
      ? '<img class="order-img" src="' + p.linkFoto + '" alt="Foto prodotto">'
      : '';

    const multiploText = multiploOrdine > 1
      ? '<br>Multiplo obbligatorio: ' + multiploOrdine
      : '';

    const options = buildQtyOptions(qtaSuggerita, minOrdine, multiploOrdine);

    const html = `
      <div class="order-item${alertClass}">
        ${img}

        ${sottoScorta ? '<div class="stock-warning">⚠️ Prodotto sotto scorta</div>' : ''}

        <div class="order-title">${p.prodotto}</div>

        <div class="order-small">
          Codice: ${p.barcode}<br>
          Fornitore: ${p.fornitore || "-"}<br>
          Giacenza: ${p.giacenza}<br>
          Scorta minima: ${p.scortaMinima}<br>
          Ordine minimo fornitore: ${minOrdine}
          ${multiploText}<br>
          Quantità consigliata: ${qtaSuggerita}
        </div>

        <label>Quantità ordine</label>
        <select
          class="order-qty"
          data-barcode="${p.barcode}"
          data-prodotto="${p.prodotto}"
          data-giacenza="${p.giacenza}"
          data-scorta="${p.scortaMinima}"
          data-minordine="${minOrdine}"
          data-multiplo="${multiploOrdine}"
          data-fornitore="${p.fornitore || "SENZA FORNITORE"}">
          ${options}
        </select>
      </div>
    `;

    box.insertAdjacentHTML("beforeend", html);
  });
}

async function saveOrder(){
  const sede = $("sede").value;
  const inputs = document.querySelectorAll(".order-qty");

  const items = [];

  for (const input of inputs) {
    const qta = Number(input.value || 0);
    const minOrdine = Number(input.dataset.minordine || 1);
    const multiploOrdine = Number(input.dataset.multiplo || 1);
    const prodotto = input.dataset.prodotto;

    if (qta > 0) {
      if (qta < minOrdine) {
        setMsg("orderMsg", prodotto + ": quantità minima ordinabile " + minOrdine, "err");
        return;
      }

      if (multiploOrdine > 1 && qta % multiploOrdine !== 0) {
        setMsg("orderMsg", prodotto + ": ordinabile solo in multipli di " + multiploOrdine, "err");
        return;
      }

      items.push({
        barcode: input.dataset.barcode,
        prodotto: prodotto,
        giacenza: input.dataset.giacenza,
        scortaMinima: input.dataset.scorta,
        minOrdine: minOrdine,
        multiploOrdine: multiploOrdine,
        qtaOrdine: qta,
        fornitore: input.dataset.fornitore || "SENZA FORNITORE"
      });
    }
  }

  if (!items.length) {
    setMsg("orderMsg", "Nessun prodotto selezionato.", "err");
    return;
  }

  try {
    startProgress("Salvataggio ordine", "Registrazione ordine…");

    await postOrderForm({
      operatoreId: APP.user.operatoreId,
      sede: sede,
      items: JSON.stringify(items)
    });

    stopProgress("Ordine salvato");

    setMsg("orderMsg", "Ordine salvato correttamente.", "ok");

    setTimeout(() => {
      closeOrderModal();
      setMsg("mainMsg", "Nuovo ordine salvato correttamente.", "ok");
    }, 900);

  } catch (err) {
    stopProgress();
    setMsg("orderMsg", err.message, "err");
  }
}

function postOrderForm(payload){
  return new Promise((resolve, reject) => {
    const iframeName = "order_iframe_" + Date.now();

    const iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.style.display = "none";

    const form = document.createElement("form");
    form.method = "POST";
    form.action = API_URL;
    form.target = iframeName;
    form.style.display = "none";

    const fields = {
      action: "saveOrderPost",
      operatoreId: payload.operatoreId,
      sede: payload.sede,
      items: payload.items
    };

    Object.keys(fields).forEach(key => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = fields[key] || "";
      form.appendChild(input);
    });

    let submitted = false;

    iframe.onload = function(){
      if (!submitted) return;

      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        if (form.parentNode) form.parentNode.removeChild(form);
      }, 500);

      resolve({ ok: true });
    };

    iframe.onerror = function(){
      reject(new Error("Errore salvataggio ordine"));
    };

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    setTimeout(() => {
      submitted = true;
      form.submit();
    }, 100);
  });
}

async function openReceiveModal(){
  if (!APP.user || !APP.user.operatoreId) {
    setMsg("mainMsg", "Sessione non valida.", "err");
    return;
  }

  const sede = $("sede").value;

  if (!sede) {
    setMsg("mainMsg", "Seleziona una sede.", "err");
    return;
  }

  $("receiveOperatoreBox").textContent = "Operatore: " + APP.user.nome;
  $("receiveSedeBox").textContent = "Sede: " + sede;
  $("receiveSupplier").innerHTML = "";
  $("receiveList").innerHTML = "";
  $("receiveNote").value = "";
  $("receiveDdtFile").value = "";
  $("receiveDdtPreview").src = "";

  hide("receiveDdtPreview");
  hide("receiveMsg");
  hide("receiveOrderInfo");

  hideAllModals();
  show("receiveModal");

  try {
    startProgress("Caricamento fornitori", "Cerco ordini aperti…");

    const res = await jsonpRequest({
      action: "getOpenSuppliers",
      sede: sede,
      operatoreId: APP.user.operatoreId
    });

    if (!res.ok) throw new Error(res.error || "Errore fornitori");

    stopProgress("Fornitori caricati");

    if (!res.suppliers.length) {
      $("receiveSupplier").innerHTML = '<option value="">Nessun ordine aperto</option>';
      return;
    }

    $("receiveSupplier").innerHTML = '<option value="">Seleziona fornitore</option>';

    res.suppliers.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      $("receiveSupplier").appendChild(opt);
    });

  } catch (err) {
    stopProgress();
    setMsg("receiveMsg", err.message, "err");
  }
}

function closeReceiveModal(){
  hide("receiveModal");
}

function previewReceiveDdt(input){
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function(e){
    $("receiveDdtPreview").src = e.target.result;
    show("receiveDdtPreview");
  };

  reader.readAsDataURL(file);
}

async function loadLatestOrder(){
  const sede = $("sede").value;
  const fornitore = $("receiveSupplier").value;

  if (!fornitore) {
    setMsg("receiveMsg", "Seleziona un fornitore.", "err");
    return;
  }

  try {
    startProgress("Caricamento ordine", "Cerco ultimo ordine aperto…");

    const res = await jsonpRequest({
      action: "getLatestOrder",
      sede: sede,
      fornitore: fornitore,
      operatoreId: APP.user.operatoreId
    });

    if (!res.ok) throw new Error(res.error || "Errore ordine");

    stopProgress("Ordine caricato");

    if (!res.found) {
      setMsg("receiveMsg", "Nessun ordine aperto per questo fornitore.", "warn");
      return;
    }

    $("receiveOrderInfo").dataset.idordine = res.idOrdine;
    $("receiveOrderInfo").innerHTML = "<b>Ordine:</b> " + res.idOrdine + "<br><b>Fornitore:</b> " + res.fornitore;
    show("receiveOrderInfo");

    renderReceiveItems(res.items || []);

  } catch (err) {
    stopProgress();
    setMsg("receiveMsg", err.message, "err");
  }
}

function renderReceiveItems(items){
  const box = $("receiveList");
  box.innerHTML = "";

  if (!items.length) {
    box.innerHTML = '<div class="msg ok">Ordine già completamente ricevuto.</div>';
    return;
  }

  items.forEach(item => {
    const html = `
      <div class="receive-item">
        <div class="receive-title">${item.prodotto}</div>
        <div class="receive-small">
          Codice: ${item.barcode}<br>
          Ordinato: ${item.qtaOrdine}<br>
          Già ricevuto: ${item.qtaRicevuta}<br>
          Da ricevere: ${item.residuo}
        </div>

        <label>Quantità ricevuta</label>
        <input
          type="number"
          min="0"
          max="${item.residuo}"
          value="${item.residuo}"
          class="receive-qty"
          data-barcode="${item.barcode}"
          data-prodotto="${item.prodotto}">
      </div>
    `;

    box.insertAdjacentHTML("beforeend", html);
  });
}

async function saveReceive(){
  const sede = $("sede").value;
  const fornitore = $("receiveSupplier").value;
  const idOrdine = $("receiveOrderInfo").dataset.idordine || "";
  const note = $("receiveNote").value.trim();
  const inputs = document.querySelectorAll(".receive-qty");
  const file = $("receiveDdtFile").files && $("receiveDdtFile").files[0];

  if (!fornitore) {
    setMsg("receiveMsg", "Seleziona un fornitore.", "err");
    return;
  }

  if (!idOrdine) {
    setMsg("receiveMsg", "Carica prima l'ordine.", "err");
    return;
  }

  const items = [];

  inputs.forEach(input => {
    const qta = Number(input.value || 0);

    if (qta > 0) {
      items.push({
        barcode: input.dataset.barcode,
        prodotto: input.dataset.prodotto,
        qtaRicevuta: qta
      });
    }
  });

  if (!items.length) {
    setMsg("receiveMsg", "Nessuna quantità ricevuta.", "err");
    return;
  }

  try {
    startProgress("Ricevimento merce", "Preparazione dati…");

    let dataUrl = "";

    if (file) {
      dataUrl = await resizeImageToJpegBase64(file);
    }

    startProgress("Salvataggio ricevimento", "Aggiornamento magazzino…");

    await postReceiveForm({
      operatoreId: APP.user.operatoreId,
      sede: sede,
      fornitore: fornitore,
      idOrdine: idOrdine,
      note: note,
      items: JSON.stringify(items),
      dataUrl: dataUrl,
      fileName: file ? file.name : ""
    });

    stopProgress("Ricevimento salvato");

    setMsg("receiveMsg", "Merce ricevuta e magazzino aggiornato.", "ok");

    setTimeout(() => {
      closeReceiveModal();
      setMsg("mainMsg", "Ricevimento merce completato.", "ok");
    }, 900);

  } catch (err) {
    stopProgress();
    setMsg("receiveMsg", err.message, "err");
  }
}

function postReceiveForm(payload){
  return new Promise((resolve, reject) => {
    const iframeName = "receive_iframe_" + Date.now();

    const iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.style.display = "none";

    const form = document.createElement("form");
    form.method = "POST";
    form.action = API_URL;
    form.target = iframeName;
    form.style.display = "none";

    const fields = {
      action: "receiveOrderPost",
      operatoreId: payload.operatoreId,
      sede: payload.sede,
      fornitore: payload.fornitore,
      idOrdine: payload.idOrdine,
      note: payload.note,
      items: payload.items,
      dataUrl: payload.dataUrl,
      fileName: payload.fileName
    };

    Object.keys(fields).forEach(key => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = fields[key] || "";
      form.appendChild(input);
    });

    let submitted = false;

    iframe.onload = function(){
      if (!submitted) return;

      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        if (form.parentNode) form.parentNode.removeChild(form);
      }, 500);

      resolve({ ok: true });
    };

    iframe.onerror = function(){
      reject(new Error("Errore salvataggio ricevimento"));
    };

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    setTimeout(() => {
      submitted = true;
      form.submit();
    }, 100);
  });
}

let chartConsumiSede = null;
let chartTopProdotti = null;

function openAdminDashboard(){
  hideAllModals();
  show("adminDashboardModal");
  loadAdminDashboardSedi();
  loadAdminDashboard();
}

function loadAdminDashboardSedi(){
  const sel = $("adminDashboardSede");
  if (!sel || !APP.user) return;

  if (sel.options.length > 1) return;

  const sedi = APP.user.sediDisponibili || [];

  sedi.forEach(sede => {
    const opt = document.createElement("option");
    opt.value = sede;
    opt.textContent = sede;
    sel.appendChild(opt);
  });
}

function closeAdminDashboard(){
  hide("adminDashboardModal");
}

async function loadAdminDashboard(){
  if (!APP.user || APP.user.role !== "ADMIN") {
    setMsg("mainMsg", "Accesso non autorizzato.", "err");
    return;
  }

  try {
    startProgress("Dashboard", "Caricamento dati amministratore…");

    const sedeFiltro = $("adminDashboardSede")
  ? $("adminDashboardSede").value
  : "TUTTE";

    if ($("dashboardCurrentFilter")) {
  $("dashboardCurrentFilter").textContent =
    "Vista: " + sedeFiltro;
}

const res = await jsonpRequest({
  action: "getAdminDashboard",
  operatoreId: APP.user.operatoreId,
  sedeFiltro: sedeFiltro
});

    if (!res.ok) throw new Error(res.error || "Errore dashboard");

    setMsg("adminDashboardMsg", "Filtro attivo: " + (res.filtro || "TUTTE"), "info");

    $("kpiSottoScorta").textContent = res.kpi.prodottiSottoScorta || 0;
    $("kpiZero").textContent = res.kpi.prodottiZero || 0;
    $("kpiOrdiniAperti").textContent = res.kpi.ordiniAperti || 0;
    $("kpiConsegneMese").textContent = res.kpi.consegneMese || 0;

    renderAdminCharts(res);

    stopProgress("Dashboard caricata");

  } catch (err) {
    stopProgress();
    setMsg("adminDashboardMsg", err.message, "err");
  }
}

function renderAdminCharts(data){
  renderConsumiSedeChart(data.consumiPerSede || []);
  renderTopProdottiChart(data.topProdotti || []);
}

function renderConsumiSedeChart(rows){
  const ctx = $("chartConsumiSede");

  if (chartConsumiSede) {
    chartConsumiSede.destroy();
  }

  chartConsumiSede = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map(x => x.sede),
      datasets: [{
        label: "Quantità scaricata",
        data: rows.map(x => x.consumo)
      }]
    },
    options: {
      responsive: true,
      indexAxis: "y",
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });
}

function renderTopProdottiChart(rows){
  const ctx = $("chartTopProdotti");

  if (chartTopProdotti) {
    chartTopProdotti.destroy();
  }

  chartTopProdotti = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map(x => x.prodotto),
      datasets: [{
        label: "Quantità",
        data: rows.map(x => x.quantita)
      }]
    },
    options: {
      responsive: true,
      indexAxis: "y",
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });
}

window.onload = initApp;

let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;

  const btn = document.getElementById("installBtn");
  if (btn) btn.classList.remove("hidden");
});

async function installApp(){
  if (!deferredPrompt) {
    showIosInstallHelp();
    return;
  }

  deferredPrompt.prompt();

  await deferredPrompt.userChoice;

  deferredPrompt = null;

  const btn = document.getElementById("installBtn");
  if (btn) btn.classList.add("hidden");
}

function showIosInstallHelp(){
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;

  if (isIos && !isStandalone) {
    const msg = document.getElementById("iosInstallMsg");
    if (msg) msg.classList.remove("hidden");
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
    showIosInstallHelp();
  });
}
