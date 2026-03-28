# smelter-surveilance

Real-time video surveillance app. Multiple cameras (browsers or server-side video files) send video via WebRTC (WHIP) or MP4 to a Smelter compositing engine, which produces a single output stream available via WebRTC (WHEP). Server-side motion detection (Python + RTP) triggers automatic recording and AI analysis (Gemini 2.5 Flash). The focused camera switches automatically based on motion scores. Push notifications alert on serious events even when the browser tab is closed.

## Architecture

```
                        ┌──────────────────────────────────────────────────────────┐
                        │                        server/                           │
[dashboard] ──WHIP────▶ │ Express ──▶ Smelter engine ──▶ scene (App.tsx)           │
[local_videos/] ──MP4──▶│  proxy       ├── motion.tsx (RTP → Python detector)      │
                        │  (routes.ts) ├── recorder.tsx (MP4 clips on motion)      │
[dashboard] ◀──WHEP──── │              ├── gemini.ts (AI analysis of clips)        │
                        │              ├── focusStore.ts (auto-focus logic)         │
                        │              ├── db.ts (SQLite persistence)               │
                        │              └── push.ts (Web Push notifications)         │
                        └──────────────────────────────────────────────────────────┘
```

The project has two packages:
- **`server/`** — Express backend + Smelter video compositing engine + motion detection + recording + Gemini AI analysis + SQLite persistence + Web Push
- **`dashboard/`** — React 19 frontend (Vite + Tailwind) — full camera management panel with live monitoring, recordings browser, and push notifications

## Running

```bash
# Backend (Smelter engine + API)
cd server
npm install
npm run dev       # tsx src/index.ts — server on http://localhost:3000

# Frontend dashboard (separate dev server with proxy to backend)
cd dashboard
npm install
npm run dev       # Vite — https://localhost:5173 (basicSsl for getUserMedia on mobile)
```

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `SMELTER_WHIP_WHEP_SERVER_PORT` | Smelter internal WHIP/WHEP port | `9000` |
| `GEMINI_API_KEY` | Google Gemini API key for clip analysis | _(disabled if unset)_ |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:5173` |

---

## Server files (`server/src/`)

### `index.ts` — Entry point
- Loads `dotenv/config`.
- Initializes subsystems in order: `initDb()` → `initRecorder()` → `initGemini()` → `initPush()` → `initializeSmelterInstance()`.
- Starts Express on port **3000**.

### `db.ts` — SQLite database (better-sqlite3)
- Database file: `server/data.db` (WAL mode).
- **Tables**:
  - `recordings` — persisted recording metadata (`filename`, `inputId`, `timestamp`, `durationMs`).
  - `analyses` — Gemini analysis results (`filename`, `description`, `severity`, `analyzedAt`), FK to recordings.
  - `settings` — key-value store for runtime config (`recordingEnabled`, `motionThreshold`, `autoDeleteUnimportant`).
  - `camera_names` — persisted custom names for video file inputs (`inputId` → `name`).
  - `push_subscriptions` — Web Push subscription objects (`endpoint` → full subscription JSON).
- Exports CRUD functions: `dbInsertRecording`, `dbLoadRecordings`, `dbDeleteRecording`, `dbInsertAnalysis`, `dbLoadAnalyses`, `dbGetSetting`, `dbSetSetting`, `dbSetCameraName`, `dbDeleteCameraName`, `dbLoadCameraNames`, `dbSavePushSubscription`, `dbDeletePushSubscription`, `dbLoadPushSubscriptions`.

### `push.ts` — Web Push notifications
- `initPush()` — loads or generates VAPID key pair (persisted in `settings` table). Configures `web-push` library.
- `getVapidPublicKey()` — returns public key for client subscription.
- `sendPushToAll(payload)` — sends a push notification to all saved subscriptions. Removes expired subscriptions (410/404 responses).

### `smelter.tsx` — Smelter engine initialization
- Creates and exports singleton `SmelterInstance` (`@swmansion/smelter-node`).
- `initializeSmelterInstance()`:
  1. Initializes the engine.
  2. Registers **output** `output_1` as a WHEP server endpoint.
  3. Renders the React scene `<App />` — determines camera layout.
  4. Encoder: H.264 `ultrafast`, resolution **1920×1080**.
  5. Starts the engine.

### `App.tsx` — React scene component (video layout)
- Uses `useInputStreams()` to get all registered camera streams (max 4).
- Uses `useFocusedInputId()` from `focusStore` to determine which camera has motion focus.
- **Layout logic**:
  - 0 cameras → empty background (`#161127`).
  - 1 camera → single full-frame `Rescaler` (fit, bottom-aligned).
  - 2–4 cameras → focused camera takes the large bottom area (1920×720), remaining cameras form a top row of equal-width tiles (1920/3 each, 360px tall).
- All position changes animate with a 700ms cubic-bezier `Transition`.

### `focusStore.ts` — Motion-based camera focus logic
- External store compatible with React's `useSyncExternalStore`.
- `useFocusedInputId()` — React hook returning the currently focused `inputId` (or `null`).
- `updateFocus(inputId, score)` — called on every motion score update:
  - Ignores scores below `NOISE_THRESHOLD` (0.5).
  - First camera with motion above threshold becomes focused.
  - Switch cooldown: **3 seconds**.
  - A new camera must have ≥ 2× the current camera's score (`DOMINANCE_FACTOR`) to steal focus.
- `handleDisconnect(inputId)` — clears focus when camera disconnects.

### `motion.tsx` — Server-side motion detection
- Spawns a long-running Python process (`motion_detector.py --server`) that receives RTP streams and outputs motion scores as JSON lines on stdout.
- For each camera input, registers a low-res Smelter output (**320×240**, H.264 ultrafast) as an RTP stream to `127.0.0.1` on sequential UDP ports.
- Communicates with the Python process via stdin (JSON commands: `add`, `remove`, `shutdown`).
- On receiving a `score` message from Python:
  - Updates `motionScores` map.
  - Calls `updateFocus()` in `focusStore`.
  - Calls `handleMotionForRecording()` in `recorder`.
  - Triggers `onScoreCallback` (used by `routes.ts` to update `lastSeenAt` for stale input cleanup).
- `getMotionScores()` — returns all current scores as `Record<string, number>`.

### `recorder.tsx` — Motion-triggered recording
- Loads completed recordings and settings from SQLite on init (`initRecorder()`).
- When motion score exceeds threshold and recording is enabled:
  - Registers a Smelter output of type `mp4` (640×480, H.264 `fast`) writing to `server/recordings/`.
  - Clip duration: min **3s**, max **5s**. Stops early if motion drops below threshold after min duration.
  - **10s cooldown** between recordings per camera.
- After a recording completes, persists to DB and fires off Gemini analysis (`analyzeRecording()`).
- `getRecordings()` — returns completed recordings with analysis results, filtering out auto-deleted unimportant ones and recordings whose files no longer exist on disk.
- Settings persisted to DB: `setRecordingEnabled(bool)`, `setMotionThreshold(value)`.

### `gemini.ts` — AI video analysis (Google Gemini)
- Loads previous analyses from SQLite on init (`initGemini()`).
- Uploads recorded MP4 clips to Google Gemini via `GoogleAIFileManager`.
- Waits for file to be fully written (polls file size for stability, up to 30s).
- Waits for server-side processing (`PROCESSING` → `ACTIVE`).
- Prompts `gemini-2.5-flash` to analyze as a home security camera clip and return JSON with:
  - `description` — 1-2 sentence description of what happened.
  - `severity` — one of: `funny`, `unimportant`, `moderate`, `serious`.
- Deletes the uploaded file from Google servers after analysis.
- **Push notification**: sends Web Push to all subscribers on `severity === 'serious'`.
- If `autoDeleteUnimportant` is enabled (default: true) and severity is `unimportant`, deletes the local MP4 file and DB record.
- Sequential queue (`enqueue`) to avoid rate limits.
- Auto-delete setting persisted to DB.

### `routes.ts` — Express endpoints (API + SDP proxy)
- **CORS**: allows `CORS_ORIGIN` (default `http://localhost:5173`).
- **Static files**: serves `public/` directory.
- **Input source types**: `webcam` (WHIP from browser) or `video` (MP4 file from `server/local_videos/`, looped).
- **Stale input cleanup**: tracks `lastSeenAt` per input (updated via motion score callbacks). Every 5s, removes webcam inputs not seen for 10s. Video inputs are exempt.
- **Client identity**: `POST /connect` accepts `clientId` + `slotIndex` to identify browser tabs. On reconnect, cleans up the old input for the same client+slot and restores the camera name from an in-memory cache.
- **Camera naming**: names are persisted in DB for video inputs (keyed by filename) and cached in memory for webcams (keyed by `clientId:slotIndex`).

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/connect` | Register new WHIP camera input. Accepts `{ clientId, slotIndex }`. Returns `{ inputId, whipUrl, bearerToken }`. Starts motion detection. |
| `POST` | `/connect-video` | Register a server-side video file as input. Accepts `{ filename }`. Reads from `server/local_videos/`, loops playback. Returns `{ inputId }`. |
| `POST` | `/disconnect` | Unregister camera input by `{ inputId }`. Stops motion detection. |
| `GET` | `/api/inputs` | List all active inputs with `connectedAt`, `source` (webcam/video), `name`. |
| `POST` | `/api/inputs/:inputId/name` | Rename an input (`{ name }`). Persists for video inputs. |
| `GET` | `/api/motion` | Get motion scores for all inputs. |
| `GET` | `/whep-url` | Get WHEP viewer proxy URL (`/api/whep/output_1`). |
| `GET` | `/api/recording-enabled` | Check if recording is enabled. |
| `POST` | `/api/recording-enabled` | Toggle recording (`{ enabled: bool }`). |
| `GET` | `/api/motion-threshold` | Get current motion threshold (0–1). |
| `POST` | `/api/motion-threshold` | Set motion threshold (`{ threshold: number }`). |
| `GET` | `/api/auto-delete` | Check if auto-delete of unimportant clips is enabled. |
| `POST` | `/api/auto-delete` | Toggle auto-delete (`{ enabled: bool }`). |
| `GET` | `/api/local-videos` | List video files in `server/local_videos/` (mp4, webm, mkv, avi, mov). |
| `GET` | `/api/recordings` | List recorded clips with analysis results. |
| `GET` | `/api/recordings/:filename` | Serve a recorded MP4 clip (static). |
| `GET` | `/api/push/vapid-key` | Get VAPID public key for push subscription. |
| `POST` | `/api/push/subscribe` | Save a push subscription object. |
| `POST` | `/api/whip/:inputId` | SDP proxy: forwards WHIP offer from browser to Smelter. Passes `Authorization` header. |
| `POST` | `/api/whep/:outputId` | SDP proxy: forwards WHEP offer from viewer to Smelter. |

### `package.json` — Dependencies & scripts
- **Key dependencies**: `@swmansion/smelter`, `@swmansion/smelter-node`, `express`, `cors`, `dotenv`, `react`, `@google/generative-ai`, `better-sqlite3`, `web-push`.
- **Scripts**: `dev` (tsx), `build:server` (tsc), `start` (node dist).

---

## Dashboard files (`dashboard/src/`)

React 19 + Vite 8 + Tailwind CSS 4 application. Dev server uses `basicSsl` (HTTPS required for `getUserMedia` on mobile). Proxy in `vite.config.ts` forwards `/api/*`, `/connect`, `/disconnect`, `/whep-url` to `http://localhost:3000`.

### `types.ts` — Shared types
- `InputInfo` — `{ inputId, connectedAt, source?: { type: 'webcam' } | { type: 'video'; filename }, name? }`.
- `ConnectionState` — `'idle' | 'connecting' | 'connected' | 'failed' | 'disconnected'`.
- `AnalysisResult` — `{ description, severity, analyzedAt }`.
- `RecordingInfo` — `{ filename, inputId, timestamp, durationMs, analysis? }`.

### `main.tsx` — Entry point
- Renders `<App />` into `#root`.

### `App.tsx` — Root component with page navigation and layout
- Manages page state: `'monitoring'` or `'recordings'`.
- **3-column layout** (desktop): left `<Sidebar>` (navigation + settings) | center `<Viewer>` or `<RecordingsList>` | right sidebar `<CameraInputList>` (monitoring page only).
- **Responsive**: on mobile/tablet, sidebar is a slide-out overlay (hamburger menu), cameras move below the viewer.
- Lifts settings state: recording enabled, auto-delete, motion threshold — fetched from server on mount.
- Requests browser notification permission on mount.

### `index.css` — Global styles
- Tailwind import + custom theme: `sentinel-bg` (#0B1120), `sentinel-card` (#111827), `sentinel-border` (#1E293B).

### `api/client.ts` — HTTP client (API functions)
- `registerInput(clientId, slotIndex)` — `POST /connect` with client identity.
- `unregisterInput(inputId)` — `POST /disconnect`.
- `sendBeaconDisconnect(inputId)` — `sendBeacon` to `/disconnect` (on `beforeunload`).
- `getWhepUrl()` — `GET /whep-url`.
- `listInputs()` — `GET /api/inputs` → `InputInfo[]`.
- `getMotionScores()` — `GET /api/motion`.
- `getRecordingEnabled()` / `setRecordingEnabled(bool)` — recording toggle.
- `getMotionThreshold()` / `setMotionThreshold(number)` — sensitivity.
- `getAutoDeleteEnabled()` / `setAutoDeleteEnabled(bool)` — auto-delete toggle.
- `getRecordings()` — `GET /api/recordings` → `RecordingInfo[]`.
- `connectServerVideo(filename)` — `POST /connect-video` → `{ inputId }`.
- `listLocalVideos()` — `GET /api/local-videos` → `string[]`.
- `renameInput(inputId, name)` — `POST /api/inputs/:inputId/name`.
- `getVapidPublicKey()` — `GET /api/push/vapid-key`.
- `subscribePush(subscription)` — `POST /api/push/subscribe`.
- `sendSdp(url, sdp, bearerToken?)` — SDP offer/answer exchange (WHIP/WHEP).

### `lib/webrtc.ts` — WebRTC helpers
- `ICE_SERVERS` — STUN config (Google).
- `ICE_GATHERING_TIMEOUT` — 5s.
- `preferBaselineH264(transceiver)` — forces H.264 Constrained Baseline profile (`42*`) to avoid FFmpeg decoder issues with High profile streams from mobile.
- `waitForIceGathering(pc)` — waits for ICE gathering with timeout.

### `lib/notifications.ts` — Browser + Push notifications
- `requestNotificationPermission()` — asks user for Notification permission. If granted, registers a service worker (`/sw.js`) and subscribes to Web Push using the VAPID key from the server.
- `checkNewSeriousRecordings(recordings)` — called during recordings polling. On first call, marks existing serious recordings as seen. On subsequent calls, shows a native `Notification` ("ALARM: Suspicious activity!") for any new recording with `severity === 'serious'`. Uses `requireInteraction: true`.

### `hooks/useWhipSender.ts` — Hook: camera sender (WHIP)
- Takes `clientId` and `slotIndex` params — passed to `registerInput()` for stable identity across reconnects.
- Manages sender lifecycle: `getUserMedia` → `POST /connect` → SDP negotiation → stream.
- Uses `preferBaselineH264()` on transceiver.
- `connect()` — full connection flow. Cleans up previous input for this slot.
- `disconnect(skipServer?)` — closes PC, stops camera, optionally skips server unregister.
- On `beforeunload`, sends `sendBeacon` disconnect.
- Returns: `{ previewRef, connectionState, error, inputId, connect, disconnect }`.

### `hooks/useWhepViewer.ts` — Hook: composed stream viewer (WHEP)
- Creates `RTCPeerConnection` in `recvonly` mode.
- `connect()` — fetches WHEP URL, negotiates SDP, assigns stream to `<video>`.
- **Auto-retry**: on connection failure or disconnect, retries after 2 seconds.
- Returns: `{ videoRef, connectionState, error, connect }`.

### `hooks/useConnectedInputs.ts` — Hook: server-side camera list
- Polls `GET /api/inputs` every **2 seconds**.
- Returns `InputInfo[]` — cameras visible on the server (including from other devices).

### `hooks/useMotionScores.ts` — Hook: motion scores from server
- Polls `GET /api/motion` every **1 second**.
- Returns `Record<string, number>` — percent of changed pixels per `inputId`.

### `hooks/useMotionDetection.ts` — Hook: local motion detection (canvas)
- Analyzes `<video>` frames every **500ms** on a hidden `<canvas>`.
- Converts to grayscale (downscaled to max 320px width).
- Compares with previous frame pixel-by-pixel (diff threshold: 25).
- Returns `motionScore` — percentage of changed pixels (0–100).

### `components/Sidebar.tsx` — Left sidebar (navigation + settings)
- Logo "SENTINEL" + navigation buttons with icons: "Monitoring" / "Recordings".
- Settings section: sensitivity slider (motion threshold 0.05–1), recording toggle, auto-delete toggle.
- **Desktop**: permanent sidebar (264px). **Mobile/tablet**: slide-out overlay with backdrop and close button.

### `components/Viewer.tsx` — Composed stream viewer
- Uses `useWhepViewer()` to receive WHEP stream.
- Auto-connects on mount.
- Reconnects when `reconnectTrigger` changes (camera added/removed locally).
- Polls `GET /api/inputs` every 3s — reconnects viewer if input count changes (e.g. camera connected from another device).
- "Refresh" button + `StatusBadge`.

### `components/CameraInput.tsx` — Single local camera card
- Uses `useWhipSender(clientId, slotIndex)` — auto-connects on mount, disconnects on unmount.
- Shows camera preview, `StatusBadge`, `motionScore` overlay (if available).
- Editable camera name via `EditableName`.
- "Disconnect" button.
- Notifies parent via `onConnected` / `onDisconnected` callbacks.

### `components/CameraInputList.tsx` — Local + remote cameras grid
- Manages camera slots (add/remove). Max **4 cameras** total.
- Generates a stable `clientId` (persisted in `localStorage` as `smelter-client-id`) and assigns sequential `slotIndex` per slot.
- Auto-restores slot count from previous session (`smelter-slot-count` in localStorage).
- Monitors `connectedInputs` from server — if a local camera's `inputId` disappears (and was previously confirmed by server), auto force-disconnects and removes the slot.
- Renders remote inputs (webcams from other tabs + server video files) as motion-bar-only cards with `EditableName` and disconnect button. Video inputs show a purple "FILE" badge.
- `AddCameraButton` with two options: add webcam or add server video file.

### `components/AddCameraButton.tsx` — "Add camera" / "Add video" buttons
- Two dashed border buttons side by side: "Camera" (webcam) and "Video" (server file).
- "Video" opens a picker listing files from `GET /api/local-videos`. Each file is clickable to add it as a Smelter input.

### `components/EditableName.tsx` — Inline editable camera name
- Click to edit, Enter to confirm, Escape to cancel, blur to confirm.
- Max 32 characters. Shows `placeholder` when name is empty.

### `components/ConnectedCamerasList.tsx` — All cameras from server (unused, kept for reference)
- Displays cards for all server-connected cameras with `MotionBar` (color-coded: cyan ≤20%, amber ≤50%, red >50%).
- "Disconnect" button per camera.

### `components/StatusBadge.tsx` — Connection state badge
- Maps `ConnectionState` to color + label: idle→Idle, connecting→Connecting..., connected→Connected, failed→Error, disconnected→Disconnected.

### `components/RecordingsList.tsx` — Recordings browser page
- Polls `GET /api/recordings` every **5 seconds**.
- Sorts recordings newest-first.
- Each `RecordingCard`: expandable, shows duration, severity badge (color-coded: yellow=funny, orange=moderate, red=serious), timestamp.
- Expanded view: inline `<video>` player, analysis description, download link.
- Calls `checkNewSeriousRecordings()` on each poll to trigger browser notifications.
