// Offline regression check for the Beta87 K-1 script export.
// Verifies that the web compiles the same R30 fast-startup script as desktop
// Beta73+ and that all three CUST icon slots are replaced.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const R30_SHA='9a525c208074200491e7cda941b69c570ce5e689805ab9dbce2ef251adea960f';
const R30_BYTES=6078;

globalThis.document={createElement(){return {
  width:0,height:0,
  getContext(){return {
    clearRect(){},fillText(){},measureText(text){return {width:String(text).length*12};},
    getImageData(){return {data:new Uint8ClampedArray(240*40*4)};},
    set font(value){},set fillStyle(value){},set textAlign(value){},set textBaseline(value){},
  };},
};}};
globalThis.crypto??=(await import('node:crypto')).webcrypto;

const files=new Map([
  ['./assets/runtime/k1/P.BIN','assets/runtime/k1/P.BIN'],
  ['./assets/runtime/k1/R.BIN','assets/runtime/k1/R.BIN'],
  ['./assets/runtime/k1/startup.ttl','assets/runtime/k1/startup.ttl'],
  ['./assets/runtime/k1ii/P.BIN','assets/runtime/k1ii/P.BIN'],
  ['./assets/runtime/k1ii/R.BIN','assets/runtime/k1ii/R.BIN'],
  ['./assets/runtime/k1ii/startup.ttl','assets/runtime/k1ii/startup.ttl'],
]);
globalThis.fetch=async url=>{
  const local=files.get(String(url));
  if(!local) return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};
  const bytes=fs.readFileSync(path.join(here,local));
  return {ok:true,status:200,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
};

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function fail(message){console.error('K1_R30_VERIFY_FAIL',message);process.exit(1);}
function check(condition,message){if(!condition)fail(message);}

const runtime=await import(pathToFileURL(path.join(here,'runtime.js')).href);
const k1=await runtime.loadBuiltinRuntime('k1');
check(k1.ttl.length===R30_BYTES,`K-1 startup length ${k1.ttl.length} != ${R30_BYTES}`);
check(sha256(k1.ttl)===R30_SHA,'K-1 startup SHA256 differs from desktop R30 output');

const identity=Array.from({length:256},(_,i)=>Math.round(i*16383/255));
const slot={name:'TEST',enabled:true,matrix:[[256,0,0],[0,256,0],[0,0,256]],
  curves:[identity,identity,identity],masterCurve:identity,matrix_domain:'legacy_native',
  camera_model:'k1',brightness_ev:0,contrast:0};
const built=runtime.compileCameraScriptFiles([slot],'k1',k1);
check(built['script/startup.ttl'].length===R30_BYTES,'exported K-1 startup is not 6078 B');
const r=built['script/T/R.BIN'];
check(r.length===110592,`K-1 R.BIN length ${r.length}`);
for(const at of [94208,97280,100352]){
  check(Buffer.compare(Buffer.from(r.subarray(at,at+3072)),Buffer.from(r.subarray(94208,94208+3072)))===0,
    `K-1 CUST icon slot @0x${at.toString(16)} was not replaced`);
}

const k1ii=await runtime.loadBuiltinRuntime('k1ii');
check(k1ii.ttl.length===6209,`K-1 II startup length ${k1ii.ttl.length} != 6209`);
check(k1ii.r.length===114176,`K-1 II R.BIN length ${k1ii.r.length} != 114176`);
console.log('K1_R30_VERIFY_PASS','startup=6078','r_bin=110592','icons=3','k1ii_startup=6209');
