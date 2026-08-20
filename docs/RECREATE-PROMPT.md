# Recreate "Quran Habit" — full build prompt

Paste everything below (from `---BEGIN PROMPT---` to `---END PROMPT---`) to an
AI coding agent to rebuild this app from an empty directory. It is written as
instructions to that agent, and deliberately includes the failures we already
paid for, so they are not repeated.

---BEGIN PROMPT---

Build me an Android-first Islamic habit companion app called **Quran Habit**
in React Native. Work incrementally, verifying each stage before moving on.
Everything below is a requirement unless marked optional.

## 1. Stack and constraints

- **Expo SDK 52**, React Native 0.76, React 18.2, TypeScript strict mode.
- **expo-router v4** (file-based routing, `typedRoutes` experiment on, scheme
  `quranhabit`).
- Android package `com.quranhabit.app`; permissions `RECORD_AUDIO`,
  `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`.
- The app uses **custom native modules**, so Expo Go cannot run it. Builds are
  **expo-dev-client APKs via EAS Build** (`eas build -p android --profile
  development`). Plan for that from the start.
- Development happens in a **cloud dev container / Codespace**, with the phone
  connecting to Metro over a **cloudflared quick tunnel** (details in §10).
- Portrait only, light UI.

Dependencies (exact versions matter for the Expo 52 line):

```
@expo-google-fonts/amiri, @expo-google-fonts/amiri-quran,
@expo/vector-icons ~14.0.4, @fugood/react-native-audio-pcm-stream ^1.1.4,
@react-native-async-storage/async-storage 1.23.1,
@react-native-voice/voice 3.2.4, expo ~52.0.0, expo-av ~15.0.2,
expo-build-properties ~0.13.2, expo-constants ~17.0.0,
expo-dev-client ~5.0.20, expo-font ~13.0.2, expo-linking ~7.0.5,
expo-location ~18.0.4, expo-router ~4.0.0, expo-status-bar ~2.0.1,
react-native-safe-area-context 4.12.0, react-native-screens ~4.4.0,
whisper.rn ^0.7.2
devDeps: patch-package ^8, quran-json ^3.1.2, quran-meta ^6.0.17,
typescript ^5.3.3, @expo/config-plugins ~8.0.0
```

## 2. App structure

Three bottom tabs (`app/(tabs)/`):

1. **Prayer** (`index.tsx`) — today's prayer times from the device location
   (Aladhan API via `src/services/prayerApi.ts`, `usePrayerTimes` hook),
   next-prayer countdown, check-off of completed prayers.
2. **Quran** (`quran.tsx`) — searchable list of all 114 surahs (Arabic name,
   transliteration, translation, verse count, Meccan/Medinan).
3. **Tracker** (`tracker.tsx`) — daily habit streak (`useStreak`,
   AsyncStorage-backed via `src/storage/local.ts`).

Surah screen (`app/surah/[id].tsx`) has exactly **two tabs: Listen | Read**.
- **Listen** — audio recitation playback per ayah (expo-av, audio from
  `cdn.islamic.network`; this is the only feature allowed to need the network).
- **Read** — IS the recitation follow-along experience (§4). Not a plain
  reader. Render it as `<ReciteView key={id} surahId={Number(id)} />`.

There must be **no separate "Memorize" tab or screen** — hide/reveal
memorization is a mode inside Read.

Also `app/recite/[id].tsx` — a thin standalone wrapper around `ReciteView`
used by cross-surah voice jumps, reading query params `ayah`, `w` (word
offset), `auto` (autostart), `e` (engine), `t` (transcript). It **must** pass
`key={id}` so expo-router cannot reuse a stale screen instance.

## 3. Offline Quran data (build-time generated, bundled)

Never fetch Quran text at runtime — early versions did and verse search
silently failed offline, plus surah loads were slow.

Write two generator scripts run once at build time:

- `scripts/generateQuranData.ts` → `src/assets/quran-data.json` (~1.4MB):
  display text plus Madani **page** and **juz** numbers per ayah. Get text
  from `quran-json`, page/juz from `quran-meta`'s `createHafs().findPage()` /
  `findJuz()`. Store compact rows to keep the file small:
  `[surah, name, translit, translation, type, [[numInSurah, globalNum, page, juz, text], ...]]`.
  Validate a few pages against a printed mushaf.
- `scripts/generateQuranIndex.ts` → `src/assets/quran-index.json` (~770KB):
  **normalized** searchable text for every ayah, used by voice verse search.
  Prepend the basmala to ayah 1 of every surah **except surah 1 and surah 9**
  (matching how people actually recite).

`src/services/quranApi.ts` reads the bundled data; `src/services/quranIndex.ts`
reads the bundled index.

## 4. The Read tab: recitation follow-along (the heart of the app)

Inspired by Tarteel. Two modes, chosen by a segmented control:

- **Follow** — the whole page is visible; words already recited are marked
  progressively, and the word you are on is highlighted.
- **Hidden** — words are hidden and **revealed one by one as you recite them**
  (memorization testing). A "Peek" button reveals the next word manually.

Both modes share one alignment session. Requirements:

- **Reveal must feel instant.** The user's repeated demand was "SOOO FAST".
  Drive the UI from streaming partial results, never only from final results.
- **Mistake tracking.** A word you skipped or misread is flagged. A mistakes
  button opens a list showing the **wrong word in red next to the correct
  word highlighted**, each with an **"I said it right"** button that
  permanently dismisses that false positive.
- **Breath restart.** If you pause for breath and resume from an *earlier*
  point in the verse, it must follow you back there **without losing the
  furthest progress you already reached**. This requires two distinct
  positions: `cursor` (furthest progress, never decreases, drives reveal) and
  `livePos` (where you are right now, may move backwards, drives the
  highlight).
- **Voice verse search.** If you start reciting *any* verse in the Quran —
  even one in a different surah — it must find it and take you there. It must
  work whether or not you begin with بسم الله الرحمن الرحيم, must be **fast**,
  and on arrival must **credit the words you already recited** rather than
  dumping you at the verse's first word and calling the rest mistakes.
- **Mushaf page layout.** Verses are laid out on **paper-look pages, swiped
  horizontally — never a scrolling list.** Use an inverted horizontal
  `FlatList` (RTL reading order) with `getItemLayout`. Add **sentinel pages**
  at both ends so swiping past the first page of Al-Baqarah navigates to
  Al-Fatiha's last page, and vice versa, detected in `onMomentumScrollEnd`.
  Auto-turn the page when the live position moves onto another page.
- Memo-compare page components by reference and clamp cursor/livePos to each
  page's word range, or every recognized word re-renders every page.

## 5. The alignment engine (`src/utils/recitationMatcher.ts`)

Do **not** try to transcribe openly and compare strings. We know the exact
expected text, so *align*: match each heard word against a small look-ahead
window of expected words and advance a cursor. Confirming "is the next word X?"
is far easier than open transcription, which makes even a mediocre recognizer
usable.

- `normalizeWord()` — strip tashkeel and Quranic annotation marks
  (U+0610–U+0670, U+06D6–U+06ED ranges), fold hamza forms
  (أإآٱ→ا, ؤ→و, ئ→ي, drop ء), ة→ه, ى→ي, drop non-Arabic characters.
- `wordsSimilar()` — Levenshtein with **tight** thresholds, because Quranic
  Arabic is full of near-minimal pairs: words of length ≤2 must match
  **exactly**; maxLen ≤6 allows distance 1; maxLen ≤9 allows 2; longer allows
  ratio ≤0.28. Verify that **الرحمن and الرحيم never cross-match** — a looser
  setting broke Al-Fatiha.
- `alignTranscript(expectedNorm, startCursor, transcript, lookAhead)` returns
  `{cursor, pos, missed[]}` and must be **idempotent** — re-runnable from the
  same start as a partial transcript grows.
  - Skipped expected words become `missed` entries, each carrying a
    best-effort "what you actually said" from a buffer of unmatched heard
    words.
  - Skips inside already-recited territory (a replay) are **not** mistakes.
  - **Self-healing**: a heard word that matches an already-flagged miss
    retracts that miss (recognizers emit words late).
  - **Breath re-entry**: an unmatched word of length ≥3 is searched backwards
    up to 24 words from the furthest progress; if found, the live position
    re-anchors there.
  - Words that normalize to empty are auto-consumed so they never block.
- `alignCandidates()` — align all recognizer alternatives, keep the best
  (furthest cursor, then fewest mistakes). Lower-ranked alternatives are often
  the correct one for Quranic Arabic.
- Look-ahead width: **3 words once locked on, 8 until locked on** (or after a
  jump — see §7).

## 6. Two recognition engines, user-switchable

Show a chip in the controls row (disabled while listening): **⚡ Fast** and
**🎯 Precise**. Both hooks stay mounted (hooks can't be conditional); only the
selected one is driven. They must expose an **identical interface**:
`{cursor, livePos, missed, peeked, active, error, lastHeard?, start, stop,
reset, peekWord, dismissMiss, seekTo, adopt}`.

### ⚡ Fast — `src/hooks/useRecitationSession.ts`

Android's `SpeechRecognizer` via `@react-native-voice/voice`, `ar-SA`.

- Start options: `EXTRA_PARTIAL_RESULTS: true`, `EXTRA_MAX_RESULTS: 5`, and
  stretched silence windows (complete/possibly-complete 6000ms, minimum
  30000ms) so a breath does not end the utterance. Utterance restarts are the
  single biggest source of reveal latency.
- Android stops after pauses: auto-restart (~80ms) while the session is
  active, and treat error codes 5, 6, 7, 8, 11 as transient → restart
  silently.
- `@react-native-voice/voice`'s handlers are **global singletons**. When one
  screen replaces another, the outgoing screen's cleanup wipes the listeners
  the incoming screen just registered. Therefore: **re-assert the listeners on
  every start and every restart**, and never call `removeAllListeners`.
- **Microphone handoff across a cross-surah jump**: a module-level
  `prepareVoiceHandoff()` flag makes the outgoing screen's cleanup leave the
  engine running, and the incoming screen's `adopt()` claims the live
  utterance mid-stream so words spoken during navigation aren't lost. Include
  a 5s safety timer that destroys the engine if nobody adopts.
- **Deaf-session watchdog (essential):** while active, if no recognizer event
  has arrived for 2.5s, restart. Android frequently kills the recognizer
  during a screen transition **with no event at all**, and without this the UI
  says "listening" forever while hearing nothing.

### 🎯 Precise — `src/hooks/useLocalWhisperSession.ts`

Tarteel's open-sourced Quran-tuned Whisper (`tarteel-ai/whisper-base-ar-quran`)
running **on the phone** via `whisper.rn` (whisper.cpp).

Why on-device: a server version that POSTed short recorded chunks was built
first and **failed structurally** — recording in ~4s files slices words at the
file boundaries. Isolated chunks transcribed perfectly while mid-recitation
chunks were garbage. The fix is one continuous audio stream, which is also
what Tarteel does.

- Audio: `AudioPcmStreamAdapter` from whisper.rn (needs
  `@fugood/react-native-audio-pcm-stream`), 16kHz mono s16le, `audioSource: 6`
  (VOICE_RECOGNITION).
- **Do NOT use whisper.rn's `RealtimeTranscriber`.** It queues a
  re-transcription of the whole growing slice every 200ms while each pass
  takes seconds on a phone CPU — the backlog explodes and updates stop after
  the first result. Write your own pump instead: transcribe the freshest audio
  snapshot, **await it**, then transcribe whatever is fresh by then. Zero
  backlog by construction.
- Pass `audioCtx = min(1500, ceil(durationSec * 50) + 64)` so encoding cost
  scales with the actual audio instead of always paying for a 30s window.
  Also `language: 'ar'`, `temperature: 0`, `maxThreads: 4`.
- Slice rollover: soft-cut at a **breath pause** (trailing-window RMS < ~350
  over the last 0.35s) once past ~10s; hard-cut at ~16s keeping **1s overlap**
  so no word is lost if the reciter never pauses. Align over the joined slice
  texts.
- Guard every async result with a **start sequence number** and an **epoch
  counter** (bumped by `seekTo`), so an in-flight pass from before a stop or a
  jump can't write stale text.
- `adopt()` returns false — an on-device session cannot adopt an Android
  recognizer utterance.

## 7. Cross-surah / mid-Quran jumps (the fiddly part)

Voice search (`findVerseByPhrase` in `src/services/quranIndex.ts`):
- Exact-substring pass over a padded normalized cache first, then fuzzy
  word-level matching; try phrase lengths 6 down to 3; skip the first 0–1
  heard words (recognizer garble); the current surah wins ties (`preferSurah`).
- Ambiguity gate: a 3-word phrase only counts if it is unique in the Quran.
- Also try the **basmala-stripped** form first (`stripLeadingBismillah`),
  because nearly every surah opens with it and the words *after* it identify
  the verse; then the full phrase; then the **last 8 words alone** as a last
  resort, since the head of the buffer may be stale garble.
- Trim the search buffer to the **freshest ~12 words**.

Trigger rule — use a **surplus** test, not "no progress at all": fire when
(heard words − cursor progress) ≥ 3 for a fresh session, ≥ 5 once locked on,
and only refire after 2+ new words. Reason: a recitation opening with Bismillah
matches the *current* surah's own basmala, which would otherwise disarm the
search forever.

Also require **≥3 words of advance before considering a session "locked on"**,
or 1–2-word fuzzy junk anchors the session in the wrong place.

On arrival, whether same-surah or cross-surah:
- If the target is within ~6 words of where you already are, do nothing.
- Credit the triggering transcript by aligning it **from the landing point**
  and jumping past what it covers.
- **`seekTo` must re-open the wide (8-word) look-ahead window, not mark the
  session as locked on.** This was a real bug: marking it locked narrowed
  matching to 3 words, but the reciter keeps going during search and
  navigation and lands 4–6 words ahead, outside that window — the cursor froze
  on the verse's first word forever.
- Add a ~1.5s cooldown after a jump so the transcript that triggered it does
  not immediately trigger another search.
- Cross-surah: Fast engine calls `prepareVoiceHandoff()` then
  `router.replace('/recite/<surah>?ayah=..&w=..&auto=1&e=..&t=..')`; Precise
  stops first (it cannot hand off), and the destination cold-starts with a
  ~200ms delay so the old engine finishes releasing the microphone.

## 8. UI design (the user cares a lot about this — "REAAALLY GOOOD work")

- Fonts: **Amiri Quran** for ayah body text (it renders tashkeel and Quranic
  marks correctly), **Amiri / Amiri Bold** for other Arabic. Load with
  `useFonts` in `app/_layout.tsx` and render nothing until loaded.
- Palette (`src/constants/theme.ts`): deep green primary `#1B4332`, lighter
  `#2D6A4F`, gold accent `#C9A227`, soft gold `#F3E7C3`, background `#F6F2E9`,
  **paper `#FBF7EC`** with edge `#E7DDC8`, text `#20241F` / `#6F6B60`, border
  `#E5E0D3`, error `#B3261E` / soft `#F9E2E0`, success `#2D6A4F` / soft
  `#E4EFE7`.
- Mushaf pages look like **paper cards** with a gold rule at the top and the
  page number in a circle at the bottom.
- Controls row: Follow / Hidden segmented control + engine chip.
- A status strip under it shows what the Precise engine last heard, and
  download/loading progress.
- Bottom bar: stats column (session timer + small inline reset icon +
  mistakes count/button) · Peek button (Hidden mode) · large round **mic
  button that pulses while listening** (Animated).
- Ayah numbers in ornamental gold brackets between verses.

## 9. Model preparation (one-time, server side of the dev setup)

A small FastAPI dev server (`server/main.py`) exists only to serve the model
file to the phone (`GET /model`) and report health (`GET /health` →
`{ok, model, ggml, ggml_size}`).

`server/convert-ggml.sh` converts the Tarteel checkpoint to ggml:
`huggingface_hub.snapshot_download("tarteel-ai/whisper-base-ar-quran")`, then
whisper.cpp's `models/convert-h5-to-ggml.py`, then quantize to q8_0 (~78MB).

**Three traps, all of which cost real time:**

1. The converter writes `config.json`'s `max_length` (1024 — a
   text-*generation* setting) into the header's `n_text_ctx`, but a Whisper
   **base** decoder's real context is **448**. Every whisper.cpp then refuses
   the file with `tensor 'decoder.positional_embedding' has wrong size in
   model file / shape: [512, 448, 1], expected: [512, 1024, 1]`. The weights
   are fine — patch the single int32 at **byte offset 24** to 448. Ship a
   script that does this after every conversion, and make it idempotent.
2. whisper.cpp renamed the quantizer target from `quantize` to
   `whisper-quantize`. Try both, never abort, and fall back to shipping the
   f16 file.
3. Verify the finished model by loading it with the **exact whisper.cpp
   version `whisper.rn` bundles** (0.7.2 → v1.9.1) before blaming the app.
   Ship that as a test script.

Server-side download endpoint rules: return a **real 404** when the model is
missing — an error JSON returned with HTTP 200 gets happily saved by the app
as "the model" and then fails to load with a useless message.

App-side download rules (`ensureModel`): cache in
`FileSystem.documentDirectory`; validate the file is **>10MB**, starts with
the **ggml magic** (`"lmgg"` on disk = base64 `bG1nZw==`), and matches the
**exact byte size** the server reports; delete and re-download otherwise.
Activate the mic UI **immediately** on tap and show download percentage — the
first tap fetches ~78MB and otherwise looks dead. Use a start sequence number
so a cancelled start can't resurrect the session. Init with `useGpu: false`
(Android GPU delegates fail on many devices) and surface the **real** native
error: whisper.rn rejects with a plain `{message, code}` object, so
`instanceof Error` checks stringify to `[object Object]` — unwrap `.message`.

## 10. Dev workflow (cloud container + physical phone)

Write `scripts/dev.sh` as the single entry point. It must:
1. `pkill` stale `uvicorn main:app` and `cloudflared tunnel` processes (a
   stale uvicorn holding port 8000 silently serves *old code*).
2. Start a **cloudflared quick tunnel** for Metro's port 8081.
3. Start the ASR server on `127.0.0.1:8000` plus its own tunnel, waiting for
   "model ready".
4. Start Metro with `EXPO_PACKAGER_PROXY_URL=<metro tunnel>` (rewrites the
   manifest URLs the phone receives) and `EXPO_PUBLIC_ASR_URL=<asr tunnel>`
   (baked into the bundle **at Metro start**, so restart after changing it).

Notes learned the hard way:
- **ngrok fails** when an Expo token is set: "Cannot use ngrok with a robot
  user". Use cloudflared.
- **GitHub Codespaces port forwarding is not usable** for this: private ports
  return 404 to the phone, visibility resets on restart, and the CLI/UI
  disagree about state.
- Keep secrets out of the repository. An Expo access token belongs only in
  `export EXPO_TOKEN=...` in the terminal — never in a file, never committed.

## 11. Native build traps

- `@react-native-voice/voice@3.2.4` declares the legacy
  `com.android.support:appcompat-v7` dependency, which collides with AndroidX
  and fails the Android build at `checkDebugDuplicateClasses`. Fix with
  **patch-package** (`npx patch-package @react-native-voice/voice` — generate
  it, don't hand-write it; the paths need the `node_modules/` prefix), wire
  `"postinstall": "patch-package"`, and add an
  `"eas-build-post-install"` script so EAS applies it too. Also enable
  `enableJetifier` via `expo-build-properties`.
- **Expo SDK 52's Metro ignores package `exports` maps.** `whisper.rn`'s map
  has no bare `"."` entry, so `import ... from 'whisper.rn'` fails to resolve.
  Import the real file paths instead — `whisper.rn/lib/module/index`,
  `whisper.rn/lib/module/realtime-transcription/adapters/AudioPcmStreamAdapter`
  — and add a `src/types/whisper-rn.d.ts` shim re-exporting the corresponding
  `lib/typescript/...` declarations. Keep `tsconfig.json` plain
  (`extends: expo/tsconfig.base`, `strict: true`) — switching to bundler
  resolution is not the fix.
- Verify bundling with `npx expo export --platform android` before rebuilding
  an APK; it catches resolution errors in seconds instead of minutes.
- Compute all `useMemo`/hooks **above** any early `return` in a component, or
  you get "Rendered more hooks than during the previous render".

## 12. Working style I expect

- Verify assumptions against real artifacts (run the code, inspect the bytes,
  read the library source) instead of guessing; when a phone-side failure is
  ambiguous, add a script that reproduces it on the dev machine.
- Make error messages name the actual fix. Generic messages ("Model
  unavailable") cost hours here.
- **Never assume which surah I recited when grading a transcript** — ask me
  for the ground truth.
- Commit and push in focused commits with real explanations of *why*.

---END PROMPT---

## Optional extras (not built; mention only if you want them)

- Recitation → habit-streak integration (a completed session feeds the
  Tracker).
- Practice a specific ayah range on repeat.
- Session history with per-word mistake statistics over time.
