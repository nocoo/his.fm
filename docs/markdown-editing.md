# Markdown editing

The studio uses one CodeMirror 6 editor for the global prompt, episode intent,
text sources, transcripts, publication descriptions and catalogue notes. Short
plain-text summaries, short metadata and URL fields retain Basalt inputs.

The selection follows an inspection of `miantiao-me/bm.md` (CodeMirror 6 with
`@uiw/react-codemirror`), firefly (Markdown source and preview) and ellie (Tiptap
rich text). No application source was copied from those projects. Basalt owns
controls, surfaces and themes; CodeMirror is the specialist text-editing control.

Markdown remains the source of truth. Switching between editing, preview and
wide-screen split view must not serialize through HTML, trim content, clear undo
history or discard unsupported syntax. Preview uses the existing safe reading
renderer. Raw HTML and embedded images are not rendered; links must be HTTPS.
Long reviews retain the studio's Chinese reading font. The source editor grows
with the document and only the content island scrolls vertically. Formatting,
find and keyboard navigation must not scroll the outer application shell.

Global and per-stage instructions are centralized under “提示词”; see `docs/prompts.md`. Existing `/admin/channel`,
`/api/agent/channel`, the D1 table and optimistic-version contracts retain their
technical names. Authority remains global prompt, category prompt, episode intent, then source
material. Changing instructions requires `prompts:write`; external clients read them
with `prompts:read` before creative work. Existing stored documents are never rewritten by a UI rename.

The global prompt retains per-environment session drafts, explicit saving,
Cmd/Ctrl+S and version-conflict comparison. Other fields retain their existing
form submission and unsaved-change guards. Over-limit content is kept available
for correction rather than silently truncated.

Brief source material is presented as a compact list. Each source opens its own
`?section=metadata&source=<id>` detail view using a persistent source ID. The
metadata form stays mounted so browser navigation preserves unsaved intent and
sources. Only the selected source has a detail editor; explicit saving persists
all brief changes through the optimistic-version contract. Production sections
remain mounted while hidden to preserve Markdown undo and draft state.

Publication offers WeChat HTML and plain-text clipboard representations,
Xiaoyuzhou plain text, and the original Markdown. The WeChat preview renders the
exact sanitized HTML passed to the clipboard, including the cover and reference
footnotes. Copying is independent of manually confirming a real publication.
