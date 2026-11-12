let pushAdmin;
let pushToggleBusy = false;
const pushOwnerKey = "magazzini_ddt_push_owner";

function ddtPushSupported(){
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function ddtPushRegistration(){
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) throw new Error("Ricarica l’app prima di attivare le notifiche.");
  return registration;
}

async function ddtPushApi(action, fields = {}, user = APP.user, signal){
  if (!user?.orderHistoryToken) {
    throw Object.assign(new Error("Accedi di nuovo per usare le notifiche."), { sessionRequired: true });
  }
  const body = new URLSearchParams({ action, session: user.orderHistoryToken, ...fields });
  const response = await fetch(API_URL, { method: "POST", body, signal, keepalive: action === "ddtPushUnsubscribe" });
  if (!response.ok) throw new Error("Servizio notifiche non raggiungibile.");
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error(result.error || "Notifiche non disponibili."), { sessionRequired: result.sessionRequired });
  return result;
}

async function updateDdtPushButton(){
  const button = $("ddtPushToggle");
  const user = APP.user;
  button.classList.toggle("hidden", !user || !ddtPushSupported());
  if (!user || !ddtPushSupported()) return;
  try {
    const registration = await ddtPushRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (APP.user !== user) return;
    const active = subscription && localStorage.getItem(pushOwnerKey) === String(user.operatoreId);
    button.textContent = active ? "Disattiva notifiche DDT" : "Attiva notifiche DDT";
  } catch {
    button.textContent = "Attiva notifiche DDT";
  }
}

async function detachDdtPush(user){
  if (!ddtPushSupported()) return;
  try {
    if (localStorage.getItem(pushOwnerKey) !== String(user.operatoreId)) return;
    const registration = await ddtPushRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      ddtPushApi("ddtPushUnsubscribe", { endpoint: subscription.endpoint }, user).catch(() => {});
    }
    localStorage.removeItem(pushOwnerKey);
  } catch {
    // The browser can remove a subscription independently.
  }
}

async function toggleDdtPush(){
  const user = APP.user;
  if (!user || pushToggleBusy || !ddtPushSupported()) return;
  const button = $("ddtPushToggle");
  const currentlyActive = localStorage.getItem(pushOwnerKey) === String(user.operatoreId);
  pushToggleBusy = true;
  button.disabled = true;
  try {
    if (currentlyActive) {
      await detachDdtPush(user);
      setMsg("mainMsg", "Notifiche DDT disattivate su questo dispositivo.", "info");
      return;
    }
    if (!user.orderHistoryToken) throw new Error("Esci e accedi di nuovo per attivare le notifiche.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Consenti le notifiche nelle impostazioni del dispositivo e riprova.");
    const registration = await ddtPushRegistration();
    const result = await ddtPushApi("ddtPushKey", {}, user);
    const bytes = Uint8Array.from(atob(result.publicKey.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
    const previous = await registration.pushManager.getSubscription();
    const previousKey = previous?.options.applicationServerKey;
    if (previous && (!previousKey || String(new Uint8Array(previousKey)) !== String(bytes))) await previous.unsubscribe();
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    if (APP.user !== user) {
      await subscription.unsubscribe();
      return;
    }
    await ddtPushApi("ddtPushSubscribe", { subscription: JSON.stringify(subscription) }, user);
    if (APP.user !== user) {
      await subscription.unsubscribe();
      ddtPushApi("ddtPushUnsubscribe", { endpoint: subscription.endpoint }, user).catch(() => {});
      return;
    }
    localStorage.setItem(pushOwnerKey, String(user.operatoreId));
    setMsg("mainMsg", "Notifiche DDT attive su questo dispositivo.", "ok");
  } catch (error) {
    if (APP.user === user) setMsg("mainMsg", error.message || "Impossibile attivare le notifiche.", "err");
  } finally {
    pushToggleBusy = false;
    button.disabled = false;
    updateDdtPushButton();
  }
}

function closeDdtPushAdmin(){
  pushAdmin?.controller.abort();
  pushAdmin = undefined;
  hide("ddtPushAdminModal");
}

async function openDdtPushFromLink(){
  const id = new URLSearchParams(location.search).get("sollecita-ddt");
  if (!id || !APP.user) return;
  hideAllModals();
  show("ddtPushAdminModal");
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
