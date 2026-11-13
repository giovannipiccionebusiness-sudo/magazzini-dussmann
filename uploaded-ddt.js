// Apertura privata del DDT dalla notifica destinata al responsabile.
let uploadedDdtView;
function closeUploadedDdt(){
  const state=uploadedDdtView;uploadedDdtView=undefined;
  state?.controller.abort();if(state?.url)URL.revokeObjectURL(state.url);state?.dialog.remove();DDTPDFViewer.close();
}
async function openUploadedDdtFromLink(){
  const id=new URLSearchParams(location.search).get('ddt-caricato');
  if(!id || !APP.user)return;
  closeUploadedDdt();hideAllModals();
  const dialog=document.createElement('dialog');dialog.className='uploaded-ddt-dialog';dialog.setAttribute('aria-label','DDT caricato');
  const header=document.createElement('div');header.className='uploaded-ddt-head';
  const title=document.createElement('strong');title.textContent='DDT caricato';
  const close=document.createElement('button');close.type='button';close.className='btn btn-light';close.textContent='Chiudi ×';close.onclick=closeUploadedDdt;header.append(title,close);
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Caricamento del DDT…';
  dialog.append(header,status);document.body.append(dialog);
  const state={dialog,controller:new AbortController(),url:''};uploadedDdtView=state;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeUploadedDdt();});dialog.showModal();close.focus();
  if(APP.user.role!=='ADMIN'){status.textContent='Accedi con il tuo account admin per aprire il DDT.';return;}
  const timeout=setTimeout(()=>state.controller.abort(),45000);
  try{
    const body=new URLSearchParams({action:'getUploadedDdt',id,session:APP.user.orderHistoryToken || ''});
    const response=await fetch(API_URL,{method:'POST',body,signal:state.controller.signal});
    if(!response.ok)throw Error('Documento non raggiungibile.');const result=await response.json();
    if(!result.ok)throw Error(result.error || 'Documento non disponibile.');if(uploadedDdtView!==state)return;
    const d=result.document;title.textContent='DDT · '+d.site;status.textContent=d.operator+' · '+d.date;
    const bytes=Uint8Array.from(atob(d.data),c=>c.charCodeAt(0));
    if(d.mime==='application/pdf'){
      const open=document.createElement('button');open.className='btn btn-primary';open.textContent='Apri DDT';open.onclick=()=>DDTPDFViewer.open({title:'DDT · '+d.site,filename:d.name,load:async()=>bytes});dialog.append(open);open.click();return;
    }
    if(!['image/jpeg','image/png','image/webp'].includes(d.mime))throw Error('Formato documento non supportato.');
    state.url=URL.createObjectURL(new Blob([bytes],{type:d.mime}));
    const tools=document.createElement('div');tools.className='uploaded-ddt-tools';
    const viewport=document.createElement('div');viewport.className='uploaded-ddt-viewport';viewport.tabIndex=0;viewport.setAttribute('aria-label','Foto del DDT, scorri e ingrandisci per leggere');
    const img=document.createElement('img');img.src=state.url;img.alt='DDT caricato da '+d.operator+' · '+d.site;viewport.append(img);
    let zoom=1;const render=()=>{img.style.width=(zoom*100)+'%';};
    for(const [label,action] of [['−',()=>{zoom=Math.max(.5,zoom-.25);render();}],['+',()=>{zoom=Math.min(4,zoom+.25);render();}],['Adatta',()=>{zoom=1;render();}]]){const b=document.createElement('button');b.type='button';b.className='btn btn-light';b.textContent=label;b.setAttribute('aria-label',label==='+'?'Ingrandisci DDT':label==='−'?'Riduci DDT':'Adatta DDT');b.onclick=action;tools.append(b);}
    const download=document.createElement('a');download.href=state.url;download.download=d.name;download.textContent='Scarica';download.className='btn btn-light';tools.append(download);dialog.append(tools,viewport);
  }catch(error){if(uploadedDdtView===state)status.textContent=error.name==='AbortError'?'Caricamento interrotto. Chiudi e riapri l’avviso.':error.message;}
  finally{clearTimeout(timeout);}
}
