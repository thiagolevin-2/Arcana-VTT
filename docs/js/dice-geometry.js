// Geometry and orientation are independent from the random-number generator.
// Animation always receives the already-computed rules result.
export const add=(a,b)=>a.map((n,i)=>n+b[i]);
export const scale=(a,s)=>a.map(n=>n*s);
export const sub=(a,b)=>a.map((n,i)=>n-b[i]);
export const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=a=>scale(a,1/(Math.hypot(...a)||1));
export const average=a=>scale(a.reduce((v,p)=>add(v,p),[0,0,0]),1/a.length);
export function quaternion(axis,angle){const a=norm(axis),s=Math.sin(angle/2);return [...scale(a,s),Math.cos(angle/2)]}
export function multiply(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]]}
export function rotate(v,q){const t=scale(cross(q.slice(0,3),v),2);return add(v,add(scale(t,q[3]),cross(q.slice(0,3),t)))}
export function align(from,to){const a=norm(from),b=norm(to),d=dot(a,b);if(d<-.999999)return quaternion(Math.abs(a[0])<.8?cross(a,[1,0,0]):cross(a,[0,1,0]),Math.PI);const c=cross(a,b),q=[...c,1+d],m=Math.hypot(...q);return q.map(v=>v/m)}
function hull(vertices){const seen=new Set(),faces=[],epsilon=1e-6;for(let i=0;i<vertices.length-2;i++)for(let j=i+1;j<vertices.length-1;j++)for(let k=j+1;k<vertices.length;k++){
 let normal=cross(sub(vertices[j],vertices[i]),sub(vertices[k],vertices[i]));if(Math.hypot(...normal)<epsilon)continue;normal=norm(normal);let distance=dot(normal,vertices[i]);const ds=vertices.map(v=>dot(normal,v)-distance);if(ds.some(d=>d>epsilon)&&ds.some(d=>d<-epsilon))continue;if(distance<0){normal=scale(normal,-1);distance=-distance}const ids=vertices.map((v,n)=>Math.abs(dot(normal,v)-distance)<epsilon?n:-1).filter(n=>n>=0);const key=ids.join(',');if(seen.has(key))continue;seen.add(key);const center=average(ids.map(n=>vertices[n])),u=norm(sub(vertices[ids[0]],center)),v=cross(normal,u);ids.sort((a,b)=>Math.atan2(dot(sub(vertices[a],center),v),dot(sub(vertices[a],center),u))-Math.atan2(dot(sub(vertices[b],center),v),dot(sub(vertices[b],center),u)));faces.push({indices:ids,normal,center,u,v,distance});
 }return faces}
const cache=new Map();
export function dieModel(sides){if(cache.has(sides))return cache.get(sides);let vertices=[];const phi=(1+Math.sqrt(5))/2;
 if(sides===4)vertices=[[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]];
 if(sides===6)for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push([x,y,z]);
 if(sides===8)vertices=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
 if(sides===20){for(const a of [-1,1])for(const b of [-phi,phi])vertices.push([0,a,b],[a,b,0],[b,0,a])}
 if(sides===12){for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push([x,y,z]);for(const a of [-1/phi,1/phi])for(const b of [-phi,phi])vertices.push([0,a,b],[a,b,0],[b,0,a])}
 if(sides===10){const antiprism=[];for(let i=0;i<5;i++){let a=i*Math.PI*2/5;antiprism.push([Math.cos(a),.5,Math.sin(a)],[Math.cos(a+Math.PI/5),-.5,Math.sin(a+Math.PI/5)])}vertices=hull(antiprism).map(f=>scale(f.normal,1/f.distance))}
 if(!vertices.length)return null;const radius=Math.max(...vertices.map(v=>Math.hypot(...v)));vertices=vertices.map(v=>scale(v,1/radius));const faces=hull(vertices);
 // Assign opposite pairs on a standard cube so opposing faces add up to 7.
 if(sides===6){const assigned=new Set();let value=1;for(let i=0;i<faces.length;i++){if(assigned.has(i))continue;const opposite=faces.findIndex((f,j)=>j!==i&&dot(f.normal,faces[i].normal)<-.999);faces[i].value=value;faces[opposite].value=7-value;assigned.add(i);assigned.add(opposite);value++}}
 else faces.forEach((f,i)=>f.value=i+1);
 const model={sides,vertices,faces};cache.set(sides,model);return model;
}
export function resultDirection(model,value){return model.sides===4?norm(model.vertices[value-1]):model.faces.find(f=>f.value===value).normal}
export function landingOrientation(model,value,yaw=0){const aligned=align(resultDirection(model,value),[0,1,0]);const face=model.faces.find(f=>f.value===value),u=rotate(face.u,aligned);const upright=model.sides===4?0:Math.atan2(u[2],u[0]);return multiply(quaternion([0,1,0],upright+yaw),aligned)}
export function diceFromValues(sides,values,extra={}){return values.flatMap(value=>{
 if(sides===100){const n=value===100?0:value;return [{sides:10,value:Math.floor(n/10)+1,percentile:'tens',label:'Dezenas',...extra},{sides:10,value:n%10+1,percentile:'ones',label:'Unidades',...extra}]}
 return dieModel(sides)?[{sides,value,...extra}]:[];
})}
export function diceFromRoll(result){return result.detail.filter(p=>p.type==='dice').flatMap(p=>diceFromValues(p.sides,p.values,{negative:p.sign<0}))}
export function faceLabel(die,value){return die.percentile==='tens'?String((value-1)*10).padStart(2,'0'):die.percentile==='ones'?String(value-1):String(value)}

export function presentationCamera(progress){const p=Math.max(0,Math.min(1,progress)),e=p*p*(3-2*p),angle=Math.atan2(7,11)+(Math.atan2(1,.015)-Math.atan2(7,11))*e;return {camera:[0,Math.sin(angle),Math.cos(angle)],up:[0,Math.cos(angle),-Math.sin(angle)]}}
