/* Tiny fetch wrapper. Same-origin only (CSP connect-src 'self'); the session
   cookie is httpOnly, so script never sees it. */
window.API = (function(){
  async function call(method, url, body){
    let res;
    try{
      res = await fetch(url, {
        method, credentials:'same-origin',
        headers: body!==undefined ? {'Content-Type':'application/json'} : {},
        body: body!==undefined ? JSON.stringify(body) : undefined
      });
    }catch(e){ const err=new Error('Cannot reach the server. Check your connection and try again.'); err.status=0; throw err }
    let data=null; try{ data=await res.json() }catch(e){}
    if(!res.ok){ const err=new Error(data?.error||`Request failed (${res.status})`); err.status=res.status; throw err }
    return data;
  }
  return {
    get:u=>call('GET',u), post:(u,b={})=>call('POST',u,b), put:(u,b)=>call('PUT',u,b),
    patch:(u,b)=>call('PATCH',u,b), del:u=>call('DELETE',u)
  };
})();
