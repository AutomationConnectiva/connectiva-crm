import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import {
  Users, UserPlus, Calendar, Target, Menu, X, Search,
  Clock, Check, Save, XCircle, Loader2,
  UserCheck, Trash2, LogOut, ArrowLeft, Eye, Pencil, ChevronDown, ChevronUp, AlertTriangle,
  Mail, MessageSquare, Ban, History
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Fixed pick-lists. These are UI constants (dropdown options), not fake rows —
// swap the arrays' contents to match your real values whenever you confirm them.
// ---------------------------------------------------------------------------
const LEAD_STATUS_OPTIONS = ['New', 'Contacted', 'Unsubscribed']
const NURTURE_STAGE_OPTIONS = ['Cold', 'Warming', 'Outreach', 'Confirmed']
const EVENT_STATUS_OPTIONS = ['Planned', 'Active', 'Completed', 'Cancelled']
const PARTICIPANT_ROLE_OPTIONS = ['Attendee', 'Speaker', 'Sponsor', 'Organizer']
const PARTICIPANT_STATUS_OPTIONS = ['Invited', 'Confirmed', 'Attended', 'Cancelled']
const INDUSTRY_OPTIONS = ['Insurance', 'Banking', 'Finance']
const LEAD_PURPOSE_CHOICES = ['Delegate Acquisition', 'Speaker Acquisition', 'Sponsor Acquisition']
// people.owner_email — must exactly match what the Make.com send scenario
// matches against (nabi@ / alia@ / abdool@ / chris@connectiva.events). A
// free-text input here risks the exact same silent-mismatch bug found
// earlier (a trailing space on one row meant that lead was invisible to
// its assigned persona) — a fixed dropdown makes that class of bug
// impossible to reintroduce by hand.
const OWNER_EMAIL_OPTIONS = [
  'nabi@connectiva.events',
  'alia@connectiva.events',
  'abdool@connectiva.events',
  'chris@connectiva.events',
]

// ---------------------------------------------------------------------------
// CHANNEL CONTRACT — this must match what the Make.com scenarios actually
// read/write, NOT an arbitrary UI choice. Confirmed against live scenarios:
//
//   Email        -> ready to send when email_campaign = true AND
//                    email_campaign_stage IS NULL
//   Cold calling -> ready to call when cold_calling = true AND
//                    (cold_calling_stage IS NULL OR cold_calling_stage = 'Not Pitched')
//                    ALSO requires a phone number (mobile or phone) and a
//                    linked company (Make's query INNER JOINs companies).
//   Social/LinkedIn -> NOT wired to a confirmed live contract yet (HeyReach
//                    scenario still undecided). Left inert on purpose — the
//                    app does not set its boolean/stage automatically.
//
// Once a lead exists, its *_stage fields are owned by the automations (an AI
// cold-calling agent writes branching outcomes like 'Not Pitched' / 'Send
// Email'; the email scenario writes things like 'email sent' / 'send
// failed'). The CRM must never blind-overwrite these on a routine save, so
// they are shown read-only in the edit view instead of editable dropdowns.
// ---------------------------------------------------------------------------
const CHANNEL_FIELDS = [
  { key: 'cold_calling_stage', boolKey: 'cold_calling', label: 'Cold calling', live: true },
  { key: 'email_campaign_stage', boolKey: 'email_campaign', label: 'Email', live: true },
  { key: 'social_media_stage', boolKey: 'social_media', label: 'Social / LinkedIn', live: false },
]

// Defaults applied when converting people to leads in bulk from the People
// page. Every channel starts ON (meaning: start tracking it) unless turned
// off — either for the whole batch, or as a one-off exception for a
// specific person.
const ALL_CHANNELS_ON = CHANNEL_FIELDS.reduce((acc, cf) => ({ ...acc, [cf.key]: true }), {})

const NAV_ITEMS = [
  { key: 'people', label: 'People', icon: Users },
  { key: 'leads', label: 'Leads', icon: Target },
  { key: 'events', label: 'Events', icon: Calendar },
  { key: 'attendees', label: 'Attendees', icon: UserCheck },
  { key: 'create', label: 'Create', icon: UserPlus },
]

const AVATAR_PALETTE = [
  { bg: '#EFE6DC', fg: '#8A5A34' },
  { bg: '#DCE7E3', fg: '#2F6E5C' },
  { bg: '#E4E1F2', fg: '#5B4E9C' },
  { bg: '#F2E3E1', fg: '#A8503E' },
  { bg: '#E1EAF2', fg: '#3A6690' },
]
function avatarStyle(name) {
  let hash = 0
  const s = name || ''
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}
function initials(a, b) {
  return `${(a || ' ')[0]}${(b || ' ')[0]}`.toUpperCase()
}
function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Normalizes a stored URL (e.g. LinkedIn) so it's always used as an ABSOLUTE
// external link. Without this, a value like "linkedin.com/in/johndoe" (no
// protocol) gets treated by the browser as a RELATIVE path on your own app's
// domain when used directly as an <a href>, which is why clicking it looked
// like it "redirected once then reopened the app" — it was just React Router
// (or a full page load) navigating within connectiva-crm itself instead of
// leaving the site.
function openPersonInNewTab(personId) {
  const url = new URL(window.location.href)
  url.searchParams.set('person', personId)
  window.open(url.toString(), '_blank', 'noopener,noreferrer')
}

function externalUrl(u) {
  if (!u) return null
  const trimmed = u.trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

const PAGE_SIZE = 15
function paginate(items, page) {
  const start = (page - 1) * PAGE_SIZE
  return items.slice(start, start + PAGE_SIZE)
}
function Pagination({ page, setPage, total }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const [jumpValue, setJumpValue] = useState('')

  const commitJump = () => {
    const n = parseInt(jumpValue, 10)
    if (!Number.isNaN(n)) {
      setPage(Math.min(totalPages, Math.max(1, n)))
    }
    setJumpValue('')
  }

  return (
    <div className="crm-pagination">
      <span>Page {page} of {totalPages} · {total} total</span>
      <button className="crm-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
      <button className="crm-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
      <div className="crm-pagination-jump">
        <input
          type="number"
          min={1}
          max={totalPages}
          className="crm-pagination-jump-input"
          placeholder={`${page}`}
          value={jumpValue}
          onChange={e => setJumpValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitJump() }}
        />
        <span className="crm-pagination-jump-of">of {totalPages}</span>
        <button className="crm-page-btn" onClick={commitJump}>Go</button>
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return <label className="crm-field-label">{children}</label>
}

// Autocomplete company picker — loads the full companies list once, filters
// client-side (case-insensitive substring) as the user types, and lets them
// pick an existing company from a dropdown instead of retyping the name.
// The moment the typed text exactly matches an existing name (any casing),
// company_id is auto-resolved — so "connectiva" while "Connectiva" already
// exists in the DB attaches to the SAME row instead of risking a near-dupe.
// A new company is only ever created when nothing in the list matches at all,
// and even then only on save (see saveEdit/save's ilike-then-insert fallback).
function CompanyPicker({ value, onChange, showToast }) {
  const [query, setQuery] = useState(value?.company_name || '')
  const [companies, setCompanies] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [coords, setCoords] = useState(null)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    setQuery(value?.company_name || '')
  }, [value?.company_id, value?.company_name])

  useEffect(() => {
    if (loaded) return
    ;(async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('company_id, company_name, country')
        .order('company_name', { ascending: true })
      if (!error) setCompanies(data || [])
      setLoaded(true)
    })()
  }, [loaded])

  // Recompute the dropdown's screen position (viewport-relative, since we
  // use position:fixed) any time it opens, and keep it in sync on scroll —
  // including scrolling INSIDE the table wrapper, since that's the ancestor
  // that used to clip this dropdown.
  const updateCoords = useCallback(() => {
    if (!inputRef.current) return
    const r = inputRef.current.getBoundingClientRect()
    setCoords({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  useEffect(() => {
    if (!open) return
    updateCoords()
    const onScrollOrResize = () => updateCoords()
    // capture:true so this fires on scroll of ANY ancestor, not just window
    // (e.g. the .crm-table-wrap's own overflow:auto scroll).
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, updateCoords])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target) &&
          !e.target.closest('.crm-company-dropdown')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = q
    ? companies.filter(c => (c.company_name || '').toLowerCase().includes(q))
    : companies

  const exactMatch = companies.find(c => (c.company_name || '').toLowerCase() === q)
  const isExistingCompany = !!value?.company_id
  const isNewCompany = q.length > 0 && !isExistingCompany

  const selectCompany = (c) => {
    setQuery(c.company_name)
    onChange({ company_id: c.company_id, company_name: c.company_name, country: c.country || '' })
    setOpen(false)
  }

  const handleChange = (e) => {
    const v = e.target.value
    setQuery(v)
    setOpen(true)
    updateCoords()
    const exact = companies.find(c => (c.company_name || '').toLowerCase() === v.trim().toLowerCase())
    if (!v.trim()) {
      onChange(null)
      return
    }
    onChange(
      exact
        ? { company_id: exact.company_id, company_name: v, country: exact.country || '' }
        : { company_id: null, company_name: v, country: value?.country || '' }
    )
  }

  const handleCountryChange = (e) => {
    onChange({ company_id: value?.company_id || null, company_name: query, country: e.target.value })
  }

  const handleCompanySaved = (updated) => {
    setQuery(updated.company_name)
    onChange(updated)
    setCompanies(prev => prev.map(c => (c.company_id === updated.company_id ? { ...c, ...updated } : c)))
  }

  return (
    <div ref={wrapRef} className="crm-company-picker">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          ref={inputRef}
          className="crm-input"
          value={query}
          placeholder="Company name"
          onChange={handleChange}
          onFocus={() => { setOpen(true); updateCoords() }}
          style={{ flex: 1 }}
        />
        {isExistingCompany && (
          <button
            type="button"
            className="crm-icon-action"
            onClick={() => setShowEdit(true)}
            title="Edit this company"
            aria-label="Edit this company"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {isNewCompany && (
        <input
          className="crm-input"
          style={{ marginTop: 6 }}
          value={value?.country || ''}
          onChange={handleCountryChange}
          placeholder="Country (new company)"
        />
      )}

      {open && coords && (matches.length > 0 || (q && !exactMatch)) && createPortal(
        <div
          className="crm-company-dropdown"
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width, right: 'auto' }}
        >
          {matches.map(c => {
            const isExact = (c.company_name || '').toLowerCase() === q
            return (
              <div
                key={c.company_id}
                className={`crm-company-dropdown-item${isExact ? ' exact' : ''}`}
                onMouseDown={() => selectCompany(c)}
              >
                {c.company_name}{c.country ? ` — ${c.country}` : ''}
              </div>
            )
          })}
          {q && !exactMatch && (
            <div
              className="crm-company-dropdown-create"
              onMouseDown={() => setOpen(false)}
            >
              + Create new company "{query.trim()}"
            </div>
          )}
        </div>,
        document.body
      )}

      {showEdit && isExistingCompany && (
        <CompanyEditModal
          company={{ company_id: value.company_id, company_name: value.company_name, country: value.country }}
          onClose={() => setShowEdit(false)}
          onSaved={handleCompanySaved}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Edit an EXISTING company row directly — since companies is its own table
// linked by company_id FK, this updates the shared row once and every person
// pointing at that company_id reflects it immediately. No cascade needed.
// ----------------------------------------------------------------------------
function CompanyEditModal({ company, onClose, onSaved, showToast }) {
  const [name, setName] = useState(company.company_name || '')
  const [country, setCountry] = useState(company.country || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('companies')
      .update({ company_name: name.trim(), country: country.trim() || null })
      .eq('company_id', company.company_id)
    setSaving(false)
    if (error) {
      showToast && showToast(`Couldn't update company: ${error.message}`, true)
      return
    }
    showToast && showToast("Company updated — reflected everywhere it's linked")
    onSaved({ company_id: company.company_id, company_name: name.trim(), country: country.trim() })
    onClose()
  }

  return (
    <div className="crm-modal-overlay">
      <div className="crm-modal-backdrop" onClick={onClose} />
      <div className="crm-modal-card" style={{ maxWidth: 400 }}>
        <h4 className="crm-confirm-heading">Edit company</h4>
        <p className="crm-confirm-note">
          Updates the shared record — every person linked to this company reflects it immediately.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <FieldLabel>Company name</FieldLabel>
            <input className="crm-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Country</FieldLabel>
            <input className="crm-input" value={country} onChange={e => setCountry(e.target.value)} />
          </div>
        </div>
        <div className="crm-confirm-actions" style={{ marginTop: 18 }}>
          <button className="crm-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="crm-submit-btn"
            style={{ width: 'auto', padding: '10px 20px' }}
            onClick={save}
            disabled={saving || !name.trim()}
          >
            {saving ? <Loader2 size={15} className="crm-spin" /> : <Save size={15} />} Save
          </button>
        </div>
      </div>
    </div>
  )
}
// ---------------------------------------------------------------------------
// Styles — plain CSS, no Tailwind dependency.
// ---------------------------------------------------------------------------
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');

  html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; }

  .crm-root {
    --ink-950: #14161C; --ink-900: #1D2027; --ink-700: #4A4F5A; --ink-400: #8A8F99;
    --paper: #F6F5F1; --surface: #FFFFFF; --line: #E7E4DD;
    --accent: #0E6F5C; --accent-soft: #E3EFEA; --accent-ink: #0B5647;
    --amber: #B8862E; --amber-soft: #F3E9D6;
    --red: #B23A3A; --red-soft: #F5E3E1;
    --navy: #081026; --navy-2: #0C1530;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    background: var(--paper); color: var(--ink-900);
    height: 100vh; width: 100%; display: flex; overflow: hidden; box-sizing: border-box;
  }
  .crm-root *, .crm-root *::before, .crm-root *::after { box-sizing: border-box; }
  .crm-display { font-family: 'Fraunces', serif; }

  .crm-sidebar { display: none; flex-direction: column; flex-shrink: 0; background: var(--navy); width: 248px; transition: width .2s ease; }
  .crm-sidebar.collapsed { width: 76px; }
  @media (min-width: 860px) { .crm-sidebar { display: flex; } }
  .crm-sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 24px 20px; }
  .crm-logo { font-family: 'Fraunces', serif; font-size: 20px; letter-spacing: -0.02em; color: #F4F3EF; white-space: nowrap; }
  .crm-logo span { color: #7FD1B9; }
  .crm-logo-dot { width: 28px; height: 28px; border-radius: 8px; background: #7FD1B9; }
  .crm-icon-btn { width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; color: #9AA0AC; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .crm-icon-btn:hover { background: rgba(255,255,255,0.06); }
  .crm-nav { flex: 1; padding: 0 12px; display: flex; flex-direction: column; gap: 4px; }
  .crm-nav-btn { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border-radius: 10px; border: none; cursor: pointer; font-size: 13.5px; font-weight: 500; background: transparent; color: #B7BBC4; transition: background-color .15s ease, color .15s ease; text-align: left; }
  .crm-nav-btn.collapsed { justify-content: center; }
  .crm-nav-btn.active { background: rgba(127,209,185,0.14); color: #7FD1B9; }
  .crm-nav-btn:hover:not(.active) { background: rgba(255,255,255,0.05); }
  .crm-sidebar-foot { padding: 18px 20px; font-size: 11px; color: #5B5F69; border-top: 1px solid rgba(255,255,255,0.06); }

  .crm-drawer-overlay { display: none; position: fixed; inset: 0; z-index: 40; }
  .crm-drawer-overlay.open { display: flex; }
  .crm-drawer-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); }
  .crm-drawer-panel { position: relative; width: 240px; display: flex; flex-direction: column; background: var(--navy); }
  @media (min-width: 860px) { .crm-drawer-overlay { display: none !important; } }

  .crm-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .crm-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 20px; border-bottom: 1px solid var(--line); background: var(--surface); flex-shrink: 0; }
  @media (min-width: 860px) { .crm-header { padding: 20px 36px; } }
  .crm-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .crm-mobile-menu-btn { display: flex; flex-shrink: 0; width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; }
  @media (min-width: 860px) { .crm-mobile-menu-btn { display: none; } }
  .crm-back-btn { display: flex; flex-shrink: 0; width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; color: var(--ink-700); }
  .crm-back-btn:hover { background: var(--paper); }
  .crm-page-title { font-size: 24px; line-height: 1.2; color: var(--ink-950); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (min-width: 860px) { .crm-page-title { font-size: 28px; } }
  .crm-page-sub { font-size: 13px; color: var(--ink-400); margin: 2px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .crm-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .crm-user-avatar { width: 36px; height: 36px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; background: var(--accent-soft); color: var(--accent-ink); flex-shrink: 0; }

  .crm-content { flex: 1; overflow: auto; padding: 24px 20px; }
  @media (min-width: 860px) { .crm-content { padding: 28px 36px; } }

  .crm-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 18px; }
  .crm-search-box { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); flex: 1; min-width: 220px; }
  .crm-search-box input { background: transparent; border: none; outline: none; font-size: 13.5px; color: var(--ink-900); width: 100%; }
  .crm-filter-select { padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; color: var(--ink-700); cursor: pointer; }
  .crm-toggle-chip { display: flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; color: var(--ink-700); cursor: pointer; user-select: none; }
  .crm-toggle-chip.on { background: var(--accent-soft); color: var(--accent-ink); border-color: transparent; }
  .crm-count-note { font-size: 12.5px; color: var(--ink-400); margin-left: auto; white-space: nowrap; }

  .crm-pagination { display: flex; align-items: center; gap: 10px; justify-content: flex-end; padding: 12px 4px; font-size: 13px; color: var(--ink-700); }
  .crm-page-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; font-size: 13px; }
  .crm-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .crm-pagination-jump { display: flex; align-items: center; gap: 6px; margin-left: 6px; }
  .crm-pagination-jump-input { width: 56px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line); font-size: 13px; font-family: inherit; text-align: center; outline: none; }
  .crm-pagination-jump-input:focus { border-color: var(--accent); }
  .crm-pagination-jump-of { font-size: 12.5px; color: var(--ink-400); white-space: nowrap; }
  
  .crm-table-wrap { border: 1px solid var(--line); background: var(--surface); border-radius: 16px; overflow: auto; }
  .crm-table { width: 100%; font-size: 13.5px; border-collapse: collapse; min-width: 760px; }
  .crm-table thead tr { border-bottom: 1px solid var(--line); }
  .crm-table th { text-align: left; padding: 12px 18px; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-400); white-space: nowrap; }
  .crm-table td { padding: 10px 18px; border-bottom: 1px solid var(--line); color: var(--ink-700); vertical-align: middle; }
  .crm-table tbody tr:hover td { background: #FAFAF8; }
  .crm-table tbody tr.editing td { background: var(--accent-soft); }
  .crm-table tbody tr.clickable { cursor: pointer; }
  .crm-table tbody tr.disabled { opacity: 0.45; cursor: not-allowed; }
  .crm-table tbody tr.disabled:hover td { background: inherit; }
  .crm-table tbody tr:last-child td { border-bottom: none; }
  .crm-name-cell { display: flex; align-items: center; gap: 10px; font-weight: 500; color: var(--ink-950); }
  .crm-empty-row td { text-align: center; padding: 40px 24px; color: var(--ink-400); }
  .crm-avatar { width: 32px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }

  .crm-company-picker { position: relative; }
 .crm-company-dropdown {
  position: fixed; z-index: 999;
  background: var(--surface, #FFFFFF);
  border: 1px solid var(--line, #E7E4DD);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  max-height: 220px; overflow-y: auto;
}
  .crm-company-dropdown-item {
  padding: 9px 14px; font-size: 13.5px;
  color: var(--ink-900, #1D2027); cursor: pointer;
}
 .crm-company-dropdown-item:hover { background: var(--paper, #F6F5F1); }
.crm-company-dropdown-item.exact { color: var(--accent-ink, #0B5647); font-weight: 500; }
.crm-company-dropdown-create {
  padding: 9px 14px; font-size: 13px;
  color: var(--accent-ink, #0B5647); cursor: pointer;
  border-top: 1px solid var(--line, #E7E4DD); font-weight: 500;
}
.crm-company-dropdown-create:hover { background: var(--accent-soft, #E3EFEA); }

  .crm-cell-input { width: 100%; min-width: 90px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); font-size: 13px; font-family: inherit; outline: none; }
  .crm-cell-input:focus { border-color: var(--accent); }
  .crm-cell-input + .crm-cell-input { margin-top: 4px; }
  .crm-cell-select { width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); font-size: 13px; font-family: inherit; background: #fff; }
  .crm-row-actions { display: flex; gap: 6px; white-space: nowrap; }
  .crm-icon-action { width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--line); background: var(--surface); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .crm-icon-action:hover { background: var(--paper); }
  .crm-icon-action.save { color: var(--accent-ink); border-color: var(--accent); }
  .crm-icon-action.cancel { color: var(--red); }
  .crm-badge { font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
  .crm-lead-tag { font-size: 10.5px; font-weight: 600; color: var(--accent-ink); background: var(--accent-soft); padding: 2px 8px; border-radius: 999px; margin-left: 8px; white-space: nowrap; }
  .crm-muted { color: var(--ink-400); font-size: 12.5px; }
  .crm-history-tag {
    font-size: 11.5px;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--paper);
    border: 1px solid var(--line);
    color: var(--ink-700);
    cursor: help;
  }
  .crm-spin { animation: crm-spin-kf 0.8s linear infinite; }
  @keyframes crm-spin-kf { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .crm-loading, .crm-error { display: flex; align-items: center; gap: 8px; padding: 40px 0; justify-content: center; color: var(--ink-400); font-size: 14px; }
  .crm-error { color: var(--red); }

  .crm-create-wrap { max-width: 560px; }
  .crm-tabs { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); margin-bottom: 24px; }
  .crm-tab-btn { padding: 7px 16px; border-radius: 999px; border: none; font-size: 13.5px; font-weight: 500; background: transparent; color: var(--ink-700); cursor: pointer; }
  .crm-tab-btn.active { background: var(--navy); color: #F4F3EF; }
  .crm-form { display: flex; flex-direction: column; gap: 16px; border: 1px solid var(--line); background: var(--surface); border-radius: 16px; padding: 24px; }
  .crm-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .crm-field-label { display: block; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-400); margin-bottom: 6px; }
  .crm-input, .crm-select, .crm-textarea { width: 100%; padding: 10px 14px; border-radius: 10px; font-size: 13.5px; outline: none; border: 1px solid var(--line); background: var(--surface); color: var(--ink-900); font-family: inherit; }
  .crm-textarea { resize: vertical; min-height: 70px; }
  .crm-input:focus, .crm-select:focus, .crm-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .crm-submit-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 11px; border-radius: 10px; border: none; font-size: 13.5px; font-weight: 500; background: var(--navy); color: #fff; cursor: pointer; }
  .crm-submit-btn:hover { filter: brightness(1.3); }
  .crm-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .crm-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--ink-700); }

  .crm-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 50; display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; background: var(--navy); color: #fff; font-size: 13.5px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
  .crm-toast.error { background: var(--red); }
  .crm-toast-undo { background: none; border: 1px solid rgba(255,255,255,0.35); color: #fff; border-radius: 999px; padding: 4px 12px; font-size: 12.5px; cursor: pointer; margin-left: 4px; }
  .crm-toast-undo:hover { background: rgba(255,255,255,0.12); }

  /* ---------- Confirm-selection step (Attendees add / People convert-to-lead) ---------- */
  .crm-confirm-wrap { border: 1px solid var(--line); background: var(--surface); border-radius: 16px; padding: 20px; }
  .crm-confirm-heading { font-size: 14px; font-weight: 600; color: var(--ink-950); margin: 0 0 4px; }
  .crm-confirm-note { font-size: 12.5px; color: var(--ink-400); margin: 0 0 16px; }
  .crm-confirm-summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .crm-confirm-summary-item { font-size: 12.5px; padding: 6px 12px; border-radius: 999px; background: var(--paper); border: 1px solid var(--line); color: var(--ink-700); }
  .crm-confirm-summary-item b { color: var(--ink-950); }
  .crm-confirm-list { border: 1px solid var(--line); border-radius: 12px; overflow-y: auto; max-height: 320px; margin-bottom: 18px; }
  .crm-confirm-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .crm-confirm-row:last-child { border-bottom: none; }
  .crm-confirm-row-name { font-weight: 500; color: var(--ink-950); font-size: 13.5px; }
  .crm-confirm-row-sub { font-size: 12px; color: var(--ink-400); }
  .crm-confirm-actions { display: flex; gap: 10px; }
  .crm-btn-secondary { padding: 10px 18px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-size: 13.5px; font-weight: 500; cursor: pointer; color: var(--ink-700); }
  .crm-btn-secondary:hover { background: var(--paper); }
  .crm-remove-x { width: 26px; height: 26px; border-radius: 7px; border: none; background: transparent; color: var(--ink-400); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .crm-remove-x:hover { background: var(--red-soft); color: var(--red); }
  .crm-confirm-empty { padding: 30px; text-align: center; color: var(--ink-400); font-size: 13.5px; }

  .crm-selection-bar { position: sticky; top: 0; z-index: 6; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--accent-soft); border: 1px solid var(--accent); margin-bottom: 14px; box-shadow: 0 4px 14px rgba(14,111,92,0.12); }
  .crm-selection-bar-count { font-size: 13.5px; font-weight: 600; color: var(--accent-ink); }
  .crm-selection-bar-actions { display: flex; align-items: center; gap: 8px; }
  .crm-selection-confirm-btn { display: flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 10px; border: none; font-size: 13.5px; font-weight: 600; background: var(--accent-ink); color: #fff; cursor: pointer; }
  .crm-selection-confirm-btn:hover { filter: brightness(1.1); }

  /* ---------- Detail pages (Person / Lead) ---------- */
  .crm-detail-wrap { max-width: 720px; }
  .crm-detail-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 4px; }
  .crm-channel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .crm-channel-status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; padding-top: 10px; margin-top: 4px; border-top: 1px solid var(--line); }
  .crm-channel-status-label { font-size: 10.5px; color: var(--ink-400); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 5px; }
  .crm-channel-readonly { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--paper); }
  .crm-channel-readonly-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .crm-channel-note { font-size: 11.5px; color: var(--ink-400); margin-top: 8px; line-height: 1.4; }
  .crm-warn-note { display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; color: var(--amber); background: var(--amber-soft); border-radius: 8px; padding: 6px 9px; margin-top: 6px; }

  /* ---------- Activity timeline (Lead detail) ---------- */
  .crm-activity-list { display: flex; flex-direction: column; }
  .crm-activity-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .crm-activity-item:last-child { border-bottom: none; padding-bottom: 0; }
  .crm-activity-item:first-child { padding-top: 0; }
  .crm-activity-icon { width: 30px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .crm-activity-body { flex: 1; min-width: 0; }
  .crm-activity-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .crm-activity-type { font-size: 13px; font-weight: 600; color: var(--ink-950); }
  .crm-activity-date { font-size: 11.5px; color: var(--ink-400); white-space: nowrap; flex-shrink: 0; }
  .crm-activity-summary { font-size: 12.5px; color: var(--ink-700); margin-top: 3px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* ---------- People page: side-by-side convert-to-lead panel ---------- */
  .crm-split-layout { display: flex; gap: 20px; align-items: flex-start; }
  .crm-split-main { flex: 1; min-width: 0; }
  .crm-split-side { width: 320px; flex-shrink: 0; position: sticky; top: 0; }
  @media (max-width: 980px) { .crm-split-layout { flex-direction: column; } .crm-split-side { width: 100%; position: static; } }
  .crm-side-panel { border: 1px solid var(--line); background: var(--surface); border-radius: 16px; padding: 18px; }
  .crm-channel-toggles { display: flex; gap: 8px; flex-wrap: wrap; }
  .crm-channel-toggle { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent-ink); cursor: pointer; user-select: none; white-space: nowrap; }
  .crm-channel-toggle.off { border-color: var(--line); background: var(--paper); color: var(--ink-400); }
  .crm-channel-toggle.disabled-live { opacity: 0.5; cursor: not-allowed; }

  /* ---------- Quick convert-to-lead modal (person detail page) ---------- */
  .crm-modal-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .crm-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.45); }
  .crm-modal-card { position: relative; background: var(--surface); border-radius: 16px; padding: 24px; width: 100%; max-width: 480px; max-height: 88vh; overflow: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.28); }
`

// ---------------------------------------------------------------------------
// Status/stage badge coloring — purely presentational. Uses keyword matching
// rather than an exact-match whitelist, because the automations (Make.com
// scenarios + the AI cold-calling agent) write values the CRM doesn't fully
// control the vocabulary of (e.g. "email sent", "Not Pitched", "Send Email",
// "sent_to_heyreach"). Exact-match-only badges silently fall through to a
// generic color the moment automation writes something new — keyword
// matching degrades more gracefully.
// ---------------------------------------------------------------------------
function badgeTone(value) {
  const v = (value || '').toLowerCase()

  if (['converted', 'accepted', 'success'].some(k => v === k))
    return { bg: 'var(--accent-ink)', fg: '#fff' }

  if (v.includes('fail') || v.includes('declined') || v === 'unsubscribed')
    return { bg: 'var(--red-soft)', fg: 'var(--red)' }

  if (['not pitched', 'not started', 'new', 'cold', 'waiting'].some(k => v === k))
    return { bg: 'var(--line)', fg: 'var(--ink-700)' }

  if (v.includes('sent') || v.includes('replied') || v.includes('progress') || v.includes('connect') ||
      ['contacted', 'warming', 'outreach', 'responded', 'send email'].some(k => v === k))
    return { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }

  if (!v) return null
  return { bg: 'var(--amber-soft)', fg: 'var(--amber)' }
}
function Badge({ value }) {
  if (!value) return <span style={{ color: 'var(--ink-400)' }}>—</span>
  const tone = badgeTone(value)
  return <span className="crm-badge" style={{ background: tone.bg, color: tone.fg }}>{value}</span>
}

// ---------------------------------------------------------------------------
// Activity timeline helpers — activity_type values are written by the
// Make.com "Email Track Reply" scenario ('email_sent' from the send
// scenario, 'Reply', 'Unsubscribe', 'Email Bounced' from the reply-tracking
// one). Icon/tone mapping degrades gracefully (falls back to a generic
// clock icon + neutral tone) for any future activity_type the automations
// start writing that the CRM doesn't explicitly know about yet.
// ---------------------------------------------------------------------------
const ACTIVITY_ICON_MAP = {
  email_sent: Mail,
  'Reply': MessageSquare,
  'Unsubscribe': Ban,
  'Email Bounced': AlertTriangle,
}
function activityIcon(type) {
  return ACTIVITY_ICON_MAP[type] || History
}
function activityTone(type) {
  if (type === 'Email Bounced') return { bg: 'var(--red-soft)', fg: 'var(--red)' }
  if (type === 'Unsubscribe') return { bg: 'var(--amber-soft)', fg: 'var(--amber)' }
  if (type === 'Reply') return { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }
  return { bg: 'var(--line)', fg: 'var(--ink-700)' }
}

// Sticky bar that appears the instant one or more rows are selected, pinned
// to the top of the scroll area, so the "review & confirm" action never
// requires scrolling past the candidate table to find it.
function SelectionBar({ count, noun = 'selected', label, onConfirm }) {
  if (count === 0) return null
  return (
    <div className="crm-selection-bar">
      <span className="crm-selection-bar-count">{count} {noun}</span>
      <div className="crm-selection-bar-actions">
        <button className="crm-selection-confirm-btn" onClick={onConfirm}>
          <Check size={15} /> {label}
        </button>
      </div>
    </div>
  )
}

// Shared review step: show exactly who's about to be affected and the bulk
// field values that will be applied, let the person drop individuals before
// committing, then Confirm or go Back to keep adjusting the selection.
function ConfirmSelectionPanel({ heading, note, items, summary, onRemove, onConfirm, onBack, confirming, confirmLabel }) {
  return (
    <div className="crm-confirm-wrap">
      <h4 className="crm-confirm-heading">{heading}</h4>
      {note && <p className="crm-confirm-note">{note}</p>}

      {summary && summary.length > 0 && (
        <div className="crm-confirm-summary">
          {summary.map((s, i) => (
            <span key={i} className="crm-confirm-summary-item">{s.label}: <b>{s.value}</b></span>
          ))}
        </div>
      )}

      <div className="crm-confirm-list">
        {items.map(item => (
          <div key={item.id} className="crm-confirm-row">
            <div>
              <div className="crm-confirm-row-name">{item.primary}</div>
              {item.secondary && <div className="crm-confirm-row-sub">{item.secondary}</div>}
              {item.warning && <div className="crm-warn-note"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />{item.warning}</div>}
            </div>
            <button className="crm-remove-x" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.primary}`}>
              <X size={14} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="crm-confirm-empty">Nothing left selected — go back to pick people.</div>}
      </div>

      <div className="crm-confirm-actions">
        <button className="crm-btn-secondary" onClick={onBack}>Back to editing</button>
        <button className="crm-submit-btn" style={{ width: 'auto', padding: '10px 20px' }} onClick={onConfirm} disabled={items.length === 0 || confirming}>
          {confirming ? <Loader2 size={15} className="crm-spin" /> : <Check size={15} />}
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

// Builds the actual DB row fields for the channels that are effectively "on"
// for a given person, following the confirmed Make.com contract: set the
// boolean true and leave the stage column NULL. Never write a placeholder
// string like 'Not started' into a stage column — that's what silently hides
// leads from the Make.com scenarios that key off IS NULL.
function buildChannelRowFields(effectiveOnFn, subjectKey) {
  const fields = {}
  CHANNEL_FIELDS.forEach(cf => {
    if (!cf.live) return 
    if (effectiveOnFn(subjectKey, cf.key)) {
      fields[cf.boolKey] = true
      fields[cf.key] = null
    }
  })
  return fields
}

// Warnings shown when a person is missing what a live channel's Make.com
// scenario actually requires to pick the lead up at all. Cold calling's
// query INNER JOINs companies and requires COALESCE(mobile, phone) IS NOT
// NULL — a lead can be created "successfully" and still be permanently
// invisible to that scenario if these are missing.
function channelReadinessWarning(person, channelKey) {
  if (channelKey === 'cold_calling_stage') {
    const missing = []
    if (!person.mobile && !person.phone) missing.push('no phone number')
    if (!person.company_id) missing.push('no company linked')
    if (missing.length > 0) return `Cold calling won't reach them yet — ${missing.join(', ')}.`
  }
  return null
}

async function resolveCompanyId(companyInput) {
  if (!companyInput) return { companyId: null, error: null }

  if (companyInput.company_id) {
    const { error } = await supabase
      .from('companies')
      .update({
        company_name: companyInput.company_name?.trim() || null,
        country: companyInput.country?.trim() || null,
      })
      .eq('company_id', companyInput.company_id)
    if (error) return { companyId: null, error }
    return { companyId: companyInput.company_id, error: null }
  }

  const name = companyInput.company_name?.trim()
  if (!name) return { companyId: null, error: null }

  const { data: existing, error: lookupError } = await supabase
    .from('companies')
    .select('company_id')
    .ilike('company_name', name)
    .limit(1)
    .maybeSingle()
  if (lookupError) return { companyId: null, error: lookupError }

  if (existing) {
    return { companyId: existing.company_id, error: null }
  }

  const { data: created, error: createError } = await supabase
    .from('companies')
    .insert({ company_name: name, country: companyInput.country?.trim() || null })
    .select('company_id')
    .single()
  if (createError) return { companyId: null, error: createError }
  return { companyId: created.company_id, error: null }
}
// Small modal used for the "single-person, fully editable" convert-to-lead
// flow from a person's detail page. Pre-filled with sane defaults; every
// field stays editable before it writes anything. Channel selection is a
// simple on/off toggle per channel (matching the bulk flow and the Make.com
// contract) rather than a free-text stage picker — the CRM should never be
// the one inventing a starting stage value.
function QuickConvertModal({ person, onClose, onConfirm, creating }) {
  const [form, setForm] = useState({
    lead_purpose: '',
    lead_status: 'New',
    nurture_stage: 'Outreach',
    owner: '',
    notes: '',
  })
  const [channels, setChannels] = useState(ALL_CHANNELS_ON)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const toggleChannel = (key) => setChannels(prev => ({ ...prev, [key]: !prev[key] }))

  const warnings = CHANNEL_FIELDS
    .filter(cf => cf.live && channels[cf.key])
    .map(cf => channelReadinessWarning(person, cf.key))
    .filter(Boolean)

  return (
    <div className="crm-modal-overlay">
      <div className="crm-modal-backdrop" onClick={onClose} />
      <div className="crm-modal-card">
        <h4 className="crm-confirm-heading">Convert {person.first_name} {person.last_name} to a lead</h4>
        <p className="crm-confirm-note">Defaults are pre-filled — adjust anything before creating.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="crm-form-row">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select className="crm-select" value={form.lead_status} onChange={set('lead_status')}>
                {LEAD_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Nurture stage</FieldLabel>
              <select className="crm-select" value={form.nurture_stage} onChange={set('nurture_stage')}>
                {NURTURE_STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="crm-form-row">
            <div><FieldLabel>Purpose</FieldLabel><input className="crm-input" value={form.lead_purpose} onChange={set('lead_purpose')} placeholder="e.g. Outreach" /></div>
            <div><FieldLabel>Owner</FieldLabel><input className="crm-input" value={form.owner} onChange={set('owner')} /></div>
          </div>

          <div>
            <FieldLabel>Outreach channels</FieldLabel>
            <div className="crm-channel-toggles">
              {CHANNEL_FIELDS.map(cf => (
                <button
                  key={cf.key}
                  type="button"
                  disabled={!cf.live}
                  className={`crm-channel-toggle${channels[cf.key] ? '' : ' off'}${!cf.live ? ' disabled-live' : ''}`}
                  onClick={() => cf.live && toggleChannel(cf.key)}
                  title={!cf.live ? 'Not wired to an active automation yet' : undefined}
                >
                  {channels[cf.key] ? <Check size={11} /> : <X size={11} />} {cf.label}{!cf.live ? ' (inactive)' : ''}
                </button>
              ))}
            </div>
            {warnings.map((w, i) => (
              <div key={i} className="crm-warn-note"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />{w}</div>
            ))}
          </div>

          <div><FieldLabel>Notes</FieldLabel><textarea className="crm-textarea" value={form.notes} onChange={set('notes')} /></div>
        </div>

        <div className="crm-confirm-actions" style={{ marginTop: 18 }}>
          <button className="crm-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="crm-submit-btn"
            style={{ width: 'auto', padding: '10px 20px' }}
            onClick={() => onConfirm({ ...form, ...buildChannelRowFields((_, key) => channels[key], null) })}
            disabled={creating}
          >
            {creating ? <Loader2 size={15} className="crm-spin" /> : <Check size={15} />} Create lead
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [activePage, setActivePage] = useState('people')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [toast, setToast] = useState(null) // { message, error, onUndo }

  const [leadEventMap, setLeadEventMap] = useState(new Map())
const fetchLeadEventMap = useCallback(async () => {
  const PAGE = 1000
  let allRows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('person_id, event_id')
      .range(from, from + PAGE - 1)
    if (error) return
    allRows = allRows.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  const map = new Map()
  allRows.forEach(r => {
    const key = r.event_id || 'NONE'
    if (!map.has(r.person_id)) map.set(r.person_id, new Set())
    map.get(r.person_id).add(key)
  })
  setLeadEventMap(map)
}, [])
  useEffect(() => { fetchLeadEventMap() }, [fetchLeadEventMap])

  // Called by any conversion flow (bulk from People, or single from Person
  // detail) right after a lead row is successfully inserted, so every flow
  // updates the SAME map that PeoplePage reads from to hide converted people.
  const addToLeadEventMap = useCallback((personId, eventId) => {
    setLeadEventMap(prev => {
      const next = new Map(prev)
      const key = eventId || 'NONE'
      const set = new Set(next.get(personId) || [])
      set.add(key)
      next.set(personId, set)
      return next
    })
  }, [])

  // Called by undo handlers after a lead row is deleted, so undo correctly
  // brings the person back into the People page.
  const removeFromLeadEventMap = useCallback((personId, eventId) => {
    setLeadEventMap(prev => {
      const next = new Map(prev)
      const key = eventId || 'NONE'
      const set = new Set(next.get(personId) || [])
      set.delete(key)
      if (set.size === 0) next.delete(personId)
      else next.set(personId, set)
      return next
    })
  }, [])

  // detail = null | { type: 'person' | 'lead', id }
  // When set, a full-page detail view replaces the current page's content.
  const [detail, setDetail] = useState(null)
  useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  const personId = params.get('person')
  if (personId) {
    setDetail({ type: 'person', id: /^\d+$/.test(personId) ? Number(personId) : personId })
  }
}, [])
  const openPerson = (id) => setDetail({ type: 'person', id })
  const openLead = (id) => setDetail({ type: 'lead', id })
  const closeDetail = () => setDetail(null)

  const showToast = (message, error = false, onUndo = null) => setToast({ message, error, onUndo })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.onUndo ? 8000 : 2600)
    return () => clearTimeout(t)
  }, [toast])

  const goTo = (key) => { setActivePage(key); setDetail(null); setMobileOpen(false) }

  const pageMeta = detail
    ? {
        title: detail.type === 'person' ? 'Person details' : 'Lead details',
        sub: 'Full record — view, edit, and save changes below',
      }
    : {
        people: { title: 'People', sub: 'All contacts synced from Supabase' },
        leads: { title: 'Leads', sub: 'Every lead across every channel' },
        events: { title: 'Events', sub: 'Events and who attended them' },
        attendees: { title: 'Attendees', sub: 'Manage who is attached to each event' },
        create: { title: 'Create', sub: 'Add a new event or person' },
      }[activePage]

  return (
    <div className="crm-root">
      <style>{CSS}</style>

      <aside className={`crm-sidebar${collapsed ? ' collapsed' : ''}`}>
        <SidebarContent collapsed={collapsed} setCollapsed={setCollapsed} activePage={activePage} goTo={goTo} />
      </aside>

      <div className={`crm-drawer-overlay${mobileOpen ? ' open' : ''}`}>
        <div className="crm-drawer-backdrop" onClick={() => setMobileOpen(false)} />
        <aside className="crm-drawer-panel">
          <SidebarContent collapsed={false} setCollapsed={setCollapsed} activePage={activePage} goTo={goTo} onCloseMobile={() => setMobileOpen(false)} />
        </aside>
      </div>

      <div className="crm-main">
        <header className="crm-header">
          <div className="crm-header-left">
            {detail ? (
              <button className="crm-back-btn" onClick={closeDetail} aria-label="Back">
                <ArrowLeft size={18} />
              </button>
            ) : (
              <button className="crm-mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
                <Menu size={18} />
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <h2 className="crm-page-title crm-display">{pageMeta.title}</h2>
              <p className="crm-page-sub">{pageMeta.sub}</p>
            </div>
          </div>
          <div className="crm-header-right">
            <button className="crm-icon-btn" style={{ color: 'var(--ink-700)' }} onClick={() => supabase.auth.signOut()} aria-label="Log out">
            <LogOut size={18} />
           </button>
         </div>
        </header>

        <main className="crm-content">
          {detail && detail.type === 'person' && (
            <PersonDetailPage
              personId={detail.id}
              showToast={showToast}
              onOpenLead={openLead}
              onLeadCreated={addToLeadEventMap}
              onLeadRemoved={removeFromLeadEventMap}
            />
          )}
          {detail && detail.type === 'lead' && (
            <LeadDetailPage leadId={detail.id} showToast={showToast} onOpenPerson={openPerson} />
          )}
          {activePage === 'people' && (
         <div style={{ display: detail ? 'none' : 'block' }}>
           <PeoplePage
             showToast={showToast}
             onOpenPerson={openPerson}
             sidebarCollapsed={collapsed}
             setSidebarCollapsed={setCollapsed}
           />
          </div>
          )}
          {!detail && activePage === 'leads' && <LeadsPage showToast={showToast} onOpenLead={openLead} />}
          {!detail && activePage === 'events' && <EventsPage showToast={showToast} />}
          {!detail && activePage === 'attendees' && <AttendeesPage showToast={showToast} />}
          {!detail && activePage === 'create' && <CreatePage showToast={showToast} />}
        </main>
      </div>

      {toast && (
        <div className={`crm-toast${toast.error ? ' error' : ''}`}>
          <Check size={15} style={{ color: toast.error ? '#fff' : '#7FD1B9' }} />
          {toast.message}
          {toast.onUndo && (
            <button className="crm-toast-undo" onClick={() => { toast.onUndo(); setToast(null) }}>Undo</button>
          )}
        </div>
      )}
    </div>
  )
}

function SidebarContent({ collapsed, setCollapsed, activePage, goTo, onCloseMobile }) {
  return (
    <>
      <div className="crm-sidebar-head">
        {!collapsed && <span className="crm-logo">Connectiva<span>CRM</span></span>}
        {collapsed && <div className="crm-logo-dot" />}
        {onCloseMobile ? (
          <button className="crm-icon-btn" onClick={onCloseMobile} aria-label="Close menu"><X size={18} /></button>
        ) : (
          <button className="crm-icon-btn" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar"><Menu size={16} /></button>
        )}
      </div>
      <nav className="crm-nav">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const active = activePage === key
          return (
            <button key={key} onClick={() => goTo(key)} className={`crm-nav-btn${collapsed ? ' collapsed' : ''}${active ? ' active' : ''}`} title={collapsed ? label : undefined}>
              <Icon size={18} strokeWidth={2} />
              {!collapsed && <span>{label}</span>}
            </button>
          )
        })}
      </nav>
      <div className="crm-sidebar-foot">© ConnectivaCRM</div>
    </>
  )
}

// ============================================================================
// PEOPLE — live data, search, pagination. Display-only by default:
//  - clicking a row opens the full Person detail page
//  - a pencil icon on the row opens a lightweight inline edit for that one row
//  - a prominent "Convert to lead" button switches the whole table into a
//    multi-select mode (checkboxes + sticky selection bar + confirm step),
//    mirroring the Attendees "add people" flow, with sensible bulk defaults.
//
// Industry replaces Company as the primary at-a-glance column here — company
// name still exists on the record (via company_id) but isn't the thing
// people scan this table for; industry (Insurance / Banking / Finance) is,
// and it's filterable.
// ============================================================================
function PeoplePage({
  showToast,
  onOpenPerson,
  sidebarCollapsed,
  setSidebarCollapsed,
}) {
  const [people, setPeople] = useState([])
  const [leadPersonIds, setLeadPersonIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [peoplePage, setPeoplePage] = useState(1)

  const STATUS_OPTIONS = useMemo(() => {
    const set = new Set(people.map(p => p.status).filter(Boolean))
    return Array.from(set).sort()
  }, [people])

  const LEAD_PURPOSE_OPTIONS = useMemo(() => {
    const set = new Set(people.map(p => p.lead_purpose).filter(Boolean))
    return Array.from(set).sort()
  }, [people])

  const COMBINED_PURPOSE_OPTIONS = useMemo(() => {
    const set = new Set([...LEAD_PURPOSE_CHOICES, ...LEAD_PURPOSE_OPTIONS])
    return Array.from(set).sort()
  }, [LEAD_PURPOSE_OPTIONS])

  const [columnFilters, setColumnFilters] = useState({
    name: '',
    email: '',
    email1: '',
    job_title: '',
    industry: '',
    company: '',
    country: '',
    status: '',
  })

  const [leadPurposeFilter, setLeadPurposeFilter] = useState('')

  const setColFilter = (key) => (e) =>
    setColumnFilters(prev => ({
      ...prev,
      [key]: e.target.value,
    }))

  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [linkEventId, setLinkEventId] = useState('')

  const [pastEventsByPerson, setPastEventsByPerson] = useState({})
  const [pastEventsLoading, setPastEventsLoading] = useState(true)

  const [activeEventId, setActiveEventId] = useState(null)
  const [activeEventLoading, setActiveEventLoading] = useState(true)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editCompany, setEditCompany] = useState(null)

const [expandedPersonId, setExpandedPersonId] = useState(null)
const [leadPurposeDraft, setLeadPurposeDraft] = useState('')
const [savingLeadPurpose, setSavingLeadPurpose] = useState(false)

const toggleExpand = (p) => {
  if (expandedPersonId === p.person_id) {
    setExpandedPersonId(null)
  } else {
    setExpandedPersonId(p.person_id)
    setLeadPurposeDraft(p.lead_purpose || '')
  }
}

const saveLeadPurpose = async (personId) => {
  setSavingLeadPurpose(true)
  const { error } = await supabase
    .from('people')
    .update({ lead_purpose: leadPurposeDraft || null, updated_at: new Date().toISOString() })
    .eq('person_id', personId)
  setSavingLeadPurpose(false)
  if (error) { showToast(`Couldn't save: ${error.message}`, true); return }
  setPeople(prev => prev.map(p => p.person_id === personId ? { ...p, lead_purpose: leadPurposeDraft || null } : p))
  showToast('Lead purpose updated')
  setExpandedPersonId(null)
}
  
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null) // person object | null
  const [deleting, setDeleting] = useState(false)

  const [mode, setMode] = useState('browse')
  const [selectedPersonIds, setSelectedPersonIds] = useState(new Set())
  const [converting, setConverting] = useState(false)

  const [channelDefaults, setChannelDefaults] = useState(ALL_CHANNELS_ON)
  const [channelExceptions, setChannelExceptions] = useState(new Map())

  const wasSidebarCollapsedRef = useRef(sidebarCollapsed)

  // ============================================================
  // FETCH PEOPLE
  // ============================================================

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    setError(null)

    const PAGE = 1000
    let allRows = []
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('people')
        .select('*, companies(company_name, country)')
        .order('created_at', { ascending: false })
        .order('person_id', { ascending: true })
        .range(from, from + PAGE - 1)

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      allRows = allRows.concat(data || [])

      if (!data || data.length < PAGE) break

      from += PAGE
    }

    setPeople(allRows)
    setLoading(false)
  }, [])

  // ============================================================
  // FETCH ALL PEOPLE WHO HAVE ANY LEAD
  //
  // IMPORTANT:
  // No event_id filter here.
  //
  // If a person exists in the leads table even once,
  // they are considered a lead and will be hidden from People.
  // ============================================================

  const fetchLeadPersonIds = useCallback(async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('person_id')

    if (error) {
      setError(error.message)
      return
    }

    const ids = new Set(
      (data || [])
        .map(row => row.person_id)
        .filter(Boolean)
    )

    setLeadPersonIds(ids)
  }, [])

  // ============================================================
  // FETCH EVENTS
  // ============================================================

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true)

    const { data, error } = await supabase
      .from('events')
      .select('event_id, event_name, start_date')
      .order('start_date', { ascending: false })

    if (!error) {
      setEvents(data || [])
    }

    setEventsLoading(false)
  }, [])

  // ============================================================
  // FETCH PAST EVENTS
  // ============================================================

  const fetchPastEvents = useCallback(async () => {
    setPastEventsLoading(true)

    const { data, error } = await supabase
      .from('event_participants')
      .select(
        'person_id, role, status, events(event_id, event_name, start_date)'
      )
      .order('start_date', {
        ascending: false,
        foreignTable: 'events',
      })

    if (!error) {
      const map = {}

      ;(data || []).forEach(row => {
        if (!row.events) return

        if (!map[row.person_id]) {
          map[row.person_id] = []
        }

        map[row.person_id].push({
          event_id: row.events.event_id,
          event_name: row.events.event_name,
          start_date: row.events.start_date,
          role: row.role,
          status: row.status,
        })
      })

      setPastEventsByPerson(map)
    }

    setPastEventsLoading(false)
  }, [])

  // ============================================================
  // FETCH ACTIVE EVENT
  // ============================================================

  const fetchActiveEventId = useCallback(async () => {
    setActiveEventLoading(true)

    const { data, error } = await supabase
      .from('events')
      .select('event_id')
      .eq('status', 'Active')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error) {
      setActiveEventId(data?.event_id || null)
    }

    setActiveEventLoading(false)
  }, [])

  // ============================================================
  // INITIAL LOAD
  // ============================================================

  useEffect(() => {
    fetchPeople()
    fetchLeadPersonIds()
    fetchEvents()
    fetchPastEvents()
    fetchActiveEventId()
  }, [
    fetchPeople,
    fetchLeadPersonIds,
    fetchEvents,
    fetchPastEvents,
    fetchActiveEventId,
  ])

  // ============================================================
  // PEOPLE FILTER
  //
  // THIS IS THE IMPORTANT PART:
  //
  // If person_id exists in leads AT ALL,
  // don't show that person in People.
  // ============================================================

  const filtered = useMemo(() => {
    const f = columnFilters

    const name = f.name.toLowerCase().trim()
    const email = f.email.toLowerCase().trim()
    const email1 = f.email1.toLowerCase().trim()
    const jt = f.job_title.toLowerCase().trim()
    const company = f.company.toLowerCase().trim()
    const country = f.country.toLowerCase().trim()

    return people.filter(p => {

      // 🚫 ANY lead = NOT a People record anymore
      if (leadPersonIds.has(p.person_id)) {
        return false
      }

      const companyName = p.companies?.company_name || ''

      if (
        name &&
        !`${p.first_name} ${p.last_name}`
          .toLowerCase()
          .includes(name)
      ) {
        return false
      }

      if (
        email &&
        !(p.email || '')
          .toLowerCase()
          .includes(email)
      ) {
        return false
      }

      if (
        email1 &&
         !(p.email1 || '')
          .toLowerCase()
          .includes(email1)
     ) {
        return false
     } 
      
      if (
        jt &&
        !(p.job_title || '')
          .toLowerCase()
          .includes(jt)
      ) {
        return false
      }

      if (
        f.industry &&
        p.industry !== f.industry
      ) {
        return false
      }

      if (
        company &&
        !companyName
          .toLowerCase()
          .includes(company)
      ) {
        return false
      }

      if (
        country &&
        !(p.country || '')
          .toLowerCase()
          .includes(country)
      ) {
        return false
      }

      if (
        f.status &&
        p.status !== f.status
      ) {
        return false
      }

      if (
        leadPurposeFilter &&
        p.lead_purpose !== leadPurposeFilter
      ) {
        return false
      }

      return true
    })
  }, [
    people,
    columnFilters,
    leadPurposeFilter,
    leadPersonIds,
  ])

  useEffect(() => {
    setPeoplePage(1)
  }, [columnFilters, leadPurposeFilter])

  // ============================================================
  // EDIT PERSON
  // ============================================================

  const startEdit = (p) => {
    setEditingId(p.person_id)

    setEditForm({
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      email: p.email || '',
      email1: p.email1 || '',
      job_title: p.job_title || '',
      country: p.country || '',
      status: p.status || '',
      industry: p.industry || '',
      linkedin_url: p.linkedin_url || '',
    })

    setEditCompany(
      p.companies
        ? {
            company_id: p.company_id,
            company_name: p.companies.company_name,
            country: p.companies.country || '',
          }
        : null
    )
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm(null)
    setEditCompany(null)
  }

 const saveEdit = async (personId) => {
  setSaving(true)

  const { companyId, error: companyError } = await resolveCompanyId(editCompany)
  if (companyError) {
    setSaving(false)
    showToast(`Couldn't save company: ${companyError.message}`, true)
    return
  }

  const { error } = await supabase
    .from('people')
    .update({
      ...editForm,
      email: editForm.email?.trim() || null,
      email1: editForm.email1?.trim() || null,
      company_id: companyId,
      updated_at: new Date().toISOString(),
    })
    .eq('person_id', personId)

  setSaving(false)

  if (error) {
    showToast(`Couldn't save: ${error.message}`, true)
    return
  }

  setPeople(prev =>
    prev.map(p =>
      p.person_id === personId
        ? {
            ...p,
            ...editForm,
            company_id: companyId,
            companies: editCompany
              ? { company_name: editCompany.company_name, country: editCompany.country }
              : null,
          }
        : p
    )
  )

  setEditingId(null)
  setEditForm(null)
  setEditCompany(null)
  showToast('Person updated')
}
  // ============================================================
  // DELETE PERSON
  // ============================================================

  const deletePerson = async (person) => {
    setDeleting(true)
    const { error } = await supabase
      .from('people')
      .delete()
      .eq('person_id', person.person_id)
    setDeleting(false)

    if (error) {
      showToast(`Couldn't delete: ${error.message}`, true)
      return
    }

    setPeople(prev => prev.filter(p => p.person_id !== person.person_id))
    setLeadPersonIds(prev => {
      if (!prev.has(person.person_id)) return prev
      const next = new Set(prev)
      next.delete(person.person_id)
      return next
    })
    if (editingId === person.person_id) cancelEdit()
    setDeleteTarget(null)
    showToast('Person deleted')
  }

  // ============================================================
  // START CONVERT
  // ============================================================

  const startConvert = () => {
    if (!leadPurposeFilter) {
      showToast(
        'Pick a purpose from the dropdown first',
        true
      )
      return
    }

    wasSidebarCollapsedRef.current =
      sidebarCollapsed

    setSidebarCollapsed(true)
    setMode('select')
    setSelectedPersonIds(new Set())
    setChannelDefaults(ALL_CHANNELS_ON)
    setChannelExceptions(new Map())
    setLinkEventId('')
    cancelEdit()
  }

  const cancelConvert = () => {
    setSidebarCollapsed(
      wasSidebarCollapsedRef.current
    )

    setMode('browse')
    setSelectedPersonIds(new Set())
    setChannelExceptions(new Map())
  }

  // ============================================================
  // SELECTION
  // ============================================================

  const togglePerson = (personId) => {
    // This should normally never happen because filtered already
    // removes every person who has a lead.
    if (leadPersonIds.has(personId)) return

    setSelectedPersonIds(prev => {
      const next = new Set(prev)

      if (next.has(personId)) {
        next.delete(personId)
      } else {
        next.add(personId)
      }

      return next
    })
  }

  const removeFromSelection = (personId) => {
    togglePerson(personId)

    setChannelExceptions(prev => {
      if (!prev.has(personId)) {
        return prev
      }

      const next = new Map(prev)
      next.delete(personId)

      return next
    })
  }

  const selectAllFiltered = () => {
    setSelectedPersonIds(
      new Set(
        filtered.map(p => p.person_id)
      )
    )
  }

  const selectAllOnPage = () => {
    const pageIds = paginate(
      filtered,
      peoplePage
    ).map(p => p.person_id)

    setSelectedPersonIds(
      prev => new Set([
        ...prev,
        ...pageIds,
      ])
    )
  }

  const clearSelection = () => {
    setSelectedPersonIds(new Set())
    setChannelExceptions(new Map())
  }

  const handleLinkEventChange = (e) => {
    setLinkEventId(e.target.value)
  }

  // ============================================================
  // CHANNELS
  // ============================================================

  const toggleChannelDefault = (key) => {
    const cf = CHANNEL_FIELDS.find(
      c => c.key === key
    )

    if (!cf?.live) return

    setChannelDefaults(prev => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const toggleChannelException = (
    personId,
    key
  ) => {
    const cf = CHANNEL_FIELDS.find(
      c => c.key === key
    )

    if (!cf?.live) return

    setChannelExceptions(prev => {
      const next = new Map(prev)

      const set = new Set(
        next.get(personId) || []
      )

      if (set.has(key)) {
        set.delete(key)
      } else {
        set.add(key)
      }

      next.set(personId, set)

      return next
    })
  }

  const effectiveChannelValue = (
    personId,
    key
  ) => {
    const isException =
      channelExceptions
        .get(personId)
        ?.has(key)

    return isException
      ? !channelDefaults[key]
      : channelDefaults[key]
  }

  // ============================================================
  // CONVERT TO LEAD
  // ============================================================

  const submitConvert = async () => {
    setConverting(true)

    const selectedPeople =
      people.filter(p =>
        selectedPersonIds.has(
          p.person_id
        )
      )

    const rows = selectedPeople.map(p => ({
      person_id: p.person_id,
      company_id: p.company_id || null,

      // IMPORTANT:
      // Event is optional and dynamic.
      // NO hardcoded BANCEE26.
      event_id: linkEventId || null,

      lead_status: 'New',
      nurture_stage: 'Outreach',
      lead_purpose: leadPurposeFilter,

      ...buildChannelRowFields(
        effectiveChannelValue,
        p.person_id
      ),
    }))

    const {
      data: inserted,
      error,
    } = await supabase
      .from('leads')
      .insert(rows)
      .select('lead_id, person_id')

    setConverting(false)

    if (error) {
      showToast(
        `Couldn't create leads: ${error.message}`,
        true
      )
      return
    }

    // ==========================================================
    // IMPORTANT:
    // Immediately mark these people as leads.
    //
    // This makes them disappear from People without
    // requiring a page refresh.
    // ==========================================================

setLeadPersonIds(prev => {
  const next = new Set(prev)
  rows.forEach(row => {
    next.add(row.person_id)
  })
  return next
})

fetchPeople()
fetchLeadPersonIds()
    
const newLeadIds = (inserted || []).map(r => r.lead_id)
const count = rows.length

showToast(
  `${count} ${count === 1 ? 'lead' : 'leads'} created`,
  false,
  newLeadIds.length > 0
    ? async () => {
        const { error: undoError } = await supabase
          .from('leads')
          .delete()
          .in('lead_id', newLeadIds)

        if (undoError) {
          showToast(`Couldn't undo: ${undoError.message}`, true)
          return
        }

            // Put them back into People
            // because their lead was removed.
            setLeadPersonIds(prev => {
              const next = new Set(prev)

              rows.forEach(row => {
                next.delete(
                  row.person_id
                )
              })

              return next
            })

           fetchPeople()
        fetchLeadPersonIds()

        showToast(`Undone — ${count} ${count === 1 ? 'lead' : 'leads'} removed`)
      }
    : null
    )

    setSidebarCollapsed(
      wasSidebarCollapsedRef.current
    )

    setMode('browse')
    setSelectedPersonIds(new Set())
    setChannelExceptions(new Map())
  }

  const selecting = mode === 'select'

  const COLUMN_COUNT =
    selecting ? 12 : 11

  // ============================================================
  // TABLE
  // ============================================================

  const table = (
    <div>
      <div className="crm-toolbar">

        {selecting ? (
          <>
            <select
              className="crm-filter-select"
              value={linkEventId}
              onChange={handleLinkEventChange}
              disabled={eventsLoading}
            >

              {events.map(e => (
                <option
                  key={e.event_id}
                  value={e.event_id}
                >
                  {e.event_name} (
                  {formatDate(e.start_date)}
                  )
                </option>
              ))}
            </select>

            <button
              className="crm-toggle-chip"
              onClick={selectAllOnPage}
            >
              Select all on this page
            </button>

            {selectedPersonIds.size > 0 && (
              <button
                className="crm-toggle-chip"
                onClick={clearSelection}
              >
                Clear selection
              </button>
            )}

            <button
              className="crm-btn-secondary"
              onClick={cancelConvert}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <select
              className="crm-filter-select"
              value={leadPurposeFilter}
              onChange={e =>
                setLeadPurposeFilter(
                  e.target.value
                )
              }
            >
              <option value="">
                Select purpose…
              </option>

              {COMBINED_PURPOSE_OPTIONS.map(
                p => (
                  <option
                    key={p}
                    value={p}
                  >
                    {p}
                  </option>
                )
              )}
            </select>

            <button
              className="crm-submit-btn"
              style={{
                width: 'auto',
                padding: '10px 18px',
              }}
              onClick={startConvert}
            >
              <UserPlus size={15} />
              Convert to lead
            </button>
          </>
        )}

        <span className="crm-count-note">
          {filtered.length} of {people.length}
        </span>
      </div>

      {loading && (
        <div className="crm-loading">
          <Loader2
            size={16}
            className="crm-spin"
          />
          Loading people…
        </div>
      )}

      {error && (
        <div className="crm-error">
          Couldn't load people: {error}
        </div>
      )}

      {!loading && !error && (
        <div className="crm-table-wrap">
          <table className="crm-table">

            <thead>
              <tr>
                {selecting && (
                  <th style={{ width: 36 }} />
                )}

                {selecting && (
                  <th style={{ width: 76 }} />
                )}

                <th>Name</th>
                <th>Email</th>
                <th>Email 1</th>
                <th>Job title</th>
                <th>Industry</th>
                <th>Company</th>
                <th>Country</th>
                <th>LinkedIn</th>
                <th>Status</th>
                <th>Past Events</th>

                {!selecting && <th />}
              </tr>

              <tr>
                {selecting && <th />}
                {selecting && <th />}

                <th>
                  <input
                    className="crm-cell-input"
                    value={columnFilters.name}
                    onChange={setColFilter('name')}
                    placeholder="Filter…"
                  />
                </th>

                <th>
                  <input
                    className="crm-cell-input"
                    value={columnFilters.email}
                    onChange={setColFilter('email')}
                    placeholder="Filter…"
                  />
                </th>
                <th>
               <input 
                   className="crm-cell-input" 
                   value={columnFilters.email1} 
                   onChange={setColFilter('email1')} 
                   placeholder="Filter…" 
                 />
                </th>

                <th>
                  <input
                    className="crm-cell-input"
                    value={columnFilters.job_title}
                    onChange={setColFilter('job_title')}
                    placeholder="Filter…"
                  />
                </th>

                <th>
                  <select
                    className="crm-cell-select"
                    value={columnFilters.industry}
                    onChange={setColFilter('industry')}
                  >
                    <option value="">
                      All
                    </option>

                    {INDUSTRY_OPTIONS.map(i => (
                      <option
                        key={i}
                        value={i}
                      >
                        {i}
                      </option>
                    ))}
                  </select>
                </th>

                <th>
                  <input
                    className="crm-cell-input"
                    value={columnFilters.company}
                    onChange={setColFilter('company')}
                    placeholder="Filter…"
                  />
                </th>

                <th>
                  <input
                    className="crm-cell-input"
                    value={columnFilters.country}
                    onChange={setColFilter('country')}
                    placeholder="Filter…"
                  />
                </th>

                <th />

                <th>
                  <select
                    className="crm-cell-select"
                    value={columnFilters.status}
                    onChange={setColFilter('status')}
                  >
                    <option value="">
                      All
                    </option>

                    {STATUS_OPTIONS.map(s => (
                      <option
                        key={s}
                        value={s}
                      >
                        {s}
                      </option>
                    ))}
                  </select>
                </th>

                <th />

                {!selecting && <th />}
              </tr>
            </thead>

            <tbody>
              {paginate(
                filtered,
                peoplePage
              ).map(p => {

                const av = avatarStyle(
                  p.first_name +
                    p.last_name
                )

                // This should normally always be false
                // because filtered already excludes leads.
                const alreadyLead =
                  leadPersonIds.has(
                    p.person_id
                  )

      const isEditing = editingId === p.person_id

const history = pastEventsByPerson[p.person_id] || []

const pastEventsCell = (
  <td>
    {pastEventsLoading ? (
      <span className="crm-muted">…</span>
    ) : history.length === 0 ? (
      <span className="crm-muted">—</span>
    ) : (
      history.map(h => h.event_id).join(', ')
    )}
  </td>
)

if (isEditing) {
  return (
    <tr key={p.person_id} className="editing">
      {selecting && <td />}
      {selecting && <td />}

      <td>
        <input
          className="crm-cell-input"
          value={editForm.first_name}
          onChange={e => setEditForm({ ...editForm, first_name: e.target.value })}
          placeholder="First name"
        />
        <input
          className="crm-cell-input"
          value={editForm.last_name}
          onChange={e => setEditForm({ ...editForm, last_name: e.target.value })}
          placeholder="Last name"
        />
      </td>

      <td>
        <input
          className="crm-cell-input"
          value={editForm.email}
          onChange={e => setEditForm({ ...editForm, email: e.target.value })}
        />
      </td>
      <td>
        <input
          className="crm-cell-input"
          value={editForm.email1}
          onChange={e => setEditForm({ ...editForm, email1: e.target.value })}
        />
      </td>

      <td>
        <input
          className="crm-cell-input"
          value={editForm.job_title}
          onChange={e => setEditForm({ ...editForm, job_title: e.target.value })}
        />
      </td>

      <td>
        <select
          className="crm-cell-select"
          value={editForm.industry}
          onChange={e => setEditForm({ ...editForm, industry: e.target.value })}
        >
          <option value="">—</option>
          {INDUSTRY_OPTIONS.map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </td>

      <td>
        <CompanyPicker
          value={editCompany}
          onChange={setEditCompany}
          showToast={showToast}
        />
      </td>

      <td>
        <input
          className="crm-cell-input"
          value={editForm.country}
          onChange={e => setEditForm({ ...editForm, country: e.target.value })}
        />
      </td>

      {/* LinkedIn — now the single, editable column. The old read-only
          <a> link that used to live here was removed: having both was
          adding an extra column that pushed everything after it (Status,
          Past Events, actions) out of alignment with the header row. */}
      <td>
        <input
          className="crm-cell-input"
          value={editForm.linkedin_url}
          onChange={e => setEditForm({ ...editForm, linkedin_url: e.target.value })}
          placeholder="linkedin.com/in/…"
        />
      </td>

      <td>
        <select
          className="crm-cell-select"
          value={editForm.status}
          onChange={e => setEditForm({ ...editForm, status: e.target.value })}
        >
          <option value="">—</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </td>

      {pastEventsCell}

      <td>
        <div className="crm-row-actions">
          <button
            className="crm-icon-action save"
            onClick={() => saveEdit(p.person_id)}
            disabled={saving}
            aria-label="Save"
          >
            {saving ? <Loader2 size={14} className="crm-spin" /> : <Save size={14} />}
          </button>
          <button className="crm-icon-action cancel" onClick={cancelEdit} aria-label="Cancel">
            <XCircle size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

return (
  <Fragment key={p.person_id}>
    <tr
      className="clickable"
      onClick={() => {
        if (selecting) {
          togglePerson(p.person_id)
        } else {
          onOpenPerson(p.person_id)
        }
      }}
    >
      {selecting && (
        <td>
          <input
            type="checkbox"
            checked={selectedPersonIds.has(p.person_id)}
            onChange={() => togglePerson(p.person_id)}
            onClick={e => e.stopPropagation()}
          />
        </td>
      )}

      {selecting && (
        <td>
          <div className="crm-row-actions">
            <button
              className="crm-icon-action"
              onClick={e => {
                e.stopPropagation()
                // Opens in a NEW tab instead of navigating this one, so
                // viewing someone's profile mid-selection never discards
                // the batch you've already built up in the side panel.
                openPersonInNewTab(p.person_id)
              }}
              aria-label="View details"
              title="View details (opens in a new tab)"
            >
              <Eye size={14} />
            </button>

            <button
              className="crm-icon-action"
              onClick={e => { e.stopPropagation(); startEdit(p) }}
              aria-label="Edit person"
              title="Edit"
            >
              <Pencil size={14} />
            </button>

            <button
              className="crm-icon-action cancel"
              onClick={e => { e.stopPropagation(); setDeleteTarget(p) }}
              aria-label="Delete person"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      )}

      <td>
        <div className="crm-name-cell">
          <div className="crm-avatar" style={{ background: av.bg, color: av.fg }}>
            {initials(p.first_name, p.last_name)}
          </div>
          <span>{p.first_name} {p.last_name}</span>
          {alreadyLead && <span className="crm-lead-tag">Lead</span>}
        </div>
      </td>

      <td>{p.email}</td>
      <td>{p.email1 || '-'}</td>
      <td>{p.job_title || '-'}</td>
      <td>{p.industry || '-'}</td>
      <td>{p.companies?.company_name || '—'}</td>
      <td>{p.country || '—'}</td>

       <td>
        {p.linkedin_url ? (
          
            <a href={externalUrl(p.linkedin_url)}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
          >
            View ↗
          </a>
        ) : (
          '—'
        )}
      </td>

      <td><Badge value={p.status} /></td>

      {pastEventsCell}

      {!selecting && (
        <td>
          <div className="crm-row-actions">
            <button
              className="crm-icon-action"
              onClick={e => {
                e.stopPropagation()
                toggleExpand(p)
              }}
              aria-label={expandedPersonId === p.person_id ? 'Collapse' : 'Edit lead purpose'}
              title="Edit lead purpose"
            >
              {expandedPersonId === p.person_id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            <button
              className="crm-icon-action"
              onClick={e => { e.stopPropagation(); startEdit(p) }}
              aria-label="Edit person"
              title="Edit"
            >
              <Pencil size={14} />
            </button>

            <button
              className="crm-icon-action cancel"
              onClick={e => { e.stopPropagation(); setDeleteTarget(p) }}
              aria-label="Delete person"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      )}
    </tr>

    {expandedPersonId === p.person_id && (
      <tr>
        <td colSpan={COLUMN_COUNT} style={{ background: 'var(--paper)', padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <FieldLabel>Lead purpose</FieldLabel>
            <select
              className="crm-select"
              style={{ maxWidth: 260 }}
              value={leadPurposeDraft}
              onChange={e => setLeadPurposeDraft(e.target.value)}
            >
              <option value="">—</option>
              {COMBINED_PURPOSE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              className="crm-icon-action save"
              onClick={() => saveLeadPurpose(p.person_id)}
              disabled={savingLeadPurpose}
              aria-label="Save lead purpose"
            >
              {savingLeadPurpose ? <Loader2 size={14} className="crm-spin" /> : <Save size={14} />}
            </button>
            <button
              className="crm-icon-action cancel"
              onClick={() => setExpandedPersonId(null)}
              aria-label="Cancel"
            >
              <XCircle size={14} />
            </button>
          </div>
        </td>
      </tr>
    )}
  </Fragment>
)
})}

{filtered.length === 0 && (
  <tr className="crm-empty-row">
    <td colSpan={COLUMN_COUNT}>No one matches that search.</td>
  </tr>
)}
</tbody>
</table>

<Pagination page={peoplePage} setPage={setPeoplePage} total={filtered.length} />
</div>
)}

{deleteTarget && (
<div className="crm-modal-overlay">
  <div className="crm-modal-backdrop" onClick={() => !deleting && setDeleteTarget(null)} />
  <div className="crm-modal-card" style={{ maxWidth: 380 }}>
    <h4 className="crm-confirm-heading">
      Delete {deleteTarget.first_name} {deleteTarget.last_name}?
    </h4>
    <p className="crm-confirm-note">
      This permanently removes them from Supabase. This can't be undone.
    </p>
    <div className="crm-confirm-actions">
      <button className="crm-btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
        Cancel
      </button>
      <button
        className="crm-submit-btn"
        style={{ width: 'auto', padding: '10px 20px', background: 'var(--red)' }}
        onClick={() => deletePerson(deleteTarget)}
        disabled={deleting}
      >
        {deleting ? <Loader2 size={15} className="crm-spin" /> : <Trash2 size={15} />}
        Delete person
      </button>
    </div>
  </div>
</div>
)}
</div>
)
  // ============================================================
  // NO SELECTION
  // ============================================================

  if (
    !selecting ||
    selectedPersonIds.size === 0
  ) {
    return table
  }

  // ============================================================
  // SELECTED PEOPLE
  // ============================================================

  const selectedItems = people
    .filter(p =>
      selectedPersonIds.has(
        p.person_id
      )
    )
    .map(p => {

      const activeWarnings =
        CHANNEL_FIELDS
          .filter(
            cf =>
              cf.live &&
              effectiveChannelValue(
                p.person_id,
                cf.key
              )
          )
          .map(cf =>
            channelReadinessWarning(
              p,
              cf.key
            )
          )
          .filter(Boolean)

      const companyName =
        p.companies?.company_name ||
        ''

      return {
        id: p.person_id,
        primary: `${p.first_name} ${p.last_name}`,
        secondary:
          `${p.email}` +
          `${p.industry ? ' · ' + p.industry : ''}` +
          `${companyName ? ' · ' + companyName : ''}`,
        warning:
          activeWarnings.length > 0
            ? activeWarnings.join(' ')
            : null,
      }
    })

  return (
    <div className="crm-split-layout">

      <div className="crm-split-main">
        {table}
      </div>

      <div className="crm-split-side">
        <div className="crm-side-panel">

          <h4 className="crm-confirm-heading">
            {selectedPersonIds.size}{' '}
            selected
          </h4>

          <p className="crm-confirm-note">
            Every live channel starts on
            for everyone. Click a chip
            below to turn a channel off
            for the whole batch, or click
            a person's chip to except just
            them.
          </p>

          <div
            className="crm-channel-toggles"
            style={{
              marginBottom: 16,
            }}
          >
            {CHANNEL_FIELDS.map(cf => (
              <button
                key={cf.key}
                type="button"
                disabled={!cf.live}
                className={`crm-channel-toggle${
                  channelDefaults[
                    cf.key
                  ]
                    ? ''
                    : ' off'
                }${
                  !cf.live
                    ? ' disabled-live'
                    : ''
                }`}
                onClick={() =>
                  toggleChannelDefault(
                    cf.key
                  )
                }
                title={
                  !cf.live
                    ? 'Not wired to an active automation yet'
                    : undefined
                }
              >
                {channelDefaults[
                  cf.key
                ] ? (
                  <Check size={11} />
                ) : (
                  <X size={11} />
                )}{' '}
                {cf.label}
                {!cf.live
                  ? ' (inactive)'
                  : ''}
              </button>
            ))}
          </div>

          <div className="crm-confirm-list">

            {selectedItems.map(item => (
              <div
                key={item.id}
                className="crm-confirm-row"
                style={{
                  flexDirection:
                    'column',
                  alignItems:
                    'stretch',
                  gap: 8,
                }}
              >

                <div
                  style={{
                    display: 'flex',
                    alignItems:
                      'center',
                    justifyContent:
                      'space-between',
                  }}
                >
                  <div>
                    <div className="crm-confirm-row-name">
                      {item.primary}
                    </div>

                    <div className="crm-confirm-row-sub">
                      {item.secondary}
                    </div>
                  </div>

                  <button
                    className="crm-remove-x"
                    onClick={() =>
                      removeFromSelection(
                        item.id
                      )
                    }
                    aria-label={`Remove ${item.primary}`}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="crm-channel-toggles">

                  {CHANNEL_FIELDS.map(
                    cf => {

                      const on =
                        effectiveChannelValue(
                          item.id,
                          cf.key
                        )

                      return (
                        <button
                          key={cf.key}
                          type="button"
                          disabled={
                            !cf.live
                          }
                          className={`crm-channel-toggle${
                            on
                              ? ''
                              : ' off'
                          }${
                            !cf.live
                              ? ' disabled-live'
                              : ''
                          }`}
                          onClick={() =>
                            toggleChannelException(
                              item.id,
                              cf.key
                            )
                          }
                          title={
                            !cf.live
                              ? 'Not wired to an active automation yet'
                              : undefined
                          }
                        >
                          {on ? (
                            <Check
                              size={10}
                            />
                          ) : (
                            <X size={10} />
                          )}{' '}
                          {cf.label}
                        </button>
                      )
                    }
                  )}

                </div>

                {item.warning && (
                  <div className="crm-warn-note">
                    <AlertTriangle
                      size={12}
                      style={{
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    />
                    {item.warning}
                  </div>
                )}

              </div>
            ))}

          </div>

          <button
            className="crm-submit-btn"
            onClick={submitConvert}
            disabled={converting}
          >
            {converting ? (
              <Loader2
                size={15}
                className="crm-spin"
              />
            ) : (
              <Check size={15} />
            )}

            Confirm & create{' '}
            {selectedPersonIds.size}
          </button>

        </div>
      </div>
    </div>
  )
}
// ============================================================================
// LEADS — live data. Company lives on the person's record now, so it stays
// dropped from this table. Each outreach channel gets its own status column
// instead of a combined summary. Clicking a row opens the full Lead detail
// page, where everything is edited.
// ============================================================================
function LeadsPage({ showToast, onOpenLead }) {
  // NEW: which event's leads we're viewing. null = show the picker.
  const [selectedEventId, setSelectedEventId] = useState(null) // event_id string | 'NONE' | null
  const [pickerEvents, setPickerEvents] = useState([])
  const [pickerEventsLoading, setPickerEventsLoading] = useState(true)

  const fetchPickerEvents = useCallback(async () => {
    setPickerEventsLoading(true)
    const { data, error } = await supabase
      .from('events')
      .select('event_id, event_name, start_date, status')
      .order('start_date', { ascending: false })
    if (!error) setPickerEvents(data || [])
    setPickerEventsLoading(false)
  }, [])

  useEffect(() => { fetchPickerEvents() }, [fetchPickerEvents])

  // Human-readable label for whichever event is currently selected, used in
  // the "Viewing: ..." toolbar line below. 'NONE' means general leads with
  // no event_id — everything else is looked up by id from pickerEvents.
  const selectedEventLabel = useMemo(() => {
    if (selectedEventId === 'NONE') return 'No event (general leads)'
    return pickerEvents.find(e => e.event_id === selectedEventId)?.event_name || selectedEventId
  }, [selectedEventId, pickerEvents])

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [leadsPage, setLeadsPage] = useState(1)

  const [activeEvent, setActiveEvent] = useState(null)
  const [activeEventLoading, setActiveEventLoading] = useState(true)
  const [convertingLeadId, setConvertingLeadId] = useState(null)

  const [stageLabels, setStageLabels] = useState({})
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('systems_tables')
        .select('config2, description')
        .eq('system_name', 'Email Outreach')
      if (!error && data) {
        const map = {}
        data.forEach(r => { map[(r.config2 || '').toString().trim()] = r.description })
        setStageLabels(map)
      }
    })()
  }, [])

  const emailStageLabel = (code) => stageLabels[(code || '').toString().trim()] || code

  const fetchActiveEvent = useCallback(async () => {
    setActiveEventLoading(true)
    const { data, error } = await supabase
      .from('events')
      .select('event_id, event_name, start_date, end_date, status')
      .eq('status', 'Active')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      showToast(`Couldn't load active event: ${error.message}`, true)
      setActiveEvent(null)
    } else {
      setActiveEvent(data || null)
    }
    setActiveEventLoading(false)
  }, [showToast])

  useEffect(() => { fetchActiveEvent() }, [fetchActiveEvent])

  // Fetches leads for the currently selected event only. 'NONE' means
  // general leads with no event_id. Single request with an explicit high
  // .range() ceiling (not a page loop) so PostgREST's default row cap can't
  // silently truncate results once lead counts grow.
  const fetchLeads = useCallback(async () => {
    if (!selectedEventId) return
    setLoading(true)
    setError(null)
    const PAGE = 1000
    let allRows = []
    let from = 0
    while (true) {
      let query = supabase
        .from('leads')
        .select('*, people(first_name, last_name, owner_email)')
        .order('created_at', { ascending: false })
        .order('lead_id', { ascending: true })
        .range(from, from + PAGE - 1)
      query = selectedEventId === 'NONE' ? query.is('event_id', null) : query.eq('event_id', selectedEventId)
      const { data, error } = await query
      if (error) { setError(error.message); setLoading(false); return }
      allRows = allRows.concat(data || [])
      if (!data || data.length < PAGE) break
      from += PAGE
    }
    setLeads(allRows)
    setLoading(false)
  }, [selectedEventId])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const convertLeadToAttendee = async (lead) => {
    if (!activeEvent) {
      showToast('No active event found', true)
      return
    }
    setConvertingLeadId(lead.lead_id)
    const { data: existing, error: checkError } = await supabase
      .from('event_participants')
      .select('participant_id')
      .eq('event_id', activeEvent.event_id)
      .eq('person_id', lead.person_id)
      .maybeSingle()
    if (checkError) {
      setConvertingLeadId(null)
      showToast(`Couldn't check attendee: ${checkError.message}`, true)
      return
    }
    if (existing) {
      setConvertingLeadId(null)
      showToast(`This person is already an attendee for ${activeEvent.event_name}`, true)
      return
    }
    const { error: insertError } = await supabase
      .from('event_participants')
      .insert({
        event_id: activeEvent.event_id,
        person_id: lead.person_id,
        company_id: lead.company_id || null,
        role: 'Attendee',
        status: 'Invited',
      })
    setConvertingLeadId(null)
    if (insertError) { showToast(`Couldn't add attendee: ${insertError.message}`, true); return }
    showToast(`${lead.people?.first_name || 'Person'} added to ${activeEvent.event_name}`)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return leads.filter(l => {
      if (statusFilter && l.lead_status !== statusFilter) return false
      if (activeOnly && l.lead_status === 'Unsubscribed') return false
      if (!q) return true
      const personName = `${l.people?.first_name || ''} ${l.people?.last_name || ''}`
      return `${personName} ${l.lead_purpose || ''} ${l.people?.owner_email || ''}`.toLowerCase().includes(q)
    })
  }, [leads, search, statusFilter, activeOnly])

  useEffect(() => { setLeadsPage(1) }, [search, statusFilter, activeOnly, selectedEventId])

  // -------------------------------------------------------------------------
  // Step 1: event picker — shown until an event (or "no event") is chosen.
  // -------------------------------------------------------------------------
  if (!selectedEventId) {
    return (
      <div>
        <p className="crm-confirm-note" style={{ marginBottom: 16 }}>
          Pick an event to see its leads.
        </p>
        {pickerEventsLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading events…</div>}
        {!pickerEventsLoading && (
          <div className="crm-confirm-list" style={{ maxHeight: 'none' }}>
            <div
              className="crm-confirm-row"
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedEventId('NONE')}
            >
              <div>
                <div className="crm-confirm-row-name">No event</div>
                <div className="crm-confirm-row-sub">General leads not tied to any event</div>
              </div>
            </div>
            {pickerEvents.map(e => (
              <div
                key={e.event_id}
                className="crm-confirm-row"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedEventId(e.event_id)}
              >
                <div>
                  <div className="crm-confirm-row-name">{e.event_name}</div>
                  <div className="crm-confirm-row-sub">{formatDate(e.start_date)}</div>
                </div>
                <Badge value={e.status} />
              </div>
            ))}
            {pickerEvents.length === 0 && (
              <div className="crm-confirm-empty">No events yet — create one first.</div>
            )}
          </div>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Step 2: leads table, scoped to selectedEventId.
  // -------------------------------------------------------------------------
  return (
    <div>
      <div className="crm-toolbar">
        <button className="crm-btn-secondary" onClick={() => setSelectedEventId(null)}>
          ← Change event
        </button>
        <span className="crm-count-note" style={{ marginLeft: 0 }}>Viewing: <b style={{ color: 'var(--ink-950)' }}>{selectedEventLabel}</b></span>

        <div className="crm-search-box">
          <Search size={15} style={{ color: 'var(--ink-400)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search person, purpose, owner…" />
        </div>

        <select className="crm-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {LEAD_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <button className={`crm-toggle-chip${activeOnly ? ' on' : ''}`} onClick={() => setActiveOnly(v => !v)}>
          {activeOnly ? <Check size={13} /> : null}
          Active campaigns only
        </button>

        <span className="crm-count-note">
          {activeEventLoading ? 'Loading active event…' : activeEvent ? `Active event: ${activeEvent.event_name}` : 'No active event'}
        </span>

        <span className="crm-count-note">{filtered.length} of {leads.length}</span>
      </div>

      {loading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading leads…</div>}
      {error && <div className="crm-error">Couldn't load leads: {error}</div>}

      {!loading && !error && (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                {['Person', 'Purpose', 'Status', 'Nurture', 'Owner', 'Cold calling', 'Email', 'Social', ''].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginate(filtered, leadsPage).map(l => {
                const personName = `${l.people?.first_name || ''} ${l.people?.last_name || ''}`.trim() || '—'
                const isConverting = convertingLeadId === l.lead_id
                return (
                  <tr key={l.lead_id} className="clickable" onClick={() => onOpenLead(l.lead_id)}>
                    <td style={{ fontWeight: 500, color: 'var(--ink-950)' }}>{personName}</td>
                    <td>{l.lead_purpose || '—'}</td>
                    <td><Badge value={l.lead_status} /></td>
                    <td><Badge value={l.nurture_stage} /></td>
                    <td>{l.people?.owner_email || '—'}</td>
                    <td>
                      {l.cold_calling ? (
                        <Badge value={l.cold_calling_stage || 'Not Pitched'} />
                      ) : (
                        <span style={{ color: 'var(--ink-400)' }}>Off</span>
                      )}
                    </td>
                    <td>
                      {l.email_campaign ? (
                        <Badge value={emailStageLabel(l.email_campaign_stage) || 'Queued'} />
                      ) : (
                        <span style={{ color: 'var(--ink-400)' }}>Off</span>
                      )}
                    </td>
                    <td>
                      {l.social_media ? (
                        <Badge value={l.social_media_stage || 'Queued'} />
                      ) : (
                        <span style={{ color: 'var(--ink-400)' }}>Off</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          className="crm-icon-action"
                          onClick={e => { e.stopPropagation(); onOpenLead(l.lead_id) }}
                          aria-label="View details"
                          title="View lead details"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          className="crm-icon-action"
                          onClick={e => { e.stopPropagation(); convertLeadToAttendee(l) }}
                          disabled={isConverting || activeEventLoading || !activeEvent}
                          aria-label="Convert to attendee"
                          title={activeEvent ? `Add to ${activeEvent.event_name}` : 'No active event'}
                        >
                          {isConverting ? <Loader2 size={14} className="crm-spin" /> : <UserPlus size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr className="crm-empty-row"><td colSpan={9}>No leads match these filters.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={leadsPage} setPage={setLeadsPage} total={filtered.length} />
        </div>
      )}
    </div>
  )
}
// ============================================================================
// PERSON DETAIL — full page. Shows and edits every field for one person,
// lists any leads already created from them, and offers a one-click
// "Convert to lead" action that opens a fully-editable confirm modal.
// ============================================================================
function PersonDetailPage({ personId, showToast, onOpenLead, onLeadCreated, onLeadRemoved }) {
  const [person, setPerson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [company, setCompany] = useState(null)
  const [saving, setSaving] = useState(false)

  const [leads, setLeads] = useState([])
  const [leadsLoading, setLeadsLoading] = useState(true)

  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [showEvents, setShowEvents] = useState(false)

  const [showConvert, setShowConvert] = useState(false)
  const [creatingLead, setCreatingLead] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('people')
      .select('*, companies(company_id, company_name, country)')
      .eq('person_id', personId)
      .single()
    if (error) setError(error.message)
    else {
      setPerson(data)
      setForm({
        first_name: data.first_name || '', last_name: data.last_name || '', email: data.email || '', email1: data.email1 || '',
        job_title: data.job_title || '', country: data.country || '', phone: data.phone || '',
        mobile: data.mobile || '', linkedin_url: data.linkedin_url || '', status: data.status || '',
        industry: data.industry || '', lead_purpose: data.lead_purpose || '', owner_email: data.owner_email || '',
      })
      setCompany(data.companies ? { company_id: data.companies.company_id, company_name: data.companies.company_name, country: data.companies.country || '' } : null)
    }
    setLoading(false)
  }, [personId])

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true)
    const { data, error } = await supabase
      .from('leads')
      .select('lead_id, created_at')
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
    if (!error) setLeads(data || [])
    setLeadsLoading(false)
  }, [personId])

  const loadEvents = useCallback(async () => {
    setEventsLoading(true)
    const { data, error } = await supabase
      .from('event_participants')
      .select('participant_id, role, status, events(event_id, event_name, start_date)')
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
    if (!error) setEvents(data || [])
    setEventsLoading(false)
  }, [personId])

  useEffect(() => { load(); loadLeads(); loadEvents() }, [load, loadLeads, loadEvents])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
const save = async () => {
  setSaving(true)

  const { companyId, error: companyError } = await resolveCompanyId(company)
  if (companyError) {
    setSaving(false)
    showToast(`Couldn't save company: ${companyError.message}`, true)
    return
  }

  const { error } = await supabase
    .from('people')
    .update({
      ...form,
      email: form.email?.trim() || null,
      email1: form.email1?.trim() || null,
      company_id: companyId,
      updated_at: new Date().toISOString(),
    })
    .eq('person_id', personId)
  setSaving(false)
  if (error) { showToast(`Couldn't save: ${error.message}`, true); return }
  showToast('Person updated')
  load()
}

  const createLead = async (convertForm) => {
    setCreatingLead(true)
    const { data, error } = await supabase
      .from('leads')
      .insert({ person_id: personId, company_id: company?.company_id || null, event_id: null, ...convertForm })
      .select()
      .single()
    setCreatingLead(false)
    if (error) { showToast(`Couldn't create lead: ${error.message}`, true); return }

    // Keep the People page's hidden-leads map in sync with this flow too.
    onLeadCreated && onLeadCreated(personId, null)

    showToast(
      'Lead created',
      false,
      async () => {
        const { error: undoError } = await supabase.from('leads').delete().eq('lead_id', data.lead_id)
        if (undoError) { showToast(`Couldn't undo: ${undoError.message}`, true); return }
        onLeadRemoved && onLeadRemoved(personId, null)
        showToast('Undone — lead removed')
        loadLeads()
      }
    )
    setShowConvert(false)
    loadLeads()
    if (data && onOpenLead) onOpenLead(data.lead_id)
  }

  if (loading) return <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading person…</div>
  if (error) return <div className="crm-error">Couldn't load person: {error}</div>
  if (!person || !form) return null

  const av = avatarStyle(form.first_name + form.last_name)

  return (
    <div className="crm-detail-wrap">
      <div className="crm-detail-top">
        <div className="crm-name-cell" style={{ fontSize: 15 }}>
          <div className="crm-avatar" style={{ background: av.bg, color: av.fg, width: 40, height: 40, fontSize: 13 }}>{initials(form.first_name, form.last_name)}</div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--ink-950)', fontSize: 16 }}>{form.first_name} {form.last_name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>{form.email}</div>
          </div>
        </div>
        <button className="crm-submit-btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setShowConvert(true)}>
          <UserPlus size={15} /> Convert to lead
        </button>
      </div>

      <div className="crm-form" style={{ marginTop: 18 }}>
        <div className="crm-form-row">
          <div><FieldLabel>First name</FieldLabel><input className="crm-input" value={form.first_name} onChange={set('first_name')} /></div>
          <div><FieldLabel>Last name</FieldLabel><input className="crm-input" value={form.last_name} onChange={set('last_name')} /></div>
        </div>
        <div><FieldLabel>Email</FieldLabel><input className="crm-input" value={form.email} onChange={set('email')} /></div>
        <div><FieldLabel>Email 1</FieldLabel><input className="crm-input" value={form.email1} onChange={set('email1')} /></div>
        <div className="crm-form-row">
          <div><FieldLabel>Job title</FieldLabel><input className="crm-input" value={form.job_title} onChange={set('job_title')} /></div>
          <div>
            <FieldLabel>Industry</FieldLabel>
            <select className="crm-select" value={form.industry} onChange={set('industry')}>
              <option value="">—</option>
              {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>
        <div className="crm-form-row">
          <div><FieldLabel>Country</FieldLabel><input className="crm-input" value={form.country} onChange={set('country')} /></div>
          <div><FieldLabel>Company</FieldLabel><CompanyPicker value={company} onChange={setCompany} showToast={showToast} /></div>
        </div>
        <div className="crm-form-row">
          <div><FieldLabel>Lead purpose</FieldLabel><input className="crm-input" value={form.lead_purpose} onChange={set('lead_purpose')} placeholder="e.g. Sponsor Acquisition, Event Invitation" /></div>
          <div>
            <FieldLabel>Owner email</FieldLabel>
            <select className="crm-select" value={form.owner_email} onChange={set('owner_email')}>
              <option value="">— Unassigned —</option>
              {OWNER_EMAIL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="crm-form-row">
          <div><FieldLabel>Phone</FieldLabel><input className="crm-input" value={form.phone} onChange={set('phone')} /></div>
          <div><FieldLabel>Mobile</FieldLabel><input className="crm-input" value={form.mobile} onChange={set('mobile')} /></div>
        </div>
        <div className="crm-form-row">
          <div><FieldLabel>LinkedIn URL</FieldLabel><input className="crm-input" value={form.linkedin_url} onChange={set('linkedin_url')} /></div>
          <div><FieldLabel>Status</FieldLabel><input className="crm-input" value={form.status} onChange={set('status')} /></div>
        </div>
        <button className="crm-submit-btn" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={15} className="crm-spin" /> : <Save size={15} />} Save changes
        </button>
      </div>

      <div style={{ marginTop: 28 }}>
        <h3 className="crm-display" style={{ fontSize: 17, margin: '0 0 12px' }}>Leads from this person</h3>
        {leadsLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading leads…</div>}
        {!leadsLoading && leads.length === 0 && (
          <div className="crm-confirm-empty" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>No leads yet — convert this person above.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!leadsLoading && leads.map(l => (
            <LeadDetailCard key={l.lead_id} leadId={l.lead_id} showToast={showToast} hidePersonChip />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <button
          onClick={() => setShowEvents(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <h3 className="crm-display" style={{ fontSize: 17, margin: 0 }}>
            Events attending{!eventsLoading && ` (${events.length})`}
          </h3>
          {showEvents ? <ChevronUp size={16} color="var(--ink-400)" /> : <ChevronDown size={16} color="var(--ink-400)" />}
        </button>
        {showEvents && (
          <div style={{ marginTop: 12 }}>
            {eventsLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading events…</div>}
            {!eventsLoading && events.length === 0 && (
              <div className="crm-confirm-empty" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>Not attached to any events yet.</div>
            )}
            {!eventsLoading && events.map(ev => (
              <div key={ev.participant_id} className="crm-confirm-row" style={{ border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div className="crm-confirm-row-name">{ev.events?.event_name || 'Untitled event'}</div>
                  <div className="crm-confirm-row-sub">{formatDate(ev.events?.start_date)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge value={ev.role} />
                  <Badge value={ev.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showConvert && (
        <QuickConvertModal
          person={{ first_name: form.first_name, last_name: form.last_name, mobile: form.mobile, phone: form.phone, company_id: company?.company_id || null }}
          onClose={() => setShowConvert(false)}
          onConfirm={createLead}
          creating={creatingLead}
        />
      )}
    </div>
  )
}
// ============================================================================
// LEAD DETAIL CARD — the actual editable lead content, shared by the full
// Lead detail page and by the Person detail page (which embeds one of these
// per lead so you get a full overview without navigating away).
//
// IMPORTANT: the three channel *_stage columns (cold_calling_stage,
// email_campaign_stage, social_media_stage) are shown READ-ONLY here. They
// are owned by live automations — an AI cold-calling agent writes branching
// outcomes into cold_calling_stage, and the Make.com email scenario writes
// its own progress values into email_campaign_stage. A generic "save your
// edits" form that includes these as free-editable dropdowns can silently
// clobber automation state (e.g. reset a lead that's mid-flow back to
// "Not started", making it look eligible for re-contact, or erasing an
// outcome another automated step already branched on).
//
// What IS safely human-editable per channel is just the on/off boolean
// (whether this channel should be pursued for the lead at all) — turning a
// channel off is a legitimate "stop trying this on them" action and doesn't
// require knowing the automation's internal state vocabulary.
//
// ACTIVITY TIMELINE: pulled from public.activities, filtered to this lead_id.
// This is the audit trail the Make.com scenarios write to on every email
// sent, reply logged, unsubscribe, and bounce — surfacing it here is the
// only way to see, from inside the CRM, whether the automation is actually
// working for a given lead without querying Supabase directly.
// ============================================================================
function LeadDetailCard({ leadId, showToast, onOpenPerson, hidePersonChip }) {
  const [lead, setLead] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const [activities, setActivities] = useState([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)

  const [stageLabels, setStageLabels] = useState({})
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('systems_tables')
        .select('config2, description')
        .eq('system_name', 'Email Outreach')
      if (!error && data) {
        const map = {}
        data.forEach(r => { map[(r.config2 || '').toString().trim()] = r.description })
        setStageLabels(map)
      }
    })()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('leads')
      .select('*, people(person_id, first_name, last_name, email, mobile, phone), companies(company_name), events(event_name)')
      .eq('lead_id', leadId)
      .single()
    if (error) setError(error.message)
    else {
      setLead(data)
      setForm({
        lead_status: data.lead_status || '', lead_purpose: data.lead_purpose || '',
        nurture_stage: data.nurture_stage || '', owner: data.owner || '', notes: data.notes || '',
        cold_calling: !!data.cold_calling,
        email_campaign: !!data.email_campaign,
        social_media: !!data.social_media,
      })
    }
    setLoading(false)
  }, [leadId])

  const loadActivities = useCallback(async () => {
    setActivitiesLoading(true)
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('lead_id', leadId)
      .order('activity_date', { ascending: false })
    if (!error) setActivities(data || [])
    setActivitiesLoading(false)
  }, [leadId])

  useEffect(() => { load(); loadActivities() }, [load, loadActivities])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const toggleChannel = (boolKey) => setForm(prev => ({ ...prev, [boolKey]: !prev[boolKey] }))

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('leads').update({ ...form, updated_at: new Date().toISOString() }).eq('lead_id', leadId)
    setSaving(false)
    if (error) { showToast(`Couldn't save: ${error.message}`, true); return }
    showToast('Lead updated')
    load()
  }

  if (loading) return <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading lead…</div>
  if (error) return <div className="crm-error">Couldn't load lead: {error}</div>
  if (!lead || !form) return null

  const personName = `${lead.people?.first_name || ''} ${lead.people?.last_name || ''}`.trim() || '—'
  const coldCallingWarning = form.cold_calling ? channelReadinessWarning(
    { mobile: lead.people?.mobile, phone: lead.people?.phone, company_id: lead.company_id },
    'cold_calling_stage'
  ) : null

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 20, background: 'var(--surface)' }}>
      <div className="crm-confirm-summary">
        {!hidePersonChip && (
          <span
            className="crm-confirm-summary-item"
            style={{ cursor: lead.people ? 'pointer' : 'default' }}
            onClick={() => lead.people && onOpenPerson && onOpenPerson(lead.people.person_id)}
          >
            Person: <b>{personName}</b>
          </span>
        )}
        <span className="crm-confirm-summary-item">Event: <b>{lead.events?.event_name || 'General lead'}</b></span>
        <span className="crm-confirm-summary-item">Company: <b>{lead.companies?.company_name || '—'}</b></span>
        <span className="crm-confirm-summary-item">Created: <b>{formatDate(lead.created_at)}</b></span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="crm-form-row">
          <div>
            <FieldLabel>Status</FieldLabel>
            <select className="crm-select" value={form.lead_status} onChange={set('lead_status')}>
              <option value="">—</option>
              {LEAD_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Nurture stage</FieldLabel>
            <select className="crm-select" value={form.nurture_stage} onChange={set('nurture_stage')}>
              <option value="">—</option>
              {NURTURE_STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="crm-form-row">
          <div>
            <FieldLabel>Purpose</FieldLabel>
            <select className="crm-select" value={form.lead_purpose} onChange={set('lead_purpose')}>
              <option value="">—</option>
              {LEAD_PURPOSE_CHOICES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div><FieldLabel>Owner</FieldLabel><input className="crm-input" value={form.owner} onChange={set('owner')} /></div>
        </div>

        <div>
          <FieldLabel>Outreach channels</FieldLabel>
          <p className="crm-channel-note" style={{ marginTop: -4, marginBottom: 10 }}>
            Progress within each channel is driven by automation and shown read-only. Toggle a channel off to stop pursuing it for this lead.
          </p>
          <div className="crm-channel-grid">
            {CHANNEL_FIELDS.map(cf => {
              const boolValue = form[cf.boolKey]
              const rawStageValue = lead[cf.key]
              const stageValue = cf.key === 'email_campaign_stage'
                ? (stageLabels[(rawStageValue || '').toString().trim()] || rawStageValue)
                : rawStageValue
              return (
                <div key={cf.key} className="crm-channel-readonly">
                  <div className="crm-channel-readonly-head">
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-700)' }}>{cf.label}</span>
                    <button
                      type="button"
                      disabled={!cf.live}
                      className={`crm-channel-toggle${boolValue ? '' : ' off'}${!cf.live ? ' disabled-live' : ''}`}
                      onClick={() => cf.live && toggleChannel(cf.boolKey)}
                      title={!cf.live ? 'Not wired to an active automation yet' : (boolValue ? 'Turn this channel off' : 'Turn this channel on')}
                    >
                      {boolValue ? <Check size={10} /> : <X size={10} />} {boolValue ? 'On' : 'Off'}
                    </button>
                  </div>
                  {boolValue ? <Badge value={stageValue} /> : <span style={{ color: 'var(--ink-400)', fontSize: 12.5 }}>Not being pursued</span>}
                </div>
              )
            })}
          </div>
          {coldCallingWarning && (
            <div className="crm-warn-note" style={{ marginTop: 10 }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />{coldCallingWarning}
            </div>
          )}
        </div>

        <div><FieldLabel>Notes</FieldLabel><textarea className="crm-textarea" value={form.notes} onChange={set('notes')} /></div>

        <button className="crm-submit-btn" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={15} className="crm-spin" /> : <Save size={15} />} Save changes
        </button>
      </div>

      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
        <h4 style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-950)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <History size={14} /> Activity
        </h4>
        {activitiesLoading && (
          <div className="crm-loading" style={{ padding: '16px 0' }}><Loader2 size={14} className="crm-spin" /> Loading activity…</div>
        )}
        {!activitiesLoading && activities.length === 0 && (
          <div className="crm-confirm-empty" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 24 }}>
            Nothing logged yet — activity appears here once outreach starts.
          </div>
        )}
        {!activitiesLoading && activities.length > 0 && (
          <div className="crm-activity-list">
            {activities.map(a => {
              const Icon = activityIcon(a.activity_type)
              const tone = activityTone(a.activity_type)
              return (
                <div key={a.activity_id} className="crm-activity-item">
                  <div className="crm-activity-icon" style={{ background: tone.bg, color: tone.fg }}>
                    <Icon size={14} />
                  </div>
                  <div className="crm-activity-body">
                    <div className="crm-activity-top">
                      <span className="crm-activity-type">{a.activity_type || 'Activity'}</span>
                      <span className="crm-activity-date">{formatDateTime(a.activity_date)}</span>
                    </div>
                    {a.summary && <div className="crm-activity-summary">{a.summary}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
// ============================================================================
// LEAD DETAIL — full page wrapper around LeadDetailCard.
// ============================================================================
function LeadDetailPage({ leadId, showToast, onOpenPerson }) {
  return (
    <div className="crm-detail-wrap">
      <LeadDetailCard leadId={leadId} showToast={showToast} onOpenPerson={onOpenPerson} />
    </div>
  )
}

// ============================================================================
// EVENTS — live data, search + status filter, single-row edit-lock (unchanged)
// ============================================================================
function EventsPage({ showToast }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [eventsPage, setEventsPage] = useState(1)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.from('events').select('*').order('start_date', { ascending: true })
    if (error) setError(error.message)
    else setEvents(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return events.filter(e => {
      if (statusFilter && e.status !== statusFilter) return false
      if (!q) return true
      // event_id included in search since it's the meaningful lookup key
      // used everywhere else (leads.event_id, event_participants.event_id).
      return `${e.event_id} ${e.event_name} ${e.event_type || ''} ${e.location || ''} ${e.country || ''}`.toLowerCase().includes(q)
    })
  }, [events, search, statusFilter])

  useEffect(() => { setEventsPage(1) }, [search, statusFilter])

  const startEdit = (e) => {
    setEditingId(e.event_id)
    setEditForm({
      event_name: e.event_name || '',
      event_type: e.event_type || '',
      location: e.location || '',
      country: e.country || '',
      status: e.status || '',
      start_date: e.start_date || '',
      end_date: e.end_date || '',
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditForm(null) }

  const saveEdit = async (eventId) => {
    setSaving(true)
    const { error } = await supabase.from('events').update({ ...editForm, updated_at: new Date().toISOString() }).eq('event_id', eventId)
    setSaving(false)
    if (error) { showToast(`Couldn't save: ${error.message}`, true); return }
    setEvents(prev => prev.map(e => (e.event_id === eventId ? { ...e, ...editForm } : e)))
    setEditingId(null)
    setEditForm(null)
    showToast('Event updated')
  }

  return (
    <div>
      <div className="crm-toolbar">
        <div className="crm-search-box">
          <Search size={15} style={{ color: 'var(--ink-400)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search event ID, name, type, location, country…" />
        </div>
        <select className="crm-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {EVENT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="crm-count-note">{filtered.length} of {events.length}</span>
      </div>

      {loading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading events…</div>}
      {error && <div className="crm-error">Couldn't load events: {error}</div>}

      {!loading && !error && (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>{['Event ID', 'Event', 'Type', 'Dates', 'Location', 'Country', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {paginate(filtered, eventsPage).map(e => {
                const isEditing = editingId === e.event_id
                return (
                  <tr key={e.event_id} className={isEditing ? 'editing' : ''}>
                    {/* event_id is always read-only, even while editing — it's
                        the FK every lead and event_participants row keys off,
                        so changing it here would silently orphan those rows. */}
                    <td style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--ink-700)' }}>{e.event_id}</td>
                    {isEditing ? (
                      <>
                        <td><input className="crm-cell-input" value={editForm.event_name} onChange={ev => setEditForm({ ...editForm, event_name: ev.target.value })} /></td>
                        <td><input className="crm-cell-input" value={editForm.event_type} onChange={ev => setEditForm({ ...editForm, event_type: ev.target.value })} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input type="date" className="crm-cell-input" value={editForm.start_date} onChange={ev => setEditForm({ ...editForm, start_date: ev.target.value })} />
                            <input type="date" className="crm-cell-input" value={editForm.end_date} onChange={ev => setEditForm({ ...editForm, end_date: ev.target.value })} />
                          </div>
                        </td>
                        <td><input className="crm-cell-input" value={editForm.location} onChange={ev => setEditForm({ ...editForm, location: ev.target.value })} /></td>
                        <td><input className="crm-cell-input" value={editForm.country} onChange={ev => setEditForm({ ...editForm, country: ev.target.value })} /></td>
                        <td>
                          <select className="crm-cell-select" value={editForm.status} onChange={ev => setEditForm({ ...editForm, status: ev.target.value })}>
                            <option value="">—</option>
                            {EVENT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>
                          <div className="crm-row-actions">
                            <button className="crm-icon-action save" onClick={() => saveEdit(e.event_id)} disabled={saving} aria-label="Save">
                              {saving ? <Loader2 size={14} className="crm-spin" /> : <Save size={14} />}
                            </button>
                            <button className="crm-icon-action cancel" onClick={cancelEdit} aria-label="Cancel"><XCircle size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ fontWeight: 500, color: 'var(--ink-950)' }}>{e.event_name}</td>
                        <td>{e.event_type || '—'}</td>
                        <td style={{ fontSize: 12.5 }}><Clock size={12} style={{ marginRight: 4, verticalAlign: -2 }} />{formatDate(e.start_date)} – {formatDate(e.end_date)}</td>
                        <td>{e.location || '—'}</td>
                        <td>{e.country || '—'}</td>
                        <td><Badge value={e.status} /></td>
                        <td><button className="crm-icon-action" onClick={() => startEdit(e)} aria-label="Edit row"><Pencil size={14} /></button></td>
                      </>
                    )}
                  </tr>
                )
              })}
              {filtered.length === 0 && <tr className="crm-empty-row"><td colSpan={8}>No events match these filters.</td></tr>}
            </tbody>
          </table>
          <Pagination page={eventsPage} setPage={setEventsPage} total={filtered.length} />
        </div>
      )}
    </div>
  )
}
// ============================================================================
// ATTENDEES — pick an event, manage who's already attached to it (edit-lock,
// removable, paginated), and add more people via search/industry filter with
// multi-select.
//
// Two additions here:
//  - Candidate table shows Industry instead of Company, with a matching
//    filter, mirroring the People page.
//  - Anyone already attached to this event who ALSO has a lead tied to this
//    exact event_id gets a "Lead" tag next to their name — this is a
//    cross-reference against public.leads (event_id), not a guess, and
//    re-fetches every time the selected event changes.
// ============================================================================
function AttendeesPage({ showToast }) {
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [selectedEventId, setSelectedEventId] = useState('')

  const [participants, setParticipants] = useState([])
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [participantsPage, setParticipantsPage] = useState(1)

  // person_ids that have a lead row with event_id = the currently selected
  // event — drives the "Lead" tag in the participants table below.
  const [leadPersonIdsForEvent, setLeadPersonIdsForEvent] = useState(new Set())

  // person_id -> [{event_id, event_name, start_date, status}] for every OTHER
  // event that person has been on event_participants for. This IS the
  // attendance history — no separate table needed, event_participants already
  // stores it, we're just querying across events instead of within one.
  const [pastEventsByPerson, setPastEventsByPerson] = useState({})
  const [pastEventsLoading, setPastEventsLoading] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateIndustryFilter, setCandidateIndustryFilter] = useState('')
  const [candidatePage, setCandidatePage] = useState(1)
  const [selectedPersonIds, setSelectedPersonIds] = useState(new Set())
  const [bulkRole, setBulkRole] = useState('Attendee')
  const [bulkStatus, setBulkStatus] = useState('Invited')
  const [submittingAdd, setSubmittingAdd] = useState(false)
  const [addStep, setAddStep] = useState('select') // 'select' | 'confirm'

  useEffect(() => {
    (async () => {
      setEventsLoading(true)
      const { data, error } = await supabase.from('events').select('event_id, event_name, start_date').order('start_date', { ascending: false })
      if (error) showToast(`Couldn't load events: ${error.message}`, true)
      else {
        setEvents(data || [])
        if (data && data.length > 0 && !selectedEventId) setSelectedEventId(data[0].event_id)
      }
      setEventsLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

 const fetchParticipants = useCallback(async (eventId) => {
  if (!eventId) return []
  setParticipantsLoading(true)
  const PAGE = 1000
  let allRows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('event_participants')
      .select('*, people(first_name, last_name, email), companies(company_name)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .order('participant_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) { showToast(`Couldn't load attendees: ${error.message}`, true); setParticipantsLoading(false); return [] }
    allRows = allRows.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  setParticipants(allRows)
  setParticipantsLoading(false)
  return allRows
}, [showToast])

  // Cross-references leads for this same event so the participants table can
  // flag "already a lead for this event" without a manual lookup elsewhere.
const fetchLeadsForEvent = useCallback(async (eventId) => {
  if (!eventId) { setLeadPersonIdsForEvent(new Set()); return }
  const PAGE = 1000
  let allRows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('person_id')
      .eq('event_id', eventId)
      .range(from, from + PAGE - 1)
    if (error) return
    allRows = allRows.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  setLeadPersonIdsForEvent(new Set(allRows.map(r => r.person_id)))
}, [])

  // Pulls attendance history for the people currently shown, by looking at
  // every OTHER event_participants row for those person_ids. Grouped client
  // side into a person_id -> events[] map.
  const fetchPastEvents = useCallback(async (eventId, personIds) => {
    if (!eventId || !personIds || personIds.length === 0) { setPastEventsByPerson({}); return }
    setPastEventsLoading(true)
    const { data, error } = await supabase
      .from('event_participants')
      .select('person_id, status, events!inner(event_id, event_name, start_date)')
      .in('person_id', personIds)
      .neq('event_id', eventId)
      .order('start_date', { ascending: false, foreignTable: 'events' })
    setPastEventsLoading(false)
    if (error) { showToast(`Couldn't load attendance history: ${error.message}`, true); return }
    const map = {}
    ;(data || []).forEach(row => {
      if (!row.events) return
      if (!map[row.person_id]) map[row.person_id] = []
      map[row.person_id].push({
        event_id: row.events.event_id,
        event_name: row.events.event_name,
        start_date: row.events.start_date,
        status: row.status,
      })
    })
    setPastEventsByPerson(map)
  }, [showToast])

  useEffect(() => {
    setSelectedPersonIds(new Set())
    setAddStep('select')
    setCandidatePage(1)
    setParticipantsPage(1)
    if (selectedEventId) {
      (async () => {
        const rows = await fetchParticipants(selectedEventId)
        fetchLeadsForEvent(selectedEventId)
        fetchPastEvents(selectedEventId, rows.map(r => r.person_id))
      })()
    }
  }, [selectedEventId, fetchParticipants, fetchLeadsForEvent, fetchPastEvents])

  // Candidate pool is now the LEADS table (joined to people) instead of the
  // full people table — so the "add to event" picker only surfaces people
  // who are already qualified leads. Search/industry filtering happens
  // client-side because PostgREST .or() doesn't reliably filter across an
  // embedded relation like leads -> people.
  useEffect(() => {
    if (!selectedEventId) return
    setCandidatePage(1)
    ;(async () => {
      setCandidatesLoading(true)
      const existingIds = new Set(participants.map(p => p.person_id))
      const { data, error } = await supabase
        .from('leads')
        .select(`
           lead_id,
           person_id,
           nurture_stage,
           event_id,
           people(
            person_id,
            first_name,
            last_name,
            email,
           job_title,
           country,
          company_id,
           industry
    )
  `)
  .order('created_at', { ascending: false })
  .limit(5000)
      if (error) { showToast(`Couldn't load leads: ${error.message}`, true); setCandidatesLoading(false); return }

      // Dedupe by person_id (a person can have more than one lead row across
      // events) — keep the first one seen.
      const seen = new Set()
      let rows = (data || [])
        .filter(l => l.people && !existingIds.has(l.person_id) && !seen.has(l.person_id) && seen.add(l.person_id))
        .map(l => ({
          person_id: l.person_id,
          lead_id: l.lead_id,
          stage: l.nurture_stage,
          first_name: l.people.first_name,
          last_name: l.people.last_name,
          email: l.people.email,
          job_title: l.people.job_title,
          country: l.people.country,
          company_id: l.people.company_id,
          industry: l.people.industry,
        }))

      if (candidateSearch.trim()) {
        const q = candidateSearch.trim().toLowerCase()
        rows = rows.filter(c =>
          (c.first_name || '').toLowerCase().includes(q) ||
          (c.last_name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q)
        )
      }
      if (candidateIndustryFilter) rows = rows.filter(c => c.industry === candidateIndustryFilter)

      setCandidates(rows)
      setCandidatesLoading(false)
    })()
  }, [selectedEventId, candidateSearch, candidateIndustryFilter, participants, showToast])

  const togglePerson = (personId) => {
    setSelectedPersonIds(prev => {
      const next = new Set(prev)
      if (next.has(personId)) next.delete(personId)
      else next.add(personId)
      return next
    })
  }
  const selectAllFiltered = () => setSelectedPersonIds(new Set(candidates.map(c => c.person_id)))
  const clearSelection = () => setSelectedPersonIds(new Set())

  const submitAdd = async () => {
    if (selectedPersonIds.size === 0) return
    setSubmittingAdd(true)
    const rows = candidates
      .filter(c => selectedPersonIds.has(c.person_id))
      .map(c => ({
        event_id: selectedEventId,
        person_id: c.person_id,
        company_id: c.company_id || null,
        role: bulkRole,
        status: bulkStatus,
      }))
    const { error } = await supabase.from('event_participants').insert(rows)
    setSubmittingAdd(false)
    if (error) { showToast(`Couldn't add attendees: ${error.message}`, true); return }
    showToast(`${rows.length} ${rows.length === 1 ? 'person' : 'people'} added`)
    setSelectedPersonIds(new Set())
    setAddStep('select')
    const updated = await fetchParticipants(selectedEventId)
    fetchPastEvents(selectedEventId, updated.map(r => r.person_id))
  }

  const startEdit = (p) => {
    setEditingId(p.participant_id)
    setEditForm({ role: p.role || '', status: p.status || '' })
  }
  const cancelEdit = () => { setEditingId(null); setEditForm(null) }
  const saveEdit = async (participantId) => {
    setSaving(true)
    const { error } = await supabase.from('event_participants').update({ ...editForm, updated_at: new Date().toISOString() }).eq('participant_id', participantId)
    setSaving(false)
    if (error) { showToast(`Couldn't save: ${error.message}`, true); return }
    setParticipants(prev => prev.map(p => (p.participant_id === participantId ? { ...p, ...editForm } : p)))
    setEditingId(null)
    setEditForm(null)
    showToast('Attendee updated')
  }
  const removeParticipant = async (participantId) => {
    setRemovingId(participantId)
    const { error } = await supabase.from('event_participants').delete().eq('participant_id', participantId)
    setRemovingId(null)
    if (error) { showToast(`Couldn't remove: ${error.message}`, true); return }
    setParticipants(prev => prev.filter(p => p.participant_id !== participantId))
    showToast('Removed from event')
  }

  return (
    <div>
      <div className="crm-toolbar">
        <select className="crm-filter-select" value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)} disabled={eventsLoading}>
          {eventsLoading && <option>Loading events…</option>}
          {!eventsLoading && events.length === 0 && <option value="">No events yet — create one first</option>}
          {events.map(e => <option key={e.event_id} value={e.event_id}>{e.event_name} ({formatDate(e.start_date)})</option>)}
        </select>
        <span className="crm-count-note">{participants.length} attached to this event</span>
      </div>

      {participantsLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading attendees…</div>}
      {!participantsLoading && selectedEventId && (
        <div className="crm-table-wrap" style={{ marginBottom: 28 }}>
          <table className="crm-table">
            <thead><tr>{['Name', 'Email', 'Company', 'Role', 'Status', 'Past Events', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {paginate(participants, participantsPage).map(p => {
                const isEditing = editingId === p.participant_id
                const name = `${p.people?.first_name || ''} ${p.people?.last_name || ''}`.trim() || '—'
                const isLeadForThisEvent = leadPersonIdsForEvent.has(p.person_id)
                const history = pastEventsByPerson[p.person_id] || []
                return (
                  <tr key={p.participant_id} className={isEditing ? 'editing' : ''}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {name}
                        {isLeadForThisEvent && <span className="crm-lead-tag">Lead</span>}
                      </span>
                    </td>
                    <td>{p.people?.email || '—'}</td>
                    <td>{p.companies?.company_name || '—'}</td>
                    {isEditing ? (
                      <>
                        <td>
                          <select className="crm-cell-select" value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
                            {PARTICIPANT_ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="crm-cell-select" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                            {PARTICIPANT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td colSpan={2}>
                          <div className="crm-row-actions">
                            <button className="crm-icon-action save" onClick={() => saveEdit(p.participant_id)} disabled={saving} aria-label="Save">
                              {saving ? <Loader2 size={14} className="crm-spin" /> : <Save size={14} />}
                            </button>
                            <button className="crm-icon-action cancel" onClick={cancelEdit} aria-label="Cancel"><XCircle size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td><Badge value={p.role} /></td>
                        <td><Badge value={p.status} /></td>
                        <td>
                          {pastEventsLoading ? (
                            <span className="crm-muted">…</span>
                          ) : history.length === 0 ? (
                            <span className="crm-muted">—</span>
                          ) : (
                            <span
                              className="crm-history-tag"
                              title={history.map(h => `${h.event_name} (${formatDate(h.start_date)}) — ${h.status || '—'}`).join('\n')}
                            >
                              {history.length} past event{history.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="crm-row-actions">
                            <button className="crm-icon-action" onClick={() => startEdit(p)} aria-label="Edit row"><Pencil size={14} /></button>
                            <button className="crm-icon-action cancel" onClick={() => removeParticipant(p.participant_id)} disabled={removingId === p.participant_id} aria-label="Remove">
                              {removingId === p.participant_id ? <Loader2 size={14} className="crm-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
              {participants.length === 0 && <tr className="crm-empty-row"><td colSpan={7}>No one's attached to this event yet — add people below.</td></tr>}
            </tbody>
          </table>
          <Pagination page={participantsPage} setPage={setParticipantsPage} total={participants.length} />
        </div>
      )}

      {selectedEventId && (
        <div>
          <h3 className="crm-display" style={{ fontSize: 18, margin: '0 0 12px' }}>Add leads to this event</h3>

          {addStep === 'confirm' ? (
            <ConfirmSelectionPanel
              heading={`Confirm ${selectedPersonIds.size} ${selectedPersonIds.size === 1 ? 'person' : 'people'} for this event`}
              note="Remove anyone who shouldn't be included, then confirm to write these to the database."
              summary={[{ label: 'Role', value: bulkRole }, { label: 'Status', value: bulkStatus }]}
              items={candidates.filter(c => selectedPersonIds.has(c.person_id)).map(c => ({
                id: c.person_id,
                primary: `${c.first_name} ${c.last_name}`,
                secondary: `${c.email}${c.industry ? ' · ' + c.industry : ''}`,
              }))}
              onRemove={(id) => togglePerson(id)}
              onConfirm={submitAdd}
              onBack={() => setAddStep('select')}
              confirming={submittingAdd}
              confirmLabel={`Confirm & add ${selectedPersonIds.size > 0 ? selectedPersonIds.size : ''}`}
            />
          ) : (
            <>
              <SelectionBar
                count={selectedPersonIds.size}
                noun="selected"
                label={`Review & add ${selectedPersonIds.size}`}
                onConfirm={() => setAddStep('confirm')}
              />

              <div className="crm-toolbar">
                <div className="crm-search-box">
                  <Search size={15} style={{ color: 'var(--ink-400)' }} />
                  <input value={candidateSearch} onChange={e => setCandidateSearch(e.target.value)} placeholder="Filter by name or email…" />
                </div>
                <select className="crm-filter-select" value={candidateIndustryFilter} onChange={e => setCandidateIndustryFilter(e.target.value)}>
                  <option value="">All industries</option>
                  {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
                <select className="crm-filter-select" value={bulkRole} onChange={e => setBulkRole(e.target.value)}>
                  {PARTICIPANT_ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="crm-filter-select" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}>
                  {PARTICIPANT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="crm-toggle-chip" onClick={selectAllFiltered}>Select all filtered ({candidates.length})</button>
                {selectedPersonIds.size > 0 && <button className="crm-toggle-chip" onClick={clearSelection}>Clear selection</button>}
                <span className="crm-count-note">{selectedPersonIds.size} selected</span>
              </div>

              {candidatesLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading leads…</div>}
              {!candidatesLoading && (
                <div className="crm-table-wrap" style={{ marginBottom: 16 }}>
                  <table className="crm-table">
                    <thead><tr>{['', 'Name', 'Email', 'Job title', 'Industry', 'Country'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {paginate(candidates, candidatePage).map(c => (
                        <tr key={c.person_id} onClick={() => togglePerson(c.person_id)} style={{ cursor: 'pointer' }}>
                          <td><input type="checkbox" checked={selectedPersonIds.has(c.person_id)} onChange={() => togglePerson(c.person_id)} onClick={e => e.stopPropagation()} /></td>
                          <td>{c.first_name} {c.last_name}</td>
                          <td>{c.email}</td>
                          <td>{c.job_title || '—'}</td>
                          <td>{c.industry || '—'}</td>
                          <td>{c.country || '—'}</td>
                        </tr>
                      ))}
                      {candidates.length === 0 && <tr className="crm-empty-row"><td colSpan={6}>No leads match this filter (or they're all already on the event).</td></tr>}
                    </tbody>
                  </table>
                  <Pagination page={candidatePage} setPage={setCandidatePage} total={candidates.length} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
function PersonForm({ showToast }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', job_title: '', industry: '', country: '', phone: '', mobile: '', linkedin_url: '' })
  const [company, setCompany] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

const submit = async (e) => {
  e.preventDefault()
  if (!form.first_name) return
  setSubmitting(true)

  const { companyId, error: companyError } = await resolveCompanyId(company)
  if (companyError) {
    setSubmitting(false)
    showToast(`Couldn't save company: ${companyError.message}`, true)
    return
  }

  const { error } = await supabase.from('people').insert({
    ...form,
    email: form.email?.trim() || null,
    company_id: companyId,
  })
  setSubmitting(false)
  if (error) { showToast(`Couldn't add person: ${error.message}`, true); return }
  setForm({ first_name: '', last_name: '', email: '', job_title: '', industry: '', country: '', phone: '', mobile: '', linkedin_url: '' })
  setCompany(null)
  showToast('Person added')
}

  return (
    <form onSubmit={submit} className="crm-form">
      <div className="crm-form-row">
        <div><FieldLabel>First name</FieldLabel><input required value={form.first_name} onChange={set('first_name')} className="crm-input" /></div>
        <div><FieldLabel>Last name</FieldLabel><input value={form.last_name} onChange={set('last_name')} className="crm-input" /></div>
      </div>
      <div><FieldLabel>Email</FieldLabel><input  type="email" value={form.email} onChange={set('email')} className="crm-input" /></div>
      <div className="crm-form-row">
        <div><FieldLabel>Job title</FieldLabel><input value={form.job_title} onChange={set('job_title')} className="crm-input" /></div>
        <div>
          <FieldLabel>Industry</FieldLabel>
          <select value={form.industry} onChange={set('industry')} className="crm-select">
            <option value="">—</option>
            {INDUSTRY_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>
      <div className="crm-form-row">
        <div><FieldLabel>Country</FieldLabel><input value={form.country} onChange={set('country')} className="crm-input" /></div>
        <div><FieldLabel>Company</FieldLabel><CompanyPicker value={company} onChange={setCompany} showToast={showToast} /></div>
      </div>
      <div className="crm-form-row">
        <div><FieldLabel>Phone</FieldLabel><input value={form.phone} onChange={set('phone')} className="crm-input" /></div>
        <div><FieldLabel>Mobile</FieldLabel><input value={form.mobile} onChange={set('mobile')} className="crm-input" /></div>
      </div>
      <div><FieldLabel>LinkedIn URL</FieldLabel><input value={form.linkedin_url} onChange={set('linkedin_url')} className="crm-input" /></div>
      <button type="submit" className="crm-submit-btn" disabled={submitting}>
        {submitting ? <Loader2 size={15} className="crm-spin" /> : <UserPlus size={15} />} Add person
      </button>
    </form>
  )
}

function EventForm({ showToast }) {
  const [form, setForm] = useState({ event_id: '', event_name: '', event_type: '', location: '', country: '', status: 'Planned', start_date: '', end_date: '', add_info: '' })
  const [submitting, setSubmitting] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (!form.event_id || !form.event_name) return
    setSubmitting(true)
    const { error } = await supabase.from('events').insert(form)
    setSubmitting(false)
    if (error) { showToast(`Couldn't add event: ${error.message}`, true); return }
    setForm({ event_id: '', event_name: '', event_type: '', location: '', country: '', status: 'Planned', start_date: '', end_date: '', add_info: '' })
    showToast('Event added')
  }

  return (
    <form onSubmit={submit} className="crm-form">
      <div><FieldLabel>Event ID</FieldLabel><input required value={form.event_id} onChange={set('event_id')} className="crm-input" placeholder="Unique short code, e.g. SXSW26" /></div>
      <div><FieldLabel>Event name</FieldLabel><input required value={form.event_name} onChange={set('event_name')} className="crm-input" /></div>
      <div className="crm-form-row">
        <div><FieldLabel>Type</FieldLabel><input value={form.event_type} onChange={set('event_type')} className="crm-input" /></div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <select value={form.status} onChange={set('status')} className="crm-select">
            {EVENT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="crm-form-row">
        <div><FieldLabel>Start date</FieldLabel><input type="date" value={form.start_date} onChange={set('start_date')} className="crm-input" /></div>
        <div><FieldLabel>End date</FieldLabel><input type="date" value={form.end_date} onChange={set('end_date')} className="crm-input" /></div>
      </div>
      <div className="crm-form-row">
        <div><FieldLabel>Location</FieldLabel><input value={form.location} onChange={set('location')} className="crm-input" /></div>
        <div><FieldLabel>Country</FieldLabel><input value={form.country} onChange={set('country')} className="crm-input" /></div>
      </div>
      <div><FieldLabel>Notes</FieldLabel><textarea value={form.add_info} onChange={set('add_info')} className="crm-textarea" /></div>
      <button type="submit" className="crm-submit-btn" disabled={submitting}>
        {submitting ? <Loader2 size={15} className="crm-spin" /> : <Calendar size={15} />} Add event
      </button>
    </form>
  )
}
