# smelter-surveilance

Aplikacja do monitoringu wideo w czasie rzeczywistym. Wiele kamer (przeglądarek) wysyła obraz przez WebRTC (WHIP) do serwera Smelter, który komponuje je w jeden strumień wideo i udostępnia go do odbioru przez WebRTC (WHEP).

## Architektura

```
                        ┌──────────────────────────────────────────────────┐
                        │                   server/                        │
[dashboard/]            │                                                  │
[sender.html] ──WHIP──▶ │ [Express proxy] ──▶ [Smelter engine] ──▶ output │
                        │  (routes.ts)         (smelter.tsx)               │
[dashboard/]            │                                                  │
[viewer.html] ◀──WHEP── │ [Express proxy] ◀── [App.tsx — scena React]     │
                        └──────────────────────────────────────────────────┘
```

Projekt składa się z dwóch części:
- **`server/`** — backend Express + silnik Smelter (komponowanie wideo)
- **`dashboard/`** — frontend React (Vite + Tailwind) — pełny panel zarządzania kamerami (zamiennik prostych stron `sender.html`/`viewer.html`)

## Uruchamianie

```bash
# Backend (silnik Smelter + API)
cd server
npm install
npm run dev       # tsx src/index.ts – serwer na http://localhost:3000

# Frontend dashboard (osobny dev server z proxy do backendu)
cd dashboard
npm install
npm run dev       # Vite – https://localhost:5173 (basicSsl)
```

Proste strony HTML nadal działają bezpośrednio z backendu:
- Nadawca: http://localhost:3000/sender.html
- Podgląd: http://localhost:3000/viewer.html

## Struktura plików `server/`

### `src/index.ts` — Punkt wejścia aplikacji
- Importuje i wywołuje `initializeSmelterInstance()` z `smelter.tsx`, aby uruchomić silnik Smelter.
- Uruchamia serwer Express na porcie **3000**.
- Wypisuje linki do stron nadawcy i podglądu.

### `src/smelter.tsx` — Inicjalizacja silnika Smelter
- Tworzy i eksportuje singleton `SmelterInstance` (instancja `@swmansion/smelter-node`).
- Funkcja `initializeSmelterInstance()`:
  1. Inicjalizuje silnik (`SmelterInstance.init()`).
  2. Rejestruje **output** o ID `output_1` jako endpoint WHEP (protokół do odbioru strumienia wideo).
  3. Jako scenę renderuje komponent React `<App />` — to on decyduje, jak ułożone są kamery.
  4. Konfiguruje enkoder H.264 (preset `ultrafast`) i rozdzielczość **1920×1080**.
  5. Startuje silnik (`SmelterInstance.start()`).

### `src/App.tsx` — Komponent React opisujący scenę wideo
- Używa hooków i komponentów z `@swmansion/smelter`:
  - `useInputStreams()` — zwraca wszystkie aktualnie zarejestrowane strumienie wejściowe (kamery).
  - `<Tiles>` — automatycznie rozkłada strumienie w siatce kafelków.
  - `<InputStream>` — renderuje pojedynczy strumień wideo po `inputId`.
- Tło sceny: `#161127` (ciemny fiolet).

### `src/routes.ts` — Endpointy Express (API + proxy SDP)
- **Zmienne**: `SMELTER_PORT` (domyślnie `9000`) i `SMELTER_URL` — adres wewnętrznego serwera WHIP/WHEP w Smelter.
- **Statyczne pliki**: serwuje katalog `public/`.
- **`POST /connect`** — rejestruje nowe wejście kamery:
  - Generuje unikalne `inputId` (np. `webcam_1711..._a3f`).
  - Rejestruje input typu `whip_server` w Smelter (dekoder `ffmpeg_h264`).
  - Zwraca `{ inputId, whipUrl, bearerToken }` — dane potrzebne nadawcy do nawiązania połączenia.
- **`POST /disconnect`** — wyrejestrowuje wejście kamery (po `inputId` z body).
- **`GET /whep-url`** — zwraca URL proxy WHEP (`/api/whep/output_1`) dla strony podglądu.
- **`POST /api/whip/:inputId`** — proxy SDP: przekazuje ofertę SDP od nadawcy do Smeltera i zwraca odpowiedź SDP. Obsługuje nagłówek `Authorization` (bearer token).
- **`POST /api/whep/:outputId`** — proxy SDP: przekazuje ofertę SDP od widza do Smeltera i zwraca odpowiedź SDP.

### `public/sender.html` — Strona nadawcy (kamera)
- Pobiera obraz z kamery (`getUserMedia`).
- Wywołuje `POST /connect`, aby zarejestrować się na serwerze i uzyskać `whipUrl` + `bearerToken`.
- Tworzy `RTCPeerConnection`, dodaje track wideo i negocjuje SDP przez `/api/whip/:inputId`.
- Przycisk „Rozłącz" i event `beforeunload` — wywołują `POST /disconnect` (przez `sendBeacon`).

### `public/viewer.html` — Strona podglądu (odbiór skomponowanego obrazu)
- Pobiera adres WHEP z `GET /whep-url`.
- Tworzy `RTCPeerConnection` w trybie `recvonly`.
- Negocjuje SDP przez `/api/whep/output_1`.
- Wyświetla odebrany strumień wideo w elemencie `<video>`.
- Auto-connect przy załadowaniu strony.

### `tsconfig.json` — Konfiguracja TypeScript
- `jsx: "react-jsx"` — JSX bez importu React (nowy transform).
- `module/moduleResolution: "NodeNext"` — natywne moduły Node.js.
- Output do `dist/`.

### `package.json` — Zależności i skrypty
- **Kluczowe zależności**: `@swmansion/smelter` (komponenty React do komponowania wideo), `@swmansion/smelter-node` (silnik), `express`, `react`, `zustand` (stan).
- **Skrypty**: `dev` (tsx), `build:server` (tsc), `start` (node dist).

---

## Struktura plików `dashboard/`

Aplikacja React 19 + Vite 8 + Tailwind CSS 4. Dev server używa `basicSsl` (HTTPS wymagane do `getUserMedia` na urządzeniach mobilnych). Proxy w `vite.config.ts` przekierowuje `/api/*`, `/connect`, `/disconnect`, `/whep-url` na `http://localhost:3000` (backend).

### `src/types.ts` — Wspólne typy
- `InputInfo` — `{ inputId: string; connectedAt: number }` — opis podłączonej kamery z serwera.
- `ConnectionState` — `'idle' | 'connecting' | 'connected' | 'failed' | 'disconnected'` — stan połączenia WebRTC.

### `src/main.tsx` — Punkt wejścia
- Renderuje `<App />` w `#root`.

### `src/App.tsx` — Komponent root
- Renderuje `<Layout />`.

### `src/index.css` — Style globalne
- Import Tailwind + custom theme colors: `sentinel-bg` (#0B1120), `sentinel-card` (#111827), `sentinel-border` (#1E293B).

### `src/api/client.ts` — Klient HTTP (funkcje API)
- `registerInput()` — `POST /connect` → zwraca `{ inputId, whipUrl, bearerToken }`.
- `unregisterInput(inputId)` — `POST /disconnect`.
- `sendBeaconDisconnect(inputId)` — `sendBeacon` do `/disconnect` (na `beforeunload`).
- `getWhepUrl()` — `GET /whep-url` → zwraca URL WHEP.
- `listInputs()` — `GET /api/inputs` → lista `InputInfo[]` (wszystkie kamery podłączone do serwera).
- `getMotionScores()` — `GET /api/motion` → `Record<string, number>` (wynik detekcji ruchu per kamera).
- `sendSdp(url, sdp, bearerToken?)` — wysyła SDP offer i odbiera answer (WHIP/WHEP).

### `src/lib/webrtc.ts` — Helpery WebRTC
- `ICE_SERVERS` — konfiguracja STUN (Google).
- `ICE_GATHERING_TIMEOUT` — 5s timeout na ICE gathering.
- `preferBaselineH264(transceiver)` — wymusza H.264 Constrained Baseline (profil `42*`) na senderze, by uniknąć problemów z dekoderem FFmpeg przy strumieniach High profile (np. z mobilnych).
- `waitForIceGathering(pc)` — czeka na zakończenie ICE gathering z timeoutem.

### `src/hooks/useWhipSender.ts` — Hook: wysyłanie kamery (WHIP)
- Zarządza cyklem życia nadawcy: `getUserMedia` → `POST /connect` → negocjacja SDP → stream.
- Używa `preferBaselineH264()` na transceiver.
- `connect()` — pełny flow połączenia.
- `disconnect(skipServer?)` — zamyka PC, zatrzymuje kamerę, opcjonalnie pomija `POST /disconnect` (gdy serwer już usunął input).
- Na `beforeunload` wysyła `sendBeacon` disconnect.
- Zwraca: `{ previewRef, connectionState, error, inputId, connect, disconnect }`.

### `src/hooks/useWhepViewer.ts` — Hook: odbiór skomponowanego obrazu (WHEP)
- Tworzy `RTCPeerConnection` w trybie `recvonly`.
- `connect()` — pobiera WHEP URL, negocjuje SDP, przypisuje stream do `<video>`.
- Zwraca: `{ videoRef, connectionState, error, connect }`.

### `src/hooks/useConnectedInputs.ts` — Hook: lista podłączonych kamer z serwera
- Polluje `GET /api/inputs` co **2 sekundy**.
- Zwraca `InputInfo[]` — stan kamer widocznych dla serwera (w tym z innych urządzeń).

### `src/hooks/useMotionScores.ts` — Hook: wyniki detekcji ruchu z serwera
- Polluje `GET /api/motion` co **1 sekundę**.
- Zwraca `Record<string, number>` — procent pikseli ze zmianą per `inputId`.

### `src/hooks/useMotionDetection.ts` — Hook: lokalna detekcja ruchu (canvas)
- Analizuje klatki z `<video>` co **500ms** na ukrytym `<canvas>`.
- Konwertuje do grayscale (downscale do max 320px szerokości).
- Porównuje z poprzednią klatką pixel-by-pixel (próg różnicy: 25).
- Zwraca `motionScore` — procent pikseli, które się zmieniły (0–100).

### `src/components/Layout.tsx` — Główny layout dashboardu
- Header z logo „SENTINEL".
- Sekcje: `<Viewer>` (podgląd), `<ConnectedCamerasList>` (lista ze wszystkich urządzeń), `<CameraInputList>` (lokalne kamery).
- Zarządza `reconnectTrigger` — wymusza ponowne połączenie viewera gdy zmieni się liczba kamer.
- Używa `useMotionScores()` i `useConnectedInputs()` i przekazuje dane do child komponentów.

### `src/components/Viewer.tsx` — Podgląd skomponowanego strumienia
- Używa `useWhepViewer()` do odbioru strumienia WHEP.
- Auto-connect na mount.
- Reconnect gdy `reconnectTrigger` się zmieni (dodanie/usunięcie kamery).
- Polluje `GET /api/inputs` co 3s — jeśli liczba kamer się zmieni (np. ktoś podłączył z innego urządzenia), reconnectuje viewer.
- Przycisk „Odśwież" + `StatusBadge`.

### `src/components/CameraInput.tsx` — Pojedyncza lokalna kamera
- Używa `useWhipSender()` — auto-connect na mount, disconnect na unmount.
- Wyświetla podgląd z kamery, `StatusBadge`, `motionScore` (jeśli dostępny).
- Przycisk „Rozłącz".
- Notyfikuje parent (`onConnected`, `onDisconnected`) o zmianach stanu.

### `src/components/CameraInputList.tsx` — Lista lokalnych kamer
- Zarządza slotami kamer (dodawanie/usuwanie).
- Persystuje liczbę kamer w `localStorage` (`sentinel_camera_count`).
- Monitoruje `connectedInputs` z serwera — jeśli `inputId` lokalnej kamery zniknie z serwera, automatycznie ją force-disconnectuje i usuwa slot.
- Renderuje `<CameraInput>` per slot + `<AddCameraButton>`.

### `src/components/AddCameraButton.tsx` — Przycisk „Dodaj kamerę"
- Dashed border button z ikoną „+".

### `src/components/ConnectedCamerasList.tsx` — Lista wszystkich kamer z serwera
- Wyświetla karty z wszystkimi kamerami podłączonymi do serwera (w tym z innych urządzeń).
- Każda karta: ID kamery, czas podłączenia, `MotionBar` (pasek ruchu z kolorami: cyan ≤20%, amber ≤50%, red >50%).
- Przycisk „Rozłącz" — wywołuje `unregisterInput()` (serwer usunie kamerę).

### `src/components/StatusBadge.tsx` — Badge stanu połączenia
- Mapuje `ConnectionState` na kolor + label PL: idle→Oczekiwanie, connecting→Łączenie, connected→Połączono, failed→Błąd, disconnected→Rozłączono.