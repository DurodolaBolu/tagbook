/* Live site only: auto update + pull down to refresh */
(function(){
  var BUILD=window.TB_BUILD, $q=function(s){return document.querySelector(s)};
  var css=document.createElement("style");
  css.textContent="html,body{overscroll-behavior-y:contain}"+
    "#tb-ptr{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:30;transform:translate(-50%,-80px);background:var(--card);color:var(--accent-deep);border:1px solid var(--line);border-radius:999px;padding:8px 14px;font:600 14px/18px var(--font);box-shadow:0 2px 8px rgba(3,25,30,.12);transition:transform .15s ease-out;pointer-events:none;white-space:nowrap}"+
    "#tb-upd{position:fixed;left:0;right:0;top:0;z-index:40;padding:calc(env(safe-area-inset-top,0px) + 10px) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));background:var(--accent);color:var(--accent-ink);font:600 15px/20px var(--font);text-align:center;border:0;width:100%;cursor:pointer}";
  document.head.appendChild(css);

  /* ---- auto update ---- */
  var shown=false;
  function busy(){var a=document.activeElement;return a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName);}
  function onHome(){var sh=$q("#sheet");return (!sh||sh.hidden)&&(location.hash===""||location.hash==="#orders");}
  function showBar(){if(shown)return;shown=true;var b=document.createElement("button");b.id="tb-upd";b.textContent="New version ready. Tap to update.";b.onclick=function(){location.reload();};document.body.appendChild(b);}
  function check(){
    if(!BUILD||document.visibilityState!=="visible")return;
    fetch("/version.json?t="+Date.now(),{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(j){
      if(!j||!j.v||j.v===BUILD)return;
      if(onHome()&&!busy())location.reload(); else showBar();
    }).catch(function(){});
    if(navigator.serviceWorker&&navigator.serviceWorker.getRegistration)navigator.serviceWorker.getRegistration().then(function(r){if(r)r.update();}).catch(function(){});
  }
  setInterval(check,60000);
  document.addEventListener("visibilitychange",check);
  window.addEventListener("focus",check);
  window.addEventListener("hashchange",function(){if(shown&&onHome()&&!busy())location.reload();});

  /* ---- pull down to refresh ---- */
  var ind=document.createElement("div");ind.id="tb-ptr";ind.textContent="Pull down to refresh";document.body.appendChild(ind);
  var y0=null,dy=0,GO=110;
  function scroller(){var sh=$q("#sheet");return sh&&!sh.hidden?sh:document.scrollingElement;}
  document.addEventListener("touchstart",function(e){
    if(e.touches.length!==1||scroller().scrollTop>0||busy()){y0=null;return;}
    y0=e.touches[0].clientY;dy=0;
  },{passive:true});
  document.addEventListener("touchmove",function(e){
    if(y0===null)return;dy=e.touches[0].clientY-y0;
    if(dy<=0){ind.style.transform="translate(-50%,-80px)";return;}
    var d=Math.min(dy*0.5,70);ind.style.transform="translate(-50%,"+(d-10)+"px)";
    ind.textContent=dy>GO?"Release to refresh":"Pull down to refresh";
  },{passive:true});
  document.addEventListener("touchend",function(){
    if(y0===null)return;
    if(dy>GO){ind.textContent="Refreshing…";location.reload();}
    else ind.style.transform="translate(-50%,-80px)";
    y0=null;dy=0;
  });
})();
