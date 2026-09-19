import { distanceBetween, formatDistance } from './distance.js';
import { lots, places } from './data.js';
const $=id=>document.getElementById(id);
let selected='litton', destination='Newman Library', markers=[],destMarker;
let map;
function count(lot){return $('scenario').value==='busy'?Math.max(0,lot.spaces-15):$('scenario').value==='quiet'?lot.spaces+20:lot.spaces;}
function eligible(lot){return lot.permits.includes($('permit').value);}
function distance(lot){return distanceBetween(lot.point,places[destination]);}
function availability(lot){return !eligible(lot)?'Permit mismatch':count(lot)===0?'Full':count(lot)<15?'Limited':'Available';}
function statusClass(lot){return !eligible(lot)||count(lot)===0?'full':count(lot)<15?'limited':'';}
function visibleLots(){return lots.filter(lot=>!$('eligible').checked||eligible(lot)).sort((a,b)=>distance(a)-distance(b));}
function render(){
 const visible=visibleLots();
 if(!visible.some(l=>l.id===selected)) selected=visible[0]?.id;
 $('count').textContent=`${visible.length} ${visible.length === 1 ? "option" : "options"}`;
 $('results').innerHTML=visible.length?visible.map(lot=>`<button class="lot-card ${lot.id===selected?'selected':''}" data-lot="${lot.id}" aria-pressed="${lot.id===selected}"><div class="card-top"><h3>${lot.name}</h3><span class="availability ${statusClass(lot)}">${availability(lot)}</span></div><p class="sub">${lot.type}</p><div class="card-bottom"><span>${count(lot)} spaces · simulated</span><b>~${formatDistance(distance(lot))} away ↗</b></div></button>`).join(''):'<p class="empty">No matching lots. Turn off the permit filter to explore other options.</p>';
 document.querySelectorAll('[data-lot]').forEach(button=>button.addEventListener('click',()=>selectLot(button.dataset.lot,true)));
 const lot=lots.find(l=>l.id===selected);
 $('detail').hidden=!lot;
 if(lot){$('detail').innerHTML=`<p class="eyebrow">YOUR PARKING PLAN</p><h2>${lot.name}</h2><p class="detail-sub">${lot.type}</p><div class="detail-metrics"><div><strong>${count(lot)}</strong><small>spaces · simulated</small></div><div><strong>~${formatDistance(distance(lot))}</strong><small>straight-line estimate</small></div></div><p class="section-label">${eligible(lot)?'WHERE YOUR PERMIT APPLIES':'THIS PERMIT DOES NOT MATCH'}</p><div class="parking-rule">${eligible(lot)?lot.rule:'Choose a different permit or lot. '+lot.rule}</div><p class="detail-note">${lot.note}</p><a class="action-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lot.name+' Virginia Tech Blacksburg')}" target="_blank" rel="noopener">Find lot in Google Maps ↗</a><a class="secondary-link" href="${lot.source}" target="_blank" rel="noopener">Check official parking rules ↗</a>`;}
 if(map){markers.forEach(marker=>marker.remove());markers=[];visible.forEach(lot=>{const marker=L.marker(lot.point,{icon:L.divIcon({className:'pin',html:`<div class="pin-body ${statusClass(lot)} ${lot.id===selected?'selected':''}"><span>P</span><span>${count(lot)}</span></div>`,iconSize:[1,1]}),title:`${lot.name}: ${count(lot)} simulated spaces`,keyboard:true}).addTo(map).bindTooltip(lot.name,{direction:'top',offset:[0,-18]}).on('click',()=>selectLot(lot.id,false));markers.push(marker);});if(destMarker)destMarker.remove();destMarker=L.marker(places[destination],{icon:L.divIcon({className:'destination-pin',iconSize:[24,24]}),title:destination}).addTo(map).bindTooltip(destination,{permanent:true,direction:'top',offset:[0,-8]});}
}
function isMobile(){return window.matchMedia('(max-width: 720px)').matches;}
function setMobileView(view,moveFocus=false){
 document.body.dataset.mobileView=view;
 $('mobile-map').classList.toggle('active',view==='map');
 $('mobile-map').setAttribute('aria-selected',view==='map');
 $('mobile-find').classList.toggle('active',view==='list');
 $('mobile-find').setAttribute('aria-selected',view==='list');
 if(view==='map'&&map)setTimeout(()=>map.invalidateSize(),0);
 if(moveFocus)$(view==='map'?'mobile-map':'mobile-find').focus();
}
function selectLot(id,focusMap){selected=id;render();$('detail').scrollTop=0;if(map&&focusMap){const lot=lots.find(l=>l.id===id);map.setView(lot.point,16,{animate:false});}if(isMobile()&&focusMap)setMobileView('map');}
if(window.L){$('map').textContent='';map=L.map('map',{zoomControl:false}).setView([37.2247,-80.422],15);L.control.zoom({position:'topright'}).addTo(map);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).on('tileerror',()=>{$('map-warning').hidden=false;$('map-warning').textContent='Map tiles could not load. Lot details and filters still work.';}).addTo(map);}
else{$('map').innerHTML='<p class="map-loading">The map library could not load. Check your connection. You can still explore the lot list.</p>';}
for(const id of ['permit','scenario','eligible'])$(id).addEventListener('change',render);
function search(){const match=Object.keys(places).find(name=>name.toLowerCase()===$('destination').value.trim().toLowerCase());if(match){destination=match;$('search-status').textContent='';render();if(map)map.setView(places[destination],15,{animate:false});}else{$('search-status').textContent='Choose Newman Library, Torgersen Hall, Lane Stadium, or Drillfield for this demo.';}}
$('destination').addEventListener('change',search);$('filters').addEventListener('submit',event=>{event.preventDefault();search();});
$('reset-map').addEventListener('click',()=>{if(map)map.setView([37.2247,-80.422],15,{animate:false});});
$('mobile-map').addEventListener('click',()=>setMobileView('map'));
$('mobile-find').addEventListener('click',()=>setMobileView('list'));
$('open-sources').addEventListener('click',()=>$('sources').showModal());$('close-sources').addEventListener('click',()=>$('sources').close());render();
window.addEventListener('pageshow',render);
