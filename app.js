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

function updateChangeOperatorButton(){
  $("changeOperatorBtn").classList.toggle("hidden", APP.user?.role !== "ADMIN");
}

function restoreSessionIfAvailable(){
  const saved = loadLoginSession();
  if (!saved) return false;

  APP.user = saved;
  updateChangeOperatorButton();
  $("chipOperatore").textContent = "Operatore: " + (saved.nome || "--");
  $("chipRuolo").textContent = "Ruolo: " + (saved.role || "--");
  loadSedi(saved.sediDisponibili || []);

  hide("loginCard");
  show("appCard");
  setMsg("mainMsg", "Sessione ripristinata.", "ok");
  openDdtReminderFromLink();
  openDdtPushFromLink();
  updateDdtPushButton();
  openUploadedDdtFromLink();
  updateStockHome();

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
      orderHistorySession: "1",
      operatoreId: operatoreId,
      pin: pin
    });

    if (!data.ok) throw new Error(data.error || "Login non riuscito");

    APP.user = data;
    updateChangeOperatorButton();
    saveLoginSession(data);

    $("chipOperatore").textContent = "Operatore: " + (data.nome || "--");
    $("chipRuolo").textContent = "Ruolo: " + (data.role || "--");

    loadSedi(data.sediDisponibili || []);

    hide("loginCard");
    show("appCard");

    setMsg("mainMsg", "Accesso effettuato correttamente.", "ok");
    stopProgress("Accesso completato");
    openDdtReminderFromLink();
    openDdtPushFromLink();
    updateDdtPushButton();
    openUploadedDdtFromLink();
    updateStockHome();

  } catch (err) {
    stopProgress();
    setMsg("loginMsg", err.message, "err");
  }
}

function changeOperator(){
  if (APP.user?.role === "ADMIN") logoutApp();
}

function logoutApp(){
  if (APP.user) detachDdtPush(APP.user);
  stopScanner();
  clearLoginSession();

  APP.user = null;
  updateChangeOperatorButton();

  show("loginCard");
  hide("appCard");
  hide("movementCard");
  if (!$("ddtModal").classList.contains("hidden")) closeDdtModal();
  if (!$("orderModal").classList.contains("hidden")) closeOrderModal();
  closeMyOrders();
  closeDdtReminder();
  closeDdtPushAdmin();
  closeDdtWhatsapp();
  closeUploadedDdt();
  closeStockModal(true);
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
  if (!$("ddtModal").classList.contains("hidden")) closeDdtModal();
  if (!$("orderModal").classList.contains("hidden")) closeOrderModal();
  closeMyOrders();
  closeDdtReminder();
  closeDdtPushAdmin();
  closeDdtWhatsapp();
  closeUploadedDdt();
  closeStockModal(true);
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

let ddtReminder;
let reminderRequest;

function closeDdtReminder(){
  reminderRequest?.abort();
  reminderRequest = undefined;
  ddtReminder = undefined;
  DDTPDFViewer.close();
  hide("ddtReminderModal");
}

async function reminderApi(id, action, signal){
  const body = new URLSearchParams({ action, id, session: APP.user.orderHistoryToken });
  const response = await fetch(API_URL, { method: "POST", body, signal });
  if (!response.ok) throw new Error("Registro non raggiungibile.");
  const result = await response.json();
  if (!result.ok) {
    if (result.sessionRequired) show("ddtReminderReconnect");
    throw new Error(result.error || "Ordine non disponibile.");
  }
  return result;
}

async function openDdtReminderFromLink(id = new URLSearchParams(location.search).get("ordine-ddt")){
  if (!id || !APP.user) return;
  hideAllModals();
  show("ddtReminderModal");
  hide("ddtReminderActions");
  hide("ddtReminderReconnect");
  const status = $("ddtReminderStatus");
  if (!APP.user.orderHistoryToken) {
    status.textContent = "Accedi di nuovo per aprire questo ordine.";
    show("ddtReminderReconnect");
    return;
  }
  status.textContent = "Caricamento dell’ordine…";
  const controller = new AbortController();
  reminderRequest = controller;
  try {
    const { order } = await reminderApi(id, "getDdtReminderOrder", controller.signal);
    if (reminderRequest !== controller) return;
    ddtReminder = order;
    status.textContent = [order.number, order.company, order.sede].join(" · ");
    show("ddtReminderActions");
    await openReminderPDF();
  } catch (error) {
    if (reminderRequest === controller) status.textContent = error.message;
  }
}

async function openReminderPDF(){
  if (!ddtReminder || !reminderRequest) return;
  const order = ddtReminder;
  const controller = reminderRequest;
  await DDTPDFViewer.open({
    title: "Ordine " + order.number,
    filename: "Ordine_" + order.number + ".pdf",
    load: async () => {
      const result = await reminderApi(order.id, "getDdtReminderPDF", controller.signal);
      if (reminderRequest !== controller) throw new Error("Apertura annullata.");
      return Uint8Array.from(atob(result.pdf), c => c.charCodeAt(0));
    }
  });
}

function uploadReminderDdt(){
  if (!ddtReminder) return;
  const order = ddtReminder;
  $("sede").value = order.sede;
  openDdtModal();
  $("ddtNote").value = "Ordine Dussmann " + order.number;
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
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }
    });

    if (ddtCameraRequest !== request) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    const track = stream.getVideoTracks()[0];
    try {
      if (track?.getCapabilities?.().focusMode?.includes("continuous")) await track.applyConstraints({advanced:[{focusMode:"continuous"}]});
    } catch { /* Some browsers do not expose focus controls. */ }
    if (ddtCameraRequest !== request) { stream.getTracks().forEach(t => t.stop()); return; }
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

function openNativeDdtCamera(){
  closeDdtCamera();
  $("ddtCamera").value = "";
  $("ddtCamera").click();
}

async function ddtImageDimensions(url){
  const image = new Image();
  try { image.src = url; await image.decode(); return {width:image.naturalWidth,height:image.naturalHeight}; }
  finally { image.src = ""; }
}

async function captureDdtPhoto(){
  const request = ddtCameraRequest;
  const video = $("ddtCameraVideo");
  if (!request || !video.videoWidth || !video.videoHeight) return;
  const captureButton = $("ddtCaptureBtn");
  captureButton.disabled = true;
  try {
    let blob;
    const track = video.srcObject?.getVideoTracks()[0];
    if (track && typeof ImageCapture !== "undefined") {
      try {
        const capture = new ImageCapture(track);
        let settings = {};
        try {
          const caps = await capture.getPhotoCapabilities();
          if (caps.imageWidth?.max) settings.imageWidth = Math.max(caps.imageWidth.min || 1, Math.min(3200, caps.imageWidth.max));
        } catch { /* takePhoto works even without capability reporting. */ }
        blob = await capture.takePhoto(settings);
      } catch { /* Fall back only to a sufficiently detailed video frame. */ }
    }
    if (!blob) {
      if (Math.max(video.videoWidth, video.videoHeight) < 1920) throw new Error("La fotocamera con riquadro offre una risoluzione troppo bassa. Usa la fotocamera del telefono per mantenere leggibili i caratteri piccoli.");
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.97));
    }
    if (!blob) throw new Error("Foto non acquisita. Riprova con la fotocamera del telefono.");
    const checkUrl = URL.createObjectURL(blob);
    try {
      const dimensions = await ddtImageDimensions(checkUrl);
      if (Math.max(dimensions.width, dimensions.height) < 1920) throw new Error("Lo scatto ha una risoluzione troppo bassa. Usa la fotocamera del telefono.");
    } finally { URL.revokeObjectURL(checkUrl); }
    if (ddtCameraRequest !== request) return;
    const files = new DataTransfer();
    files.items.add(new File([blob], "ddt.jpg", { type: blob.type || "image/jpeg" }));
    const input = $("ddtFile"); input.files = files.files;
    await previewDdt(input);
  } catch(error) {
    if (ddtCameraRequest !== request) return;
    closeDdtCamera();
    setMsg("ddtMsg", error.message || "Scatta il DDT con la fotocamera del telefono.", "info");
    show("ddtNativeCameraBtn");
  } finally { captureButton.disabled = false; }
}

window.addEventListener("pagehide", closeDdtCamera);

let ddtScan;

function clearDdtScan(){
  if (ddtScan) ddtScan.urls.forEach(url => URL.revokeObjectURL(url));
  ddtScan = undefined;
  $("ddtPreview").removeAttribute("src");
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
  closeDdtCamera(); hide("ddtNativeCameraBtn"); clearDdtScan();
  hide("ddtSourceActions"); $("ddtScroll").scrollTop = 0;
  const saveButton = $("ddtSaveBtn"); saveButton.disabled = true;
  const url = URL.createObjectURL(file);
  const scan = {original:file,urls:[url],ready:false}; ddtScan = scan;
  try {
    const {width,height} = await ddtImageDimensions(url);
    if (ddtScan !== scan) return;
    scan.ready = true;
    // Full frame only: the blue overlay is a visual guide, never part of the file.
    const transfer = new DataTransfer(); transfer.items.add(scan.original);
    $("ddtFile").files = transfer.files;
    $("ddtPreview").src = url; show("ddtPreview");
    const low = Math.max(width,height) < 1920;
    setMsg("ddtMsg", low
      ? "Risoluzione bassa ("+width+" × "+height+" pixel): per leggere tutto il DDT è consigliabile scattare una nuova foto con il telefono."
      : "Foto pronta. Controlla che tutto il foglio e i caratteri piccoli siano leggibili, poi premi Salva DDT.", low ? "err" : "info");
  } catch {
    if (ddtScan !== scan) return;
    setMsg("ddtMsg", "Immagine non leggibile. Scegli una foto JPEG o PNG del DDT.", "err");
    return;
  } finally {
    if (ddtScan === scan) {
      saveButton.disabled = !scan.ready;
      show("ddtReview"); show("ddtFooter");
    }
  }
}

const DDT_MAX_UPLOAD_BYTES = 7 * 1024 * 1024;
function readDdtFileDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error("Impossibile leggere il file del DDT.")); reader.readAsDataURL(file);
  });
}
async function resizeImageToJpegBase64(file, maxEdge = 3200, quality = 0.97){
  // Preserve an already usable JPEG/PNG/WebP byte for byte: no second JPEG pass.
  if (["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type) && file.size <= DDT_MAX_UPLOAD_BYTES) return readDdtFileDataUrl(file);
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;await image.decode();
    let edge=maxEdge;
    for(let attempt=0;attempt<4;attempt++){
      const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const context=canvas.getContext("2d");context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
      if(!blob)throw new Error("Preparazione della foto non riuscita.");
      if(blob.size<=DDT_MAX_UPLOAD_BYTES)return readDdtFileDataUrl(blob);
      edge=Math.floor(edge*.85);
    }
    throw new Error("Foto troppo grande: scatta nuovamente il DDT o scegli un file più piccolo.");
  } finally {URL.revokeObjectURL(url);}
}

async function saveDdt(){
  if (APP.ddtSaving) return;
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
    APP.ddtSaving = true;
    const identity = [String(APP.user.operatoreId),sede,note].join('|');
    if (!APP.ddtUploadAttempt || APP.ddtUploadAttempt.file !== file || APP.ddtUploadAttempt.identity !== identity) APP.ddtUploadAttempt = {file,identity,id:crypto.randomUUID()};
    startProgress("Preparazione DDT", "Preparazione della foto in alta qualità…");

    const dataUrl = await resizeImageToJpegBase64(file);

    startProgress("Salvataggio DDT", "Invio al backend…");

    await postDdtForm({
      operatoreId: APP.user.operatoreId,
      uploadRequestId: APP.ddtUploadAttempt.id,
      session: APP.user.orderHistoryToken || "",
      sede: sede,
      note: note,
      dataUrl: dataUrl,
      fileName: file.name || "ddt.jpg"
    });

    APP.ddtUploadAttempt = null;
    stopProgress("DDT salvato");

    setMsg("ddtMsg", "DDT salvato correttamente.", "ok");

    setTimeout(() => {
      closeDdtModal();
      setMsg("mainMsg", "DDT salvato correttamente.", "ok");
    }, 900);

  } catch (err) {
    stopProgress();
    setMsg("ddtMsg", err.message, "err");
  } finally { APP.ddtSaving = false; }
}

function postDdtForm(payload){
  if (payload.uploadRequestId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const body = new URLSearchParams({action:"uploadDdtVerified",...payload});
    return fetch(API_URL,{method:"POST",body,signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error("Caricamento non confermato. Riprova senza cambiare il documento.");
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "DDT non salvato. Riprova.");
      return result;
    }).catch(error => { if(error.name === "AbortError") throw new Error("Conferma non ricevuta. Riprova senza cambiare il documento."); throw error; }).finally(() => clearTimeout(timeout));
  }
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

function orderStorageKey(kind, operatoreId, sede = ""){
  return "magazzini_ordini:" + JSON.stringify([kind, String(operatoreId), sede]);
}

function readOrderStorage(key, fallback){
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeOrderStorage(key, value){
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function saveOrderDraft(){
  const order = currentOrder;
  if (!order?.ready || order.saving) return;
  const notes = $("orderNote").value;
  const quantities = order.products.filter(item => item.qty > 0)
    .map(item => [String(item.p.barcode), item.qty]);
  const stored = writeOrderStorage(order.draftKey, quantities.length || notes ? { notes, quantities } : null);
  if (!stored) setMsg("orderDraftStatus", "Impossibile salvare la bozza in questo browser.", "warn");
  else if (quantities.length || notes) setMsg("orderDraftStatus", "Bozza salvata su questo dispositivo.", "info");
  else hide("orderDraftStatus");
}

let registeredOrdersRequest;
let registeredOrdersSource = "operatore";

function closeMyOrders(){
  registeredOrdersRequest?.abort();
  registeredOrdersRequest = undefined;
  hide("myOrdersReconnect");
  $("registeredOrdersList").replaceChildren();
  hide("myOrdersModal");
}

async function loadRegisteredOrders(){
  const user = APP.user;
  if (!user?.operatoreId || registeredOrdersRequest) return;
  const source = registeredOrdersSource;
  const status = $("myOrdersStatus");
  const list = $("registeredOrdersList");
  hide("myOrdersReconnect");
  if (!user.orderHistoryToken) {
    status.textContent = "Accedi di nuovo per collegare lo storico alla tua sessione.";
    show("myOrdersReconnect");
    return;
  }
  const controller = new AbortController();
  registeredOrdersRequest = controller;
  status.textContent = source === "responsabile" ? "Caricamento dei PDF della sede…" : "Caricamento dei tuoi ordini…";
  list.replaceChildren();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    async function readOrders(action){
      const body = new URLSearchParams({ action, session: user.orderHistoryToken });
      const response = await fetch(API_URL, { method: "POST", body, signal: controller.signal });
      if (!response.ok) throw new Error("Registro non raggiungibile.");
      const result = await response.json();
      if (!result.ok) throw Object.assign(new Error(result.error || "Registro non disponibile."), {sessionRequired:result.sessionRequired});
      if (!Array.isArray(result.orders)) throw new Error("Risposta del registro non valida.");
      return result.orders;
    }
    const received = await readOrders(source === "responsabile" ? "getSitePdfOrders" : "getRegisteredOrders");
    if (registeredOrdersRequest !== controller || APP.user !== user) return;
    const orders = received.map(order => ({...order,source}));
    orders.sort((a,b) => myOrderTimestamp(b.date) - myOrderTimestamp(a.date));
    status.textContent = source === "responsabile"
      ? (orders.length ? (user.role === "ADMIN" ? "Ordini senza DDT raggruppati per sede. Apri il PDF o prepara un sollecito per il singolo ordine." : "Ordini del responsabile ancora senza DDT.") : "Non ci sono ordini del responsabile in attesa di DDT per la tua sede.")
      : (orders.length ? "Ordini inviati tramite Magazzini Dussmann." : "Non risultano ordini inviati dall’app.");
    renderRegisteredOrderList(orders,source,list);
  } catch (error) {
    if (registeredOrdersRequest === controller && APP.user === user) {
      status.textContent = error.message || "Registro non raggiungibile. Riprova.";
      if (error.sessionRequired) show("myOrdersReconnect");
    }
  } finally {
    clearTimeout(timeout);
    if (registeredOrdersRequest === controller) {
      registeredOrdersRequest = undefined;
    }
  }
}

function myOrderTimestamp(value){
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(value || ""));
  const timestamp = Date.parse(match ? match[3]+"-"+match[2]+"-"+match[1] : value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function renderRegisteredOrderList(orders,source,list){
  if (source !== "responsabile" || APP.user?.role !== "ADMIN") {
    for (const order of orders) list.append(renderMyOrder(order));
    return;
  }
  const groups = new Map();
  for (const order of orders) {
    const site = String(order.sede || "Sede da verificare").trim();
    if (!groups.has(site)) groups.set(site,[]);
    groups.get(site).push(order);
  }
  for (const site of [...groups.keys()].sort((a,b) => a.localeCompare(b,"it"))) {
    const siteOrders = groups.get(site).sort((a,b) => myOrderTimestamp(b.date) - myOrderTimestamp(a.date));
    const section = document.createElement("section");
    section.className = "admin-site-orders";
    const heading = document.createElement("h3");
    heading.className = "admin-site-title";
    const name = document.createElement("span");
    name.textContent = site;
    const count = document.createElement("span");
    count.className = "admin-site-count";
    count.textContent = siteOrders.length + (siteOrders.length === 1 ? " ordine" : " ordini");
    heading.append(name,count);
    section.append(heading);
    for (const order of siteOrders) section.append(renderMyOrder(order));
    list.append(section);
  }
}

function renderMyOrder(order){
  const adminOrder = order.source === "responsabile" && APP.user?.role === "ADMIN";
  const details = document.createElement(adminOrder ? "article" : "details");
  details.className = "my-order-card" + (adminOrder ? " admin-order-card" : "");
  const summary = document.createElement(adminOrder ? "header" : "summary");
  const title = document.createElement("strong");
  title.textContent = (order.source === "responsabile" ? "Ordine " + order.number + " · " : "") + (order.fornitore || "Ordine");
  const meta = document.createElement("span");
  meta.className = "my-order-meta";
  const timestamp = myOrderTimestamp(order.date);
  const date = timestamp ? new Date(timestamp).toLocaleDateString("it-IT", { timeZone: "Europe/Rome" }) : "";
  meta.textContent = [adminOrder ? "" : order.sede, date].filter(Boolean).join(" · ");
  summary.append(title, meta);
  details.append(summary);
  const origin = document.createElement("span");
  origin.className = "my-order-origin";
  origin.textContent = order.source === "responsabile" ? "Ordine del responsabile · PDF" : "Ordine inviato dall’app";
  if (!adminOrder) summary.append(origin);
  if (order.source === "responsabile") {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn btn-primary";
    open.textContent = "Apri PDF dell’ordine";
    open.onclick = () => openDdtReminderFromLink(order.id);
    details.append(open);
    if (adminOrder) {
      const actions = document.createElement("div");
      actions.className = "admin-order-reminders";
      const push = document.createElement("button");
      push.type = "button";
      push.className = "btn btn-light";
      push.textContent = "Notifica push";
      push.onclick = () => openDdtPushFromLink(order.id,true);
      const whatsapp = document.createElement("button");
      whatsapp.type = "button";
      whatsapp.className = "btn btn-light";
      whatsapp.textContent = "WhatsApp";
      whatsapp.onclick = () => openDdtWhatsappFromLink(order.id,true);
      actions.append(push,whatsapp);
      details.append(actions);
    }
    return details;
  }

  if (order.id) {
    const id = document.createElement("p");
    id.className = "my-order-meta";
    id.textContent = "Ordine " + order.id;
    details.append(id);
  }

  const items = document.createElement("ul");
  for (const item of order.items || []) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = item.prodotto;
    const qty = document.createElement("strong");
    qty.textContent = "× " + (item.qty ?? item.qtaOrdine);
    row.append(name, qty);
    const detail = item.stato || item.fornitore;
    if (detail) {
      const label = document.createElement("small");
      label.textContent = detail;
      row.append(label);
    }
    items.append(row);
  }
  details.append(items);
  return details;
}

function openMyOrders(source = "operatore"){
  if (!APP.user?.operatoreId) return;
  hideAllModals();
  registeredOrdersSource = source === "responsabile" ? "responsabile" : "operatore";
  $("myOrdersTitle").textContent = registeredOrdersSource === "responsabile" ? "Ordini del responsabile" : "I miei ordini";
  $("myOrdersStatus").textContent = "";
  show("myOrdersModal");
  loadRegisteredOrders();
}

let currentOrder;

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

  const order = { sede, operatoreId: APP.user.operatoreId, products: [], ready: false, reviewing: false, saving: false };
  try {
    hideAllModals();
    currentOrder = order;
    order.draftKey = orderStorageKey("draft", order.operatoreId, sede);
    order.draft = readOrderStorage(order.draftKey, {});
    hide("orderDraftStatus");
    $("orderSedeBox").textContent = sede;
    $("orderSearch").value = "";
    $("orderNote").value = order.draft.notes || "";
    $("orderList").replaceChildren();
    hide("orderEmpty");
    showOrderReview(false);
    show("orderModal");
    startProgress("Caricamento prodotti", "Ricerca prodotti…");
    const res = await jsonpRequest({ action: "getOrderProducts", sede, operatoreId: order.operatoreId });
    if (currentOrder !== order) return;
    if (!res.ok) throw new Error(res.error || "Errore prodotti ordine");

    renderOrderProducts(res.products || []);
    updateOrderFooter();
    if (order.products.some(item => item.qty > 0) || order.draft.notes) {
      setMsg("orderDraftStatus", "Bozza ripristinata.", "info");
    }
    stopProgress("Prodotti caricati");
  } catch (err) {
    if (currentOrder && currentOrder !== order) return;
    if ($("orderModal").classList.contains("hidden")) {
      setMsg("mainMsg", "Impossibile aprire Nuovo Ordine. Aggiorna la pagina e riprova.", "err");
      return;
    }
    stopProgress();
    setMsg("orderMsg", err.message, "err");
  }
}

function closeOrderModal(){
  if (currentOrder?.saving) return;
  currentOrder = undefined;
  const photo = $("orderPhoto");
  if (photo?.open) photo.close();
  hide("orderModal");
}

function orderQuantityRule(value){
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function renderOrderProducts(products){
  const box = $("orderList");
  const saved = new Map(currentOrder.draft.quantities || []);
  currentOrder.products = products.map(p => {
    const minOrdine = orderQuantityRule(p.minOrdine);
    const multiploOrdine = orderQuantityRule(p.multiploOrdine);
    const first = Math.ceil(minOrdine / multiploOrdine) * multiploOrdine;
    const previous = saved.get(String(p.barcode)) || 0;
    const steps = previous / multiploOrdine;
    const qty = Number.isFinite(previous) && previous >= minOrdine && Math.abs(steps - Math.round(steps)) < 1e-8
      ? previous : 0;
    return {
      p, minOrdine, multiploOrdine, first, qty,
      low: Number(p.giacenza || 0) <= Number(p.scortaMinima || 0),
      supplier: p.fornitore || "SENZA FORNITORE"
    };
  }).sort((a, b) => Number(b.low) - Number(a.low));

  const cards = currentOrder.products.map(item => {
    const { p, supplier, multiploOrdine } = item;
    const card = document.createElement("article");
    card.className = "order-compact";
    card.innerHTML = `
      <button type="button" class="order-thumbnail" hidden><img alt="" loading="lazy" /></button>
      <div class="order-product">
        <h3 class="order-title"></h3>
        <div class="order-controls"></div>
        <details class="order-details">
          <summary>Dettagli</summary>
          <div class="order-small"></div>
        </details>
      </div>`;
    card.querySelector("h3").textContent = p.prodotto;
    card.querySelector(".order-small").textContent =
      [p.barcode && "Codice " + p.barcode, "Fornitore " + supplier,
        multiploOrdine > 1 && "Multipli di " + multiploOrdine].filter(Boolean).join(" · ");

    if (p.linkFoto) {
      const thumbnail = card.querySelector(".order-thumbnail");
      thumbnail.hidden = false;
      thumbnail.setAttribute("aria-label", "Ingrandisci foto di " + p.prodotto);
      const image = thumbnail.querySelector("img");
      image.src = p.linkFoto;
      image.addEventListener("error", () => { thumbnail.hidden = true; });
      thumbnail.onclick = () => {
        $("orderPhotoImage").src = image.src;
        $("orderPhotoImage").alt = p.prodotto;
        $("orderPhoto").showModal();
      };
    }

    const controls = card.querySelector(".order-controls");
    item.catalogQty = createOrderStepper(item, controls);
    item.card = card;
    return card;
  });

  box.replaceChildren(...cards);
  currentOrder.ready = true;
  filterOrderProducts();
}

function filterOrderProducts(){
  if (!currentOrder?.ready) return;
  const search = $("orderSearch").value.trim().toLocaleLowerCase("it");
  let visible = 0;
  currentOrder.products.forEach(item => {
    const matches = [item.p.prodotto, item.p.barcode].some(value => String(value || "").toLocaleLowerCase("it").includes(search));
    item.card.hidden = !matches;
    if (matches) visible++;
  });
  $("orderEmpty").textContent = currentOrder.products.length
    ? "Nessun prodotto corrisponde alla ricerca." : "Nessun prodotto disponibile per questa sede.";
  if (visible) hide("orderEmpty");
  else show("orderEmpty");
}

function createOrderStepper(item, container){
  const stepper = document.createElement("div");
  stepper.className = "order-stepper";
  stepper.innerHTML = '<button type="button" class="btn btn-light">−</button><output aria-live="polite"></output><button type="button" class="btn btn-light">+</button>';
  const [minus, qty, plus] = stepper.children;
  minus.setAttribute("aria-label", "Diminuisci quantità di " + item.p.prodotto);
  plus.setAttribute("aria-label", "Aumenta quantità di " + item.p.prodotto);
  minus.onclick = () => setOrderQty(item, item.qty > item.first ? item.qty - item.multiploOrdine : 0);
  plus.onclick = () => setOrderQty(item, item.qty ? item.qty + item.multiploOrdine : item.first);
  const update = () => {
    qty.value = item.qty;
    minus.disabled = item.qty === 0 || currentOrder.saving;
    plus.disabled = currentOrder.saving;
  };
  update();
  container.append(stepper);
  return update;
}

function setOrderQty(item, quantity){
  if (!currentOrder || currentOrder.saving) return;
  item.qty = quantity;
  saveOrderDraft();
  item.catalogQty();
  if (currentOrder.reviewing && quantity === 0) renderOrderSummary();
  else if (currentOrder.reviewing) item.summaryQty();
  updateOrderFooter();
}

function updateOrderFooter(){
  const count = currentOrder.products.filter(item => item.qty > 0).length;
  $("orderCount").textContent = count + (count === 1 ? " prodotto selezionato" : " prodotti selezionati");
  $("orderReviewBtn").disabled = count === 0 || currentOrder.saving;
  $("orderConfirm").disabled = count === 0 || currentOrder.saving;
}

function showOrderReview(review){
  if (!currentOrder || currentOrder.saving) return;
  currentOrder.reviewing = review;
  const showCatalog = review ? hide : show;
  const showReview = review ? show : hide;
  showCatalog("orderCatalog");
  showCatalog("orderReviewBtn");
  showReview("orderReview");
  showReview("orderBack");
  showReview("orderConfirm");
  hide("orderMsg");
  if (review) renderOrderSummary();
  updateOrderFooter();
  $("orderScroll").scrollTop = 0;
}

function renderOrderSummary(){
  const groups = new Map();
  for (const item of currentOrder.products) {
    if (!item.qty) continue;
    if (!groups.has(item.supplier)) groups.set(item.supplier, []);
    groups.get(item.supplier).push(item);
  }

  const summary = $("orderSummary");
  summary.replaceChildren();
  for (const [supplier, items] of groups) {
    const section = document.createElement("section");
    const heading = document.createElement("h4");
    heading.textContent = supplier;
    section.append(heading);
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "order-summary-row";
      const name = document.createElement("span");
      name.textContent = item.p.prodotto;
      row.append(name);
      item.summaryQty = createOrderStepper(item, row);
      section.append(row);
    }
    summary.append(section);
  }
  if (!groups.size) summary.textContent = "Nessun prodotto selezionato.";
}

async function saveOrder(){
  const order = currentOrder;
  if (!order?.reviewing || order.saving) return;
  const items = [];
  for (const { p, qty, minOrdine, multiploOrdine, supplier } of order.products) {
    if (!qty) continue;
    const steps = qty / multiploOrdine;
    if (!Number.isFinite(qty) || qty < minOrdine || Math.abs(steps - Math.round(steps)) > 1e-8) {
      setMsg("orderMsg", p.prodotto + ": quantità non valida per il fornitore.", "err");
      return;
    }
    items.push({
      barcode: String(p.barcode),
      prodotto: String(p.prodotto),
      giacenza: String(p.giacenza),
      scortaMinima: String(p.scortaMinima),
      minOrdine,
      multiploOrdine,
      qtaOrdine: qty,
      fornitore: supplier
    });
  }
  if (!items.length) return;

  order.saving = true;
  updateOrderFooter();
  try {
    startProgress("Salvataggio ordine", "Invio ordine…");
    await postOrderForm({ operatoreId: order.operatoreId, sede: order.sede, items: JSON.stringify(items) });
    stopProgress("Invio completato");
    writeOrderStorage(order.draftKey, null);
    order.saving = false;
    closeOrderModal();
    setMsg("mainMsg", "Invio completato. Puoi verificare la registrazione in «I miei ordini».", "info");
  } catch (err) {
    stopProgress();
    order.saving = false;
    updateOrderFooter();
    setMsg("orderMsg", "Invio non verificato. La bozza è stata mantenuta: controlla il registro prima di riprovare.", "warn");
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
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout invio ordine"));
    }, 30000);

    function cleanup(){
      clearTimeout(timeout);
      iframe.remove();
      form.remove();
    }

    iframe.onload = function(){
      if (!submitted) return;
      cleanup();
      resolve();
    };

    iframe.onerror = function(){
      cleanup();
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
const standaloneMode = window.matchMedia("(display-mode: standalone)");
const appleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const androidMobile = /android/i.test(navigator.userAgent);

function updateInstallButton(){
  const button = $("installBtn");
  const installed = standaloneMode.matches || navigator.standalone === true;
  button.classList.toggle("hidden", installed || !(deferredPrompt || appleMobile || androidMobile));
  if (installed) {
    $("installDialog").close();
  }
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  updateInstallButton();
  if ($("installDialog").open) openInstallDialog();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  hide("installBtn");
  $("installDialog").close();
});

standaloneMode.addEventListener?.("change", updateInstallButton);

function openInstallDialog(){
  const dialog = $("installDialog");
  $("installHelp").textContent = deferredPrompt
    ? "Aggiungi Magazzini Dussmann alla schermata Home per aprirla con un tocco."
    : appleMobile
      ? "In Safari, apri Condividi → Aggiungi alla schermata Home. Attiva «Apri come app web» se disponibile, poi tocca Aggiungi."
      : "In Chrome, apri il menu ⋮ e scegli «Installa app» oppure «Aggiungi a schermata Home».";
  $("installConfirm").classList.toggle("hidden", !deferredPrompt);
  if (!dialog.open) dialog.showModal();
}

async function installApp(){
  const prompt = deferredPrompt;
  if (!prompt) return;
  deferredPrompt = null;
  $("installDialog").close();
  try {
    const choice = await prompt.prompt();
    if (choice?.outcome === "dismissed") updateInstallButton();
  } catch {
    updateInstallButton();
    openInstallDialog();
  }
}

async function setupAppUpdates(){
  if (!("serviceWorker" in navigator)) return;

  const version = document.documentElement.dataset.appVersion;
  const dialog = $("appUpdate");
  if (!version || !dialog?.showModal) return;
  const apply = $("appUpdateApply");
  const later = $("appUpdateLater");
  let activating = false;
  let dismissedWorker;
  let controller = navigator.serviceWorker.controller;

  function offerUpdate(worker, active = false){
    if (worker === dismissedWorker || activating) return;
    $("appUpdateTitle").textContent = "Aggiornamento disponibile";
    $("appUpdateText").textContent = "È pronta una nuova versione di Magazzini Dussmann.";
    apply.textContent = "Aggiorna ora";
    later.hidden = false;
    apply.onclick = () => {
      if (active) {
        window.location.reload();
        return;
      }
      activating = true;
      apply.disabled = true;
      worker.postMessage({ type: "ACTIVATE_UPDATE" });
    };
    later.onclick = () => {
      dismissedWorker = worker;
      dialog.close();
    };
    if (!dialog.open) dialog.showModal();
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const previous = controller;
    controller = navigator.serviceWorker.controller;
    if (activating) window.location.reload();
    else if (previous && controller) offerUpdate(controller, true);
  });

  // Existing installations get an acknowledgement when first opening this release.
  try {
    const seen = localStorage.getItem("magazzini_version");
    if (seen !== version && (seen || loadLoginSession())) {
      $("appUpdateTitle").textContent = "App aggiornata";
      $("appUpdateText").textContent = "Magazzini Dussmann · Versione " + version;
      apply.textContent = "Continua";
      apply.onclick = () => dialog.close();
      later.hidden = true;
      dialog.showModal();
    }
    localStorage.setItem("magazzini_version", version);
  } catch {
    // Update detection also works when persistent storage is unavailable.
  }

  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
    if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });

    const check = () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    setInterval(check, 5 * 60 * 1000);
  } catch (error) {
    console.warn("Controllo aggiornamenti non disponibile", error);
  }
}

function offerAppInstallation(){
  if ($("installBtn").classList.contains("hidden")) return;

  const update = $("appUpdate");
  if (update.open) {
    update.addEventListener("close", offerAppInstallation, { once: true });
    return;
  }

  openInstallDialog();
}

window.addEventListener("load", async () => {
  updateInstallButton();
  await setupAppUpdates();
  offerAppInstallation();
});

// Refresh the shared registry when returning to an already open order history.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("myOrdersModal").classList.contains("hidden")) loadRegisteredOrders();
});
