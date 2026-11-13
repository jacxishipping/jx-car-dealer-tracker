import { useMemo, useState } from 'react'
import { JXButton, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import { ROLES, type DocRecord, type Role } from '../store/types'
import { Alert, EmptyState, ExportButton, Field, inputCls, Modal, PageHeader, StatusChip, TableScrollHint, usePagination } from '../components/ui'

const DOC_TYPES = ['Vehicle title', 'Bill of sale', 'Auction invoice', 'Bill of lading', 'Repair invoice', 'Customer identification', 'Sales contract', 'Payment receipt', 'Insurance', 'Other']
const ENTITY_TYPES: DocRecord['entityType'][] = ['Vehicle', 'Customer', 'Expense', 'Transaction', 'Deal']
const today = () => new Date().toISOString().slice(0, 10)

const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`)
const isExpired = (d: DocRecord) => !!d.expiresAt && d.expiresAt < today()
const isExpiringSoon = (d: DocRecord) => !!d.expiresAt && !isExpired(d) && d.expiresAt <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

export default function Documents() {
  const { state, addDocument } = useStore()
  const [typeFilter, setTypeFilter] = useState('all')
  const [entityFilter, setEntityFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const [title, setTitle] = useState('')
  const [type, setType] = useState(DOC_TYPES[0])
  const [entityType, setEntityType] = useState<DocRecord['entityType']>('Vehicle')
  const [entityId, setEntityId] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState('')
  const [fileType, setFileType] = useState('application/pdf')
  const [expiresAt, setExpiresAt] = useState('')
  const [accessRole, setAccessRole] = useState<Role>('Manager')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const entityIds = useMemo(() => {
    switch (entityType) {
      case 'Vehicle': return state.vehicles.map((v) => ({ id: v.id, label: `${v.stockNumber} — ${v.year} ${v.make} ${v.model}` }))
      case 'Customer': return state.customers.map((c) => ({ id: c.id, label: c.name }))
      case 'Expense': return state.expenses.map((e) => ({ id: e.id, label: `${e.description} (${e.invoiceRef || 'no invoice'})` }))
      case 'Transaction': return state.transactions.map((t) => ({ id: t.id, label: `${t.reference} — ${t.type}` }))
      case 'Deal': return state.deals.map((d) => ({ id: d.id, label: `${d.ref} — ${d.status}` }))
    }
  }, [entityType, state])

  const types = useMemo(() => [...new Set(state.documents.map((d) => d.type))], [state.documents])
  const filtered = useMemo(() => state.documents
    .filter((d) => (typeFilter === 'all' || d.type === typeFilter) && (entityFilter === 'all' || d.entityType === entityFilter))
    .filter((d) => !query.trim() || `${d.title} ${d.fileName} ${d.entityId}`.toLowerCase().includes(query.trim().toLowerCase())),
    [state.documents, typeFilter, entityFilter, query])
  const { pageItems, controls } = usePagination(filtered, 10)

  const submit = () => {
    setError(''); setDone('')
    if (!title.trim()) { setError('Title is required.'); return }
    if (!entityId) { setError('Select the linked record (entity).'); return }
    if (!fileName.trim()) { setError('File name is required — this build stores metadata only, so type the file name as it appears on disk.'); return }
    const size = Number(fileSize)
    if (!fileSize || Number.isNaN(size) || size < 0) { setError('File size must be a number of bytes (0 if unknown).'); return }
    addDocument({
      title: title.trim(), type, entityType, entityId,
      fileName: fileName.trim(), fileSize: size, fileType: fileType.trim() || 'application/octet-stream',
      expiresAt: expiresAt || null, accessRole,
    })
    setDone(`Document metadata for “${title.trim()}” saved. No file bytes were uploaded.`)
    setTitle(''); setEntityId(''); setFileName(''); setFileSize(''); setExpiresAt('')
  }

  const thCls = 'border-b border-slate-200 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400'
  const tdCls = 'border-b border-slate-100 px-4 py-2.5 text-slate-700 dark:border-slate-700 dark:text-slate-300'

  return (
    <>
      <PageHeader title="Documents" subtitle="One central register for every document in the tracker — titles, bills of sale, invoices, contracts and receipts."
        actions={<JXButton variant="contained" size="sm" onClick={() => { setShowAdd(true); setError(''); setDone('') }}>Add document</JXButton>} />
      <div className="mb-5">
        <Alert severity="warning" title="Metadata only in this build"
          description="Documents here are metadata records (title, file name, size, type, expiry, access role). No real file bytes are uploaded or stored. Production needs object storage plus signed URLs before any file can be opened from this register." />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full sm:w-56">
          <label htmlFor="documents-search" className="sr-only">Search documents by title or file name</label>
          <JXTextField id="documents-search" className="jx-text-field" label="" aria-label="Search documents by title or file name" value={query} onChange={setQuery} placeholder="Search title or file name…" />
        </div>
        <div className="w-full sm:w-52">
          <JXSelect label="Filter by document type" className="jx-select-field jx-sr-label" placeholder="All types" options={[{ id: 'all', label: 'All types' }, ...types.map((t) => ({ id: t, label: t }))]} value={typeFilter} onChange={setTypeFilter} />
        </div>
        <div className="w-full sm:w-48">
          <JXSelect label="Filter by entity type" className="jx-select-field jx-sr-label" placeholder="All entities" options={[{ id: 'all', label: 'All entities' }, ...ENTITY_TYPES.map((t) => ({ id: t, label: t }))]} value={entityFilter} onChange={setEntityFilter} />
        </div>
        <ExportButton filename="documents.csv" rows={filtered.map((d) => ({
          title: d.title, type: d.type, entity_type: d.entityType, entity_id: d.entityId,
          file_name: d.fileName, file_size_bytes: d.fileSize, file_type: d.fileType,
          uploaded_at: d.uploadedAt, uploaded_by: d.uploadedBy, expires_at: d.expiresAt ?? '', access_role: d.accessRole,
        }))} />
      </div>

      {filtered.length === 0
        ? <EmptyState title="No documents match" detail="Adjust the type / entity filters or add a document record." />
        : (
          <>
              <TableScrollHint />
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr><th className={thCls}>Title</th><th className={thCls}>Type</th><th className={thCls}>Linked to</th><th className={thCls}>File</th><th className={thCls}>Size</th><th className={thCls}>Uploaded</th><th className={thCls}>Expires</th><th className={thCls}>Access role</th></tr></thead>
                  <tbody>
                    {pageItems.map((d) => (
                      <tr key={d.id}>
                        <td className={`${tdCls} font-medium text-slate-900 dark:text-white`}>{d.title}</td>
                        <td className={tdCls}>{d.type}</td>
                        <td className={tdCls}>{d.entityType} · <span className="font-mono text-xs">{d.entityId}</span></td>
                        <td className={tdCls}><span className="font-mono text-xs">{d.fileName}</span><br /><span className="text-xs text-slate-500 dark:text-slate-400">{d.fileType}</span></td>
                        <td className={tdCls}>{fmtSize(d.fileSize)}</td>
                        <td className={tdCls}>{d.uploadedAt}<br /><span className="text-xs text-slate-500 dark:text-slate-400">{d.uploadedBy}</span></td>
                        <td className={tdCls}>
                          {d.expiresAt ?? '—'}
                          {isExpired(d) && <><br /><span className="font-semibold text-rose-600 dark:text-rose-400">Expired</span></>}
                          {isExpiringSoon(d) && <><br /><span className="font-semibold text-amber-700 dark:text-amber-400">Expiring soon</span></>}
                        </td>
                        <td className={tdCls}><StatusChip value={d.accessRole} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {controls}
            </>
        )}

            {showAdd && (
              <Modal title="Add document (metadata)" onClose={() => setShowAdd(false)}>
                <div className="space-y-4">
                  <Field label="Title">
                    <JXTextField className="jx-text-field" label="" value={title} onChange={setTitle} placeholder="e.g. Title — 2021 Toyota RAV4" />
                  </Field>
                  <JXSelect label="Document type" className="jx-select-field jx-field-select" options={DOC_TYPES.map((t) => ({ id: t, label: t }))} value={type} onChange={setType} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <JXSelect label="Entity type" className="jx-select-field jx-field-select" options={ENTITY_TYPES.map((t) => ({ id: t, label: t }))} value={entityType} onChange={(v) => { setEntityType(v as DocRecord['entityType']); setEntityId('') }} />
                    <JXSelect label="Linked record" className="jx-select-field jx-field-select" placeholder="Select a record" options={entityIds} value={entityId} onChange={setEntityId} searchable />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="File name">
                      <JXTextField className="jx-text-field" label="" value={fileName} onChange={setFileName} placeholder="e.g. title-rav4.pdf" />
                    </Field>
                    <Field label="File size (bytes)">
                      <JXTextField className="jx-text-field" label="" value={fileSize} onChange={setFileSize} placeholder="e.g. 184320" />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="File type (MIME)">
                      <JXTextField className="jx-text-field" label="" value={fileType} onChange={setFileType} placeholder="application/pdf" />
                    </Field>
                    <Field label="Expiry date (optional)">
                      <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <JXSelect label="Minimum access role" className="jx-select-field jx-field-select" options={ROLES.map((r) => ({ id: r, label: r }))} value={accessRole} onChange={(v) => setAccessRole(v as Role)} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">This saves a metadata record only. No file is uploaded, and the “access role” is a label for now — it is not enforced by a server.</p>
                  {error && <Alert severity="error" title="Cannot save document" description={error} />}
                  {done && <Alert severity="success" title={done} />}
                  <div className="flex flex-wrap justify-end gap-2">
                    <JXButton variant="outlined" onClick={() => setShowAdd(false)}>Close</JXButton>
                    <JXButton variant="contained" onClick={submit}>Save metadata</JXButton>
                  </div>
                </div>
              </Modal>
            )}
          </>
        )
      }
