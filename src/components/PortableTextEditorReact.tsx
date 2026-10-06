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
import { EventListenerPlugin } from '@portabletext/editor/plugins'
import {
  getActiveAnnotations, getFocusTextBlock, getSelectedValue, getSelection, isActiveDecorator, isActiveListItem, isActiveStyle, isSelectionExpanded,
} from '@portabletext/editor/selectors'
import React from 'react'
import { neo4jQuery } from '@/composables/useNeo4j.ts'
import { hasLinkMark, resolveLinkTarget } from '@/utils/portableText.ts'

const schemaDefinition = defineSchema({
  decorators: [
    { name: 'strong' },
    { name: 'em' },
    { name: 'underline' },
  ],
  // Body content only supports h3 sub-headings — card titles are h2
  // at the page level, and h1 is reserved for the text-block page title.
  styles: [
    { name: 'normal' },
    { name: 'h3' },
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
}: {
  label:       React.ReactNode
  active:      boolean
  onClick:     () => void
  title?:      string
  /** The name of an icon-only button, for screen readers. */
  ariaLabel?:  string
  extraClass?: string
}) {
  return React.createElement(
    'button',
    {
      type:      'button',
      className: `pt-tb-btn${active ? ' active' : ''}${extraClass ? ` ${extraClass}` : ''}`,
      title,
      'aria-label': ariaLabel,
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

/** What the link box was opened on — fixed then, so a click elsewhere in the editor can't change what Enter does. */
interface LinkTarget {
  /** The selected words: the ones to link, or to take a link off. */
  at:      EditorSelection
  /** A selection or a link to change: without one there is nothing to link. */
  linkable: boolean
  /** The link the caret or selection lies wholly in, to change its address. */
  link:    { blockKey: string; markKey: string; href: string } | null
  /** Any link on the selected words, whole or in part. */
  hasLink: boolean
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

  function show() {
    const current = (active as { href?: string } | undefined)?.href ?? ''
    setHref(current)
    setTarget({
      at:       selection,
      linkable: !!active || (!!selection && expanded),
      link:     active && block ? { blockKey: block.node._key, markKey: active._key, href: current } : null,
      hasLink:  !!active || hasLinkMark(selected),
    })
  }
  function close() { setTarget(null); setHref('') }

  function apply() {
    const value = href.trim()
    if (!target?.linkable || !resolveLinkTarget(value)) return
    if (target.link) {
      editor.send({ type: 'annotation.set', at: [{ _key: target.link.blockKey }, 'markDefs', { _key: target.link.markKey }], props: { href: value } })
    } else if (target.at) {
      editor.send({ type: 'annotation.add', annotation: { name: 'link', value: { href: value } }, at: target.at })
    }
    close()
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
      onClick: () => (target ? close() : show()),
    }),
    target ? React.createElement(
      'div',
      { className: 'pt-link-pop' },
      !target.linkable
        ? React.createElement('p', { className: 'pt-link-hint' }, 'Merk teksten som skal bli en lenke.')
        : null,
      React.createElement('input', {
        className:   'pt-link-input',
        autoFocus:   true,
        placeholder: 'https://… eller /events/…',
        value:       href,
        onChange:    (e: React.ChangeEvent<HTMLInputElement>) => setHref(e.target.value),
        onKeyDown:   (e: React.KeyboardEvent) => {
          if (e.key === 'Enter')  { e.preventDefault(); apply() }
          if (e.key === 'Escape') { e.preventDefault(); close() }
        },
      }),
      React.createElement(
        'div',
        { className: 'pt-link-actions' },
        React.createElement('button', {
          type: 'button', className: 'pt-link-apply', disabled: !target.linkable || !resolveLinkTarget(href),
          onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: apply,
        }, target.link ? 'Endre' : 'Bruk'),
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
    React.createElement(StyleButton,     { name: 'h3',         label: 'H3' }),
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

export function PortableTextEditorReact({ value, onChange, expanded, onToggleExpand }: Props) {
  return React.createElement(
    EditorProvider,
    { initialConfig: { schemaDefinition, initialValue: value } },
    React.createElement(EventListenerPlugin, {
      on: (event: { type: string; value?: PortableTextBlock[] }) => {
        if (event.type === 'mutation' && event.value) onChange(event.value)
      },
    }),
    React.createElement(Toolbar, { expanded, onToggleExpand }),
    React.createElement(PortableTextEditable, {
      renderDecorator,
      renderStyle,
      renderAnnotation,
      className: 'pt-editable',
    }),
  )
}
