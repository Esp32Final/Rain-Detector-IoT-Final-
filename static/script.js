const $=s=>document.querySelector(s);
let devices=[],loaded=false,sel=null,page='dashboard',logs=[],allLogs=[],editId=null;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',3200)}
/* only touch the DOM when something changed, so nothing flickers every 4 s */
function setHTML(el,html){if(el.__h!==html){el.__h=html;el.innerHTML=html}}
function setText(el,t){if(el.textContent!==t)el.textContent=t}

/* ---------- icons ---------- */
const IC={
  rain:'<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  grid:'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  cpu:'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  history:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  wifi:'<path d="M12 20h.01"/><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.9a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/>',
  key:'<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M16 7l3 3M14 9l2 2"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  up:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down:'<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  chev:'<path d="m9 18 6-6-6-6"/>',
  plus:'<path d="M5 12h14M12 5v14"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  pulse:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  wifioff:'<path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7"/><path d="M19 12.9a10 10 0 0 0-2-1.5"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8a15 15 0 0 0-11.3-3.8"/><path d="m2 2 20 20"/>',
  alert:'<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>'
};
const ic=n=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(IC[n]||'')+'</svg>';
document.querySelectorAll('[data-ic]').forEach(e=>e.innerHTML=ic(e.dataset.ic));

/* ---------- talking to Django ---------- */
function csrf(){const m=document.cookie.match(/csrftoken=([^;]+)/);return m?decodeURIComponent(m[1]):''}
async function api(method,url,body){
  const opt={method,headers:{'X-CSRFToken':csrf()}};
  if(body!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
  const res=await fetch(url,opt);
  if(res.status===401){location.href='/login/';throw new Error('login required')}
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Request failed');
  return data;
}

/* ---------- helpers ---------- */
const raining=d=>d.rain!=null&&(d.wetHigh?d.rain>d.rainTh:d.rain<d.rainTh);
const isDark=d=>d.light!=null&&d.light<d.darkTh;
const reason=d=>!d.seen?'Waiting for the device':raining(d)?'Rain detected':isDark(d)?'It is dark':'Dry and bright';
const pc=v=>v==null?'0%':Math.max(0,Math.min(100,v/4095*100))+'%';
const val=v=>v==null?'—':Math.round(v);
const cur=()=>devices.find(x=>x.id===sel)||null;
function ago(iso){
  const s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);
  if(s<10)return 'Now';if(s<60)return Math.floor(s)+'s ago';
  if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';
  return new Date(iso).toLocaleDateString([],{month:'short',day:'numeric'});
}
const clock=iso=>new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function logIcon(m){
  if(/closed/i.test(m)&&!/Close cover requested/i.test(m))return['down','t-down'];
  if(/opened/i.test(m))return['up','t-up'];
  if(/requested|Manual|auto/i.test(m))return['pulse',''];
  if(/online|connected/i.test(m))return['wifi',''];
  if(/key/i.test(m))return['key','t-warn'];
  return['pulse',''];
}
function logHTML(list,withDevice){
  if(!list.length)return '<li><span class="m">Nothing yet.</span></li>';
  return list.map(x=>{const[i,c]=logIcon(x.message);
    return '<li class="'+c+'"><i class="ic">'+ic(i)+'</i><span class="m">'+esc(x.message)+(withDevice?'<small>'+esc(x.device)+'</small>':'')+'</span><time title="'+esc(clock(x.time))+'" datetime="'+esc(x.time)+'">'+ago(x.time)+'</time></li>'}).join('');
}

/* open a device's dashboard (works for every device, even when already on that hash) */
function openDevice(id){
  sel=+id;localStorage.setItem('sel',sel);
  const h='#device-'+sel;
  if(location.hash===h)goPage('device',false);else location.hash=h;
}

/* ---------- sidebar + header ---------- */
function paintShell(){
  const online=devices.some(d=>d.online);
  const sp=$('#sysPill');setText(sp,online?'System Online':(devices.length?'System Offline':'No devices'));sp.className='pill '+(online?'ok':(devices.length?'bad':''));
  setHTML($('#sideDevs'),devices.length?devices.map(d=>'<button class="nav dev'+(d.id===sel&&page==='device'?' on':'')+'" data-id="'+d.id+'"><span class="dot'+(d.online?' on':'')+'"></span><span class="n">'+esc(d.name)+'</span></button>').join(''):'<p class="hint" style="padding:0 12px">No devices yet.</p>');
  document.querySelectorAll('.nav[data-page]').forEach(a=>a.classList.toggle('on',a.dataset.page===page));
}
$('#sideDevs').onclick=e=>{const b=e.target.closest('.dev');if(b)openDevice(b.dataset.id)};

/* ---------- dashboard ---------- */
function paintDashboard(){
  const d=cur();
  $('#dEmpty').hidden=!!d||!loaded;$('#dBody').hidden=!d;
  if(!d){setText($('#dSub'),loaded?'':'Loading…');setText($('#dConn'),'');$('#dConn').className='pill';return}
  const closed=d.cover==='closed',rn=raining(d),dk=isDark(d);
  setText($('#dName'),d.name);setText($('#dSub'),(d.deviceId||d.name)+' · '+(d.location||'No location'));
  const c=$('#dConn');setText(c,!d.seen?'No data yet':d.online?'Connected':'Offline');c.className='pill '+(!d.seen?'':d.online?'ok':'bad');
  const b=$('#dBadge');setText(b,closed?'Closed':'Open');b.className='pill '+(closed?'closed':'ok');
  const cc=$('#coverCard');cc.classList.toggle('closed',closed);cc.classList.toggle('rain',rn);cc.classList.toggle('dark',dk&&!rn);
  const icon=rn?'rain':dk?'moon':'sun';if($('#cIcon').dataset.k!==icon){$('#cIcon').dataset.k=icon;$('#cIcon').innerHTML=ic(icon)}
  setText($('#cTitle'),closed?'Cover Closed':'Cover Open');
  setText($('#dWhy'),!d.seen?'This device has not reported in yet. Check its API key and Wi-Fi.':reason(d)+(d.manual?'. You are in control right now.':'. The device decides on its own.'));
  setText($('#rainV'),val(d.rain));setText($('#lightV'),val(d.light));
  const rp=$('#rainP');setText(rp,d.rain==null?'NO DATA':rn?'WET':'DRY');rp.className='pill '+(d.rain==null?'':rn?'blue':'ok');
  const lp=$('#lightP');setText(lp,d.light==null?'NO DATA':dk?'DARK':'BRIGHT');lp.className='pill '+(d.light==null?'':dk?'dark':'amber');
  $('#rainF').style.width=pc(d.rain);$('#rainF').classList.toggle('alert',rn);$('#rainT').style.left=pc(d.rainTh);
  $('#lightF').style.width=pc(d.light);$('#lightF').classList.toggle('alert',dk);$('#lightT').style.left=pc(d.darkTh);
  setText($('#rainN'),'Wet threshold: '+d.rainTh+' ('+(d.wetHigh?'above':'below')+' it counts as wet)');
  setText($('#lightN'),'Dark threshold: '+d.darkTh+' (below it counts as dark)');
  const m=Math.floor(d.manualLeft/60),s=String(d.manualLeft%60).padStart(2,'0');
  const mode=d.manual?(d.manualLeft>0?'Manual · auto in '+m+':'+s:'Manual'):'Automatic';
  setHTML($('#info'),
    '<div class="row2"><span>Device ID</span><b>'+esc(d.deviceId||d.name)+'</b></div>'+
    '<div class="row2"><span>Location</span><b>'+esc(d.location||'—')+'</b></div>'+
    '<div class="row2"><span>Connection</span><span class="pill '+(!d.seen?'':d.online?'ok':'bad')+'">'+(!d.seen?'No data yet':d.online?'Online':'Offline')+'</span></div>'+
    '<div class="row2"><span>Operating mode</span><b>'+esc(mode)+'</b></div>'+
    (d.notes?'<div class="row2"><span>Notes</span><b>'+esc(d.notes)+'</b></div>':''));
  setText($('#dNote'),d.pending?'Command “'+d.pending+'” sent, waiting for the device to check in…':(d.seen&&!d.online?'The device is offline. A command waits up to 5 minutes for it to reconnect.':''));
  $('#bAuto').hidden=!d.manual;
  $('#bOpen').disabled=d.seen&&!closed;$('#bClose').disabled=d.seen&&closed;
  setHTML($('#log'),logHTML(logs,false));
  fillSettings(false);
}

/* ---------- devices + activity pages ---------- */
function paintDevices(){
  setText($('#dashSub'),devices.length?devices.length+' device'+(devices.length>1?'s':'')+' · '+devices.filter(d=>d.online).length+' online · '+devices.filter(d=>d.cover==='closed').length+' closed. Click one to open it.':'All your devices. Click one to open it.');
  const q=$('#q').value.trim().toLowerCase();
  const rows=devices.filter(d=>!q||[d.name,d.location,d.deviceId].join(' ').toLowerCase().includes(q));
  setHTML($('#devList'),!loaded?'<div class="empty">Loading devices…</div>':!rows.length?'<div class="empty">'+(devices.length?'No devices match your search.':'No devices yet. Add your first rain cover unit.')+'</div>':
    rows.map(d=>'<button class="drow" data-id="'+d.id+'"><i class="ic">'+ic('cpu')+'</i><div class="t"><b>'+esc(d.name)+'</b><small>'+esc(d.location||'No location')+(d.deviceId?' · '+esc(d.deviceId):'')+'</small><small>Rain '+val(d.rain)+' · Light '+val(d.light)+' · '+esc(reason(d))+'</small></div>'+
      '<span class="pill '+(d.cover==='closed'?'closed':'ok')+'">'+(d.cover==='closed'?'Closed':'Open')+'</span>'+
      '<span class="pill '+(!d.seen?'':d.online?'ok':'bad')+'">'+(!d.seen?'No data':d.online?'Online':'Offline')+'</span><i class="ic">'+ic('chev')+'</i></button>').join(''));
}
$('#devList').onclick=e=>{const b=e.target.closest('.drow');if(b)openDevice(b.dataset.id)};
$('#q').oninput=paintDevices;
function paintOverview(){
  const n=devices.length,seen=devices.filter(d=>d.seen),live=devices.filter(d=>d.online),stale=devices.filter(d=>d.seen&&!d.online);
  const op=devices.filter(d=>d.cover==='open').length,cl=n-op,on=live.length,off=n-on;
  const rnd=live.filter(raining),rn=rnd.length,night=live.length&&live.every(isDark);
  const allOff=seen.length>0&&!live.length;
  const mode=allOff?'offline':rn?'rainy':night?'night':'day';
  $('#hero').className='hero '+mode;
  setText($('#oWhen'),new Date().toLocaleString([],{weekday:'long',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}));
  setText($('#oTitle'),!loaded?'Loading…':!n?'No devices yet':allOff?(seen.length===1?'Device not syncing':'Devices not syncing'):rn?(rn===1?'Rain at '+rnd[0].name:'Rain at '+rn+' devices'):night?'It is night time':live.length?'No rain right now':'Waiting for your devices');
  setText($('#oSub'),!n?'Add a device to get started.':allOff?'No device has reported in lately. The numbers below are the last ones received.':op+' of '+n+' covers open · '+on+' online'+(rn?'. Covers close on their own when it rains.':'.'));
  const hi=allOff?'wifioff':rn?'rain':night?'moon':'sun';if($('#oIcon').dataset.k!==hi){$('#oIcon').dataset.k=hi;$('#oIcon').innerHTML=ic(hi)}
  const p=$('#oPill');setText(p,on?(off?'Partly online':'System Online'):(n?'System Offline':'No devices'));p.className='pill '+(on?(off?'amber':'ok'):(n?'bad':''));
  const w=$('#hWarn');
  if(stale.length&&!allOff){w.hidden=false;setHTML(w,'<i class="ic">'+ic('alert')+'</i><span>'+stale.map(d=>esc(d.name)+' · last seen '+ago(d.lastSeen)).join(' &nbsp;|&nbsp; ')+'</span>')}else w.hidden=true;
  setHTML($('#ostats'),[['Devices',n,'cpu',''],['Open',op,'up','g'],['Closed',cl,'down','b'],['Online',on,'wifi','t'],['Offline',off,'wifioff',off?'o':''],['Raining',rn,'rain','r']].map(x=>'<div class="stat '+x[3]+'"><span class="si"><i class="ic">'+ic(x[2])+'</i></span><div><b>'+x[1]+'</b><span>'+x[0]+'</span></div></div>').join(''));
  setHTML($('#tiles'),!loaded?'<div class="empty">Loading devices…</div>':!n?'<div class="empty">No devices yet.<br><button class="pri" id="tileAdd">+ Add your first device</button></div>':
    devices.map(d=>{const closed=d.cover==='closed',off=!d.online,rn=!off&&raining(d);
      const cls=off?'off':(closed?'closed':'opn')+(rn?' rain':'');
      return '<button class="tile '+cls+'" data-id="'+d.id+'">'+
        '<div class="tt"><b>'+esc(d.name)+'</b><span class="od '+(d.online?'on':'')+'" title="'+(d.online?'Online':(d.seen?'Offline':'No data yet'))+'"></span></div>'+
        '<small>'+esc(d.location||'No location')+'</small>'+
        (off?'<div class="ts"><i class="ic">'+ic('wifioff')+'</i><b>'+(d.seen?'NOT SYNCING':'NO DATA')+'</b></div>'+
              '<div class="tm"><span>'+(d.seen?'Last seen <b>'+ago(d.lastSeen)+'</b>':'Never connected')+'</span></div>'+
              '<div class="tr">'+(d.seen?'Last known: cover '+(closed?'closed':'open')+' · Rain '+val(d.rain)+' · Light '+val(d.light):'Check its API key and Wi-Fi.')+'</div>'
            :'<div class="ts"><i class="ic">'+ic(closed?'down':'up')+'</i><b>'+(closed?'CLOSED':'OPEN')+'</b></div>'+
              '<div class="tm"><span>Rain <b>'+val(d.rain)+'</b></span><span>Light <b>'+val(d.light)+'</b></span></div>'+
              '<div class="tr">'+esc(reason(d))+(d.manual?' (manual)':'')+'</div>')+'</button>'}).join(''));
  const ta=$('#tileAdd');if(ta)ta.onclick=()=>openForm(null);
  setHTML($('#dashLog'),logHTML(allLogs.slice(0,8),true));
}
$('#tiles').onclick=e=>{const b=e.target.closest('.tile');if(b)openDevice(b.dataset.id)};
function paintActivity(){setHTML($('#allLog'),logHTML(allLogs,true))}

async function loadLog(){
  try{
    if(page==='device'&&sel!=null)logs=(await api('GET','/api/devices/'+sel+'/log/')).log;
    if(page==='activity'||page==='dashboard')allLogs=(await api('GET','/api/activity/')).log;
  }catch(e){}
  paint();
}

/* ---------- routing ---------- */
function paint(){
  paintShell();
  if(page==='device')paintDashboard();else if(page==='dashboard')paintOverview();else if(page==='devices')paintDevices();else paintActivity();
}
function goPage(p,push){
  if(push){const h=p==='device'&&sel?'#device-'+sel:'#'+p;if(location.hash!==h)history.pushState(null,'',h)}
  page=p;logs=[];
  if(p==='device'&&lastDev!==sel){lastDev=sel}
  ['dashboard','devices','device','activity'].forEach(n=>$('#p-'+n).hidden=n!==p);
  closeMenu();window.scrollTo(0,0);paint();loadLog();
}
function route(){
  const h=location.hash,m=h.match(/^#device-(\d+)$/);
  if(m){sel=+m[1];page='device'}
  else if(h==='#devices')page='devices';else if(h==='#activity')page='activity';else page='dashboard';
  if(page==='device'&&loaded&&!cur()){history.replaceState(null,'',location.pathname+'#dashboard');page='dashboard'}
  goPage(page,false);
}
async function refresh(){
  try{devices=(await api('GET','/api/devices/')).devices}catch(e){}
  loaded=true;
  paint();loadLog();
}
window.addEventListener('hashchange',route);

/* mobile menu */
function closeMenu(){$('#side').classList.remove('open');$('#scrim').classList.remove('on')}
$('#menu').onclick=()=>{$('#side').classList.toggle('open');$('#scrim').classList.toggle('on')};
$('#scrim').onclick=closeMenu;

/* ---------- commands ---------- */
async function cmd(c,msg){if(sel==null)return;try{await api('POST','/api/devices/'+sel+'/command/',{command:c});toast(msg);await refresh()}catch(e){toast(e.message)}}
$('#bOpen').onclick=()=>cmd('open','Opening the cover…');
$('#bClose').onclick=()=>cmd('closed','Closing the cover…');
$('#bAuto').onclick=()=>cmd('auto','Auto mode requested');

/* ---------- confirm dialog ---------- */
function ask(title,msg,okLabel,danger){
  return new Promise(res=>{
    $('#ctitle').textContent=title;$('#cmsg').textContent=msg;
    const y=$('#cyes');y.textContent=okLabel;y.className=danger?'':'pri';
    y.style.cssText=danger?'background:#e5484d;color:#fff;border-color:#e5484d;font-weight:600':'';
    $('#cov').classList.add('on');
    const done=v=>{$('#cov').classList.remove('on');res(v)};
    $('#cyes').onclick=()=>done(true);$('#cno').onclick=()=>done(false);
  });
}

/* ---------- add / edit / delete ---------- */
function openForm(id,added){
  editId=id;const d=devices.find(x=>x.id===id)||{};
  $('#ttl').textContent=added?'Device added':id?'Edit device':'Add device';
  $('#fn').value=d.name||'';$('#fl').value=d.location||'';$('#fi').value=d.deviceId||'';$('#fm').value=d.notes||'';
  $('#keyrow').style.display='';$('#fk').value=d.apiKey||'';$('#fk').placeholder='Created automatically when you press Save';$('#copykey').disabled=!d.apiKey;
  setText($('#keyhint'),!id?'The API key is created automatically when you press Save. You will see it here, and later in the device’s Device Settings tab.':added?'Copy this key, then open the device’s Device Settings tab to build the secrets.h file for your ESP32.':'The key also lives in the Device Settings tab, where you can build secrets.h.');
  $('#err').textContent='';
  $('#ov').classList.add('on');$('#fn').focus();
}
function closeAll(){document.querySelectorAll('.ov').forEach(o=>o.classList.remove('on'))}
['#add','#add2','#emptyAdd'].forEach(s=>$(s).onclick=()=>{closeMenu();openForm(null)});
$('#bEdit').onclick=()=>openForm(sel);
$('#cancel').onclick=closeAll;
$('#copykey').onclick=async()=>{try{await navigator.clipboard.writeText($('#fk').value);toast('Key copied')}catch(e){$('#fk').select()}};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAll()});
document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{fillSettings(false);$('#'+b.dataset.open).classList.add('on')});
document.querySelectorAll('.closeov').forEach(b=>b.onclick=closeAll);
['ov-wifi','ov-server','ov-key','ov-secrets'].forEach(i=>$('#'+i).addEventListener('mousedown',e=>{if(e.target.id===i)closeAll()}));
$('#save').onclick=async()=>{
  const name=$('#fn').value.trim();
  if(!name){$('#err').textContent='Please enter a device name.';return}
  const rec={name,location:$('#fl').value.trim(),deviceId:$('#fi').value.trim(),notes:$('#fm').value.trim()};
  try{
    if(editId){await api('PUT','/api/devices/'+editId+'/',rec);closeAll();toast('Device updated');await refresh()}
    else{const made=await api('POST','/api/devices/',rec);sel=made.id;localStorage.setItem('sel',sel);await refresh();toast('Device added. Its API key is ready.');openForm(made.id,true)}
  }catch(e){$('#err').textContent=e.message}
};
$('#bDel').onclick=async()=>{
  const d=cur();if(!d)return;
  if(await ask('Delete device?','“'+d.name+'” will be removed permanently.','Delete',true)){
    try{await api('DELETE','/api/devices/'+d.id+'/');toast('Device deleted');sel=null;await refresh();location.hash='devices'}catch(e){toast(e.message)}
  }
};

let lastDev=null,setFor=null;

/* ---------- device settings form (builds secrets.h for THIS device) ---------- */
const cstr=s=>String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
const cfgKey=id=>'cfg-'+id;
const onPA=location.hostname.endsWith('pythonanywhere.com');
function defaultUrl(mode){
  if(mode==='pa')return onPA?location.origin+'/api/esp/sync/':'https://YOURUSERNAME.pythonanywhere.com/api/esp/sync/';
  const h=location.hostname,lan=location.protocol==='http:'&&h!=='localhost'&&h!=='127.0.0.1';
  return lan?location.origin+'/api/esp/sync/':'http://192.168.x.x:8000/api/esp/sync/';
}
const srvMode=()=>(document.querySelector('input[name=srv]:checked')||{}).value||'local';
function urlHint(){
  const u=$('#su').value,mode=srvMode();
  let t=mode==='pa'?'Your PythonAnywhere site, for example https://yourname.pythonanywhere.com/api/esp/sync/':'Your PC’s Wi-Fi address on this network, for example http://192.168.1.5:8000/api/esp/sync/';
  if(/YOURUSERNAME|x\.x/.test(u))t='Replace the placeholder with your real address. '+t;
  else if(/localhost|127\.0\.0\.1/.test(u))t='The ESP32 cannot reach localhost. Use your PC’s Wi-Fi address instead.';
  setText($('#suHint'),t);
}
function buildSecrets(){
  const d=cur();if(!d)return;
  $('#sc').value=
'#pragma once\n\n'+
'#define WIFI_SSID      "'+cstr($('#sw').value||'YOUR_WIFI_NAME')+'"\n'+
'#define WIFI_PASSWORD  "'+cstr($('#sp').value||'YOUR_WIFI_PASSWORD')+'"\n\n'+
'#define SERVER_URL     "'+cstr($('#su').value)+'"\n\n'+
'#define API_KEY        "'+cstr(d.apiKey)+'"\n';
}
function fillSettings(force){
  const d=cur();if(!d)return;
  setText($('#sName'),d.name);
  const c=$('#sConn');setText(c,!d.seen?'No data yet':d.online?'Online':'Offline');c.className='pill '+(!d.seen?'':d.online?'ok':'bad');
  if(!force&&setFor===d.id){
    if($('#sk').dataset.k!==d.apiKey){$('#sk').value=d.apiKey;$('#sk').dataset.k=d.apiKey;buildSecrets()}
    return;
  }
  setFor=d.id;
  let cfg={};try{cfg=JSON.parse(localStorage.getItem(cfgKey(d.id))||'{}')}catch(e){}
  const mode=cfg.mode||(onPA?'pa':'local');
  document.querySelectorAll('input[name=srv]').forEach(r=>r.checked=r.value===mode);
  $('#sw').value=cfg.ssid||'';$('#sp').value='';$('#su').value=cfg.url||defaultUrl(mode);
  $('#sk').value=d.apiKey;$('#sk').dataset.k=d.apiKey;$('#sk').type='password';$('#skShow').textContent='Show';
  urlHint();buildSecrets();
}
['#sw','#sp','#su'].forEach(q=>$(q).oninput=()=>{urlHint();buildSecrets()});
document.querySelectorAll('input[name=srv]').forEach(r=>r.onchange=()=>{$('#su').value=defaultUrl(r.value);urlHint();buildSecrets()});
$('#skShow').onclick=()=>{const k=$('#sk'),show=k.type==='password';k.type=show?'text':'password';$('#skShow').textContent=show?'Hide':'Show'};
$('#skCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('#sk').value);toast('API key copied')}catch(e){$('#sk').type='text';$('#sk').select();toast('Press Ctrl+C to copy')}};
$('#scopy').onclick=async()=>{try{await navigator.clipboard.writeText($('#sc').value);toast('secrets.h copied')}catch(e){$('#sc').select();toast('Press Ctrl+C to copy')}};
document.querySelectorAll('.sSave').forEach(b=>b.onclick=()=>{
  const d=cur();if(!d)return;
  localStorage.setItem(cfgKey(d.id),JSON.stringify({ssid:$('#sw').value.trim(),mode:srvMode(),url:$('#su').value.trim()}));
  toast('Saved for '+d.name+' in this browser. The password is not stored.');closeAll();
});
$('#skNew').onclick=async()=>{
  const d=cur();if(!d)return;
  if(!await ask('Generate a new API key?','The old key for '+d.name+' stops working right away. Put the new key in the ESP32 code and upload it again, or this device will not connect.','Generate new key',false))return;
  try{const nd=await api('POST','/api/devices/'+d.id+'/key/');const i=devices.findIndex(x=>x.id===d.id);if(i>=0)devices[i]=nd;fillSettings(false);toast('New API key created for '+d.name);paint();loadLog()}catch(e){toast(e.message)}
};

/* ---------- start ---------- */
$('#rainfx').innerHTML=Array.from({length:26},()=>'<i style="left:'+(Math.random()*100)+'%;animation-delay:'+Math.random().toFixed(2)+'s"></i>').join('');
paint();
refresh().then(route);
setInterval(refresh,4000);
