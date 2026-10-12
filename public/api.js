/* Tiny fetch wrapper. Same-origin only (CSP connect-src 'self'); the session
   cookie is httpOnly, so script never sees it. */
window.API = (function(){
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 502/503/504 come from the host while the server restarts (e.g. a redeploy): the request never ran, so retrying is safe
  const RESTARTING = [502, 503, 504];
  async function call(method, url, body, tries = 3){
    let res;
    try{
      res = await fetch(url, {
        method, credentials:'same-origin',
        headers: body!==undefined ? {'Content-Type':'application/json'} : {},
        body: body!==undefined ? JSON.stringify(body) : undefined
      });
    }catch(e){
      // no response at all: only reads are repeated automatically, a write might have reached the server
      if(method==='GET' && tries>1){ await wait(1500); return call(method, url, body, tries-1) }
      const err=new Error('Cannot reach the server. Check your connection and try again.'); err.status=0; throw err
    }
    if(RESTARTING.includes(res.status) && tries>1){ await wait(2000); return call(method, url, body, tries-1) }
    let data=null; try{ data=await res.json() }catch(e){}
    if(!res.ok){
      const msg = data?.error || (RESTARTING.includes(res.status) ? 'The server is restarting — try again in a few seconds.' : `Request failed (${res.status})`);
      const err=new Error(msg); err.status=res.status; throw err
    }
    return data;
  }
  return {
    get:u=>call('GET',u), post:(u,b={})=>call('POST',u,b), put:(u,b)=>call('PUT',u,b),
    patch:(u,b)=>call('PATCH',u,b), del:u=>call('DELETE',u)
  };
})();
