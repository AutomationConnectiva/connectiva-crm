import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase'
import {
  Users, UserPlus, Calendar, Target, Menu, X, Search,
  Clock, Check, Save, XCircle, Loader2,
  UserCheck, Trash2, LogOut, ArrowLeft, Eye, Pencil, ChevronDown, ChevronUp
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Fixed pick-lists. These are UI constants (dropdown options), not fake rows —
// swap the arrays' contents to match your real values whenever you confirm them.
// ---------------------------------------------------------------------------
const LEAD_STATUS_OPTIONS = ['New', 'Contacted', 'Unsubscribed']
const NURTURE_STAGE_OPTIONS = ['Cold', 'Warming', 'Outreach']
const CHANNEL_STAGE_OPTIONS = ['Not started', 'In progress', 'Responded', 'Converted']
const CHANNEL_RESPONSE_OPTIONS = ['Waiting', 'Accepted', 'Declined']
const EVENT_STATUS_OPTIONS = ['Planned', 'Active', 'Completed', 'Cancelled']
const PARTICIPANT_ROLE_OPTIONS = ['Attendee', 'Speaker', 'Sponsor', 'Organizer']
const PARTICIPANT_STATUS_OPTIONS = ['Invited', 'Confirmed', 'Attended', 'Cancelled']

// NOTE ON SCHEMA CHANGE: each outreach channel now tracks two things —
// a STAGE (where the automation is: Not started / In progress / Responded /
// Converted) and a RESPONSE (what the person actually said: Waiting /
// Accepted / Declined). That's 6 text columns total on `leads`, default
// 'Not started' / 'Waiting'. If your Supabase table doesn't have the
// response columns yet, add them, e.g.:
//   alter table leads add column cold_calling_response text default 'Waiting';
//   alter table leads add column email_campaign_response text default 'Waiting';
//   alter table leads add column social_media_response text default 'Waiting';
const CHANNEL_FIELDS = [
  { key: 'cold_calling_stage', responseKey: 'cold_calling_response', label: 'Cold calling' },
  { key: 'email_campaign_stage', responseKey: 'email_campaign_response', label: 'Email' },
  { key: 'social_media_stage', responseKey: 'social_media_response', label: 'Social / LinkedIn' },
]
const DEFAULT_CHANNEL_STAGES = CHANNEL_FIELDS.reduce((acc, cf) => ({ ...acc, [cf.key]: 'Not started' }), {})

// Defaults applied when converting people to leads in bulk from the People
// page. Every channel starts ON (meaning: start tracking it, at "Not
// started") unless turned off — either for the whole batch, or as a
// one-off exception for a specific person.
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
  .crm-lead-tag { font-size: 10.5px; font-weight: 600; color: var(--accent-ink); background: var(--accent-soft); padding: 2px 8px; border-radius: 999px; margin-left: 8px; }

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

  /* ---------- People page: side-by-side convert-to-lead panel ---------- */
  .crm-split-layout { display: flex; gap: 20px; align-items: flex-start; }
  .crm-split-main { flex: 1; min-width: 0; }
  .crm-split-side { width: 320px; flex-shrink: 0; position: sticky; top: 0; }
  @media (max-width: 980px) { .crm-split-layout { flex-direction: column; } .crm-split-side { width: 100%; position: static; } }
  .crm-side-panel { border: 1px solid var(--line); background: var(--surface); border-radius: 16px; padding: 18px; }
  .crm-channel-toggles { display: flex; gap: 8px; flex-wrap: wrap; }
  .crm-channel-toggle { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent-ink); cursor: pointer; user-select: none; white-space: nowrap; }
  .crm-channel-toggle.off { border-color: var(--line); background: var(--paper); color: var(--ink-400); }

  /* ---------- Quick convert-to-lead modal (person detail page) ---------- */
  .crm-modal-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .crm-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.45); }
  .crm-modal-card { position: relative; background: var(--surface); border-radius: 16px; padding: 24px; width: 100%; max-width: 480px; max-height: 88vh; overflow: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.28); }
`

// ---------------------------------------------------------------------------
// Status/stage badge coloring — purely presentational, driven by whatever
// value is actually in the DB, not a hardcoded row.
// ---------------------------------------------------------------------------
function badgeTone(value) {
  const v = (value || '').toLowerCase()

  if (['converted', 'accepted'].includes(v))
    return { bg: 'var(--accent-ink)', fg: '#fff' }

  if (v === 'declined')
    return { bg: 'var(--red-soft)', fg: 'var(--red)' }

  if (['contacted', 'warming', 'outreach', 'responded', 'in progress'].includes(v))
    return { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }

  if (v === 'unsubscribed')
    return { bg: 'var(--red-soft)', fg: 'var(--red)' }

  if (['new', 'cold', 'not started', 'waiting'].includes(v))
    return { bg: 'var(--line)', fg: 'var(--ink-700)' }

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

// Small modal used for the "single-person, fully editable" convert-to-lead
// flow from a person's detail page. Pre-filled with sane defaults; every
// field stays editable before it writes anything.
function QuickConvertModal({ person, onClose, onConfirm, creating }) {
  const [form, setForm] = useState({
    lead_purpose: '',
    lead_status: 'New',
    nurture_stage: 'Outreach',
    owner: '',
    notes: '',
    cold_calling_stage: 'Not started',
    cold_calling_response: 'Waiting',
    email_campaign_stage: 'Not started',
    email_campaign_response: 'Waiting',
    social_media_stage: 'Not started',
    social_media_response: 'Waiting',
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

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
            <FieldLabel>Outreach — starting stage per channel</FieldLabel>
            <div className="crm-channel-grid">
              {CHANNEL_FIELDS.map(cf => (
                <div key={cf.key}>
                  <div style={{ fontSize: 12, color: 'var(--ink-700)', marginBottom: 6 }}>{cf.label}</div>
                  <select className="crm-select" value={form[cf.key]} onChange={set(cf.key)}>
                    {CHANNEL_STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div><FieldLabel>Notes</FieldLabel><textarea className="crm-textarea" value={form.notes} onChange={set('notes')} /></div>
        </div>

        <div className="crm-confirm-actions" style={{ marginTop: 18 }}>
          <button className="crm-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="crm-submit-btn" style={{ width: 'auto', padding: '10px 20px' }} onClick={() => onConfirm(form)} disabled={creating}>
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
  const [toast, setToast] = useState(null) // { message, error }

  // detail = null | { type: 'person' | 'lead', id }
  // When set, a full-page detail view replaces the current page's content.
  const [detail, setDetail] = useState(null)
  const openPerson = (id) => setDetail({ type: 'person', id })
  const openLead = (id) => setDetail({ type: 'lead', id })
  const closeDetail = () => setDetail(null)

  const showToast = (message, error = false) => setToast({ message, error })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
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
            <PersonDetailPage personId={detail.id} showToast={showToast} onOpenLead={openLead} />
          )}
          {detail && detail.type === 'lead' && (
            <LeadDetailPage leadId={detail.id} showToast={showToast} onOpenPerson={openPerson} />
          )}
          {!detail && activePage === 'people' && (
            <PeoplePage showToast={showToast} onOpenPerson={openPerson} sidebarCollapsed={collapsed} setSidebarCollapsed={setCollapsed} />
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
// ============================================================================
function PeoplePage({ showToast, onOpenPerson, sidebarCollapsed, setSidebarCollapsed }) {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [peoplePage, setPeoplePage] = useState(1)

  // Existing leads, keyed by person_id -> Set of event_ids they're already
  // linked to (a bare lead with no event uses the 'NONE' key). Drives both
  // the "Lead" tag and which rows get disabled for the currently chosen event.
  const [leadEventMap, setLeadEventMap] = useState(new Map())
  const leadPersonIds = useMemo(() => new Set(leadEventMap.keys()), [leadEventMap])

  // Events to link new leads to. Picking one disables anyone already a lead
  // for that specific event (so you can't create a duplicate), while still
  // leaving them selectable for a different event.
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [linkEventId, setLinkEventId] = useState('')

  // Single-row inline edit (pencil icon).
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)

  // Bulk convert-to-lead flow: 'browse' | 'select'. The side panel only
  // appears once at least one person is checked — it stays hidden otherwise.
  const [mode, setMode] = useState('browse')
  const [selectedPersonIds, setSelectedPersonIds] = useState(new Set())
  const [converting, setConverting] = useState(false)

  // Bulk defaults for the three outreach channels — every channel starts ON.
  const [channelDefaults, setChannelDefaults] = useState(ALL_CHANNELS_ON)
  const [channelExceptions, setChannelExceptions] = useState(new Map())

  // Remembers whether the sidebar was already collapsed before we entered
  // convert mode, so leaving it restores exactly how it was.
  const wasSidebarCollapsedRef = useRef(sidebarCollapsed)

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('people')
      .select('*, companies(company_name)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setPeople(data || [])
    setLoading(false)
  }, [])

  const fetchLeadEventMap = useCallback(async () => {
    const { data, error } = await supabase.from('leads').select('person_id, event_id')
    if (!error) {
      const map = new Map()
      ;(data || []).forEach(r => {
        const key = r.event_id || 'NONE'
        if (!map.has(r.person_id)) map.set(r.person_id, new Set())
        map.get(r.person_id).add(key)
      })
      setLeadEventMap(map)
    }
  }, [])

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true)
    const { data, error } = await supabase.from('events').select('event_id, event_name, start_date').order('start_date', { ascending: false })
    if (!error) setEvents(data || [])
    setEventsLoading(false)
  }, [])

  useEffect(() => { fetchPeople(); fetchLeadEventMap(); fetchEvents() }, [fetchPeople, fetchLeadEventMap, fetchEvents])

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

  useEffect(() => { setPeoplePage(1) }, [search])

  // A person is off-limits for the currently selected event if they're
  // already a lead tied to that same event (or already a bare/no-event lead,
  // when no event is chosen here).
  const isAlreadyLeadForEvent = (personId) => {
    const key = linkEventId || 'NONE'
    return leadEventMap.get(personId)?.has(key) || false
  }

  // ---- single-row inline edit ----
  const startEdit = (p) => {
    setEditingId(p.person_id)
    setEditForm({
      first_name: p.first_name || '', last_name: p.last_name || '', email: p.email || '',
      job_title: p.job_title || '', country: p.country || '', status: p.status || '',
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditForm(null) }
  const saveEdit = async (personId) => {
    setSaving(true)
    const { error } = await supabase.from('people').update({ ...editForm, updated_at: new Date().toISOString() }).eq('person_id', personId)
    setSaving(false)
    if (error) { showToast(`Couldn't save: ${error.message}`, true); return }
    setPeople(prev => prev.map(p => (p.person_id === personId ? { ...p, ...editForm } : p)))
    setEditingId(null)
    setEditForm(null)
    showToast('Person updated')
  }

  // ---- bulk convert-to-lead ----
  const startConvert = () => {
    wasSidebarCollapsedRef.current = sidebarCollapsed
    setSidebarCollapsed(true)
    setMode('select')
    setSelectedPersonIds(new Set())
    setChannelDefaults(ALL_CHANNELS_ON)
    setChannelExceptions(new Map())
    setLinkEventId('')
    cancelEdit()
  }
  const cancelConvert = () => {
    setSidebarCollapsed(wasSidebarCollapsedRef.current)
    setMode('browse')
    setSelectedPersonIds(new Set())
    setChannelExceptions(new Map())
  }
  const togglePerson = (personId) => {
    if (isAlreadyLeadForEvent(personId)) return
    setSelectedPersonIds(prev => {
      const next = new Set(prev)
      if (next.has(personId)) next.delete(personId)
      else next.add(personId)
      return next
    })
  }
  const removeFromSelection = (personId) => {
    togglePerson(personId)
    setChannelExceptions(prev => {
      if (!prev.has(personId)) return prev
      const next = new Map(prev)
      next.delete(personId)
      return next
    })
  }
  const selectAllFiltered = () => setSelectedPersonIds(new Set(filtered.filter(p => !isAlreadyLeadForEvent(p.person_id)).map(p => p.person_id)))
  const clearSelection = () => { setSelectedPersonIds(new Set()); setChannelExceptions(new Map()) }

  // Switching which event these leads link to may invalidate some picks —
  // drop anyone who's already a lead for the newly chosen event.
  const handleLinkEventChange = (e) => {
    const newEventId = e.target.value
    const key = newEventId || 'NONE'
    setSelectedPersonIds(prev => {
      const next = new Set(prev)
      prev.forEach(id => { if (leadEventMap.get(id)?.has(key)) next.delete(id) })
      return next
    })
    setLinkEventId(newEventId)
  }

  // Flips a channel for everyone in this batch at once.
  const toggleChannelDefault = (key) => setChannelDefaults(prev => ({ ...prev, [key]: !prev[key] }))

  // Flips a channel for just one person, as an exception to the batch default.
  const toggleChannelException = (personId, key) => {
    setChannelExceptions(prev => {
      const next = new Map(prev)
      const set = new Set(next.get(personId) || [])
      if (set.has(key)) set.delete(key)
      else set.add(key)
      next.set(personId, set)
      return next
    })
  }
  const effectiveChannelValue = (personId, key) => {
    const isException = channelExceptions.get(personId)?.has(key)
    return isException ? !channelDefaults[key] : channelDefaults[key]
  }

  const submitConvert = async () => {
    setConverting(true)
    const eventIdToLink = linkEventId || null
    const rows = people
      .filter(p => selectedPersonIds.has(p.person_id))
      .map(p => {
        const row = {
          person_id: p.person_id,
          company_id: p.company_id || null,
          event_id: eventIdToLink,
          lead_status: 'New',
          nurture_stage: 'Outreach',
        }
        // Only set a channel's fields if it's effectively "on" for this
        // person — that starts the stage at "Not started" and the response
        // at "Waiting". Left off, both fields stay unset, meaning that
        // channel isn't being pursued for them at all.
        CHANNEL_FIELDS.forEach(cf => {
          if (effectiveChannelValue(p.person_id, cf.key)) {
            row[cf.key] = 'Not started'
            row[cf.responseKey] = 'Waiting'
          }
        })
        return row
      })
    const { error } = await supabase.from('leads').insert(rows)
    setConverting(false)
    if (error) { showToast(`Couldn't create leads: ${error.message}`, true); return }
    setLeadEventMap(prev => {
      const next = new Map(prev)
      const key = eventIdToLink || 'NONE'
      rows.forEach(r => {
        const set = new Set(next.get(r.person_id) || [])
        set.add(key)
        next.set(r.person_id, set)
      })
      return next
    })
    showToast(`${rows.length} ${rows.length === 1 ? 'lead' : 'leads'} created`)
    setSidebarCollapsed(wasSidebarCollapsedRef.current)
    setMode('browse')
    setSelectedPersonIds(new Set())
    setChannelExceptions(new Map())
  }

  const selecting = mode === 'select'

  const table = (
    <div>
      <div className="crm-toolbar">
        <div className="crm-search-box">
          <Search size={15} style={{ color: 'var(--ink-400)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company, title, country…" />
        </div>

        {selecting ? (
          <>
            <select className="crm-filter-select" value={linkEventId} onChange={handleLinkEventChange} disabled={eventsLoading}>
              <option value="">No event (general lead)</option>
              {events.map(e => <option key={e.event_id} value={e.event_id}>{e.event_name} ({formatDate(e.start_date)})</option>)}
            </select>
            <button className="crm-toggle-chip" onClick={selectAllFiltered}>Select all filtered ({filtered.filter(p => !isAlreadyLeadForEvent(p.person_id)).length})</button>
            {selectedPersonIds.size > 0 && <button className="crm-toggle-chip" onClick={clearSelection}>Clear selection</button>}
            <button className="crm-btn-secondary" onClick={cancelConvert}>Cancel</button>
          </>
        ) : (
          <button className="crm-submit-btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={startConvert}>
            <UserPlus size={15} /> Convert to lead
          </button>
        )}

        <span className="crm-count-note">{filtered.length} of {people.length}</span>
      </div>

      {loading && <div className="crm-loading"><Loader2 size={16} className="crm-spin" /> Loading people…</div>}
      {error && <div className="crm-error">Couldn't load people: {error}</div>}

      {!loading && !error && (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                {selecting && <th style={{ width: 36 }}></th>}
                <th>Name</th>
                <th>Email</th>
                <th>Job title</th>
                <th>Company</th>
                <th>Country</th>
                <th>Status</th>
                {!selecting && <th></th>}
              </tr>
            </thead>
            <tbody>
              {paginate(filtered, peoplePage).map(p => {
                const av = avatarStyle(p.first_name + p.last_name)
                const alreadyLead = leadPersonIds.has(p.person_id)
                const isEditing = !selecting && editingId === p.person_id
                const disabledForEvent = selecting && isAlreadyLeadForEvent(p.person_id)

                if (isEditing) {
                  return (
                    <tr key={p.person_id} className="editing">
                      <td>
                        <input className="crm-cell-input" value={editForm.first_name} onChange={e => setEditForm({ ...editForm, first_name: e.target.value })} placeholder="First name" />
                        <input className="crm-cell-input" value={editForm.last_name} onChange={e => setEditForm({ ...editForm, last_name: e.target.value })} placeholder="Last name" />
                      </td>
                      <td><input className="crm-cell-input" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></td>
                      <td><input className="crm-cell-input" value={editForm.job_title} onChange={e => setEditForm({ ...editForm, job_title: e.target.value })} /></td>
                      <td>{p.companies?.company_name || '—'}</td>
                      <td><input className="crm-cell-input" value={editForm.country} onChange={e => setEditForm({ ...editForm, country: e.target.value })} /></td>
                      <td><input className="crm-cell-input" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} /></td>
                      <td>
                        <div className="crm-row-actions">
                          <button className="crm-icon-action save" onClick={() => saveEdit(p.person_id)} disabled={saving} aria-label="Save">
                            {saving ? <Loader2 size={14} className="crm-spin" /> : <Save size={14} />}
                          </button>
                          <button className="crm-icon-action cancel" onClick={cancelEdit} aria-label="Cancel"><XCircle size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr
                    key={p.person_id}
                    className={`clickable${disabledForEvent ? ' disabled' : ''}`}
                    onClick={() => {
                      if (selecting) { if (!disabledForEvent) togglePerson(p.person_id) }
                      else onOpenPerson(p.person_id)
                    }}
                    title={disabledForEvent ? 'Already a lead for this event' : undefined}
                  >
                    {selecting && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedPersonIds.has(p.person_id)}
                          disabled={disabledForEvent}
                          onChange={() => togglePerson(p.person_id)}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                    )}
                    <td>
                      <div className="crm-name-cell">
                        <div className="crm-avatar" style={{ background: av.bg, color: av.fg }}>{initials(p.first_name, p.last_name)}</div>
                        <span>{p.first_name} {p.last_name}</span>
                        {alreadyLead && <span className="crm-lead-tag">Lead</span>}
                      </div>
                    </td>
                    <td>{p.email}</td>
                    <td>{p.job_title || '—'}</td>
                    <td>{p.companies?.company_name || '—'}</td>
                    <td>{p.country || '—'}</td>
                    <td><Badge value={p.status} /></td>
                    {!selecting && (
                      <td>
                        <button className="crm-icon-action" onClick={(e) => { e.stopPropagation(); startEdit(p) }} aria-label="Edit person" title="Edit">
                          <Pencil size={14} />
                        </button>
                      </td>
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

  // The side panel stays hidden entirely until at least one person is picked.
  if (!selecting || selectedPersonIds.size === 0) return table

  const selectedItems = people
    .filter(p => selectedPersonIds.has(p.person_id))
    .map(p => ({
      id: p.person_id,
      primary: `${p.first_name} ${p.last_name}`,
      secondary: `${p.email}${p.companies?.company_name ? ' · ' + p.companies.company_name : ''}`,
    }))

  return (
    <div className="crm-split-layout">
      <div className="crm-split-main">{table}</div>

      <div className="crm-split-side">
        <div className="crm-side-panel">
          <h4 className="crm-confirm-heading">{selectedPersonIds.size} selected</h4>
          <p className="crm-confirm-note">
            Every channel starts on for everyone. Click a chip below to turn a channel off for the whole batch, or click a person's chip to except just them.
          </p>

          <div className="crm-channel-toggles" style={{ marginBottom: 16 }}>
            {CHANNEL_FIELDS.map(cf => (
              <button
                key={cf.key}
                type="button"
                className={`crm-channel-toggle${channelDefaults[cf.key] ? '' : ' off'}`}
                onClick={() => toggleChannelDefault(cf.key)}
              >
                {channelDefaults[cf.key] ? <Check size={11} /> : <X size={11} />} {cf.label}
              </button>
            ))}
          </div>

          <div className="crm-confirm-list">
            {selectedItems.map(item => (
              <div key={item.id} className="crm-confirm-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div className="crm-confirm-row-name">{item.primary}</div>
                    <div className="crm-confirm-row-sub">{item.secondary}</div>
                  </div>
                  <button className="crm-remove-x" onClick={() => removeFromSelection(item.id)} aria-label={`Remove ${item.primary}`}>
                    <X size={14} />
                  </button>
                </div>
                <div className="crm-channel-toggles">
                  {CHANNEL_FIELDS.map(cf => {
                    const on = effectiveChannelValue(item.id, cf.key)
                    return (
                      <button
                        key={cf.key}
                        type="button"
                        className={`crm-channel-toggle${on ? '' : ' off'}`}
                        onClick={() => toggleChannelException(item.id, cf.key)}
                      >
                        {on ? <Check size={10} /> : <X size={10} />} {cf.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <button className="crm-submit-btn" onClick={submitConvert} disabled={converting}>
            {converting ? <Loader2 size={15} className="crm-spin" /> : <Check size={15} />} Confirm & create {selectedPersonIds.size}
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
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [activeOnly, setActiveOnly] = useState(true) // default on, per your call
  const [leadsPage, setLeadsPage] = useState(1)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('leads')
      .select('*, people(first_name, last_name)')
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
      // "Active" = not Unsubscribed. Flag if this definition should differ.
      if (activeOnly && l.lead_status === 'Unsubscribed') return false
      if (!q) return true
      const personName = `${l.people?.first_name || ''} ${l.people?.last_name || ''}`
      return `${personName} ${l.lead_purpose || ''} ${l.owner || ''}`.toLowerCase().includes(q)
    })
  }, [leads, search, statusFilter, activeOnly])

  useEffect(() => { setLeadsPage(1) }, [search, statusFilter, activeOnly])

  return (
    <div>
      <div className="crm-toolbar">
        <div className="crm-search-box">
          <Search size={15} style={{ color: 'var(--ink-400)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search person, purpose, owner…" />
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
                {['Person', 'Purpose', 'Status', 'Nurture', 'Owner', 'Cold calling', 'Email', 'Social', ''].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {paginate(filtered, leadsPage).map(l => {
                const personName = `${l.people?.first_name || ''} ${l.people?.last_name || ''}`.trim() || '—'
                return (
                  <tr key={l.lead_id} className="clickable" onClick={() => onOpenLead(l.lead_id)}>
                    <td style={{ fontWeight: 500, color: 'var(--ink-950)' }}>{personName}</td>
                    <td>{l.lead_purpose || '—'}</td>
                    <td><Badge value={l.lead_status} /></td>
                    <td><Badge value={l.nurture_stage} /></td>
                    <td>{l.owner || '—'}</td>
                       <td><Badge value={l.cold_calling_stage} /></td>
                       <td><Badge value={l.email_campaign_stage} /></td>
                       <td><Badge value={l.social_media_stage} /></td>
                    <td>
                      <button className="crm-icon-action" onClick={(e) => { e.stopPropagation(); onOpenLead(l.lead_id) }} aria-label="View details">
                        <Eye size={14} />
                      </button>
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
function PersonDetailPage({ personId, showToast, onOpenLead }) {
  const [person, setPerson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [company, setCompany] = useState(null)
  const [saving, setSaving] = useState(false)

  const [leads, setLeads] = useState([])
  const [leadsLoading, setLeadsLoading] = useState(true)

  // Events this specific person is attached to (event_participants rows),
  // shown as a collapsible section alongside their leads.
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
      .select('*, companies(company_id, company_name)')
      .eq('person_id', personId)
      .single()
    if (error) setError(error.message)
    else {
      setPerson(data)
      setForm({
        first_name: data.first_name || '', last_name: data.last_name || '', email: data.email || '',
        job_title: data.job_title || '', country: data.country || '', phone: data.phone || '',
        mobile: data.mobile || '', linkedin_url: data.linkedin_url || '', status: data.status || '',
      })
      setCompany(data.companies ? { company_id: data.companies.company_id, company_name: data.companies.company_name } : null)
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
    const { error } = await supabase
      .from('people')
      .update({ ...form, company_id: company?.company_id || null, updated_at: new Date().toISOString() })
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
    showToast('Lead created')
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
        <div className="crm-form-row">
          <div><FieldLabel>Job title</FieldLabel><input className="crm-input" value={form.job_title} onChange={set('job_title')} /></div>
          <div><FieldLabel>Country</FieldLabel><input className="crm-input" value={form.country} onChange={set('country')} /></div>
        </div>
        <div><FieldLabel>Company</FieldLabel><CompanyPicker value={company} onChange={setCompany} /></div>
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
          person={{ first_name: form.first_name, last_name: form.last_name }}
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
// per lead so you get a full overview without navigating away). Response is
// shown as a read-only badge next to the stage — it reflects what the
// outreach automation recorded, not something edited by hand here.
// ============================================================================
function LeadDetailCard({ leadId, showToast, onOpenPerson, hidePersonChip }) {
  const [lead, setLead] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('leads')
      .select('*, people(person_id, first_name, last_name, email), companies(company_name), events(event_name)')
      .eq('lead_id', leadId)
      .single()
    if (error) setError(error.message)
    else {
      setLead(data)
      setForm({
        lead_status: data.lead_status || '', lead_purpose: data.lead_purpose || '',
        nurture_stage: data.nurture_stage || '', owner: data.owner || '', notes: data.notes || '',
        cold_calling_stage: data.cold_calling_stage || 'Not started',
        cold_calling_response: data.cold_calling_response || 'Waiting',
        email_campaign_stage: data.email_campaign_stage || 'Not started',
        email_campaign_response: data.email_campaign_response || 'Waiting',
        social_media_stage: data.social_media_stage || 'Not started',
        social_media_response: data.social_media_response || 'Waiting',
      })
    }
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

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
          <div><FieldLabel>Purpose</FieldLabel><input className="crm-input" value={form.lead_purpose} onChange={set('lead_purpose')} /></div>
          <div><FieldLabel>Owner</FieldLabel><input className="crm-input" value={form.owner} onChange={set('owner')} /></div>
        </div>

        <div>
          <FieldLabel>Outreach progress</FieldLabel>
          <div className="crm-channel-grid">
            {CHANNEL_FIELDS.map(cf => (
              <div key={cf.key}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-700)', marginBottom: 6 }}>{cf.label}</div>
                <select className="crm-select" value={form[cf.key]} onChange={set(cf.key)} style={{ marginBottom: 6 }}>
                  {CHANNEL_STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <Badge value={form[cf.responseKey]} />
              </div>
            ))}
          </div>
        </div>

        <div><FieldLabel>Notes</FieldLabel><textarea className="crm-textarea" value={form.notes} onChange={set('notes')} /></div>

        <button className="crm-submit-btn" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={15} className="crm-spin" /> : <Save size={15} />} Save changes
        </button>
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
// multi-select. Unchanged from before.
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
// CREATE — Event / Person forms matching the real schema. Lead creation now
// lives entirely on the People page ("Convert to lead"), so there's no Lead
// tab here — see the note below.
// ============================================================================
function CreatePage({ showToast }) {
  const [tab, setTab] = useState('event')
  return (
    <div className="crm-create-wrap">
      <div className="crm-tabs">
        {[{ k: 'event', l: 'Event' }, { k: 'person', l: 'Person' }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`crm-tab-btn${tab === t.k ? ' active' : ''}`}>{t.l}</button>
        ))}
      </div>
      {tab === 'event' && <EventForm showToast={showToast} />}
      {tab === 'person' && <PersonForm showToast={showToast} />}
      <p style={{ fontSize: 12.5, color: 'var(--ink-400)', marginTop: 14 }}>
        Want to create leads? Head to the People page and use "Convert to lead" — you can select multiple people at once from there.
      </p>
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
