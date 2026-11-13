import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

type ElementProps = { children?: ReactNode; className?: string }

function elementChildren(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return []
  return Children.toArray((node.props as ElementProps).children)
}

function readText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim()
  if (Array.isArray(node)) return node.map(readText).filter(Boolean).join(' ')
  if (!isValidElement(node)) return ''
  const props = node.props as ElementProps & { label?: string; value?: unknown }
  if (typeof props.label === 'string') return props.label
  return readText(props.children)
}

function childrenWithTag(node: ReactNode, tag: string): ReactElement<ElementProps> | undefined {
  return Children.toArray(node).find((child): child is ReactElement<ElementProps> => isValidElement(child) && child.type === tag)
}

/** Keeps the semantic desktop table and renders its same row cells as labeled mobile cards. */
export default function ResponsiveTable({ children, label }: { children: ReactElement<ElementProps>; label?: string }) {
  const tableChildren = elementChildren(children)
  const head = childrenWithTag(tableChildren, 'thead')
  const body = childrenWithTag(tableChildren, 'tbody')
  const headerRow = head && childrenWithTag(elementChildren(head), 'tr')
  const headers = headerRow
    ? elementChildren(headerRow).map((cell) => readText(cell))
    : []
  const rows = body
    ? elementChildren(body).filter((row): row is ReactElement<ElementProps> => isValidElement(row) && row.type === 'tr')
    : []

  return (
    <>
      <div className="jx-responsive-table__desktop">{children}</div>
      <div className="jx-responsive-table__cards" role="list" aria-label={label ?? 'Records'}>
        {rows.map((row, rowIndex) => {
          const cells = elementChildren(row).filter((cell): cell is ReactElement<ElementProps> => isValidElement(cell) && (cell.type === 'td' || cell.type === 'th'))
          const primaryIndex = Math.max(0, headers.findIndex((header) => header.length > 0))
          const primaryLabel = headers[primaryIndex] || 'Record'
          const primary = cells[primaryIndex]?.props.children
          return (
            <article className="jx-responsive-table__card" role="listitem" key={row.key ?? rowIndex}>
              <div className="jx-responsive-table__card-title">
                <span className="jx-responsive-table__eyebrow">{primaryLabel}</span>
                <div className="jx-responsive-table__primary-value">{primary ?? '—'}</div>
              </div>
              <dl className="jx-responsive-table__fields">
                {cells.map((cell, index) => {
                  if (index === primaryIndex) return null
                  const value = cell.props.children
                  const columnLabel = headers[index] || ''
                  if (!columnLabel && !readText(value) && Children.count(value) === 0) return null
                  if (!columnLabel) {
                    return <div className="jx-responsive-table__actions" key={cell.key ?? index}>{value}</div>
                  }
                  return (
                    <div className="jx-responsive-table__field" key={cell.key ?? index}>
                      <dt>{columnLabel}</dt>
                      <dd>{value ?? '—'}</dd>
                    </div>
                  )
                })}
              </dl>
            </article>
          )
        })}
      </div>
    </>
  )
}
