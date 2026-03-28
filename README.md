# smelter-surveilance

Real-time video surveillance app. Multiple cameras (browsers) send video via WebRTC (WHIP) to a Smelter engine, which composites them into a single output stream available for viewing via WebRTC (WHEP). Server-side motion detection (Python + RTP) triggers automatic recording and AI analysis (Gemini) of clips. The focused camera switches automatically based on motion scores.

## Architecture

```
                        ┌──────────────────────────────────────────────────────────┐
                        │                        server/                           │
[dashboard] ──WHIP────▶ │ Express ──▶ Smelter engine ──▶ scene (App.tsx)           │
                        │  proxy       ├── motion.tsx (RTP → Python detector)      │
[dashboard] ◀──WHEP──── │  (routes.ts) ├── recorder.tsx (MP4 clips on motion)     │
                        │              ├── gemini.ts (AI analysis of clips)        │
                        │              └── focusStore.ts (auto-focus logic)        │
                        └──────────────────────────────────────────────────────────┘
```

The project has two packages:
- **`server/`** — Express backend + Smelter video compositing engine + motion detection + recording + Gemini AI analysis
- **`dashboard/`** — React 19 frontend (Vite + Tailwind) — full camera management panel with live monitoring and recordings browser

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
- Calls `initializeSmelterInstance()` to start the Smelter engine.
- Starts Express on port **3000**.

### `smelter.tsx` — Smelter engine initialization
- Creates and exports singleton `SmelterInstance` (`@swmansion/smelter-node`).
- `initializeSmelterInstance()`:
  1. Initializes the engine (`SmelterInstance.init()`).
  2. Registers **output** `output_1` as a WHEP server endpoint.
  3. Renders the React scene `<App />` — determines camera layout.
  4. Encoder: H.264 `ultrafast`, resolution **1920×1080**.
  5. Starts the engine (`SmelterInstance.start()`).

### `App.tsx` — React scene component (video layout)
- Uses `useInputStreams()` to get all registered camera streams.
- Uses `useFocusedInputId()` from `focusStore` to determine which camera has motion focus.
- **Layout logic** (max 4 cameras):
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
  - Switch cooldown: **3 seconds** (`COOLDOWN_MS`).
  - A new camera must have ≥ 2× the current camera's score (`DOMINANCE_FACTOR`) to steal focus.
- `handleDisconnect(inputId)` — clears focus when camera disconnects.

### `motion.tsx` — Server-side motion detection
- Spawns a long-running Python process (`motion_detector.py --server`) that receives RTP streams and outputs motion scores as JSON lines on stdout.
- For each camera input, registers a low-res Smelter output (`160×120`, H.264 ultrafast) as an RTP stream to `127.0.0.1` on sequential UDP ports.
- Communicates with the Python process via stdin (JSON commands: `add`, `remove`, `shutdown`).
- On receiving a `score` message from Python:
  - Updates `motionScores` map.
  - Calls `updateFocus()` in `focusStore`.
  - Calls `handleMotionForRecording()` in `recorder`.
  - Triggers `onScoreCallback` (used by `routes.ts` to update `lastSeenAt` for stale input cleanup).
- `getMotionScores()` — returns all current scores.
- `shutdownMotion()` — kills the Python process.

### `recorder.tsx` — Motion-triggered recording
- When motion score exceeds threshold and recording is enabled:
  - Registers a Smelter output of type `mp4` (640×480, H.264 `fast`) writing to `server/recordings/`.
  - Clip duration: min **3s**, max **5s**. Stops early if motion drops below threshold after min duration.
  - **10s cooldown** between recordings per camera.
- After a recording completes, fires off Gemini analysis (`analyzeRecording()`).
- `getRecordings()` — returns completed recordings with analysis results attached, filtering out those marked `'nie ważny'` (unimportant — Polish legacy filter).
- `setRecordingEnabled(bool)` / `setMotionThreshold(value)` — runtime config.

### `gemini.ts` — AI video analysis (Google Gemini)
- Uploads recorded MP4 clips to Google Gemini via `GoogleAIFileManager`.
- Waits for file to be fully written (polls file size for stability, up to 30s).
- Waits for server-side processing (`PROCESSING` → `ACTIVE`).
- Prompts `gemini-2.5-flash` to analyze as a home security camera clip and return JSON with:
  - `description` — 1-2 sentence description of what happened.
  - `severity` — one of: `funny`, `unimportant`, `moderate`, `serious`.
- Deletes the uploaded file from Google servers after analysis.
- If `autoDeleteUnimportant` is enabled (default: true) and severity is `unimportant`, deletes the local MP4 file.
- Sequential queue (`enqueue`) to avoid rate limits.
- `getAnalysis(filename)` / `getAllAnalyses()` — retrieve results.

### `routes.ts` — Express endpoints (API + SDP proxy)
- **CORS**: allows `CORS_ORIGIN` (default `http://localhost:5173`).
- **Static files**: serves `public/` directory.
- **Stale input cleanup**: tracks `lastSeenAt` per input (updated via motion score callbacks). Every 5s, removes inputs not seen for 10s.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/connect` | Register new WHIP camera input. Returns `{ inputId, whipUrl, bearerToken }`. Starts motion detection. |
| `POST` | `/disconnect` | Unregister camera input. Stops motion detection. |
| `GET` | `/api/inputs` | List all active inputs with `connectedAt` / `lastSeenAt`. |
| `GET` | `/api/motion` | Get motion scores for all inputs. |
| `GET` | `/whep-url` | Get WHEP viewer proxy URL (`/api/whep/output_1`). |
| `GET` | `/api/recording-enabled` | Check if recording is enabled. |
| `POST` | `/api/recording-enabled` | Toggle recording on/off (`{ enabled: bool }`). |
| `GET` | `/api/motion-threshold` | Get current motion threshold (0–1). |
| `POST` | `/api/motion-threshold` | Set motion threshold (`{ threshold: number }`). |
| `GET` | `/api/auto-delete` | Check if auto-delete of unimportant clips is enabled. |
| `POST` | `/api/auto-delete` | Toggle auto-delete (`{ enabled: bool }`). |
| `GET` | `/api/recordings` | List recorded clips with analysis results. |
| `GET` | `/api/recordings/:filename` | Serve a recorded MP4 clip (static). |
| `POST` | `/api/whip/:inputId` | SDP proxy: forwards WHIP offer from browser to Smelter. Passes `Authorization` header. |
| `POST` | `/api/whep/:outputId` | SDP proxy: forwards WHEP offer from viewer to Smelter. |

### `package.json` — Dependencies & scripts
- **Key dependencies**: `@swmansion/smelter` (React video compositing), `@swmansion/smelter-node` (engine), `express`, `cors`, `dotenv`, `react`, `@google/generative-ai` (Gemini).
- **Scripts**: `dev` (tsx), `build:server` (tsc), `start` (node dist).

---

## Dashboard files (`dashboard/src/`)

React 19 + Vite 8 + Tailwind CSS 4 application. Dev server uses `basicSsl` (HTTPS required for `getUserMedia` on mobile). Proxy in `vite.config.ts` forwards `/api/*`, `/connect`, `/disconnect`, `/whep-url` to `http://localhost:3000`.

### `types.ts` — Shared types
- `InputInfo` — `{ inputId: string; connectedAt: number }`.
- `ConnectionState` — `'idle' | 'connecting' | 'connected' | 'failed' | 'disconnected'`.
- `AnalysisResult` — `{ description: string; severity: string; analyzedAt: number }`.
- `RecordingInfo` — `{ filename, inputId, timestamp, durationMs, analysis?: AnalysisResult }`.

### `main.tsx` — Entry point
- Renders `<App />` into `#root`.

### `App.tsx` — Root component with page navigation
- Manages page state: `'monitoring'` or `'recordings'`.
- Renders `<Navbar>` + either `<Layout>` (monitoring) or `<RecordingsList>`.
- Requests browser notification permission on mount.

### `index.css` — Global styles
- Tailwind import + custom theme: `sentinel-bg` (#0B1120), `sentinel-card` (#111827), `sentinel-border` (#1E293B).

### `api/client.ts` — HTTP client (API functions)
- `registerInput()` — `POST /connect` → `{ inputId, whipUrl, bearerToken }`.
- `unregisterInput(inputId)` — `POST /disconnect`.
- `sendBeaconDisconnect(inputId)` — `sendBeacon` to `/disconnect` (on `beforeunload`).
- `getWhepUrl()` — `GET /whep-url`.
- `listInputs()` — `GET /api/inputs` → `InputInfo[]`.
- `getMotionScores()` — `GET /api/motion` → `Record<string, number>`.
- `getRecordingEnabled()` / `setRecordingEnabled(bool)` — `GET/POST /api/recording-enabled`.
- `getMotionThreshold()` / `setMotionThreshold(number)` — `GET/POST /api/motion-threshold`.
- `getAutoDeleteEnabled()` / `setAutoDeleteEnabled(bool)` — `GET/POST /api/auto-delete`.
- `getRecordings()` — `GET /api/recordings` → `RecordingInfo[]`.
- `sendSdp(url, sdp, bearerToken?)` — SDP offer/answer exchange (WHIP/WHEP).

### `lib/webrtc.ts` — WebRTC helpers
- `ICE_SERVERS` — STUN config (Google).
- `ICE_GATHERING_TIMEOUT` — 5s.
- `preferBaselineH264(transceiver)` — forces H.264 Constrained Baseline profile (`42*`) to avoid FFmpeg decoder issues with High profile streams from mobile.
- `waitForIceGathering(pc)` — waits for ICE gathering with timeout.

### `lib/notifications.ts` — Browser notifications for serious events
- `requestNotificationPermission()` — asks user for permission on mount.
- `checkNewSeriousRecordings(recordings)` — called during recordings polling. On first call, marks existing serious recordings as seen. On subsequent calls, shows a native `Notification` ("ALARM: Suspicious activity!") for any new recording with `severity === 'serious'`. Uses `requireInteraction: true`.

### `hooks/useWhipSender.ts` — Hook: camera sender (WHIP)
- Manages sender lifecycle: `getUserMedia` → `POST /connect` → SDP negotiation → stream.
- Uses `preferBaselineH264()` on transceiver.
- `connect()` — full connection flow.
- `disconnect(skipServer?)` — closes PC, stops camera, optionally skips server unregister.
- On `beforeunload`, sends `sendBeacon` disconnect.
- Returns: `{ previewRef, connectionState, error, inputId, connect, disconnect }`.

### `hooks/useWhepViewer.ts` — Hook: composed stream viewer (WHEP)
- Creates `RTCPeerConnection` in `recvonly` mode.
- `connect()` — fetches WHEP URL, negotiates SDP, assigns stream to `<video>`.
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

### `components/Navbar.tsx` — Top navigation bar
- Logo "SENTINEL" + navigation buttons: "Monitoring" / "Recordings".
- Calls `onNavigate(page)` to switch pages.

### `components/Layout.tsx` — Main monitoring page layout
- Sections: `<Viewer>` (composed stream) + `<CameraInputList>` (local cameras + remote cameras).
- Controls: sensitivity slider (motion threshold 0.05–1), recording toggle, auto-delete toggle.
- Fetches initial state of recording/threshold/auto-delete from server on mount.
- Manages `reconnectTrigger` — forces viewer reconnect when camera count changes.

### `components/Viewer.tsx` — Composed stream viewer
- Uses `useWhepViewer()` to receive WHEP stream.
- Auto-connects on mount.
- Reconnects when `reconnectTrigger` changes (camera added/removed locally).
- Polls `GET /api/inputs` every 3s — reconnects viewer if input count changes (e.g. camera connected from another device).
- "Refresh" button + `StatusBadge`.

### `components/CameraInput.tsx` — Single local camera card
- Uses `useWhipSender()` — auto-connects on mount, disconnects on unmount.
- Shows camera preview, `StatusBadge`, `motionScore` overlay (if available).
- "Disconnect" button.
- Notifies parent via `onConnected` / `onDisconnected` callbacks.

### `components/CameraInputList.tsx` — Local + remote cameras grid
- Manages camera slots (add/remove). Max **4 cameras** total.
- Persists camera count in `localStorage` (`sentinel_camera_count`).
- Monitors `connectedInputs` from server — if a local camera's `inputId` disappears from server (and was previously confirmed), auto force-disconnects and removes the slot.
- Renders remote cameras (connected on server but without a local slot) as motion-bar-only cards with disconnect button.
- Renders `<AddCameraButton>` placeholders for remaining empty slots.

### `components/AddCameraButton.tsx` — "Add camera" button
- Dashed border button with "+" icon.

### `components/ConnectedCamerasList.tsx` — All cameras from server
- Displays cards for all server-connected cameras (including other devices).
- Each card: camera ID, connection time, `MotionBar` (color-coded: cyan ≤20%, amber ≤50%, red >50%).
- "Disconnect" button — calls `unregisterInput()`.

### `components/StatusBadge.tsx` — Connection state badge
- Maps `ConnectionState` to color + label: idle→Waiting, connecting→Connecting, connected→Connected, failed→Error, disconnected→Disconnected.

### `components/RecordingsList.tsx` — Recordings browser page
- Polls `GET /api/recordings` every **5 seconds**.
- Sorts recordings newest-first.
- Each `RecordingCard`: expandable, shows duration, severity badge (color-coded), timestamp.
- Expanded view: inline `<video>` player, analysis description, download link.
- Calls `checkNewSeriousRecordings()` on each poll to trigger browser notifications.
