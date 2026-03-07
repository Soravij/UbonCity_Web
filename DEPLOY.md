# Deploy Guide v1.1

This project has 3 parts:
- `backend` (Express + MySQL)
- `frontend` (Next.js)
- `admin` (Vite + React)

## 1. Prepare GitHub version 1.1

Run from `D:\UbonCity_Web`.

Check status:
```bash
git status
```

Important before commit:
- `backend/.env` is already ignored and must never be committed.
- local test logs are ignored by root `.gitignore`.
- uploaded images under `backend/uploads/` are not ignored now. If you want the current uploaded images to exist on the deployed server immediately, commit those files. If not, deploy first and re-upload images later.

Stage files:
```bash
git add admin backend frontend .gitignore
```

If you want current uploaded images in this release too:
```bash
git add backend/uploads frontend/public/favicon-u.svg frontend/public/hero-uboncity.jpg
```

Commit:
```bash
git commit -m "release: v1.1"
```

Create tag:
```bash
git tag -a v1.1 -m "Version 1.1"
```

Push branch:
```bash
git push origin codex/sync-fix
```

Push tag:
```bash
git push origin v1.1
```

If you want this on `main`, merge the branch first, then push `main` and tag.

## 2. Prepare environment variables

### Backend `.env`
Example:
```env
PORT=5000
DB_HOST=YOUR_DB_HOST
DB_USER=YOUR_DB_USER
DB_PASSWORD=YOUR_DB_PASSWORD
DB_NAME=YOUR_DB_NAME
JWT_SECRET=CHANGE_THIS_SECRET
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
BACKEND_PUBLIC_URL=https://your-backend-domain.com
```

### Frontend env
Set on hosting:
```env
NEXT_PUBLIC_API_URL=https://your-backend-domain.com/api
```

### Admin env
Set on hosting:
```env
VITE_API_URL=https://your-backend-domain.com/api
```

## 3. Deploy backend

Recommended service: Render or Railway.

Backend settings:
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`

Backend must expose:
- `/api/*`
- `/uploads/*`

## 4. Deploy frontend

Recommended service: Vercel.

Frontend settings:
- Root directory: `frontend`
- Framework preset: Next.js
- Env: `NEXT_PUBLIC_API_URL=https://your-backend-domain.com/api`

## 5. Deploy admin

Option A: Vercel
- Root directory: `admin`
- Framework preset: Vite
- Env: `VITE_API_URL=https://your-backend-domain.com/api`

Option B: Render static site
- Root directory: `admin`
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Env: `VITE_API_URL=https://your-backend-domain.com/api`

## 6. Fix existing image URLs in database

Current old content may still contain `http://localhost:5000/uploads/...`.
If you deploy without replacing these URLs, old images will break.

Run SQL after backend domain is known.
Replace `https://your-backend-domain.com` with the real backend URL.

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
https://your-frontend-domain.com/lo/attractions/place-7
```

Admin:
```bash
https://your-admin-domain.com/
```

## 8. Recommended release order

1. Push code and tag `v1.1`
2. Deploy backend
3. Verify backend API and uploads URL
4. Run SQL replace for old image URLs
5. Deploy frontend
6. Deploy admin
7. Login to admin and approve/test one content item
