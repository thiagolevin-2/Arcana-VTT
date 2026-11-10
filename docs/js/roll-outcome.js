// A free roll has no success/failure threshold. Natural 1/20 only override an attack.
export function rollOutcome({natural=null,total=0,dc=null,kind='free',criticalThreshold=20}={}){
 const compared=Number.isFinite(dc)&&dc>=1;
 if(kind==='attack'&&natural!==null){
  if(natural>=criticalThreshold)return {tone:'critical',label:'ACERTO CRÍTICO',success:true,natural,compared};
  if(natural===1)return {tone:'failure',label:'FALHA NO ATAQUE',success:false,natural,compared};
 }
 if(compared)return {tone:total>=dc?'success':'failure',label:total>=dc?'SUCESSO':'FALHA',success:total>=dc,natural,compared};
 return {tone:natural===20?'natural20':natural===1?'natural1':'neutral',label:natural===20?'20 NATURAL':natural===1?'1 NATURAL':'ROLAGEM LIVRE',success:null,natural,compared:false};
}
