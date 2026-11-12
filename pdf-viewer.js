'use strict';
// PDF bytes are fetched with the existing Google session and rendered locally.
var DDTPDFViewer=(()=>{
 let libraryPromise,dialog,ui,current=null;
 const base='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';
 function library(){
  if(!libraryPromise)libraryPromise=import(base+'build/pdf.min.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=base+'build/pdf.worker.min.mjs';return lib;}).catch(e=>{libraryPromise=null;throw e;});
  return libraryPromise;
 }
 function button(text,label,action){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.setAttribute('aria-label',label);b.onclick=action;return b;}
 function dispose(){
  const s=current;current=null;if(!s)return;s.sequence++;
  s.render?.cancel();if(s.loading)Promise.resolve(s.loading.destroy()).catch(()=>{});
  if(s.url)URL.revokeObjectURL(s.url);s.resize?.disconnect();
 }
 function setup(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.className='ddt-pdf-dialog';dialog.setAttribute('aria-label','Visualizzatore PDF');
  const header=document.createElement('div');header.className='ddt-pdf-header';
  const title=document.createElement('strong');title.textContent='Documento PDF';
  const close=button('Chiudi ×','Chiudi PDF',()=>dialog.close());header.append(title,close);
  const tools=document.createElement('div');tools.className='ddt-pdf-tools';
  const previous=button('‹','Pagina precedente',()=>changePage(-1));
  const page=document.createElement('span');page.setAttribute('aria-live','polite');
  const next=button('›','Pagina successiva',()=>changePage(1));
  const minus=button('−','Riduci PDF',()=>zoom(-.25));const plus=button('+','Ingrandisci PDF',()=>zoom(.25));
  const fit=button('Adatta','Adatta PDF alla larghezza',()=>{if(current){current.zoom=1;render();}});
  const download=document.createElement('a');download.className='btn';download.textContent='Scarica PDF';download.hidden=true;
  tools.append(previous,page,next,minus,plus,fit,download);
  const status=document.createElement('p');status.className='ddt-pdf-status';status.setAttribute('role','status');
  const viewport=document.createElement('div');viewport.className='ddt-pdf-viewport';viewport.tabIndex=0;viewport.setAttribute('aria-label','Pagina PDF, scorri per leggere il documento');
  dialog.append(header,tools,status,viewport);document.body.append(dialog);
  ui={title,close,previous,page,next,minus,plus,fit,download,status,viewport};
  // Keep the underlying DDT drawer's keyboard handler out of this dialog.
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  dialog.addEventListener('close',()=>{dispose();viewport.replaceChildren();download.removeAttribute('href');});
 }
 function controls(){const s=current,ready=!!s?.doc;ui.previous.disabled=!ready||s.page<=1;ui.next.disabled=!ready||s.page>=s.doc.numPages;ui.minus.disabled=!ready||s.zoom<=.5;ui.plus.disabled=!ready||s.zoom>=3;ui.fit.disabled=!ready;ui.page.textContent=ready?s.page+' / '+s.doc.numPages:'';}
 async function render(){
  const s=current;if(!s?.doc)return;const sequence=++s.sequence;
  s.render?.cancel();controls();ui.status.textContent='Caricamento pagina…';
  try{
   const page=await s.doc.getPage(s.page);if(current!==s||sequence!==s.sequence)return;
   const original=page.getViewport({scale:1});
   const width=Math.max(200,ui.viewport.clientWidth-24),scale=width/original.width*s.zoom;
   const viewport=page.getViewport({scale});
   const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(6000000/(viewport.width*viewport.height)));
   const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Pagina '+s.page+' di '+s.doc.numPages);
   canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));canvas.style.width=Math.floor(viewport.width)+'px';canvas.style.height=Math.floor(viewport.height)+'px';
   const task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});s.render=task;await task.promise;
   if(current!==s||sequence!==s.sequence)return;
   ui.viewport.replaceChildren(canvas);ui.status.textContent='Pagina '+s.page+' di '+s.doc.numPages+' · Zoom '+Math.round(s.zoom*100)+'%';s.render=null;
  }catch(e){if(current===s&&sequence===s.sequence&&e.name!=='RenderingCancelledException')ui.status.textContent='Anteprima non disponibile. Puoi usare Scarica PDF.';}
 }
 function changePage(delta){if(!current?.doc)return;current.page=Math.max(1,Math.min(current.doc.numPages,current.page+delta));ui.viewport.scrollTop=0;ui.viewport.scrollLeft=0;render();}
 function zoom(delta){if(!current?.doc)return;current.zoom=Math.max(.5,Math.min(3,current.zoom+delta));render();}
 async function open({load,filename='documento.pdf',title='Documento PDF'}){
  setup();dispose();const s=current={page:1,zoom:1,sequence:0,url:'',doc:null,loading:null,render:null};
  ui.title.textContent=title;ui.viewport.replaceChildren();ui.download.hidden=true;ui.download.removeAttribute('href');ui.status.textContent='Caricamento documento…';controls();
  if(!dialog.open)dialog.showModal();ui.close.focus();
  try{
   const bytes=await load();if(current!==s)return;
   s.url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));ui.download.href=s.url;ui.download.download=filename.replace(/[\\/:*?"<>|]/g,'-');ui.download.hidden=false;
   const lib=await library();if(current!==s)return;
   s.loading=lib.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/'});
   s.loading.onPassword=()=>{if(current===s){ui.status.textContent='PDF protetto da password. Usa Scarica PDF per aprirlo con il tuo lettore.';Promise.resolve(s.loading.destroy()).catch(()=>{});}};
   s.doc=await s.loading.promise;if(current!==s)return;
   await render();
   if(current===s&&typeof ResizeObserver!=='undefined'){let width=ui.viewport.clientWidth;s.resize=new ResizeObserver(()=>{const next=ui.viewport.clientWidth;if(next!==width){width=next;render();}});s.resize.observe(ui.viewport);}
  }catch(e){if(current===s)ui.status.textContent=s.url?'Impossibile visualizzare il PDF. Puoi usare Scarica PDF.':'Documento non caricato: '+e.message;}
 }
 async function extractText(bytes){
  const lib=await library();
  const loading=lib.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/'});
  try {
   const doc=await loading.promise;
   const pages=[];
   for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n);
    const content=await page.getTextContent();
    const items=content.items.filter(item=>item.str?.trim()&&item.transform)
     .sort((a,b)=>b.transform[5]-a.transform[5]);
    const lines=[];
    for(const item of items){
     const last=lines.at(-1);
     if(last&&Math.abs(last.y-item.transform[5])<=2)last.items.push(item);
     else lines.push({y:item.transform[5],items:[item]});
    }
    pages.push(lines.map(line=>line.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(item=>item.str.trim()).join(' ')).join('\n'));
    page.cleanup();
   }
   return pages.join('\n');
  } finally {await loading.destroy();}
 }
 return {open,extractText,close(){if(dialog?.open)dialog.close();}};
})();
