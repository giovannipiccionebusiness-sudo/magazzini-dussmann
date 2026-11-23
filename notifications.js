// Shared read status belongs to the signed-in account; local state is an offline queue.
let notificationOpenTarget={order:new URLSearchParams(location.search).get('ordine-ddt'),ddt:new URLSearchParams(location.search).get('ddt-caricato')};
function newNotificationInbox(user){return {user,items:[],read:new Set(),pending:new Set(),syncTask:null,syncError:'',request:null,loaded:false,last:0,error:''};}
let notificationInbox=newNotificationInbox(null);
function notificationReadKey(user){return 'magazzini_notifications_read_'+user.operatoreId;}
function notificationPendingKey(user){return 'magazzini_notifications_pending_'+user.operatoreId;}
function resetNotificationInbox(){
  notificationInbox.request?.abort();notificationInbox=newNotificationInbox(APP.user);
  if(APP.user)try{
    const saved=JSON.parse(localStorage.getItem(notificationReadKey(APP.user)) || '[]');
    if(Array.isArray(saved))notificationInbox.read=new Set(saved.filter(id=>typeof id==='string').slice(-500));
    const pending=localStorage.getItem(notificationPendingKey(APP.user));
    const queue=pending===null?saved:JSON.parse(pending);
    if(Array.isArray(queue))notificationInbox.pending=new Set(queue.filter(id=>typeof id==='string').slice(-500));
  }catch{}
  $('notificationsDialog').close();renderNotificationInbox();if(APP.user)refreshNotifications();
}
function saveNotificationRead(state=notificationInbox){
  if(!state.user)return;
  try{
    localStorage.setItem(notificationReadKey(state.user),JSON.stringify([...state.read].slice(-500)));
    localStorage.setItem(notificationPendingKey(state.user),JSON.stringify([...state.pending].slice(-500)));
  }catch{}
}
function markNotificationsRead(ids){
  const state=notificationInbox;if(!APP.user || state.user!==APP.user)return;
  for(const id of ids){state.read.add(id);state.pending.add(id);}
  saveNotificationRead(state);renderNotificationInbox();flushNotificationReads(state);
}
function flushNotificationReads(state=notificationInbox){
  if(state.syncTask)return state.syncTask;
  if(!state.user || APP.user!==state.user || !state.pending.size)return Promise.resolve();
  state.syncTask=(async()=>{
    try{
      while(state.pending.size && APP.user===state.user && notificationInbox===state){
        const ids=[...state.pending].slice(0,100);
        await ddtPushTimedApi('ddtPushMarkRead',{ids:JSON.stringify(ids)},state.user);
        for(const id of ids)state.pending.delete(id);
        state.syncError='';saveNotificationRead(state);
      }
    }catch{
      state.syncError='Letture salvate su questo dispositivo. Sincronizzazione da riprovare appena torna la connessione.';saveNotificationRead(state);
    }finally{state.syncTask=null;if(notificationInbox===state)renderNotificationInbox();}
  })();return state.syncTask;
}
function renderNotificationInbox(){
  const state=notificationInbox;
  $('notificationBell').classList.toggle('hidden',!APP.user);
  const unread=state.items.filter(item=>!state.read.has(item.id)).length;
  const badge=$('notificationBadge');badge.textContent=unread>99?'99+':String(unread);
  badge.classList.toggle('hidden',!unread);
  $('notificationBell').setAttribute('aria-label',unread?'Notifiche, '+unread+' da leggere':'Notifiche');
  $('notificationsReadAll').disabled=!unread;
  $('notificationsRefresh').disabled=!!state.request;
  const status=$('notificationsStatus');
  status.textContent=state.error || state.syncError || (state.request?'Caricamento notifiche…':state.loaded?(state.items.length?'Tocca un avviso per aprire il documento.':'Nessuna notifica ricevuta. Troverai qui i prossimi avvisi.'):'');
  const list=$('notificationsList');list.replaceChildren();
  for(const item of state.items){
    const li=document.createElement('li');
    const button=document.createElement('button');button.type='button';button.className='notification-item';
    const isUnread=!state.read.has(item.id);button.classList.toggle('is-unread',isUnread);
    const tag=document.createElement('span');tag.className='notification-kind';tag.textContent=item.type==='ddt-uploaded'?'Documento ricevuto':'Promemoria ordine';
    const title=document.createElement('strong');title.textContent=item.title+(isUnread?' · Nuova':'');
    const text=document.createElement('span');text.textContent=item.body;
    const date=document.createElement('time');date.dateTime=item.date;
    const parsed=new Date(item.date);date.textContent=Number.isNaN(parsed.getTime())?'':parsed.toLocaleString('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'});
    const action=document.createElement('span');action.className='notification-open';action.textContent=item.type==='ddt-uploaded'?'Apri DDT →':'Apri ordine →';
    button.append(tag,title,text,date,action);button.onclick=()=>openNotificationItem(item);li.append(button);list.append(li);
  }
}

async function refreshNotifications(){
  const state=notificationInbox,user=APP.user;if(!user || state.user!==user || state.request)return;
  const controller=new AbortController();state.request=controller;state.error='';renderNotificationInbox();let timeout;
  try{
    await flushNotificationReads(state);if(notificationInbox!==state || APP.user!==user)return;
    timeout=setTimeout(()=>controller.abort(),30000);
    const result=await ddtPushApi('ddtPushInbox',{},user,controller.signal);
    if(notificationInbox!==state || APP.user!==user)return;
    state.items=(result.notifications || []).filter(item=>typeof item.id==='string' && typeof item.target==='string' && ['ddt-uploaded','ddt-reminder'].includes(item.type) && (item.type!=='ddt-uploaded' || user.role==='ADMIN'));
    if(Array.isArray(result.readIds)){
      // Monotonic merge prevents an older response from undoing a newer read.
      result.readIds.forEach(id=>state.read.add(id));
      if(!state.pending.size)state.syncError='';saveNotificationRead(state);
    }else if(result.readSyncUnavailable){state.syncError='Sincronizzazione delle letture temporaneamente non disponibile. Riprova tra poco.';}
    if(notificationOpenTarget){
      const opened=state.items.filter(item=>item.target===(item.type==='ddt-uploaded'?notificationOpenTarget.ddt:notificationOpenTarget.order)).map(item=>item.id);
      notificationOpenTarget=null;markNotificationsRead(opened);
    }
    state.loaded=true;state.last=Date.now();
  }catch(error){if(notificationInbox===state)state.error=error.name==='AbortError'?'Il caricamento tarda a rispondere. Tocca Aggiorna per riprovare.':error.message;}
  finally{clearTimeout(timeout);if(notificationInbox===state){state.request=null;renderNotificationInbox();}}
}
function openNotifications(){if(!APP.user)return;$('notificationsDialog').showModal();$('notificationBell').setAttribute('aria-expanded','true');refreshNotifications();}
function closeNotifications(){$('notificationsDialog').close();}
function markAllNotificationsRead(){if(APP.user && notificationInbox.user===APP.user)markNotificationsRead(notificationInbox.items.map(item=>item.id));}
function openNotificationItem(item){
  if(!APP.user || notificationInbox.user!==APP.user || (item.type==='ddt-uploaded' && APP.user.role!=='ADMIN'))return;
  markNotificationsRead([item.id]);closeNotifications();
  if(item.type==='ddt-uploaded')openUploadedDdtFromLink(item.target);else openDdtReminderFromLink(item.target);
}
$('notificationsDialog').addEventListener('close',()=>{$('notificationBell').setAttribute('aria-expanded','false');});
function refreshNotificationsOnReturn(){if(document.visibilityState==='visible' && APP.user && Date.now()-notificationInbox.last>3000)refreshNotifications();}
document.addEventListener('visibilitychange',refreshNotificationsOnReturn);
window.addEventListener('focus',refreshNotificationsOnReturn);
window.addEventListener('online',()=>{if(APP.user)refreshNotifications();});
window.addEventListener('storage',event=>{
  if(APP.user && event.key===notificationReadKey(APP.user)){
    try{const read=JSON.parse(event.newValue || '[]');if(Array.isArray(read))read.forEach(id=>notificationInbox.read.add(id));}catch{}
    renderNotificationInbox();
  }
});
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='DDT_NOTIFICATION_RECEIVED' && APP.user)setTimeout(()=>refreshNotifications(),1000);
});
setInterval(()=>{
  if(APP.user && document.visibilityState==='visible' && Date.now()-notificationInbox.last>($('notificationsDialog').open?10000:30000))refreshNotifications();
},10000);
