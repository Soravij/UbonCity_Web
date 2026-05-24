# Deploy Guide (GitHub + VPS/Cloud) - v1.1.1

This project has 3 parts:
- `backend` (Express + MySQL)
- `frontend` (Next.js)
- `admin` (Vite + React)

Current branch for release work:
- `codex/sync-fix`

## 1. GitHub release section (fixed)

Run from `D:\UbonCity_Web`.

Check clean state:
```bash
git status
```

Important:
- Never commit `backend/.env`.
- `frontend/.env.example` is matched by `*.env*` rule in `frontend/.gitignore`, so it must be added with `-f`.

Stage release files:
```bash
git add admin backend frontend .gitignore DEPLOY.md render.yaml
```

Force-add frontend env example:
```bash
git add -f frontend/.env.example
```

Commit:
```bash
git commit -m "release: v1.1.1"
```

Push branch:
```bash
git push origin codex/sync-fix
```

### Tag policy (recommended)
If `v1.1` already points to an older commit, do not move it silently.
Create a new tag for this state:
```bash
git tag -a v1.1.1 -m "Version 1.1.1"
git push origin v1.1.1
```

If you must re-point `v1.1` (not recommended unless team agrees):
```bash
git tag -d v1.1
git tag -a v1.1 -m "Version 1.1"
git push origin --delete v1.1
git push origin v1.1
```

## 2. Environment variables

### Backend `.env`
Example:
```env
PORT=5000
DB_HOST=YOUR_DB_HOST
DB_USER=YOUR_DB_USER
DB_PASSWORD=YOUR_DB_PASSWORD
DB_NAME=YOUR_DB_NAME
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
ADMIN_EMAILS=admin@example.com
JWT_SECRET=CHANGE_THIS_SECRET
BACKEND_PUBLIC_URL=https://your-backend-domain.com
```

Notes:
- DB must be online and reachable from backend host.
- Translation model in code is currently `gpt-5-mini`.

### Frontend env
```env
NEXT_PUBLIC_API_URL=https://your-backend-domain.com/api
```

### Admin env
```env
VITE_API_URL=https://your-backend-domain.com/api
```

## 3. Deploy backend (Render example)

Service settings:
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`

Backend must expose:
- `/api/*`
- `/uploads/*`

## 4. Deploy frontend (Vercel example)

Project settings:
- Root directory: `frontend`
- Framework: Next.js
- Env: `NEXT_PUBLIC_API_URL=https://your-backend-domain.com/api`

## 5. Deploy admin (Vercel example)

Project settings:
- Root directory: `admin`
- Framework: Vite
- Env: `VITE_API_URL=https://your-backend-domain.com/api`

## 6. Existing image URLs migration (only if old content exists)

If old records still contain `http://localhost:5000/uploads/...`, replace after backend URL is ready.

```sql
UPDATE places
SET image = REPLACE(image, 'http://localhost:5000', 'https://your-backend-domain.com')
WHERE image LIKE 'http://localhost:5000%';

UPDATE events
SET image = REPLACE(image, 'http://localhost:5000', 'https://your-backend-domain.com')
WHERE image LIKE 'http://localhost:5000%';

UPDATE place_translations
SET description = REPLACE(description, 'http://localhost:5000', 'https://your-backend-domain.com')
WHERE description LIKE '%http://localhost:5000%';
```

## 7. Smoke test after deploy

Backend:
```bash
https://your-backend-domain.com/api/places?category=attractions&lang=th
```

Frontend:
```bash
https://your-frontend-domain.com/th
```

Admin:
```bash
https://your-admin-domain.com/
```

## 8. Recommended order

1. Push `codex/sync-fix`
2. Tag release (`v1.1.1` recommended)
3. Deploy backend
4. Verify backend URL and env
5. Deploy frontend
6. Deploy admin
7. Login admin and test create/approve flow
## 9. Collector (internal-only)
- `collector-app` is intended for private/internal operations only.
- Bind collector to loopback or private interface only (`COLLECTOR_BIND_HOST=127.0.0.1` by default).
- Do not open collector port to the public internet.
- If reverse proxy is used, restrict collector route by VPN/private network and IP allowlist.
- Keep `CORS_ALLOWED_ORIGINS` explicit and internal; never use wildcard `*`.


