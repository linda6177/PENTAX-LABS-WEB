import {
  WHITE, cloneSlot, slotFromFactory, parseCube, evaluateCube, fitCubeQuick,
  prepareRelativeProxy, applyPreparedRelative, displayMatrix, setDisplayMatrix,
  relativeCurve, applyRelativeCurve, applyColorControls,
} from './engine.js';
import {
  loadBuiltinRuntime, compileCameraScript, compileCameraScriptFiles,
  buildFocusZip, base64Bytes, zipStore,
} from './runtime.js';

const $=id=>document.getElementById(id);
const STORAGE_KEY='pentax-labs-web-beta80-parity-v2';
const DB_NAME='PentaxLabsWeb', DB_STORE='userFilters';
const FEATURES=[
  ['filters','自定义滤镜','Custom Filters'],
  ['cp','正负逆冲','Cross Processing'],
  ['engineering','工程模式','Service & Factory'],
  ['seasons','四季滤镜','Four Seasons'],
  ['istd','*ist D 工具箱','*ist D Toolbox'],
];

const state={
  currentPage:'filters',family:null,factoryRows:[],factorySlots:new Map(),natural:null,
  curveProfiles:null,engineeringPayload:null,users:new Map(),db:null,tab:'factory',
  active:0,cameraModel:'k1ii',previewMode:'camera',slots:[],bases:[],channel:0,
  comparing:false,compareMode:0,split:.5,sourceName:'内置色卡',sourceMode:'chart',
  runtimeBases:{k1:null,k1ii:null},sdRoot:null,
  cpOriginal:null,cpNeutral:[1,1,1],
};
const original=document.createElement('canvas');
const originalContext=original.getContext('2d',{willReadFrequently:true});
const preview=$('previewCanvas'), previewContext=preview.getContext('2d');
const thumbOriginal=document.createElement('canvas'),thumbOriginalContext=thumbOriginal.getContext('2d',{willReadFrequently:true});
const cpOriginal=document.createElement('canvas'), cpOriginalCtx=cpOriginal.getContext('2d',{willReadFrequently:true});
let renderTimer=0,toastTimer=0,curvePointer=null;
let thumbRevision=0;
const thumbCache=new Map();

function currentSlot(){return state.slots[state.active];}
function currentBase(){return state.bases[state.active];}
function safeName(value){return String(value||'PentaxLabs').replace(/[\\/:*?"<>|]+/g,'_').slice(0,72);}
function downloadBlob(filename,data,type='application/octet-stream'){
  const blob=data instanceof Blob?data:new Blob([data],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function notify(message){const t=$('toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),2800);}
function setStatus(message){$('footerStatus').textContent=message;if($('headerStatus'))$('headerStatus').textContent=message;}
function stripSource(slot){const copy=cloneSlot(slot);copy.sourceLut=null;return copy;}
function normalizeSlotShape(slot){
  if(!slot.masterCurve) slot.masterCurve=Array.from({length:256},(_,i)=>i*WHITE/255);
  if(!slot.colorBaseMatrix) slot.colorBaseMatrix=slot.matrix.map(row=>row.slice());
  if(slot.color_hue===undefined) slot.color_hue=0;
  if(slot.color_sat===undefined) slot.color_sat=1;
  return slot;
}
function persist(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({
    currentPage:state.currentPage,active:state.active,cameraModel:state.cameraModel,tab:state.tab,
    compareMode:state.compareMode,slots:state.slots.map(stripSource),bases:state.bases.map(stripSource)
  }));}catch(error){console.warn(error);}
}
function restoreLocal(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(!parsed||!Array.isArray(parsed.slots)||parsed.slots.length!==3)return null;
    if(!Array.isArray(parsed.bases)||parsed.bases.length!==3)parsed.bases=parsed.slots;
    parsed.slots.forEach(normalizeSlotShape);parsed.bases.forEach(normalizeSlotShape);return parsed;
  }catch{return null;}
}

function openDatabase(){return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DB_STORE))req.result.createObjectStore(DB_STORE,{keyPath:'id'});};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});}
function dbAll(){if(!state.db)return Promise.resolve([]);return new Promise((resolve,reject)=>{const r=state.db.transaction(DB_STORE,'readonly').objectStore(DB_STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
function dbPut(item){if(!state.db)return Promise.resolve();return new Promise((resolve,reject)=>{const tx=state.db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function dbDelete(id){if(!state.db)return Promise.resolve();return new Promise((resolve,reject)=>{const tx=state.db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}

async function fetchJson(candidates,label){
  let last=null;
  for(const url of candidates){try{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}catch(e){last=e;}}
  throw Error('无法读取'+label+'：'+(last?.message||'unknown'));
}
async function loadLibraries(){
  const [factory,profiles,engineering]=await Promise.all([
    fetchJson(['./assets/factory_lut_families.json','../app/core/assets/factory_lut_families.json'],'原厂滤镜库'),
    fetchJson(['./assets/relative_curve_profiles.json'],'相对曲线基准'),
    fetchJson(['./assets/engineering_payload.json','../app/lab_assets/engineering_payload.json'],'工程模式数据'),
  ]);
  const family=factory.families?.k12;if(!family?.filters)throw Error('K12 原厂滤镜库格式不正确');
  state.family=family;state.factoryRows=family.filters;state.factorySlots.clear();
  family.filters.forEach(row=>state.factorySlots.set(row.key,slotFromFactory(row,state.cameraModel)));
  const naturalRow=family.filters.find(row=>row.local_key==='natural');if(!naturalRow)throw Error('原厂滤镜库缺少 Natural');
  state.natural=slotFromFactory(naturalRow,state.cameraModel);state.curveProfiles=profiles;state.engineeringPayload=engineering;
  $('familyLabel').textContent=family.label||'K12';
}
function initializeSlots(){
  const restored=restoreLocal();
  if(restored){
    state.currentPage=FEATURES.some(x=>x[0]===restored.currentPage)?restored.currentPage:'filters';
    state.active=Math.max(0,Math.min(2,Number(restored.active)||0));
    state.cameraModel=restored.cameraModel==='k1'?'k1':'k1ii';state.tab=restored.tab==='user'?'user':'factory';
    state.compareMode=Math.max(0,Math.min(2,Number(restored.compareMode)||0));
    state.slots=restored.slots.map(slot=>normalizeSlotShape({...slot,sourceLut:null,camera_model:state.cameraModel}));
    state.bases=restored.bases.map(slot=>normalizeSlotShape({...slot,sourceLut:null,camera_model:state.cameraModel}));return;
  }
  state.slots=[0,1,2].map(()=>cloneSlot(state.natural));state.bases=state.slots.map(cloneSlot);
}
function hydrateUserSources(){
  for(const list of [state.slots,state.bases])for(const slot of list){
    if(!slot?.user_preset_id)continue;const item=state.users.get(slot.user_preset_id);
    if(item?.sourceLut)slot.sourceLut=item.sourceLut;
  }
}

function renderNav(){
  const root=$('navItems');root.replaceChildren();
  FEATURES.forEach(([key,zh,en],index)=>{
    const b=document.createElement('button');b.className='nav-entry';b.classList.toggle('active',state.currentPage===key);
    b.innerHTML=`<span class="nav-number">${String(index+1).padStart(2,'0')}</span><span class="nav-copy"><strong>${zh}</strong><small>${en}</small></span><span class="nav-arrow">›</span>`;
    b.onclick=()=>goPage(key);root.appendChild(b);
  });
}
function goPage(key){
  state.currentPage=key;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===key));
  $('headerSlots').parentElement.style.visibility=key==='filters'?'visible':'hidden';$('exportScriptBtn').style.visibility=key==='filters'?'visible':'hidden';closeNav();renderNav();persist();
  $('footerContext').style.visibility=key==='filters'?'visible':'hidden';
  if(location.hash!=='#'+key) history.replaceState(null,'','#'+key);
}
function openNav(){$('sideNav').classList.add('open');$('navMask').classList.add('open');}
function closeNav(){$('sideNav').classList.remove('open');$('navMask').classList.remove('open');}

function syncThumbnailSource(){
  if(!original.width||!original.height)return;
  thumbRevision++;thumbCache.clear();
  thumbOriginal.width=152;thumbOriginal.height=112;
  const scale=Math.max(152/original.width,112/original.height);
  const width=original.width*scale,height=original.height*scale;
  thumbOriginalContext.clearRect(0,0,152,112);
  thumbOriginalContext.drawImage(original,(152-width)/2,(112-height)/2,width,height);
}
function paintFilterThumb(canvas,slot,cacheKey){
  if(!thumbOriginal.width||!state.natural)return;
  const key=thumbRevision+':'+cacheKey;
  const cached=thumbCache.get(key);if(cached){canvas.getContext('2d').putImageData(cached,0,0);return;}
  const ctx=canvas.getContext('2d'),image=thumbOriginalContext.getImageData(0,0,152,112),px=image.data;
  const prepared=prepareRelativeProxy(slot,state.natural);
  for(let i=0;i<px.length;i+=4){
    const out=applyPreparedRelative(prepared,[px[i]/255,px[i+1]/255,px[i+2]/255]);
    px[i]=Math.round(out[0]*255);px[i+1]=Math.round(out[1]*255);px[i+2]=Math.round(out[2]*255);
  }
  thumbCache.set(key,image);ctx.putImageData(image,0,0);
}
function userItems(){return Array.from(state.users.values()).sort((a,b)=>Number(b.importedAt||0)-Number(a.importedAt||0));}
function renderFilterList(){
  const term=$('filterSearch').value.trim().toLowerCase(),list=$('filterList');list.replaceChildren();
  const factory=state.tab==='factory',items=factory?state.factoryRows:userItems();
  const filtered=items.filter(item=>String(factory?item.label:item.name).toLowerCase().includes(term));
  $('filterCategory').textContent=factory?'原厂风格':'用户滤镜';$('filterCount').textContent=filtered.length+' 个';
  $('factoryTab').classList.toggle('on',factory);$('userTab').classList.toggle('on',!factory);
  if(!filtered.length){const e=document.createElement('div');e.className='empty-list';e.textContent=factory?'没有匹配的原厂滤镜':'尚无用户滤镜，导入 .cube 后会保存在这里';list.appendChild(e);return;}
  filtered.forEach(item=>{
    const slot=factory?state.factorySlots.get(item.key):item.slot,row=document.createElement('div');row.className='filter-row';
    const b=document.createElement('button');b.className='filter-item';
    const selected=factory?(currentSlot().preset_key===item.key&&!currentSlot().user_preset_id):currentSlot().user_preset_id===item.id;b.classList.toggle('active',selected);
    const thumb=document.createElement('canvas');thumb.className='thumb';thumb.width=152;thumb.height=112;
    const copy=document.createElement('span');copy.className='filter-label';const title=document.createElement('b');title.textContent=factory?item.label:item.name;
    const sub=document.createElement('small');sub.textContent=factory?'K12 · Matrix + RGB Gamma':'Web 拟合 · MAE '+(Number.isFinite(item.slot.fit_report?.rgb_mae_255)?item.slot.fit_report.rgb_mae_255.toFixed(2)+'/255':'—');
    copy.append(title,sub);b.append(thumb,copy);
    if(selected){const indicator=document.createElement('span');indicator.className='filter-indicator';b.appendChild(indicator);}
    b.onclick=()=>applyPreset(factory?item.key:item.id,factory);row.appendChild(b);
    if(!factory){const del=document.createElement('button');del.className='delete-filter';del.textContent='×';del.title='删除用户滤镜';del.onclick=async e=>{e.stopPropagation();await deleteUser(item.id);};row.appendChild(del);}
    list.appendChild(row);paintFilterThumb(thumb,slot,factory?item.key:item.id);
  });
}
function renderSlots(){
  const root=$('headerSlots');root.replaceChildren();
  state.slots.forEach((slot,index)=>{
    const card=document.createElement('div');card.className='header-slot';card.classList.toggle('active',index===state.active);card.classList.toggle('enabled',slot.enabled);
    const dot=document.createElement('button');dot.className='slot-enable';dot.textContent=slot.enabled?'✓':'';dot.title=slot.enabled?'停用槽位':'启用槽位';
    dot.onclick=e=>{e.stopPropagation();slot.enabled=!slot.enabled;persist();renderSlots();};
    const copy=document.createElement('div');copy.className='slot-copy';
    const name=document.createElement('strong');name.textContent=slot.name||'CUST';
    const sub=document.createElement('small');
    const factory=state.factoryRows.find(row=>row.key===slot.preset_key);
    sub.textContent=slot.user_preset_id?(state.users.get(slot.user_preset_id)?.name||'用户滤镜'):(factory?.label||'尚未选择预设');
    copy.append(name,sub);card.append(dot,copy);
    card.onclick=()=>{state.active=index;persist();refresh();};
    card.ondblclick=e=>{if(e.target===dot)return;const next=prompt('预设名称',slot.name||'CUST');if(next!==null&&next.trim()){slot.name=next.trim().slice(0,12);persist();renderSlots();refreshControls();}};
    root.appendChild(card);
  });
}
function renderMatrix(){
  const grid=$('matrixGrid');grid.replaceChildren();const reference=state.curveProfiles?.natural_matrix_q8||null;const shown=displayMatrix(currentSlot(),state.natural,reference);
  const corner=document.createElement('span');grid.appendChild(corner);
  ['r','g','b'].forEach((key,index)=>{const label=document.createElement('span');label.className='matrix-axis '+key;label.textContent=['R','G','B'][index];grid.appendChild(label);});
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    if(col===0){const label=document.createElement('span');label.className='matrix-axis '+['r','g','b'][row];label.textContent=['R','G','B'][row];grid.appendChild(label);}
    const input=document.createElement('input');input.type='number';input.step='1';input.min='-2048';input.max='2047';input.value=Math.round(shown[row][col]);
    input.className=row===col?'matrix-cell diagonal':'matrix-cell';
    input.onchange=()=>{
      const matrix=displayMatrix(currentSlot(),state.natural,reference),old=matrix[row][col],value=Math.max(-2048,Math.min(2047,Math.round(Number(input.value)||0)));
      matrix[row][col]=value;
      if(col===row){const other=(row+1)%3;matrix[row][other]-=value-old;}
      else matrix[row][row]=256-matrix[row].reduce((sum,v,c)=>c===row?sum:sum+Number(v),0);
      setDisplayMatrix(currentSlot(),state.natural,matrix,reference);currentSlot().colorBaseMatrix=currentSlot().matrix.map(r=>r.slice());currentSlot().color_hue=0;currentSlot().color_sat=1;
      persist();refreshControls();queueRender();
    };grid.appendChild(input);
  }
}
function curveFactoryBase(slot){return state.factorySlots.get(slot.preset_key)||state.natural;}
function curveView(){return relativeCurve(currentSlot(),state.natural,state.channel,state.curveProfiles,curveFactoryBase(currentSlot()));}
function drawCurve(){
  const canvas=$('curveCanvas'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,values=curveView();
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#111216';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#292b31';ctx.lineWidth=1;
  for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(w*i/4,0);ctx.lineTo(w*i/4,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}
  ctx.setLineDash([6,6]);ctx.strokeStyle='#666';ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(w,0);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
  const colors=['#d7d7de','#ef6767','#6fd58b','#6ba4ff'];ctx.strokeStyle=colors[state.channel];ctx.lineWidth=2.2;ctx.beginPath();
  values.forEach((v,i)=>{const x=i/(values.length-1)*w,y=h-Math.max(0,Math.min(1,v))*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
}
function refreshControls(){
  const slot=currentSlot();$('brightness').value=Number(slot.brightness_ev||0);$('brightnessVal').textContent=(slot.brightness_ev>=0?'+':'')+Number(slot.brightness_ev||0).toFixed(2)+' EV';
  $('contrast').value=Number(slot.contrast||0);$('contrastVal').textContent=String(Math.round(Number(slot.contrast||0)));
  $('saturation').value=Number(slot.color_sat??1);$('saturationVal').textContent=Number(slot.color_sat??1).toFixed(2)+' ×';
  $('hue').value=Number(slot.color_hue||0);$('hueVal').textContent=Math.round(Number(slot.color_hue||0))+'°';
  $('cameraModel').value=state.cameraModel;$('footerCamera').textContent=state.cameraModel==='k1'?'PENTAX K-1':'PENTAX K-1 II';
  $('footerFilter').textContent=slot.name||'CUST';
  $('lutModeBtn').classList.toggle('on',state.previewMode==='lut');$('cameraModeBtn').classList.toggle('on',state.previewMode==='camera');$('lutModeBtn').classList.toggle('disabled',!slot.sourceLut);
  $('chartBtn').classList.toggle('on',state.sourceMode==='chart');$('photoBtn').classList.toggle('on',state.sourceMode==='photo');
  $('toggleCompare').textContent=state.compareMode===0?'全显示':state.compareMode===1?'左右':'上下';
  $('channelTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('on',Number(b.dataset.channel)===state.channel));
  renderMatrix();drawCurve();
}
function refresh(){renderSlots();renderFilterList();refreshControls();queueRender();}
function applyPreset(identifier,factory){
  let selected=factory?state.factorySlots.get(identifier):state.users.get(identifier)?.slot;
  if(!selected)return;selected=cloneSlot(selected);if(!factory){const item=state.users.get(identifier);selected.sourceLut=item?.sourceLut||null;selected.user_preset_id=item.id;}
  selected.enabled=currentSlot().enabled;selected.camera_model=state.cameraModel;normalizeSlotShape(selected);
  state.slots[state.active]=selected;state.bases[state.active]=cloneSlot(selected);if(state.previewMode==='lut'&&!selected.sourceLut)state.previewMode='camera';persist();refresh();
}
async function deleteUser(id){
  const item=state.users.get(id);if(!item)return;await dbDelete(id);state.users.delete(id);
  state.slots.forEach((slot,i)=>{if(slot.user_preset_id===id){state.slots[i]=cloneSlot(state.natural);state.bases[i]=cloneSlot(state.natural);}});
  persist();refresh();notify('已删除用户滤镜：'+item.name);
}

function chartSource(){
  state.sourceName='内置色卡';state.sourceMode='chart';original.width=1200;original.height=660;const ctx=originalContext;ctx.fillStyle='#17191d';ctx.fillRect(0,0,1200,660);
  const patches=[[115,82,68],[194,150,130],[98,122,157],[87,108,67],[133,128,177],[103,189,170],[214,126,44],[80,91,166],[193,90,99],[94,60,108],[157,188,64],[224,163,46],[56,61,150],[70,148,73],[175,54,60],[231,199,31],[187,86,149],[8,133,161],[243,243,242],[200,200,200],[160,160,160],[122,122,121],[85,85,85],[52,52,52]];
  const margin=48,gap=14,cw=Math.floor((1200-margin*2-gap*5)/6),ch=104;
  patches.forEach((rgb,i)=>{ctx.fillStyle='rgb('+rgb.join(',')+')';ctx.fillRect(margin+(i%6)*(cw+gap),42+Math.floor(i/6)*(ch+gap),cw,ch);});
  const y=42+4*(ch+gap)+10,g=ctx.createLinearGradient(margin,0,1200-margin,0);g.addColorStop(0,'#000');g.addColorStop(1,'#fff');ctx.fillStyle=g;ctx.fillRect(margin,y,1200-margin*2,42);
  ctx.fillStyle='#98a2b2';ctx.font='15px sans-serif';ctx.fillText('PENTAX LABS · COLOR PREVIEW',margin,26);syncThumbnailSource();renderFilterList();refreshControls();queueRender();
}
async function loadPhoto(file){
  const bitmap=await createImageBitmap(file),factor=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));original.width=Math.max(1,Math.round(bitmap.width*factor));original.height=Math.max(1,Math.round(bitmap.height*factor));
  originalContext.clearRect(0,0,original.width,original.height);originalContext.drawImage(bitmap,0,0,original.width,original.height);bitmap.close();state.sourceName=file.name;state.sourceMode='photo';syncThumbnailSource();renderFilterList();refreshControls();queueRender();
}
function queueRender(){clearTimeout(renderTimer);renderTimer=setTimeout(renderPreview,24);}
function renderPreview(){
  if(!original.width||!state.natural||!currentSlot())return;preview.width=original.width;preview.height=original.height;
  if(state.comparing){previewContext.drawImage(original,0,0);return;}
  const image=originalContext.getImageData(0,0,original.width,original.height),px=image.data,slot=currentSlot(),direct=state.previewMode==='lut'&&slot.sourceLut,p=direct?null:prepareRelativeProxy(slot,state.natural);
  for(let i=0;i<px.length;i+=4){const rgb=[px[i]/255,px[i+1]/255,px[i+2]/255],out=direct?evaluateCube(slot.sourceLut,rgb):applyPreparedRelative(p,rgb);px[i]=Math.round(out[0]*255);px[i+1]=Math.round(out[1]*255);px[i+2]=Math.round(out[2]*255);}
  previewContext.putImageData(image,0,0);
  if(state.compareMode===1){
    const cut=Math.round(preview.width*state.split);previewContext.save();previewContext.beginPath();previewContext.rect(0,0,cut,preview.height);previewContext.clip();previewContext.drawImage(original,0,0);previewContext.restore();previewContext.fillStyle='#e7f0ff';previewContext.fillRect(cut-1,0,2,preview.height);
  }else if(state.compareMode===2){
    const cut=Math.round(preview.height*state.split);previewContext.save();previewContext.beginPath();previewContext.rect(0,0,preview.width,cut);previewContext.clip();previewContext.drawImage(original,0,0);previewContext.restore();previewContext.fillStyle='#e7f0ff';previewContext.fillRect(0,cut-1,preview.width,2);
  }
}
async function importFiles(files){
  const cubes=Array.from(files).filter(f=>/\.cube$/i.test(f.name));if(!cubes.length)return;
  for(const file of cubes){try{
    setStatus('拟合 LUT：'+file.name);await new Promise(r=>requestAnimationFrame(r));const cube=parseCube(await file.text(),file.name),fitted=fitCubeQuick(cube,state.natural,state.cameraModel),id=cube.id.replace('lut:','');
    fitted.user_preset_id=id;fitted.sourceLut=cube;normalizeSlotShape(fitted);const item={id,name:cube.name,slot:stripSource(fitted),sourceLut:cube,importedAt:Date.now()};
    state.users.set(id,item);await dbPut(item);state.slots[state.active]=cloneSlot(fitted);state.bases[state.active]=cloneSlot(fitted);state.tab='user';state.previewMode='camera';persist();notify('已导入「'+cube.name+'」 · MAE '+fitted.fit_report.rgb_mae_255.toFixed(2)+'/255');
  }catch(e){console.error(e);notify(file.name+'：'+(e.message||e));}}
  $('lutFile').value='';refresh();setStatus('就绪');
}
function resetCurrent(){const enabled=currentSlot().enabled;state.slots[state.active]=cloneSlot(currentBase());state.slots[state.active].enabled=enabled;if(state.previewMode==='lut'&&!currentSlot().sourceLut)state.previewMode='camera';persist();refresh();}

function applyColorFromControls(){
  const slot=currentSlot();slot.color_sat=Number($('saturation').value);slot.color_hue=Number($('hue').value);
  slot.matrix=applyColorControls(slot.colorBaseMatrix||slot.matrix,slot.color_sat,slot.color_hue);persist();refreshControls();queueRender();
}
function setInspector(name){
  document.querySelectorAll('.right-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.inspector===name));
  document.querySelectorAll('.inspector-pane').forEach(p=>p.classList.toggle('active',p.dataset.inspectorPane===name));
}
function normalizedEdit(values,fromIndex,toIndex,toValue){
  const out=values.slice(),start=Math.max(0,Math.min(out.length-1,Math.round(fromIndex))),end=Math.max(0,Math.min(out.length-1,Math.round(toIndex))),original=out[start];
  const steps=Math.max(1,Math.abs(end-start)),dir=end>=start?1:-1;
  for(let n=0;n<=steps;n++){const i=start+dir*n;out[i]=original+(toValue-original)*n/steps;}
  for(let i=1;i<out.length;i++)out[i]=Math.max(out[i],out[i-1]);return out.map(v=>Math.max(0,Math.min(1,v)));
}

async function ensureDirectoryPermission(handle){
  if(!handle)return false;
  const options={mode:'readwrite'};
  if((await handle.queryPermission?.(options))==='granted')return true;
  return (await handle.requestPermission?.(options))==='granted';
}
async function chooseSdRoot(){
  if(state.sdRoot&&await ensureDirectoryPermission(state.sdRoot))return state.sdRoot;
  if(!window.showDirectoryPicker)return null;
  const handle=await window.showDirectoryPicker({id:'pentax-labs-sd-root',mode:'readwrite'});
  if(!await ensureDirectoryPermission(handle))throw Error('没有目标目录写入权限');
  state.sdRoot=handle;await dbPut({id:'__sd_root_handle',type:'sd-root',handle});return handle;
}
async function writeFilesToDirectory(root,files){
  for(const [path,data] of Object.entries(files)){
    const parts=path.split('/').filter(Boolean);let dir=root;
    for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});
    const file=await dir.getFileHandle(parts.at(-1),{create:true}),writer=await file.createWritable();
    await writer.write(data instanceof Uint8Array?data:new TextEncoder().encode(String(data)));await writer.close();
  }
}
async function exportCameraScript(camera=state.cameraModel){
  try{
    const base=state.runtimeBases[camera];if(!base)throw Error('当前机型内置运行时尚未加载');
    const files=compileCameraScriptFiles(state.slots,camera,base);
    if(window.showDirectoryPicker){
      const root=await chooseSdRoot();await writeFilesToDirectory(root,files);
      const label=/dcram/i.test(root.name||'')?'DCRAM SD卡':(root.name||'所选目录');
      setStatus('脚本已写入 '+label+' 根目录');notify('已直接写入 '+label+' /script');return;
    }
    downloadBlob(`PentaxLabs_${camera==='k1'?'K1':'K1II'}_script.zip`,compileCameraScript(state.slots,camera,base),'application/zip');
    notify('当前浏览器不支持目录直写，已下载 script ZIP');
  }catch(e){if(e?.name==='AbortError')return;notify(e.message||String(e));}
}

function engineeringModels(){return state.engineeringPayload?.filters||[];}
function variantLabel(v){
  const labels={entry:'工程模式入口',script_enable:'启用脚本模式',script_disable:'关闭脚本模式',probe:'脚本探测'};
  if(v.action==='activate')return '启用四季 '+v.mask;if(v.action==='clear')return '关闭四季 '+v.mask;return labels[v.action]||v.action;
}
function setupEngineering(){
  const model=$('engineeringModel');model.replaceChildren();engineeringModels().forEach((m,i)=>model.add(new Option(m.model,String(i))));
  model.onchange=refreshEngineering;refreshEngineering();
  const season=$('seasonModel');season.replaceChildren();engineeringModels().forEach((m,i)=>season.add(new Option(m.model,String(i))));season.value='1';season.onchange=refreshSeason;refreshSeason();
}
function refreshEngineering(){
  const m=engineeringModels()[Number($('engineeringModel').value)||0],variants=(m?.variants||[]).filter(v=>['entry','script_enable','script_disable'].includes(v.action));
  const select=$('engineeringVariant');select.replaceChildren();variants.forEach((v,i)=>select.add(new Option(variantLabel(v),String(i))));select._variants=variants;
  $('engineeringTitle').textContent=m?.model||'—';$('engineeringTutorial').textContent='工程文件来自 Pentax Labs 当前 engineering_payload。\n选择入口后导出 ZIP，解压到 SD 根目录使用；网页不会修改照片或其他文件。';
}
function exportEngineering(){
  const variants=$('engineeringVariant')._variants||[],v=variants[Number($('engineeringVariant').value)||0];if(!v)return;
  const files={};for(const [name,b64] of Object.entries(v.files||{}))files[name]=base64Bytes(b64);downloadBlob('PentaxLabs_'+engineeringModels()[Number($('engineeringModel').value)||0].model+'_Engineering.zip',zipStore(files),'application/zip');
}
function refreshSeason(){
  const m=engineeringModels()[Number($('seasonModel').value)||0],trigger=(m?.variants||[]).find(v=>v.action==='script_enable'),activate=(m?.variants||[]).find(v=>v.action==='activate'&&Number(v.mask)===15);
  $('seasonInfo').textContent=m?`${m.model} · 工程触发：${Object.keys(trigger?.files||{}).filter(x=>x!=='DEVELOP.MOD').join('、')||'—'} · 四季 startup.ttl：${activate?'已归档':'缺失'}`:'—';
}
function exportSeason(){
  const m=engineeringModels()[Number($('seasonModel').value)||0],first=(m?.variants||[]).find(v=>v.action==='script_enable'),second=(m?.variants||[]).find(v=>v.action==='activate'&&Number(v.mask)===15);
  if(!first||!second)return notify('当前机型缺少完整四季数据');
  const files={};for(const [name,b64] of Object.entries(first.files||{}))files[name]=base64Bytes(b64);for(const [name,b64] of Object.entries(second.files||{}))files[name]=base64Bytes(b64);
  files['使用说明.txt']='Pentax Labs 四季滤镜\n第一次开机：通过工程触发尝试启用 Script Mode；正常关机。\n第二次开机：保持同一张卡正常开机，执行 script/startup.ttl。\n';
  downloadBlob('PentaxLabs_'+m.model+'_FourSeasons.zip',zipStore(files),'application/zip');
}

async function exportIstdFirmware(){
  try{
    let response=await fetch('./assets/istd_chinese.bin',{cache:'no-cache'});
    if(!response.ok)response=await fetch('../app/lab_assets/istd_chinese.bin',{cache:'no-cache'});
    if(!response.ok)throw Error('中文固件资源加载失败');
    const data=new Uint8Array(await response.arrayBuffer());
    if(window.showSaveFilePicker){
      const handle=await window.showSaveFilePicker({suggestedName:'FWDC112B.BIN',types:[{description:'PENTAX Firmware',accept:{'application/octet-stream':['.BIN']}}]});
      const writer=await handle.createWritable();await writer.write(data);await writer.close();notify('已保存 FWDC112B.BIN');return;
    }
    downloadBlob('FWDC112B.BIN',data,'application/octet-stream');
  }catch(e){if(e?.name!=='AbortError')notify(e.message||String(e));}
}

async function loadCpPhoto(file){
  const bitmap=await createImageBitmap(file),factor=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));cpOriginal.width=Math.max(1,Math.round(bitmap.width*factor));cpOriginal.height=Math.max(1,Math.round(bitmap.height*factor));cpOriginalCtx.drawImage(bitmap,0,0,cpOriginal.width,cpOriginal.height);bitmap.close();state.cpOriginal=file.name;state.cpNeutral=[1,1,1];renderCp();
}
function cpValues(){return {ev:Number($('cpExposure').value),contrast:Number($('cpContrast').value)/100,sat:Number($('cpSat').value)/100,hi:Number($('cpHighlights').value)/100,sh:Number($('cpShadows').value)/100};}
function renderCp(){
  if(!state.cpOriginal)return;const canvas=$('cpCanvas');canvas.width=cpOriginal.width;canvas.height=cpOriginal.height;const ctx=canvas.getContext('2d'),img=cpOriginalCtx.getImageData(0,0,cpOriginal.width,cpOriginal.height),px=img.data,v=cpValues(),gain=2**v.ev;
  for(let i=0;i<px.length;i+=4){
    let r=px[i]/255*state.cpNeutral[0],g=px[i+1]/255*state.cpNeutral[1],b=px[i+2]/255*state.cpNeutral[2];r*=gain;g*=gain;b*=gain;
    const lum=.2126*r+.7152*g+.0722*b,contrast=1+v.contrast,shadowBoost=(1-lum)*v.sh*.45,highBoost=lum*v.hi*.35;
    r=(r-.5)*contrast+.5+shadowBoost+highBoost;g=(g-.5)*contrast+.5+shadowBoost+highBoost;b=(b-.5)*contrast+.5+shadowBoost+highBoost;
    const l=.2126*r+.7152*g+.0722*b,s=1+v.sat;r=l+(r-l)*s;g=l+(g-l)*s;b=l+(b-l)*s;
    px[i]=Math.round(Math.max(0,Math.min(1,r))*255);px[i+1]=Math.round(Math.max(0,Math.min(1,g))*255);px[i+2]=Math.round(Math.max(0,Math.min(1,b))*255);
  }
  ctx.putImageData(img,0,0);$('cpEmpty').style.display='none';
}
function neutralizeCp(){
  if(!state.cpOriginal)return;const img=cpOriginalCtx.getImageData(0,0,cpOriginal.width,cpOriginal.height).data;let sums=[0,0,0],n=0;
  for(let i=0;i<img.length;i+=16){sums[0]+=img[i];sums[1]+=img[i+1];sums[2]+=img[i+2];n++;}
  const avg=sums.map(x=>x/n),gray=(avg[0]+avg[1]+avg[2])/3;state.cpNeutral=avg.map(v=>gray/Math.max(v,1));renderCp();
}
function installEvents(){
  $('navToggle').onclick=openNav;$('navMask').onclick=closeNav;$('homeBtn').onclick=()=>goPage('filters');
  $('factoryTab').onclick=()=>{state.tab='factory';persist();renderFilterList();};$('userTab').onclick=()=>{state.tab='user';persist();renderFilterList();};$('filterSearch').oninput=renderFilterList;
  $('refreshBtn').onclick=renderFilterList;
  $('importBtn').onclick=()=>$('lutFile').click();$('lutFile').onchange=e=>importFiles(e.target.files);$('photoBtn').onclick=()=>$('photoFile').click();$('photoFile').onchange=async e=>{if(e.target.files[0])try{await loadPhoto(e.target.files[0]);}catch(x){notify('照片读取失败：'+x.message);}e.target.value='';};
  $('chartBtn').onclick=chartSource;
  $('cameraModel').onchange=()=>{state.cameraModel=$('cameraModel').value==='k1'?'k1':'k1ii';state.slots.forEach(s=>s.camera_model=state.cameraModel);state.bases.forEach(s=>s.camera_model=state.cameraModel);persist();refreshControls();};
  $('brightness').oninput=()=>{currentSlot().brightness_ev=Number($('brightness').value);refreshControls();persist();queueRender();};$('contrast').oninput=()=>{currentSlot().contrast=Number($('contrast').value);refreshControls();persist();queueRender();};
  $('saturation').oninput=applyColorFromControls;$('hue').oninput=applyColorFromControls;
  $('resetBasicBtn').onclick=()=>{const slot=currentSlot();slot.brightness_ev=0;slot.contrast=0;slot.color_sat=1;slot.color_hue=0;slot.matrix=(slot.colorBaseMatrix||slot.matrix).map(r=>r.slice());persist();refreshControls();queueRender();};
  $('resetMatrixBtn').onclick=()=>{const slot=currentSlot(),base=currentBase();slot.matrix=base.matrix.map(r=>r.slice());slot.colorBaseMatrix=slot.matrix.map(r=>r.slice());slot.color_sat=1;slot.color_hue=0;persist();refreshControls();queueRender();};
  document.querySelectorAll('.right-tabs button').forEach(b=>b.onclick=()=>setInspector(b.dataset.inspector));
  $('channelTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.channel=Number(b.dataset.channel);refreshControls();});
  $('resetCurveBtn').onclick=()=>{const slot=currentSlot(),base=currentBase();if(state.channel===0)slot.masterCurve=base.masterCurve.slice();else slot.curves[state.channel-1]=base.curves[state.channel-1].slice();persist();drawCurve();queueRender();};
  $('linearCurveBtn').onclick=()=>{const before=curveView(),target=state.curveProfiles.axis.slice();applyRelativeCurve(currentSlot(),state.natural,state.channel,target,before,state.curveProfiles);persist();drawCurve();queueRender();};
  $('addCurvePointBtn').onclick=()=>notify('曲线可直接拖动；双击位置会作为新的编辑锚点');
  const curve=$('curveCanvas'),pos=e=>{const r=curve.getBoundingClientRect();return {index:Math.max(0,Math.min(256,(e.clientX-r.left)/r.width*256)),value:Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height))};};
  curve.onpointerdown=e=>{curve.setPointerCapture(e.pointerId);curvePointer={...pos(e),display:curveView(),native:state.channel===0?currentSlot().masterCurve.slice():currentSlot().curves[state.channel-1].slice()};};
  curve.onpointermove=e=>{if(!curvePointer||!curve.hasPointerCapture(e.pointerId))return;const next=pos(e),target=normalizedEdit(curvePointer.display,curvePointer.index,next.index,next.value);if(state.channel===0)currentSlot().masterCurve=curvePointer.native.slice();else currentSlot().curves[state.channel-1]=curvePointer.native.slice();applyRelativeCurve(currentSlot(),state.natural,state.channel,target,curvePointer.display,state.curveProfiles);drawCurve();queueRender();};
  const endCurve=e=>{if(curve.hasPointerCapture(e.pointerId))curve.releasePointerCapture(e.pointerId);curvePointer=null;persist();};curve.onpointerup=endCurve;curve.onpointercancel=endCurve;
  $('cameraModeBtn').onclick=()=>{state.previewMode='camera';refreshControls();queueRender();};$('lutModeBtn').onclick=()=>{if(!currentSlot().sourceLut)return notify('当前滤镜没有保留原始 CUBE');state.previewMode='lut';refreshControls();queueRender();};
  $('toggleCompare').onclick=()=>{state.compareMode=(state.compareMode+1)%3;persist();refreshControls();queueRender();};
  $('exportScriptBtn').onclick=()=>exportCameraScript();
  $('engineeringExportBtn').onclick=exportEngineering;$('seasonExportBtn').onclick=exportSeason;
  $('cpPhotoBtn').onclick=()=>$('cpPhotoFile').click();$('cpPhotoFile').onchange=async e=>{if(e.target.files[0])await loadCpPhoto(e.target.files[0]);e.target.value='';};
  for(const id of ['cpExposure','cpContrast','cpSat','cpHighlights','cpShadows'])$(id).oninput=()=>{const map={cpExposure:'cpExposureVal',cpContrast:'cpContrastVal',cpSat:'cpSatVal',cpHighlights:'cpHighlightsVal',cpShadows:'cpShadowsVal'};$(map[id]).textContent=Number($(id).value).toFixed(id==='cpExposure'?2:0);renderCp();};
  $('cpNeutralBtn').onclick=neutralizeCp;$('cpExportBtn').onclick=()=>{if(!state.cpOriginal)return notify('请先选择照片');$('cpCanvas').toBlob(blob=>downloadBlob('PentaxLabs_CP.png',blob,'image/png'),'image/png');};
  $('firmwareExportBtn').onclick=exportIstdFirmware;
  $('afOffset').oninput=()=>{$('afValue').textContent=(Number($('afOffset').value)>=0?'+':'')+$('afOffset').value;};$('afExportBtn').onclick=()=>downloadBlob('PentaxLabs_istD_AF.zip',buildFocusZip(Number($('afOffset').value)),'application/zip');
  const stage=$('photoStage');stage.ondragover=e=>{e.preventDefault();stage.classList.add('drag-over');};stage.ondragleave=()=>stage.classList.remove('drag-over');stage.ondrop=async e=>{e.preventDefault();stage.classList.remove('drag-over');const files=Array.from(e.dataTransfer.files),cubes=files.filter(f=>/\.cube$/i.test(f.name));if(cubes.length)await importFiles(cubes);const photo=files.find(f=>f.type.startsWith('image/'));if(photo)await loadPhoto(photo);};
}

async function start(){
  installEvents();
  try{
    setStatus('加载 beta80 Web');await loadLibraries();initializeSlots();
    const [k1iiRuntime,k1Runtime]=await Promise.all([loadBuiltinRuntime('k1ii'),loadBuiltinRuntime('k1')]);
    state.runtimeBases.k1ii=k1iiRuntime;state.runtimeBases.k1=k1Runtime;
    const hash=location.hash.replace(/^#/,'');if(FEATURES.some(x=>x[0]===hash))state.currentPage=hash;
    $('cameraModel').value=state.cameraModel;chartSource();setupEngineering();refresh();goPage(state.currentPage);persist();
    try{
      state.db=await openDatabase();for(const item of await dbAll()){
        if(item?.type==='sd-root'&&item.handle)state.sdRoot=item.handle;
        else if(item?.id&&item.slot)state.users.set(item.id,item);
      }
      hydrateUserSources();refresh();persist();
    }catch(e){console.warn('IndexedDB unavailable',e);notify('浏览器持久存储不可用，本次会话仍可使用');}
    let ready='就绪 · beta80 Web';
    if(state.sdRoot&&await state.sdRoot.queryPermission?.({mode:'readwrite'})==='granted')
      ready+=' · SD '+(/dcram/i.test(state.sdRoot.name||'')?'DCRAM':(state.sdRoot.name||''));
    setStatus(ready);
  }catch(e){console.error(e);setStatus('初始化失败');notify(e.message||String(e));}
}
start();
