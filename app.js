import {
  WHITE, cloneSlot, slotFromFactory, parseCube, evaluateCube, fitCubeQuick, normalizeRows,
  prepareRelativeProxy, applyPreparedRelative, displayMatrix, setDisplayMatrix,
  relativeCurve, applyRelativeCurve, applyColorControls, configureDisplayKernel, adaptSlotToIstd,
  canonicalNaturalSlot,
} from './engine.js';
import {
  loadBuiltinRuntime, readRuntimeFiles, validateR367, compileCameraScript, compileCameraScriptFiles, compileIstdFiles,
  buildFocusZip, buildFocusFiles, base64Bytes, zipStore,
} from './runtime.js';
import {LANGUAGE_OPTIONS, resolveLanguage, tr as i18nTr} from './i18n.js';

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
  curveProfiles:null,engineeringPayload:null,cpNative:null,users:new Map(),db:null,tab:'factory',
  active:0,cameraModel:'k1ii',previewMode:'camera',slots:[],bases:[],channel:0,
  comparing:false,compareMode:0,split:.5,sourceName:'内置色卡',sourceMode:'chart',
  runtimeBases:{k1:null,k1ii:null},sdRoot:null,
  curveAnchors:Array.from({length:3},()=>Array.from({length:4},()=>[])),curveAddMode:false,
  curveDisplays:Array.from({length:3},()=>Array.from({length:4},()=>null)),
  cpOriginal:null,cpMode:'random',cpBaseIndex:5,cpControls:[0,0,4,-3,-2],cpCurves:'210',
  language:'system',accent:'#3178DF',settingsPage:'language',cpInspector:'basic',
};
const original=document.createElement('canvas');
const originalContext=original.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
const preview=$('previewCanvas'), previewContext=preview.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
const thumbOriginal=document.createElement('canvas'),thumbOriginalContext=thumbOriginal.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
const cpOriginal=document.createElement('canvas'), cpOriginalCtx=cpOriginal.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
let renderTimer=0,toastTimer=0,curvePointer=null,curveLastTap=null,curveHoverIndex=-1;
let thumbRevision=0;
const thumbCache=new Map();
const originalText=new WeakMap();
const ACCENTS=['#3178DF','#4E89B1','#A0A0A8','#56AA91','#AA80C7','#C18A5D'];
const GUIDE_SECTIONS=[
  ['基础操作','左侧单击原厂滤镜，将其应用到当前顶部滤镜槽。顶部有三个可独立启用的槽；单击槽位切换当前编辑对象，勾选圆点决定该槽是否导出。右侧“色彩矩阵 / 通道曲线”只编辑当前槽。底部相机型号决定最终导出格式，*ist D 与 K-1/K-1 II 的参数结构不同。','Basic Controls','Click a factory filter on the left to apply it to the active top slot. The three top slots can be enabled independently; click a slot to edit it and use the round check control to include or exclude it from export. Color Matrix and Tone Curves affect only the active slot. The camera model at the bottom determines the final export format; *ist D uses a different parameter structure from K-1/K-1 II.'],
  ['滤镜管理与重命名','用户滤镜由导入 .cube 产生并保存在浏览器本地。用户滤镜可删除，顶部槽位名称可双击修改。左侧缩略图始终使用当前色卡或当前照片同步渲染，因此换照片后整列预览会一起更新。刷新按钮只重绘列表，不会重新拟合或修改参数。','Filters & Renaming','User filters are created by importing .cube files and are stored locally in the browser. User filters can be deleted and top-slot names can be renamed by double-clicking. Left-side thumbnails always render from the current chart or photo, so the whole list updates when the preview photo changes. Refresh only redraws the list; it does not refit or modify parameters.'],
  ['LUT 导入与导出','导入 .cube 后，K-1 II 使用 R369 原生 Matrix/Gamma 拟合；K-1 与 *ist D 保留各自的 P317 显示域路线。R369 Web 与桌面共享 12k Natural 相机校准样本、原生矩阵基底和暗部加权目标；浏览器使用 JS 分块优化器，桌面使用 SciPy 优化器，因此矩阵可逐项一致，Gamma 仍允许小幅数值差异。软件评分是模型预测，不等同于机内 JPEG 实拍色差。复杂 3D LUT 受机内参数自由度限制，不能保证无损还原。','LUT Import & Export','Imported .cube files use the R369 native Matrix/Gamma model on K-1 II; original K-1 and *ist D retain their P317 display-domain paths. Web and desktop share the 12k Natural camera-calibration samples, native matrix basis and dark-aware objective. The browser uses a JavaScript block optimizer while desktop uses SciPy, so Q8 matrices match while small Gamma-value differences may remain. Software scores are model predictions, not measured in-camera JPEG errors. Complex 3D LUTs cannot always be reproduced losslessly with the camera parameter surface.'],
  ['色彩矩阵与 Gamma 曲线','以 Natural 为相对基准。曲线显示采用和桌面端相同的“平滑意图”模型：原厂 256 个物理节点不会直接变成 256 个可见控制点，默认只显示黑白端点。像 Lightroom 一样单击曲线添加控制点，并在同一次拖动中调整；已有点有更大的触控命中范围。Alt+拖动曲线主体可做大范围平滑形变；“加点”可在图表任意位置创建节点，右键删除，触屏双击节点删除。后台仍把相对变化写回原有 256 点机内 Gamma。','Color Matrix & Gamma Curves','Natural is the relative reference. The curve uses the same smooth-intent model as desktop: the 256 physical factory nodes are not exposed as 256 visible handles, and only black/white endpoints appear by default. Like Lightroom, click the curve to add a control point and keep dragging in the same gesture; handles have generous touch targets. Alt-drag the curve body for broad smooth shaping, or use Add point anywhere in the graph. Right-click removes a point; double-tap removes one on touchscreens. Relative changes still map back to the original 256 camera Gamma nodes.'],
  ['照片预览与对比','网页启动默认显示色卡。单击“照片”选择本地 JPG/PNG/WebP/AVIF，照片只在浏览器本地解码，不会上传；左侧滤镜缩略图与主预览使用同一张照片。LUT/机内切换用于比较原始 CUBE 与拟合后的机内参数；对比按钮依次切换全显示、左右、上下。照片区域仍支持把 .cube 或照片直接拖入，但不再显示常驻遮挡提示。','Photo Preview & Compare','The web app starts with the color chart. Photo opens a local JPG/PNG/WebP/AVIF and never uploads it; left-side filter thumbnails use the same source as the main preview. LUT/Camera compares the original CUBE with the fitted camera parameters, while Compare cycles Full, Left/Right and Top/Bottom. The photo area still accepts dragged .cube files or photos, but the permanent overlay hint has been removed.'],
  ['相机脚本导出与注意事项','自定义滤镜页底部选择真实相机型号。K-1 II 使用独立 P286 运行时，K-1 使用独立 R29 运行时；两者都导出 Natural 相对矩阵映射后的 Q8/Q13 与三路 U14。*ist D 使用 signed10 Q8 3×3 Matrix 加一条共享 4096 点 U8 Gamma，所以复杂彩色 LUT 的理论误差可能明显更高。每次点击导出都会先让你选择 SD 卡根目录或测试目录，再直接写入。','Camera Script Export & Notes','Choose the real camera model at the bottom of Custom Filters. K-1 II uses its own P286 runtime and K-1 uses the separate R29 runtime; both export Natural-relative matrix mapping as Q8/Q13 plus three U14 channels. *ist D uses a signed10 Q8 3×3 Matrix plus one shared 4096-node U8 Gamma, so complex color LUTs can have higher model error. Every export first asks for the SD-card root or a test folder and then writes directly.'],
  ['正负逆冲','正负逆冲右侧分成“色彩调节”和“通道曲线”两页。色彩调节页选择 Random/Extended 模式与原厂矩阵基底，并调整饱和度、色相、影调、对比度和锐度；矩阵数值由原厂数据在内部参与处理，页面不显示也不提供矩阵编辑。通道曲线页同时显示 R/G/B 三路完整 ROM 曲线，下方分别选择各通道的 0、1、2 曲线编号。Random 模式要求三个编号互不重复，预览与 10B 导出按同一原厂配方模型处理。','Cross Processing','Cross Processing has separate Color Adjustments and Tone Curves pages. Color selects Random/Extended mode and an OEM matrix base, then adjusts saturation, hue, tone, contrast and sharpness. The OEM matrix remains internal to the rendering pipeline; no matrix editor or matrix-value panel is shown. Tone Curves displays all three R/G/B ROM curves simultaneously, with independent 0/1/2 selectors below each channel. Random mode requires three different indices. Preview and 10-byte export use the same factory recipe model.'],
  ['工程模式与四季滤镜','工程模式独立展示完整 36 款机型，保留各机型的按键教程、固件方案和 Service / Factory 入口；只有存在文件的方案才允许导出。四季滤镜独立使用 4 款已适配机型，采用“一次写卡、两次开机”：第一次启用 Script Mode 后正常关机；第二次保持同一张卡正常开机，执行 script/startup.ttl，再到机内菜单检查四季滤镜。','Service Mode & Four Seasons','Service Mode has its own complete 36-model catalog, including button-sequence tutorials, firmware variants and Service / Factory entries. Export is enabled only for variants that contain files. Four Seasons uses a separate list of its four supported models and a one-card, two-boot flow: enable Script Mode and shut down on the first boot; keep the same card inserted on the second boot, run script/startup.ttl, then check the camera menu.'],
  ['*ist D 工具箱','*ist D 工具箱包含 Firmware 1.12 中文固件和 AF Fine Adjustment。中文固件固定命名 FWDC112B.BIN；调焦范围 −64～+64，默认 +32，生成 KB321.EEP 与 MODSET.TXT。两项都使用“选择目录后直接写入”的流程。*ist D 自定义滤镜的 Matrix/Gamma 能力与 K-1/K-1 II 不同，不能用后三者的三路 Gamma 精度去要求它。','*ist D Toolbox','The *ist D toolbox contains the Chinese Firmware 1.12 file and AF Fine Adjustment. Firmware is always named FWDC112B.BIN; AF adjustment ranges from −64 to +64 with +32 as the default and generates KB321.EEP plus MODSET.TXT. Both use direct folder export. *ist D custom-filter Matrix/Gamma capability differs from K-1/K-1 II and should not be judged against their three independent Gamma channels.'],
  ['导出目录与浏览器权限','自定义滤镜、工程模式、四季滤镜、*ist D 固件和调焦文件都以“选择目录后直接写入”为主流程。通常直接选择相机 SD 卡根目录，也可以先选任意测试目录。浏览器安全模型不允许网页静默枚举 Windows 盘符或卷标，所以第一次及每次主动导出都会打开系统目录选择器；上次目录只作为起始位置。浏览器不支持 File System Access API 时才回退 ZIP/下载。不要把 script 子目录本身当作 SD 根目录。','Export Folders & Browser Permissions','Custom filters, Service Mode, Four Seasons, *ist D firmware and AF files all use direct folder export as the primary workflow. Normally choose the camera SD-card root, or use a test folder first. Browser security prevents a web page from silently enumerating Windows drive letters or volume labels, so every explicit export opens the system folder picker; the previous folder is only used as the starting location. ZIP/download is only the fallback when the File System Access API is unavailable. Do not select the script subfolder itself as the SD-card root.'],
];

function currentSlot(){return state.slots[state.active];}
function currentBase(){return state.bases[state.active];}
function tr(zh,fallback){return i18nTr(zh,state.language,fallback);}
function safeName(value){return String(value||'PentaxLabs').replace(/[\\/:*?"<>|]+/g,'_').slice(0,72);}
function downloadBlob(filename,data,type='application/octet-stream'){
  const blob=data instanceof Blob?data:new Blob([data],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function notify(message){const t=$('toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),2800);}
function setStatus(message){$('footerStatus').textContent=message;if($('headerStatus'))$('headerStatus').textContent=message;}
function translateStatic(root=document.body){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.parentElement||['SCRIPT','STYLE','CANVAS'].includes(node.parentElement.tagName))return NodeFilter.FILTER_REJECT;
    return node.nodeValue.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
  }});
  let node;while((node=walker.nextNode())){
    let source=originalText.get(node);if(source===undefined){source=node.nodeValue;originalText.set(node,source);}
    const m=source.match(/^(\s*)(.*?)(\s*)$/s),key=m?.[2]?.trim();if(!key)continue;
    node.nodeValue=(m?.[1]||'')+tr(key)+(m?.[3]||'');
  }
  const search=$('filterSearch');if(search)search.placeholder=tr('搜索滤镜名称…','Search filters…');
  if($('settingsBtn')){$('settingsBtn').title=tr('设置','Settings');$('settingsBtn').setAttribute('aria-label',tr('设置','Settings'));}
}
function renderGuide(){
  const root=$('guideList');if(!root)return;root.replaceChildren();
  GUIDE_SECTIONS.forEach(([title,body,titleEn,bodyEn],index)=>{
    const item=document.createElement('div');item.className='guide-item';
    const button=document.createElement('button'),label=document.createElement('b'),arrow=document.createElement('span'),copy=document.createElement('p');
    label.textContent=tr(title,titleEn);arrow.textContent='+';copy.textContent=tr(body,bodyEn);button.append(label,arrow);item.append(button,copy);
    button.onclick=()=>{item.classList.toggle('open');arrow.textContent=item.classList.contains('open')?'−':'+';};root.appendChild(item);
  });
}
function renderSettings(){
  document.documentElement.lang=resolveLanguage(state.language);
  document.documentElement.style.setProperty('--accent',state.accent);
  const select=$('languageSelect');if(select){select.replaceChildren();LANGUAGE_OPTIONS.forEach(([value,label])=>select.add(new Option(value==='system'?tr('自动（浏览器）','Auto (Browser)'):label,value)));select.value=state.language;}
  const accents=$('accentRow');if(accents){
    accents.replaceChildren();
    ACCENTS.forEach(value=>{const b=document.createElement('button');b.className='accent-choice';b.classList.toggle('on',value.toLowerCase()===state.accent.toLowerCase());b.style.setProperty('--swatch',value);b.innerHTML='<i></i>';b.onclick=()=>{state.accent=value;persist();renderSettings();};accents.appendChild(b);});
    const custom=document.createElement('button');custom.className='accent-choice accent-custom';custom.title=tr('自定义强调色','Custom accent color');
    const picker=document.createElement('input');picker.type='color';picker.value=/^#[0-9a-f]{6}$/i.test(state.accent)?state.accent:'#3178DF';picker.tabIndex=-1;
    picker.oninput=()=>{state.accent=picker.value.toUpperCase();persist();renderSettings();};custom.onclick=()=>picker.click();custom.appendChild(picker);accents.appendChild(custom);
  }
  document.querySelectorAll('[data-settings-page]').forEach(b=>b.classList.toggle('on',b.dataset.settingsPage===state.settingsPage));
  document.querySelectorAll('[data-settings-pane]').forEach(p=>p.classList.toggle('active',p.dataset.settingsPane===state.settingsPage));
  const titles={language:'语言 / 主题',guide:'使用指南',about:'关于'};if($('settingsPageTitle'))$('settingsPageTitle').textContent=tr(titles[state.settingsPage]);
  if($('settingsClose'))$('settingsClose').setAttribute('aria-label',tr('关闭','Close'));
  renderGuide();translateStatic($('settingsOverlay')||document.body);
}
function applyLanguage(){renderNav();renderFilterList();renderSlots();refreshControls();renderCpUi();refreshEngineering();refreshSeason();translateStatic(document.body);renderSettings();}
function openSettings(){$('settingsOverlay').hidden=false;renderSettings();}
function closeSettings(){$('settingsOverlay').hidden=true;}
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
    compareMode:state.compareMode,language:state.language,accent:state.accent,cpInspector:state.cpInspector,
    curveAnchors:state.curveAnchors,curveDisplays:state.curveDisplays,
    slots:state.slots.map(stripSource),bases:state.bases.map(stripSource)
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
async function fetchBytes(candidates,label){
  let last=null;
  for(const url of candidates){try{const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('HTTP '+r.status);return new Uint8Array(await r.arrayBuffer());}catch(e){last=e;}}
  throw Error('无法读取'+label+'：'+(last?.message||'unknown'));
}
async function loadLibraries(){
  const [factory,profiles,engineering,displayKernel,istdNatural,cpNative,releaseInfo]=await Promise.all([
    fetchJson(['./assets/factory_lut_families.json','../app/core/assets/factory_lut_families.json'],'原厂滤镜库'),
    fetchJson(['./assets/relative_curve_profiles.json'],'相对曲线基准'),
    fetchJson(['./assets/engineering_payload.json','../app/lab_assets/engineering_payload.json'],'工程模式数据'),
    fetchJson(['./assets/display_kernel.json'],'桌面预览内核'),
    fetchBytes(['./assets/istd_natural4096.bin','../app/core/assets/istd_natural4096.bin'],'*ist D Natural Gamma'),
    fetchJson(['./assets/cp_native.json'],'正负逆冲 ROM 数据'),
    fetchJson(['./version.json'],'版本信息').catch(()=>({})),
  ]);
  const family=factory.families?.k12;if(!family?.filters)throw Error('K12 原厂滤镜库格式不正确');
  state.family=family;state.factoryRows=family.filters;state.factorySlots.clear();
  family.filters.forEach(row=>state.factorySlots.set(row.key,slotFromFactory(row,state.cameraModel)));
  const naturalRow=family.filters.find(row=>row.local_key==='natural');if(!naturalRow)throw Error('原厂滤镜库缺少 Natural');
  configureDisplayKernel(displayKernel,istdNatural);
  state.natural=slotFromFactory(naturalRow,state.cameraModel);state.curveProfiles=profiles;state.engineeringPayload=engineering;state.cpNative=cpNative;
  $('familyLabel').textContent=family.label||'K12';
  const download=$('desktopDownloadBtn');
  if(download){download.textContent=tr('下载桌面版','Download Desktop');if(releaseInfo.desktop_download_url)download.href=releaseInfo.desktop_download_url;}
}
function initializeSlots(){
  const restored=restoreLocal();
  if(restored){
    state.currentPage=FEATURES.some(x=>x[0]===restored.currentPage)?restored.currentPage:'filters';
    state.active=Math.max(0,Math.min(2,Number(restored.active)||0));
    state.cameraModel=['istd','k1','k1ii'].includes(restored.cameraModel)?restored.cameraModel:'k1ii';state.tab=restored.tab==='user'?'user':'factory';
    state.compareMode=Math.max(0,Math.min(2,Number(restored.compareMode)||0));
    state.language=LANGUAGE_OPTIONS.some(([value])=>value===restored.language)?restored.language:'system';
    state.accent=/^#[0-9a-f]{6}$/i.test(restored.accent||'')?restored.accent:'#3178DF';
    state.cpInspector=restored.cpInspector==='curve'?'curve':'basic';
    if(Array.isArray(restored.curveAnchors)&&restored.curveAnchors.length===3)state.curveAnchors=restored.curveAnchors;
    if(Array.isArray(restored.curveDisplays)&&restored.curveDisplays.length===3)state.curveDisplays=restored.curveDisplays;
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

const R369_WEB_PROFILE='R369-k1ii-native-darkaware-js-block-v1';
const P317_WEB_PROFILE='P317-display-relative-darkaware-web';
function userFitIsCurrent(slot,model){
  const profile=model==='k1ii'?R369_WEB_PROFILE:P317_WEB_PROFILE;
  return slot?.camera_model===model&&slot?.fit_report?.fit_profile===profile;
}
function fitUserItemForCamera(item,model,force=false){
  if(!item?.sourceLut){
    let fallback=cloneSlot(item?.slot||state.natural);
    if(model==='istd'&&fallback.camera_model!=='istd')fallback=adaptSlotToIstd(fallback,state.natural);
    else if(fallback.camera_model&&fallback.camera_model!==model){fallback=cloneSlot(state.natural);fallback.name=item?.slot?.name||item?.name||'CUST';}
    fallback.camera_model=model;fallback.user_preset_id=item?.id||fallback.user_preset_id;return fallback;
  }
  if(!force&&userFitIsCurrent(item.slot,model))return {...cloneSlot(item.slot),sourceLut:item.sourceLut,user_preset_id:item.id};
  const fitModel=model==='istd'?'k1':model;
  let fitted=fitCubeQuick(item.sourceLut,canonicalNaturalSlot(fitModel),fitModel);
  if(model==='istd')fitted=adaptSlotToIstd(fitted,state.natural);
  fitted.name=String(item.slot?.name||item.name||fitted.name||'CUST').trim().slice(0,12);
  fitted.user_preset_id=item.id;fitted.sourceLut=item.sourceLut;
  item.slot=stripSource(fitted);item.fit_camera_model=model;
  return fitted;
}
function mergeRefittedSlot(newBase,oldBase,active){
  const merged=cloneSlot(newBase),reference=state.curveProfiles?.natural_matrix_q8||null;
  const display=(slot,matrix)=>displayMatrix({...slot,matrix},state.natural,reference);
  const addDisplayDelta=(base,old,edited)=>normalizeRows(base.map((row,r)=>row.map((value,c)=>Math.round(value+edited[r][c]-old[r][c]))));
  const oldMatrix=display(oldBase,oldBase.matrix),editedMatrix=display(active,active.matrix),newMatrix=display(newBase,newBase.matrix);
  setDisplayMatrix(merged,state.natural,addDisplayDelta(newMatrix,oldMatrix,editedMatrix),reference);
  const oldColor=display(oldBase,oldBase.colorBaseMatrix||oldBase.matrix),editedColor=display(active,active.colorBaseMatrix||active.matrix),newColor=display(newBase,newBase.colorBaseMatrix||newBase.matrix);
  const colorSlot=cloneSlot(merged);setDisplayMatrix(colorSlot,state.natural,addDisplayDelta(newColor,oldColor,editedColor),reference);merged.colorBaseMatrix=colorSlot.matrix.map(row=>row.slice());
  const mergeCurve=(base,old,edited)=>{
    if(!Array.isArray(old)||!Array.isArray(edited)||old.length!==base.length||edited.length!==base.length)return base.slice();
    const out=base.map((value,i)=>Math.max(0,Math.min(WHITE,Math.round(value+edited[i]-old[i]))));
    for(let i=1;i<out.length;i++)out[i]=Math.max(out[i],out[i-1]);return out;
  };
  merged.curves=merged.curves.map((curve,c)=>mergeCurve(curve,oldBase.curves?.[c]||curve,active.curves?.[c]||curve));
  merged.masterCurve=mergeCurve(merged.masterCurve,oldBase.masterCurve||merged.masterCurve,active.masterCurve||merged.masterCurve);
  for(const key of ['name','enabled','brightness_ev','contrast','color_hue','color_sat'])if(active[key]!==undefined)merged[key]=active[key];
  merged.user_preset_id=newBase.user_preset_id;merged.sourceLut=newBase.sourceLut;return merged;
}
async function migrateCachedUserFilters(){
  let upgraded=0,missing=0;
  for(const item of state.users.values()){
    if(userFitIsCurrent(item.slot,state.cameraModel))continue;
    if(!item.sourceLut){missing++;continue;}
    const fitted=fitUserItemForCamera(item,state.cameraModel,true);if(state.db)await dbPut(item);
    for(let i=0;i<3;i++)if(state.bases[i]?.user_preset_id===item.id){
      state.slots[i]=mergeRefittedSlot(fitted,state.bases[i],state.slots[i]);state.bases[i]=cloneSlot(fitted);
      state.curveAnchors[i]=[[],[],[],[]];state.curveDisplays[i]=[null,null,null,null];
    }
    upgraded++;
  }
  if(upgraded){persist();refresh();notify(`已将 ${upgraded} 个旧版用户滤镜重新拟合为当前 ${state.cameraModel==='k1ii'?'R369':'机型'} 算法`);}
  if(missing&&state.cameraModel==='k1ii')notify(`${missing} 个旧滤镜没有保留原始 CUBE，无法自动升级；重新导入原始 CUBE 即可使用 R369`);
}

function factoryRow(key){
  const raw=String(key||'').replace(/^istd:/,'');
  return state.factoryRows.find(row=>row.key===raw)||null;
}

function rebuildFactorySlots(){
  state.factorySlots.clear();
  state.factoryRows.forEach(row=>state.factorySlots.set(row.key,slotFromFactory(row,state.cameraModel)));
  const naturalRow=state.factoryRows.find(row=>row.local_key==='natural');
  state.natural=slotFromFactory(naturalRow,state.cameraModel);
}

function switchCameraModel(model){
  if(!['istd','k1','k1ii'].includes(model)||model===state.cameraModel)return;
  const previous=state.slots.map(cloneSlot),previousBases=state.bases.map(cloneSlot);
  state.cameraModel=model;rebuildFactorySlots();
  for(const item of state.users.values()){
    fitUserItemForCamera(item,model,true);
    if(item.sourceLut&&state.db)void dbPut(item).catch(error=>console.warn('User filter fit cache update failed',error));
  }
  state.slots=previous.map((slot,index)=>{
    let next=null;
    if(slot.user_preset_id){
      const item=state.users.get(slot.user_preset_id),source=item?fitUserItemForCamera(item,model):cloneSlot(slot);
      next=source;next.user_preset_id=slot.user_preset_id;next.sourceLut=item?.sourceLut||slot.sourceLut||null;
    }else{
      const row=factoryRow(slot.preset_key);next=row?slotFromFactory(row,model):cloneSlot(state.natural);
    }
    next.name=slot.name;next.enabled=slot.enabled;return normalizeSlotShape(next);
  });
  state.bases=state.slots.map(cloneSlot);
  state.curveAnchors=Array.from({length:3},()=>Array.from({length:4},()=>[]));
  state.curveDisplays=Array.from({length:3},()=>Array.from({length:4},()=>null));
  state.channel=model==='istd'?0:Math.min(3,state.channel);
  persist();refresh();setStatus('机型：'+(model==='istd'?'PENTAX *ist D':model==='k1'?'PENTAX K-1':'PENTAX K-1 II'));
}

function renderNav(){
  const root=$('navItems');root.replaceChildren();
  FEATURES.forEach(([key,zh,en],index)=>{
    const b=document.createElement('button');b.className='nav-entry';b.classList.toggle('active',state.currentPage===key);
    b.innerHTML=`<span class="nav-number">${String(index+1).padStart(2,'0')}</span><span class="nav-copy"><strong>${tr(zh,en)}</strong><small>${en}</small></span><span class="nav-arrow">›</span>`;
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
  $('filterCategory').textContent=tr(factory?'原厂风格':'用户滤镜');$('filterCount').textContent=filtered.length+tr(' 个',' items');
  $('factoryTab').classList.toggle('on',factory);$('userTab').classList.toggle('on',!factory);
  if(!filtered.length){const e=document.createElement('div');e.className='empty-list';e.textContent=tr(factory?'没有匹配的原厂滤镜':'尚无用户滤镜，导入 .cube 后会保存在这里',factory?'No matching factory filters':'No user filters yet. Imported .cube files are saved here.');list.appendChild(e);return;}
  filtered.forEach(item=>{
    const slot=factory?state.factorySlots.get(item.key):item.slot,row=document.createElement('div');row.className='filter-row';
    const b=document.createElement('button');b.className='filter-item';
    const selected=factory?(String(currentSlot().preset_key).replace(/^istd:/,'')===item.key&&!currentSlot().user_preset_id):currentSlot().user_preset_id===item.id;b.classList.toggle('active',selected);
    const thumb=document.createElement('canvas');thumb.className='thumb';thumb.width=152;thumb.height=112;
    const copy=document.createElement('span');copy.className='filter-label';const title=document.createElement('b');title.textContent=factory?item.label:item.name;
    const sub=document.createElement('small');sub.textContent=factory?(
      (state.cameraModel==='istd'?'*ist D · Matrix + shared 4096 Gamma':'K12 · Matrix + RGB Gamma')+
      ' · ΔE00 '+(Number.isFinite(slot.fit_report?.mean_de00)?slot.fit_report.mean_de00.toFixed(2):'—')):(
      (item.slot.fit_report?.fit_profile?.startsWith('R369-k1ii-native-darkaware-js-')?'R369 原生模型':item.slot.fit_report?.fit_profile?.startsWith('P317-')?'P317 显示域':'旧版拟合')+' · ΔE00 '+(Number.isFinite(item.slot.fit_report?.de00_mean)?item.slot.fit_report.de00_mean.toFixed(2):'—')+
      ' · RGB '+(Number.isFinite(item.slot.fit_report?.rgb_mae_255)?item.slot.fit_report.rgb_mae_255.toFixed(2)+'/255':'—'));
    copy.append(title,sub);b.append(thumb,copy);
    if(selected){const indicator=document.createElement('span');indicator.className='filter-indicator';b.appendChild(indicator);}
    b.onclick=()=>applyPreset(factory?item.key:item.id,factory);row.appendChild(b);
    if(!factory){const del=document.createElement('button');del.className='delete-filter';del.textContent='×';del.title=tr('删除用户滤镜','Delete user filter');del.onclick=async e=>{e.stopPropagation();await deleteUser(item.id);};row.appendChild(del);}
    list.appendChild(row);paintFilterThumb(thumb,slot,factory?item.key:item.id);
  });
}
function renderSlots(){
  const root=$('headerSlots');root.replaceChildren();
  state.slots.forEach((slot,index)=>{
    const card=document.createElement('div');card.className='header-slot';card.classList.toggle('active',index===state.active);card.classList.toggle('enabled',slot.enabled);
    const dot=document.createElement('button');dot.className='slot-enable';dot.textContent='';dot.title=tr(slot.enabled?'停用槽位':'启用槽位',slot.enabled?'Disable slot':'Enable slot');
    dot.onclick=e=>{e.stopPropagation();slot.enabled=!slot.enabled;persist();renderSlots();};
    const copy=document.createElement('div');copy.className='slot-copy';
    const name=document.createElement('strong');name.textContent=slot.name||'CUST';
    const sub=document.createElement('small');
    const factory=factoryRow(slot.preset_key);
    sub.textContent=slot.user_preset_id?(state.users.get(slot.user_preset_id)?.name||tr('用户滤镜','User filter')):(factory?.label||tr('尚未选择预设','No preset selected'));
    copy.append(name,sub);card.append(dot,copy);
    card.onclick=()=>{state.active=index;persist();refresh();};
    card.ondblclick=e=>{if(e.target===dot)return;const next=prompt(tr('预设名称','Preset name'),slot.name||'CUST');if(next!==null&&next.trim()){slot.name=next.trim().slice(0,12);persist();renderSlots();refreshControls();}};
    root.appendChild(card);
  });
}
function renderMatrix(){
  const grid=$('matrixGrid');grid.replaceChildren();const reference=state.curveProfiles?.natural_matrix_q8||null;
  const shown=state.cameraModel==='istd'?currentSlot().matrix.map(r=>r.slice()):displayMatrix(currentSlot(),state.natural,reference);
  const corner=document.createElement('span');grid.appendChild(corner);
  ['r','g','b'].forEach((key,index)=>{const label=document.createElement('span');label.className='matrix-axis '+key;label.textContent=['R','G','B'][index];grid.appendChild(label);});
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    if(col===0){const label=document.createElement('span');label.className='matrix-axis '+['r','g','b'][row];label.textContent=['R','G','B'][row];grid.appendChild(label);}
    const input=document.createElement('input');input.type='number';input.step='1';input.min=state.cameraModel==='istd'?'-512':'-2048';input.max=state.cameraModel==='istd'?'511':'2047';input.value=Math.round(shown[row][col]);
    input.className=row===col?'matrix-cell diagonal':'matrix-cell';
    input.onchange=()=>{
      const matrix=state.cameraModel==='istd'?currentSlot().matrix.map(r=>r.slice()):displayMatrix(currentSlot(),state.natural,reference),old=matrix[row][col],lo=state.cameraModel==='istd'?-512:-2048,hi=state.cameraModel==='istd'?511:2047,value=Math.max(lo,Math.min(hi,Math.round(Number(input.value)||0)));
      matrix[row][col]=value;
      if(col===row){const other=(row+1)%3;matrix[row][other]-=value-old;}
      else matrix[row][row]=256-matrix[row].reduce((sum,v,c)=>c===row?sum:sum+Number(v),0);
      if(state.cameraModel==='istd')currentSlot().matrix=matrix.map(r=>r.map(v=>Math.max(-512,Math.min(511,Math.round(v)))));else setDisplayMatrix(currentSlot(),state.natural,matrix,reference);
      currentSlot().colorBaseMatrix=currentSlot().matrix.map(r=>r.slice());currentSlot().color_hue=0;currentSlot().color_sat=1;
      persist();refreshControls();queueRender();
    };grid.appendChild(input);
  }
}
function curveFactoryBase(slot){return state.factorySlots.get(slot.preset_key)||state.natural;}
function sampleCurve(values,x){const p=Math.max(0,Math.min(1,x))*(values.length-1),a=Math.min(values.length-2,Math.floor(p)),f=p-a;return values[a]*(1-f)+values[a+1]*f;}
function fitBezierSegment(values,left,right){
  let aa=0,ab=0,bb=0,ra=0,rb=0,minDerivative=Infinity;const lo=left[0],hi=right[0],span=Math.max(hi-lo,1e-6);
  for(let i=0;i<=64;i++){const t=i/64,b1=3*t*(1-t)**2,b2=3*t*t*(1-t),v=sampleCurve(values,lo+t*span),res=v-left[1]*(1-t)**3-right[1]*t**3;aa+=b1*b1;ab+=b1*b2;bb+=b2*b2;ra+=b1*res;rb+=b2*res;}
  const det=aa*bb-ab*ab||1e-12,c1=(ra*bb-rb*ab)/det,c2=(rb*aa-ra*ab)/det;
  for(let i=0;i<=64;i++){const t=i/64,d=3*((c1-left[1])*(1-t)**2+2*(c2-c1)*t*(1-t)+(right[1]-c2)*t*t);minDerivative=Math.min(minDerivative,d);}
  const slope=right[1]-left[1],scale=minDerivative<0?Math.min(1,slope/Math.max(slope-minDerivative,1e-12)):1;
  return t=>{const raw=left[1]*(1-t)**3+3*c1*t*(1-t)**2+3*c2*t*t*(1-t)+right[1]*t**3,line=left[1]+slope*t;return Math.max(0,Math.min(1,line+scale*(raw-line)));};
}
function monotoneSpline(points,count=257){
  const pts=points.map(p=>[Number(p[0]),Number(p[1])]).sort((a,b)=>a[0]-b[0]);
  if(pts.length<2)return Array.from({length:count},(_,i)=>i/(count-1));
  const x=pts.map(p=>p[0]),y=pts.map(p=>p[1]),h=[],d=[];for(let i=0;i<x.length-1;i++){h.push(Math.max(x[i+1]-x[i],1e-9));d.push((y[i+1]-y[i])/h[i]);}
  const slopes=new Array(x.length).fill(0);
  if(x.length===2)slopes[0]=slopes[1]=d[0];
  else{
    for(let i=1;i<x.length-1;i++)if(d[i-1]*d[i]>0){const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];slopes[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);}
    const endpoint=(first,second,ha,hb)=>{const value=((2*ha+hb)*first-ha*second)/(ha+hb);return value*first<=0?0:Math.sign(first)*Math.min(Math.abs(value),3*Math.abs(first));};
    slopes[0]=endpoint(d[0],d[1],h[0],h[1]);slopes[slopes.length-1]=endpoint(d.at(-1),d.at(-2),h.at(-1),h.at(-2));
  }
  const out=[];for(let n=0;n<count;n++){const xx=n/(count-1);let k=0;while(k<x.length-2&&xx>x[k+1])k++;const t=Math.max(0,Math.min(1,(xx-x[k])/h[k])),t2=t*t,t3=t2*t;out.push(Math.max(0,Math.min(1,(2*t3-3*t2+1)*y[k]+(t3-2*t2+t)*h[k]*slopes[k]+(-2*t3+3*t2)*y[k+1]+(t3-t2)*h[k]*slopes[k+1])));}return out;
}
function smoothCurveShape(values,points=null){
  const source=values.map(v=>Math.max(0,Math.min(1,Number(v)))),pts=(points&&points.length>=2?points:[[0,source[0]],[1,source.at(-1)]]).map(p=>[Number(p[0]),Number(p[1])]).sort((a,b)=>a[0]-b[0]);
  if(pts.length===2){const fit=fitBezierSegment(source,pts[0],pts[1]),out=[];for(let i=0;i<source.length;i++){const x=i/(source.length-1),t=Math.max(0,Math.min(1,(x-pts[0][0])/Math.max(pts[1][0]-pts[0][0],1e-6)));out.push(x<pts[0][0]?pts[0][1]:x>pts[1][0]?pts[1][1]:fit(t));}return out;}
  const knots=[];for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],fit=fitBezierSegment(source,a,b);for(const f of [0,.25,.5,.75])knots.push([a[0]+f*(b[0]-a[0]),fit(f)]);}knots.push(pts.at(-1));return monotoneSpline(knots,source.length);
}
function curvePointTarget(baseline,points,index,x,y){
  const old=points.map(p=>p.slice()),next=old.map(p=>p.slice());next[index]=[x,y];const warped=new Array(baseline.length),change=new Array(points.length).fill(0);change[index]=y-old[index][1];
  for(let i=0;i<warped.length;i++){const xx=i/(warped.length-1);let k=0;while(k<next.length-2&&xx>next[k+1][0])k++;const span=Math.max(next[k+1][0]-next[k][0],1e-9),t=Math.max(0,Math.min(1,(xx-next[k][0])/span)),oldX=old[k][0]+t*(old[k+1][0]-old[k][0]);warped[i]=sampleCurve(baseline,oldX);}
  const adjustment=monotoneSpline(next.map((p,i)=>[p[0],change[i]*.5+.5]),baseline.length).map(v=>(v-.5)*2);
  const target=warped.map((v,i)=>Math.max(0,Math.min(1,v+adjustment[i])));return smoothCurveShape(target,next);
}
function curveRawView(){return relativeCurve(currentSlot(),state.natural,state.channel,state.curveProfiles,curveFactoryBase(currentSlot()));}
function curveView(){const cached=state.curveDisplays[state.active][state.channel];return Array.isArray(cached)&&cached.length===257?cached.slice():smoothCurveShape(curveRawView());}
function curvePoints(display){const saved=state.curveAnchors[state.active][state.channel];return saved.length>=2?saved:[[0,display[0]],[1,display.at(-1)]];}
function ensureCurvePoints(display){let points=state.curveAnchors[state.active][state.channel];if(points.length<2){points=[[0,display[0]],[1,display.at(-1)]];state.curveAnchors[state.active][state.channel]=points;}return points;}
function curveBodyTarget(baseline,points,x,y){
  const pts=points.map(p=>p.slice()).sort((a,b)=>a[0]-b[0]);let index=Math.max(0,Math.min(pts.length-2,pts.findIndex((p,i)=>i<pts.length-1&&x<=pts[i+1][0])));if(index<0)index=pts.length-2;const left=pts[index],right=pts[index+1],xx=Math.max(left[0]+1e-5,Math.min(right[0]-1e-5,x));
  const out=baseline.slice(),at=sampleCurve(baseline,xx),lineAt=left[1]+(xx-left[0])/(right[0]-left[0])*(right[1]-left[1]);
  for(let i=0;i<out.length;i++){const p=i/(out.length-1);if(p<left[0]||p>right[0])continue;const t=(p-left[0])/(right[0]-left[0]),chord=left[1]+t*(right[1]-left[1]);if(pts.length===2&&Math.abs(at-lineAt)>.002){const strength=Math.max(-3,Math.min(4,(y-lineAt)/(at-lineAt)));out[i]=chord+strength*(baseline[i]-chord);}else{const atT=(xx-left[0])/(right[0]-left[0]),weight=t*t*(1-t)**2/Math.max(atT*atT*(1-atT)**2,1e-8);out[i]+= (y-at)*weight;}}
  return smoothCurveShape(out,pts);
}
function drawCurve(){
  const canvas=$('curveCanvas'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,values=curveView();
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#111216';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#292b31';ctx.lineWidth=1;
  for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(w*i/4,0);ctx.lineTo(w*i/4,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}
  ctx.setLineDash([6,6]);ctx.strokeStyle='#666';ctx.globalAlpha=.55;ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(w,0);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
  const colors=['#d7d7de','#ef6767','#6fd58b','#6ba4ff'];ctx.strokeStyle=colors[state.channel];ctx.lineWidth=2.2;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
  values.forEach((v,i)=>{const x=i/(values.length-1)*w,y=h-Math.max(0,Math.min(1,v))*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  const anchors=curvePoints(values);
  anchors.forEach(([x,y],index)=>{const selected=index===curveHoverIndex||index===curvePointer?.anchorIndex;if(selected){ctx.beginPath();ctx.arc(x*w,(1-y)*h,14,0,Math.PI*2);ctx.strokeStyle=colors[state.channel];ctx.globalAlpha=.24;ctx.lineWidth=1.5;ctx.stroke();ctx.globalAlpha=1;}ctx.beginPath();ctx.arc(x*w,(1-y)*h,selected?7:6,0,Math.PI*2);ctx.fillStyle='#17181c';ctx.fill();ctx.strokeStyle=colors[state.channel];ctx.lineWidth=2;ctx.stroke();});
}
function refreshControls(){
  const slot=currentSlot();$('brightness').value=Number(slot.brightness_ev||0);$('brightnessVal').textContent=(slot.brightness_ev>=0?'+':'')+Number(slot.brightness_ev||0).toFixed(2)+' EV';
  $('contrast').value=Number(slot.contrast||0);$('contrastVal').textContent=String(Math.round(Number(slot.contrast||0)));
  $('saturation').value=Number(slot.color_sat??1);$('saturationVal').textContent=Number(slot.color_sat??1).toFixed(2)+' ×';
  $('hue').value=Number(slot.color_hue||0);$('hueVal').textContent=Math.round(Number(slot.color_hue||0))+'°';
  $('cameraModel').value=state.cameraModel;$('footerCamera').textContent=state.cameraModel==='istd'?'PENTAX *ist D':state.cameraModel==='k1'?'PENTAX K-1':'PENTAX K-1 II';
  $('exportScriptBtn').textContent=tr(state.cameraModel==='istd'?'导出五TXT':'导出脚本',state.cameraModel==='istd'?'Export 5 TXT':'Export Script');
  $('footerFilter').textContent=(slot.user_preset_id&&state.users.get(slot.user_preset_id)?.name)||factoryRow(slot.preset_key)?.label||slot.name||'CUST';
  $('lutModeBtn').classList.toggle('on',state.previewMode==='lut');$('cameraModeBtn').classList.toggle('on',state.previewMode==='camera');$('lutModeBtn').classList.toggle('disabled',!slot.sourceLut);
  $('chartBtn').classList.toggle('on',state.sourceMode==='chart');$('photoBtn').classList.toggle('on',state.sourceMode==='photo');
  $('toggleCompare').textContent=tr(state.compareMode===0?'全显示':state.compareMode===1?'左右':'上下',state.compareMode===0?'Full':state.compareMode===1?'Left / Right':'Top / Bottom');
  $('channelTabs').querySelectorAll('button').forEach(b=>{const channel=Number(b.dataset.channel);b.classList.toggle('on',channel===state.channel);b.disabled=state.cameraModel==='istd'&&channel>0;b.style.opacity=b.disabled?'.35':'1';});
  renderMatrix();drawCurve();
}
function refresh(){renderSlots();renderFilterList();refreshControls();queueRender();}
function applyPreset(identifier,factory){
  const item=factory?null:state.users.get(identifier);
  let selected=factory?state.factorySlots.get(identifier):item?fitUserItemForCamera(item,state.cameraModel):null;
  if(!selected)return;selected=cloneSlot(selected);if(!factory){if(item.sourceLut&&state.db)void dbPut(item).catch(error=>console.warn('User filter fit cache update failed',error));selected.sourceLut=item?.sourceLut||null;selected.user_preset_id=item.id;}
  const sourceName=factory?selected.name:(state.users.get(identifier)?.name||selected.name);
  selected.name=String(sourceName||'CUST').trim().slice(0,6);
  selected.enabled=currentSlot().enabled;selected.camera_model=state.cameraModel;normalizeSlotShape(selected);
  state.slots[state.active]=selected;state.bases[state.active]=cloneSlot(selected);state.curveAnchors[state.active]=[[],[],[],[]];state.curveDisplays[state.active]=[null,null,null,null];if(state.previewMode==='lut'&&!selected.sourceLut)state.previewMode='camera';persist();refresh();
  if(!factory&&state.cameraModel==='k1ii'&&!selected.fit_report?.fit_profile?.startsWith('R369-k1ii-native-darkaware-js-'))
    notify('该滤镜保留旧版拟合参数；请重新导入原始 CUBE 使用新的 K-1 II 原生拟合。');
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
  const bitmap=await createImageBitmap(file,{colorSpaceConversion:'default',imageOrientation:'from-image'}),factor=Math.min(1,2560/Math.max(bitmap.width,bitmap.height));original.width=Math.max(1,Math.round(bitmap.width*factor));original.height=Math.max(1,Math.round(bitmap.height*factor));
  originalContext.imageSmoothingEnabled=true;originalContext.imageSmoothingQuality='high';originalContext.clearRect(0,0,original.width,original.height);originalContext.drawImage(bitmap,0,0,original.width,original.height);bitmap.close();state.sourceName=file.name;state.sourceMode='photo';syncThumbnailSource();renderFilterList();refreshControls();queueRender();
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
    setStatus('拟合 LUT：'+file.name);await new Promise(r=>requestAnimationFrame(r));const cube=parseCube(await file.text(),file.name),fitModel=state.cameraModel==='istd'?'k1':state.cameraModel,fitted=fitCubeQuick(cube,canonicalNaturalSlot(fitModel),fitModel),id=cube.id.replace('lut:','');
    const active=state.cameraModel==='istd'?adaptSlotToIstd(fitted,state.natural):fitted;active.name=String(cube.name||file.name.replace(/\.cube$/i,'')).trim().slice(0,6);active.user_preset_id=id;active.sourceLut=cube;normalizeSlotShape(active);
    const item={id,name:cube.name,slot:stripSource(active),sourceLut:cube,importedAt:Date.now()};state.users.set(id,item);await dbPut(item);state.slots[state.active]=cloneSlot(active);state.bases[state.active]=cloneSlot(active);state.curveAnchors[state.active]=[[],[],[],[]];state.curveDisplays[state.active]=[null,null,null,null];state.tab='user';state.previewMode='camera';persist();notify('已导入「'+cube.name+'」 · '+(active.fit_report.fit_profile?.startsWith('R369-k1ii-native-darkaware-js-')?'R369 原生模型':'P317 显示域')+' · 模型 ΔE00 '+active.fit_report.de00_mean.toFixed(2));
  }catch(e){console.error(e);notify(file.name+'：'+(e.message||e));}}
  $('lutFile').value='';refresh();setStatus('就绪');
}
function resetCurrent(){const enabled=currentSlot().enabled;state.slots[state.active]=cloneSlot(currentBase());state.slots[state.active].enabled=enabled;state.curveAnchors[state.active]=[[],[],[],[]];state.curveDisplays[state.active]=[null,null,null,null];if(state.previewMode==='lut'&&!currentSlot().sourceLut)state.previewMode='camera';persist();refresh();}

function applyColorFromControls(){
  const slot=currentSlot();slot.color_sat=Number($('saturation').value);slot.color_hue=Number($('hue').value);
  slot.matrix=applyColorControls(slot.colorBaseMatrix||slot.matrix,slot.color_sat,slot.color_hue);persist();refreshControls();queueRender();
}
function setInspector(name){
  document.querySelectorAll('.right-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.inspector===name));
  document.querySelectorAll('.inspector-pane').forEach(p=>p.classList.toggle('active',p.dataset.inspectorPane===name));
}
async function ensureDirectoryPermission(handle){
  if(!handle)return false;
  const options={mode:'readwrite'};
  if((await handle.queryPermission?.(options))==='granted')return true;
  return (await handle.requestPermission?.(options))==='granted';
}
async function chooseExportRoot(id='pentax-labs-sd-root'){
  if(!window.showDirectoryPicker)return null;
  const options={id,mode:'readwrite'};
  if(state.sdRoot)options.startIn=state.sdRoot;
  const handle=await window.showDirectoryPicker(options);
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
async function chooseR367Runtime(){
  if(!window.showDirectoryPicker) throw Error('请使用支持选择文件夹的浏览器，选择原始 R367 的 script 文件夹');
  const root=await window.showDirectoryPicker({id:'pentax-labs-r367-base',mode:'read'});
  const script=root.name.toLowerCase()==='script'?root:await root.getDirectoryHandle('script');
  const t=await script.getDirectoryHandle('T');
  const files=await Promise.all([t.getFileHandle('R.BIN').then(h=>h.getFile()),t.getFileHandle('P.BIN').then(h=>h.getFile()),script.getFileHandle('startup.ttl').then(h=>h.getFile())]);
  const base=await readRuntimeFiles(files,'k1ii');state.runtimeBases.k1ii=base;
  if(state.db) await dbPut({id:'__r367_k1ii',type:'runtime-base',base});
  return base;
}
async function exportCameraScript(camera=state.cameraModel){
  try{
    let files;
    if(camera==='istd')files=compileIstdFiles(currentSlot());
    else {
      const base=state.runtimeBases[camera]||(camera==='k1ii'?await chooseR367Runtime():null);if(!base)throw Error('当前机型运行时尚未加载');
      files=compileCameraScriptFiles(state.slots,camera,base);
    }
    if(window.showDirectoryPicker){
      const root=await chooseExportRoot('pentax-labs-filter-root');await writeFilesToDirectory(root,files);
      const label=/dcram/i.test(root.name||'')?'DCRAM SD卡':(root.name||'所选目录');
      if(camera==='istd'){setStatus('五 TXT 已写入 '+label+' 根目录');notify('已直接写入 *ist D 五 TXT');}
      else {setStatus('脚本已写入 '+label+' 根目录');notify('已直接写入 '+label+' /script');}
      return;
    }
    const blob=camera==='istd'?new Blob([zipStore(files)],{type:'application/zip'}):compileCameraScript(state.slots,camera,state.runtimeBases[camera]);
    downloadBlob(camera==='istd'?'PentaxLabs_istD_5TXT.zip':`PentaxLabs_${camera==='k1'?'K1':'K1II'}_script.zip`,blob,'application/zip');
    notify('当前浏览器不支持目录直写，已回退下载 ZIP');
  }catch(e){if(e?.name==='AbortError')return;notify(e.message||String(e));}
}

function engineeringModels(){return state.engineeringPayload?.models||[];}
function seasonModels(){return state.engineeringPayload?.filters||[];}
function variantLabel(v){
  const labels={entry:'工程模式入口',script_enable:'启用脚本模式',script_disable:'关闭脚本模式',probe:'脚本探测'};
  if(v.label)return v.label;
  if(v.action==='activate')return '启用四季 '+v.mask;if(v.action==='clear')return '关闭四季 '+v.mask;return labels[v.action]||v.action||'工程文件方案';
}
function setupEngineering(){
  const model=$('engineeringModel');model.replaceChildren();engineeringModels().forEach((m,i)=>model.add(new Option(m.display||m.model,String(i))));
  model.onchange=refreshEngineering;refreshEngineering();
  const season=$('seasonModel');season.replaceChildren();seasonModels().forEach((m,i)=>season.add(new Option(m.display||m.model,String(i))));
  season.value=String(Math.max(0,seasonModels().findIndex(m=>m.model==='K-1 II')));season.onchange=refreshSeason;refreshSeason();
  translateStatic(document.body);
}
function refreshEngineering(){
  const m=engineeringModels()[Number($('engineeringModel').value)||0],variants=m?.variants||[],select=$('engineeringVariant');
  select.replaceChildren();variants.forEach((v,i)=>select.add(new Option(variantLabel(v),String(i))));
  if(!variants.length)select.add(new Option(tr('按键进入 · 无需导出文件','Button entry · no files to export'),''));
  select.disabled=!variants.length;select._variants=variants;
  const canExport=variants.some(v=>Object.keys(v.files||{}).length>0),exportButton=$('engineeringExportBtn');
  exportButton.disabled=!canExport;exportButton.textContent=canExport?tr('导出工程文件','Export engineering files'):tr('仅查看教程','Tutorial only');
  $('engineeringTitle').textContent=m?`${m.display||m.model}${m.status?' · '+m.status:''}`:'—';
  let tutorial=m?.tutorial||m?.note||tr('该机型暂无工程模式说明。','No service-mode instructions are available for this model.');
  if(m?.note&&tutorial&&!tutorial.includes(m.note))tutorial+='\n\n'+m.note;
  $('engineeringTutorial').textContent=tutorial;
}
async function exportEngineering(){
  const model=engineeringModels()[Number($('engineeringModel').value)||0],variants=$('engineeringVariant')._variants||[],v=variants[Number($('engineeringVariant').value)||0];
  if(!v||!Object.keys(v.files||{}).length)return notify('该机型仅提供按键教程，无可导出文件');
  const files={};for(const [name,b64] of Object.entries(v.files||{}))files[name]=base64Bytes(b64);
  try{
    if(window.showDirectoryPicker){
      const root=await chooseExportRoot('pentax-labs-engineering-root');
      await writeFilesToDirectory(root,files);notify('工程文件已直接写入 '+(root.name||'所选目录'));return;
    }
    downloadBlob('PentaxLabs_'+safeName(model.display||model.model)+'_Engineering.zip',zipStore(files),'application/zip');
    notify('当前浏览器不支持目录直写，已回退下载 ZIP');
  }catch(e){if(e?.name!=='AbortError')notify(e.message||String(e));}
}
function refreshSeason(){
  const m=seasonModels()[Number($('seasonModel').value)||0],trigger=(m?.variants||[]).find(v=>v.action==='script_enable'),activate=(m?.variants||[]).find(v=>v.action==='activate'&&Number(v.mask)===15);
  $('seasonInfo').textContent=m?`${m.model} · 工程触发：${Object.keys(trigger?.files||{}).filter(x=>x!=='DEVELOP.MOD').join('、')||'—'} · 四季 startup.ttl：${activate?'已归档':'缺失'}`:'—';
}
async function exportSeason(){
  const m=seasonModels()[Number($('seasonModel').value)||0],first=(m?.variants||[]).find(v=>v.action==='script_enable'),second=(m?.variants||[]).find(v=>v.action==='activate'&&Number(v.mask)===15);
  if(!first||!second)return notify('当前机型缺少完整四季数据');
  const files={};for(const [name,b64] of Object.entries(first.files||{}))files[name]=base64Bytes(b64);for(const [name,b64] of Object.entries(second.files||{}))files[name]=base64Bytes(b64);
  files['使用说明.txt']='Pentax Labs 四季滤镜\n第一次开机：通过工程触发尝试启用 Script Mode；正常关机。\n第二次开机：保持同一张卡正常开机，执行 script/startup.ttl。\n';
  try{
    if(window.showDirectoryPicker){const root=await chooseExportRoot('pentax-labs-seasons-root');await writeFilesToDirectory(root,files);notify('四季启用文件已直接写入 '+(root.name||'所选目录'));return;}
    downloadBlob('PentaxLabs_'+m.model+'_FourSeasons.zip',zipStore(files),'application/zip');notify('当前浏览器不支持目录直写，已回退下载 ZIP');
  }catch(e){if(e?.name!=='AbortError')notify(e.message||String(e));}
}

async function exportIstdFirmware(){
  try{
    let response=await fetch('./assets/istd_chinese.bin',{cache:'no-cache'});
    if(!response.ok)response=await fetch('../app/lab_assets/istd_chinese.bin',{cache:'no-cache'});
    if(!response.ok)throw Error('中文固件资源加载失败');
    const data=new Uint8Array(await response.arrayBuffer());
    if(window.showDirectoryPicker){
      const root=await chooseExportRoot('pentax-labs-istd-firmware-root');
      await writeFilesToDirectory(root,{'FWDC112B.BIN':data});notify('FWDC112B.BIN 已直接写入 '+(root.name||'所选目录'));return;
    }
    downloadBlob('FWDC112B.BIN',data,'application/octet-stream');
  }catch(e){if(e?.name!=='AbortError')notify(e.message||String(e));}
}

async function loadCpPhoto(file){
  const bitmap=await createImageBitmap(file),factor=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));cpOriginal.width=Math.max(1,Math.round(bitmap.width*factor));cpOriginal.height=Math.max(1,Math.round(bitmap.height*factor));cpOriginalCtx.drawImage(bitmap,0,0,cpOriginal.width,cpOriginal.height);bitmap.close();state.cpOriginal=file.name;renderCp();
}
function cpModeData(){return state.cpNative?.modes?.[state.cpMode]||{bases:[],limits:[]};}
function cpBaseId(){const bases=cpModeData().bases;return bases[Math.max(0,Math.min(state.cpBaseIndex,bases.length-1))]??0;}
function cpMatrixFor(base=cpBaseId()){return state.cpNative.matrices_q8[String(base)].map(row=>row.map(Number));}
function chooseCpCurve(channel,selected){
  const next=state.cpCurves.split(''),old=next[channel],value=String(selected);
  if(state.cpMode==='random'){
    const other=next.findIndex((entry,index)=>index!==channel&&entry===value);
    if(other>=0)next[other]=old;
  }
  next[channel]=value;state.cpCurves=next.join('');renderCpUi();renderCp();
}
function drawCpCurve(){
  const canvas=$('cpCurveCanvas'),ctx=canvas.getContext('2d',{colorSpace:'srgb'}),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#111216';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#2d3037';ctx.lineWidth=1;
  for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(w*i/4,0);ctx.lineTo(w*i/4,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}
  ctx.setLineDash([5,5]);ctx.strokeStyle='#5d616b';ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(w,0);ctx.stroke();ctx.setLineDash([]);
  const colors=['#ff858d','#7fd8a0','#80b3ff'];
  for(let channel=0;channel<3;channel++){
    const values=state.cpNative.curves[state.cpCurves[channel]];ctx.strokeStyle=colors[channel];ctx.lineWidth=2.4;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
    values.forEach((v,i)=>{const x=i/(values.length-1)*w,y=(1-v)*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  }
}
function renderCpUi(){
  if(!state.cpNative)return;
  document.querySelectorAll('[data-cp-inspector]').forEach(b=>b.classList.toggle('on',b.dataset.cpInspector===state.cpInspector));
  document.querySelectorAll('[data-cp-inspector-pane]').forEach(p=>p.classList.toggle('active',p.dataset.cpInspectorPane===state.cpInspector));
  $('cpMode').value=state.cpMode;const select=$('cpBase');select.replaceChildren();cpModeData().bases.forEach((base,index)=>select.add(new Option(`${String(base).padStart(2,'0')} · ${state.cpNative.labels[String(base)]}`,String(index))));select.value=String(state.cpBaseIndex);
  const controls=$('cpNativeControls');controls.replaceChildren();const limits=cpModeData().limits;
  state.cpNative.control_labels.forEach((label,index)=>{const wrap=document.createElement('label');wrap.className='control';const head=document.createElement('span'),name=document.createElement('span'),out=document.createElement('output');name.textContent=tr(label,label);out.textContent=String(state.cpControls[index]);head.append(name,out);const slider=document.createElement('input');slider.type='range';slider.min=limits[index][0];slider.max=limits[index][1];slider.step='1';slider.value=state.cpControls[index];slider.oninput=()=>{state.cpControls[index]=Number(slider.value);out.textContent=slider.value;renderCp();};wrap.append(head,slider);controls.appendChild(wrap);});
  ['R','G','B'].forEach((name,index)=>{$('cpCurve'+name).value=state.cpCurves[index];});$('cpCurveCode').textContent=state.cpCurves;drawCpCurve();
  translateStatic(document.body);
}
function srgbDecode(v){v=Math.max(0,Math.min(1,v));return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}
function srgbEncode(v){v=Math.max(0,Math.min(1,v));return v<=.0031308?v*12.92:1.055*(v**(1/2.4))-.055;}
function cpMatrixApply(matrix,rgb){return matrix.map(row=>Math.max(0,Math.min(1,row[0]*rgb[0]+row[1]*rgb[1]+row[2]*rgb[2])));}
function cpChromaRotate(rgb,matrix){
  const y=.299*rgb[0]+.587*rgb[1]+.114*rgb[2],cb=(rgb[2]-y)/1.772,cr=(rgb[0]-y)/1.402,cb2=matrix[1][1]*cb+matrix[1][2]*cr,cr2=matrix[2][1]*cb+matrix[2][2]*cr,r=y+1.402*cr2,b=y+1.772*cb2,g=(y-.299*r-.114*b)/.587;return [r,g,b].map(v=>Math.max(0,Math.min(1,v)));
}
function cpCurveAt(values,x){const p=Math.max(0,Math.min(1,x))*(values.length-1),a=Math.min(values.length-2,Math.floor(p)),f=p-a;return values[a]*(1-f)+values[a+1]*f;}
function renderCp(){
  if(!state.cpOriginal||!state.cpNative)return;const canvas=$('cpCanvas');canvas.width=cpOriginal.width;canvas.height=cpOriginal.height;const ctx=canvas.getContext('2d'),img=cpOriginalCtx.getImageData(0,0,cpOriginal.width,cpOriginal.height),px=img.data,base=cpBaseId(),matrix=cpMatrixFor(base).map(row=>row.map(v=>v/256)),[sat,hue,tone,contrast,sharp]=state.cpControls,axis=state.cpNative.axis12,satBank=axis.byte1_normal[sat+4],hueKey=state.cpNative.normal_hue_bases.includes(base)?'byte2_normal':'byte2_special',hueBank=axis[hueKey][hue+4];
  for(let i=0;i<px.length;i+=4){
    let work=cpMatrixApply(matrix,[srgbDecode(px[i]/255),srgbDecode(px[i+1]/255),srgbDecode(px[i+2]/255)]).map(srgbEncode);
    work=cpMatrixApply(satBank,work);work=cpChromaRotate(work,hueBank);
    if(tone)work=work.map(v=>Math.max(0,Math.min(1,v+.18*tone*v*(1-v))));
    if(contrast)work=work.map(v=>Math.max(0,Math.min(1,.5+(v-.5)*(1+.11*contrast))));
    for(let c=0;c<3;c++){const u=Math.max(0,Math.min(255,Math.round(work[c]*255))),mapped=cpCurveAt(state.cpNative.curves[state.cpCurves[c]],u/255)*255;px[i+c]=Math.max(0,Math.min(255,Math.round(.45*u+.55*mapped)));}
  }
  if(sharp){const source=new Uint8ClampedArray(px),amount=.12*sharp;for(let y=1;y<img.height-1;y++)for(let x=1;x<img.width-1;x++)for(let c=0;c<3;c++){const at=(y*img.width+x)*4+c,blur=(source[at-4]+source[at+4]+source[at-img.width*4]+source[at+img.width*4])/4;px[at]=Math.max(0,Math.min(255,Math.round(source[at]+amount*(source[at]-blur))));}}
  ctx.putImageData(img,0,0);$('cpEmpty').style.display='none';
}
function cpRecipeBytes(){
  const bytes=new Uint8Array(10);bytes[0]=cpBaseId();state.cpControls.forEach((value,index)=>bytes[1+index]=value&255);bytes[6]=0;for(let i=0;i<3;i++)bytes[7+i]=Number(state.cpCurves[i]);return bytes;
}
function installEvents(){
  $('navToggle').onclick=openNav;$('navMask').onclick=closeNav;$('homeBtn').onclick=()=>goPage('filters');
  $('settingsBtn').onclick=openSettings;$('settingsClose').onclick=closeSettings;$('settingsOverlay').onclick=e=>{if(e.target===$('settingsOverlay'))closeSettings();};
  document.querySelectorAll('[data-settings-page]').forEach(b=>b.onclick=()=>{state.settingsPage=b.dataset.settingsPage;renderSettings();});
  $('languageSelect').onchange=()=>{state.language=$('languageSelect').value;persist();applyLanguage();};
  document.querySelectorAll('[data-cp-inspector]').forEach(b=>b.onclick=()=>{state.cpInspector=b.dataset.cpInspector==='curve'?'curve':'basic';persist();renderCpUi();});
  $('factoryTab').onclick=()=>{state.tab='factory';persist();renderFilterList();};$('userTab').onclick=()=>{state.tab='user';persist();renderFilterList();};$('filterSearch').oninput=renderFilterList;
  $('refreshBtn').onclick=renderFilterList;
  $('importBtn').onclick=()=>$('lutFile').click();$('lutFile').onchange=e=>importFiles(e.target.files);$('photoBtn').onclick=()=>$('photoFile').click();$('photoFile').onchange=async e=>{if(e.target.files[0])try{await loadPhoto(e.target.files[0]);}catch(x){notify('照片读取失败：'+x.message);}e.target.value='';};
  $('chartBtn').onclick=chartSource;
  $('cameraModel').onchange=()=>switchCameraModel($('cameraModel').value);
  $('brightness').oninput=()=>{currentSlot().brightness_ev=Number($('brightness').value);refreshControls();persist();queueRender();};$('contrast').oninput=()=>{currentSlot().contrast=Number($('contrast').value);refreshControls();persist();queueRender();};
  $('saturation').oninput=applyColorFromControls;$('hue').oninput=applyColorFromControls;
  $('resetBasicBtn').onclick=()=>{const slot=currentSlot();slot.brightness_ev=0;slot.contrast=0;slot.color_sat=1;slot.color_hue=0;slot.matrix=(slot.colorBaseMatrix||slot.matrix).map(r=>r.slice());persist();refreshControls();queueRender();};
  $('resetMatrixBtn').onclick=()=>{const slot=currentSlot(),base=currentBase();slot.matrix=base.matrix.map(r=>r.slice());slot.colorBaseMatrix=slot.matrix.map(r=>r.slice());slot.color_sat=1;slot.color_hue=0;persist();refreshControls();queueRender();};
  document.querySelectorAll('.right-tabs button').forEach(b=>b.onclick=()=>setInspector(b.dataset.inspector));
  $('channelTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.channel=Number(b.dataset.channel);curveHoverIndex=-1;curveLastTap=null;refreshControls();});
  $('resetCurveBtn').onclick=()=>{const slot=currentSlot(),base=currentBase();if(state.channel===0)slot.masterCurve=base.masterCurve.slice();else slot.curves[state.channel-1]=base.curves[state.channel-1].slice();state.curveAnchors[state.active][state.channel]=[];state.curveDisplays[state.active][state.channel]=null;persist();drawCurve();queueRender();};
  $('linearCurveBtn').onclick=()=>{const before=curveView(),target=state.curveProfiles.axis.slice();if(state.channel===0)currentSlot().masterCurve=currentSlot().masterCurve.slice();else currentSlot().curves[state.channel-1]=currentSlot().curves[state.channel-1].slice();applyRelativeCurve(currentSlot(),state.natural,state.channel,target,before,state.curveProfiles);state.curveDisplays[state.active][state.channel]=target.slice();state.curveAnchors[state.active][state.channel]=[[0,0],[1,1]];persist();drawCurve();queueRender();};
  $('addCurvePointBtn').onclick=()=>{state.curveAddMode=!state.curveAddMode;$('addCurvePointBtn').classList.toggle('prominent',state.curveAddMode);notify(tr(state.curveAddMode?'在曲线上点击添加节点':'已取消加点',state.curveAddMode?'Click the curve to add a point':'Add-point mode cancelled'));};
  const curve=$('curveCanvas'),pos=e=>{const r=curve.getBoundingClientRect();return {index:Math.max(0,Math.min(256,(e.clientX-r.left)/r.width*256)),value:Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height))};};
  const handleRadius=e=>e.pointerType==='touch'?34:e.pointerType==='pen'?30:28;
  const curveRadius=e=>e.pointerType==='touch'?34:28;
  const nearestCurveAnchor=(e,limit=handleRadius(e))=>{const r=curve.getBoundingClientRect(),display=curveView(),anchors=curvePoints(display),p=pos(e);let best=-1,dist=limit;anchors.forEach(([x,y],i)=>{const dx=(x-p.index/256)*r.width,dy=(y-p.value)*r.height,d=Math.hypot(dx,dy);if(d<dist){dist=d;best=i;}});return best;};
  const addCurveAnchorAt=(x,display)=>{const anchors=ensureCurvePoints(display),existing=anchors.findIndex(([px])=>Math.abs(px-x)<.01);if(existing>=0)return existing;anchors.push([x,sampleCurve(display,x)]);anchors.sort((a,b)=>a[0]-b[0]);state.curveDisplays[state.active][state.channel]=display.slice();state.curveAddMode=false;$('addCurvePointBtn').classList.remove('prominent');return anchors.findIndex(([px])=>Math.abs(px-x)<1e-8);};
  const removeCurveAnchor=index=>{const points=ensureCurvePoints(curveView());if(index>0&&index<points.length-1){points.splice(index,1);curveLastTap=null;persist();drawCurve();return true;}return false;};
  curve.onpointerdown=e=>{
    if(e.button!==0||!e.isPrimary)return;e.preventDefault();
    const p=pos(e),display=curveView(),points=ensureCurvePoints(display),r=curve.getBoundingClientRect(),anchorIndex=nearestCurveAnchor(e),x=p.index/256,curveY=sampleCurve(display,x),distance=Math.abs((curveY-p.value)*r.height);
    // Lightroom Mobile removes a point with a double tap. Keep the same
    // action available on touchscreens where a context menu does not exist.
    if(e.pointerType==='touch'&&anchorIndex>0&&anchorIndex<points.length-1&&curveLastTap&&curveLastTap.index===anchorIndex&&performance.now()-curveLastTap.time<360&&Math.hypot(e.clientX-curveLastTap.x,e.clientY-curveLastTap.y)<44){removeCurveAnchor(anchorIndex);return;}
    if(anchorIndex<0&&!state.curveAddMode&&distance>curveRadius(e))return;
    curve.setPointerCapture(e.pointerId);
    let mode='point',selectedIndex=anchorIndex,createdAnchor=false;
    if(selectedIndex<0){
      if(e.altKey&&!state.curveAddMode)mode='body';
      else{
        const previousCount=points.length;
        selectedIndex=addCurveAnchorAt(x,display);
        createdAnchor=ensureCurvePoints(display).length>previousCount;
      }
    }
    const activePoints=ensureCurvePoints(display),selectedPoint=selectedIndex>=0?activePoints[selectedIndex]:null;
    curvePointer={pointerId:e.pointerId,pointerType:e.pointerType,display,native:state.channel===0?currentSlot().masterCurve.slice():currentSlot().curves[state.channel-1].slice(),points:activePoints.map(point=>point.slice()),anchorIndex:selectedIndex,mode,createdAnchor,grabX:x,grabY:curveY,pressY:p.value,grabOffsetX:mode==='point'&&selectedPoint?selectedPoint[0]-x:0,grabOffsetY:mode==='point'&&selectedPoint?selectedPoint[1]-p.value:0,pressX:e.clientX,pressClientY:e.clientY,moved:false};
    curveHoverIndex=selectedIndex;drawCurve();
  };
  curve.onpointermove=e=>{
    if(!curvePointer){const nextHover=e.pointerType==='touch'?-1:nearestCurveAnchor(e);if(nextHover!==curveHoverIndex){curveHoverIndex=nextHover;drawCurve();}curve.style.cursor=curveHoverIndex>=0?'grab':'crosshair';return;}
    if(curvePointer.pointerId!==e.pointerId)return;e.preventDefault();
    if(Math.hypot(e.clientX-curvePointer.pressX,e.clientY-curvePointer.pressClientY)>2)curvePointer.moved=true;
    const next=pos(e),x=next.index/256;let target;
    if(curvePointer.mode==='point'){
      const pts=curvePointer.points.map(p=>p.slice()),i=curvePointer.anchorIndex,lo=i>0?pts[i-1][0]+.01:0,hi=i<pts.length-1?pts[i+1][0]-.01:1,xx=Math.max(lo,Math.min(hi,x+curvePointer.grabOffsetX)),yy=Math.max(i>0?pts[i-1][1]:0,Math.min(i<pts.length-1?pts[i+1][1]:1,next.value+curvePointer.grabOffsetY));pts[i]=[xx,yy];
      target=curvePointTarget(curvePointer.display,curvePointer.points,i,xx,yy);state.curveAnchors[state.active][state.channel]=pts;
    }else target=curveBodyTarget(curvePointer.display,curvePointer.points,curvePointer.grabX,curvePointer.grabY+next.value-curvePointer.pressY);
    if(state.channel===0)currentSlot().masterCurve=curvePointer.native.slice();else currentSlot().curves[state.channel-1]=curvePointer.native.slice();applyRelativeCurve(currentSlot(),state.natural,state.channel,target,curvePointer.display,state.curveProfiles);state.curveDisplays[state.active][state.channel]=target.slice();drawCurve();queueRender();
  };
  const endCurve=e=>{const active=curvePointer;if(!active||active.pointerId!==e.pointerId)return;curvePointer=null;if(curve.hasPointerCapture(e.pointerId))curve.releasePointerCapture(e.pointerId);persist();if(e.type==='pointerup'&&active.pointerType==='touch'&&!active.createdAnchor&&!active.moved&&active.mode==='point'&&active.anchorIndex>0&&active.anchorIndex<active.points.length-1)curveLastTap={index:active.anchorIndex,time:performance.now(),x:e.clientX,y:e.clientY};else curveLastTap=null;};curve.onpointerup=endCurve;curve.onpointercancel=endCurve;curve.onlostpointercapture=e=>{if(curvePointer?.pointerId===e.pointerId){curvePointer=null;persist();}};
  curve.oncontextmenu=e=>{e.preventDefault();const index=nearestCurveAnchor(e,32);removeCurveAnchor(index);};
  $('cameraModeBtn').onclick=()=>{state.previewMode='camera';refreshControls();queueRender();};$('lutModeBtn').onclick=()=>{if(!currentSlot().sourceLut)return notify('当前滤镜没有保留原始 CUBE');state.previewMode='lut';refreshControls();queueRender();};
  $('toggleCompare').onclick=()=>{state.compareMode=(state.compareMode+1)%3;persist();refreshControls();queueRender();};
  $('exportScriptBtn').onclick=()=>exportCameraScript();
  $('engineeringExportBtn').onclick=exportEngineering;$('seasonExportBtn').onclick=exportSeason;
  $('cpPhotoBtn').onclick=()=>$('cpPhotoFile').click();$('cpPhotoFile').onchange=async e=>{if(e.target.files[0])await loadCpPhoto(e.target.files[0]);e.target.value='';};
  $('cpMode').onchange=()=>{state.cpMode=$('cpMode').value==='extended'?'extended':'random';state.cpBaseIndex=0;state.cpControls=[0,0,0,0,0];if(state.cpMode==='random'&&new Set(state.cpCurves).size<3)state.cpCurves='210';renderCpUi();renderCp();};
  $('cpBase').onchange=()=>{state.cpBaseIndex=Number($('cpBase').value)||0;renderCpUi();renderCp();};
  ['R','G','B'].forEach((name,index)=>{$('cpCurve'+name).onchange=()=>chooseCpCurve(index,$('cpCurve'+name).value);});
  $('cpRecipeBtn').onclick=()=>downloadBlob('PENTAX_CP_10B.bin',cpRecipeBytes(),'application/octet-stream');
  $('cpExportBtn').onclick=()=>{if(!state.cpOriginal)return notify('请先选择照片');$('cpCanvas').toBlob(blob=>downloadBlob('PentaxLabs_CP.png',blob,'image/png'),'image/png');};
  $('firmwareExportBtn').onclick=exportIstdFirmware;
  $('afOffset').oninput=()=>{$('afValue').textContent=(Number($('afOffset').value)>=0?'+':'')+$('afOffset').value;};$('afExportBtn').onclick=async()=>{try{const files=buildFocusFiles(Number($('afOffset').value));if(window.showDirectoryPicker){const root=await chooseExportRoot('pentax-labs-istd-af-root');await writeFilesToDirectory(root,files);notify('调焦文件已直接写入 '+(root.name||'所选目录'));return;}downloadBlob('PentaxLabs_istD_AF.zip',buildFocusZip(Number($('afOffset').value)),'application/zip');}catch(e){if(e?.name!=='AbortError')notify(e.message||String(e));}};
  const stage=$('photoStage');stage.ondragover=e=>{e.preventDefault();stage.classList.add('drag-over');};stage.ondragleave=()=>stage.classList.remove('drag-over');stage.ondrop=async e=>{e.preventDefault();stage.classList.remove('drag-over');const files=Array.from(e.dataTransfer.files),cubes=files.filter(f=>/\.cube$/i.test(f.name));if(cubes.length)await importFiles(cubes);const photo=files.find(f=>f.type.startsWith('image/'));if(photo)await loadPhoto(photo);};
}

async function start(){
  installEvents();
  try{
    setStatus(tr('正在加载','Loading'));await loadLibraries();initializeSlots();rebuildFactorySlots();
    const [k1iiRuntime,k1Runtime]=await Promise.allSettled([loadBuiltinRuntime('k1ii'),loadBuiltinRuntime('k1')]);
    state.runtimeBases.k1ii=k1iiRuntime.status==='fulfilled'?k1iiRuntime.value:null;
    state.runtimeBases.k1=k1Runtime.status==='fulfilled'?k1Runtime.value:null;
    const hash=location.hash.replace(/^#/,'');if(FEATURES.some(x=>x[0]===hash))state.currentPage=hash;
    $('cameraModel').value=state.cameraModel;chartSource();setupEngineering();renderCpUi();refresh();goPage(state.currentPage);renderSettings();translateStatic(document.body);persist();
    try{
      state.db=await openDatabase();for(const item of await dbAll()){
        if(item?.type==='sd-root'&&item.handle)state.sdRoot=item.handle;
        else if(item?.id==='__r367_k1ii'&&item.base){try{await validateR367(item.base.p,item.base.r,item.base.ttl);state.runtimeBases.k1ii=item.base;}catch(e){console.warn('Saved R367 base rejected',e);}}
        else if(item?.id&&item.slot)state.users.set(item.id,item);
      }
      hydrateUserSources();await migrateCachedUserFilters();hydrateUserSources();refresh();persist();
    }catch(e){console.warn('IndexedDB unavailable',e);notify('浏览器持久存储不可用，本次会话仍可使用');}
    let ready=tr('就绪','Ready');
    if(state.sdRoot&&await state.sdRoot.queryPermission?.({mode:'readwrite'})==='granted')
      ready+=' · SD '+(/dcram/i.test(state.sdRoot.name||'')?'DCRAM':(state.sdRoot.name||''));
    setStatus(ready);
  }catch(e){console.error(e);setStatus(tr('初始化失败','Initialization failed'));notify(e.message||String(e));}
}
start();
