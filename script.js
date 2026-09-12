'use strict';
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
function closeMenu(){menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','เปิดเมนู');navigation.classList.remove('open');}
menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')!=='true';menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'ปิดเมนู':'เปิดเมนู');navigation.classList.toggle('open',open);});
navigation.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&navigation.classList.contains('open')){closeMenu();menuButton.focus();}});
const heroSlides=[{image:'image25.jpg',client:'ธนาคารอาคารสงเคราะห์ — แผนก IT',alt:'การอบรมทีม IT ธนาคารอาคารสงเคราะห์ ผู้เรียนร่วมเรียนรู้ในห้องประชุม'},{image:'image31.jpg',client:'บูรพา เทคนิคอล เอ็นจิเนียริ่ง',alt:'ผู้เรียนและวิทยากรในการอบรมของบูรพา เทคนิคอล เอ็นจิเนียริ่ง'},{image:'image17.jpg',client:'KGI — ChatGPT & AI Mastery',alt:'ภาพหมู่ผู้เรียนหลักสูตร ChatGPT & AI Mastery ของ KGI'}];
let slideIndex=0;
function changeSlide(direction){slideIndex=(slideIndex+direction+heroSlides.length)%heroSlides.length;const slide=heroSlides[slideIndex];const image=document.querySelector('#hero-image');image.src=`assets/profile/${slide.image}`;image.alt=slide.alt;document.querySelector('#hero-client').textContent=slide.client;document.querySelector('#slide-index').textContent=`0${slideIndex+1} / 03`;}
document.querySelector('#prev-slide').addEventListener('click',()=>changeSlide(-1));document.querySelector('#next-slide').addEventListener('click',()=>changeSlide(1));
const work=[
{name:'สำนักงานปรมาณูเพื่อสันติ',category:'public',type:'หน่วยงานภาครัฐ',course:'ChatGPT & AI Mastery',image:'image26.jpg'},
{name:'KGI',category:'finance',type:'สถาบันการเงิน',course:'ChatGPT & AI Mastery',image:'image17.jpg'},
{name:'ThaiBev',category:'private',type:'ภาคเอกชน',course:'ChatGPT & AI Mastery',image:'image22.jpg'},
{name:'Software Park Thailand',category:'public',type:'หน่วยงานภาครัฐ',image:'image16.jpg'},
{name:'ธนาคารอาคารสงเคราะห์ — แผนก IT',category:'finance',type:'สถาบันการเงินเฉพาะกิจของรัฐ',image:'image25.jpg'},
{name:'Quick Transformation',category:'private',type:'บริษัทมหาชน',image:'image14.jpg'},
{name:'วิทยุการบินแห่งประเทศไทย',category:'public',type:'รัฐวิสาหกิจ',course:'ChatGPT & AI Mastery',image:'image29.jpg'},
{name:'กรุงเทพประกันชีวิต',category:'finance',type:'ภาคเอกชน',course:'Secure Coding',image:'image27.jpg'},
{name:'ธนาคารอาคารสงเคราะห์ — ทีม Audit',category:'finance',type:'สถาบันการเงินเฉพาะกิจของรัฐ',image:'image30.jpg'},
{name:'บูรพา เทคนิคอล เอ็นจิเนียริ่ง',category:'private',type:'บริษัทมหาชน · งานวิศวกรรม',image:'image31.jpg'},
{name:'การเคหะแห่งชาติ',category:'public',type:'รัฐวิสาหกิจ',image:'image32.jpg'}];
let activeFilter='all',expanded=false;const workGrid=document.querySelector('#work-grid');const showWork=document.querySelector('#show-work');
function renderWork(){const filtered=work.filter(item=>activeFilter==='all'||item.category===activeFilter);const visible=expanded?filtered:filtered.slice(0,3);workGrid.replaceChildren(...visible.map(item=>{const card=document.createElement('article');card.className='work-card';const image=document.createElement('img');image.src=`assets/profile/${item.image}`;image.alt=`บรรยากาศการอบรม ${item.name}`;image.loading='lazy';image.width=600;image.height=395;const heading=document.createElement('h3');heading.textContent=item.name;const description=document.createElement('p');description.textContent=item.course?`${item.type} · ${item.course}`:item.type;card.append(image,heading,description);return card;}));showWork.hidden=filtered.length<=3;showWork.setAttribute('aria-expanded',String(expanded));showWork.innerHTML=expanded?'แสดงน้อยลง <span aria-hidden="true">−</span>':`ดูการอบรมทั้งหมด (${filtered.length}) <span aria-hidden="true">＋</span>`;document.querySelector('#work-status').textContent=`แสดง ${visible.length} จาก ${filtered.length} รายการ`;}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;expanded=false;document.querySelectorAll('[data-filter]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});renderWork();}));
showWork.addEventListener('click',()=>{expanded=!expanded;renderWork();if(!expanded)document.querySelector('.filter-row').scrollIntoView({block:'start'});});renderWork();
const courseDetails={ai:{name:'ChatGPT & AI Mastery',description:'สำหรับทีมที่ต้องการใช้ AI กับงานที่ทำอยู่จริง เรียนรู้ทั้งวิธีสื่อสารกับเครื่องมือและการนำมาใช้ร่วมกันในทีม',outcomes:['เขียน prompt สำหรับงานเอกสารที่ทำอยู่จริงได้เอง','วางขั้นตอนทำงานร่วมกับ AI ในทีม','รู้ว่าข้อมูลใดไม่ควรใส่ลงในเครื่องมือ AI']},secure:{name:'Secure Coding',description:'สำหรับทีมพัฒนาที่ต้องผ่านการตรวจสอบ และทีม Audit ที่ต้องรู้ว่าต้องดูอะไร เพื่อเชื่อมเรื่องความปลอดภัยกับงานที่รับผิดชอบ',outcomes:['เข้าใจการเขียนโค้ดอย่างปลอดภัยในบริบทงานพัฒนา','เข้าใจประเด็นที่ทีม Audit ต้องใช้ตรวจสอบ','นำแนวทางการเรียนรู้ไปปรับใช้กับงานของทีม']}};
const courseDialog=document.querySelector('#course-dialog');let selectedCourse='ai';
document.querySelectorAll('[data-course]').forEach(button=>button.addEventListener('click',()=>{selectedCourse=button.dataset.course;const course=courseDetails[selectedCourse];document.querySelector('#dialog-title').textContent=course.name;document.querySelector('#dialog-description').textContent=course.description;document.querySelector('#dialog-outcomes').replaceChildren(...course.outcomes.map(outcome=>{const li=document.createElement('li');li.textContent=outcome;return li;}));courseDialog.showModal();document.body.classList.add('dialog-open');}));
document.querySelector('.dialog-close').addEventListener('click',()=>courseDialog.close());courseDialog.addEventListener('close',()=>document.body.classList.remove('dialog-open'));courseDialog.addEventListener('click',event=>{const r=courseDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)courseDialog.close();});
document.querySelector('#choose-course').addEventListener('click',()=>{document.querySelector('#course-select').value=courseDetails[selectedCourse].name;courseDialog.close();document.querySelector('#contact').scrollIntoView({block:'start'});document.querySelector('input[name=name]').focus({preventScroll:true});});

const downloadForm=document.querySelector('#download-form');
const localPreview=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
if(localPreview)document.querySelector('#download-notice').textContent='โหมดตัวอย่าง: ทดลองดาวน์โหลดได้ ข้อมูลในแบบฟอร์มจะไม่ถูกส่งหรือบันทึก';
let requestId=crypto.randomUUID();
downloadForm.addEventListener('submit',async event=>{
 event.preventDefault();
 for(const field of downloadForm.querySelectorAll('input[required]')){
  if(!field.value.trim()){field.setCustomValidity('กรุณาระบุข้อมูลให้ครบ');field.reportValidity();field.addEventListener('input',()=>field.setCustomValidity(''),{once:true});return;}
 }
 const button=downloadForm.querySelector('button[type=submit]');const status=document.querySelector('#form-status');
 const original=button.innerHTML;button.disabled=true;button.textContent='กำลังเตรียมเอกสาร…';status.textContent='';
 try{
  if(!localPreview){
   const response=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestId},body:JSON.stringify(Object.fromEntries(new FormData(downloadForm))),signal:AbortSignal.timeout(15000)});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.ok)throw new Error(result.message||'ยังส่งข้อมูลไม่ได้ กรุณาลองใหม่อีกครั้ง');
  }
  const link=document.querySelector('#download-again');link.hidden=false;link.click();
  status.textContent=localPreview?'ดาวน์โหลดเอกสารตัวอย่างแล้ว ยังไม่มีการส่งข้อมูลติดต่อ':'รับข้อมูลแล้ว เอกสารพร้อมดาวน์โหลด หากไฟล์ไม่เริ่มดาวน์โหลด ให้กดลิงก์ด้านล่าง';
  requestId=crypto.randomUUID();
 }catch(error){status.textContent=error.name==='TimeoutError'?'การส่งข้อมูลใช้เวลานาน กรุณาลองใหม่อีกครั้ง':error.message;}
 finally{button.disabled=false;button.innerHTML=original;}
});
