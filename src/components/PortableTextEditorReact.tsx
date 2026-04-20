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
  type PortableTextBlock,
  type RenderAnnotationFunction,
  type RenderDecoratorFunction,
  type RenderStyleFunction,
} from '@portabletext/editor'
import { EventListenerPlugin } from '@portabletext/editor/plugins'
import { isActiveDecorator, isActiveStyle } from '@portabletext/editor/selectors'
import React from 'react'
import { neo4jQuery } from '@/composables/useNeo4j.ts'

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
