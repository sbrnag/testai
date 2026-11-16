# Test AI — Design Spec (2026-09-07)

AI-powered examination evaluation platform. Frontend prototype: HTML/CSS/vanilla JS.

## Decisions
- **Architecture:** SPA, one `index.html`, hash router, one JS module per view.
- **Data:** localStorage-backed store, seeded on first run. "Reset demo data" in Settings.
- **Visual:** Indigo/slate modern SaaS, light + dark themes via CSS custom properties.

## API seam
`js/api.js` is the ONLY module that touches storage. Every export is `async`, returns a
Promise after simulated latency. Swapping to real endpoints = editing this one file.

## Simulated AI pipeline
`js/evaluator.js` moves a sheet through:
`queued -> extracting (OCR) -> matching -> comparing (semantic) -> scoring -> complete`,
emitting progress events. Scores/feedback come from authored per-question answer variants
so output reads plausibly. Real OCR/LLM slots in behind `evaluator.runJob(sheetId)`.

## Data model
- exam { id, name, subject, code, className, date, totalMarks, status, questions[] }
- question { id, no, text, type, maxMarks, modelAnswer, keyConcepts[] }
- student { id, rollNo, name, className, email }
- sheet { id, examId, studentId, fileName, pages, status, stage, progress,
          ocrConfidence, marksObtained, approved }
- evaluation { id, sheetId, questionId, extractedAnswer, ocrConfidence, aiMarks,
               finalMarks, overridden, overrideReason, feedback, matched[], missing[], comment }

Sheet statuses: pending -> processing -> evaluated -> approved.

## Screens
Dashboard, Exams, Exam detail, Upload Question Paper (wizard), Upload Answer Sheets,
Students, Evaluations (live processing), Evaluation detail (3-col comparison + override
+ approve), Results (charts + export), Settings.

## Long answers (2-3 pages)
A 20-mark answer runs 500+ words and would otherwise stretch the comparison row,
since a CSS grid row sizes to its tallest cell.
- Each pane clamps to 340px with a fade and a "Show full answer (N words)" toggle.
  The control appears ONLY where content is genuinely clipped (measured after the
  router attaches the view - a detached element reports zero height).
- `js/paging.js` maps each question to the sheet pages it occupies, weighted by
  marks. The transcription is split on sentence bounds with a "Page N" divider
  between chunks; clicking one opens the scan viewer at that page.
- The AI panel is `position:sticky` in the 3-column layout, so the verdict stays
  in view while a long transcription scrolls past.

## Per-question approval
The examiner checks each question in turn rather than approving a whole sheet blind.
- Every question carries `approved` / `approvedAt` / `approvedBy`.
- Footer actions per question: Add comment, Override marks (reason required),
  Approve marks. An approved question shows a green footer and swaps to Reopen.
- Changing the marks on an approved question automatically un-approves it, so an
  edit always returns for re-check. Enforced in `api.updateEvaluation`.
- The review bar shows a per-question dot tracker ("3 of 5 questions approved").
  "Approve final evaluation" stays disabled until every question is approved;
  "Approve all remaining" bulk-approves what is left, behind a confirm.
- Per-question approvals SURVIVE a sheet reopen — reopening one question to fix it
  should not force a re-check of the whole paper.

## Storage schema versioning
`store.js` holds `SCHEMA`, written into every saved database and checked on load.
A saved database from an older shape is rebuilt from the seed rather than loaded,
so records can never be served with fields the current code expects. Bump `SCHEMA`
whenever a stored record's shape changes — skipping it degrades silently
(missing page ranges rendered as "Page —"; absent approval state).

## Review bar layout
Actions live in a single `.rb-actions` group with `margin-left:auto`, so they stay
together and right-aligned whether they share the first line or wrap to their own.
Do NOT reintroduce a bare `flex:1` spacer between the buttons — that strands the
spacer on line one and drops each button independently, leaving the primary CTA
alone on the left. The note (`.rb-note`) absorbs slack and is hidden under 1280px.

Also note: `.btn` sets `display:inline-flex`, and ANY author rule beats the UA
sheet's `[hidden]{display:none}` — so the `hidden` attribute silently did nothing
on buttons until `[hidden]{display:none!important}` was added to layout.css.

## Assigning sheets to students
Every staged file carries an explicit `studentId` chosen by the examiner.
- The roll number in the filename supplies a DEFAULT only; a dropdown of the
  exam's class roster sits on each staged row and always wins.
- There is NO positional fallback. Assigning an unmatched sheet to whoever is
  next on the roster silently credits one student's answers to another, so an
  unmatched file is flagged "Needs a student" and blocks upload instead.
- Duplicate assignments across staged files are flagged and block upload.
- Re-uploading for a student replaces their previous sheet (and its evaluations)
  rather than leaving two rows for the same person.
- `api.createSheets` throws if a file resolves to no student.

## Bulk upload (sidebar: Intake > Bulk Upload, route /bulk-upload)
Import many students' sheets from one ZIP archive.
- `js/zip.js` is a real, dependency-free ZIP reader. Listing parses the End of
  Central Directory record and walks the central directory, so it never touches
  the compressed payload; a single entry is inflated on demand with the
  platform's `DecompressionStream('deflate-raw')`. Not handled: ZIP64 and
  encrypted entries — both raise a clear error rather than returning wrong data.
- Archive noise (__MACOSX, .DS_Store, Thumbs.db, non-sheet extensions) is filtered.
- PDF page counts are read from the actual bytes by counting page objects.
- The review table shows file, student (editable dropdown), roll number,
  examination, status. Clicking a row previews the REAL extracted file —
  an <img> for images, an <iframe> for PDFs, both from blob URLs.
- Same assignment rules as single upload: roll number is only a default, an
  unmatched or duplicated sheet blocks the import, no positional fallback.
- "Use a sample archive" synthesises rows so the flow is demonstrable without a
  real ZIP; its preview falls back to page placeholders and says so.

## Header action bars
`.select` is `width:100%` by design inside a form field. Dropped into a
`.view-head .actions` flex row it swallows the row and pushes the buttons onto a
second line (Results header was 151px tall with Export/Publish stranded below).
`.view-head .actions .select` is bounded to `flex:0 1 320px` and shrinks before
the buttons do; below 700px it takes its own full-width row.

## Chart axes
`BarChart` takes an optional `max`. Percentage series MUST pass `max:100` —
normalising to the data's own peak renders the largest value as a full-height
bar, so 76% reads as "maximum". Count series (score distribution, grade
distribution) keep the auto max, which is correct for them.

## Out of scope
Auth/login. Real PDF/image parsing (dropzones read metadata; page previews are placeholders).
Charts are hand-rolled inline SVG — no CDN dependency.
