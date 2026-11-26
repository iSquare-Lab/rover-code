import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// The line the replay is on, and the line an error points at.
const setMarks = StateEffect.define<{ running: number; error: number }>();

const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setMarks)) continue;
      const ranges = [];
      const doc = tr.state.doc;
      const { running, error } = effect.value;
      if (running > 0 && running <= doc.lines) ranges.push(Decoration.line({ class: 'cm-running' }).range(doc.line(running).from));
      if (error > 0 && error <= doc.lines && error !== running) ranges.push(Decoration.line({ class: 'cm-error-line' }).range(doc.line(error).from));
      ranges.sort((a, b) => a.from - b.from);
      value = Decoration.set(ranges);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.operatorKeyword], color: 'var(--code-keyword)', fontWeight: '600' },
  { tag: [tags.string], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: [tags.comment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName))], color: 'var(--code-function)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--code-punct)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', backgroundColor: 'var(--code-bg)', color: 'var(--code-text)' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Consolas, monospace", lineHeight: '1.6', fontVariantLigatures: 'none' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--code-gutter)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--code-text)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--code-selection) !important' },
  '.cm-running': { backgroundColor: 'var(--code-running)', boxShadow: 'inset 3px 0 0 var(--accent)' },
  '.cm-error-line': { backgroundColor: 'var(--code-error)', boxShadow: 'inset 3px 0 0 var(--danger)' },
  '&.cm-focused': { outline: 'none' },
});

export type Editor = {
  view: EditorView;
  code: () => string;
  setCode: (code: string) => void;
  mark: (running: number, error?: number) => void;
};

export function createEditor(parent: HTMLElement, code: string, onChange: (code: string) => void, run: () => void, label: string): Editor {
  const extensions: Extension[] = [
    lineNumbers(),
    history(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    python(),
    syntaxHighlighting(highlight),
    marks,
    theme,
    EditorState.tabSize.of(4),
    indentUnit.of('    '),
    keymap.of([{ key: 'Mod-Enter', run: () => (run(), true) }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
    EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
  ];
  const view = new EditorView({ parent, state: EditorState.create({ doc: code, extensions }) });
  return {
    view,
    code: () => view.state.doc.toString(),
    setCode: (next) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } }),
    mark: (running, error = 0) => view.dispatch({ effects: setMarks.of({ running, error }) }),
  };
}
