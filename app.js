const API_URL = "https://script.google.com/macros/s/AKfycbzqwAFHHkUbePs_TOIW7D7_D5kZGoYIKFPKOHGOP3dyEM1bh3PzcEr1yIbE4c2UET5v/exec";

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
  hide("ddtModal");
  hide("orderModal");

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

function openAction(tipo){
  stopScanner();

  APP.actionType = tipo;

  $("movementTitle").textContent = tipo === "CARICO" ? "Carica Prodotto" : "Scarica Prodotto";
  $("barcode").value = "";
  $("qty").value = 1;
  $("noteMov").value = "";

  hide("productMsg");
  hide("reader");
  hide("ddtModal");
  hide("orderModal");
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

  $("ddtOperatoreBox").textContent = "Operatore: " + APP.user.nome;
  $("ddtSedeBox").textContent = "Sede: " + sede;

  $("ddtFile").value = "";
  $("ddtNote").value = "";
  $("ddtPreview").src = "";

  hide("ddtPreview");
  hide("ddtMsg");

  hide("movementCard");
  hide("orderModal");
  show("ddtModal");
}

function closeDdtModal(){
  hide("ddtModal");
}

function previewDdt(input){
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function(e){
    $("ddtPreview").src = e.target.result;
    show("ddtPreview");
  };

  reader.readAsDataURL(file);
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
      "<b>Scorta minima:</b> " + res.product.scortaMinima,
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

  hide("movementCard");
  hide("ddtModal");
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

    const img = p.linkFoto
      ? '<img class="order-img" src="' + p.linkFoto + '" alt="Foto prodotto">'
      : '';

    const multiploText = multiploOrdine > 1
      ? '<br>Multiplo obbligatorio: ' + multiploOrdine
      : '';

    const html = `
      <div class="order-item">
        ${img}
        <div class="order-title">${p.prodotto}</div>
        <div class="order-small">
          Codice: ${p.barcode}<br>
          Giacenza: ${p.giacenza}<br>
          Scorta minima: ${p.scortaMinima}<br>
          Ordine minimo fornitore: ${minOrdine}
          ${multiploText}<br>
          Quantità suggerita: ${qtaSuggerita}
        </div>

        <label>Quantità ordine</label>
        <input
          type="number"
          min="${minOrdine}"
          step="${multiploOrdine}"
          value="${qtaSuggerita}"
          class="order-qty"
          data-barcode="${p.barcode}"
          data-prodotto="${p.prodotto}"
          data-giacenza="${p.giacenza}"
          data-scorta="${p.scortaMinima}"
          data-minordine="${minOrdine}"
          data-multiplo="${multiploOrdine}">
      </div>
    `;

    box.insertAdjacentHTML("beforeend", html);
  });
}

async function saveOrder(){
  const sede = $("sede").value;
  const note = $("orderNote").value.trim();
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
        qtaOrdine: qta
      });
    }
  }

  if (!items.length) {
    setMsg("orderMsg", "Nessun prodotto selezionato.", "err");
    return;
  }

  try {
    startProgress("Salvataggio ordine", "Registrazione ordine…");

    const res = await jsonpRequest({
      action: "saveOrder",
      sede: sede,
      operatoreId: APP.user.operatoreId,
      note: note,
      items: JSON.stringify(items)
    });

    if (!res.ok) throw new Error(res.error || "Errore salvataggio ordine");

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

window.onload = initApp;
