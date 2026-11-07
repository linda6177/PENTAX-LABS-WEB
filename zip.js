const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n=0;n<256;n++) {
    let c=n;
    for (let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
    table[n]=c>>>0;
  }
  return table;
})();

export function crc32(data) {
  const bytes=data instanceof Uint8Array?data:new Uint8Array(data);
  let c=0xFFFFFFFF;
  for (const b of bytes) c=CRC_TABLE[(c^b)&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}

function u16(view,at,value){ view.setUint16(at,value,true); }
function u32(view,at,value){ view.setUint32(at,value>>>0,true); }
function concat(parts) {
  const size=parts.reduce((n,p)=>n+p.length,0);
  const out=new Uint8Array(size); let at=0;
  for (const part of parts){ out.set(part,at); at+=part.length; }
  return out;
}
function dosTime(date=new Date()) {
  const year=Math.max(1980,date.getFullYear());
  return {
    time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),
    date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate(),
  };
}

export function zipStore(files) {
  const locals=[], central=[];
  let offset=0;
  const stamp=dosTime();
  for (const [name,value] of Object.entries(files)) {
    const path=encoder.encode(name.replaceAll('\\','/'));
    const data=value instanceof Uint8Array?value:
      value instanceof ArrayBuffer?new Uint8Array(value):encoder.encode(String(value));
    const crc=crc32(data);
    const local=new Uint8Array(30+path.length);
    const lv=new DataView(local.buffer);
    u32(lv,0,0x04034B50); u16(lv,4,20); u16(lv,6,0x0800); u16(lv,8,0);
    u16(lv,10,stamp.time); u16(lv,12,stamp.date); u32(lv,14,crc);
    u32(lv,18,data.length); u32(lv,22,data.length); u16(lv,26,path.length); u16(lv,28,0);
    local.set(path,30);
    locals.push(local,data);

    const cd=new Uint8Array(46+path.length);
    const cv=new DataView(cd.buffer);
    u32(cv,0,0x02014B50); u16(cv,4,20); u16(cv,6,20); u16(cv,8,0x0800); u16(cv,10,0);
    u16(cv,12,stamp.time); u16(cv,14,stamp.date); u32(cv,16,crc);
    u32(cv,20,data.length); u32(cv,24,data.length); u16(cv,28,path.length);
    u16(cv,30,0); u16(cv,32,0); u16(cv,34,0); u16(cv,36,0); u32(cv,38,0); u32(cv,42,offset);
    cd.set(path,46); central.push(cd);
    offset+=local.length+data.length;
  }
  const centralBlob=concat(central);
  const end=new Uint8Array(22); const ev=new DataView(end.buffer);
  u32(ev,0,0x06054B50); u16(ev,4,0); u16(ev,6,0); u16(ev,8,central.length); u16(ev,10,central.length);
  u32(ev,12,centralBlob.length); u32(ev,16,offset); u16(ev,20,0);
  return new Blob([...locals,centralBlob,end],{type:'application/zip'});
}
