(function(){
  "use strict";

  /* ============ 常量与存储 ============ */
  var LS_SET="niuma.settings.v8", LS_REC="niuma.records.v8", LS_GOALS="niuma.goals.v15";
  var DEFAULT={salary:0,days:21.75,hours:8,payDay:15,restMode:"double",goalName:"买车首付",goalAmount:80000,goalBase:0,goalFrom:"",
    workStart:"09:00",workEnd:"18:00",breakStart:"12:00",breakEnd:"13:00",mul:1,freq:100};

  var S=loadSettings(), R=loadRecords();
  var GOALS=loadGoals();
  var rateView=0, curDay=todayKey(), fastTimer=null, uiTimer=null;

  function pad(n){return n<10?"0"+n:""+n;}
  function dateKey(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
  function todayKey(){return dateKey(new Date());}
  function monthKey(d){var x=(d instanceof Date)?d:(d?new Date(d):new Date());return x.getFullYear()+"-"+pad(x.getMonth()+1);}
  function hm2min(s){var p=(s||"00:00").split(":");return (+p[0]||0)*60+(+p[1]||0);}
  function atTime(base,hm){var m=hm2min(hm),d=new Date(base.getTime());d.setHours(Math.floor(m/60),m%60,0,0);return d;}
  function dateOfKey(k){var p=k.split("-");return new Date(+p[0],+p[1]-1,+p[2]);}
  function moneyHTML(v){var s=(Math.max(0,v)).toFixed(2),p=s.split(".");
    p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,",");return "¥"+p[0]+"<span class='dec'>."+p[1]+"</span>";}
  function money4(v){ return "¥"+Number(v||0).toFixed(4); }
  function money(v){return "¥"+(Math.max(0,v)).toFixed(2);}
  function esc(t){ return String(t==null?"":t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function hms(ms){if(ms<=0)return "0h00m";var m=Math.floor(ms/60000),h=Math.floor(m/60);return h+"h"+pad(m%60)+"m";}
  function clock(ms){if(ms<=0)return "00:00:00";
    var h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);
    return pad(h)+":"+pad(m)+":"+pad(s);}
  function overlap(a1,a2,b1,b2){var s=Math.max(a1,b1),e=Math.min(a2,b2);return e>s?e-s:0;}

  function loadSettings(){try{var raw=localStorage.getItem(LS_SET);
    if(!raw)return Object.assign({},DEFAULT);return Object.assign({},DEFAULT,JSON.parse(raw));}
    catch(e){return Object.assign({},DEFAULT);}}
  function saveSettings(){localStorage.setItem(LS_SET,JSON.stringify(S));}
  function loadRecords(){try{return JSON.parse(localStorage.getItem(LS_REC)||"{}");}catch(e){return {};}}
  function saveRecords(){localStorage.setItem(LS_REC,JSON.stringify(R));}

  /* ============ 计算口径 ============ */
  function paidHours(){
    var s=hm2min(S.workStart), e=hm2min(S.workEnd), bs=hm2min(S.breakStart), be=hm2min(S.breakEnd);
    if(e<=s) e+=1440;            // 跨夜班：22:00→06:00
    if(be<=bs) be+=1440;         // 跨夜的午休/夜宵
    var m=e-s; if(be>bs) m-=(be-bs);
    if(m<=0) m=30;
    return Math.round(m/60*100)/100;
  }
  function hourly(){var dd=(S.days>0?S.days:21.75), hh=paidHours()>0?paidHours():8;return (S.salary>0)?S.salary/(dd*hh):0;}
  function dailyPay(){return hourly()*paidHours();}
  function mul(){return S.mul||1;}
  function todayRate(){return hourly()*mul();}
  function dailyMs(){return paidHours()*3600000;}

  function recOf(k){return R[k];}
  function todayRec(){return R[todayKey()];}
  function started(){var r=todayRec();return !!(r&&r.startMs&&!r.endMs);}
  function ended(){var r=todayRec();return !!(r&&r.endMs);}
  function isPaused(){var r=todayRec();return !!(r&&r.pauseStartMs);}

  // 某天已工作时长（毫秒）：总时长 − 午休重叠 − 午休之外的暂停
  function workMsOf(k,now){
    var r=R[k]; if(!r) return 0;
    if(r.manual&&!r.startMs) return r.earnedMs||0;
    if(!r.startMs) return 0;
    var day=dateOfKey(k);
    var bS=atTime(day,S.breakStart).getTime(), bE=atTime(day,S.breakEnd).getTime();
    if(hm2min(S.workEnd)<=hm2min(S.workStart) && bE<=r.startMs){ bS+=86400000; bE+=86400000; }  // 夜班：午休/夜宵落在次日
    var to=r.endMs?r.endMs:Math.min(now,Date.now());
    var from=r.startMs;
    if(to<=from) return 0;
    var total=to-from;
    var lunch=overlap(from,to,bS,bE);
    var pauses=0;
    (r.pauses||[]).forEach(function(p){
      var ps=p.s, pe=(p.e==null)?to:p.e;
      if(pe<=ps) return;
      pauses+=(pe-ps)-overlap(ps,pe,bS,bE);
    });
    if(r.pauseStartMs){ var ps2=r.pauseStartMs, pe2=to; if(pe2>ps2) pauses+=(pe2-ps2)-overlap(ps2,pe2,bS,bE); }
    return Math.max(0,total-lunch-pauses);
  }
  function earnFrom(ms,rate){return ms/3600000*(rate||0);}

  // 某天该显示多少钱：存档/补录/已下班 → 用存档值；只有"计时中"用实时
  function amountOf(k,now){
    var r=R[k]; if(!r) return 0;
    if(r.manual&&!r.startMs) return r.earned||0;
    if(r.endMs) return r.earned||0;
    if(k===todayKey()&&r.startMs) return earnFrom(workMsOf(k,now), r.rate||todayRate());
    return r.earned||0;
  }
  function todayEarn(now){ return amountOf(todayKey(),now); }

  // 本月已赚 = 已存档日（用存档时的钱）+ 今天实时
  function monthTotal(now){
    var mk=monthKey(now), sum=0, days=0;
    Object.keys(R).forEach(function(k){
      if(k.indexOf(mk)!==0||k===todayKey()) return;
      var r=R[k]; if(!r) return;
      sum+=(r.earned||0); days++;
    });
    var t=todayEarn(now);
    if(t>0||started()||ended()||(todayRec()&&todayRec().manual)){ sum+=t; days++; }
    return {total:sum,days:days};
  }


  /* 2026 年法定节假日与调休（国办发明电〔2025〕7号） */
  var HOLIDAYS={"2026-01-01":1,"2026-01-02":1,"2026-01-03":1,
    "2026-02-15":1,"2026-02-16":1,"2026-02-17":1,"2026-02-18":1,"2026-02-19":1,"2026-02-20":1,"2026-02-21":1,"2026-02-22":1,"2026-02-23":1,
    "2026-04-04":1,"2026-04-05":1,"2026-04-06":1,
    "2026-05-01":1,"2026-05-02":1,"2026-05-03":1,"2026-05-04":1,"2026-05-05":1,
    "2026-06-19":1,"2026-06-20":1,"2026-06-21":1,
    "2026-09-25":1,"2026-09-26":1,"2026-09-27":1,
    "2026-10-01":1,"2026-10-02":1,"2026-10-03":1,"2026-10-04":1,"2026-10-05":1,"2026-10-06":1,"2026-10-07":1};
  var MAKEUP={"2026-01-04":1,"2026-02-14":1,"2026-02-28":1,"2026-05-09":1,"2026-09-20":1,"2026-10-10":1};

  var FESTIVAL={"2026-01-01":"元旦","2026-02-17":"春节","2026-04-05":"清明","2026-05-01":"劳动节",
    "2026-06-19":"端午","2026-09-25":"中秋","2026-10-01":"国庆节"};
  function baseWorkday(k){
    if(HOLIDAYS[k]) return false;
    if(MAKEUP[k]) return true;
    var w=new Date(k+"T12:00:00").getDay(), mode=S.restMode||"double";
    if(mode==="none") return true;
    if(mode==="single") return w!==0;
    return w!==0&&w!==6;
  }
  function isWorkday(k){
    if(R[k]&&R[k].off) return false;
    return baseWorkday(k);
  }
  function dayPayNow(){ return earnFrom(paidHours()*3600000,todayRate()); }

  /* ============ 发薪账期 ============ */
  function dayInMonth(y,m,d){ var x=new Date(y,m,d); return x.getDate()===d; }
  function safeDay(y,m,d){ var last=new Date(y,m+1,0).getDate(); return Math.min(d,last); }
  function startOfPeriod(y,m,pd){
    var dim=new Date(y,m+1,0).getDate();
    return (pd+1>dim) ? new Date(y,m+1,1) : new Date(y,m,pd+1);
  }
  function periodRange(now){
    var d=new Date(now), y=d.getFullYear(), m=d.getMonth(), pd=(S.payDay||15);
    var thisStart=startOfPeriod(y,m,pd), py, pm;
    if(thisStart.getTime()<=d.getTime()){ py=y; pm=m; }
    else { py=y; pm=m-1; }                     // Date 构造器自动处理跨年
    var start=startOfPeriod(py,pm,pd);
    var end=startOfPeriod(py,pm+1,pd);
    return {start:start,end:end,next:end};
  }
  function periodKeys(now){
    var pr=periodRange(now), keys=[], cur=new Date(pr.start.getTime()), endT=pr.end.getTime();
    while(cur.getTime()<endT){ keys.push(dateKey(cur)); cur.setDate(cur.getDate()+1); }
    return keys;
  }
  var META={};
  function loadMeta(){ try{ META=JSON.parse(localStorage.getItem("niuma.meta.v8")||"{}")||{}; }catch(e){ META={}; } }
  function saveMeta(){ try{ localStorage.setItem("niuma.meta.v8",JSON.stringify(META)); }catch(e){} }
  function clearAt(){ return META.clearedAt||""; }
  function afterClear(k){ var c=clearAt(); return !c||k>=c; }
  function dayValue(k,now){
    var r=R[k], pay=dayPayNow();
    if(k===todayKey()){
      if(started()) return amountOf(k,now);
      if(r&&r.endMs&&r.earned>0) return r.earned;
      return 0;
    }
    if(!r) return isWorkday(k)?pay:0;
    if(r.type==="off") return 0;
    if(r.type==="paid") return pay;
    if(r.type==="sick") return pay*0.6;
    if(r.type==="p80") return pay*0.8;
    if(r.type==="ot") return pay*(r.mul||1.5);
    if(r.off) return 0;
    if(r.earned>0) return r.earned;
    return isWorkday(k)?pay:0;
  }
  function accrueSince(fromKey, now){
    var sum=0, tk=todayKey(), d=fromKey?dateOfKey(fromKey):dateOfKey(tk);
    var cur=new Date(d.getTime());
    while(dateKey(cur)<=tk){
      var k=dateKey(cur);
      if(k===tk){ sum+=amountOf(k,now); }
      else if(!clearAt()||k>=clearAt()){ sum+=dayValue(k,now); }
      cur.setDate(cur.getDate()+1);
    }
    return sum;
  }
  function loadGoals(){ try{ var a=JSON.parse(localStorage.getItem(LS_GOALS)||"[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
  function saveGoals(){ try{ localStorage.setItem(LS_GOALS,JSON.stringify(GOALS)); }catch(e){} }
  function migrateGoal(){
    if(GOALS.length) return;
    if(S.goalAmount>0){ GOALS.push({id:"g"+Date.now(),name:S.goalName||"攒钱目标",amount:S.goalAmount,base:S.goalBase||0,from:S.goalFrom||todayKey()}); saveGoals(); }
  }
  function goalSaved(g, now){ return (g.base||0)+accrueSince(g.from||todayKey(), now); }
  function goalEta(g, now){
    var left=Math.max(0,(g.amount||0)-goalSaved(g,now)), pay=dayPayNow();
    if(left<=0||pay<=0) return {left:0,days:0,date:null};
    var days=0, cur=new Date(dateOfKey(todayKey()).getTime()), guard=0;
    while(guard++<3000){ cur.setDate(cur.getDate()+1); if(isWorkday(dateKey(cur))) days++; if(days*pay>=left) return {left:left,days:days+1,date:dateKey(cur)}; }
    return {left:left,days:999,date:null};
  }
  function renderGoals(now){
    var box=document.getElementById("goalList"); if(!box) return;
    var list=GOALS.slice().sort(function(a,b){
      var ra=goalSaved(a,now)/(a.amount||1), rb=goalSaved(b,now)/(b.amount||1);
      return (ra>=1?1:0)-(rb>=1?1:0);
    });
    box.innerHTML=list.map(function(g){
      var saved=goalSaved(g,now), amt=g.amount||0, left=Math.max(0,amt-saved);
      var pct=amt>0?Math.min(100,saved/amt*100):0, eta=goalEta(g,now);
      var sub = amt<=0 ? "未填目标金额" : (left<=0 ? "已达成 🎉" : "还差 "+money(left)+" · 约 "+eta.days+" 个工作日"+(eta.date?"（"+eta.date.slice(5)+" 左右）":""));
      return '<div class="goal"><div class="gtop"><span class="gname">'+esc(g.name||"目标")+'</span>'+
        '<span class="gamt" data-edit="'+g.id+'" title="点击修改目标金额">'+money(saved)+' / '+money(amt)+(left<=0?' ✅':'')+'</span>'+
        '<button class="gdel" data-gid="'+g.id+'" title="删除">×</button></div>'+
        '<div class="bar"><i style="width:'+pct.toFixed(1)+'%"></i></div>'+
        '<p class="gsub">'+sub+'</p></div>';
    }).join("")||'<p class="gsub">还没有目标，点右上「+ 添加」。</p>';
  }
  function periodTotal(now){
    var keys=periodKeys(now), tk=todayKey(), sum=0, days=0;
    keys.forEach(function(k){
      if(k>tk) return;
      if(!afterClear(k)) return;
      var v=dayValue(k,now);
      if(v>0){ sum+=v; days++; }
    });
    return {total:sum,days:days,keys:keys};
  }

  /* ============ 跨天收尾 ============ */
  function finalizeStale(){
    var tk=todayKey(), changed=false;
    Object.keys(R).forEach(function(k){
      if(k>=tk) return;
      var r=R[k]; if(!r||!r.startMs||r.endMs) return;
      var day=dateOfKey(k), end=atTime(day,S.workEnd).getTime();
      if(end<=r.startMs) end+=86400000;        // 夜班：下班时刻落在第二天
      r.pauses=r.pauses||[];
      if(r.pauseStartMs){ r.pauses.push({s:r.pauseStartMs,e:end}); r.pauseStartMs=null; }
      r.endMs=end;
      r.earnedMs=workMsOf(k,end);
      r.earned=earnFrom(r.earnedMs, r.rate||todayRate());
      r.auto=true; changed=true;
    });
    if(changed) saveRecords();
  }

  /* ============ 渲染 ============ */
  function render(){
    var now=Date.now(), r=todayRec();
    var ms=workMsOf(todayKey(),now), earn=todayEarn(now);
    var notStarted=!(r&&(r.startMs||r.endedMs||r.manual||r.endMs));

    var el=document.getElementById("todayEarn");
    el.innerHTML=moneyHTML(earn);
    el.classList.toggle("zero",earn<=0);
    document.title=(earn>0?money(earn)+" · 牛马计时器":"牛马计时器");

    var tag=document.getElementById("stateTag");
    if(ended()){tag.textContent="今天已下班";tag.className="state";}
    else if(started()){tag.textContent="工作中";tag.className="state on";}
    else {tag.textContent="未开始";tag.className="state";}

    var rate=todayRate();
    document.getElementById("subLine").innerHTML=
      (S.salary>0?("每秒 <b>"+money(rate/3600)+"</b> · 每分钟 <b>"+money(rate/60)+"</b>"+
        (mul()>1?" · 今日 "+mul()+" 倍":"")):"先在设置里填月薪，时薪才会算出来");

    var st=periodTotal(now);
    document.getElementById("monthEarn").textContent=money(st.total);

    var rEl=document.getElementById("rateTxt");
    if(rateView===0) rEl.textContent=money(rate)+" / "+money(rate/60)+" / "+money4(rate/3600);
    else if(rateView===1) rEl.textContent="日薪 "+money(dailyPay()*mul());
    else if(rateView===2) rEl.textContent="月薪 "+money(S.salary);
    else rEl.textContent="年 "+money(S.salary*12);

    var cd=document.getElementById("countdown");
    var endT=atTime(new Date(),S.workEnd).getTime(), left=endT-now;
    if(hm2min(S.workEnd)<=hm2min(S.workStart)&&left<0) endT=atTime(new Date(),S.workEnd).getTime()+86400000, left=endT-now;
    if(!started()&&!ended()) cd.textContent="—";
    else if(left<=0) cd.textContent="已超时 "+clock(-left);
    else cd.textContent=clock(left);

    var dm=dailyMs(), dp=dm>0?Math.min(100,ms/dm*100):0;
    document.getElementById("dayBar").style.width=dp+"%";
    document.getElementById("dayPct").textContent=dp.toFixed(1)+"%";
    document.getElementById("dayLeft").textContent=money(Math.max(0,dailyPay()*mul()-earn));

    var mp=S.salary>0?Math.min(100,st.total/S.salary*100):0;
    document.getElementById("monthBar").style.width=mp+"%";
    document.getElementById("monthPct").textContent=mp.toFixed(1)+"%";
    document.getElementById("monthLabel").textContent="本期进度 "+money(st.total)+" / "+money(S.salary);

    document.getElementById("workBar").style.width=dp+"%";
    document.getElementById("workTxt").textContent=hms(ms);
    document.getElementById("workTotal").textContent=hms(dm);
    updateCalToday();
    renderGoals(now);
    var _lb=document.getElementById("monthEarnLabel");
    if(_lb) _lb.textContent=((S.payDay||15)===1)?"本月已赚":"本期已赚";
    var _st=document.getElementById("sumTag"); if(_st) _st.textContent="本期 "+st.days+" 天 · 合计 "+money(st.total);

    (function(){
    var b=document.getElementById("btnMini");
    if(b) b.addEventListener("click",function(){
      try{ window.open(location.pathname+"?mini=1","niuma_mini","width=430,height=380,menubar=no,toolbar=no"); }catch(e){}
    });
  })();
    var _lb=document.getElementById("monthEarnLabel");
    if(_lb) _lb.textContent=((S.payDay||15)===1)?"本月已赚":"本期已赚";
    var _st=document.getElementById("sumTag"); if(_st) _st.textContent="本期 "+st.days+" 天 · 合计 "+money(st.total);

    (function(){
    var b=document.getElementById("btnMini");
    if(b) b.addEventListener("click",function(){
      try{ window.open(location.pathname+"?mini=1","niuma_mini","width=430,height=380,menubar=no,toolbar=no"); }catch(e){}
    });
  })();

  document.getElementById("btnStart").style.display=(started()||ended())?"none":"inline-block";
    document.getElementById("btnStop").style.display=started()?"inline-block":"none";
    document.getElementById("btnRestart").style.display=ended()?"inline-block":"none";
  }

  function renderTables(){
    if(!document.getElementById("rankWrap")) return;
    var now=Date.now(), tk=todayKey(), mk=monthKey(now);
    var pset={}; periodKeys(now).forEach(function(k){pset[k]=1;});
    var keys=Object.keys(R).filter(function(k){
      if(!pset[k]) return false;
      var r=R[k]; return r&&(r.startMs||r.endMs||r.manual);
    });
    if(keys.indexOf(tk)<0 && started()) keys.push(tk);
    keys.sort().reverse();

    var tb=document.getElementById("detailBody");
    tb.innerHTML="";
    if(!keys.length){
      tb.innerHTML='<tr><td colspan="4" class="muted">还没有记录，先点「开始上班」</td></tr>';
    }
    keys.forEach(function(k){
      var r=R[k]||{}, ms, amount, status;
      if(k===tk&&!(r.manual&&!r.startMs)&&!r.endMs){ ms=workMsOf(k,now); amount=amountOf(k,now); status="进行中"; }
      else if(r.manual&&!r.startMs){ ms=r.earnedMs||0; amount=r.earned||0; status="补录"; }
      else { ms=r.earnedMs||0; amount=r.earned||0; status="已存档"; }
      var tr=document.createElement("tr");
      if(k===tk) tr.className="today";
      tr.innerHTML="<td>"+k.slice(5)+"</td><td>"+status+"</td>"+
        '<td class="num">'+hms(ms)+"</td>"+
        '<td class="num">'+money(amount)+"</td>";
      tb.appendChild(tr);
    });

    var rank=keys.map(function(k){
      var r=R[k]||{}, ms, amount;
      if(k===tk&&!(r.manual&&!r.startMs)&&!r.endMs){ ms=workMsOf(k,now); amount=amountOf(k,now); }
      else { ms=r.earnedMs||0; amount=r.earned||0; }
      return {k:k,ms:ms,e:amount};
    }).filter(function(x){return x.ms>0;}).sort(function(a,b){return b.e-a.e;}).slice(0,5);

    var rb=document.getElementById("rankBody");
    rb.innerHTML=rank.length?"":'<tr><td colspan="4" class="muted">还没有数据</td></tr>';
    rank.forEach(function(x,i){
      var tr=document.createElement("tr");
      tr.innerHTML='<td class="'+(i===0?"medal":"")+'">'+(i+1)+"</td><td>"+x.k+"</td>"+
        '<td class="num">'+hms(x.ms)+'</td><td class="num">'+money(x.e)+"</td>";
      rb.appendChild(tr);
    });
    document.getElementById("rankTag").textContent="本期 "+keys.length+" 天";
  }


  /* ============ 账期日历 ============ */
  function updateCalToday(){
    var el=document.querySelector('[data-k="'+todayKey()+'"] .e');
    if(el) el.textContent=money(amountOf(todayKey(),Date.now()));
  }
  function renderCalendar(){
    var wrap=document.getElementById("calWrap"); if(!wrap) return;
    var now=Date.now(), pr=periodRange(now), tk=todayKey(), pay=dayPayNow();
    var first=new Date(pr.start.getTime());
    var dow=(first.getDay()+6)%7;
    first.setDate(first.getDate()-dow);
    var cells=[], cur=new Date(first.getTime());
    while(cur.getTime()<pr.end.getTime()){ cells.push(new Date(cur.getTime())); cur.setDate(cur.getDate()+1); }
    while(cells.length%7!==0) cells.push(null);

    var html='<div class="cal">';
    ["一","二","三","四","五","六","日"].forEach(function(w){ html+='<div class="wd">'+w+'</div>'; });
    cells.forEach(function(d){
      if(!d){ html+='<div class="d out"></div>'; return; }
      var k=dateKey(d), inP=(d>=pr.start&&d<pr.end), working=isWorkday(k);
      var wd0=d.getDay();
      var cls="d"+(inP?"":" out");
      if(inP&&!working) cls+=" offday";
      if(inP&&HOLIDAYS[k]) cls+=" holiday";
      if(inP&&MAKEUP[k]) cls+=" makeup";
      if(inP&&!HOLIDAYS[k]&&!MAKEUP[k]&&(wd0===0||wd0===6)) cls+=" weekend";
      if(inP&&working&&k<tk&&afterClear(k)) cls+=" done";
      if(inP&&k<tk&&!HOLIDAYS[k]&&baseWorkday(k)) cls+=" clickable";
      if(k===tk) cls+=" today";
      if(inP&&k>tk) cls+=" future";
      var amt="", ttl="";
      var live=afterClear(k), r0=R[k];
      if(inP&&live&&k<=tk){
        var v=dayValue(k,now);
        if(v>0||k===tk) amt=money(v);
        if(r0&&r0.type){
          ttl={off:"休",paid:"带薪",sick:"病假",p80:"80%",ot:"加班"}[r0.type]||"";
          if(r0.type==="ot"&&r0.mul) ttl="加班"+r0.mul+"x";
        }
      }
      var tag=HOLIDAYS[k]?"休":(MAKEUP[k]?"班":"");
      var fes=FESTIVAL[k]||"";
      html+='<div class="'+cls+'" data-k="'+k+'"><div class="n">'+d.getDate()+'</div>'+
        (tag?'<div class="tg'+(tag==='班'?' ban':'')+'">'+tag+'</div>':'')+
        (fes?'<div class="fes">'+fes+'</div>':'')+
        (ttl?'<div class="typ">'+ttl+'</div>':'')+
        (amt?'<div class="e">'+amt+'</div>':'')+'</div>';
    });
    html+='</div>';
    wrap.innerHTML=html;

    var t=document.getElementById("calTitle");
    if(t){
      var passed=periodKeys(now).filter(function(k){return k<=tk;}).length;
      var workDays=periodKeys(now).filter(function(k){return isWorkday(k);}).length;
      t.textContent=dateKey(pr.start).slice(5)+" → "+dateKey(new Date(pr.end.getTime()-86400000)).slice(5)+
        "（"+dateKey(new Date(pr.end.getTime()-86400000)).slice(5)+" 发薪）· 已过 "+passed+"/"+periodKeys(now).length+
        " 天 · 工作日 "+workDays+" 天"+(pr.end.getFullYear()>=2027?" · 2027 假期未公布":"")
    }
  }

  /* ============ 动作 ============ */
  function startTimer(){
    if(started()||ended()) return;
    var base=atTime(new Date(),S.workStart).getTime();
    R[todayKey()]={startMs:base,endMs:null,pauses:[],pauseStartMs:null,earnedMs:0,earned:0,rate:todayRate()};
    saveRecords(); render(); renderTables(); renderCalendar(); startFast();
  }
  function stopToday(){
    if(!started()) return;
    if(!confirm("确认下班存档？存档后今天的计时会停止，之后可以点「继续计时」恢复。")) return;
    var k=todayKey(), r=todayRec(), now=Date.now();
    var r0=r.rate||todayRate();
    if(r.pauseStartMs){ r.pauses.push({s:r.pauseStartMs,e:now}); r.pauseStartMs=null; }
    r.earnedMs=workMsOf(k,now);
    r.rate=r0;
    r.earned=earnFrom(r.earnedMs,r0);
    r.endMs=now;
    saveRecords(); stopFast(); render(); renderTables(); renderCalendar();
  }
  function restartToday(){
    var k=todayKey();
    if(!confirm("继续计时？会按「上班时间」重新算今天已挣的钱，之前那次存档被覆盖。")) return;
    delete R[k]; saveRecords();
    startTimer();
  }

  /* ============ 定时器 ============ */
  var tickN=0, tickMs=0;
  function startFast(){
    stopFast();
    fastTimer=setInterval(function(){
      if(!started()) return;
      render();
      var k=todayKey(), r=R[k], ms=workMsOf(k,Date.now());
      r.earnedMs=ms; r.earned=earnFrom(ms,r.rate||todayRate());
      if((++tickN*tickMs)>=2000){ tickN=0; saveRecords(); }
    }, (tickMs=(S.freq||100)) && (S.freq||100));
  }
  function stopFast(){ if(fastTimer){clearInterval(fastTimer);fastTimer=null;} }

  function startUi(){
    if(uiTimer) clearInterval(uiTimer);
    uiTimer=setInterval(function(){
      var tk=todayKey();
      if(tk!==curDay){ curDay=tk; finalizeStale(); render(); renderTables(); renderCalendar(); return; }
      render();
      if(started()) renderTables();
    },1000);
  }

  /* ============ 设置 ============ */
  function updateFormula(){
    var h=hourly(), d=h*paidHours();
    document.getElementById("formula").innerHTML=
      "算法："+money(S.salary)+" ÷ "+S.days+" 天 ÷ "+paidHours()+" 小时 = 时薪 <b>"+money(h)+"</b>；"+
      "日薪 <b>"+money(d)+"</b>；每分钟 <b>"+money(h/60)+"</b>；每秒 <b>"+money(h/3600)+"</b>"+
      (mul()>1?"（今日按 "+mul()+" 倍计）":"")+
      (S.salary>0?"":"　<b>← 还没填月薪</b>");
  }
  function fillForm(){
    document.getElementById("iSalary").value=S.salary||"";
    document.getElementById("iDays").value=S.days;
    document.getElementById("iHours").value=paidHours()+" 小时";
    document.getElementById("iStart").value=S.workStart;
    document.getElementById("iEnd").value=S.workEnd;
    document.getElementById("iBS").value=S.breakStart;
    document.getElementById("iBE").value=S.breakEnd;
    document.getElementById("iMul").value=String(mul());
    document.getElementById("iFreq").value=String(S.freq||100);
    document.getElementById("iPayDay").value=S.payDay||15;
    document.getElementById("iRest").value=S.restMode||"double";
    updateFormula();
  }
  function readForm(){
    S.salary=parseFloat(document.getElementById("iSalary").value)||0;
    S.days=parseFloat(document.getElementById("iDays").value)||21.75;
    S.workStart=document.getElementById("iStart").value||"09:00";
    S.workEnd=document.getElementById("iEnd").value||"18:00";
    S.breakStart=document.getElementById("iBS").value||"12:00";
    S.breakEnd=document.getElementById("iBE").value||"13:00";
    S.mul=parseFloat(document.getElementById("iMul").value)||1;
    S.freq=parseInt(document.getElementById("iFreq").value,10)||100;
    S.payDay=Math.min(31,Math.max(1,parseInt(document.getElementById("iPayDay").value,10)||15));
    S.restMode=document.getElementById("iRest").value||"double";
    S.hours=paidHours();
  }

  function download(text,name){
    var blob=new Blob([text],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download=name;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
  }
  function csvOf(keys,filename){
    var tk=todayKey();
    var head=["日期","状态","工时(小时)","时薪(元)","收入(元)"];
    var lines=keys.sort().map(function(k){
      var r=R[k]||{}, ms,amt,rate,st;
      if(k===tk&&!(r.manual&&!r.startMs)&&!r.endMs){ ms=workMsOf(k,Date.now()); rate=r.rate||todayRate(); amt=amountOf(k,Date.now()); st="进行中"; }
      else if(r.manual&&!r.startMs){ ms=r.earnedMs||0; rate=r.rate||todayRate(); amt=r.earned||0; st="补录"; }
      else { ms=r.earnedMs||0; rate=r.rate||todayRate(); amt=r.earned||0; st=r.auto?"自动收尾":"已存档"; }
      return [k,st,(ms/3600000).toFixed(2),rate.toFixed(2),amt.toFixed(2)].join(",");
    });
    download("\uFEFF"+head.join(",")+"\n"+lines.join("\n"),filename);
  }

  /* ============ 事件绑定 ============ */
  (function(){
    var b=document.getElementById("btnMini");
    if(b) b.addEventListener("click",function(){
      try{ window.open(location.pathname+"?mini=1","niuma_mini","width=430,height=380,menubar=no,toolbar=no"); }catch(e){}
    });
  })();
  (function(){
    var form=document.getElementById("goalForm");
    var sv=document.getElementById("gSave");
    if(sv) sv.addEventListener("click",function(){
      var name=(document.getElementById("gName").value||"目标").trim();
      var amt=Math.max(0,parseFloat(document.getElementById("gAmount").value)||0);
      var base=Math.max(0,parseFloat(document.getElementById("gBase").value)||0);
      var from=document.getElementById("gFrom").value||todayKey();
      if(!amt){ alert("请填目标金额"); return; }
      GOALS.push({id:"g"+GOALS.length+"_"+Date.now(),name:name,amount:amt,base:base,from:from}); saveGoals();
      form.style.display="none";
      document.getElementById("gName").value=""; document.getElementById("gAmount").value=""; document.getElementById("gBase").value="";
      render();
    });
    var cn=document.getElementById("gCancel");
    if(cn) cn.addEventListener("click",function(){ form.style.display="none"; });
    var list=document.getElementById("goalList");
    if(list) list.addEventListener("click",function(e){
      var ed=e.target.closest?e.target.closest("[data-edit]"):null;
      if(ed){
        var gid=ed.getAttribute("data-edit"), g0=null;
        GOALS.forEach(function(g){ if(g.id===gid) g0=g; });
        if(!g0) return;
        var v=prompt("把「"+g0.name+"」的目标金额改成多少？（元）", String(g0.amount||0));
        if(v==null) return;
        var n=Math.max(0,parseFloat(v)||0); if(!n){ alert("金额要大于 0"); return; }
        g0.amount=n; saveGoals(); render(); return;
      }
      var b=e.target.closest?e.target.closest("[data-gid]"):null; if(!b) return;
      var id=b.getAttribute("data-gid");
      GOALS=GOALS.filter(function(g){return g.id!==id;}); saveGoals(); render();
    });
  })();
  document.getElementById("btnStart").addEventListener("click",startTimer);
  document.getElementById("btnStop").addEventListener("click",stopToday);
  document.getElementById("btnRestart").addEventListener("click",restartToday);

  document.getElementById("chipRate").addEventListener("click",function(){rateView=(rateView+1)%4;render();});
  document.getElementById("chipMonth").addEventListener("click",function(){
    var st=periodTotal(Date.now());
    alert("本月已赚 "+money(st.total)+"\n月薪 "+money(S.salary)+
      "\n完成度 "+(S.salary>0?Math.min(100,st.total/S.salary*100).toFixed(1):"0")+"%"+
      "\n已记录 "+st.days+" 天");
  });

  document.getElementById("btnSave").addEventListener("click",function(){
    readForm(); saveSettings(); document.getElementById("box").open=false;
    render(); renderTables(); renderCalendar(); startFast(); updateFormula();
  });

  function addForDate(seed){
    var k=seed; if(!k) return;
    var tk=todayKey();
    if(k>tk) return;
    if(k===tk){ alert("今天是实时计时，点「下班存档」就行"); return; }
    var pr=periodRange(Date.now()), dt=dateOfKey(k);
    if(dt<pr.start||dt>=pr.end) return;
    if(HOLIDAYS[k]) return;            // 法定假日不可点
    if(!baseWorkday(k)) return;        // 普通周末/休息日不可点；调休补班日可点
    var off=!!(R[k]&&R[k].off);
    R[k]=R[k]||{};
    if(off){ delete R[k].off; if(!Object.keys(R[k]).length) delete R[k]; }
    else { R[k].off=true; }
    saveRecords(); render(); renderCalendar();
  }
  document.getElementById("btnAdd").addEventListener("click",function(){
    var d=prompt("要标记/取消哪一天？（格式 2026-11-02）",todayKey());
    if(d) addForDate(d);
  });
  var menuDay=null;
  function openDayMenu(k,x,y){
    menuDay=k;
    var m=document.getElementById("dayMenu"); if(!m) return;
    m.style.display="block";
    m.style.left=Math.max(8,Math.min(window.innerWidth-180,x-70))+"px";
    m.style.top=(y+6)+"px";
    document.getElementById("dayMenuTitle").textContent=k;
  }
  function closeDayMenu(){ var m=document.getElementById("dayMenu"); if(m) m.style.display="none"; menuDay=null; }
  function setDayType(t,mul){
    var k=menuDay; if(!k) return;
    var r=R[k]||{};
    if(!t){ delete r.type; delete r.mul; if(!Object.keys(r).length) delete R[k]; else R[k]=r; }
    else { r.type=t; if(mul) r.mul=mul; R[k]=r; }
    saveRecords(); closeDayMenu(); render(); renderCalendar();
  }
  document.getElementById("calWrap").addEventListener("click",function(e){
    var n=e.target; while(n&&n!==this&&!(n.getAttribute&&n.getAttribute("data-k"))) n=n.parentNode;
    var k=n&&n.getAttribute&&n.getAttribute("data-k"); if(!k) return;
    var tk=todayKey();
    if(k>tk) return;
    var pr=periodRange(Date.now()), dt=dateOfKey(k);
    if(dt<pr.start||dt>=pr.end) return;
    if(HOLIDAYS[k]) return;
    if(!baseWorkday(k)&&!(R[k]&&R[k].type)) return;
    openDayMenu(k, e.clientX||0, e.clientY||0);
  });
  document.getElementById("dayMenu").addEventListener("click",function(e){
    var b=e.target.closest?e.target.closest("[data-t]"):null; if(!b) return;
    var t=b.getAttribute("data-t"), mul=parseFloat(b.getAttribute("data-m")||"0")||0;
    setDayType(t==="normal"?"":t, mul);
  });
  document.addEventListener("click",function(e){
    var m=document.getElementById("dayMenu");
    if(m&&m.style.display==="block"&&!m.contains(e.target)&&!(e.target.closest&&e.target.closest("#calWrap"))) closeDayMenu();
  },true);

  document.getElementById("btnExport").addEventListener("click",function(){
    var now=Date.now(), pr=periodRange(now), tk=todayKey(), pay=dayPayNow();
    var rows=[["日期","是否上班","当天收入"]], sum=0;
    periodKeys(now).forEach(function(k){
      if(k>tk) return;
      var w=isWorkday(k), amt=0;
      if(!afterClear(k)){ rows.push([k,"休息","0.00"]); return; }
      if(w) amt=(k===tk)?amountOf(k,now):((R[k]&&R[k].earned>0)?R[k].earned:pay);
      sum+=amt;
      rows.push([k,w?"上班":"休息",amt.toFixed(2)]);
    });
    rows.push(["合计","",sum.toFixed(2)]);
    var NL=String.fromCharCode(13,10), BOM=String.fromCharCode(0xFEFF);
    var csv=rows.map(function(r){return r.join(",");}).join(NL);
    var blob=new Blob([BOM+csv],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="工时收入_"+dateKey(pr.start)+"_至_"+dateKey(new Date(pr.end.getTime()-86400000))+".csv";
    a.click();
  });
  document.getElementById("btnExportAll").addEventListener("click",function(){
    var keys=Object.keys(R);
    if(!keys.length){alert("还没有记录");return;}
    csvOf(keys,"工时收入_全部.csv");
  });
  document.getElementById("btnDefault").addEventListener("click",function(){
    if(!confirm("把所有设置恢复成默认值？(不会删记录)")) return;
    S=Object.assign({},DEFAULT); saveSettings(); fillForm(); render(); renderTables();
  });
  document.getElementById("btnClear").addEventListener("click",function(){
    if(!confirm("确定清空全部记录？不可恢复。"))return;
    if(!confirm("再确认一次：真的要删掉所有工时收入数据？"))return;
    if(!confirm("确认清空全部数据？所有存档和标记都会删除，且无法恢复。")) return;
    META={clearedAt:todayKey()}; saveMeta(); R={}; saveRecords(); stopFast(); render(); renderTables(); renderCalendar();
  });

  document.addEventListener("keydown",function(e){
    var t=e.target&&e.target.tagName;
    if(t==="INPUT"||t==="SELECT"||t==="TEXTAREA"||t==="BUTTON") return;
    if(e.code==="Space"){
      e.preventDefault();
      if(!started()&&!ended()) startTimer();
    }
  });

  function openSetup(){
    document.getElementById("mSalary").value=S.salary||"";
    document.getElementById("mDays").value=S.days;
    document.getElementById("mStart").value=S.workStart;
    document.getElementById("mEnd").value=S.workEnd;
    document.getElementById("mBS").value=S.breakStart;
    document.getElementById("mBE").value=S.breakEnd;
    document.getElementById("setupModal").classList.add("show");
    }
  document.getElementById("mSave").addEventListener("click",function(){
    S.salary=parseFloat(document.getElementById("mSalary").value)||0;
    S.days=parseFloat(document.getElementById("mDays").value)||21.75;
    S.workStart=document.getElementById("mStart").value||"09:00";
    S.workEnd=document.getElementById("mEnd").value||"18:00";
    S.breakStart=document.getElementById("mBS").value||"12:00";
    S.breakEnd=document.getElementById("mBE").value||"13:00";
    S.hours=paidHours(); saveSettings();
    document.getElementById("setupModal").classList.remove("show");
    fillForm(); render(); renderTables(); renderCalendar();
  });
  document.getElementById("mSkip").addEventListener("click",function(){
    saveSettings();
    document.getElementById("setupModal").classList.remove("show");
    fillForm(); render(); renderTables();
  });

  /* ============ 启动 ============ */
  window.onerror=function(msg,src,line){
    var b=document.getElementById("errBar");
    if(b){b.style.display="block";b.textContent="页面出错（把这段话发给我）："+msg+" @"+line;}
    return false;
  };
  finalizeStale();
  loadMeta(); fillForm(); render(); renderTables(); renderCalendar(); startUi();
  if(started()) startFast();
  if(!localStorage.getItem(LS_SET)) openSetup();
})();
