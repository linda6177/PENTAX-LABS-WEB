/* Pentax Labs Web engine.
 * Browser-side colour/model helpers. Camera runtime templates are loaded
 * separately by runtime.js so the colour engine stays deterministic.
 */

export const WHITE = 16383;
export const NODES = 256;
export const clamp01 = value => Math.min(1, Math.max(0, Number(value)));

let DISPLAY_KERNEL=null;
let ISTD_NATURAL_GAMMA=null;
let ISTD_DISPLAY_INDEX=null;

export function configureDisplayKernel(kernel, istdNaturalGamma=null) {
  DISPLAY_KERNEL=kernel||null;
  ISTD_NATURAL_GAMMA=istdNaturalGamma?Array.from(istdNaturalGamma,Number):null;
  if(ISTD_NATURAL_GAMMA?.length===4096){
    const first=new Array(256).fill(-1),last=new Array(256).fill(-1);
    ISTD_NATURAL_GAMMA.forEach((value,index)=>{const v=Math.max(0,Math.min(255,Math.round(value)));if(first[v]<0)first[v]=index;last[v]=index;});
    const known=[];for(let v=0;v<256;v++)if(first[v]>=0)known.push(v);
    ISTD_DISPLAY_INDEX=new Array(256);
    for(let code=0;code<256;code++){
      if(first[code]>=0){ISTD_DISPLAY_INDEX[code]=(first[code]+last[code])*.5/4095;continue;}
      let hi=known.find(v=>v>code),lo=[...known].reverse().find(v=>v<code);
      if(lo===undefined)lo=known[0];if(hi===undefined)hi=known[known.length-1];
      const a=(first[lo]+last[lo])*.5/4095,b=(first[hi]+last[hi])*.5/4095;
      ISTD_DISPLAY_INDEX[code]=hi===lo?a:a+(b-a)*(code-lo)/(hi-lo);
    }
  }
}

export function canonicalNaturalSlot(cameraModel='k1ii'){
  if(!DISPLAY_KERNEL)throw Error('display kernel not configured');
  return {
    name:'Natural',enabled:true,
    matrix:DISPLAY_KERNEL.natural_matrix_q8.map(row=>row.map(Number)),
    colorBaseMatrix:DISPLAY_KERNEL.natural_matrix_q8.map(row=>row.map(Number)),
    curves:DISPLAY_KERNEL.natural_camera_curves_u14.map(row=>row.map(Number)),
    masterCurve:identityCurve(),preset_key:'natural',matrix_domain:'natural_relative',camera_model:cameraModel,
    brightness_ev:0,contrast:0,color_hue:0,color_sat:1,user_preset_id:'',fit_report:{},sourceLut:null,
  };
}

export function identityCurve() {
  return Array.from({length:NODES}, (_, index) => index * WHITE / (NODES - 1));
}

export function cloneSlot(slot) {
  return {
    ...slot,
    matrix: slot.matrix.map(row => row.slice()),
    colorBaseMatrix: (slot.colorBaseMatrix || slot.matrix).map(row => row.slice()),
    curves: slot.curves.map(row => row.slice()),
    masterCurve: (slot.masterCurve || identityCurve()).slice(),
    fit_report: {...(slot.fit_report || {})},
    sourceLut: slot.sourceLut || null,
  };
}

export function normalizeRows(matrix) {
  const result = matrix.map(row => row.map(value => Math.round(Number(value) || 0)));
  for (let row = 0; row < 3; row++) {
    const other = [0,1,2].filter(column => column !== row);
    result[row][row] = 256 - result[row][other[0]] - result[row][other[1]];
  }
  return result;
}

export function slotFromFactory(row, cameraModel='k1ii') {
  if(cameraModel==='istd'){
    const gamma=(row.istd_gamma_u8||[]).map(value=>Number(value)*WHITE/255);
    return {
      name:row.label,enabled:true,
      matrix:row.istd_matrix_q8.map(values=>values.map(Number)),
      colorBaseMatrix:row.istd_matrix_q8.map(values=>values.map(Number)),
      curves:[identityCurve(),identityCurve(),identityCurve()],
      masterCurve:gamma.length===4096?gamma:Array.from({length:4096},(_,i)=>i*WHITE/4095),
      preset_key:'istd:'+row.key,matrix_domain:'legacy_native',camera_model:'istd',
      brightness_ev:0,contrast:0,color_hue:0,color_sat:1,user_preset_id:'',
      fit_report:{mean_de00:Number(row.istd_de00||0),p95_de00:Number(row.istd_p95||0),source:'Pentax Labs Beta81 *ist D production adaptation'},sourceLut:null,
    };
  }
  return {
    name: row.label,
    enabled: true,
    matrix: row.matrix_q8.map(values => values.map(Number)),
    colorBaseMatrix: row.matrix_q8.map(values => values.map(Number)),
    curves: row.curve_u14.map(values => values.map(Number)),
    masterCurve: identityCurve(),
    preset_key: row.key,
    matrix_domain: row.matrix_domain || 'natural_relative',
    camera_model: cameraModel,
    brightness_ev: 0,
    contrast: 0,
    color_hue: 0,
    color_sat: 1,
    user_preset_id: '',
    fit_report: {
      mean_de00: Number(row.model_de00 || 0),
      p95_de00: Number(row.model_p95 || 0),
      source: 'Pentax Labs Beta81 R367 production factory library',
    },
    sourceLut: null,
  };
}

function normalizeIstdMatrix(matrix){
  const out=matrix.map(row=>row.map(Number));
  for(let r=0;r<3;r++){
    const drift=(out[r].reduce((a,b)=>a+b,0)-256)/3;
    out[r]=out[r].map(v=>Math.max(-512,Math.min(511,Math.round(v-drift))));
    let remain=256-out[r].reduce((a,b)=>a+b,0);
    for(let pass=0;pass<3&&remain;pass++){
      let best=0,bestRoom=-1;
      for(let c=0;c<3;c++){const room=remain>0?511-out[r][c]:out[r][c]+512;if(room>bestRoom){bestRoom=room;best=c;}}
      const step=Math.min(Math.abs(remain),Math.max(0,bestRoom))*(remain>0?1:-1);out[r][best]+=step;remain-=step;
    }
  }
  return out;
}

function gaplessGamma(values){
  const desired=values.map(v=>Math.max(0,Math.min(255,Math.round(v))));
  const out=new Array(desired.length);out[0]=desired[0];
  for(let i=1;i<out.length;i++)out[i]=Math.max(out[i-1],Math.min(out[i-1]+1,desired[i]));
  for(let i=out.length-2;i>=0;i--)out[i]=Math.min(out[i],out[i+1]);
  return out;
}

export function adaptSlotToIstd(sourceSlot,naturalIstdSlot){
  const relative=sourceSlot.matrix_domain==='natural_relative'?sourceSlot.matrix:[[256,0,0],[0,256,0],[0,0,256]];
  const matrix=normalizeIstdMatrix(matrixMultiply(relative.map(r=>r.map(v=>v/256)),naturalIstdSlot.matrix)
    .map(r=>r.map(v=>Math.round(v))));
  const curves=effectiveCurves(sourceSlot),weights=[.2126,.7152,.0722];
  const shared=Array.from({length:4096},(_,i)=>{
    const x=i/4095;return weights.reduce((sum,w,c)=>sum+w*curveAt(curves[c],x)/WHITE,0)*255;
  });
  const gamma=gaplessGamma(shared);
  return {
    ...cloneSlot(sourceSlot),matrix,colorBaseMatrix:matrix.map(r=>r.slice()),
    curves:[identityCurve(),identityCurve(),identityCurve()],masterCurve:gamma.map(v=>v*WHITE/255),
    preset_key:'istd:user-adapted',matrix_domain:'legacy_native',camera_model:'istd',
    brightness_ev:0,contrast:0,color_hue:0,color_sat:1,
  };
}

function matrixMultiply(a,b) {
  return a.map((row,r) => [0,1,2].map(c =>
    row[0]*b[0][c] + row[1]*b[1][c] + row[2]*b[2][c]));
}

function invert3(matrix) {
  const m=matrix;
  const a=m[0][0],b=m[0][1],c=m[0][2],d=m[1][0],e=m[1][1],f=m[1][2],g=m[2][0],h=m[2][1],i=m[2][2];
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,D=-(b*i-c*h),E=a*i-c*g,F=-(a*h-b*g),G=b*f-c*e,H=-(a*f-c*d),I=a*e-b*d;
  const det=a*A+b*B+c*C;
  if (Math.abs(det)<1e-12) throw Error('Natural 矩阵不可逆');
  return [[A,D,G],[B,E,H],[C,F,I]].map(row=>row.map(v=>v/det));
}

function matrixReference(naturalSlot,reference=null) {
  return (reference || naturalSlot.matrix).map(row=>row.map(Number));
}

export function displayMatrix(slot,naturalSlot,reference=null) {
  const relative=matrixMultiply(slot.matrix.map(r=>r.map(v=>v/256)),
    invert3(matrixReference(naturalSlot,reference).map(r=>r.map(v=>v/256))));
  return normalizeRows(relative.map(r=>r.map(v=>Math.round(v*256))));
}

export function setDisplayMatrix(slot,naturalSlot,display,reference=null) {
  const actual=matrixMultiply(display.map(r=>r.map(v=>v/256)), matrixReference(naturalSlot,reference));
  slot.matrix=normalizeRows(actual);
  return slot.matrix;
}

function interp(values,x) {
  const point=clamp01(x)*(values.length-1);
  const left=Math.min(values.length-2,Math.floor(point));
  const f=point-left;
  return values[left]*(1-f)+values[left+1]*f;
}

function smoothFactoryApprox(curve) {
  let values=curve.map(v=>Number(v)/WHITE);
  const kernel=[1/16,4/16,6/16,4/16,1/16];
  for(let pass=0;pass<2;pass++) {
    const next=new Array(values.length);
    for(let i=0;i<values.length;i++) {
      let sum=0;
      for(let k=-2;k<=2;k++) sum+=values[Math.max(0,Math.min(values.length-1,i+k))]*kernel[k+2];
      next[i]=sum;
    }
    values=next;
  }
  return values;
}

function istdToneDisplay(master,count=257){
  if(!ISTD_NATURAL_GAMMA?.length)return Array.from({length:count},(_,i)=>i/(count-1));
  const current=(master||[]).map(v=>Math.max(0,Math.min(255,Math.round(Number(v)*255/WHITE))));
  const counts=new Array(256).fill(0),sums=new Array(256).fill(0);
  for(let i=0;i<4096;i++){const code=ISTD_NATURAL_GAMMA[i];counts[code]++;sums[code]+=current[i]-code;}
  const known=[];for(let i=0;i<256;i++)if(counts[i])known.push(i);
  const delta=new Array(256);
  for(let code=0;code<256;code++){
    if(counts[code]){delta[code]=sums[code]/counts[code];continue;}
    let hi=known.find(v=>v>code),lo=[...known].reverse().find(v=>v<code);if(lo===undefined)lo=known[0];if(hi===undefined)hi=known[known.length-1];
    const a=sums[lo]/counts[lo],b=sums[hi]/counts[hi];delta[code]=hi===lo?a:a+(b-a)*(code-lo)/(hi-lo);
  }
  const kernel=[];let total=0;for(let d=-18;d<=18;d++){const v=Math.exp(-.5*(d/4.5)**2);kernel.push(v);total+=v;}for(let i=0;i<kernel.length;i++)kernel[i]/=total;
  const smooth=new Array(256).fill(0);
  for(let x=0;x<256;x++)for(let k=-18;k<=18;k++){let at=x+k;if(at<0)at=-at;if(at>255)at=510-at;smooth[x]+=delta[at]*kernel[k+18];}
  const values=new Array(256);let last=0;for(let i=0;i<256;i++){last=Math.max(last,Math.max(0,Math.min(255,i+smooth[i])));values[i]=last;}
  if(current[0]===0&&current.at(-1)===255)for(let i=0;i<256;i++)values[i]=.985*values[i]+.015*i;
  values[0]=current[0]||0;values[255]=current.at(-1)??255;
  return Array.from({length:count},(_,i)=>interp(values,i/(count-1))/255);
}

export function relativeCurve(slot,naturalSlot,channel,profiles=null,factoryBase=null) {
  const axis=profiles?.axis || Array.from({length:257},(_,i)=>i/256);
  if(slot.camera_model==='istd')return channel===0?istdToneDisplay(slot.masterCurve,axis.length):axis.slice();
  if (channel===0) {
    const master=(slot.masterCurve||identityCurve()).map(v=>clamp01(v/WHITE));
    return axis.map(x=>interp(master,x));
  }
  if (!profiles) {
    const current=slot.curves[channel-1], natural=naturalSlot.curves[channel-1];
    return axis.map(x=>clamp01(x+interp(current.map(v=>v/WHITE),x)-interp(natural.map(v=>v/WHITE),x)));
  }
  // Match desktop relative_curves.py exactly: production factory keys are
  // namespaced (for example k12:bright), so the measured display reference
  // intentionally falls back to Natural. Only legacy plain keys use their
  // matching P317 measured profile.
  const rawKey=String(slot.preset_key||'natural');
  const key=profiles.profiles[rawKey]?rawKey:'natural';
  let tone=profiles.profiles[key][channel-1].slice();
  const base=profiles.native_reference?.[key]?.[channel-1]
    || (profiles.profiles[rawKey]?factoryBase:naturalSlot)?.curves?.[channel-1]
    || naturalSlot.curves[channel-1];
  const current=slot.curves[channel-1];
  let changed=false;
  for(let i=0;i<NODES;i++) if(Math.round(current[i])!==Math.round(base[i])) {changed=true;break;}
  if(changed) {
    const a=smoothFactoryApprox(current), b=smoothFactoryApprox(base);
    for(let i=0;i<tone.length;i++) {
      const x=i/(tone.length-1);
      tone[i]=clamp01(tone[i]+interp(a,x)-interp(b,x));
    }
    tone=isotonic(tone,tone.map(()=>1));
  }
  return axis.map((x,i)=>clamp01(
    x + interp(tone,profiles.latent[i]) - profiles.natural_at_latent[channel-1][i]));
}

export function applyRelativeCurve(slot,naturalSlot,channel,target,previous,profiles=null) {
  const clean=target.map(clamp01);
  const delta=clean.map((value,i)=>value-previous[i]);
  if (channel===0) {
    const master=slot.masterCurve||identityCurve();
    const values=master.map((value,i)=>
      Math.round(clamp01(value/WHITE+interp(delta,i/Math.max(master.length-1,1)))*WHITE));
    for(let i=1;i<values.length;i++) values[i]=Math.max(values[i],values[i-1]);
    slot.masterCurve=values;
    return;
  }
  if(slot.camera_model==='istd')return;
  const displayAxis=profiles?.natural_native_display?.[channel-1] ||
    Array.from({length:NODES},(_,i)=>i/(NODES-1));
  const native=slot.curves[channel-1].map((value,i)=>
    Math.round(clamp01(value/WHITE+interp(delta,displayAxis[i]))*WHITE));
  for(let i=1;i<native.length;i++) native[i]=Math.max(native[i],native[i-1]);
  slot.curves[channel-1]=native;
}

export function smoothCurveTarget(baseline,x,y){
  const values=baseline.map(clamp01),center=clamp01(x),target=clamp01(y),at=interp(values,center);
  const delta=target-at,width=.115;
  const shaped=values.map((value,index)=>{
    const t=index/Math.max(values.length-1,1);
    const gaussian=Math.exp(-.5*((t-center)/width)**2);
    const edge=(center>1e-4&&center<.9999)?Math.min(1,(t*(1-t))/Math.max(center*(1-center),1e-6)):gaussian;
    return clamp01(value+delta*gaussian*edge);
  });
  shaped[0]=values[0];shaped[shaped.length-1]=values.at(-1);
  return isotonic(shaped,shaped.map(()=>1));
}

export function saturationMatrix(strength) {
  const lum=[.2126,.7152,.0722];
  const m=Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>
    lum[c]*(1-strength)+(r===c?strength:0)));
  return normalizeRows(m.map(row=>row.map(v=>Math.round(v*256))));
}

export function hueMatrix(degrees) {
  const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),q=Math.sqrt(3);
  const k=[[0,-1/q,1/q],[1/q,0,-1/q],[-1/q,1/q,0]];
  const kk=matrixMultiply(k,k);
  const m=Array.from({length:3},(_,r)=>Array.from({length:3},(_,col)=>
    (r===col?1:0)+s*k[r][col]+(1-c)*kk[r][col]));
  return normalizeRows(m.map(row=>row.map(v=>Math.round(v*256))));
}

export function applyColorControls(baseMatrix,saturation=1,hue=0) {
  let matrix=baseMatrix.map(row=>row.map(Number));
  if(Math.abs(saturation-1)>.001)
    matrix=matrixMultiply(matrix,saturationMatrix(saturation)).map(row=>row.map(v=>v/256));
  if(Math.abs(hue)>.001)
    matrix=matrixMultiply(matrix,hueMatrix(hue)).map(row=>row.map(v=>v/256));
  return matrix.map(row=>row.map(v=>Math.round(v)));
}

export function parseCube(text, filename='Imported.cube') {
  let size = 0;
  let dimension = 3;
  let title = filename.replace(/\.cube$/i, '');
  let domainMin = [0,0,0];
  let domainMax = [1,1,1];
  const values = [];
  let started = false;
  const headers = new Set();
  const numeric = /^[+\-.\d]/;
  for (const [index, sourceLine] of String(text).split(/\r?\n/).entries()) {
    const line = sourceLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const fields = line.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const key = (fields[0] || '').toUpperCase();
    if (['TITLE','DOMAIN_MIN','DOMAIN_MAX','LUT_1D_SIZE','LUT_3D_SIZE'].includes(key)) {
      if (started) throw Error('第 ' + (index + 1) + ' 行：LUT 数据之后不能再写头部');
      if (headers.has(key)) throw Error('重复的 CUBE 头部：' + key);
      headers.add(key);
      if (key === 'TITLE') {
        title = fields.slice(1).join(' ').replace(/^["']|["']$/g, '') || title;
      } else if (key === 'LUT_1D_SIZE') {
        dimension = 1;
        size = Number(fields[1]);
      } else if (key === 'LUT_3D_SIZE') {
        dimension = 3;
        size = Number(fields[1]);
      } else {
        const vector = fields.slice(1,4).map(Number);
        if (vector.length !== 3 || vector.some(value => !Number.isFinite(value))) {
          throw Error(key + ' 必须包含 3 个有限数值');
        }
        if (key === 'DOMAIN_MIN') domainMin = vector;
        else domainMax = vector;
      }
      continue;
    }
    if (key.startsWith('LUT_') || key.startsWith('DOMAIN_')) {
      throw Error('不支持的 CUBE 头部：' + key);
    }
    if (!numeric.test(line)) continue;
    if (!size) throw Error('第 ' + (index + 1) + ' 行：请先声明 LUT_3D_SIZE');
    if (fields.length !== 3) throw Error('第 ' + (index + 1) + ' 行：需要 3 个 RGB 输出值');
    started = true;
    values.push(...fields.map(Number));
  }
  if (dimension !== 3) throw Error('网页版当前只接收 3D .cube');
  if (!Number.isInteger(size) || size < 2 || size > 65) {
    throw Error('网页版支持 2–65 网格的 3D .cube');
  }
  if (values.length !== size ** 3 * 3) {
    throw Error('LUT 节点数量不匹配：' + (values.length / 3) + ' / ' + (size ** 3));
  }
  if (values.some(value => !Number.isFinite(value))) throw Error('CUBE 含非有限 RGB 数值');
  if (domainMin.some((value, i) => !Number.isFinite(value) ||
      !Number.isFinite(domainMax[i]) || domainMax[i] <= value)) {
    throw Error('DOMAIN_MIN / DOMAIN_MAX 不正确');
  }
  return {
    id: 'lut:' + crypto.randomUUID(),
    name: title.slice(0, 60),
    filename,
    size,
    min: domainMin,
    max: domainMax,
    data: new Float32Array(values),
  };
}

export function evaluateCube(cube, rgb) {
  const n = cube.size;
  const hi = n - 1;
  const point = rgb.map((value, channel) =>
    clamp01((value - cube.min[channel]) / (cube.max[channel] - cube.min[channel])) * hi);
  const base = point.map(value => Math.min(hi - 1, Math.floor(value)));
  const frac = point.map((value, channel) => value - base[channel]);
  const out = [0,0,0];
  const offset = (r,g,b) => ((b * n + g) * n + r) * 3;
  for (let db = 0; db <= 1; db++) {
    for (let dg = 0; dg <= 1; dg++) {
      for (let dr = 0; dr <= 1; dr++) {
        const weight =
          (dr ? frac[0] : 1-frac[0]) *
          (dg ? frac[1] : 1-frac[1]) *
          (db ? frac[2] : 1-frac[2]);
        const at = offset(base[0] + dr, base[1] + dg, base[2] + db);
        out[0] += cube.data[at] * weight;
        out[1] += cube.data[at + 1] * weight;
        out[2] += cube.data[at + 2] * weight;
      }
    }
  }
  return out.map(clamp01);
}

function effectiveCurve(curve, masterCurve, contrast=0, brightnessEv=0) {
  const power = Math.max(.25, 1 + Number(contrast || 0) / 100);
  const gain = 2 ** Number(brightnessEv || 0);
  const master=(masterCurve||identityCurve()).map(v=>clamp01(v/WHITE));
  return curve.map(raw => {
    let value = curveAt(master, clamp01(raw / WHITE));
    if (contrast) {
      const high = value ** power;
      const low = (1 - value) ** power;
      value = high / Math.max(high + low, 1e-12);
    }
    return clamp01(value * gain);
  });
}

export function effectiveCurves(slot) {
  return slot.curves.map(curve =>
    effectiveCurve(curve,slot.masterCurve,slot.contrast||0,slot.brightness_ev||0)
      .map(value=>Math.round(clamp01(value)*WHITE)));
}

function curveAt(curve, value) {
  const x = clamp01(value) * (curve.length - 1);
  const left = Math.min(curve.length - 2, Math.floor(x));
  const fraction = x - left;
  return curve[left] * (1-fraction) + curve[left + 1] * fraction;
}

export function nativeStageAt(slot, rgb) {
  const mixed = [0,0,0];
  for (let row=0; row<3; row++) {
    mixed[row] = clamp01(
      (slot.matrix[row][0] * rgb[0] +
       slot.matrix[row][1] * rgb[1] +
       slot.matrix[row][2] * rgb[2]) / 256);
  }
  const curves = slot.curves.map(curve =>
    effectiveCurve(curve, slot.masterCurve, slot.contrast || 0, slot.brightness_ev || 0));
  return mixed.map((value, channel) => curveAt(curves[channel], value));
}

function prepareStage(slot) {
  return {
    matrix: slot.matrix.map(row => row.map(Number)),
    curves: slot.curves.map(curve =>
      effectiveCurve(curve, slot.masterCurve, slot.contrast || 0, slot.brightness_ev || 0)),
  };
}

function preparedStageAt(stage, rgb) {
  const mixed = [0,0,0];
  for (let row=0; row<3; row++) {
    mixed[row] = clamp01(
      (stage.matrix[row][0] * rgb[0] +
       stage.matrix[row][1] * rgb[1] +
       stage.matrix[row][2] * rgb[2]) / 256);
  }
  return mixed.map((value, channel) => curveAt(stage.curves[channel], value));
}

function hardwarePreviewMatrix(slot) {
  if(!DISPLAY_KERNEL)return slot.matrix.map(row=>row.map(Number));
  if(slot.matrix_domain!=='natural_relative')return slot.matrix.map(row=>row.map(Number));
  const common=DISPLAY_KERNEL.common_q13.map(row=>row.map(v=>Number(v)/8192));
  return normalizeRows(matrixMultiply(slot.matrix.map(row=>row.map(v=>Number(v)/256)),common)
    .map(row=>row.map(v=>Math.round(v*256))));
}

function interpolateArray(values,x) {
  const point=clamp01(x)*(values.length-1),left=Math.min(values.length-2,Math.floor(point)),f=point-left;
  return Number(values[left])*(1-f)+Number(values[left+1])*f;
}

function p317Tones(slot) {
  const scale=Number(DISPLAY_KERNEL.scale||16380),base=DISPLAY_KERNEL.natural_table_u16;
  const natural=DISPLAY_KERNEL.natural_camera_curves_u14;
  const current=effectiveCurves(slot);
  return [0,1,2].map(channel=>{
    const currentApprox=smoothFactoryApprox(current[channel]);
    const naturalApprox=smoothFactoryApprox(natural[channel]);
    const correction=currentApprox.map((value,index)=>value-naturalApprox[index]);
    const candidate=new Array(scale+1);
    for(let i=0;i<=scale;i++)candidate[i]=clamp01(Number(base[channel][i])/scale+interpolateArray(correction,i/scale));
    return isotonic(candidate,new Array(candidate.length).fill(1));
  });
}

function prepareP317(slot) {
  const hardware=hardwarePreviewMatrix(slot).map(row=>row.map(v=>v/256));
  const natural=DISPLAY_KERNEL.natural_hardware_q8.map(row=>row.map(v=>Number(v)/256));
  return {kind:'p317',matrix:matrixMultiply(hardware,invert3(natural)),tones:p317Tones(slot)};
}

const ISTD_FACTORY_MATRIX=[[391,-145,10],[-36,352,-60],[-12,-50,318]];
function prepareIstd(slot){
  const gamma=(slot.masterCurve||[]).map(value=>Math.max(0,Math.min(255,Math.round(Number(value)*255/WHITE))));
  return {kind:'istd',matrix:slot.matrix.map(row=>row.map(v=>Number(v)/256)),gamma};
}

export function prepareRelativeProxy(slot, naturalSlot) {
  if(slot.camera_model==='istd'&&ISTD_DISPLAY_INDEX)return prepareIstd(slot);
  if(DISPLAY_KERNEL)return prepareP317(slot);
  return {kind:'legacy',style:prepareStage(slot),natural:prepareStage(naturalSlot)};
}

export function applyPreparedRelative(prepared, rgb) {
  if(prepared.kind==='p317'){
    const codes=rgb.map(value=>Math.max(0,Math.min(255,Math.round(clamp01(value)*255))));
    const latent=codes.map(code=>Number(DISPLAY_KERNEL.byte_inverse[code]));
    const mixed=prepared.matrix.map(row=>clamp01(row[0]*latent[0]+row[1]*latent[1]+row[2]*latent[2]));
    return rgb.map((value,channel)=>clamp01(value+interpolateArray(prepared.tones[channel],mixed[channel])-
      Number(DISPLAY_KERNEL.byte_roundtrip[codes[channel]][channel])));
  }
  if(prepared.kind==='istd'){
    const inv=invert3(ISTD_FACTORY_MATRIX.map(row=>row.map(v=>v/256)));
    const index=rgb.map(value=>ISTD_DISPLAY_INDEX[Math.max(0,Math.min(255,Math.round(clamp01(value)*255)))]);
    // Desktop istd.sensor_proxy uses row-vector index @ inv(factory).T.
    // That is the dot product of each *row* of inv(factory) with index.
    const sensor=inv.map(row=>row[0]*index[0]+row[1]*index[1]+row[2]*index[2]);
    const mapped=prepared.matrix.map(row=>clamp01(row[0]*sensor[0]+row[1]*sensor[1]+row[2]*sensor[2]));
    return mapped.map(value=>Number(prepared.gamma[Math.max(0,Math.min(4095,Math.round(value*4095)))])/255);
  }
  const style=preparedStageAt(prepared.style,rgb),natural=preparedStageAt(prepared.natural,rgb);
  return rgb.map((value,channel)=>clamp01(value+style[channel]-natural[channel]));
}

export function applyRelativeProxy(slot, naturalSlot, rgb) {
  return applyPreparedRelative(prepareRelativeProxy(slot, naturalSlot), rgb);
}

export function transformPixel(slot, naturalSlot, rgb, mode='camera') {
  if (mode === 'lut' && slot.sourceLut) return evaluateCube(slot.sourceLut, rgb);
  return applyRelativeProxy(slot, naturalSlot, rgb);
}

function inverseCurve(curve, value) {
  const target = clamp01(value);
  let low = 0;
  let high = curve.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (curve[mid] < target) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  const a = curve[low - 1];
  const b = curve[low];
  const fraction = b > a ? (target - a) / (b - a) : 0;
  return clamp01((low - 1 + fraction) / (curve.length - 1));
}

function solve2(features, target, weights) {
  let aa=0, ab=0, bb=0, ay=0, by=0;
  for (let i=0; i<target.length; i++) {
    const w = weights[i];
    const a = features[i][0];
    const b = features[i][1];
    const y = target[i];
    aa += w*a*a;
    ab += w*a*b;
    bb += w*b*b;
    ay += w*a*y;
    by += w*b*y;
  }
  aa += 1e-7;
  bb += 1e-7;
  const determinant = aa*bb - ab*ab;
  if (Math.abs(determinant) < 1e-12) return [0,0];
  return [(ay*bb - by*ab)/determinant, (by*aa - ay*ab)/determinant];
}

function fitMatrix(samples, targetPreTone, weights) {
  const matrix = [[256,0,0],[0,256,0],[0,0,256]];
  for (let channel=0; channel<3; channel++) {
    const others = [0,1,2].filter(index => index !== channel);
    const features = samples.map(sample => [
      sample[others[0]] - sample[channel],
      sample[others[1]] - sample[channel],
    ]);
    const target = targetPreTone.map((row,index) => row[channel] - samples[index][channel]);
    const solved = solve2(features, target, weights);
    matrix[channel][others[0]] = Math.round(solved[0] * 256);
    matrix[channel][others[1]] = Math.round(solved[1] * 256);
  }
  return normalizeRows(matrix).map(row =>
    row.map(value => Math.max(-2048, Math.min(2047, value))));
}

function isotonic(values, weights) {
  const levels = [];
  const mass = [];
  const starts = [];
  for (let i=0; i<values.length; i++) {
    levels.push(values[i]);
    mass.push(Math.max(weights[i], 1e-6));
    starts.push(i);
    while (levels.length > 1 && levels[levels.length-2] > levels[levels.length-1]) {
      const total = mass[mass.length-2] + mass[mass.length-1];
      levels[levels.length-2] =
        (levels[levels.length-2]*mass[mass.length-2] +
         levels[levels.length-1]*mass[mass.length-1]) / total;
      mass[mass.length-2] = total;
      levels.pop();
      mass.pop();
      starts.pop();
    }
  }
  const result = new Array(values.length);
  for (let group=0; group<starts.length; group++) {
    const end = group + 1 < starts.length ? starts[group+1] : values.length;
    for (let index=starts[group]; index<end; index++) {
      result[index] = clamp01(levels[group]);
    }
  }
  return result;
}

function fitCurve(xs, ys, weights) {
  const sum = new Float64Array(NODES);
  const mass = new Float64Array(NODES);
  for (let i=0; i<xs.length; i++) {
    const point = clamp01(xs[i]) * (NODES - 1);
    const left = Math.min(NODES - 2, Math.floor(point));
    const fraction = point - left;
    const weight = weights[i];
    sum[left] += ys[i] * weight * (1-fraction);
    mass[left] += weight * (1-fraction);
    sum[left+1] += ys[i] * weight * fraction;
    mass[left+1] += weight * fraction;
  }
  const values = new Array(NODES).fill(null);
  for (let i=0; i<NODES; i++) {
    if (mass[i] > 1e-9) values[i] = sum[i] / mass[i];
  }
  let previous = -1;
  for (let i=0; i<NODES; i++) {
    if (values[i] === null) continue;
    if (previous < 0) {
      for (let k=0; k<i; k++) values[k] = values[i];
    } else if (i - previous > 1) {
      const a = values[previous];
      const b = values[i];
      for (let k=previous+1; k<i; k++) {
        values[k] = a + (b-a) * (k-previous)/(i-previous);
      }
    }
    previous = i;
  }
  if (previous < 0) return identityCurve();
  for (let i=previous+1; i<NODES; i++) values[i] = values[previous];
  return isotonic(values, Array.from(mass, value => Math.max(value, .1)))
    .map(value => Math.round(value * WHITE));
}

function naturalInverseContinuous(rgb){
  const scale=Number(DISPLAY_KERNEL?.scale||16380),tables=DISPLAY_KERNEL?.natural_table_u16;
  if(!tables)return rgb.slice();
  return rgb.map((value,channel)=>{
    const table=tables[channel],target=clamp01(value)*scale;let lo=0,hi=table.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(Number(table[mid])<target)lo=mid+1;else hi=mid;}
    if(lo===0)return 0;const a=Number(table[lo-1]),b=Number(table[lo]);
    return clamp01((lo-1+(b>a?(target-a)/(b-a):0))/(table.length-1));
  });
}

function naturalForwardContinuous(rgb){
  const scale=Number(DISPLAY_KERNEL?.scale||16380),tables=DISPLAY_KERNEL?.natural_table_u16;
  if(!tables)return rgb.slice();
  return rgb.map((value,channel)=>interpolateArray(tables[channel],clamp01(value))/scale);
}

function monotoneProjection256(values,weights){
  const slope=1/16383,adjusted=values.map((v,i)=>v-slope*i),projected=isotonic(adjusted,weights);
  return projected.map((v,i)=>clamp01(v+slope*i));
}

function fitSmoothCurveR367(xs,target,baseline,weights){
  const diagonal=new Float64Array(256),upper=new Float64Array(255),rhs=new Float64Array(256);
  for(let n=0;n<xs.length;n++){
    const x=clamp01(xs[n])*255,i=Math.min(254,Math.floor(x)),f=x-i,a=1-f,b=f,w=weights[n];
    const residual=target[n]-(baseline[i]*a+baseline[i+1]*b);
    diagonal[i]+=a*a*w;diagonal[i+1]+=b*b*w;upper[i]+=a*b*w;rhs[i]+=a*residual*w;rhs[i+1]+=b*residual*w;
  }
  const nodeWeights=Array.from(diagonal);const strength=Math.max(2,weights.reduce((a,b)=>a+b,0)/15625*10);
  for(let i=0;i<256;i++)diagonal[i]+=.15*strength+(i===0||i===255?strength:2*strength);
  for(let i=0;i<255;i++)upper[i]-=strength;
  for(let i=1;i<256;i++){const scale=upper[i-1]/diagonal[i-1];diagonal[i]-=scale*upper[i-1];rhs[i]-=scale*rhs[i-1];}
  const correction=new Float64Array(256);correction[255]=rhs[255]/diagonal[255];
  for(let i=254;i>=0;i--)correction[i]=(rhs[i]-upper[i]*correction[i+1])/diagonal[i];
  return monotoneProjection256(baseline.map((v,i)=>v+correction[i]),nodeWeights.map(v=>Math.max(v,.1))).map(v=>Math.round(v*WHITE));
}

function percentile(values,p){
  const a=values.slice().sort((x,y)=>x-y),pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return a[lo]*(hi-pos)+a[hi]*(pos-lo);
}

function weightedPercentile(values,weights,p){
  const pairs=values.map((v,i)=>[v,weights[i]]).sort((a,b)=>a[0]-b[0]),total=weights.reduce((a,b)=>a+b,0),target=total*p;let sum=0;
  for(const [value,weight] of pairs){sum+=weight;if(sum>=target)return value;}return pairs.at(-1)?.[0]??0;
}

function refitMatrixR367(raw,targetStage,curves,weights,naturalSlot){
  const toneSlot={...canonicalNaturalSlot(),curves:curves.map(row=>row.slice())},tones=p317Tones(toneSlot),matrix=[[256,0,0],[0,256,0],[0,0,256]];
  for(let c=0;c<3;c++){
    const others=[0,1,2].filter(i=>i!==c),features=[],target=[],useWeights=[];
    for(let i=0;i<raw.length;i++){
      const wantedValue=targetStage[i][c];if(wantedValue<=.015||wantedValue>=.985)continue;
      const wanted=inverseCurve(tones[c],wantedValue);
      features.push([raw[i][others[0]]-raw[i][c],raw[i][others[1]]-raw[i][c]]);target.push(wanted-raw[i][c]);useWeights.push(weights[i]);
    }
    if(target.length<50)continue;const coef=solve2(features,target,useWeights);matrix[c][others[0]]=Math.round(coef[0]*256);matrix[c][others[1]]=Math.round(coef[1]*256);matrix[c][c]=256-matrix[c][others[0]]-matrix[c][others[1]];
  }
  return normalizeRows(matrix).map(row=>row.map(v=>Math.max(-2048,Math.min(2047,v))));
}

function srgbLab(rgb){
  const lin=rgb.map(v=>{v=clamp01(v);return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
  const x=(.4124564*lin[0]+.3575761*lin[1]+.1804375*lin[2])/.95047;
  const y=(.2126729*lin[0]+.7151522*lin[1]+.072175*lin[2]);
  const z=(.0193339*lin[0]+.119192*lin[1]+.9503041*lin[2])/1.08883;
  const f=v=>v>216/24389?Math.cbrt(v):(24389/27*v+16)/116,fx=f(x),fy=f(y),fz=f(z);
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
}

function de00(l1,l2){
  const [L1,a1,b1]=l1,[L2,a2,b2]=l2,C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),C=(C1+C2)/2;
  const G=.5*(1-Math.sqrt(C**7/(C**7+25**7))),ap1=(1+G)*a1,ap2=(1+G)*a2,cp1=Math.hypot(ap1,b1),cp2=Math.hypot(ap2,b2);
  const hp=(a,b)=>{let h=Math.atan2(b,a)*180/Math.PI;if(h<0)h+=360;return h;},h1=hp(ap1,b1),h2=hp(ap2,b2);
  const dL=L2-L1,dC=cp2-cp1,dh=(cp1*cp2===0)?0:(Math.abs(h2-h1)<=180?h2-h1:(h2<=h1?h2-h1+360:h2-h1-360));
  const dH=2*Math.sqrt(cp1*cp2)*Math.sin((dh*Math.PI/180)/2),Lm=(L1+L2)/2,Cm=(cp1+cp2)/2;
  const hm=(cp1*cp2===0)?h1+h2:(Math.abs(h1-h2)<=180?(h1+h2)/2:(h1+h2<360?(h1+h2+360)/2:(h1+h2-360)/2));
  const T=1-.17*Math.cos((hm-30)*Math.PI/180)+.24*Math.cos(2*hm*Math.PI/180)+.32*Math.cos((3*hm+6)*Math.PI/180)-.20*Math.cos((4*hm-63)*Math.PI/180);
  const dTheta=30*Math.exp(-(((hm-275)/25)**2)),Rc=2*Math.sqrt(Cm**7/(Cm**7+25**7)),Sl=1+.015*(Lm-50)**2/Math.sqrt(20+(Lm-50)**2),Sc=1+.045*Cm,Sh=1+.015*Cm*T,Rt=-Math.sin(2*dTheta*Math.PI/180)*Rc;
  return Math.sqrt((dL/Sl)**2+(dC/Sc)**2+(dH/Sh)**2+Rt*(dC/Sc)*(dH/Sh));
}

function sampleTarget(cube, naturalSlot, grid=25) {
  const samples=[],desired=[],untoned=[],reference=[],baseWeights=[];
  const add=(rgb,weight)=>{const latent=naturalInverseContinuous(rgb),target=evaluateCube(cube,rgb);samples.push(rgb);desired.push(target);untoned.push(latent);reference.push(naturalForwardContinuous(latent));baseWeights.push(weight);};
  for (let b=0; b<grid; b++) {
    for (let g=0; g<grid; g++) {
      for (let r=0; r<grid; r++) {
        add([r/(grid-1),g/(grid-1),b/(grid-1)],1);
      }
    }
  }
  for (let i=0; i<256; i++) {
    const value = i / 255;
    add([value,value,value],64);
  }
  const focus=desired.map(row=>{const level=(row[0]+row[1]+row[2])/3;return 1/Math.sqrt(.08+level)*(1+1.15*Math.exp(-.5*((level-.30)/.14)**2));});
  const rms=Math.sqrt(focus.reduce((s,v)=>s+v*v,0)/focus.length),weights=baseWeights.map((w,i)=>w*focus[i]/rms);
  const targetStage=desired.map((row,i)=>row.map((v,c)=>clamp01(v-samples[i][c]+reference[i][c])));
  return {samples,desired,untoned,reference,targetStage,weights,baseWeights,volumeCount:grid**3};
}

function mixedValues(matrix, samples) {
  return samples.map(sample => matrix.map(row => clamp01(
    (row[0]*sample[0] + row[1]*sample[1] + row[2]*sample[2]) / 256)));
}

export function fitCubeQuick(cube, naturalSlot, cameraModel='k1ii') {
  // Fitting must use the canonical desktop Natural control, not the published
  // factory-library Natural preset (which is itself an adapted/rebuilt look).
  naturalSlot=canonicalNaturalSlot(cameraModel);
  const sampled = sampleTarget(cube, naturalSlot);
  const {samples,desired,untoned,targetStage,weights,baseWeights,volumeCount}=sampled,naturalMatrix=naturalSlot.matrix.map(r=>r.map(v=>v/256)),invNatural=invert3(naturalMatrix),naturalBaseline=naturalSlot.curves.map(smoothFactoryApprox);
  const raw=untoned.map(row=>invNatural.map(m=>m[0]*row[0]+m[1]*row[1]+m[2]*row[2]));
  const preTone=targetStage.map(row=>row.map((v,c)=>naturalInverseContinuous([c===0?v:0,c===1?v:0,c===2?v:0])[c]));
  const composed=[[1,0,0],[0,1,0],[0,0,1]];
  for(let c=0;c<3;c++){
    const other=[0,1,2].filter(i=>i!==c),features=untoned.map(row=>[row[other[0]]-row[c],row[other[1]]-row[c]]),target=preTone.map((row,i)=>row[c]-untoned[i][c]),coef=solve2(features,target,weights);
    composed[c][other[0]]=coef[0];composed[c][other[1]]=coef[1];composed[c][c]=1-coef[0]-coef[1];
  }
  const regressed=normalizeRows(matrixMultiply(composed,naturalMatrix).map(row=>row.map(v=>Math.round(v*256))));
  const evaluateSlot=slot=>{
    const prepared=prepareRelativeProxy(slot,naturalSlot),volumeErrors=[],sq=[],sqWeights=[];
    for(let i=0;i<samples.length;i++){
      const out=applyPreparedRelative(prepared,samples[i]);
      for(let c=0;c<3;c++){
        const error=Math.abs(out[c]-desired[i][c])*255;if(i<volumeCount)volumeErrors.push(error);
        sq.push(error*error);sqWeights.push(baseWeights[i]);
      }
    }
    const weightedMean=sq.reduce((s,v,i)=>s+v*sqWeights[i],0)/sqWeights.reduce((a,b)=>a+b,0),score=weightedMean+.2*weightedPercentile(sq,sqWeights,.95);
    return {slot,score,mae:volumeErrors.reduce((a,b)=>a+b,0)/volumeErrors.length,p95:percentile(volumeErrors,.95),max:Math.max(...volumeErrors)};
  };
  const fitForMatrix=matrix=>{
    const rel=matrixMultiply(matrix.map(r=>r.map(v=>v/256)),invNatural),mixed=untoned.map(row=>rel.map(m=>clamp01(m[0]*row[0]+m[1]*row[1]+m[2]*row[2])));
    const curves=[0,1,2].map(c=>{
      const rawTarget=mixed.map((row,i)=>targetStage[i][c]-naturalForwardContinuous([c===0?row[c]:0,c===1?row[c]:0,c===2?row[c]:0])[c]+interp(naturalBaseline[c],row[c]));
      return fitSmoothCurveR367(mixed.map(row=>row[c]),rawTarget,naturalBaseline[c],weights);
    });
    const slot={name:cube.name,enabled:true,matrix:matrix.map(r=>r.slice()),colorBaseMatrix:matrix.map(r=>r.slice()),curves,masterCurve:identityCurve(),preset_key:'k12:natural',matrix_domain:'natural_relative',camera_model:cameraModel,brightness_ev:0,contrast:0,color_hue:0,color_sat:1,user_preset_id:'',fit_report:{},sourceLut:cube};
    return evaluateSlot(slot);
  };
  const pristine=cloneSlot(naturalSlot);pristine.name=cube.name;pristine.sourceLut=cube;pristine.camera_model=cameraModel;
  let chosen=[evaluateSlot(pristine),fitForMatrix(naturalSlot.matrix),fitForMatrix(regressed)].sort((a,b)=>a.score-b.score)[0];
  for(let round=0;round<3;round++){
    const proposal=refitMatrixR367(raw,targetStage,chosen.slot.curves,weights,naturalSlot);let improved=false;
    for(const mix of [.45,1]){
      const trial=normalizeRows(chosen.slot.matrix.map((row,r)=>row.map((v,c)=>Math.round(v*(1-mix)+proposal[r][c]*mix))));if(trial.flat().some(v=>v<-2048||v>2047))continue;
      const candidate=fitForMatrix(trial);if(candidate.score+1e-5<chosen.score){chosen=candidate;improved=true;}
    }
    if(!improved)break;
  }
  for(const step of [8,2])for(let row=0;row<3;row++)for(let col=0;col<3;col++)if(col!==row)for(const direction of [-1,1]){
    const trial=chosen.slot.matrix.map(r=>r.slice());trial[row][col]+=direction*step;trial[row][row]-=direction*step;if(trial.flat().some(v=>v<-2048||v>2047))continue;
    const candidate=fitForMatrix(trial);if(candidate.score+1e-5<chosen.score)chosen=candidate;
  }
  const slot=chosen.slot;
  const prepared=prepareRelativeProxy(slot,naturalSlot),deValues=[];
  for(let i=0;i<volumeCount;i++)deValues.push(de00(srgbLab(applyPreparedRelative(prepared,samples[i])),srgbLab(desired[i])));
  slot.fit_report = {
    rgb_mae_255: chosen.mae,rgb_p95_255:chosen.p95,rgb_max_255:chosen.max,
    de00_mean:deValues.reduce((a,b)=>a+b,0)/deValues.length,de00_p95:percentile(deValues,.95),
    validation_grid:25,fit_profile:'R367-darkaware-target-weight-v1-web',
    model:'Web R367-aligned P317 Natural-relative Q8 + RGB U14 fit',
  };
  return slot;
}

export function editCurveMonotone(curve, fromIndex, toIndex, toValue) {
  const result = curve.slice();
  const start = Math.max(0, Math.min(NODES-1, Math.round(fromIndex)));
  const end = Math.max(0, Math.min(NODES-1, Math.round(toIndex)));
  const value = clamp01(toValue) * WHITE;
  const original = result[start];
  if (start === end) {
    result[end] = value;
  } else {
    const direction = end > start ? 1 : -1;
    const steps = Math.abs(end-start);
    for (let step=0; step<=steps; step++) {
      const index = start + direction*step;
      result[index] = original + (value-original) * step/steps;
    }
  }
  for(let i=1;i<NODES;i++) result[i]=Math.max(result[i],result[i-1]);
  for(let i=0;i<NODES;i++) result[i]=Math.round(Math.max(0,Math.min(WHITE,result[i])));
  return result;
}

function curveDict(values) {
  return {
    values: values.map(Number),
    nodes: 256,
    interpolation: 'natural_relative',
    display_curve: null,
    points: [],
    base_values: null,
  };
}

export function projectJson(slots, cameraModel='k1ii') {
  return {
    schema: 1,
    slots: slots.map(slot => ({
      name: slot.name || 'CUST',
      enabled: Boolean(slot.enabled),
      matrix: slot.matrix.map(row => row.map(value => Math.round(value))),
      channels: slot.curves.map(curveDict),
      master: curveDict(identityCurve()),
      curve_active: true,
      preset_key: slot.preset_key || 'k12:natural',
      color_hue: 0,
      color_sat: 1,
      brightness_ev: Number(slot.brightness_ev || 0),
      contrast: Number(slot.contrast || 0),
      user_preset_id: '',
      camera_model: cameraModel,
      fit_report: {...(slot.fit_report || {}), exported_by: 'Pentax Labs Web'},
      matrix_domain: slot.matrix_domain || 'natural_relative',
    })),
    four_season: {enabled:false,count:0},
    source_hint: {origin:'Pentax Labs Web', note:'No firmware/runtime binary embedded'},
    camera_model: cameraModel,
  };
}

export function parameterJson(slot, cameraModel='k1ii') {
  return {
    schema: 1,
    generator: 'Pentax Labs Web',
    camera_model: cameraModel,
    name: slot.name,
    matrix_q8: slot.matrix.map(row => row.map(value => Math.round(value))),
    curve_u14: slot.curves.map(row => row.map(value => Math.round(value))),
    matrix_domain: slot.matrix_domain || 'natural_relative',
    brightness_ev: Number(slot.brightness_ev || 0),
    contrast: Number(slot.contrast || 0),
    fit_report: slot.fit_report || {},
    note: 'Parameter-only package. Camera P/R runtime is intentionally not embedded in the public web build.',
  };
}

export function cubeTextFromSlot(slot, naturalSlot, size=33) {
  if (![17,33,65].includes(Number(size))) throw Error('LUT 网格仅支持 17 / 33 / 65');
  const count = Number(size);
  const clean = (slot.name || 'Pentax Labs Web').replaceAll('"', "'");
  const lines = [
    'TITLE "' + clean + '"',
    '# Pentax Labs Web / Natural-relative Q8 + RGB U14 preview proxy',
    '# This is a display LUT for the web parameter model, not a RAW/ISP reconstruction.',
  ];
  const mean=slot.fit_report?.de00_mean ?? slot.fit_report?.mean_de00;
  const p95=slot.fit_report?.de00_p95 ?? slot.fit_report?.p95_de00;
  const rgb=slot.fit_report?.rgb_mae_255;
  if(Number.isFinite(mean))lines.push('# Current model DeltaE00 mean: '+Number(mean).toFixed(3)+(Number.isFinite(p95)?'; P95: '+Number(p95).toFixed(3):''));
  if(Number.isFinite(rgb))lines.push('# Current model RGB MAE (0-255): '+Number(rgb).toFixed(3));
  lines.push('LUT_3D_SIZE ' + count,'DOMAIN_MIN 0.000000 0.000000 0.000000','DOMAIN_MAX 1.000000 1.000000 1.000000');
  for(let b=0;b<count;b++) {
    for(let g=0;g<count;g++) {
      for(let r=0;r<count;r++){
        const rgb=[r/(count-1),g/(count-1),b/(count-1)];
        lines.push(applyRelativeProxy(slot,naturalSlot,rgb)
          .map(value=>value.toFixed(9)).join(' '));
      }
    }
  }
  return lines.join('\n') + '\n';
}
