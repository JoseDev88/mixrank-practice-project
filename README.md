# MixRank-Style Practice Project: App Explorer

This practice project simulates a junior full‑stack task similar to what you might do at a data company.
Stack: **FastAPI (Python)** + **Next.js (TypeScript)**. No paid services required.

## Quick Start (PowerShell)
### 1) Backend
```powershell
cd backend
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 2) Frontend
```powershell
cd ../frontend
npm install
npm run dev
```

Then visit:
- Backend: http://127.0.0.1:8000/docs
- Frontend: http://localhost:3000
