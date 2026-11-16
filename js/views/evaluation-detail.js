import { icon } from '../icons.js';
import * as api from '../api.js';
import { $, $$, esc, Avatar, StatusBadge, Ring, Empty, toast, Modal, confirmModal,
         PageThumbs, fmtDate, ago, toneOf, gradeOf, pct, fmtBytes } from '../components.js';
import { go, path } from '../router.js';
import { splitByPage } from '../paging.js';
import { setCrumbs, refreshCounts } from '../app.js';

export async function render({ id }){
  const here = path();
  const el = document.createElement('div');
  el.className = 'view';
  const [data, meta] = await Promise.all([api.getEvaluations(id), api.getMeta()]);
  if (!data){ el.innerHTML = Empty({ title:'Evaluation not found' }); return el; }

  let { sheet, exam, evaluations } = data;
  if (path() === here){
    setCrumbs([{ label:'Evaluations', href:'/evaluations' },
               { label:exam.name, href:'/exams/' + exam.id }, { label:sheet.studentName }]);
    document.title = `${sheet.studentName} · ${exam.name} · Test AI`;
  }

  const total   = () => Math.round(evaluations.reduce((s,e) => s + e.finalMarks, 0) * 2) / 2;
  const aiTotal = () => Math.round(evaluations.reduce((s,e) => s + e.aiMarks, 0) * 2) / 2;
  const changed  = () => evaluations.filter(e => e.overridden).length;
  const okCount  = () => evaluations.filter(e => e.approved).length;
  const allOk    = () => okCount() === evaluations.length;

  el.innerHTML = `
    <div class="view-head">
      <div class="titles">
        <a class="btn btn-sm btn-ghost" href="#/evaluations" style="margin-bottom:8px;margin-left:-10px">${icon('arrowLeft')}All evaluations</a>
        <div class="row" style="gap:12px">
          ${Avatar(sheet.studentName)}
          <div><div class="row" style="gap:10px"><h1>${esc(sheet.studentName)}</h1><span id="hdrStatus">${StatusBadge(sheet.status)}</span></div>
            <p>${esc(sheet.rollNo)} · ${esc(sheet.className)} · ${esc(exam.name)}</p></div>
        </div>
      </div>
      <div class="actions">
        <button class="btn" id="sheetBtn">${icon('eye')}View answer sheet</button>
        <button class="btn" id="exportBtn">${icon('download')}Export report</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:18px">
      <div class="card"><div class="card-body" style="display:flex;align-items:center;gap:16px">
        <div id="ringHost"></div>
        <div>
          <div style="font-size:11.8px;color:var(--muted);font-weight:560">Final score</div>
          <div class="total-box" id="totalBox"></div>
          <div style="margin-top:6px" id="gradeBox"></div>
        </div>
      </div></div>
      <div class="card"><div class="card-body">
        <div style="font-size:11.8px;color:var(--muted);font-weight:560">AI-assigned total</div>
        <div class="total-box"><b>${aiTotal()}</b><span>/ ${exam.totalMarks}</span></div>
        <div class="foot" style="margin-top:8px;font-size:11.8px;color:var(--muted)" id="deltaBox"></div>
      </div></div>
      <div class="card"><div class="card-body">
        <div style="font-size:11.8px;color:var(--muted);font-weight:560">Mean OCR confidence</div>
        <div class="total-box"><b>${sheet.ocrConfidence}</b><span>%</span></div>
        <div style="margin-top:8px">${sheet.ocrConfidence >= 90
          ? '<span class="badge ok"><i></i>High — transcription reliable</span>'
          : sheet.ocrConfidence >= 80
            ? '<span class="badge warn"><i></i>Moderate — spot-check the scan</span>'
            : '<span class="badge bad"><i></i>Low — verify against the original</span>'}</div>
      </div></div>
      <div class="card"><div class="card-body">
        <div style="font-size:11.8px;color:var(--muted);font-weight:560">Answer sheet</div>
        <div class="total-box"><b>${sheet.pages}</b><span>pages</span></div>
        <div style="margin-top:8px;font-size:11.8px;color:var(--muted)">
          ${fmtBytes(sheet.fileSize)} · uploaded ${ago(sheet.uploadedAt)}</div>
      </div></div>
    </div>

    <div id="questions"></div>

    <div class="review-bar">
      <div class="rb-total">
        <div class="rb-label">Total awarded</div>
        <div class="total-box" id="barTotal"></div>
      </div>
      <div class="check-progress" id="barProgress"></div>
      <div class="rb-note" id="barNote"></div>
      <div class="rb-actions">
        <button class="btn" id="resetBtn" hidden>${icon('refresh')}Reset to AI marks</button>
        <button class="btn" id="approveAllBtn" hidden>${icon('check')}Approve all remaining</button>
        <button class="btn btn-primary" id="approveBtn"></button>
      </div>
    </div>`;

  /* ── header numbers ───────────────────────────────────────────────── */
  function drawTotals(){
    const p = pct(total(), exam.totalMarks);
    el.querySelector('#hdrStatus').innerHTML = StatusBadge(sheet.status);
    el.querySelector('#ringHost').innerHTML = Ring(p, { size:88, stroke:8, label:'Score' });
    el.querySelector('#totalBox').innerHTML = `<b>${total()}</b><span>/ ${exam.totalMarks}</span>`;
    el.querySelector('#barTotal').innerHTML = `<b>${total()}</b><span>/ ${exam.totalMarks} · ${p}%</span>`;
    el.querySelector('#gradeBox').innerHTML =
      `<span class="badge ${toneOf(p)}"><i></i>${p}% · Grade ${gradeOf(p)}</span>`;
    const diff = Math.round((total() - aiTotal()) * 2) / 2;
    el.querySelector('#deltaBox').innerHTML = changed()
      ? `<span class="delta ${diff>0?'up':diff<0?'down':'flat'}">${icon(diff>0?'arrowUp':diff<0?'arrowDown':'minus')}${diff>0?'+':''}${diff}</span>
         after ${changed()} override${changed()>1?'s':''}`
      : 'No examiner overrides yet';
    el.querySelector('#resetBtn').hidden = !changed();

    const approved = sheet.status === 'approved';
    const n = okCount(), of = evaluations.length;

    /* Per-question check progress — the examiner works through the paper
       question by question before the sheet can be finalised. */
    el.querySelector('#barProgress').innerHTML = approved ? '' : `
      <div class="check-dots">${evaluations.map(e =>
        `<span class="dot ${e.approved ? 'on' : ''}" title="Question ${e.question.no}${
          e.approved ? ' — approved' : ' — not yet checked'}">${e.approved ? icon('check') : e.question.no}</span>`).join('')}</div>
      <div class="check-label">${n} of ${of} questions approved</div>`;

    const allBtn = el.querySelector('#approveAllBtn');
    allBtn.hidden = approved || allOk();

    const btn = el.querySelector('#approveBtn');
    btn.innerHTML = approved
      ? `${icon('lock')}Approved — reopen`
      : `${icon('checkCircle')}Approve final evaluation`;
    btn.className = approved ? 'btn' : 'btn btn-primary';
    btn.disabled = !approved && !allOk();
    btn.title = btn.disabled ? 'Approve every question first' : '';

    el.querySelector('#barNote').innerHTML = approved
      ? `Approved by <b>${esc(sheet.approvedBy || '')}</b> on ${fmtDate(sheet.approvedAt)}.`
      : !allOk()
        ? 'Approve every question to finalise.'
        : changed()
          ? `Includes ${changed()} override${changed()>1?'s':''}. Finalise to lock.`
          : 'All checked. Finalise to lock the marks.';
  }

  /* ── long-answer handling ─────────────────────────────────────────── */
  const wordsIn = t => t.trim().split(/\s+/).filter(Boolean).length;

  const pageLabel = ev => {
    if (!ev.pageFrom) return 'Page —';
    return ev.pageFrom === ev.pageTo ? `Page ${ev.pageFrom}` : `Pages ${ev.pageFrom}–${ev.pageTo}`;
  };

  /** Transcription split across the scanned pages it actually came from. */
  function transcription(ev){
    const span = (ev.pageTo || 1) - (ev.pageFrom || 1) + 1;
    const chunks = splitByPage(ev.extractedAnswer, span);
    return chunks.map((chunk, i) => `
      <div class="page-mark"><button data-page="${(ev.pageFrom || 1) + i}"
        title="Open this page of the scan">Page ${(ev.pageFrom || 1) + i}</button></div>
      <div>${esc(chunk)}</div>`).join('');
  }

  /** Only offer an expand control where the content is genuinely clipped.
      The view is measured after the router attaches it — a detached element
      reports zero height, which would clip nothing and clamp everything. */
  let clampTries = 0;
  function wireClamps(){
    if (!el.isConnected){
      if (clampTries++ < 90) requestAnimationFrame(wireClamps);
      return;                                  // navigated away before attach
    }
    clampTries = 0;
    $$('.pane .body.clampable', qHost).forEach(body => {
      if (body.classList.contains('open')) return;   // reader expanded it; leave alone
      body.nextElementSibling?.classList.contains('expand-row') && body.nextElementSibling.remove();
      if (body.scrollHeight <= body.clientHeight + 8){
        body.classList.remove('clampable');           // fits — no fade, no button
        return;
      }
      const words = wordsIn(body.textContent);
      const row = document.createElement('div');
      row.className = 'expand-row';
      row.innerHTML = `<button class="expand-btn">${icon('chevDown')}<span>Show full answer</span></button>
        <span class="expand-meta">${words} words</span>`;
      body.after(row);
      const btn = row.querySelector('.expand-btn');
      btn.onclick = () => {
        const open = body.classList.toggle('open');
        btn.classList.toggle('open', open);
        btn.querySelector('span').textContent = open ? 'Collapse answer' : 'Show full answer';
        if (!open) body.scrollIntoView({ block:'nearest', behavior:'smooth' });
      };
    });
  }

  /* ── question cards ───────────────────────────────────────────────── */
  const qHost = el.querySelector('#questions');
  function drawQuestions(){
    qHost.innerHTML = evaluations.map(ev => {
      const q = ev.question;
      const ratio = pct(ev.finalMarks, q.maxMarks);
      const tone = ratio >= 85 ? 'full' : ratio > 0 ? 'part' : 'zero';
      const locked = sheet.status === 'approved';
      return `<div class="eval-q ${ev.overridden ? 'overridden' : ''} ${ev.approved ? 'approved' : ''}" data-ev="${ev.id}">
        <div class="eval-q-head">
          <div class="q-no">${q.no}</div>
          <div class="qtext">
            <b>${esc(q.text)}</b>
            <div class="qm">
              <span class="chip">${esc(q.type)}</span>
              <span class="chip">${icon('award')}Max ${q.maxMarks} marks</span>
              <span class="chip ${ev.ocrConfidence>=90?'ok':ev.ocrConfidence>=80?'':'miss'}">${icon('scan')}OCR ${ev.ocrConfidence}%</span>
              ${ev.overridden ? '<span class="chip miss">'+icon('edit')+'Examiner override</span>' : ''}
              ${ev.approved ? '<span class="chip ok">'+icon('check')+'Marks approved</span>' : ''}
            </div>
          </div>
          <div class="score-pill ${tone}"><b>${ev.finalMarks}</b><span>/ ${q.maxMarks}</span></div>
        </div>

        <div class="cmp">
          <div class="pane">
            <div class="pane-head">${icon('check')}<h5>Examiner's expected answer</h5></div>
            <div class="body clampable">${esc(q.modelAnswer)}</div>
            <div class="concepts"><span class="concept-label">Key concepts</span>
              ${q.keyConcepts.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>
          </div>

          <div class="pane">
            <div class="pane-head">${icon('scan')}<h5>Extracted student answer</h5>
              <div class="spacer"></div>
              <span class="chip" style="font-size:10.6px">${pageLabel(ev)}</span>
              <span class="chip ${ev.ocrConfidence>=90?'ok':'miss'}" style="font-size:10.6px">${ev.ocrConfidence}% confidence</span>
            </div>
            <div class="body handwrit clampable">${transcription(ev)}</div>
          </div>

          <div class="pane ai">
            <div class="pane-head">${icon('sparkles')}<h5>AI evaluation</h5></div>
            <div class="body clampable">${esc(ev.feedback)}</div>
            ${ev.matched.length ? `<div class="concepts"><span class="concept-label">Concepts present</span>
              ${ev.matched.map(c => `<span class="chip ok">${icon('check')}${esc(c)}</span>`).join('')}</div>` : ''}
            ${ev.missing.length ? `<div class="concepts"><span class="concept-label">Missing or incorrect</span>
              ${ev.missing.map(c => `<span class="chip miss">${icon('x')}${esc(c)}</span>`).join('')}</div>` : ''}
          </div>
        </div>

        ${ev.overridden ? `<div class="override-box">
          <div class="row" style="gap:9px;font-size:12.6px;font-weight:600;color:var(--warn-fg)">
            ${icon('edit')}Marks changed from ${ev.aiMarks} to ${ev.finalMarks} by ${esc(meta.examiner.name)}</div>
          <div style="font-size:12.6px;line-height:1.55;color:var(--warn-fg)">${esc(ev.overrideReason || 'No reason recorded.')}</div>
        </div>` : ''}

        ${ev.comment ? `<div style="padding:13px 17px;border-top:1px solid var(--border)">
          <div class="comment-note">${icon('msg')}<span><b>Examiner comment · </b>${esc(ev.comment)}</span></div></div>` : ''}

        <div class="eval-q-foot">
          <span style="font-size:12.3px;color:var(--muted)">AI awarded <b style="color:var(--text)">${ev.aiMarks}</b> of ${q.maxMarks}</span>
          ${ev.approved && ev.approvedBy ? `<span style="font-size:12.3px;color:var(--muted)">·
            approved by <b style="color:var(--text)">${esc(ev.approvedBy)}</b></span>` : ''}
          <div style="flex:1"></div>
          ${locked
            ? '<span class="badge ok"><i></i>Locked — sheet approved</span>'
            : ev.approved ? `
              <span class="badge ok"><i></i>Approved</span>
              <button class="btn btn-sm" data-comment="${ev.id}">${icon('msg')}${ev.comment ? 'Edit comment' : 'Add comment'}</button>
              <button class="btn btn-sm" data-reopen="${ev.id}">${icon('refresh')}Reopen question</button>`
            : `
              <button class="btn btn-sm" data-comment="${ev.id}">${icon('msg')}${ev.comment ? 'Edit comment' : 'Add comment'}</button>
              <button class="btn btn-sm" data-override="${ev.id}">${icon('edit')}${ev.overridden ? 'Change marks' : 'Override marks'}</button>
              <button class="btn btn-sm btn-ok" data-approve="${ev.id}">${icon('check')}Approve marks</button>`}
        </div>
      </div>`;
    }).join('');

    $$('[data-override]', qHost).forEach(b => b.onclick = () => overrideModal(b.dataset.override));
    $$('[data-comment]',  qHost).forEach(b => b.onclick = () => commentModal(b.dataset.comment));
    $$('[data-approve]', qHost).forEach(b => b.onclick = () => setQuestionApproval(b.dataset.approve, true));
    $$('[data-reopen]',  qHost).forEach(b => b.onclick = () => setQuestionApproval(b.dataset.reopen, false));
    $$('[data-page]', qHost).forEach(b => b.onclick = () => openSheet(+b.dataset.page - 1));
    wireClamps();
    document.fonts?.ready.then(wireClamps);     // webfonts change text height
  }

  /* ── per-question approval ────────────────────────────────────────── */
  async function setQuestionApproval(evId, approve){
    const ev = evaluations.find(e => e.id === evId);
    Object.assign(ev, await api.approveEvaluation(evId, approve));
    drawQuestions(); drawTotals();
    const n = ev.question.no;
    if (approve) toast(`Question ${n} approved`,
      allOk() ? 'All questions checked — the sheet can be finalised'
              : `${okCount()} of ${evaluations.length} questions approved`, 'ok');
    else toast(`Question ${n} reopened`, 'Marks can be edited again', 'info');
  }

  /* ── override ─────────────────────────────────────────────────────── */
  function overrideModal(evId){
    const ev = evaluations.find(e => e.id === evId);
    const q = ev.question;
    let value = ev.finalMarks;

    const m = Modal({
      title:`Override marks — Question ${q.no}`,
      subtitle:`The AI awarded ${ev.aiMarks} of ${q.maxMarks} marks`,
      body:`<div class="stack" style="gap:15px">
        <div style="font-size:12.9px;line-height:1.6;color:var(--text-2);padding:12px 13px;background:var(--surface-3);border-radius:var(--r)">
          <b style="display:block;margin-bottom:5px;color:var(--text)">AI reasoning</b>${esc(ev.feedback)}</div>
        <div class="field"><label>Marks awarded</label>
          <div class="row" style="gap:13px">
            <div class="marks-input" style="height:41px">
              <button id="dec" style="height:41px;width:36px">−</button>
              <input id="mk" type="number" step="0.5" min="0" max="${q.maxMarks}" value="${value}" style="height:41px;width:64px;font-size:16px">
              <button id="inc" style="height:41px;width:36px">+</button>
            </div>
            <span style="font-size:14px;color:var(--muted);font-weight:600">of ${q.maxMarks}</span>
            <div style="flex:1"></div>
            <span id="deltaLbl" class="badge"></span>
          </div>
          <span class="hint">Half marks are permitted. Values are capped at the maximum for this question.</span></div>
        <div class="field"><label>Reason for the change</label>
          <textarea class="textarea" id="why" placeholder="e.g. The diagram on page 6 was not picked up by OCR and does contain the required loop currents.">${esc(ev.overrideReason || '')}</textarea>
          <span class="hint">Recorded on the evaluation so the change is auditable.</span></div>
      </div>`,
      footer:`<button class="btn" data-close>Cancel</button>
              <button class="btn btn-primary" id="saveOv">${icon('save')}Save override</button>`,
      onMount:(root, close) => {
        const input = $('#mk', root), lbl = $('#deltaLbl', root);
        const sync = () => {
          value = Math.max(0, Math.min(q.maxMarks, Math.round((+input.value || 0) * 2) / 2));
          input.value = value;
          const d = Math.round((value - ev.aiMarks) * 2) / 2;
          lbl.className = 'badge ' + (d > 0 ? 'ok' : d < 0 ? 'bad' : '');
          lbl.innerHTML = `<i></i>${d === 0 ? 'Same as AI' : (d > 0 ? '+' : '') + d + ' vs AI'}`;
        };
        input.oninput = sync;
        $('#inc', root).onclick = () => { input.value = Math.min(q.maxMarks, value + 0.5); sync(); };
        $('#dec', root).onclick = () => { input.value = Math.max(0, value - 0.5); sync(); };
        sync();
        $('#saveOv', root).onclick = async () => {
          const reason = $('#why', root).value.trim();
          if (value !== ev.aiMarks && !reason)
            return toast('A reason is required', 'Overrides are recorded for audit', 'warn');
          const updated = await api.updateEvaluation(evId, {
            finalMarks: value, overrideReason: value === ev.aiMarks ? null : reason,
          });
          Object.assign(ev, updated);
          sheet = await api.getSheet(sheet.id);
          drawQuestions(); drawTotals(); close();
          toast(value === ev.aiMarks ? 'Reverted to AI marks' : 'Marks overridden',
                `Question ${q.no} — ${value} of ${q.maxMarks}`, 'ok');
        };
      },
    });
  }

  /* ── comment ──────────────────────────────────────────────────────── */
  function commentModal(evId){
    const ev = evaluations.find(e => e.id === evId);
    Modal({
      title:`Comment on Question ${ev.question.no}`,
      subtitle:'Visible to anyone reviewing this evaluation',
      body:`<div class="field"><label>Examiner comment</label>
        <textarea class="textarea" id="cm" style="min-height:110px"
          placeholder="Note anything the AI could not see, or context for the marks awarded…">${esc(ev.comment || '')}</textarea></div>`,
      footer:`<button class="btn" data-close>Cancel</button>
              ${ev.comment ? '<button class="btn btn-danger" id="rmC">Remove</button>' : ''}
              <button class="btn btn-primary" id="saveC">${icon('save')}Save comment</button>`,
      onMount:(root, close) => {
        $('#saveC', root).onclick = async () => {
          const text = $('#cm', root).value.trim();
          Object.assign(ev, await api.updateEvaluation(evId, { comment: text || null }));
          drawQuestions(); close();
          toast(text ? 'Comment saved' : 'Comment removed', `Question ${ev.question.no}`, 'ok');
        };
        const rm = $('#rmC', root);
        if (rm) rm.onclick = async () => {
          Object.assign(ev, await api.updateEvaluation(evId, { comment:null }));
          drawQuestions(); close(); toast('Comment removed', '', 'ok');
        };
      },
    });
  }

  /* ── answer sheet viewer ──────────────────────────────────────────── */
  function openSheet(activePage = 0){
    Modal({
      title:'Scanned answer sheet',
      subtitle:`${sheet.fileName} · ${sheet.pages} pages · ${fmtBytes(sheet.fileSize)}`, wide:true,
      body:`<div class="stack" style="gap:14px">
        ${PageThumbs(sheet.pages, sheet.id, activePage)}
        <div class="comment-note">${icon('info')}<span>This prototype renders page placeholders. With a real OCR backend
          each page would show the scan with the detected answer regions highlighted and linked to their question.</span></div>
        <div class="card"><div class="card-body">
          <div class="pane-head">${icon('scan')}<h5>Transcription confidence by page</h5></div>
          <div class="stack" style="gap:10px;margin-top:11px">
            ${Array.from({length:sheet.pages}, (_,i) => {
              const c = Math.round(72 + ((i * 37) % 27));
              return `<div><div class="row" style="justify-content:space-between;margin-bottom:4px">
                <span style="font-size:12.3px;color:var(--text-2)">Page ${i+1}</span>
                <span style="font-size:12.3px;font-weight:640">${c}%</span></div>
                <div class="bar ${c>=90?'ok':c>=80?'warn':'bad'}" style="height:6px"><i style="width:${c}%"></i></div></div>`;
            }).join('')}
          </div></div></div>
      </div>`,
      onMount:(root) => $$('.page-thumb', root).forEach(t => t.onclick = () => {
        $$('.page-thumb', root).forEach(x => x.classList.remove('on'));
        t.classList.add('on');
      }),
    });
  }
  el.querySelector('#sheetBtn').onclick = () => openSheet(0);

  /* ── export ───────────────────────────────────────────────────────── */
  el.querySelector('#exportBtn').onclick = () => {
    const lines = [
      `EVALUATION REPORT`, `${exam.name} (${exam.code})`, ``,
      `Student: ${sheet.studentName} (${sheet.rollNo}, ${sheet.className})`,
      `Total: ${total()} / ${exam.totalMarks}  (${pct(total(), exam.totalMarks)}%, Grade ${gradeOf(pct(total(), exam.totalMarks))})`,
      `Status: ${sheet.status}${sheet.approvedBy ? ` — approved by ${sheet.approvedBy}` : ''}`, ``,
      ...evaluations.flatMap(ev => [
        `Q${ev.question.no}. ${ev.question.text}`,
        `  Max marks      : ${ev.question.maxMarks}`,
        `  AI marks       : ${ev.aiMarks}`,
        `  Final marks    : ${ev.finalMarks}${ev.overridden ? ' (examiner override)' : ''}`,
        ev.overrideReason ? `  Override reason: ${ev.overrideReason}` : null,
        `  AI feedback    : ${ev.feedback}`,
        ev.missing.length ? `  Missing        : ${ev.missing.join('; ')}` : null,
        ev.comment ? `  Comment        : ${ev.comment}` : null, ``,
      ].filter(Boolean)),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([lines], { type:'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${sheet.rollNo}-${exam.code}-evaluation.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Report exported', `${sheet.rollNo}-${exam.code}-evaluation.txt`, 'ok');
  };

  /* ── approve / reopen / reset ─────────────────────────────────────── */
  el.querySelector('#approveBtn').onclick = () => {
    if (sheet.status === 'approved'){
      return confirmModal({
        title:'Reopen this evaluation?',
        body:'Marks will be unlocked for editing and the sheet returns to your review queue.',
        confirmLabel:'Reopen', onConfirm: async () => {
          sheet = await api.approveSheet(sheet.id, false);
          drawQuestions(); drawTotals(); refreshCounts();
          toast('Evaluation reopened', 'Marks can be edited again', 'info');
        },
      });
    }
    confirmModal({
      title:'Approve this evaluation?',
      body:`<b>${esc(sheet.studentName)}</b> will be recorded with <b>${total()} of ${exam.totalMarks}</b> marks
            (${pct(total(), exam.totalMarks)}%, grade ${gradeOf(pct(total(), exam.totalMarks))}).
            ${changed() ? `This includes ${changed()} examiner override${changed()>1?'s':''}. ` : ''}
            Marks are locked once approved — you can reopen the evaluation if you need to change them.`,
      confirmLabel:'Approve evaluation', onConfirm: async () => {
        sheet = await api.approveSheet(sheet.id, true);
        drawQuestions(); drawTotals(); refreshCounts();
        toast('Evaluation approved', `${sheet.studentName} — ${total()}/${exam.totalMarks}`, 'ok');
      },
    });
  };

  el.querySelector('#approveAllBtn').onclick = () => {
    const left = evaluations.filter(e => !e.approved);
    confirmModal({
      title:`Approve the remaining ${left.length} question${left.length>1?'s':''}?`,
      confirmLabel:'Approve remaining',
      body:`Questions ${left.map(e => e.question.no).join(', ')} will be approved at the marks currently shown.
            Use this once you have read through them — anything you have not checked is approved as the AI scored it.`,
      onConfirm: async () => {
        const rows = await api.approveAllEvaluations(sheet.id);
        rows.forEach(r => Object.assign(evaluations.find(e => e.id === r.id), r));
        drawQuestions(); drawTotals();
        toast(`${rows.length} question${rows.length>1?'s':''} approved`, 'The sheet can now be finalised', 'ok');
      },
    });
  };

  el.querySelector('#resetBtn').onclick = () => confirmModal({
    title:'Reset all marks to the AI values?', danger:true, confirmLabel:'Reset marks',
    body:`This discards ${changed()} examiner override${changed()>1?'s':''} and their recorded reasons. Comments are kept.`,
    onConfirm: async () => {
      for (const ev of evaluations.filter(e => e.overridden)){
        Object.assign(ev, await api.updateEvaluation(ev.id, { finalMarks: ev.aiMarks, overrideReason:null }));
      }
      sheet = await api.getSheet(sheet.id);
      drawQuestions(); drawTotals();
      toast('Overrides cleared', 'All marks reset to the AI values', 'info');
    },
  });

  drawQuestions();
  drawTotals();
  return el;
}
