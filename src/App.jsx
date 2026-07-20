import { useState, useMemo, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import {
  Users, UserPlus, Calendar, Target, Menu, X, Search,
  Building2, Clock, Check, Pencil, Save, XCircle, Loader2,
  UserCheck, Trash2
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Fixed pick-lists. These are UI constants (dropdown options), not fake rows —
// swap the arrays' contents to match your real values whenever you confirm them.
// ---------------------------------------------------------------------------
const LEAD_STATUS_OPTIONS = ['New', 'Contacted', 'Qualified', 'Won', 'Lost']
const NURTURE_STAGE_OPTIONS = ['Cold', 'Warming', 'Hot', 'Stalled']
const CHANNEL_STAGE_OPTIONS = ['Not started', 'In progress', 'Responded', 'Converted']
const EVENT_STATUS_OPTIONS = ['Planned', 'Active', 'Completed', 'Cancelled']
const PARTICIPANT_ROLE_OPTIONS = ['Attendee', 'Speaker', 'Sponsor', 'Organizer']
const PARTICIPANT_STATUS_OPTIONS = ['Invited', 'Confirmed', 'Attended', 'Cancelled']

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

// Shared pagination helper — 15 rows per page everywhere it's used.
const PAGE_SIZE = 15
function paginate(items, page) {
  const start = (page - 1) * PAGE_SIZE
  return items.slice(start, start + PAGE_SIZE)
}
function Pagination({ page, setPage, total }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <div className="crm-pagination">
      <span>Page {page} of {totalPages} · {total} total</span>
      <button className="crm-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
      <button className="crm-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
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

  .crm-table-wrap { border: 1px solid var(--line); background: var(--surface); border-radius: 16px; overflow: auto; }
  .crm-table { width: 100%; font-size: 13.5px; border-collapse: collapse; min-width: 760px; }
  .crm-table thead tr { border-bottom: 1px solid var(--line); }
  .crm-table th { text-align: left; padding: 12px 18px; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-400); white-space: nowrap; }
  .crm-table td { padding: 10px 18px; border-bottom: 1px solid var(--line); color: var(--ink-700); vertical-align: middle; }
  .crm-table tbody tr:hover td { background: #FAFAF8; }
  .crm-table tbody tr.editing td { background: var(--accent-soft); }
  .crm-table tbody tr:last-child td { border-bottom: none; }
  .crm-name-cell { display: flex; align-items: center; gap: 10px; font-weight: 500; color: var(--ink-950); }
  .crm-empty-row td { text-align: center; padding: 40px 24px; color: var(--ink-400); }
  .crm-avatar { width: 32px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }

  .crm-cell-input { width: 100%; min-width: 90px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); font-size: 13px; font-family: inherit; outline: none; }
  .crm-cell-input:focus { border-color: var(--accent); }
  .crm-cell-select { width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line); font-size: 13px; font-family: inherit; background: #fff; }
  .crm-row-actions { display: flex; gap: 6px; white-space: nowrap; }
  .crm-icon-action { width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--line); background: var(--surface); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .crm-icon-action:hover { background: var(--paper); }
  .crm-icon-action.save { color: var(--accent-ink); border-color: var(--accent); }
  .crm-icon-action.cancel { color: var(--red); }
  .crm-badge { font-size: 11px; font-weight: 500; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }

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

  /* ---------- Confirm-selection step (Attendees add / Lead bulk-create / People convert) ---------- */
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

  /* ---------- Sticky selection bar — shown the moment people are picked, ---------- */
  /* ---------- pinned to the top of the scroll area so it's always visible. ---------- */
  .crm-selection-bar { position: sticky; top: 0; z-index: 6; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--accent-soft); border: 1px solid var(--accent); margin-bottom: 14px; box-shadow: 0 4px 14px rgba(14,111,92,0.12); }
  .crm-selection-bar-count { font-size: 13.5px; font-weight: 600; color: var(--accent-ink); }
  .crm-selection-bar-actions { display: flex; align-items: center; gap: 8px; }
  .crm-selection-confirm-btn { display: flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 10px; border: none; font-size: 13.5px; font-weight: 600; background: var(--accent-ink); color: #fff; cursor: pointer; }
  .crm-selection-confirm-btn:hover { filter: brightness(1.1); }
`

// ---------------------------------------------------------------------------
// Status/stage badge coloring — purely presentational, driven by whatever
// value is actually in the DB, not a hardcoded row.
// ---------------------------------------------------------------------------
function badgeTone(value) {
  const v = (value || '').toLowerCase()
  if (['won', 'converted', 'confirmed', 'attended', 'active', 'completed'].includes(v)) return { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }
  if (['lost', 'cancelled', 'stalled'].includes(v)) return { bg: 'var(--red-soft)', fg: 'var(--red)' }
  if (['new', 'planned', 'invited', 'not started'].includes(v)) return { bg: 'var(--line)', fg: 'var(--ink-700)' }
  return { bg: 'var(--amber-soft)', fg: 'var(--amber)' }
}
function Badge({ value }) {
  if (!value) return <span style={{ color: 'var(--ink-400)' }}>—</span>
  const tone = badgeTone(value)
  return <span className="crm-badge" style={{ background: tone.bg, color: tone.fg }}>{value}</span>
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

export default function App() {
  const [activePage, setActivePage] = useState('people')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [toast, setToast] = useState(null) // { message, error }

  const showToast = (message, error = false) => setToast({ message, error })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const goTo = (key) => { setActivePage(key); setMobileOpen(false) }

  const pageMeta = {
    people: { title: 'People', sub: 'All contacts synced from Supabase' },
    leads: { title: 'Leads', sub: 'Every lead across every channel' },
    events: { title: 'Events', sub: 'Events and who attended them' },
    attendees: { title: 'Attendees', sub: 'Manage who is attached to each event' },
    create: { title: 'Create', sub: 'Add a new event, person, or lead' },
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
            <button className="crm-mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <div style={{ minWidth: 0 }}>
              <h2 className="crm-page-title crm-display">{pageMeta.title}</h2>
              <p className="crm-page-sub">{pageMeta.sub}</p>
            </div>
          </div>
          <div className="crm-header-right">
            <div className="crm-user-avatar">JD</div>
          </div>
        </header>

        <main className="crm-content">
          {activePage === 'people' && <PeoplePage showToast={showToast} />}
          {activePage === 'leads' && <LeadsPage showToast={showToast} />}
          {activePage === 'events' && <EventsPage showToast={showToast} />}
          {activePage === 'attendees' && <AttendeesPage showToast={showToast} />}
          {activePage === 'create' && <CreatePage showToast={showToast} />}
        </main>
      </div>

      {toast && (
        <div className={`crm-toast${toast.error ? ' error' : ''}`}>
          <Check size={15} style={{ color: toast.error ? '#fff' : '#7FD1B9' }} />
          {toast.message}
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
      <div className="crm-sidebar-foot">© 2024 ConnectivaCRM</div>
    </>
  )
}

// ============================================================================
// PEOPLE — live data, search, pagination, single-row edit-lock, and
// select-multiple -> Convert to Lead (with a review/confirm step before
// anything is written to the database).
// ============================================================================
function PeoplePage({ showToast }) {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [peoplePage, setPeoplePage] = useState(1)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    setError(null)
    // company_id is a foreign key to companies, so this embeds the company
    // name in the same query instead of a second round trip.
    const { data, error } = await supabase
      .from('people')
      .select('*, companies(company_name)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setPeople(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchPeople() }, [fetchPeople])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return people
    return people.filter(p => {
      const companyName = p.companies?.company_name || ''
      return `${p.first_name} ${p.last_name} ${p.email} ${p.job_title || ''} ${companyName} ${p.country || ''}`
        .toLowerCase()
        .includes(q)
    })
  }, [people, search])

  // Reset to page 1 whenever the search changes so you don't get stranded
  // on a page that no longer has any matching rows.
  useEffect(() => { setPeoplePage(1) }, [search])

  const startEdit = (p) => {
    // Opening a new row for editing discards any unsaved changes on the
    // previously open row — only one row is ever editable at a time.
    setEditingId(p.person_id)
    setEditForm({
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      email: p.email || '',
      job_title: p.job_title || '',
      country: p.country || '',
      phone: p.phone || '',
      mobile: p.mobile || '',
      status: p.status || '',
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditForm(null) }

  const saveEdit = async (personId) => {
    setSaving(true)
    const { error } = await supabase
      .from('people')
      .update({ ...editForm, updated_at: new Date().toISOString() })
      .eq('person_id', personId)
    setSaving(false)
    if (error) {
      showToast(`Couldn't save: ${error.message}`, true)
      return
    }
    setPeople(prev => prev.map(p => (p.person_id === personId ? { ...p, ...editForm } : p)))
    setEditingId(null)
    setEditForm(null)
    showToast('Person updated')
  }

  return (
    <div>
      <div className="crm-toolbar">
        <div className="crm-search-box">
          <Search size={15} style={{ color: 'var(--ink-400)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company, title, country…" />
        </div>
        <span className="crm-count-note">{filtered.length} of {people.length}</span>
      </div>

      {loading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading people…</div>}
      {error && <div className="crm-error">Couldn't load people: {error}</div>}

      {!loading && !error && (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                {['Name', 'Email', 'Job title', 'Company', 'Country', 'Status', ''].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {paginate(filtered, peoplePage).map(p => {
                const isEditing = editingId === p.person_id
                const av = avatarStyle(p.first_name + p.last_name)
                return (
                  <tr key={p.person_id} className={isEditing ? 'editing' : ''}>
                    {isEditing ? (
                      <>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input className="crm-cell-input" value={editForm.first_name} onChange={e => setEditForm({ ...editForm, first_name: e.target.value })} placeholder="First" />
                            <input className="crm-cell-input" value={editForm.last_name} onChange={e => setEditForm({ ...editForm, last_name: e.target.value })} placeholder="Last" />
                          </div>
                        </td>
                        <td><input className="crm-cell-input" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></td>
                        <td><input className="crm-cell-input" value={editForm.job_title} onChange={e => setEditForm({ ...editForm, job_title: e.target.value })} /></td>
                        <td style={{ color: 'var(--ink-400)', fontSize: 12 }}>edit company on Leads</td>
                        <td><input className="crm-cell-input" value={editForm.country} onChange={e => setEditForm({ ...editForm, country: e.target.value })} /></td>
                        <td><input className="crm-cell-input" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} /></td>
                        <td>
                          <div className="crm-row-actions">
                            <button className="crm-icon-action save" onClick={() => saveEdit(p.person_id)} disabled={saving} aria-label="Save">
                              {saving ? <Loader2 size={14} className="crm-spin" /> : <Save size={14} />}
                            </button>
                            <button className="crm-icon-action cancel" onClick={cancelEdit} aria-label="Cancel">
                              <XCircle size={14} />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <div className="crm-name-cell">
                            <div className="crm-avatar" style={{ background: av.bg, color: av.fg }}>{initials(p.first_name, p.last_name)}</div>
                            <span>{p.first_name} {p.last_name}</span>
                          </div>
                        </td>
                        <td>{p.email}</td>
                        <td>{p.job_title || '—'}</td>
                        <td>{p.companies?.company_name || '—'}</td>
                        <td>{p.country || '—'}</td>
                        <td><Badge value={p.status} /></td>
                        <td>
                          <button className="crm-icon-action" onClick={() => startEdit(p)} aria-label="Edit row">
                            <Pencil size={14} />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr className="crm-empty-row"><td colSpan={7}>No one matches that search.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={peoplePage} setPage={setPeoplePage} total={filtered.length} />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// LEADS — live data against the real leads schema, filter by status,
// "active only" toggle (on by default), single-row edit-lock
// ============================================================================
function LeadsPage({ showToast }) {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [activeOnly, setActiveOnly] = useState(true) // default on, per your call
  const [leadsPage, setLeadsPage] = useState(1)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('leads')
      .select('*, people(first_name, last_name), companies(company_name)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setLeads(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return leads.filter(l => {
      if (statusFilter && l.lead_status !== statusFilter) return false
      // "Active" = not Won and not Lost. Flag if this definition should differ.
      if (activeOnly && ['Won', 'Lost'].includes(l.lead_status)) return false
      if (!q) return true
      const personName = `${l.people?.first_name || ''} ${l.people?.last_name || ''}`
      const companyName = l.companies?.company_name || ''
      return `${personName} ${companyName} ${l.lead_purpose || ''} ${l.owner || ''}`.toLowerCase().includes(q)
    })
  }, [leads, search, statusFilter, activeOnly])

  useEffect(() => { setLeadsPage(1) }, [search, statusFilter, activeOnly])

  const startEdit = (l) => {
    setEditingId(l.lead_id)
    setEditForm({
      lead_status: l.lead_status || '',
      lead_purpose: l.lead_purpose || '',
      nurture_stage: l.nurture_stage || '',
      owner: l.owner || '',
      notes: l.notes || '',
      cold_calling: !!l.cold_calling,
      social_media: !!l.social_media,
      email_campaign: !!l.email_campaign,
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditForm(null) }

  const saveEdit = async (leadId) => {
    setSaving(true)
    const { error } = await supabase
      .from('leads')
      .update({ ...editForm, updated_at: new Date().toISOString() })
      .eq('lead_id', leadId)
    setSaving(false)
    if (error) { showToast(`Couldn't save: ${error.message}`, true); return }
    setLeads(prev => prev.map(l => (l.lead_id === leadId ? { ...l, ...editForm } : l)))
    setEditingId(null)
    setEditForm(null)
    showToast('Lead updated')
  }

  return (
    <div>
      <div className="crm-toolbar">
        <div className="crm-search-box">
          <Search size={15} style={{ color: 'var(--ink-400)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search person, company, purpose, owner…" />
        </div>
        <select className="crm-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {LEAD_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className={`crm-toggle-chip${activeOnly ? ' on' : ''}`} onClick={() => setActiveOnly(v => !v)}>
          {activeOnly ? <Check size={13} /> : null} Active campaigns only
        </button>
        <span className="crm-count-note">{filtered.length} of {leads.length}</span>
      </div>

      {loading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading leads…</div>}
      {error && <div className="crm-error">Couldn't load leads: {error}</div>}

      {!loading && !error && (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                {['Person', 'Company', 'Purpose', 'Status', 'Nurture', 'Owner', 'Channels', ''].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {paginate(filtered, leadsPage).map(l => {
                const isEditing = editingId === l.lead_id
                const personName = `${l.people?.first_name || ''} ${l.people?.last_name || ''}`.trim() || '—'
                return (
                  <tr key={l.lead_id} className={isEditing ? 'editing' : ''}>
                    <td>{personName}</td>
                    <td>{l.companies?.company_name || '—'}</td>
                    {isEditing ? (
                      <>
                        <td><input className="crm-cell-input" value={editForm.lead_purpose} onChange={e => setEditForm({ ...editForm, lead_purpose: e.target.value })} /></td>
                        <td>
                          <select className="crm-cell-select" value={editForm.lead_status} onChange={e => setEditForm({ ...editForm, lead_status: e.target.value })}>
                            <option value="">—</option>
                            {LEAD_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="crm-cell-select" value={editForm.nurture_stage} onChange={e => setEditForm({ ...editForm, nurture_stage: e.target.value })}>
                            <option value="">—</option>
                            {NURTURE_STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td><input className="crm-cell-input" value={editForm.owner} onChange={e => setEditForm({ ...editForm, owner: e.target.value })} /></td>
                        <td style={{ fontSize: 12 }}>
                          <label className="crm-checkbox-row"><input type="checkbox" checked={editForm.cold_calling} onChange={e => setEditForm({ ...editForm, cold_calling: e.target.checked })} /> Cold call</label>
                          <label className="crm-checkbox-row"><input type="checkbox" checked={editForm.social_media} onChange={e => setEditForm({ ...editForm, social_media: e.target.checked })} /> Social</label>
                          <label className="crm-checkbox-row"><input type="checkbox" checked={editForm.email_campaign} onChange={e => setEditForm({ ...editForm, email_campaign: e.target.checked })} /> Email</label>
                        </td>
                        <td>
                          <div className="crm-row-actions">
                            <button className="crm-icon-action save" onClick={() => saveEdit(l.lead_id)} disabled={saving} aria-label="Save">
                              {saving ? <Loader2 size={14} className="crm-spin" /> : <Save size={14} />}
                            </button>
                            <button className="crm-icon-action cancel" onClick={cancelEdit} aria-label="Cancel"><XCircle size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{l.lead_purpose || '—'}</td>
                        <td><Badge value={l.lead_status} /></td>
                        <td><Badge value={l.nurture_stage} /></td>
                        <td>{l.owner || '—'}</td>
                        <td style={{ fontSize: 12 }}>
                          {[l.cold_calling && 'Cold call', l.social_media && 'Social', l.email_campaign && 'Email'].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td>
                          <button className="crm-icon-action" onClick={() => startEdit(l)} aria-label="Edit row"><Pencil size={14} /></button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr className="crm-empty-row"><td colSpan={8}>No leads match these filters.</td></tr>
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
// EVENTS — live data, search + status filter, single-row edit-lock
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
      return `${e.event_name} ${e.event_type || ''} ${e.location || ''} ${e.country || ''}`.toLowerCase().includes(q)
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search event, type, location, country…" />
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
              <tr>{['Event', 'Type', 'Dates', 'Location', 'Country', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {paginate(filtered, eventsPage).map(e => {
                const isEditing = editingId === e.event_id
                return (
                  <tr key={e.event_id} className={isEditing ? 'editing' : ''}>
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
              {filtered.length === 0 && <tr className="crm-empty-row"><td colSpan={7}>No events match these filters.</td></tr>}
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
// removable, paginated), and add more people via search/filter with
// multi-select (select-all-filtered or one-by-one, deselect before
// submitting, a sticky confirm bar the moment anyone is selected, and a
// confirm step before anything is written).
// ============================================================================
function AttendeesPage({ showToast }) {
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [selectedEventId, setSelectedEventId] = useState('')

  const [participants, setParticipants] = useState([])
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [participantsPage, setParticipantsPage] = useState(1)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  // "Add people" panel
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidateSearch, setCandidateSearch] = useState('')
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
    if (!eventId) return
    setParticipantsLoading(true)
    const { data, error } = await supabase
      .from('event_participants')
      .select('*, people(first_name, last_name, email), companies(company_name)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
    if (error) showToast(`Couldn't load attendees: ${error.message}`, true)
    else setParticipants(data || [])
    setParticipantsLoading(false)
  }, [showToast])

  useEffect(() => {
    setSelectedPersonIds(new Set())
    setAddStep('select')
    setCandidatePage(1)
    setParticipantsPage(1)
    if (selectedEventId) fetchParticipants(selectedEventId)
  }, [selectedEventId, fetchParticipants])

  // Candidate people = anyone not already a participant on this event.
  useEffect(() => {
    if (!selectedEventId) return
    setCandidatePage(1)
    ;(async () => {
      setCandidatesLoading(true)
      const existingIds = new Set(participants.map(p => p.person_id))
      let query = supabase.from('people').select('person_id, first_name, last_name, email, job_title, country, company_id, companies(company_name)').limit(200)
      if (candidateSearch.trim()) {
        const q = candidateSearch.trim()
        query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
      }
      const { data, error } = await query
      if (error) showToast(`Couldn't load people: ${error.message}`, true)
      else setCandidates((data || []).filter(p => !existingIds.has(p.person_id)))
      setCandidatesLoading(false)
    })()
  }, [selectedEventId, candidateSearch, participants, showToast])

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
    fetchParticipants(selectedEventId)
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

      {/* Current participants — paginated so a big event doesn't turn into an endless scroll */}
      {participantsLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading attendees…</div>}
      {!participantsLoading && selectedEventId && (
        <div className="crm-table-wrap" style={{ marginBottom: 28 }}>
          <table className="crm-table">
            <thead><tr>{['Name', 'Email', 'Company', 'Role', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {paginate(participants, participantsPage).map(p => {
                const isEditing = editingId === p.participant_id
                const name = `${p.people?.first_name || ''} ${p.people?.last_name || ''}`.trim() || '—'
                return (
                  <tr key={p.participant_id} className={isEditing ? 'editing' : ''}>
                    <td>{name}</td>
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
                        <td>
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
              {participants.length === 0 && <tr className="crm-empty-row"><td colSpan={6}>No one's attached to this event yet — add people below.</td></tr>}
            </tbody>
          </table>
          <Pagination page={participantsPage} setPage={setParticipantsPage} total={participants.length} />
        </div>
      )}

      {/* Add people panel */}
      {selectedEventId && (
        <div>
          <h3 className="crm-display" style={{ fontSize: 18, margin: '0 0 12px' }}>Add people to this event</h3>

          {addStep === 'confirm' ? (
            <ConfirmSelectionPanel
              heading={`Confirm ${selectedPersonIds.size} ${selectedPersonIds.size === 1 ? 'person' : 'people'} for this event`}
              note="Remove anyone who shouldn't be included, then confirm to write these to the database."
              summary={[{ label: 'Role', value: bulkRole }, { label: 'Status', value: bulkStatus }]}
              items={candidates.filter(c => selectedPersonIds.has(c.person_id)).map(c => ({
                id: c.person_id,
                primary: `${c.first_name} ${c.last_name}`,
                secondary: `${c.email}${c.companies?.company_name ? ' · ' + c.companies.company_name : ''}`,
              }))}
              onRemove={(id) => togglePerson(id)}
              onConfirm={submitAdd}
              onBack={() => setAddStep('select')}
              confirming={submittingAdd}
              confirmLabel={`Confirm & add ${selectedPersonIds.size > 0 ? selectedPersonIds.size : ''}`}
            />
          ) : (
            <>
              {/* Sticky bar — appears the moment anyone is checked, stays pinned
                  to the top of the scroll area so it's visible without scrolling
                  down to the bottom of the candidate list. */}
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

              {candidatesLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading people…</div>}
              {!candidatesLoading && (
                <div className="crm-table-wrap" style={{ marginBottom: 16 }}>
                  <table className="crm-table">
                    <thead><tr>{['', 'Name', 'Email', 'Job title', 'Company', 'Country'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {paginate(candidates, candidatePage).map(c => (
                        <tr key={c.person_id} onClick={() => togglePerson(c.person_id)} style={{ cursor: 'pointer' }}>
                          <td><input type="checkbox" checked={selectedPersonIds.has(c.person_id)} onChange={() => togglePerson(c.person_id)} onClick={e => e.stopPropagation()} /></td>
                          <td>{c.first_name} {c.last_name}</td>
                          <td>{c.email}</td>
                          <td>{c.job_title || '—'}</td>
                          <td>{c.companies?.company_name || '—'}</td>
                          <td>{c.country || '—'}</td>
                        </tr>
                      ))}
                      {candidates.length === 0 && <tr className="crm-empty-row"><td colSpan={6}>Everyone matching this filter is already on the event.</td></tr>}
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

// ============================================================================
// CREATE — Event / Person / Lead forms matching the real schema.
// Event is first since that's usually the starting point of a campaign.
// Company is inline search-and-select against Supabase rather than a
// free-typed ID; Lead creation is filter + multi-select, not a manual form.
// ============================================================================
function CreatePage({ showToast }) {
  const [tab, setTab] = useState('event')
  return (
    <div className={tab === 'lead' ? '' : 'crm-create-wrap'}>
      <div className="crm-tabs">
        {[{ k: 'event', l: 'Event' }, { k: 'person', l: 'Person' }, { k: 'lead', l: 'Lead' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`crm-tab-btn${tab === t.k ? ' active' : ''}`}>{t.l}</button>
        ))}
      </div>
      {tab === 'event' && <EventForm showToast={showToast} />}
      {tab === 'person' && <PersonForm showToast={showToast} />}
      {tab === 'lead' && <LeadBulkCreate showToast={showToast} />}
    </div>
  )
}

function FieldLabel({ children }) {
  return <label className="crm-field-label">{children}</label>
}

// Lightweight inline company search — types a name, gets matches, picks one.
function CompanyPicker({ value, onChange }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('companies').select('company_id, company_name').ilike('company_name', `%${query}%`).limit(8)
      setResults(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="crm-input"
        placeholder="Search company by name…"
        value={value ? value.company_name : query}
        onChange={e => { onChange(null); setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, marginTop: 4, maxHeight: 180, overflow: 'auto' }}>
          {results.map(c => (
            <div
              key={c.company_id}
              style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
              onClick={() => { onChange(c); setQuery(''); setOpen(false) }}
            >
              {c.company_name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PersonForm({ showToast }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', job_title: '', country: '', phone: '', mobile: '', linkedin_url: '' })
  const [company, setCompany] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (!form.first_name || !form.email) return
    setSubmitting(true)
    const { error } = await supabase.from('people').insert({ ...form, company_id: company?.company_id || null })
    setSubmitting(false)
    if (error) { showToast(`Couldn't add person: ${error.message}`, true); return }
    setForm({ first_name: '', last_name: '', email: '', job_title: '', country: '', phone: '', mobile: '', linkedin_url: '' })
    setCompany(null)
    showToast('Person added')
  }

  return (
    <form onSubmit={submit} className="crm-form">
      <div className="crm-form-row">
        <div><FieldLabel>First name</FieldLabel><input required value={form.first_name} onChange={set('first_name')} className="crm-input" /></div>
        <div><FieldLabel>Last name</FieldLabel><input value={form.last_name} onChange={set('last_name')} className="crm-input" /></div>
      </div>
      <div><FieldLabel>Email</FieldLabel><input required type="email" value={form.email} onChange={set('email')} className="crm-input" /></div>
      <div className="crm-form-row">
        <div><FieldLabel>Job title</FieldLabel><input value={form.job_title} onChange={set('job_title')} className="crm-input" /></div>
        <div><FieldLabel>Country</FieldLabel><input value={form.country} onChange={set('country')} className="crm-input" /></div>
      </div>
      <div><FieldLabel>Company</FieldLabel><CompanyPicker value={company} onChange={setCompany} /></div>
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

// Same interaction pattern as Attendees: filter/search people, multi-select
// (checkboxes, select-all-filtered, clear), set the shared lead fields once,
// a sticky confirm bar the moment anyone is selected, review exactly who's
// selected, then one bulk insert into `leads`.
function LeadBulkCreate({ showToast }) {
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [candidatePage, setCandidatePage] = useState(1)
  const [selectedPersonIds, setSelectedPersonIds] = useState(new Set())
  const [step, setStep] = useState('select') // 'select' | 'confirm'
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    lead_purpose: '', lead_status: 'New', nurture_stage: '', owner: '',
    cold_calling: false, social_media: false, email_campaign: false, notes: '',
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    setCandidatePage(1)
    ;(async () => {
      setCandidatesLoading(true)
      let query = supabase.from('people').select('person_id, first_name, last_name, email, job_title, country, company_id, companies(company_name)').limit(200)
      if (search.trim()) {
        const q = search.trim()
        query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
      }
      const { data, error } = await query
      if (error) showToast(`Couldn't load people: ${error.message}`, true)
      else setCandidates(data || [])
      setCandidatesLoading(false)
    })()
  }, [search, showToast])

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

  const submit = async () => {
    setSubmitting(true)
    const rows = candidates
      .filter(c => selectedPersonIds.has(c.person_id))
      .map(c => ({
        person_id: c.person_id,
        company_id: c.company_id || null,
        event_id: null, // not tagging an event from this flow yet — add an event picker here if leads should be scoped to one
        ...form,
      }))
    const { error } = await supabase.from('leads').insert(rows)
    setSubmitting(false)
    if (error) { showToast(`Couldn't create leads: ${error.message}`, true); return }
    showToast(`${rows.length} ${rows.length === 1 ? 'lead' : 'leads'} created`)
    setSelectedPersonIds(new Set())
    setStep('select')
  }

  if (step === 'confirm') {
    return (
      <ConfirmSelectionPanel
        heading={`Confirm ${selectedPersonIds.size} ${selectedPersonIds.size === 1 ? 'lead' : 'leads'}`}
        note="These fields will be applied to every person below. Remove anyone who shouldn't become a lead yet."
        summary={[
          { label: 'Purpose', value: form.lead_purpose || '—' },
          { label: 'Status', value: form.lead_status },
          { label: 'Nurture', value: form.nurture_stage || '—' },
          { label: 'Owner', value: form.owner || '—' },
          { label: 'Channels', value: [form.cold_calling && 'Cold call', form.social_media && 'Social', form.email_campaign && 'Email'].filter(Boolean).join(', ') || 'None' },
        ]}
        items={candidates.filter(c => selectedPersonIds.has(c.person_id)).map(c => ({
          id: c.person_id,
          primary: `${c.first_name} ${c.last_name}`,
          secondary: `${c.email}${c.companies?.company_name ? ' · ' + c.companies.company_name : ''}`,
        }))}
        onRemove={(id) => togglePerson(id)}
        onConfirm={submit}
        onBack={() => setStep('select')}
        confirming={submitting}
        confirmLabel={`Confirm & create ${selectedPersonIds.size > 0 ? selectedPersonIds.size : ''}`}
      />
    )
  }

  return (
    <div>
      {/* Sticky bar — appears the instant anyone is checked below, pinned to
          the top so you never have to scroll down to submit. */}
      <SelectionBar
        count={selectedPersonIds.size}
        noun="selected"
        label={`Review & create ${selectedPersonIds.size}`}
        onConfirm={() => setStep('confirm')}
      />

      <div className="crm-form" style={{ marginBottom: 20 }}>
        <div className="crm-form-row">
          <div><FieldLabel>Purpose</FieldLabel><input value={form.lead_purpose} onChange={set('lead_purpose')} className="crm-input" placeholder="e.g. Outreach" /></div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <select value={form.lead_status} onChange={set('lead_status')} className="crm-select">
              {LEAD_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="crm-form-row">
          <div>
            <FieldLabel>Nurture stage</FieldLabel>
            <select value={form.nurture_stage} onChange={set('nurture_stage')} className="crm-select">
              <option value="">—</option>
              {NURTURE_STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><FieldLabel>Owner</FieldLabel><input value={form.owner} onChange={set('owner')} className="crm-input" /></div>
        </div>
        <div>
          <FieldLabel>Outreach channels</FieldLabel>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label className="crm-checkbox-row"><input type="checkbox" checked={form.cold_calling} onChange={e => setForm({ ...form, cold_calling: e.target.checked })} /> Cold calling</label>
            <label className="crm-checkbox-row"><input type="checkbox" checked={form.social_media} onChange={e => setForm({ ...form, social_media: e.target.checked })} /> Social / LinkedIn</label>
            <label className="crm-checkbox-row"><input type="checkbox" checked={form.email_campaign} onChange={e => setForm({ ...form, email_campaign: e.target.checked })} /> Email campaign</label>
          </div>
        </div>
        <div><FieldLabel>Notes (applied to all selected)</FieldLabel><textarea value={form.notes} onChange={set('notes')} className="crm-textarea" /></div>
      </div>

      <div className="crm-toolbar">
        <div className="crm-search-box">
          <Search size={15} style={{ color: 'var(--ink-400)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter people by name or email…" />
        </div>
        <button className="crm-toggle-chip" onClick={selectAllFiltered}>Select all filtered ({candidates.length})</button>
        {selectedPersonIds.size > 0 && <button className="crm-toggle-chip" onClick={clearSelection}>Clear selection</button>}
        <span className="crm-count-note">{selectedPersonIds.size} selected</span>
      </div>

      {candidatesLoading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading people…</div>}
      {!candidatesLoading && (
        <div className="crm-table-wrap" style={{ marginBottom: 16 }}>
          <table className="crm-table">
            <thead><tr>{['', 'Name', 'Email', 'Job title', 'Company', 'Country'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {paginate(candidates, candidatePage).map(c => (
                <tr key={c.person_id} onClick={() => togglePerson(c.person_id)} style={{ cursor: 'pointer' }}>
                  <td><input type="checkbox" checked={selectedPersonIds.has(c.person_id)} onChange={() => togglePerson(c.person_id)} onClick={e => e.stopPropagation()} /></td>
                  <td>{c.first_name} {c.last_name}</td>
                  <td>{c.email}</td>
                  <td>{c.job_title || '—'}</td>
                  <td>{c.companies?.company_name || '—'}</td>
                  <td>{c.country || '—'}</td>
                </tr>
              ))}
              {candidates.length === 0 && <tr className="crm-empty-row"><td colSpan={6}>No one matches this filter.</td></tr>}
            </tbody>
          </table>
          <Pagination page={candidatePage} setPage={setCandidatePage} total={candidates.length} />
        </div>
      )}
    </div>
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
