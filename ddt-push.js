let pushAdmin;
let pushToggleBusy = false;
const pushOwnerKey = "magazzini_ddt_push_owner";

function ddtPushSupported(){
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function ddtPushRegistration(){
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration?.active) return registration;
  let timeout;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("L’app sta preparando le notifiche. Riprova tra poco.")), 10000); })
    ]);
  } finally { clearTimeout(timeout); }
}

async function ddtPushApi(action, fields = {}, user = APP.user, signal){
  if (!user?.orderHistoryToken) {
    throw Object.assign(new Error("Accedi di nuovo per usare le notifiche."), { sessionRequired: true });
  }
  const body = new URLSearchParams({ action, session: user.orderHistoryToken, ...fields });
  const response = await fetch(API_URL, { method: "POST", body, signal, keepalive: action === "ddtPushUnsubscribe" });
  if (!response.ok) throw new Error("Servizio notifiche non raggiungibile.");
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error(result.error || "Notifiche non disponibili."), { sessionRequired: result.sessionRequired, expired:result.expired });
  return result;
}

let pushPromptPending = false;
let pushCheckTimer;
let pushPromptFocus;
const pushPromptOffered = new Set();

function closeDdtPushPrompt(){
  pushPromptPending = false;
  $("ddtPushPrompt").close();
}

function offerDdtPushPrompt(){
  const dialog = $("ddtPushPrompt");
  if (!APP.user) {
    pushPromptPending = false;
    if (dialog.open) dialog.close();
    return;
  }
  if (!pushPromptPending || pushToggleBusy || document.visibilityState !== "visible" || dialog.open) return;
  if (document.querySelector("dialog[open]") || document.querySelector(".modal:not(.hidden)")) return;
  pushPromptPending = false;
  const promptKey=String(APP.user.operatoreId)+':'+(typeof Notification==='undefined'?'unsupported':Notification.permission)+':'+pushLastState.kind;
  if(pushPromptOffered.has(promptKey))return;
  pushPromptOffered.add(promptKey);
  pushPromptFocus = document.activeElement;
  const supported = ddtPushSupported();
  $("ddtPushPromptTitle").textContent = ["incomplete", "renew"].includes(pushLastState.kind) ? "Completa le notifiche" : "Attiva le notifiche";
  $("ddtPushPromptHelp").textContent = !supported
    ? "Per ricevere gli avvisi DDT, usa un browser compatibile. Su iPhone e iPad aggiungi l’app alla schermata Home da Safari e aprila dalla sua icona."
    : Notification.permission === "denied"
      ? "Le notifiche sono bloccate. Consenti le notifiche per Magazzini Dussmann nelle impostazioni del browser o del telefono, poi torna nell’app e tocca Attiva notifiche."
      : Notification.permission === "granted"
        ? "Il permesso è già concesso. Completa il collegamento di questo dispositivo per ricevere i promemoria DDT."
        : "Attiva le notifiche per ricevere i promemoria dei DDT da caricare e aprire l’ordine collegato.";
  $("ddtPushPromptActivate").classList.toggle("hidden", !supported);
  $("ddtPushPromptStatus").textContent = "";
  dialog.showModal();
}

let pushStateTask;
let pushConfirmed;
let pushExpiredEndpoint;
let pushLastState = { kind: "checking" };

function pushOwnerRead(){
  try { return localStorage.getItem(pushOwnerKey); } catch { return null; }
}
function pushOwnerWrite(id){
  try { localStorage.setItem(pushOwnerKey, String(id)); } catch { /* Storage is optional, not proof of push activation. */ }
}
async function ddtPushTimedApi(action, fields, user){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try { return await ddtPushApi(action, fields, user, controller.signal); }
  catch(error) { if (error.name === "AbortError") throw new Error("Il servizio notifiche tarda a rispondere. Riprova quando sei connesso."); throw error; }
  finally { clearTimeout(timeout); }
}
function ddtPushPublicKey(value){
  const encoded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Configurazione notifiche da verificare.");
  return bytes;
}
function ddtPushKeyMatches(subscription, key){
  const current = subscription?.options?.applicationServerKey;
  return !!current && String(new Uint8Array(current)) === String(key);
}
function confirmDdtPush(user, subscription){
  pushConfirmed = { user, endpoint: subscription.endpoint, until: Date.now() + 5 * 60 * 1000 };
  pushOwnerWrite(user.operatoreId);
}
async function inspectDdtPush(user){
  if (!user) return { kind: "signed-out" };
  if (!ddtPushSupported()) return { kind: "unsupported" };
  if (Notification.permission !== "granted") return { kind: "inactive" };
  try {
    const registration = await ddtPushRegistration();
    let subscription = await registration.pushManager.getSubscription();
    const expired=subscription?.expirationTime && subscription.expirationTime<=Date.now();
    if (!expired && pushConfirmed?.user === user && pushConfirmed.endpoint === subscription?.endpoint && pushConfirmed.until > Date.now()) return { kind: "active" };
    const result = await ddtPushTimedApi("ddtPushKey", {}, user);
    const key = ddtPushPublicKey(result.publicKey);
    if (APP.user !== user) return { kind: "obsolete" };
    if (!subscription || expired || subscription.endpoint===pushExpiredEndpoint || (subscription.options?.applicationServerKey && !ddtPushKeyMatches(subscription,key))) {
      if(subscription){await subscription.unsubscribe();subscription=null;}
      if(APP.user!==user)return {kind:"obsolete"};
      try{subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
      catch(error){
        if(error.name==='NotAllowedError')return {kind:"incomplete"};
        throw error;
      }
    }
    if(APP.user!==user)return {kind:"obsolete"};
    // Reconcile an existing browser subscription with the signed-in account.
    // A lost local marker must not trigger a new permission prompt.
    await ddtPushTimedApi("ddtPushSubscribe", { subscription: JSON.stringify(subscription) }, user);
    if (APP.user !== user) {
      if (String(APP.user?.operatoreId) !== String(user.operatoreId)) ddtPushTimedApi("ddtPushUnsubscribe", { endpoint: subscription.endpoint }, user).catch(() => {});
      return { kind: "obsolete" };
    }
    confirmDdtPush(user, subscription);
    return { kind: "active" };
  } catch(error) {
    return { kind: "unverified", message: error.message || "Controllo notifiche non riuscito." };
  }
}
function renderDdtPushState(state, prompt){
  pushLastState = state;
  const button = $("ddtPushToggle"), status = $("ddtPushState");
  const active = state.kind === "active";
  const unavailable = ["signed-out", "checking", "obsolete"].includes(state.kind);
  button.textContent = state.kind === "unverified" ? "Verifica notifiche DDT" : ["renew", "incomplete"].includes(state.kind) ? "Completa attivazione notifiche" : "Attiva notifiche DDT";
  button.classList.toggle("hidden", active || unavailable || state.kind === "unsupported");
  status.textContent = active ? "Notifiche DDT attive su questo dispositivo." : state.kind === "checking" ? "Verifica delle notifiche in corso…" : state.kind === "unverified" ? "Stato notifiche da verificare. " + state.message : "";
  status.classList.toggle("hidden", !status.textContent || !APP.user);
  if (active || unavailable || state.kind === "unverified") {
    pushPromptPending = false;
    if ($("ddtPushPrompt").open) closeDdtPushPrompt();
  } else if (prompt) {
    pushPromptPending = true;
    offerDdtPushPrompt();
  }
}
async function updateDdtPushButton(prompt = true){
  if (pushToggleBusy) return;
  const user = APP.user;
  if (!pushStateTask || pushStateTask.user !== user) {
    renderDdtPushState({kind:"checking"}, false);
    const task = { user };
    task.promise = inspectDdtPush(user);
    pushStateTask = task;
  }
  const task = pushStateTask;
  const state = await task.promise;
  if (pushStateTask !== task || APP.user !== user || pushToggleBusy) return;
  pushStateTask = undefined;
  renderDdtPushState(state, prompt);
}

function scheduleDdtPushCheck(){
  if (pushToggleBusy || document.visibilityState !== "visible") return;
  clearTimeout(pushCheckTimer);
  pushCheckTimer = setTimeout(() => updateDdtPushButton(), 500);
}

window.addEventListener("focus", scheduleDdtPushCheck);
window.addEventListener("pageshow", scheduleDdtPushCheck);
window.addEventListener("online", scheduleDdtPushCheck);
document.addEventListener("visibilitychange", scheduleDdtPushCheck);
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("controllerchange", scheduleDdtPushCheck);
$("ddtPushPrompt").addEventListener("close", () => {
  pushPromptPending = false;
  pushPromptFocus?.focus?.();
});
$("ddtPushPrompt").addEventListener("cancel", () => { pushPromptPending = false; });
new MutationObserver(offerDdtPushPrompt).observe(document.body, {
  subtree: true, attributes: true, attributeFilter: ["class", "open"]
});

async function detachDdtPush(user){
  if (!ddtPushSupported()) return;
  try {
    if (pushConfirmed?.user !== user && pushOwnerRead() !== String(user.operatoreId)) return;
    pushConfirmed = undefined;
    const registration = await ddtPushRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      if (String(APP.user?.operatoreId) !== String(user.operatoreId)) ddtPushApi("ddtPushUnsubscribe", { endpoint: subscription.endpoint }, user).catch(() => {});
    }
    try { if(pushOwnerRead()===String(user.operatoreId))localStorage.removeItem(pushOwnerKey); } catch { /* Optional local marker. */ }
  } catch {
    // The browser can remove a subscription independently.
  }
}

async function toggleDdtPush(){
  const user = APP.user;
  if (!user || pushToggleBusy || !ddtPushSupported()) return;
  if(pushStateTask?.user===user){await pushStateTask.promise;if(APP.user!==user || pushToggleBusy)return;}
  const button = $("ddtPushToggle");
  pushToggleBusy = true;
  pushStateTask = undefined; // An earlier background check must not overwrite this activation.
  let activationError;
  button.disabled = true;
  $("ddtPushPromptActivate").disabled = true;
  $("ddtPushPromptStatus").textContent = "Attivazione in corso…";
  try {
    if (!user.orderHistoryToken) throw new Error("Esci e accedi di nuovo per attivare le notifiche.");
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Consenti le notifiche nelle impostazioni del dispositivo e riprova.");
    const registration = await ddtPushRegistration();
    const result = await ddtPushTimedApi("ddtPushKey", {}, user);
    const bytes = ddtPushPublicKey(result.publicKey);
    if(APP.user!==user)return;
    const previous = await registration.pushManager.getSubscription();
    if(APP.user!==user)return;
    const sameKey = previous && (!previous.options?.applicationServerKey || ddtPushKeyMatches(previous, bytes));
    if (previous && !sameKey) await previous.unsubscribe();
    const subscription = sameKey ? previous : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    if (APP.user !== user) {
      return;
    }
    await ddtPushTimedApi("ddtPushSubscribe", { subscription: JSON.stringify(subscription) }, user);
    if (APP.user !== user) {
      if (String(APP.user?.operatoreId) !== String(user.operatoreId)) ddtPushApi("ddtPushUnsubscribe", { endpoint: subscription.endpoint }, user).catch(() => {});
      return;
    }
    confirmDdtPush(user, subscription);
    setMsg("mainMsg", "Notifiche DDT attive su questo dispositivo.", "ok");
  } catch (error) {
    activationError = error;
    if (APP.user === user) {
      $("ddtPushPromptStatus").textContent = error.message || "Impossibile attivare le notifiche.";
      setMsg("mainMsg", error.message || "Collegamento notifiche da verificare.", "err");
    }
  } finally {
    pushToggleBusy = false;
    button.disabled = false;
    $("ddtPushPromptActivate").disabled = false;
    clearTimeout(pushCheckTimer);
    if (APP.user === user) {
      if (activationError && Notification.permission === "granted") renderDdtPushState({kind:"unverified",message:activationError.message},false);
      else updateDdtPushButton(false);
    }
  }
}

function closeDdtPushAdmin(){
  pushAdmin?.controller.abort();
  pushAdmin = undefined;
  hide("ddtPushAdminModal");
}

async function openDdtPushFromLink(id,fromOrders = false){
  if (!id && new URLSearchParams(location.search).has("sollecita-whatsapp")) return openDdtWhatsappFromLink();
  id = id || new URLSearchParams(location.search).get("sollecita-ddt");
  if (!id || !APP.user) return;
  hideAllModals();
  show("ddtPushAdminModal");
  $("ddtPushBackOrders").classList.toggle("hidden",!fromOrders);
  const status = $("ddtPushAdminStatus");
  $("ddtPushSendStatus").textContent = "";
  hide("ddtPushReconnect");
  hide("ddtPushSend");
  hide("ddtPushRecipients");
  hide("ddtPushHistory");
  if (APP.user.role !== "ADMIN") {
    status.textContent = "Funzione riservata agli amministratori.";
    return;
  }
  const state = { id, controller: new AbortController(), sending: false };
  pushAdmin = state;
  status.textContent = "Caricamento dell’ordine e dei destinatari…";
  try {
    const result = await ddtPushApi("ddtPushAdmin", { id }, APP.user, state.controller.signal);
    if (pushAdmin !== state) return;
    status.textContent = [result.order.number, result.order.sede, result.state].join(" · ");
    const fieldset = $("ddtPushRecipients");
    fieldset.replaceChildren();
    const legend = document.createElement("legend");
    legend.textContent = "Destinatari della sede";
    fieldset.append(legend);
    for (const recipient of result.recipients) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = recipient.id;
      label.append(input, recipient.name);
      fieldset.append(label);
    }
    if (result.state === "In attesa di DDT" && result.recipients.length) {
      show("ddtPushRecipients");
      show("ddtPushSend");
      $("ddtPushSend").disabled = false;
    } else if (result.state === "In attesa di DDT") {
      $("ddtPushSendStatus").textContent = "Nessun lavoratore attivo assegnato a questa sede.";
    }
    renderDdtPushAttempts(result.attempts);
  } catch (error) {
    if (pushAdmin !== state) return;
    status.textContent = error.message;
    if (error.sessionRequired) show("ddtPushReconnect");
  }
}

function renderDdtPushAttempts(attempts){
  const list = $("ddtPushAttempts");
  list.replaceChildren();
  const labels = { accepted: "Accettata dal servizio push", expired: "Iscrizione scaduta", failed: "Non inviata", pending: "Esito da verificare" };
  for (const attempt of attempts || []) {
    const row = document.createElement("li");
    const date = new Date(attempt.date).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
    row.textContent = [attempt.name, date, labels[attempt.status] || "Esito da verificare"].join(" · ");
    list.append(row);
  }
  $("ddtPushHistory").classList.toggle("hidden", !list.childElementCount);
}

async function sendDdtPush(){
  const state = pushAdmin;
  if (!state || state.sending) return;
  const status = $("ddtPushSendStatus");
  const recipients = Array.from($("ddtPushRecipients").querySelectorAll("input:checked"), input => Number(input.value));
  if (!recipients.length) {
    status.textContent = "Seleziona almeno un destinatario.";
    return;
  }
  if (!window.confirm("Inviare il sollecito push ai destinatari selezionati?")) return;
  const key = recipients.join(",");
  if (state.recipientKey !== key || !state.requestId) state.requestId = crypto.randomUUID();
  state.recipientKey = key;
  state.sending = true;
  $("ddtPushSend").disabled = true;
  status.textContent = "Invio in corso…";
  try {
    const result = await ddtPushApi("ddtPushSend", { id: state.id, requestId: state.requestId, recipients: JSON.stringify(recipients) });
    if (pushAdmin !== state) return;
    status.textContent = "Accettate dal servizio: " + result.accepted + " · Non confermate: " + result.unsuccessful + " · Lavoratori senza dispositivo: " + result.noDevice;
    state.requestId = undefined;
    const history = await ddtPushApi("ddtPushAdmin", { id: state.id }, APP.user, state.controller.signal).catch(() => null);
    if (pushAdmin === state && history) renderDdtPushAttempts(history.attempts);
  } catch (error) {
    if (pushAdmin === state) status.textContent = error.message;
  } finally {
    if (pushAdmin === state) {
      state.sending = false;
      $("ddtPushSend").disabled = false;
    }
  }
}

// A real server-to-device push test, initiated only by the current recipient.
let ddtPushTest;
async function testDdtPush(){
  if(!APP.user || ddtPushTest?.busy)return;
  const user=APP.user,button=$('notificationsTest'),status=$('notificationsTestStatus');
  const state={id:crypto.randomUUID(),user,busy:true,received:false};ddtPushTest=state;
  button.disabled=true;status.textContent='Verifica del collegamento e invio della prova…';
  try{
    const checked=await inspectDdtPush(user);
    if(APP.user!==user)return;
    renderDdtPushState(checked,false);
    if(checked.kind!=='active')throw Error('Completa il collegamento delle notifiche, poi riprova.');
    const registration=await ddtPushRegistration(),sub=await registration.pushManager.getSubscription();
    state.endpoint=sub?.endpoint;
    if(!sub)throw Error('Iscrizione non disponibile. Riprova l’attivazione.');
    const result=await ddtPushTimedApi('ddtPushTest',{endpoint:sub.endpoint,requestId:state.id},user);
    if(APP.user!==user || ddtPushTest!==state)return;
    if(!state.received)status.textContent=result.accepted?'Prova inviata al servizio. Attendi la notifica su questo dispositivo.':'Invio non riuscito. Riprova il collegamento.';
  }catch(error){
    if(APP.user===user && ddtPushTest===state && !state.received){
      status.textContent=error.message;
      if(error.expired){pushExpiredEndpoint=state.endpoint;pushConfirmed=undefined;updateDdtPushButton(false);}
    }
  }
  finally{state.busy=false;button.disabled=false;}
}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type!=='DDT_PUSH_TEST_RECEIVED' || !ddtPushTest || event.data.id!==ddtPushTest.id || APP.user!==ddtPushTest.user)return;
  ddtPushTest.received=true;
  $('notificationsTestStatus').textContent='Prova ricevuta su questo dispositivo. Il collegamento push funziona.';
});
