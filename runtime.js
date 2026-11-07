import {WHITE, normalizeRows, effectiveCurves} from './engine.js';
import {crc32, zipStore} from './zip.js';

const META={
  matrices:[2652,11004,19196],
  titles:[39680,49280,58880],
  icons:[94208,97280,100352],
  countGuards:[{offset:86052,word:3814195203},{offset:87088,word:3813736451}],
  focus:[64,8256,16448],
  focusOriginal:82304,
  stageRuntimeCrcOffset:4028,
  commonQ13:[[12032,-3872,32],[-1856,12576,-2528],[288,-3392,11296]],
};
const GAMMA=0x120B0, MASK=0x16B44;
const NATURAL_PATCHES=[
  [0x0ADC,0x01207008,0x01207009],
  [0x2B80,0x01207008,0x01207009],
  [0x4B80,0x01207008,0x01207009],
  [0x166C4,0xE3510001,0xE3510000],
  [0x1685C,0xE3590001,0xE3590000],
];

const enc=new TextEncoder();
const dec=new TextDecoder('ascii');

// Offline verification helper. The production Web UI never asks the user for
// these files; it loads the validated beta80 templates with loadBuiltinRuntime.
export async function readRuntimeFiles(fileList,cameraModel) {
  const files={};
  for(const file of fileList) files[file.name.toLowerCase()]={data:new Uint8Array(await file.arrayBuffer())};
  const p=files['p.bin'],r=files['r.bin'],ttl=files['startup.ttl'];
  if(!p||!r||!ttl) throw Error('runtime verification set is incomplete');
  const expected=cameraModel==='k1'?'K1N29':'K12EN81';
  if(p.data.length!==4096||r.data.length<0x16B48||!dec.decode(ttl.data).includes(expected))
    throw Error('runtime verification set does not match '+expected);
  return {cameraModel,p:p.data,r:r.data,ttl:ttl.data,loadedAt:Date.now()};
}

function signed(value,bits) {
  const mask=2**bits, half=2**(bits-1);
  let v=((Math.trunc(value)%mask)+mask)%mask;
  return v>=half?v-mask:v;
}
function multiply(left,right) {
  const out=Array.from({length:3},()=>[0,0,0]);
  for(let y=0;y<3;y++) for(let x=0;x<3;x++) {
    let total=0;
    for(let k=0;k<3;k++) total+=signed(left[y][k],16)*signed(right[k][x],16);
    out[y][x]=signed(signed(total+4096,32)>>13,16);
  }
  return out;
}
function sourceCompile(source) {
  const mixed=multiply(source,META.commonQ13);
  const out=mixed.map(row=>row.map(v=>signed(Math.trunc(signed(v*128,32)/4096),16)));
  for(let r=0;r<3;r++) {
    let sum=0;
    for(let c=0;c<3;c++) if(c!==r) sum+=(out[r][c]&0xFFFF);
    out[r][r]=signed(256-sum,16);
  }
  return out.map(row=>row.map(v=>Math.max(-2048,Math.min(2047,v))));
}
function invert3(m) {
  const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2];
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,D=-(b*i-c*h),E=a*i-c*g,F=-(a*h-b*g),G=b*f-c*e,H=-(a*f-c*d),I=a*e-b*d;
  const det=a*A+b*B+c*C;
  if(Math.abs(det)<1e-12) throw Error('矩阵不可逆，无法编译机内参数');
  return [[A,D,G],[B,E,H],[C,F,I]].map(row=>row.map(v=>v/det));
}
function mm(a,b){return a.map(row=>[0,1,2].map(c=>row[0]*b[0][c]+row[1]*b[1][c]+row[2]*b[2][c]));}
function hardwareForSlot(slot) {
  if(slot.matrix_domain!=='natural_relative') return slot.matrix.map(r=>r.map(v=>Math.round(v)));
  const common=META.commonQ13.map(r=>r.map(v=>v/8192));
  return normalizeRows(mm(slot.matrix.map(r=>r.map(v=>v/256)),common).map(r=>r.map(v=>Math.round(v*256))));
}
function reverseCompose(hardware) {
  const desired=hardware.map(r=>r.map(v=>v*32));
  for(let r=0;r<3;r++) for(let c=0;c<3;c++) if(r!==c)
    desired[r][c]+=Math.sign(desired[r][c])*16;
  let source=mm(desired,invert3(META.commonQ13.map(r=>r.map(v=>v/8192)))).map(r=>r.map(v=>Math.round(v)));
  if(source.flat().some(v=>v<-32768||v>32767)) throw Error('矩阵超出机身 Q13 存储范围');
  let realized=sourceCompile(source);
  const exact=realized.flat().every((v,i)=>v===hardware.flat()[i]);
  if(exact) return {source,realized,exact:true};
  const adjusted=hardware.map(r=>r.map(v=>v*32));
  for(let r=0;r<3;r++) for(let c=0;c<3;c++) if(r!==c)
    adjusted[r][c]+=Math.sign(adjusted[r][c])*16;
  source=mm(adjusted,invert3(META.commonQ13.map(r=>r.map(v=>v/8192)))).map(r=>r.map(v=>Math.round(v)));
  realized=sourceCompile(source);
  const error=Math.max(...realized.flat().map((v,i)=>Math.abs(v-hardware.flat()[i])));
  if(error>2) throw Error('机内矩阵量化误差过大，拒绝导出');
  return {source,realized,exact:false};
}
function branch(site,target){return (0xEA000000|(((target-site-8)/4)&0xFFFFFF))>>>0;}
function put16(view,at,value){view.setInt16(at,value,true);}
function put32(view,at,value){view.setUint32(at,value>>>0,true);}

function titlePixels(name) {
  const canvas=document.createElement('canvas'); canvas.width=240; canvas.height=40;
  const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,240,40);
  let text=String(name||'CUST').replace(/[\x00-\x1F]/g,'').trim()||'CUST';
  let size=28;
  do { ctx.font=`600 ${size}px "Microsoft YaHei UI","PingFang SC",sans-serif`; size--; }
  while(ctx.measureText(text).width>234&&size>=10);
  while(ctx.measureText(text).width>234&&text.length>1) text=text.slice(0,-2)+'…';
  ctx.font=`600 ${size+1}px "Microsoft YaHei UI","PingFang SC",sans-serif`;
  ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(text,120,20);
  const rgba=ctx.getImageData(0,0,240,40).data;
  const out=new Uint8Array(240*40);
  for(let i=0;i<out.length;i++) out[i]=rgba[i*4+3]>96?7:0;
  return out;
}

function iconPixels() {
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,64,48);
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(9,8,46,32);
  ctx.font='700 17px Arial,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('C',32,24);
  const rgba=ctx.getImageData(0,0,64,48).data,out=new Uint8Array(64*48);
  for(let i=0;i<out.length;i++)out[i]=rgba[i*4+3]>96?7:0;
  return out;
}

async function fetchRuntimeBytes(candidates,label) {
  let last=null;
  for(const url of candidates){
    try{const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error('HTTP '+response.status);return new Uint8Array(await response.arrayBuffer());}
    catch(error){last=error;}
  }
  throw Error(label+' 加载失败：'+(last?.message||'unknown'));
}

async function sha256(bytes){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

const RUNTIME_SHA={
  k1ii:{
    'P.BIN':'5c59598cad7077a6b6f28407d82751ef1a568c78ec2ccdc7f12d2359095cccd9',
    'R.BIN':'5ea9ab6e862edb4a7eb215e48859c8f37a6e67ec9658a7f4eadfe6d5ca4186cf',
    // GitHub Pages serves text files with LF after Git normalization. Pin the
    // LF-normalized script identity, then restore CRLF before writing to SD.
    'startup.ttl':'08078abd909311fefb3627d8a5a632016e5b98f30b9d6225c9c5dd19038d3fb8',
  },
  k1:{
    'P.BIN':'c5cfb69843caf792f74ba14d38ae0456e99e64d342fa6ee1f989ab47fe7e47b2',
    'R.BIN':'f3727523cb5cd1807748bb555346b55253cafd382f6ba29560993ddf72e68d61',
    'startup.ttl':'7e061ec181ad2b48303d952da828ad72bcdf1d23fd2ba76cfd41ca5cace280d4',
  },
};

function lfNormalized(bytes){
  const out=[];
  for(let i=0;i<bytes.length;i++){
    if(bytes[i]===13&&bytes[i+1]===10)continue;
    out.push(bytes[i]);
  }
  return new Uint8Array(out);
}

function crlfNormalized(bytes){
  const lf=lfNormalized(bytes),out=[];
  for(const value of lf){if(value===10)out.push(13);out.push(value);}
  return new Uint8Array(out);
}

export async function loadBuiltinRuntime(cameraModel) {
  const key=cameraModel==='k1'?'k1':'k1ii';
  const root='./assets/runtime/'+key+'/';
  const source=key==='k1'?'../app/core/assets/k1_native_r29/':'../app/core/assets/p286/';
  const [p,r,ttl]=await Promise.all([
    fetchRuntimeBytes([root+'P.BIN',source+'P.BIN'],'P.BIN'),
    fetchRuntimeBytes([root+'R.BIN',source+'R.BIN'],'R.BIN'),
    fetchRuntimeBytes([root+'startup.ttl',source+'startup.ttl'],'startup.ttl'),
  ]);
  if(p.length!==4096) throw Error('内置 P.BIN 长度异常');
  if(r.length<0x16B48) throw Error('内置 R.BIN 长度异常');
  const hashes=await Promise.all([sha256(p),sha256(r),sha256(lfNormalized(ttl))]);
  for(const [name,actual] of [['P.BIN',hashes[0]],['R.BIN',hashes[1]],['startup.ttl',hashes[2]]])
    if(actual!==RUNTIME_SHA[key][name])throw Error(`${key} ${name} SHA256 不匹配，拒绝导出`);
  const expected=key==='k1'?'K1N29':'K12EN81';
  if(!dec.decode(ttl).includes(expected)) throw Error('内置脚本与当前机型不匹配：'+expected);
  return {cameraModel:key,p,r,ttl:crlfNormalized(ttl),loadedAt:Date.now(),builtin:true};
}

export function compileCameraScriptFiles(slots,cameraModel,base) {
  if(!base||base.cameraModel!==cameraModel) throw Error('当前机型的内置运行时尚未加载');
  const active=slots.filter(s=>s.enabled);
  if(active.length<1||active.length>3) throw Error('请启用 1～3 个自定义滤镜槽');
  const runtime=new Uint8Array(base.r); const rv=new DataView(runtime.buffer);
  for(let i=0;i<active.length;i++) {
    const slot=active[i];
    const requested=hardwareForSlot(slot);
    const compiled=reverseCompose(requested);
    const matrixAt=META.matrices[i];
    compiled.source.flat().forEach((v,n)=>put16(rv,matrixAt+n*2,v));
    const gammaAt=GAMMA+i*1536, curves=effectiveCurves(slot);
    for(let c=0;c<3;c++) for(let n=0;n<256;n++) {
      const value=Math.max(0,Math.min(WHITE,Math.round(curves[c][n])));
      rv.setUint16(gammaAt+(c*256+n)*2,value,true);
    }
    runtime.set(titlePixels((i+1)+' '+slot.name),META.titles[i]);
    runtime.set(iconPixels(),META.icons[i]);
  }
  put32(rv,MASK,(1<<active.length)-1);
  const focusAt=META.focusOriginal+4;
  put32(rv,focusAt,branch(focusAt,META.focus[active.length-1]+4));
  for(const guard of META.countGuards) {
    const current=rv.getUint32(guard.offset,true);
    if((current&0xFFFFFF00)!==(guard.word&0xFFFFFF00)) throw Error('R.BIN 菜单计数 guard 不匹配');
    put32(rv,guard.offset,(current&0xFFFFFF00)|active.length);
  }
  for(const [at,expected,replacement] of NATURAL_PATCHES) {
    const current=rv.getUint32(at,true);
    if(current!==expected&&current!==replacement) throw Error('R.BIN Natural identity guard 不匹配 @0x'+at.toString(16));
    put32(rv,at,replacement);
  }
  const stage=new Uint8Array(base.p); const sv=new DataView(stage.buffer);
  put32(sv,META.stageRuntimeCrcOffset,crc32(runtime));
  put32(sv,4092,crc32(stage.slice(0,4092)));
  const status=cameraModel==='k1'?'K1N29':'K12EN81';
  const reg=cameraModel==='k1'
    ?'C:\\script\\T\\P.BIN               ,   1080448556\r\n'
    :'C:\\script\\T\\P.BIN               ,   1080573344\r\n';
  return {
    'script/startup.ttl':base.ttl,
    'script/T/P.BIN':stage,
    'script/T/R.BIN':runtime,
    'script/T/REG.TXT':reg,
    [`script/${status}/STATUS.TXT`]:`NOT_RUN Pentax Labs Web; startup.ttl will overwrite this file.\r\n`,
    [`script/${status}/README.TXT`]:'Runtime output directory. Keep this directory on the SD card.\r\n',
  };
}

export function compileCameraScript(slots,cameraModel,base) {
  return zipStore(compileCameraScriptFiles(slots,cameraModel,base));
}

export function compileIstdFiles(slot) {
  if(!slot||slot.camera_model!=='istd')throw Error('当前槽不是 *ist D 参数');
  const matrix=slot.matrix.map(row=>row.map(v=>Math.round(Number(v))));
  if(matrix.flat().some(v=>v<-512||v>511)||matrix.some(row=>row.reduce((a,b)=>a+b,0)!==256))
    throw Error('*ist D 矩阵必须为 signed10 且每行和为 256');
  const gamma=(slot.masterCurve||[]).map(v=>Math.max(0,Math.min(255,Math.round(Number(v)*255/WHITE))));
  if(gamma.length!==4096)throw Error('*ist D 共享 Gamma 必须为 4096 点');
  for(let i=1;i<gamma.length;i++)if(gamma[i]<gamma[i-1])throw Error('*ist D Gamma 必须单调');
  const line=matrix.flat().join(',');
  const files={'SysParam.txt':enc.encode(`[RGBMATRIX1]\r\n${line}@\r\n[RGBMATRIX2]\r\n${line}@\r\n`)};
  for(let part=0;part<4;part++)files[`GamTbl${part}.txt`]=enc.encode(gamma.slice(part*1024,(part+1)*1024).map(v=>`${v}\r\n`).join(''));
  return files;
}

export function buildFocusZip(offset) {
  const original=[309,274,283,342,324,318,307,291,283,311,294,277,332,327,286,270,316,279,333,267];
  const delta=Math.max(-64,Math.min(64,Math.round(offset)));
  const lines=[];
  for(let first=0;first<original.length;first+=16) {
    const values=['":'+(0x320+first).toString(16).toUpperCase().padStart(4,'0')+'"'];
    for(const value of original.slice(first,first+16)) values.push('"'+(value+delta).toString(16).toUpperCase().padStart(4,'0')+'"');
    lines.push(values.join(','));
  }
  return zipStore({'KB321.EEP':lines.join('\r\n')+'\r\n','MODSET.TXT':'[EEPROM_LOAD]\r\n'});
}

export function base64Bytes(value) {
  const raw=atob(value); const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out;
}

export {zipStore};
