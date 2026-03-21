# only-vitiok app

Nuxt + Nuxt UI застосунок для керування пайплайном аналізу та завантаження медіа.

## Що є в UI

- Drag&Drop зона для медіа (файли потрапляють у `MEDIA_FOLDER`, як і раніше в `media`).
- Авто-імпорт медіа з кореня проєкту в `MEDIA_FOLDER` (керується `MEDIA_IMPORT_PROJECT_ROOT`, за замовчуванням `true`).
- Повне редагування `.env` (усі ключі + додавання нових).
- Окремий input для `Collection ID` з автогенерацією `CREATE_URL`.
- Login кнопка:
  - якщо `state.json` існує, показує що юзер залогінений;
  - якщо ні, відкриває браузер для логіну і зберігає `state.json` після натискання “Завершити логін”.
- Кнопка “Розпочати аналіз” (`scripts/generate-config.js`).
- Кнопка `Upload` (`scripts/upload.js`).
- Чекбокс `Auto upload після Analyze` (`AUTO_UPLOAD_AFTER_ANALYZE` в `.env`).
- Редактор `media-config.json` прямо з застосунку.

## Технічний стек

- Nuxt 3
- Nuxt UI
- TypeScript
- ESLint
- pnpm

## Запуск

1. Встановити залежності:

```bash
pnpm install
```

2. Запустити dev-сервер:

```bash
pnpm dev
```

3. Перевірка якості:

```bash
pnpm lint
pnpm typecheck
```

## Важливо

- Core-логіка аналізу/аплоаду залишена в `scripts/*.js` і викликається з Nuxt API, щоб не втратити поточну поведінку.
- Для логіну/аплоаду потрібен Playwright + доступ до цільового сайту.
- Якщо для відео потрібні кадри/тривалість, залишаються залежності на `ffmpeg`/`ffprobe` як і раніше.
- Якщо покласти `.jpg/.png/.mp4/...` файл у корінь проєкту, він автоматично копіюється в `MEDIA_FOLDER` під час запиту `/api/media` або запуску analyze.
