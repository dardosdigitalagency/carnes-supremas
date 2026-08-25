const toggle=document.querySelector('.menu-toggle');const nav=document.querySelector('#nav');toggle?.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));nav.classList.toggle('open',!open)});nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');toggle?.setAttribute('aria-expanded','false')}));document.querySelectorAll('#year').forEach(el=>el.textContent=new Date().getFullYear());

const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reduced){
  document.querySelectorAll('main>section,.product-card,.location-card,.process-card,.testimonial,.client-logo').forEach(el=>el.classList.add('reveal'));
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}}),{threshold:.12,rootMargin:'0px 0px -6%'});
  document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
  document.querySelectorAll('[data-count]').forEach(el=>{const target=Number(el.dataset.count);const countObserver=new IntersectionObserver(([entry],obs)=>{if(!entry.isIntersecting)return;const start=performance.now(),duration=1100;const tick=now=>{const p=Math.min((now-start)/duration,1);el.textContent=Math.round(target*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick)};requestAnimationFrame(tick);obs.disconnect()},{threshold:.7});countObserver.observe(el)});
  const hero=document.querySelector('.hero,.page-hero');if(hero){addEventListener('scroll',()=>{hero.style.setProperty('--scroll',`${Math.min(scrollY*.12,90)}px`)},{passive:true})}
}
