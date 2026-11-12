let ddtWhatsappRequest;

function closeDdtWhatsapp(){
  ddtWhatsappRequest?.abort();
  ddtWhatsappRequest = undefined;
  $("ddtWhatsappRecipients").replaceChildren();
  hide("ddtWhatsappModal");
}

function ddtWhatsappMessage(order,recipient){
  const url = new URL(location.pathname,location.origin);
  url.searchParams.set("ordine-ddt",order.id);
  return ["📦 *MAGAZZINI DUSSMANN*","*Verifica consegna e caricamento DDT*","",
    "Ciao "+recipient.name+"!","📍 *Sede:* "+order.sede,"📄 *Ordine:* "+order.number,
    "🏢 *Fornitore:* "+order.company,"","Puoi verificare se è arrivata la merce di questo ordine?",
    "✅ *Merce arrivata:* carica il DDT nell’app.",
    "⚠️ *DDT mancante o merce non arrivata:* contatta il responsabile.","",
    "👇 *Apri il PDF dell’ordine e carica il DDT*",url.href,"",
    "Accedi con il tuo account Magazzini Dussmann."].join("\n");
}

function ddtWhatsappLink(order,recipient){
  if (!/^\+39\d{10}$/.test(recipient.phone || "")) return null;
  return "https://wa.me/"+recipient.phone.slice(1)+"?text="+encodeURIComponent(ddtWhatsappMessage(order,recipient));
}

async function openDdtWhatsappFromLink(){
  const id = new URLSearchParams(location.search).get("sollecita-whatsapp");
  if (!id || !APP.user) return;
  hideAllModals();
  show("ddtWhatsappModal");
  hide("ddtWhatsappReconnect");
  const status = $("ddtWhatsappStatus");
  const list = $("ddtWhatsappRecipients");
  if (APP.user.role !== "ADMIN") {
    status.textContent = "Funzione riservata agli amministratori.";
    return;
  }
  const controller = new AbortController();
  const user = APP.user;
  ddtWhatsappRequest = controller;
  status.textContent = "Verifica dell’ordine e del referente della sede…";
  const timeout = setTimeout(() => controller.abort(),30000);
  try {
    const result = await ddtPushApi("ddtWhatsappRecipients",{id},user,controller.signal);
    if (ddtWhatsappRequest !== controller || APP.user !== user) return;
    status.textContent = [result.order.number,result.order.company,result.order.sede].join(" · ");
    if (result.hasDdt) {
      status.textContent += " — DDT già presente: non occorre un sollecito.";
      return;
    }
    if (!result.recipients.length) status.textContent += " — Nessun operatore attivo assegnato alla sede.";
    for (const recipient of result.recipients) {
      const link = ddtWhatsappLink(result.order,recipient);
      const item = document.createElement("div");
      item.className = "my-order-card";
      const name = document.createElement("strong");
      name.textContent = recipient.name;
      const phone = document.createElement("p");
      phone.className = "my-order-meta";
      phone.textContent = link ? recipient.phone : "Numero WhatsApp non ancora configurato.";
      item.append(name,phone);
      if (link) {
        const open = document.createElement("a");
        open.className = "btn btn-primary ddt-whatsapp-open";
        open.href = link;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = "Apri WhatsApp per "+recipient.name;
        item.append(open);
      }
      list.append(item);
    }
  } catch (error) {
    if (ddtWhatsappRequest !== controller || APP.user !== user) return;
    status.textContent = error.name === "AbortError" ? "Registro non raggiungibile. Chiudi e riprova." : error.message;
    if (error.sessionRequired) show("ddtWhatsappReconnect");
  } finally {
    clearTimeout(timeout);
  }
}
