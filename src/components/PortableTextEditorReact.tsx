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
  getActiveAnnotations, getFocusTextBlock, getSelectedValue, getSelection, isActiveDecorator, isActiveStyle, isSelectionExpanded,
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
  lists: [],
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
}

function ToolbarButton({
  label,
  active,
  onClick,
}: {
  label:   string
  active:  boolean
  onClick: () => void
}) {
  return React.createElement(
    'button',
    {
      type:      'button',
      className: `pt-tb-btn${active ? ' active' : ''}`,
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(), // keep selection
      onClick,
    },
    label,
  )
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
      label:  'Lenke',
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

function Toolbar() {
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
    React.createElement(PersonAnnotationButton),
    React.createElement(LinkAnnotationButton),
  )
}

export function PortableTextEditorReact({ value, onChange }: Props) {
  return React.createElement(
    EditorProvider,
    { initialConfig: { schemaDefinition, initialValue: value } },
    React.createElement(EventListenerPlugin, {
      on: (event: { type: string; value?: PortableTextBlock[] }) => {
        if (event.type === 'mutation' && event.value) onChange(event.value)
      },
    }),
    React.createElement(Toolbar),
    React.createElement(PortableTextEditable, {
      renderDecorator,
      renderStyle,
      renderAnnotation,
      className: 'pt-editable',
    }),
  )
}
