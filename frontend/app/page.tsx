'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type AppItem = { id: number; name: string; category: string; rating: number; installs: number; platform: string; };
type PageDTO = { items: AppItem[]; total: number; page: number; page_size: number; };
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000';

async function extractError(res: Response) {
  let msg = await res.text();
  try { const j = JSON.parse(msg); if (j?.detail) return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch {}
  return msg || res.statusText;
}

export default function Page() {
  // list state
  const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const [platform, setPlatform] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState<'rating' | 'installs' | 'name'>('rating');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageDTO | null>(null);
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string | null>(null);
  const pageSize = 5;

  // create form
  const [fName, setFName] = useState(''); const [fCategory, setFCategory] = useState('');
  const [fRating, setFRating] = useState<number | ''>(''); const [fInstalls, setFInstalls] = useState<number | ''>('');
  const [fPlatform, setFPlatform] = useState<'ios' | 'android' | ''>('');

  // edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Partial<AppItem>>({});

  // Auth state
  const [token, setToken] = useState<string>(''); const [requiresToken, setRequiresToken] = useState<boolean>(false);
  const [authed, setAuthed] = useState<boolean>(false);

  // auth mode + token validation
  useEffect(() => {
    fetch(`${API_BASE}/auth/mode`).then(r => r.json()).then(({ requires_token }) => {
      setRequiresToken(Boolean(requires_token)); if (!requires_token) setAuthed(true);
    }).catch(() => setRequiresToken(false));
  }, []);
  useEffect(() => { const saved = typeof window!=='undefined'?localStorage.getItem('admintoken'):''; if (saved) setToken(saved); }, []);
  useEffect(() => {
    if (typeof window!=='undefined'){ token?localStorage.setItem('admintoken',token):localStorage.removeItem('admintoken'); }
    if (requiresToken){ if(!token){ setAuthed(false); return; }
      const c = new AbortController();
      fetch(`${API_BASE}/auth/check`, { headers:{ Authorization:`Bearer ${token}` }, signal:c.signal })
        .then(r=>setAuthed(r.ok)).catch(()=>setAuthed(false));
      return ()=>c.abort();
    }
  }, [token, requiresToken]);

  // query string + debounced fetch
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if(q) p.set('q', q); if(category) p.set('category', category); if(platform) p.set('platform', platform);
    if(minRating) p.set('min_rating', String(minRating));
    p.set('sort_by', sortBy); p.set('sort_dir', sortDir);
    p.set('page', String(page)); p.set('page_size', String(pageSize));
    return p.toString();
  }, [q, category, platform, minRating, sortBy, sortDir, page]);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setLoading(true); setErr(null);
    abortRef.current?.abort(); const ctl = new AbortController(); abortRef.current = ctl;
    const t = setTimeout(() => {
      fetch(`${API_BASE}/apps?${queryString}`, { signal: ctl.signal })
        .then(async r=>{ if(!r.ok) throw new Error(`HTTP ${r.status}: ${await extractError(r)}`); return r.json(); })
        .then(setData).catch(e=>{ if(e.name!=='AbortError') setErr(e.message||String(e)); })
        .finally(()=>setLoading(false));
    }, 300);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [queryString]);

  // CSV export (uses current filters/sort, not pagination)
  function handleExport() {
    const p = new URLSearchParams(queryString);
    ['page','page_size'].forEach(k => p.delete(k));
    const url = `${API_BASE}/apps/export.csv?${p.toString()}`;
    window.open(url, '_blank');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setErr(null); if(!authed){ setErr('You are not authorized to create items.'); return; }
    const ratingNum = Number(fRating), installsNum = Number(fInstalls);
    if(!fName.trim() || !fCategory.trim() || !fPlatform) return setErr('Please fill name, category, and platform.');
    if(Number.isNaN(ratingNum) || ratingNum<0 || ratingNum>5) return setErr('Rating must be 0–5.');
    if(!Number.isInteger(installsNum) || installsNum<0) return setErr('Installs must be a non‑negative integer.');
    const r = await fetch(`${API_BASE}/apps`, {
      method:'POST', headers:{ 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) },
      body: JSON.stringify({ name:fName.trim(), category:fCategory.trim(), rating:ratingNum, installs:installsNum, platform:fPlatform })
    });
    if(!r.ok){ setErr(`Request failed (${r.status}): ${await extractError(r)}`); return; }
    setFName(''); setFCategory(''); setFRating(''); setFInstalls(''); setFPlatform(''); setPage(1); setErr(null);
  }

  function startEdit(row: AppItem){ setEditingId(row.id); setEdit({...row}); }
  function cancelEdit(){ setEditingId(null); setEdit({}); }
  async function saveEdit(id:number){
    if(!authed){ setErr('You are not authorized to update items.'); return; }
    const payload:any={}; ['name','category','platform','rating','installs'].forEach(k=>{ if((edit as any)[k]!==undefined) payload[k]=(edit as any)[k]; });
    if(payload.name!==undefined && !String(payload.name).trim()) return setErr('Name must not be empty.');
    if(payload.category!==undefined && !String(payload.category).trim()) return setErr('Category must not be empty.');
    if(payload.platform!==undefined && !['ios','android'].includes(payload.platform)) return setErr('Platform must be ios or android.');
    if(payload.rating!==undefined && (payload.rating<0 || payload.rating>5)) return setErr('Rating must be 0–5.');
    if(payload.installs!==undefined && (!Number.isInteger(payload.installs) || payload.installs<0)) return setErr('Installs must be a non‑negative integer.');
    const r = await fetch(`${API_BASE}/apps/${id}`, {
      method:'PUT', headers:{ 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) }, body: JSON.stringify(payload)
    });
    if(!r.ok){ setErr(`Request failed (${r.status}): ${await extractError(r)}`); return; }
    setEditingId(null); setEdit({}); setErr(null);
  }
  async function deleteRow(id:number){
    if(!authed){ setErr('You are not authorized to delete items.'); return; }
    if(!confirm('Delete this app?')) return;
    const r = await fetch(`${API_BASE}/apps/${id}`, { method:'DELETE', headers:{ ...(token?{Authorization:`Bearer ${token}`}:{}) } });
    if(!r.ok && r.status!==204){ setErr(`Request failed (${r.status}): ${await extractError(r)}`); return; }
    const newPage = (data && data.items.length===1 && page>1) ? page-1 : page; setPage(newPage); setErr(null);
  }

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  // sort helpers + indicators
  function toggleSort(field:'rating'|'installs'|'name'){
    if(sortBy===field){ setSortDir(d=>d==='asc'?'desc':'asc'); } else { setSortBy(field); setSortDir('desc'); }
    setPage(1);
  }
  const arrow = (field:'rating'|'installs'|'name') => sortBy!==field ? '' : (sortDir==='asc' ? '▲' : '▼');

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>App Explorer</h1>

      {/* Admin token */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
        <input type="password" placeholder={requiresToken ? "Admin token" : "Dev mode (no token required)"} value={token} onChange={e=>setToken(e.target.value)} style={{ width:260 }} />
        <button onClick={()=>setToken('')}>Logout</button>
        {requiresToken ? (
          <span style={{ color: authed ? 'green' : 'crimson' }}>{authed ? 'Authenticated' : 'Not authenticated'}</span>
        ) : <span style={{ color:'#666' }}>Dev mode: writes allowed without token</span>}
        <button onClick={handleExport} style={{ marginLeft: 'auto' }}>Export CSV</button>
      </div>

      {/* Filters */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:12, marginBottom:12 }}>
        <input placeholder="Search apps..." value={q} onChange={e=>{ setPage(1); setQ(e.target.value); }} />
        <input placeholder="Category (e.g., Finance)" value={category} onChange={e=>{ setPage(1); setCategory(e.target.value); }} />
        <select value={platform} onChange={e=>{ setPage(1); setPlatform(e.target.value); }}>
          <option value="">Any platform</option><option value="ios">iOS</option><option value="android">Android</option>
        </select>
        <input type="number" step={0.1} min={0} max={5} placeholder="Min rating" value={minRating} onChange={e=>{ setPage(1); setMinRating(Number(e.target.value||0)); }} />
      </div>

      {/* Sorting */}
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12 }}>
        <label>Sort by: <select value={sortBy} onChange={e=>{ setPage(1); setSortBy(e.target.value as any); }}>
          <option value="rating">Rating</option><option value="installs">Installs</option><option value="name">Name</option>
        </select></label>
        <label>Direction: <select value={sortDir} onChange={e=>{ setPage(1); setSortDir(e.target.value as any); }}>
          <option value="desc">Desc</option><option value="asc">Asc</option>
        </select></label>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color:'crimson', whiteSpace:'pre-wrap' }}>Error: {err}</p>}

      {/* Table */}
      <table cellPadding={8} style={{ borderCollapse:'collapse', width:'100%', opacity: loading?0.6:1 }}>
        <thead>
          <tr>
            <th align="left"><button onClick={()=>toggleSort('name')} style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:600 }}>Name {arrow('name')}</button></th>
            <th align="left">Category</th>
            <th align="left">Platform</th>
            <th align="right"><button onClick={()=>toggleSort('rating')} style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:600 }}>Rating {arrow('rating')}</button></th>
            <th align="right"><button onClick={()=>toggleSort('installs')} style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:600 }}>Installs {arrow('installs')}</button></th>
            <th align="left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {data?.items?.map(row=>{
            const isEditing = editingId===row.id;
            return (
              <tr key={row.id} style={{ borderTop:'1px solid #ddd' }}>
                <td>{isEditing ? <input value={String(edit.name ?? row.name)} onChange={e=>setEdit(p=>({ ...p, name:e.target.value }))} /> : row.name}</td>
                <td>{isEditing ? <input value={String(edit.category ?? row.category)} onChange={e=>setEdit(p=>({ ...p, category:e.target.value }))} /> : row.category}</td>
                <td>{isEditing ? (
                  <select value={String(edit.platform ?? row.platform)} onChange={e=>setEdit(p=>({ ...p, platform:e.target.value as any }))}>
                    <option value="ios">iOS</option><option value="android">Android</option>
                  </select>
                ) : row.platform}</td>
                <td align="right">{isEditing ? <input type="number" step={0.1} min={0} max={5} value={String(edit.rating ?? row.rating)} onChange={e=>setEdit(p=>({ ...p, rating:Number(e.target.value) }))} /> : row.rating}</td>
                <td align="right">{isEditing ? <input type="number" step={1} min={0} value={String(edit.installs ?? row.installs)} onChange={e=>setEdit(p=>({ ...p, installs:Number(e.target.value) }))} /> : row.installs.toLocaleString()}</td>
                <td>
                  {authed ? (!isEditing ? (<>
                    <button onClick={()=>startEdit(row)}>Edit</button>{' '}<button onClick={()=>deleteRow(row.id)}>Delete</button>
                  </>) : (<>
                    <button onClick={()=>saveEdit(row.id)}>Save</button>{' '}<button onClick={cancelEdit}>Cancel</button>
                  </>)) : <span style={{ color:'#999' }}>—</span>}
                </td>
              </tr>
            );
          })}
          {!loading && data?.items?.length===0 && (<tr><td colSpan={6} style={{ color:'#666' }}>No results.</td></tr>)}
        </tbody>
      </table>

      {/* Pagination */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:12 }}>
        <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={loading||page<=1}>Prev</button>
        <span>Page {data?.page ?? page} / {data ? Math.ceil(data.total / data.page_size) : 1}</span>
        <button onClick={()=>setPage(p=>(data?Math.min(Math.ceil(data.total / data.page_size),p+1):p+1))} disabled={loading || (data ? page>=Math.ceil(data.total / data.page_size) : false)}>Next</button>
      </div>

      {/* Create form */}
      <hr style={{ margin:'24px 0' }} />
      <h2>Add New App</h2>
      {!authed && <p style={{ color:'#666' }}>{requiresToken ? 'Enter a valid admin token to add apps.' : 'Dev mode: token not required.'}</p>}
      {authed && (
        <form onSubmit={handleCreate} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 120px', gap:8, alignItems:'center' }}>
          <input placeholder="Name" value={fName} onChange={e=>setFName(e.target.value)} />
          <input placeholder="Category" value={fCategory} onChange={e=>setFCategory(e.target.value)} />
          <select value={fPlatform} onChange={e=>setFPlatform(e.target.value as any)}>
            <option value="">Platform</option><option value="ios">iOS</option><option value="android">Android</option>
          </select>
          <input type="number" step={0.1} min={0} max={5} placeholder="Rating" value={fRating} onChange={e=>setFRating((e.target.value==='')?'' : Number(e.target.value))} />
          <input type="number" step={1} min={0} placeholder="Installs" value={fInstalls} onChange={e=>setFInstalls((e.target.value==='')?'' : Number(e.target.value))} />
          <button type="submit">Create</button>
        </form>
      )}
    </main>
  );
}
