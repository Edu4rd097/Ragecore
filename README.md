# RageCore

Plataforma de gestión para academia de combate (MMA / Box / deportes de contacto):
alumnos, maestros, horarios, membresías, asistencia por QR, pagos (Stripe), avisos,
evaluaciones e insignias.

| Carpeta     | Tecnología                         | Documentación                          |
|-------------|------------------------------------|----------------------------------------|
| `backend/`  | Python 3.13 · Django 6 · DRF       | [backend/README.md](backend/README.md) |
| `frontend/` | Angular 21 · TypeScript (PWA)      | [frontend/README.md](frontend/README.md) |

## Estructura

```text
RageCore/
├── backend/            API REST (Django + Django REST Framework)
│   ├── config/         settings, urls, wsgi/asgi
│   ├── core/           modelos y lógica de la academia
│   ├── payments/       pagos en línea con Stripe
│   ├── templates/      correos y fichas
│   ├── docs/           manual técnico
│   └── manage.py
├── frontend/           SPA Angular
│   ├── src/
│   ├── public/
│   └── angular.json
├── requirements.txt    atajo a backend/requirements.txt
└── README.md
```

## Puesta en marcha

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # y ajusta los valores
python manage.py migrate
python manage.py seed
python manage.py createsuperuser
python manage.py runserver       # http://127.0.0.1:8000
```

### Frontend

```bash
cd frontend
npm ci
npm start                        # http://localhost:4200
```

En desarrollo, `ng serve` redirige `/api` y `/media` a `http://127.0.0.1:8000`
(ver `frontend/proxy.conf.json`), así que el backend debe estar corriendo.

## Notas para Git

- `.env`, `db.sqlite3` y `backend/media/` no se versionan. Usa `backend/.env.example`
  como plantilla.
- `node_modules/`, `dist/` y `.angular/` se regeneran con `npm ci` / `npm run build`.
