'use strict';
const $ = id => document.getElementById(id);
let content = {video:{url:''},quiz:{answerKeyApproved:false},questions:[]};
let answers = {};
let lastScore = null;
const form = $('role-form');
function roleChanged(){
  const agency = $('role').value === 'Agency';
  $('agency-field').hidden = !agency;
  $('agency').required = agency;
  $('agency').disabled = !agency;
  if (!agency) $('agency').value = '';
  $('role-error').hidden = true;
}
$('role').addEventListener('change',roleChanged);
roleChanged();
function node(tag,text,className){const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;}
function validRole(){
  if (!form.reportValidity()) return false;
  if ($('role').value === 'Agency' && !$('agency').value.trim()) {
    $('role-error').textContent = 'Please enter your agency name.';
    $('role-error').hidden = false;
    $('agency').focus();return false;
  }
  return true;
}
function showRoute(){
  const quiz = location.hash === '#quiz';
  if (quiz && !validRole()) {history.replaceState(null,'','#watch');return;}
  $('watch-view').hidden = quiz;
  $('quiz-view').hidden = !quiz;
  $('step-watch').classList.toggle('current',!quiz);
  $('step-quiz').classList.toggle('current',quiz);
  if (quiz) {
    $('participant').textContent = $('role').value === 'Agency' ? 'Agency · ' + $('agency').value.trim() : 'Harlequin Employee';
    renderQuiz();$('quiz-heading').focus();
  }
}
form.addEventListener('submit',event=>{event.preventDefault();if(validRole()){if(location.hash==='#quiz')showRoute();else location.hash='quiz';}});
$('back-video').addEventListener('click',()=>{location.hash='watch';});
window.addEventListener('hashchange',showRoute);
function renderQuiz(){
  const body=$('quiz-body');body.replaceChildren();
  if(!content.questions.length){
    const box=node('div',null,'empty-quiz');
    box.append(node('h3','The quiz is being prepared.'),node('p','The approved questions and answers will be added here alongside the induction video. This preview does not record training completion.'));
    body.append(box);return;
  }
  const canGrade=content.quiz.answerKeyApproved===true && content.questions.every(q=>Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length);
  const intro=node('div',null,'quiz-intro');
  if(content.quiz.title)intro.append(node('h3',content.quiz.title));
  intro.append(node('p','Select one answer for each of the '+content.questions.length+' questions.'));
  if(content.quiz.source)intro.append(node('p',content.quiz.source,'quiz-source'));
  if(!canGrade)intro.append(node('p',content.quiz.keyStatus==='proposed'?'Review your selections against the proposed answers from the booklet. Some answers are inferred and question 11 needs confirmation. Automatic scoring is pending an approved answer key.':'You can review your selections. Scoring will be available once the correct answers have been confirmed.','key-pending'));
  body.append(intro);
  const quiz=node('form',null,'quiz-form');
  content.questions.forEach((question,index)=>{
    const field=node('fieldset',null,'question');field.append(node('legend',(index+1)+'. '+question.question));
    question.options.forEach((option,optionIndex)=>{
      const label=node('label',null,'answer');const radio=node('input');radio.type='radio';radio.name='question-'+index;radio.value=String(optionIndex);radio.required=true;radio.checked=answers[index]===optionIndex;
      radio.addEventListener('change',()=>{answers[index]=optionIndex;lastScore=null;body.querySelector('.result')?.remove();quiz.querySelectorAll('.feedback').forEach(el=>el.remove());});label.append(radio,node('span',String.fromCharCode(65+optionIndex)+'. '+option));field.append(label);
    });quiz.append(field);
  });
  const submit=node('button',canGrade?'Check my answers':'Review my answers','primary');submit.type='submit';quiz.append(submit);
  const error=node('p',null,'form-error');error.setAttribute('role','alert');error.hidden=true;quiz.append(error);
  quiz.addEventListener('submit',event=>{
    event.preventDefault();if(!quiz.reportValidity())return;
    let correct=0;const fields=quiz.querySelectorAll('fieldset');
    content.questions.forEach((question,index)=>{
      const answer=Number(new FormData(quiz).get('question-'+index));answers[index]=answer;
      const success=canGrade && answer===question.answer;correct+=success?1:0;
      fields[index].querySelector('.feedback')?.remove();
      const feedbackText=canGrade?(success?'Correct. ':'Review this answer. ')+ 'Answer: '+question.options[question.answer]+(question.explanation?' '+question.explanation:''):'Your selection: '+String.fromCharCode(65+answer)+'. '+question.options[answer];
      const feedback=node('div',null,'feedback');feedback.append(node('p',feedbackText));
      if(!canGrade && content.quiz.keyStatus==='proposed'){
        const proposed=question.proposedAnswer;
        feedback.append(node('p',Number.isInteger(proposed)?'Proposed answer: '+String.fromCharCode(65+proposed)+'. '+question.options[proposed]+(question.answerBasis==='inferred'?' (inferred)':' (supported by the booklet)'):'Answer unresolved: the booklet does not identify the intended choice.'));
        if(question.explanation)feedback.append(node('p',question.explanation));
        if(Array.isArray(question.referencePages))feedback.append(node('p','Booklet '+(question.referencePages.length===1?'page ':'pages ')+question.referencePages.join(', ')));
      }
      fields[index].append(feedback);
    });
    lastScore=canGrade?{correct,total:content.questions.length}:null;body.querySelector('.result')?.remove();
    const result=node('div',null,'result');result.setAttribute('tabindex','-1');result.setAttribute('role','status');result.append(node('h3',canGrade?'You scored '+correct+' out of '+content.questions.length:'Your '+content.questions.length+' answers are ready to review'),node('p',canGrade?'Review your answers below. Your result is shown on this page only and is not saved as a training record.':'Review your selections below. They have not been marked or saved as a training record.'));body.prepend(result);result.focus();submit.textContent=canGrade?'Check answers again':'Review answers again';
  });body.append(quiz);
}
function embedVideo(video){
  if(!video?.url)return;
  let url;try{url=new URL(video.url);}catch{return;}
  if(url.protocol!=='https:')return;
  let element;
  if(/\.(mp4|webm|ogg)$/i.test(url.pathname)){
    element=node('video');element.controls=true;element.preload='metadata';element.src=url.href;
    if(video.captionsUrl){const track=node('track');track.kind='captions';track.srclang='en';track.label='English';track.src=video.captionsUrl;element.append(track);}
    element.append(node('p','Your browser cannot play this video.'));
  }else{
    let embed='';const host=url.hostname.replace(/^www\./,'');
    if(host==='youtu.be'){const id=url.pathname.slice(1);if(/^[\w-]{11}$/.test(id))embed='https://www.youtube-nocookie.com/embed/'+id;}
    if(['youtube.com','youtube-nocookie.com'].includes(host)){const id=url.searchParams.get('v')||url.pathname.split('/').pop();if(/^[\w-]{11}$/.test(id||''))embed='https://www.youtube-nocookie.com/embed/'+id;}
    if(['vimeo.com','player.vimeo.com'].includes(host)){const id=url.pathname.split('/').pop();if(/^\d+$/.test(id||''))embed='https://player.vimeo.com/video/'+id;}
    if(!embed)return;
    element=node('iframe');element.src=embed;element.title=video.title||'Harlequin induction and refresher video';element.allow='fullscreen; picture-in-picture';element.allowFullscreen=true;element.referrerPolicy='strict-origin-when-cross-origin';
  }
  $('video-container').replaceChildren(element);$('video-guidance').textContent='Watch the full induction video before taking the quiz. You can return here to review it at any time.';
}
fetch('content.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('Content unavailable');return response.json();}).then(data=>{
  content.video=data.video||{url:''};
  content.quiz=data.quiz||{answerKeyApproved:false};
  content.questions=Array.isArray(data.questions)?data.questions.filter(q=>typeof q.question==='string'&&Array.isArray(q.options)&&q.options.length>=2&&q.options.every(o=>typeof o==='string')&&(q.answer==null||(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length))):[];
  embedVideo(content.video);
  if(content.questions.length)$('pending-note').textContent=content.questions.length+' questions · Select one answer per question';
  if(location.hash==='#quiz')showRoute();
}).catch(()=>{$('pending-note').textContent='Quiz content is temporarily unavailable';});
$('year').textContent=new Date().getFullYear();
if(location.hash==='#quiz')showRoute();
if(navigator.modelContext?.registerTool){
  navigator.modelContext.registerTool({name:'get_induction_status',description:'Read whether the Harlequin induction video and quiz are available. Includes role and quiz progress on this page only.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>({content:[{type:'text',text:JSON.stringify({videoAvailable:Boolean(content.video.url),questionCount:content.questions.length,role:$('role').value||null,answeredQuestions:Object.keys(answers).length,result:lastScore})}]})});
}
