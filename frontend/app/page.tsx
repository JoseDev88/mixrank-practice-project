"use client";

import React, { useEffect, useMemo, useState } from "react";

type AppItem = {
  id: number;
  name: string;
  category: string;
  platform: "ios" | "android";
  rating: number;
  installs: number;
  price: number; // NEW
};

type PagePayload = {
  items: AppItem[];
  total: number;
  page: number;
  page_size: number;
  next_url?: string | null;
  prev_url?: string | null;
};

const API =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:8000";

function formatInt(n: number) {
  return n.toLocaleString("en-US");
}

function formatPrice(n: number) {
  if (!isFinite(n) || n < 0) return "—";
  if (n === 0) return "Free";
  return `$${n.toFixed(2)}`;
}

export default function Page() {
  // auth
  const [token, setToken] = useState<string>("");
  const [requiresToken, setRequiresToken] = useState<boolean>(false);
  const authHeader = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  // filters/sorting/paging
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [platform, setPlatform] = useState<"" | "ios" | "android">("");
  const [minRating, setMinRating] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"rating" | "installs" | "name">(
    "rating"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(5);

  // data
  const [data, setData] = useState<PagePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fetchAuthMode() {
    try {
      const r = await fetch(`${API}/auth/mode`);
      const j = await r.json();
      setRequiresToken(Boolean(j.requires_token));
    } catch {
      // if auth endpoints aren’t enabled, assume dev mode
      setRequiresToken(false);
    }
  }

  async function fetchPage() {
    setBusy(true);
    setErr(null);
    try {
      const url = new URL(`${API}/apps`);
      if (q) url.searchParams.set("q", q);
      if (category) url.searchParams.set("category", category);
      if (platform) url.searchParams.set("platform", platform);
      if (minRating) url.searchParams.set("min_rating", String(minRating));
      url.searchParams.set("sort_by", sortBy);
      url.searchParams.set("sort_dir", sortDir);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(pageSize));

      const r = await fetch(url.toString(), { cache: "no-store" });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(`${r.status} ${r.statusText} – ${msg}`);
      }
      const j: PagePayload = await r.json();
      setData(j);
    } catch (e: any) {
      setErr(e.message ?? "Failed to load");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetchAuthMode();
  }, []);

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, platform, minRating, sortBy, sortDir, page, pageSize]);

  async function createApp(form: HTMLFormElement) {
    setBusy(true);
    setErr(null);
    try {
      const formData = new FormData(form);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        category: String(formData.get("category") || "").trim(),
        platform: String(formData.get("platform") || "ios") as "ios" | "android",
        rating: Number(formData.get("rating") || 0),
        installs: Number(formData.get("installs") || 0),
        price: Number(formData.get("price") || 0), // NEW
      };

      const r = await fetch(`${API}/apps`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(`${r.status} ${r.statusText} – ${msg}`);
      }
      form.reset();
      setPage(1);
      await fetchPage();
    } catch (e: any) {
      setErr(e.message ?? "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this app?")) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API}/apps/${id}`, {
        method: "DELETE",
        headers: { ...authHeader },
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(`${r.status} ${r.statusText} – ${msg}`);
      }
      await fetchPage();
    } catch (e: any) {
      setErr(e.message ?? "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  async function editRow(row: AppItem) {
    // simple inline prompts; in your real app you’d use a modal
    const name = prompt("Name:", row.name)?.trim();
    if (name == null) return;
    const category = prompt("Category:", row.category)?.trim();
    if (category == null) return;
    const platform = (prompt("Platform (ios|android):", row.platform) || "")
      .trim()
      .toLowerCase();
    if (!["ios", "android"].includes(platform)) {
      alert("Platform must be ios or android");
      return;
    }
    const ratingStr = prompt("Rating (0–5):", String(row.rating));
    if (ratingStr == null) return;
    const rating = Number(ratingStr);
    const installsStr = prompt("Installs:", String(row.installs));
    if (installsStr == null) return;
    const installs = Number(installsStr);

    const priceStr = prompt("Price (0 = Free):", String(row.price)); // NEW
    if (priceStr == null) return;
    const price = Number(priceStr);
    if (isNaN(price) || price < 0) {
      alert("Price must be a number ≥ 0");
      return;
    }

    const payload: Partial<AppItem> = {
      name,
      category,
      platform: platform as "ios" | "android",
      rating,
      installs,
      price, // NEW
    };

    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API}/apps/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(`${r.status} ${r.statusText} – ${msg}`);
      }
      await fetchPage();
    } catch (e: any) {
      setErr(e.message ?? "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  const devWritesNote = !requiresToken ? (
    <span style={{ marginLeft: 12, color: "#666" }}>
      Dev mode: writes allowed without token
    </span>
  ) : null;

  return (
    <div style={{ maxWidth: 980, margin: "28px auto", padding: "0 12px" }}>
      <h1>App Explorer</h1>

      {/* Auth bar */}
      <div style={{ marginBottom: 8 }}>
        <input
          type="password"
          placeholder="Admin token (if required)"
          style={{ width: 220, marginRight: 8 }}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button onClick={() => setToken("")} style={{ marginRight: 8 }}>
          Logout
        </button>
        {devWritesNote}
        <button
          style={{ float: "right" }}
          onClick={() => window.open(`${API}/apps/export.csv`, "_blank")}
          title="Download CSV"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          placeholder="Search apps..."
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          style={{ flex: "1 1 260px" }}
        />
        <input
          placeholder="Category (e.g., Finance)"
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
          style={{ width: 220 }}
        />
        <select
          value={platform}
          onChange={(e) => {
            setPage(1);
            setPlatform(e.target.value as any);
          }}
          style={{ width: 140 }}
        >
          <option value="">Any platform</option>
          <option value="ios">ios</option>
          <option value="android">android</option>
        </select>
        <input
          type="number"
          step="0.1"
          min={0}
          max={5}
          placeholder="Min rating"
          value={minRating}
          onChange={(e) => {
            setPage(1);
            setMinRating(Number(e.target.value || 0));
          }}
          style={{ width: 120 }}
        />
      </div>

      {/* Sort controls */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
        <span>Sort by:</span>
        <select
          value={sortBy}
          onChange={(e) => {
            setPage(1);
            setSortBy(e.target.value as any);
          }}
        >
          <option value="rating">Rating</option>
          <option value="installs">Installs</option>
          <option value="name">Name</option>
        </select>
        <span>Direction:</span>
        <select
          value={sortDir}
          onChange={(e) => {
            setPage(1);
            setSortDir(e.target.value as any);
          }}
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
      </div>

      {/* Data table */}
      <div style={{ borderTop: "2px solid #333" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", height: 34 }}>
              <th>Name</th>
              <th>Category</th>
              <th>Platform</th>
              <th>Rating</th>
              <th>Installs</th>
              <th>Price</th> {/* NEW */}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {busy && !data ? (
              <tr>
                <td colSpan={7} style={{ padding: 12 }}>
                  Loading…
                </td>
              </tr>
            ) : err ? (
              <tr>
                <td colSpan={7} style={{ padding: 12, color: "crimson" }}>
                  {err}
                </td>
              </tr>
            ) : data && data.items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 12 }}>
                  No results
                </td>
              </tr>
            ) : (
              data?.items.map((r) => (
                <tr key={r.id} style={{ height: 34, borderTop: "1px solid #e6e6e6" }}>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td>{r.platform}</td>
                  <td>{r.rating}</td>
                  <td>{formatInt(r.installs)}</td>
                  <td>{formatPrice(r.price)}</td> {/* NEW */}
                  <td>
                    <button onClick={() => editRow(r)} style={{ marginRight: 6 }}>
                      Edit
                    </button>
                    <button onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pager */}
        <div style={{ marginTop: 8 }}>
          <button
            disabled={!data?.prev_url || busy}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{ marginRight: 6 }}
          >
            Prev
          </button>
          <span style={{ marginRight: 6 }}>
            Page {data?.page ?? 1} /{" "}
            {data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1}
          </span>
          <button
            disabled={!data?.next_url || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* Create form */}
      <div style={{ marginTop: 22 }}>
        <h3>Add New App</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createApp(e.currentTarget);
          }}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 140px 120px 140px 120px 100px", gap: 8 }}
        >
          <input name="name" placeholder="Name" required />
          <input name="category" placeholder="Category" required />
          <select name="platform" defaultValue="">
            <option value="" disabled>
              Platform
            </option>
            <option value="ios">ios</option>
            <option value="android">android</option>
          </select>
          <input name="rating" placeholder="Rating" type="number" min="0" max="5" step="0.1" required />
          <input name="installs" placeholder="Installs" type="number" min="0" required />
          <input name="price" placeholder="Price (0 = Free)" type="number" min="0" step="0.01" /> {/* NEW */}
          <button type="submit" disabled={busy}>
            Create
          </button>
        </form>
      </div>
    </div>
  );
}
