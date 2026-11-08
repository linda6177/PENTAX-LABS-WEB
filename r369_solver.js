/* Native K-1 II calibrated fit. Block least squares, not SciPy least_squares. */
import p0 from './assets/r369_data_0.js'; import p1 from './assets/r369_data_1.js';
import p2 from './assets/r369_data_2.js'; import p3 from './assets/r369_data_3.js';
import p4 from './assets/r369_data_4.js'; import p5 from './assets/r369_data_5.js';
import p6 from './assets/r369_data_6.js'; import p7 from './assets/r369_data_7.js';
const chars=atob(p0+p1+p2+p3+p4+p5+p6+p7), bytes=new Uint8Array(chars.length);
for(let i=0;i<chars.length;i++)bytes[i]=chars.charCodeAt(i);
const data=new Float32Array(bytes.buffer), n=12000, natural=data.subarray(0,n*3), basis=data.subarray(n*3,n*6);
const hcal=data.subarray(n*6,n*6+9), gamma=data.subarray(n*6+9,n*6+9+768);
const r203h=data.subarray(n*6+9+768,n*6+18+768), r203g=data.subarray(n*6+18+768);
const clip=x=>Math.max(0,Math.min(1,x));
function lerp(a,x){x=clip(x)*(a.length-1);const i=Math.min(a.length-2,Math.floor(x)), f=x-i;return a[i]*(1-f)+a[i+1]*f;}
function inv3(m){const [a,b,c,d,e,f,g,h,i]=m, A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d,det=a*A+b*D+c*G;return [A,B,C,D,E,F,G,H,I].map(x=>x/det);}
const hinv=inv3(Array.from(hcal,x=>x/256));
const axis=Array.from({length:3},(_,c)=>Array.from(gamma.subarray(c*256,c*256+256),x=>x/16383));
const inverseAxes=axis.map(curve=>{let v=[],p=[];for(let i=0;i<256;){let end=i;while(end<255&&curve[end+1]===curve[i])end++;v.push(curve[i]);p.push((i+end)/510);i=end+1;}return {v,p};});
function inverseCurve(table,value){const {v,p}=table;let lo=0,hi=v.length-1;if(value<=v[0])return p[0];if(value>=v[hi])return p[hi];while(lo+1<hi){const m=(lo+hi)>>1;if(v[m]<value)lo=m;else hi=m;}return p[lo]+(p[hi]-p[lo])*(value-v[lo])/(v[hi]-v[lo]);}
export function naturalBasis(rgb){const z=[];for(let c=0;c<3;c++){let sum=0;for(let j=0;j<3;j++)sum+=rgb[j]*r203h[c*3+j]/256;const rr=r203g.subarray(c*256,c*256+256);z[c]=inverseCurve(inverseAxes[c],lerp(rr,sum)/16383);}return [0,1,2].map(c=>hinv[c*3]*z[0]+hinv[c*3+1]*z[1]+hinv[c*3+2]*z[2]);}
export function predictR369(rgb,matrix,curves){let b=naturalBasis(rgb);return [0,1,2].map(c=>lerp(curves[c],clip((matrix[c][0]*b[0]+matrix[c][1]*b[1]+matrix[c][2]*b[2])/256))/16383);}
function pchip(y,x){let k=Math.min(127,Math.floor(x*128)),t=x*128-k,d=y[k+1]-y[k],d0=k?y[k]-y[k-1]:d,d1=k<127?y[k+2]-y[k+1]:d,m0=d*d0>0?2*d*d0/(d+d0):0,m1=d*d1>0?2*d*d1/(d+d1):0;return (2*t*t*t-3*t*t+1)*y[k]+(t*t*t-2*t*t+t)*m0+(-2*t*t*t+3*t*t)*y[k+1]+(t*t*t-t*t)*m1;}
export function fitR369(cube,evaluate){
 const targets=new Float64Array(n*3),w2=new Float64Array(n);let sum=0;
 for(let i=0;i<n;i++){const t=evaluate(cube,[natural[3*i],natural[3*i+1],natural[3*i+2]]);let l=(t[0]+t[1]+t[2])/3,w=(1+1.15*Math.exp(-.5*((l-.30)/.14)**2))/Math.sqrt(.08+l);w2[i]=w*w;sum+=w*w;for(let c=0;c<3;c++)targets[3*i+c]=clip(t[c]);}
 for(let i=0;i<n;i++)w2[i]/=sum;
 const matrix=[],curves=[];
 for(let c=0;c<3;c++){
  const other=[0,1,2].filter(x=>x!==c), x=new Float64Array(n),a=new Float64Array(n),b=new Float64Array(n), lo=new Int16Array(n), frac=new Float64Array(n), hs=[hcal[c*3+other[0]]/256,hcal[c*3+other[1]]/256],initial=hs.slice();
  let curve=Float64Array.from({length:129},(_,j)=>lerp(axis[c],j/128));
  for(let i=0;i<n;i++){x[i]=basis[i*3+c];a[i]=basis[i*3+other[0]]-x[i];b[i]=basis[i*3+other[1]]-x[i];}
  for(let pass=0;pass<24;pass++){
   for(let i=0;i<n;i++){const q=clip(x[i]+a[i]*hs[0]+b[i]*hs[1])*128,k=Math.min(127,Math.floor(q));lo[i]=k;frac[i]=q-k;}
   let rhs=new Float64Array(129), diag=new Float64Array(129).fill(1e-9);
   for(let i=0;i<n;i++){const k=lo[i],f=frac[i],v=w2[i],t=targets[i*3+c];rhs[k]+=v*(1-f)*t;rhs[k+1]+=v*f*t;diag[k]+=v*(1-f)**2;diag[k+1]+=v*f*f;}
   for(let j=0;j<127;j++){diag[j]+=.005625;diag[j+1]+=.0225;diag[j+2]+=.005625;}
   const multiply=v=>{const out=new Float64Array(129);for(let i=0;i<n;i++){let k=lo[i],f=frac[i],z=w2[i]*(v[k]*(1-f)+v[k+1]*f);out[k]+=z*(1-f);out[k+1]+=z*f;}for(let j=0;j<127;j++){let z=.005625*(v[j]-2*v[j+1]+v[j+2]);out[j]+=z;out[j+1]-=2*z;out[j+2]+=z;}return out;};
   let v=curve.slice(),mv=multiply(v),r=rhs.map((x,j)=>x-mv[j]),z=r.map((x,j)=>x/diag[j]),p=z.slice(),rz=r.reduce((s,x,j)=>s+x*z[j],0);
   for(let it=0;it<45;it++){let ap=multiply(p),den=p.reduce((s,x,j)=>s+x*ap[j],0);if(den<1e-25)break;let alpha=rz/den;for(let j=0;j<129;j++){v[j]+=alpha*p[j];r[j]-=alpha*ap[j];z[j]=r[j]/diag[j];}let next=r.reduce((s,x,j)=>s+x*z[j],0);if(next<1e-16)break;let beta=next/rz;for(let j=0;j<129;j++)p[j]=z[j]+beta*p[j];rz=next;}
   // Isotonic PAVA keeps each fitted channel physically monotone.
   let groups=[];for(let j=0;j<129;j++){groups.push([clip(v[j]),1,j,j]);while(groups.length>1&&groups.at(-2)[0]>groups.at(-1)[0]){const q=groups.pop(),p=groups.pop(),mass=p[1]+q[1];groups.push([(p[0]*p[1]+q[0]*q[1])/mass,mass,p[2],q[3]]);}}for(const [value,,start,end] of groups)for(let j=start;j<=end;j++)curve[j]=value;
   let aa=.000004,ab=0,bb=.000004,ra=.000004*(initial[0]-hs[0]),rb=.000004*(initial[1]-hs[1]);
   for(let i=0;i<n;i++){let k=lo[i],f=frac[i],raw=x[i]+a[i]*hs[0]+b[i]*hs[1];if(raw<=0||raw>=1)continue;let slope=(curve[k+1]-curve[k])*128,err=targets[i*3+c]-(curve[k]*(1-f)+curve[k+1]*f),u=slope*a[i],v=slope*b[i],w=w2[i];aa+=w*u*u;ab+=w*u*v;bb+=w*v*v;ra+=w*u*err;rb+=w*v*err;}
   let det=aa*bb-ab*ab;if(det>1e-20){let da=(ra*bb-rb*ab)/det,db=(rb*aa-ra*ab)/det;hs[0]=Math.max(-1.5,Math.min(1.5,hs[0]+Math.max(-.15,Math.min(.15,da))));hs[1]=Math.max(-1.5,Math.min(1.5,hs[1]+Math.max(-.15,Math.min(.15,db))));}
  }
  let row=[0,0,0];row[other[0]]=Math.round(hs[0]*256);row[other[1]]=Math.round(hs[1]*256);row[c]=256-row[other[0]]-row[other[1]];matrix.push(row);
  curves.push(Array.from({length:256},(_,i)=>Math.round(clip(pchip(curve,i/255))*16383)));
 }
 return {matrix,curves};
}
