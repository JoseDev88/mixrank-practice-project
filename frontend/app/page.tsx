'use client';

import { useEffect, useState } from 'react';

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

export default function Page() {
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

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (platform) params.set('platform', platform);
    if (minRating) params.set('min_rating', String(minRating));
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
    params.set('page', String(page));
    params.set('page_size', String(pageSize));

    setLoading(true);
    setErr(null);

    fetch(`http://127.0.0.1:8000/apps?${params.toString()}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [q, category, platform, minRating, sortBy, sortDir, page]);

  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <h1>App Explorer</h1>

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

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>
          Sort by:{' '}
          <select value={sortBy} onChange={e => { setPage(1); setSortBy(e.target.value as any); }}>
            <option value="rating">Rating</option>
            <option value="installs">Installs</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label>
          Direction:{' '}
          <select value={sortDir} onChange={e => { setPage(1); setSortDir(e.target.value as any); }}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </label>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: 'crimson' }}>Error: {err}</p>}

      <table cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%', opacity: loading ? 0.6 : 1 }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Category</th>
            <th align="left">Platform</th>
            <th align="right">Rating</th>
            <th align="right">Installs</th>
          </tr>
        </thead>
        <tbody>
          {data?.items?.map(app => (
            <tr key={app.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{app.name}</td>
              <td>{app.category}</td>
              <td>{app.platform}</td>
              <td align="right">{app.rating}</td>
              <td align="right">{app.installs.toLocaleString()}</td>
            </tr>
          ))}
          {!loading && data?.items?.length === 0 && (
            <tr><td colSpan={5} style={{ color: '#666' }}>No results.</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1}>Prev</button>
        <span>Page {data?.page ?? page} / {totalPages}</span>
        <button onClick={() => setPage(p => (data ? Math.min(totalPages, p + 1) : p + 1))} disabled={loading || (data ? page >= totalPages : false)}>Next</button>
      </div>

      {data && (
        <p style={{ marginTop: 8, color: '#555' }}>
          Showing {(data.page - 1) * data.page_size + 1}–{Math.min(data.page * data.page_size, data.total)} of {data.total}
        </p>
      )}
    </main>
  );
}
