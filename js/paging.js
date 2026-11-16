/* Maps each question to the answer-sheet pages its answer occupies.

   With a real OCR backend this comes from the extraction step, which knows the
   pixel region every transcribed line came from. Here it is derived from the
   marks weighting — a 20-mark answer takes proportionally more of the booklet
   than a 5-mark one — so the page ranges stay plausible and self-consistent. */
export function pageRange(questions, index, totalPages){
  const total = questions.reduce((s,q) => s + q.maxMarks, 0) || 1;
  const before = questions.slice(0, index).reduce((s,q) => s + q.maxMarks, 0);
  const after  = before + questions[index].maxMarks;
  const from = Math.min(totalPages, Math.floor((before / total) * totalPages) + 1);
  const to   = Math.max(from, Math.min(totalPages, Math.ceil((after / total) * totalPages)));
  return { pageFrom: from, pageTo: to };
}

/** Split a transcription into one chunk per page it spans, on sentence bounds. */
export function splitByPage(text, pageCount){
  if (pageCount <= 1) return [text];
  const parts = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const per = Math.ceil(parts.length / pageCount);
  const out = [];
  for (let i = 0; i < parts.length; i += per) out.push(parts.slice(i, i + per).join('').trim());
  return out.length ? out : [text];
}
