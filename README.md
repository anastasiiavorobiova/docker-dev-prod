# docker-dev-prod

Express 5 + TypeScript API з healthcheck і підключенням до PostgreSQL, упакований у Docker:
multi-stage build, non-root користувач, `HEALTHCHECK`, compose для CI/prod і окремий override для розробки.

## Швидкий старт

```bash
docker compose up -d
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health   # 200
```

Більше нічого не потрібно: `.env` необов'язковий, усі змінні мають значення за замовчуванням у `docker-compose.yml`.
Щоб їх змінити, скопіюйте `cp .env.example .env` і відредагуйте.

## Ендпоінти

| Метод | Шлях | Відповідь |
|---|---|---|
| GET | `/health` | `200 {"status":"ok","uptime":...}`: процес живий (його використовує `HEALTHCHECK`) |
| GET | `/health/db` | `200 {"status":"ok","db":"up"}` або `503 {"status":"error","db":"down"}`: перевірка `SELECT 1` у Postgres |

## Режими запуску

| Команда | Що піднімається |
|---|---|
| `docker compose up -d` | **dev**: compose автоматично підхоплює `docker-compose.override.yml`. Стадія `dev`, `tsx watch` з hot reload, `./src` змонтовано в контейнер, Postgres доступний з хоста на `localhost:5435` |
| `docker compose -f docker-compose.yml up -d --build` | **CI/prod**: лише базовий файл. Стадія `runner`, без bind mount, порт бази назовні не відкритий |
| `docker compose down` | зупинити стек, **дані бази зберігаються** у volume `db-data` |
| `docker compose down -v` | зупинити стек і **видалити дані** бази |
| `npm ci && npm run dev` | без Docker: потрібен `.env` і Postgres на `DB_HOST:DB_PORT` |

Після зміни `package.json` dev-образ треба перезібрати: `docker compose up -d --build`.

## Змінні оточення

| Змінна | За замовчуванням | Опис |
|---|---|---|
| `PORT` | `3000` | порт API (у контейнері й на хості) |
| `DB_HOST` | `db` у compose | хост Postgres; у `.env` для запуску без Docker — `localhost` |
| `DB_PORT` | `5432` | порт Postgres |
| `DB_USER` | `postgres` | користувач Postgres |
| `DB_PASSWORD` | `postgres` | пароль Postgres |
| `DB_NAME` | `docker-dev-prod` | назва бази |
| `DB_PUBLISHED_PORT` | `5435` | лише dev: порт Postgres на хості |

## Розмір образу

Вивід `docker images` після збірки обох варіантів:

```
REPOSITORY            TAG           SIZE
docker-dev-prod-api   1.0.0         251MB    # multi-stage (цей Dockerfile, стадія runner)
docker-dev-prod-api   single        1.2GB    # одна стадія "в лоб" на node:24
docker-dev-prod-api   single-slim   311MB    # одна стадія на node:24-slim (для порівняння)
```

**Multi-stage образ приблизно в 4,8 раза менший, бо замість повного `node:24` (~1,1 ГБ з компіляторами й системними утилітами) він базується на `node:24-slim` і містить лише production-залежності та скомпільований `dist/`: без TypeScript, tsx, вихідних `.ts` і тестів.**

Рядок `single-slim` показує, звідки береться економія: основну частину дає slim-базовий образ, а multi-stage додатково прибирає ~60 МБ (`node_modules` 49 МБ → 5,3 МБ).

Як відтворити образ «в лоб»:

```bash
docker build -t docker-dev-prod-api:single -f - . <<'EOF'
FROM node:24
WORKDIR /app
COPY . .
RUN npm ci && npm run build
CMD ["node", "dist/server.js"]
EOF
docker images docker-dev-prod-api
```

## Dockerfile

| Стадія | Що робить | Потрапляє у фінальний образ |
|---|---|---|
| `base` | `node:24-slim`, `WORKDIR /app`, `EXPOSE`, `HEALTHCHECK` (успадковують `dev` і `runner`) | так, як основа |
| `deps` | `npm ci --omit=dev`: лише `express` і `pg` | `node_modules` |
| `builder` | `npm ci` з dev-залежностями + `tsc` | `dist/` |
| `dev` | усі залежності + `tsx watch` (використовує override) | ні |
| `runner` | `package.json` + `node_modules` з `deps` + `dist/` з `builder`, `USER node` | **це і є фінальний образ** |

- У стадії `runner` немає `npm ci`: production-залежності копіюються з `deps`, де вони встановлені з `--omit=dev`. Рядки `npm ci` без прапорця, які видно в `grep -n 'npm ci' Dockerfile`, належать стадіям `builder` і `dev`.
- У кожній стадії `package.json`/`package-lock.json` копіюються й `npm ci` виконується **до** `COPY src`, тож зміна коду не перевстановлює залежності.
- Файли в `runner` належать `root`, а процес працює від `node` (uid 1000): застосунок не може змінити власний код.
- `runner` — остання стадія, тому `docker build .` без `--target` збирає саме prod-образ.

## Перевірка persistence

Дані Postgres зберігаються в іменованому volume `db-data`. Перевіряли так:

```bash
docker compose up -d
docker compose exec db psql -U postgres -d docker-dev-prod \
  -c "CREATE TABLE persist_check(x int); INSERT INTO persist_check VALUES (1);"

docker compose down          # без -v
docker compose up -d

docker compose exec db psql -U postgres -d docker-dev-prod -c "SELECT * FROM persist_check;"
```

Після `down` → `up` таблиця на місці й повертає рядок `x = 1`. Після `docker compose down -v` volume видаляється разом із даними.

## Перевірка інших вимог

```bash
# non-root: виводить 1000
docker run --rm docker-dev-prod-api:1.0.0 id -u

# healthcheck: через ~30 с після `docker compose up -d` виводить healthy
docker inspect --format '{{.State.Health.Status}}' docker-dev-prod-api-1

# базовий compose придатний для CI без override: виводить 0
docker compose -f docker-compose.yml config | grep -c 'source: ./src'
```

## Структура

| Файл | Призначення |
|---|---|
| `Dockerfile` | multi-stage (`deps` → `builder` → `runner`, плюс `dev`), non-root, healthcheck |
| `.dockerignore` | виключає `node_modules`, `.git`, `.env*`, `dist`, `*.md`, файли Docker тощо |
| `docker-compose.yml` | `api` + `postgres:17`, іменований volume, `depends_on: service_healthy`; придатний для CI |
| `docker-compose.override.yml` | dev: стадія `dev`, bind mount `./src`, hot reload, порт бази назовні |
| `src/` | Express-сервер: `config.ts` (змінні оточення), `db.ts` (pg Pool), `app.ts` (маршрути), `server.ts` (запуск і graceful shutdown) |
| `test/` | тест для `GET /health` (`npm test`, потрібен `.env.test`) |
