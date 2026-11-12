/* Verifiche qualitative separate da ordini e movimenti di magazzino. */
const STOCK_LABELS = {available:'Disponibile',low:'Quasi finito',empty:'Terminato'};
let stockState = null, stockHomeRequest = null, stockHomeTimer;
const stockEl = (tag,cls,text) => { const e=document.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e; };
const stockDate = value => new Date(value).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
async function stockApi(action,data={},signal){
  const session=APP.user?.orderHistoryToken;
  if(!session) throw new Error('Esci e accedi di nuovo per utilizzare le verifiche scorte.');
  const body=new URLSearchParams({action,session,...data});
  const response=await fetch(API_URL,{method:'POST',body,signal});
  if(!response.ok)throw new Error('Servizio scorte non raggiungibile. Riprova.');
  const result=await response.json();
  if(!result.ok)throw new Error(result.error || 'Operazione non riuscita.');
  return result;
}
function updateStockHome(){
  stockHomeRequest?.abort(); clearTimeout(stockHomeTimer);
  $('stockAdminHome').classList.toggle('hidden',APP.user?.role!=='ADMIN');
  $('stockHomeHint').textContent='';
  if(!APP.user)return;
  const user=APP.user,site=$('sede').value,controller=new AbortController();
  stockHomeRequest=controller;
  stockHomeTimer=setTimeout(()=>controller.abort(),30000);
  stockApi('stockGet',{sede:site},controller.signal).then(data=>{
    if(APP.user!==user || stockHomeRequest!==controller)return;
    $('stockHomeHint').textContent=!data.products.length ? 'Verifica scorte: in attesa della lista del responsabile.' : data.due ? 'È disponibile la verifica scorte di questo mese.' : 'Ultima verifica scorte: '+stockDate(data.latest.date)+'.';
  }).catch(error=>{
    if(APP.user===user && stockHomeRequest===controller)$('stockHomeHint').textContent='Apri Verifica scorte per controllare la situazione.';
  }).finally(()=>{if(stockHomeRequest===controller)clearTimeout(stockHomeTimer);});
}
function closeStockModal(force=false){
  if(stockState?.saving && !force)return;
  stockState?.controller?.abort(); clearTimeout(stockState?.timer);
  stockState=null; hide('stockModal'); $('stockContent').replaceChildren();
}
function stockButton(text,action,cls='stock-secondary'){
  const b=stockEl('button',cls,text);b.type='button';b.addEventListener('click',action);return b;
}
function stockMessage(text,err=false){const el=stockEl('p',err?'stock-message stock-error':'stock-message',text);el.setAttribute('role',err?'alert':'status');return el;}
function stockStart(title,mode,site){
  if(stockState?.saving)return null;
  hideAllModals();
  const state={mode,site,controller:new AbortController(),saving:false};
  stockState=state; state.timer=setTimeout(()=>state.controller.abort(),45000);
  $('stockTitle').textContent=title;$('stockContent').replaceChildren(stockMessage('Caricamento…'));show('stockModal');
  setTimeout(()=>$('stockClose').focus(),0); return state;
}
async function openStockCheck(site=$('sede').value){
  const state=stockStart('Verifica scorte','check',site);if(!state)return;
  try{
    const data=await stockApi('stockGet',{sede:site},state.controller.signal);
    if(stockState!==state)return;
    clearTimeout(state.timer);state.data=data;state.answers={};
    const body=$('stockContent');body.replaceChildren(stockEl('p','stock-site',data.site));
    if(!data.products.length){body.append(stockMessage('Il responsabile deve scegliere i prodotti da controllare.'));if(APP.user.role==='ADMIN')body.append(stockButton('Scegli prodotti',()=>openStockConfig(site)));return;}
    body.append(stockEl('p','stock-intro','Dai un’occhiata ai prodotti e indica come stanno le scorte. Nessun conteggio necessario.'));
    if(data.latest && !data.latest.invalid)body.append(stockEl('p','stock-muted','Ultima verifica: '+stockDate(data.latest.date)+' · '+data.latest.operator));
    body.append(stockButton('Segna tutti disponibili',()=>{
      for(const p of data.products)state.answers[p.barcode]='available';
      body.querySelectorAll('input[type="radio"][value="available"]').forEach(e=>e.checked=true);updateCount();
    }));
    const count=stockEl('p','stock-count');count.setAttribute('aria-live','polite');body.append(count);
    const updateCount=()=>{count.textContent=Object.keys(state.answers).length+' di '+data.products.length+' prodotti verificati';};updateCount();
    data.products.forEach((p,i)=>{
      const field=stockEl('fieldset','stock-product'),legend=stockEl('legend','',p.name);field.append(legend);
      if(/^https:\/\//i.test(p.image)){const img=stockEl('img','stock-product-img');img.src=p.image;img.alt='';img.loading='lazy';field.append(img);}
      const options=stockEl('div','stock-options');
      Object.entries(STOCK_LABELS).forEach(([value,label])=>{
        const wrap=stockEl('label','stock-choice stock-'+value),input=stockEl('input');input.type='radio';input.name='stock-'+i;input.value=value;
        input.addEventListener('change',()=>{state.answers[p.barcode]=value;state.requestId=null;updateCount();});wrap.append(input,stockEl('span','',label));options.append(wrap);
      });field.append(options);body.append(field);
    });
    const noteLabel=stockEl('label','','Note facoltative'),note=stockEl('textarea','stock-note');note.id='stockNote';note.maxLength=500;note.rows=2;noteLabel.htmlFor=note.id;note.placeholder='Es. il materiale è nel ripostiglio al primo piano';body.append(noteLabel,note);
    const feedback=stockMessage('');body.append(feedback);
    const save=stockButton('Salva verifica',async()=>{
      if(stockState!==state||state.saving)return;
      if(data.products.some(p=>!state.answers[p.barcode])){feedback.textContent='Indica lo stato di tutti i prodotti.';feedback.classList.add('stock-error');return;}
      const answers=JSON.stringify(data.products.map(p=>({barcode:p.barcode,status:state.answers[p.barcode]}))),noteText=note.value.trim();
      const signature=answers+'\n'+noteText;
      if(state.signature!==signature){state.signature=signature;state.requestId=crypto.randomUUID();}
      state.saving=true;save.disabled=true;$('stockClose').disabled=true;
      body.querySelectorAll('input,textarea,button').forEach(e=>e.disabled=true);feedback.textContent='Salvataggio della verifica…';
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
      try{
        await stockApi('stockSave',{sede:site,revision:data.revision,requestId:state.requestId,answers,note:noteText},controller.signal);
        if(stockState!==state)return;
        body.replaceChildren(stockMessage('Verifica salvata. Grazie!'),stockEl('p','stock-muted','Il responsabile può ora vedere le scorte della sede.'),stockButton('Chiudi',()=>closeStockModal()));
        updateStockHome();
      }catch(error){if(stockState===state){feedback.textContent=error.name==='AbortError'?'Non è arrivata la conferma. Premi di nuovo Salva verifica: non verranno creati doppioni.':error.message;feedback.classList.add('stock-error');body.querySelectorAll('input,textarea,button').forEach(e=>e.disabled=false);}}
      finally{clearTimeout(timeout);state.saving=false;save.disabled=false;$('stockClose').disabled=false;}
    },'btn btn-primary');body.append(save);
  }catch(error){stockReadError(state,error,()=>openStockCheck(site));}
}
function stockReadError(state,error,retry){
  clearTimeout(state.timer);if(stockState!==state)return;
  $('stockContent').replaceChildren(stockMessage(error.name==='AbortError'?'La risposta tarda ad arrivare. Riprova.':error.message,true),stockButton('Riprova',retry));
}
async function openStockOverview(){
  if(APP.user?.role!=='ADMIN')return;
  const state=stockStart('Situazione sedi','overview');if(!state)return;
  try{
    const data=await stockApi('stockOverview',{},state.controller.signal);if(stockState!==state)return;clearTimeout(state.timer);
    const body=$('stockContent');body.replaceChildren(stockEl('p','stock-intro','Scorte dichiarate dalle referenti. Le quantità dei singoli prelievi non vengono richieste.'));
    const toolbar=stockEl('div','stock-toolbar'),search=stockEl('input');search.type='search';search.placeholder='Cerca sede';search.setAttribute('aria-label','Cerca sede');toolbar.append(search,stockButton('Aggiorna',openStockOverview));body.append(toolbar);
    const summary=stockEl('p','stock-count'),sites=data.sites.slice().sort((a,b)=>{
      const priority=s=>s.error?0:s.latest?.items?.some(p=>p.status==='empty')?1:s.latest?.items?.some(p=>p.status==='low')?2:s.due?3:4;
      return priority(a)-priority(b)||a.site.localeCompare(b.site,'it');
    });summary.textContent=sites.filter(s=>s.due).length+' sedi da verificare · '+sites.length+' sedi totali';body.append(summary);
    const list=stockEl('div');body.append(list);
    function render(){list.replaceChildren();const query=search.value.trim().toLocaleLowerCase('it');
      for(const s of sites.filter(s=>s.site.toLocaleLowerCase('it').includes(query))){
        const card=stockEl('article','stock-site-card');card.append(stockEl('h3','',s.site));
        if(s.error)card.append(stockMessage(s.error,true));
        else {
          const latest=s.latest;
          card.append(stockEl('span','stock-badge '+(s.due?'stock-due':'stock-current'),!s.count?'Da configurare':s.due?'Verifica da fare':'Verificata questo mese'));
          if(latest && !latest.invalid){
            card.append(stockEl('p','stock-muted',stockDate(latest.date)+' · '+latest.operator));
            const low=latest.items.filter(p=>p.status==='low').length,empty=latest.items.filter(p=>p.status==='empty').length;
            card.append(stockEl('p','stock-count',empty+' terminati · '+low+' quasi finiti'));
            if(s.due)card.append(stockEl('p','stock-muted','Gli stati sotto si riferiscono all’ultima verifica.'));
            const details=stockEl('details'),summary=stockEl('summary','','Vedi prodotti verificati');details.append(summary);
            latest.items.forEach(p=>{const row=stockEl('div','stock-result');row.append(stockEl('span','',p.name),stockEl('strong','stock-status-'+p.status,STOCK_LABELS[p.status]));details.append(row);});
            if(latest.note)details.append(stockEl('p','stock-note-display',latest.note));card.append(details);
          }else card.append(stockEl('p','stock-muted',latest?.invalid?'Ultima verifica da controllare: esegui un nuovo controllo.':'Nessuna verifica registrata.'));
        }
        card.append(stockEl('p','stock-muted',s.pending===null?'Ordini senza DDT: dato non disponibile.':'Ordini senza DDT: '+s.pending));
        if(s.orders30!==undefined)card.append(stockEl('p','stock-muted','Richieste dall’app: '+s.orders30+' negli ultimi 30 giorni · '+s.ordersPrevious30+' nei 30 precedenti.'));
        if(s.frequent)card.append(stockMessage('Richieste più frequenti: verifica il fabbisogno della sede.'));
        const actions=stockEl('div','stock-toolbar');actions.append(stockButton('Verifica scorte',()=>openStockCheck(s.site)),stockButton('Scegli prodotti',()=>openStockConfig(s.site)));card.append(actions);list.append(card);
      }
      if(!list.children.length)list.append(stockMessage('Nessuna sede trovata.'));
    }search.addEventListener('input',render);render();
  }catch(error){stockReadError(state,error,openStockOverview);}
}
async function openStockConfig(site){
  const state=stockStart('Prodotti da verificare','config',site);if(!state)return;
  try{
    const data=await stockApi('stockCatalog',{sede:site},state.controller.signal);if(stockState!==state)return;clearTimeout(state.timer);
    const body=$('stockContent'),selected=new Set(data.products.map(p=>p.barcode));
    body.replaceChildren(stockEl('p','stock-site',site),stockEl('p','stock-intro','Scegli da 1 a 10 prodotti essenziali. Una lista breve rende il controllo più semplice.'));
    const search=stockEl('input');search.type='search';search.placeholder='Cerca prodotto';search.setAttribute('aria-label','Cerca prodotto');body.append(search);
    const count=stockEl('p','stock-count');count.setAttribute('aria-live','polite');const update=()=>count.textContent=selected.size+' prodotti selezionati su 10';update();body.append(count);
    const list=stockEl('div','stock-catalog');body.append(list);
    const render=()=>{list.replaceChildren();for(const p of data.catalog.filter(p=>(p.name+' '+p.barcode).toLowerCase().includes(search.value.toLowerCase()))){
      const label=stockEl('label','stock-catalog-choice'),input=stockEl('input');input.type='checkbox';input.checked=selected.has(p.barcode);
      input.addEventListener('change',()=>{if(input.checked){if(selected.size>=10){input.checked=false;count.textContent='Puoi scegliere al massimo 10 prodotti.';return;}selected.add(p.barcode);}else selected.delete(p.barcode);update();});
      label.append(input,stockEl('span','',p.name));list.append(label);
    }};search.addEventListener('input',render);render();
    const feedback=stockMessage('');body.append(feedback);
    const save=stockButton('Salva prodotti',async()=>{
      if(state.saving)return;if(!selected.size){feedback.textContent='Seleziona almeno un prodotto.';return;}
      state.saving=true;$('stockClose').disabled=true;body.querySelectorAll('input,button').forEach(e=>e.disabled=true);feedback.textContent='Salvataggio…';
      const c=new AbortController(),timeout=setTimeout(()=>c.abort(),45000);
      try{await stockApi('stockConfigSave',{sede:site,revision:data.revision,products:JSON.stringify([...selected])},c.signal);state.saving=false;openStockOverview();updateStockHome();}
      catch(error){feedback.textContent=error.name==='AbortError'?'Conferma non ricevuta. Riapri la lista per controllare il salvataggio.':error.message;feedback.classList.add('stock-error');body.querySelectorAll('input,button').forEach(e=>e.disabled=false);}
      finally{clearTimeout(timeout);state.saving=false;$('stockClose').disabled=false;}
    },'btn btn-primary');body.append(save,stockButton('Torna alle sedi',openStockOverview));
  }catch(error){stockReadError(state,error,()=>openStockConfig(site));}
}
$('sede').addEventListener('change',updateStockHome);
$('stockModal').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();closeStockModal();}
  if(event.key!=='Tab')return;
  const focusable=[...$('stockModal').querySelectorAll('button,input,textarea,summary')].filter(e=>!e.disabled&&e.getClientRects().length);
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
});
