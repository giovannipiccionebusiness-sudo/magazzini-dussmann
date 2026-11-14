// The inbox is read through the signed server session, never by a client supplied recipient.
let notificationOpenTarget={order:new URLSearchParams(location.search).get('ordine-ddt'),ddt:new URLSearchParams(location.search).get('ddt-caricato')};
let notificationInbox={user:null,items:[],read:new Set(),request:null,loaded:false,last:0,error:''};
function notificationReadKey(user){return 'magazzini_notifications_read_'+user.operatoreId;}
function resetNotificationInbox(){
  notificationInbox.request?.abort();
  notificationInbox={user:APP.user,items:[],read:new Set(),request:null,loaded:false,last:0,error:''};
  if(APP.user)try{
    const saved=JSON.parse(localStorage.getItem(notificationReadKey(APP.user)) || '[]');
    if(Array.isArray(saved))notificationInbox.read=new Set(saved.filter(id=>typeof id==='string').slice(-500));
  }catch{}
  $('notificationsDialog').close();
  renderNotificationInbox();
  if(APP.user)refreshNotifications();
}
function saveNotificationRead(){
  try{localStorage.setItem(notificationReadKey(APP.user),JSON.stringify([...notificationInbox.read].slice(-500)));}catch{}
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
  status.textContent=state.error || (state.request?'Caricamento notifiche…':state.loaded?(state.items.length?'Tocca un avviso per aprire il documento.':'Nessuna notifica ricevuta. Troverai qui i prossimi avvisi.'):'');
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
  const state=notificationInbox,user=APP.user;
  if(!user || state.user!==user || state.request)return;
  const controller=new AbortController();state.request=controller;state.error='';renderNotificationInbox();
  const timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const result=await ddtPushApi('ddtPushInbox',{},user,controller.signal);
    if(notificationInbox!==state || APP.user!==user)return;
    state.items=(result.notifications || []).filter(item=>typeof item.id==='string' && typeof item.target==='string' && ['ddt-uploaded','ddt-reminder'].includes(item.type) && (item.type!=='ddt-uploaded' || user.role==='ADMIN'));
    // Opening a system push also marks its matching inbox entries as read.
    if(notificationOpenTarget){
      for(const item of state.items)if(item.target===(item.type==='ddt-uploaded'?notificationOpenTarget.ddt:notificationOpenTarget.order))state.read.add(item.id);
      notificationOpenTarget=null;saveNotificationRead();
    }
    state.loaded=true;state.last=Date.now();
  }catch(error){
    if(notificationInbox===state)state.error=error.name==='AbortError'?'Il caricamento tarda a rispondere. Tocca Aggiorna per riprovare.':error.message;
  }finally{
    clearTimeout(timeout);if(notificationInbox===state){state.request=null;renderNotificationInbox();}
  }
}
function openNotifications(){
  if(!APP.user)return;
  $('notificationsDialog').showModal();
  $('notificationBell').setAttribute('aria-expanded','true');
  refreshNotifications();
}
function closeNotifications(){
  $('notificationsDialog').close();
}
function markAllNotificationsRead(){
  if(!APP.user || notificationInbox.user!==APP.user)return;
  notificationInbox.items.forEach(item=>notificationInbox.read.add(item.id));
  saveNotificationRead();renderNotificationInbox();
}
function openNotificationItem(item){
  if(!APP.user || notificationInbox.user!==APP.user)return;
  if(item.type==='ddt-uploaded' && APP.user.role!=='ADMIN')return;
  notificationInbox.read.add(item.id);saveNotificationRead();renderNotificationInbox();closeNotifications();
  if(item.type==='ddt-uploaded')openUploadedDdtFromLink(item.target);
  else openDdtReminderFromLink(item.target);
}
$('notificationsDialog').addEventListener('close',()=>{
  $('notificationBell').setAttribute('aria-expanded','false');
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && APP.user && Date.now()-notificationInbox.last>(APP.user.role==='ADMIN'?30000:60000))refreshNotifications();
});
window.addEventListener('storage',event=>{
  if(APP.user && event.key===notificationReadKey(APP.user)){
    try{const read=JSON.parse(event.newValue || '[]');if(Array.isArray(read))notificationInbox.read=new Set(read);}catch{}
    renderNotificationInbox();
  }
});
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='DDT_NOTIFICATION_RECEIVED' && APP.user)setTimeout(()=>refreshNotifications(),1000);
});
setInterval(()=>{
  if(APP.user && document.visibilityState==='visible' && Date.now()-notificationInbox.last>(APP.user.role==='ADMIN'?30000:120000))refreshNotifications();
},30000);
