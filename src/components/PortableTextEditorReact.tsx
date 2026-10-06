/**
 * Thin React wrapper around @portabletext/editor. Mounted from Vue via
 * PortableTextEditor.vue — never imported directly into a .vue file.
 */

import {
  defineSchema,
  EditorProvider,
  PortableTextEditable,
  useEditor,
  useEditorSelector,
  type EditorSelection,
  type PortableTextBlock,
  type RenderAnnotationFunction,
  type RenderDecoratorFunction,
  type RenderStyleFunction,
} from '@portabletext/editor'
import { defineBehavior, execute } from '@portabletext/editor/behaviors'
import { BehaviorPlugin, EventListenerPlugin } from '@portabletext/editor/plugins'
import {
  getActiveAnnotations, getFocusTextBlock, getSelectedValue, getSelection, isActiveDecorator, isActiveListItem, isActiveStyle, isSelectionExpanded,
} from '@portabletext/editor/selectors'
import React from 'react'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { linkTextRange, selectionTextRange, splitMarks, type SpanPoint, type TextRange } from '@/utils/linkText.ts'
import { hasLinkMark, resolveLinkTarget, type SanityBlock } from '@/utils/portableText.ts'

const DECORATORS = ['strong', 'em', 'underline'] as const

const schemaDefinition = defineSchema({
  decorators: DECORATORS.map(name => ({ name })),
  // Headings in a description are h3 to h6: the section already has the page's h2, and h1 is
  // reserved for the text-block page title. h3 has a button, h4 to h6 a small menu (DeepHeadingMenu).
  styles: [
    { name: 'normal' },
    { name: 'h3' },
    { name: 'h4' },
    { name: 'h5' },
    { name: 'h6' },
    { name: 'blockquote' },
  ],
  annotations: [
    // The shape Sanity stores: `{ _type: 'link', href }`. Some stored links have no
    // href (dead links, src/utils/linkCheck.ts), so the field is optional.
    {
      name: 'link',
      fields: [
        { name: 'href', type: 'string' },
      ],
    },
    {
      name: 'person',
      fields: [
        { name: 'slug', type: 'string' },
        { name: 'name', type: 'string' },
      ],
    },
  ],
  // The stored descriptions use both (Sanity: 1,025 of 2,282 events); the page renders them
  // (blocksToHtml). Without them here the editor drew a list as plain paragraphs and could not
  // continue, indent or end one (#124).
  lists: [
    { name: 'bullet' },
    { name: 'number' },
  ],
  inlineObjects: [],
  blockObjects: [],
})

const renderDecorator: RenderDecoratorFunction = props => {
  switch (props.value) {
    case 'strong':    return React.createElement('strong', null, props.children)
    case 'em':        return React.createElement('em', null, props.children)
    case 'underline': return React.createElement('u', null, props.children)
    default:          return React.createElement(React.Fragment, null, props.children)
  }
}

const renderStyle: RenderStyleFunction = props => {
  switch (props.schemaType.value) {
    case 'h3':         return React.createElement('h3', null, props.children)
    case 'h4':         return React.createElement('h4', null, props.children)
    case 'h5':         return React.createElement('h5', null, props.children)
    case 'h6':         return React.createElement('h6', null, props.children)
    case 'blockquote': return React.createElement('blockquote', null, props.children)
    default:           return React.createElement('p', null, props.children)
  }
}

const renderAnnotation: RenderAnnotationFunction = props => {
  if (props.schemaType.name === 'link') {
    const href = (props.value as { href?: string }).href?.trim() ?? ''
    return React.createElement(
      'a',
      {
        className: `pt-link-mark${href ? '' : ' pt-link-mark--dead'}`,
        href:      href || undefined,
        title:     href || 'Lenken har ingen adresse',
        onClick:   (e: React.MouseEvent) => e.preventDefault(),   // editing, not navigating
      },
      props.children,
    )
  }
  if (props.schemaType.name === 'person') {
    const v    = props.value as { slug?: string; name?: string }
    const slug = v.slug ?? ''
    const name = v.name ?? slug
    return React.createElement(
      'a',
      {
        className:  'pt-person-mark',
        'data-slug': slug,
        href:       `/person/${slug}`,
        title:      name ? `${name} (/${slug})` : `/${slug}`,
        onClick:    (e: React.MouseEvent) => e.preventDefault(),
      },
      props.children,
    )
  }
  return React.createElement(React.Fragment, null, props.children)
}

export interface Props {
  value:    PortableTextBlock[]
  /** Changes when the value was replaced from outside: the editor starts over with it (see PortableTextEditor.vue). */
  generation: number
  onChange: (blocks: PortableTextBlock[]) => void
  /** The editor fills the window (PortableTextEditor.vue sets the class on the host). */
  expanded:        boolean
  onToggleExpand:  () => void
}

function ToolbarButton({
  label,
  active,
  onClick,
  title,
  ariaLabel,
  extraClass,
  disabled,
  expanded,
}: {
  label:       React.ReactNode
  active:      boolean
  onClick:     () => void
  title?:      string
  /** The name of an icon-only button, for screen readers. */
  ariaLabel?:  string
  extraClass?: string
  disabled?:   boolean
  /** For a button that opens a list: whether it is open. */
  expanded?:   boolean
}) {
  return React.createElement(
    'button',
    {
      type:      'button',
      className: `pt-tb-btn${active ? ' active' : ''}${extraClass ? ` ${extraClass}` : ''}`,
      title,
      disabled,
      'aria-label': ariaLabel,
      'aria-expanded': expanded,
      'aria-haspopup': expanded === undefined ? undefined : 'true',
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(), // keep selection
      onClick,
    },
    label,
  )
}

/** Two arrows pointing at opposite corners: the expand icon of Sanity's editor. */
const expandIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
  React.createElement('path', { d: 'M9.5 2H14v4.5M6.5 14H2V9.5M14 2 9 7M2 14l5-5' }),
)

/** Three dots and three lines: a bulleted list. */
const bulletListIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
  [3.5, 8, 12.5].map(y => React.createElement('circle', { key: `d${y}`, cx: 2.5, cy: y, r: 0.9, fill: 'currentColor', stroke: 'none' })),
  [3.5, 8, 12.5].map(y => React.createElement('path', { key: `l${y}`, d: `M6 ${y}h8` })),
)

/** Three numbers and three lines: a numbered list. */
const numberListIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
  ['1', '2', '3'].map((n, i) => React.createElement('text', { key: `n${n}`, x: 0.5, y: 5 + i * 4.5, fontSize: 4.6, fontWeight: 700, fill: 'currentColor', stroke: 'none' }, n)),
  [3.5, 8, 12.5].map(y => React.createElement('path', { key: `l${y}`, d: `M6 ${y}h8` })),
)

/** Two chain links: the link icon of Sanity's editor (Feather «link»). */
const linkIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  React.createElement('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
  React.createElement('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }),
)

/**
 * Far right of the toolbar. Expanded, it reads «Ferdig» and only closes the window: saving stays
 * with the save bar behind it (DescriptionEditor), so closing never saves silently.
 */
function ExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return React.createElement(ToolbarButton, {
    label:      expanded ? 'Ferdig' : expandIcon,
    active:     false,
    onClick:    onToggle,
    title:      expanded ? 'Tilbake til siden (Esc)' : 'Utvid til hele vinduet',
    ariaLabel:  expanded ? 'Ferdig' : 'Utvid',
    extraClass: 'pt-tb-expand',
  })
}

function DecoratorButton({ name, label }: { name: string; label: string }) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveDecorator(name))
  return React.createElement(ToolbarButton, {
    label,
    active,
    onClick: () => editor.send({ type: 'decorator.toggle', decorator: name }),
  })
}

function ListButton({ name, label, title }: { name: 'bullet' | 'number'; label: React.ReactNode; title: string }) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveListItem(name))
  return React.createElement(ToolbarButton, {
    label,
    active,
    title,
    ariaLabel: title,
    onClick: () => editor.send({ type: 'list item.toggle', listItem: name }),
  })
}

function StyleButton({ name, label }: { name: string; label: string }) {
  const editor = useEditor()
  const active = useEditorSelector(editor, isActiveStyle(name))
  return React.createElement(ToolbarButton, {
    label,
    active,
    onClick: () => editor.send({ type: 'style.toggle', style: name }),
  })
}

const DEEP_HEADINGS = ['h4', 'h5', 'h6'] as const

/**
 * H4 to H6 behind a small ▾ beside the H3 button. The ▾ lights up when the caret is in one of
 * them; the list marks which. Esc and a click outside close it, and Esc is not passed on, so in
 * the full window it does not also close the window (PortableTextEditor.vue).
 */
function DeepHeadingMenu() {
  const editor = useEditor()
  const active = useEditorSelector(editor, snapshot => DEEP_HEADINGS.find(h => isActiveStyle(h)(snapshot)))
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return React.createElement(
    'span',
    { className: 'pt-tb-menu', ref: root },
    React.createElement(ToolbarButton, {
      label:      '▾',
      active:     !!active,
      onClick:    () => setOpen(v => !v),
      title:      'Flere overskriftsnivåer (H4–H6)',
      ariaLabel:  'Flere overskriftsnivåer',
      extraClass: 'pt-tb-more',
      expanded:   open,
    }),
    open ? React.createElement(
      'div',
      { className: 'pt-menu', role: 'group', 'aria-label': 'Overskriftsnivå' },
      DEEP_HEADINGS.map(h => React.createElement(
        'button',
        {
          key:           h,
          type:          'button',
          'aria-pressed': active === h,
          className:     `pt-menu-item${active === h ? ' active' : ''}`,
          onMouseDown:   (e: React.MouseEvent) => e.preventDefault(), // keep selection
          onClick:       () => { editor.send({ type: 'style.toggle', style: h }); setOpen(false) },
        },
        h.toUpperCase(),
      )),
    ) : null,
  )
}

interface PersonHit { slug: string; name: string }

function PersonAnnotationButton() {
  const editor = useEditor()
  const [open,    setOpen]    = React.useState(false)
  const [query,   setQuery]   = React.useState('')
  const [results, setResults] = React.useState<PersonHit[]>([])

  React.useEffect(() => {
    if (!open || query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        const rows = await neo4jQuery<PersonHit>(`
          MATCH (p:Person)
          WHERE toLower(p.canonicalName) CONTAINS toLower($q)
          RETURN p.slug AS slug, p.canonicalName AS name
          ORDER BY p.canonicalName
          LIMIT 12
        `, { q: query })
        setResults(rows)
      } catch { setResults([]) }
    }, 150)
    return () => clearTimeout(t)
  }, [open, query])

  function apply(p: PersonHit) {
    editor.send({
      type:       'annotation.toggle',
      annotation: { name: 'person', value: { slug: p.slug, name: p.name } },
    })
    setOpen(false)
    setQuery('')
    setResults([])
  }

  return React.createElement(
    'span',
    { className: 'pt-tb-person' },
    React.createElement(ToolbarButton, {
      label:  '@',
      active: open,
      onClick: () => setOpen(v => !v),
    }),
    open ? React.createElement(
      'div',
      { className: 'pt-person-pop' },
      React.createElement('input', {
        className:   'pt-person-input',
        autoFocus:   true,
        placeholder: 'Søk person…',
        value:       query,
        onChange:    (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
      }),
      results.map(r =>
        React.createElement(
          'button',
          {
            key:          r.slug,
            type:         'button',
            className:    'pt-person-result',
            onMouseDown:  (e: React.MouseEvent) => e.preventDefault(),
            onClick:      () => apply(r),
          },
          r.name,
          React.createElement('span', { className: 'pt-person-slug' }, r.slug),
        ),
      ),
    ) : null,
  )
}

/** The event `replaceWords` answers to; one name for the sender and the behavior. */
const REPLACE_WORDS = 'custom.replaceWords'

/**
 * Replaces words and types them again with their marks: select, delete, `insert.span`. The
 * editor does not carry a link mark onto typed text (at the edge of a span it goes to the
 * neighbour), and deleting and inserting as two events takes two undos. As the actions of one
 * behavior they are one undo step.
 *
 * The delete is `delete.backward` over an expanded selection, which deletes the selection:
 * the name says one character, so this leans on how @portabletext/editor 6.6.9 behaves
 * (`delete.text` with a path range removed the wrong words). Recheck it when upgrading.
 */
const replaceWords = defineBehavior<{
  at:          NonNullable<EditorSelection>
  text:        string
  decorators:  string[]
  annotations: { name: string; value: Record<string, unknown> }[]
}>({
  on: REPLACE_WORDS,
  actions: [({ event }) => [
    execute({ type: 'select', at: event.at }),
    execute({ type: 'delete.backward', unit: 'character' }),
    execute({ type: 'insert.span', text: event.text, decorators: event.decorators, annotations: event.annotations }),
  ]],
})

/** What the link box was opened on — fixed then, so a click elsewhere in the editor can't change what Enter does. */
interface LinkTarget {
  /** The selected words: the ones to link, or to take a link off. */
  at:      EditorSelection
  /** A caret, a selection or a link to change: without any of them there is nowhere to put a link. */
  linkable: boolean
  /** A caret with no link under it: the box inserts new linked words there. */
  caret:   boolean
  /** The decorators on at the caret, for the new words. */
  decorators: string[]
  /** The link the caret or selection lies wholly in, to change its address. */
  link:    { blockKey: string; markKey: string; href: string } | null
  /** Any link on the selected words, whole or in part. */
  hasLink: boolean
  /** The words the «Tekst» field shows, in the block they sit in; null when they cannot be read (across blocks). */
  words:   { blockKey: string; range: TextRange; decorators: string[]; annotations: ReturnType<typeof splitMarks>['annotations'] } | null
}

/** The span a selection point is in: `[{_key: block}, 'children', {_key: span}]`. */
function spanPoint(point: { path: unknown[]; offset: number }): SpanPoint | null {
  const key = (point.path[2] as { _key?: string } | undefined)?._key
  return key ? { spanKey: key, offset: point.offset } : null
}

/** The words the box was opened on: the link's, or the selection's when it lies in one block. */
function wordsOf(
  block: SanityBlock | undefined, linkKey: string | undefined, at: EditorSelection,
): LinkTarget['words'] {
  if (!block) return null
  if (linkKey) {
    const range = linkTextRange(block, linkKey)
    return range ? { blockKey: block._key, range, ...splitMarks(block, range.marks) } : null
  }
  const a = at && spanPoint(at.anchor)
  const f = at && spanPoint(at.focus)
  if (!a || !f || (at.anchor.path[0] as { _key?: string })._key !== block._key
      || (at.focus.path[0] as { _key?: string })._key !== block._key) return null
  const range = selectionTextRange(block, a, f)
  return range ? { blockKey: block._key, range, ...splitMarks(block, range.marks) } : null
}

/**
 * Link on the selected words: a full address, a path (`/events/…`) or a bare slug — what
 * `resolveLinkTarget()` takes. With the caret in a link the same box changes its address, and
 * «Fjern lenke» takes the link off and keeps the words. Whether an internal link leads anywhere
 * is checked when the description is saved (DescriptionEditor), as for every other link.
 */
function LinkAnnotationButton() {
  const editor    = useEditor()
  const active    = useEditorSelector(editor, getActiveAnnotations).find(a => a._type === 'link')
  const block     = useEditorSelector(editor, getFocusTextBlock)
  const expanded  = useEditorSelector(editor, isSelectionExpanded)
  const selection = useEditorSelector(editor, getSelection)
  const selected  = useEditorSelector(editor, getSelectedValue)
  // null: closed. The input takes focus, so everything below comes from when the box opened.
  const [target, setTarget] = React.useState<LinkTarget | null>(null)
  const [href, setHref]     = React.useState('')
  const [text, setText]     = React.useState('')

  function show() {
    const current = (active as { href?: string } | undefined)?.href ?? ''
    const words   = wordsOf(block?.node as SanityBlock | undefined, active?._key, selection)
    setHref(current)
    setText(words?.range.text ?? '')
    setTarget({
      at:       selection,
      linkable: !!active || !!selection,
      caret:    !active && !!selection && !expanded,
      decorators: DECORATORS.filter(d => isActiveDecorator(d)(editor.getSnapshot())),
      link:     active && block ? { blockKey: block.node._key, markKey: active._key, href: current } : null,
      hasLink:  !!active || hasLinkMark(selected),
      words,
    })
  }
  function close() { setTarget(null); setHref(''); setText('') }

  // The words can be changed when they are readable, carry one set of marks, and are not emptied.
  // At a caret there are none yet: the box asks for them.
  const showText     = !!target?.linkable && (!!target.words || target.caret)
  const textEditable = !!target?.caret || !!target?.words?.range.editable
  const textChanged  = !!target?.words && textEditable && text !== target.words.range.text
  const textValid    = !textEditable || text.length > 0

  function apply() {
    const value = href.trim()
    if (!target?.linkable || !resolveLinkTarget(value) || !textValid) return
    if (textChanged && target.words) {
      // The words are replaced and typed again with their marks, as one undo step (see
      // replaceWords). The link comes along with the address as it stands in the box.
      const { blockKey, range, decorators, annotations } = target.words
      const path = (key: string) => [{ _key: blockKey }, 'children', { _key: key }]
      const link = { name: 'link', value: { href: value } }
      editor.send({
        type: REPLACE_WORDS,
        at:   { anchor: { path: path(range.startKey), offset: range.startOffset }, focus: { path: path(range.endKey), offset: range.endOffset } },
        text,
        decorators,
        annotations: [
          ...annotations.filter(a => a.key !== target.link?.markKey).map(({ name, value: v }) => ({ name, value: v })),
          link,
        ],
      })
    } else if (target.caret && target.at) {
      editor.send({ type: 'select', at: target.at })
      editor.send({ type: 'insert.span', text, decorators: target.decorators, annotations: [{ name: 'link', value: { href: value } }] })
    } else if (target.link) {
      if (value !== target.link.href) {
        editor.send({ type: 'annotation.set', at: [{ _key: target.link.blockKey }, 'markDefs', { _key: target.link.markKey }], props: { href: value } })
      }
    } else if (target.at) {
      editor.send({ type: 'annotation.add', annotation: { name: 'link', value: { href: value } }, at: target.at })
    }
    close()
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  { e.preventDefault(); apply() }
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }
  function remove() {
    editor.send({ type: 'annotation.remove', annotation: { name: 'link' }, ...(target?.at ? { at: target.at } : {}) })
    close()
  }

  return React.createElement(
    'span',
    { className: 'pt-tb-link' },
    React.createElement(ToolbarButton, {
      label:     linkIcon,
      title:     'Lenke',
      ariaLabel: 'Lenke',
      active: !!active || !!target,
      // Nowhere to put a link until the editor has a caret or a selection (an open box can still be closed).
      disabled: !target && !selection,
      onClick: () => (target ? close() : show()),
    }),
    target ? React.createElement(
      'div',
      { className: 'pt-link-pop' },
      showText ? React.createElement(
        'label',
        { className: 'pt-link-field' },
        React.createElement('span', { className: 'pt-link-label' }, 'Tekst'),
        React.createElement('input', {
          className: 'pt-link-input',
          autoFocus: textEditable,
          placeholder: target.caret ? 'Teksten som skal vises' : undefined,
          value:     text,
          readOnly:  !textEditable,
          title:     textEditable ? undefined : 'Teksten har ulik formatering og kan ikke endres her',
          onChange:  (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
          onKeyDown: onKey,
        }),
      ) : null,
      React.createElement(
        'label',
        { className: 'pt-link-field' },
        showText ? React.createElement('span', { className: 'pt-link-label' }, 'Adresse') : null,
        React.createElement('input', {
          className:   'pt-link-input',
          autoFocus:   !showText || !textEditable,
          placeholder: 'https://… eller /events/…',
          value:       href,
          onChange:    (e: React.ChangeEvent<HTMLInputElement>) => setHref(e.target.value),
          onKeyDown:   onKey,
        }),
      ),
      React.createElement(
        'div',
        { className: 'pt-link-actions' },
        React.createElement('button', {
          type: 'button', className: 'pt-link-apply', disabled: !target.linkable || !resolveLinkTarget(href) || !textValid,
          onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: apply,
        }, target.link ? 'Endre' : target.caret ? 'Sett inn' : 'Bruk'),
        target.hasLink ? React.createElement('button', {
          type: 'button', className: 'pt-link-remove',
          onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: remove,
        }, 'Fjern lenke') : null,
      ),
    ) : null,
  )
}

function Toolbar({ expanded, onToggleExpand }: { expanded: boolean; onToggleExpand: () => void }) {
  return React.createElement(
    'div',
    { className: 'pt-toolbar' },
    React.createElement(StyleButton,     { name: 'normal',     label: 'P' }),
    // H3 and the ▾ with H4 to H6 are one control: a split button.
    React.createElement('span', { className: 'pt-tb-split' },
      React.createElement(StyleButton, { name: 'h3', label: 'H3' }),
      React.createElement(DeepHeadingMenu),
    ),
    React.createElement(StyleButton,     { name: 'blockquote', label: '❝' }),
    React.createElement('span',          { className: 'pt-tb-sep' }),
    React.createElement(DecoratorButton, { name: 'strong',    label: 'B' }),
    React.createElement(DecoratorButton, { name: 'em',        label: 'I' }),
    React.createElement(DecoratorButton, { name: 'underline', label: 'U' }),
    React.createElement('span',          { className: 'pt-tb-sep' }),
    React.createElement(ListButton,      { name: 'bullet', label: bulletListIcon, title: 'Punktliste' }),
    React.createElement(ListButton,      { name: 'number', label: numberListIcon, title: 'Nummerert liste' }),
    React.createElement('span',          { className: 'pt-tb-sep' }),
    React.createElement(PersonAnnotationButton),
    React.createElement(LinkAnnotationButton),
    React.createElement(ExpandButton, { expanded, onToggle: onToggleExpand }),
  )
}

export function PortableTextEditorReact({ value, generation, onChange, expanded, onToggleExpand }: Props) {
  return React.createElement(
    EditorProvider,
    { key: generation, initialConfig: { schemaDefinition, initialValue: value } },
    React.createElement(EventListenerPlugin, {
      on: (event: { type: string; value?: PortableTextBlock[] }) => {
        if (event.type === 'mutation' && event.value) onChange(event.value)
      },
    }),
    React.createElement(BehaviorPlugin, { behaviors: [replaceWords] }),
    React.createElement(Toolbar, { expanded, onToggleExpand }),
    React.createElement(PortableTextEditable, {
      renderDecorator,
      renderStyle,
      renderAnnotation,
      className: 'pt-editable',
    }),
  )
}
