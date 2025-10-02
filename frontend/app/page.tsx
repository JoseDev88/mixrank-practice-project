'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type AppItem = {
  id: number;
  name: string;
  category: string;
  rating: number;
  installs: number;
  platform: string;
};

type PageDTO = {
  items: AppItem[];
  total: number;
  page: number;
  page_size: number;
};

// Read API base from env, fallback to local dev
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000';

// Helper to extract a useful error message from FastAPI responses
async function extractError(res: Response) {
  let msg = await res.text();
  try {
    const j = JSON.parse(msg);
    if (j?.detail) {
      if (typeof j.detail === 'string') return j.detail;
      return JSON.stringify(j.detail);
    }
  } catch {
    /* ignore JSON parse errors */
  }
  return msg || res.statusText;
}

export default function Page() {
  // list state
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [platform, setPlatform] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState<'rating' | 'installs' | 'name'>('rating');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pageSize = 5;

  // create form
  const [fName, setFName] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fRating, setFRating] = useState<number | ''>('');
  const [fInstalls, setFInstalls] = useState<number | ''>('');
  const [fPlatform, setFPlatform] = useState<'ios' | 'android' | ''>('');

  // edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Partial<AppItem>>({});

  // auth state (admin token stored in localStorage)
  const [token, setToken] = useState<string>('');
  const authed = Boolean(token);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('admintoken') : '';
    if (saved) setToken(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (token) localStorage.setItem('admintoken', token);
      else localStorage.removeItem('admintoken');
    }
  }, [token]);

  // Build URL params from current state
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (platform) params.set('platform', platform);
    if (minRating) params.set('min_rating', String(minRating));
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
    params.set('page', String(page));
    params.set('page_size', String(pageSize));
    return params.toString();
  }, [q, category, platform, minRating, sortBy, sortDir, page]);

  // Debounced fetch: wait 300ms after last change; cancel in-flight requests
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setLoading(true);
    setErr(null);

    // abort previous request (if any)
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const tid = setTimeout(() => {
      fetch(`${API_BASE}/apps?${queryString}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${await extractError(res)}`);
          return res.json();
        })
        .then(setData)
        .catch((e: any) => {
          if (e.name !== 'AbortError') setErr(e.message || String(e));
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(tid);
    };
  }, [queryString]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const ratingNum = Number(fRating), installsNum = Number(fInstalls);
    if (!fName.trim() || !fCategory.trim() || !fPlatform) return setErr('Please fill name, category, and platform.');
    if (Number.isNaN(ratingNum) || ratingNum < 0 || ratingNum > 5) return setErr('Rating must be 0–5.');
    if (!Number.isInteger(installsNum) || installsNum < 0) return setErr('Installs must be a non-negative integer.');

    const resp = await fetch(`${API_BASE}/apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authed ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ name: fName.trim(), category: fCategory.trim(), rating: ratingNum, installs: installsNum, platform: fPlatform }),
    });
    if (!resp.ok) {
      const msg = await extractError(resp);
      setErr(`Request failed (${resp.status}): ${msg}`);
      return;
    }

    setFName(''); setFCategory(''); setFRating(''); setFInstalls(''); setFPlatform('');
    setPage(1);
    // force refresh (keeps debounce but re-runs immediately by tweaking state)
    setErr(null);
  }

  function startEdit(row: AppItem) {
    setEditingId(row.id);
    setEdit({ ...row });
  }
  function cancelEdit() {
    setEditingId(null);
    setEdit({});
  }
  async function saveEdit(id: number) {
    const payload: any = {};
    ['name','category','platform','rating','installs'].forEach(k => {
      if ((edit as any)[k] !== undefined) payload[k] = (edit as any)[k];
    });
    if (payload.name !== undefined && !String(payload.name).trim()) return setErr('Name must not be empty.');
    if (payload.category !== undefined && !String(payload.category).trim()) return setErr('Category must not be empty.');
    if (payload.platform !== undefined && !['ios','android'].includes(payload.platform)) return setErr('Platform must be ios or android.');
    if (payload.rating !== undefined && (payload.rating < 0 || payload.rating > 5)) return setErr('Rating must be 0–5.');
    if (payload.installs !== undefined && (!Number.isInteger(payload.installs) || payload.installs < 0)) return setErr('Installs must be a non-negative integer.');

    const resp = await fetch(`${API_BASE}/apps/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(authed ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const msg = await extractError(resp);
      setErr(`Request failed (${resp.status}): ${msg}`);
      return;
    }
    setEditingId(null);
    setEdit({});
    setErr(null);
  }

  async function deleteRow(id: number) {
    const ok = confirm('Delete this app?');
    if (!ok) return;
    const resp = await fetch(`${API_BASE}/apps/${id}`, {
      method: 'DELETE',
      headers: { ...(authed ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!resp.ok && resp.status !== 204) {
      const msg = await extractError(resp);
      setErr(`Request failed (${resp.status}): ${msg}`);
      return;
    }
    const newPage = (data && data.items.length === 1 && page > 1) ? page - 1 : page;
    setPage(newPage);
    setErr(null);
  }

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>App Explorer</h1>

      {/* Admin token */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          type="password"
          placeholder="Admin token"
          value={token}
          onChange={e => setToken(e.target.value)}
          style={{ width: 220 }}
        />
        <button onClick={() => setToken('')}>Logout</button>
        {!authed && <span style={{ color: '#666' }}>Read-only mode. Enter token to enable editing.</span>}
      </div>

      {/* Filters */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <input placeholder="Search apps..." value={q} onChange={e => { setPage(1); setQ(e.target.value); }} />
        <input placeholder="Category (e.g., Finance)" value={category} onChange={e => { setPage(1); setCategory(e.target.value); }} />
        <select value={platform} onChange={e => { setPage(1); setPlatform(e.target.value); }}>
          <option value="">Any platform</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
        </select>
        <input type="number" step="0.1" min={0} max={5} placeholder="Min rating" value={minRating} onChange={e => { setPage(1); setMinRating(Number(e.target.value || 0)); }} />
      </div>

      {/* Sorting */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>Sort by:{' '}
          <select value={sortBy} onChange={e => { setPage(1); setSortBy(e.target.value as any); }}>
            <option value="rating">Rating</option>
            <option value="installs">Installs</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label>Direction:{' '}
          <select value={sortDir} onChange={e => { setPage(1); setSortDir(e.target.value as any); }}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </label>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>Error: {err}</p>}

      {/* Table */}
      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%', opacity: loading ? 0.6 : 1 }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Category</th>
            <th align="left">Platform</th>
            <th align="right">Rating</th>
            <th align="right">Installs</th>
            <th align="left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {data?.items?.map(row => {
            const isEditing = editingId === row.id;
            return (
              <tr key={row.id} style={{ borderTop: '1px solid #ddd' }}>
                <td>
                  {isEditing ? (
                    <input value={String(edit.name ?? row.name)} onChange={e => setEdit(p => ({ ...p, name: e.target.value }))} />
                  ) : row.name}
                </td>
                <td>
                  {isEditing ? (
                    <input value={String(edit.category ?? row.category)} onChange={e => setEdit(p => ({ ...p, category: e.target.value }))} />
                  ) : row.category}
                </td>
                <td>
                  {isEditing ? (
                    <select value={String(edit.platform ?? row.platform)} onChange={e => setEdit(p => ({ ...p, platform: e.target.value as any }))}>
                      <option value="ios">iOS</option>
                      <option value="android">Android</option>
                    </select>
                  ) : row.platform}
                </td>
                <td align="right">
                  {isEditing ? (
                    <input type="number" step="0.1" min={0} max={5}
                      value={String(edit.rating ?? row.rating)}
                      onChange={e => setEdit(p => ({ ...p, rating: Number(e.target.value) }))} />
                  ) : row.rating}
                </td>
                <td align="right">
                  {isEditing ? (
                    <input type="number" step="1" min={0}
                      value={String(edit.installs ?? row.installs)}
                      onChange={e => setEdit(p => ({ ...p, installs: Number(e.target.value) }))} />
                  ) : row.installs.toLocaleString()}
                </td>
                <td>
                  {authed ? (
                    !isEditing ? (
                      <>
                        <button onClick={() => startEdit(row)}>Edit</button>{' '}
                        <button onClick={() => deleteRow(row.id)}>Delete</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => saveEdit(row.id)}>Save</button>{' '}
                        <button onClick={cancelEdit}>Cancel</button>
                      </>
                    )
                  ) : (
                    <span style={{ color: '#999' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!loading && data?.items?.length === 0 && (
            <tr><td colSpan={6} style={{ color: '#666' }}>No results.</td></tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1}>Prev</button>
        <span>Page {data?.page ?? page} / {data ? Math.ceil(data.total / data.page_size) : 1}</span>
        <button onClick={() => setPage(p => (data ? Math.min(Math.ceil(data.total / data.page_size), p + 1) : p + 1))}
                disabled={loading || (data ? page >= Math.ceil(data.total / data.page_size) : false)}>Next</button>
      </div>

      {/* Create form */}
      <hr style={{ margin: '24px 0' }} />
      <h2>Add New App</h2>
      {!authed && <p style={{ color:'#666' }}>Enter admin token above to add apps.</p>}
      {authed && (
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 120px', gap: 8, alignItems: 'center' }}>
          <input placeholder="Name" value={fName} onChange={e => setFName(e.target.value)} />
          <input placeholder="Category" value={fCategory} onChange={e => setFCategory(e.target.value)} />
          <select value={fPlatform} onChange={e => setFPlatform(e.target.value as any)}>
            <option value="">Platform</option>
            <option value="ios">iOS</option>
            <option value="android">Android</option>
          </select>
          <input type="number" step="0.1" min={0} max={5} placeholder="Rating" value={fRating} onChange={e => setFRating((e.target.value === '') ? '' : Number(e.target.value))} />
          <input type="number" step="1" min={0} placeholder="Installs" value={fInstalls} onChange={e => setFInstalls((e.target.value === '') ? '' : Number(e.target.value))} />
          <button type="submit">Create</button>
        </form>
      )}
    </main>
  );
}
