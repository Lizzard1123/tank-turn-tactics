// Real-world flag assignment. Each player id deterministically maps to one
// country's flag (FNV-1a over the id, indexed into the sorted ISO 3166-1
// alpha-2 set shipped by the flag-icons package). The SVGs are copied from
// node_modules/flag-icons/flags/4x3 into public/flags by the prebuild step,
// so the same player always carries the same REAL flag image.

// Sorted ISO 3166-1 alpha-2 codes with a 4x3 flag in flag-icons@7.
const COUNTRY_CODES_STR = 'ad,ae,af,ag,ai,al,am,ao,aq,ar,as,at,au,aw,ax,az,ba,bb,bd,be,bf,bg,bh,bi,bj,bl,bm,bn,bo,bq,br,bs,bt,bv,bw,by,bz,ca,cc,cd,cf,cg,ch,ci,ck,cl,cm,cn,co,cp,cr,cu,cv,cw,cx,cy,cz,de,dg,dj,dk,dm,do,dz,ec,ee,eg,eh,er,es,et,eu,fi,fj,fk,fm,fo,fr,ga,gb,gd,ge,gf,gg,gh,gi,gl,gm,gn,gp,gq,gr,gs,gt,gu,gw,gy,hk,hm,hn,hr,ht,hu,ic,id,ie,il,im,in,io,iq,ir,is,it,je,jm,jo,jp,ke,kg,kh,ki,km,kn,kp,kr,kw,ky,kz,la,lb,lc,li,lk,lr,ls,lt,lu,lv,ly,ma,mc,md,me,mf,mg,mh,mk,ml,mm,mn,mo,mp,mq,mr,ms,mt,mu,mv,mw,mx,my,mz,na,nc,ne,nf,ng,ni,nl,no,np,nr,nu,nz,om,pa,pc,pe,pf,pg,ph,pk,pl,pm,pn,pr,ps,pt,pw,py,qa,re,ro,rs,ru,rw,sa,sb,sc,sd,se,sg,sh,si,sj,sk,sl,sm,sn,so,sr,ss,st,sv,sx,sy,sz,tc,td,tf,tg,th,tj,tk,tl,tm,tn,to,tr,tt,tv,tw,tz,ua,ug,um,un,us,uy,uz,va,vc,ve,vg,vi,vn,vu,wf,ws,xk,xx,ye,yt,za,zm,zw';

export const COUNTRY_CODES: readonly string[] = COUNTRY_CODES_STR.split(',');

// 32-bit FNV-1a: stable across sessions, no Math.random anywhere.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Country code (e.g. 'de') this player id deterministically carries. */
export function flagForPlayerId(playerId: string): string {
  return COUNTRY_CODES[fnv1a(playerId) % COUNTRY_CODES.length];
}

/** URL of the bundled real-flag SVG for this player id. */
export function flagUrl(playerId: string): string {
  return `${import.meta.env.BASE_URL}flags/${flagForPlayerId(playerId)}.svg`;
}
