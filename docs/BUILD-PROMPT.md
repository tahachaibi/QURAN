# Quran Habit — build prompt (v2, single-engine)

Paste everything between the markers into a coding agent. This version drops
the on-device Whisper "Precise" engine entirely, rebuilds the recitation
engine around a global Quran cursor, and specifies a UI meant to beat
Tarteel's on clarity.

---BEGIN PROMPT---

Build **Quran Habit**, an Android-first Islamic habit companion app in React
Native whose centrepiece is a recitation follow-along that tracks my voice
through the Quran. Work in stages, verify each against the acceptance tests in
§12, and tell me the results rather than assuming.

## 0. Scope guards — read first

**Build exactly one recognition engine.** Do not add a second "precise" mode,
do not bundle Whisper/whisper.cpp/whisper.rn, do not build a Python ASR
server, do not download model files at runtime. A previous version did all of
that; it was slow, fragile, and added nothing over a well-tuned Android
recognizer. One engine, made excellent.

**No engine picker in the UI.** The user should never think about recognizers.

**Everything works offline** except prayer times and optional audio playback.
Quran text, page layout and verse search are bundled at build time.

## 1. Stack

- Expo SDK 52, React Native 0.76, React 18.2, **TypeScript strict**.
- expo-router v4, file-based routing, `typedRoutes: true`, scheme
  `quranhabit`.
- Android `com.quranhabit.app`; permissions `RECORD_AUDIO`,
  `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`.
- Needs a native module (§4) → **expo-dev-client APKs via EAS Build**, not
  Expo Go. Set that up first so you are never blocked on it.
- Deps: `expo-router`, `expo-av`, `expo-font`,
  `@expo-google-fonts/amiri` + `amiri-quran`, `expo-location`,
  `expo-linking`, `expo-constants`, `expo-status-bar`, `expo-keep-awake`,
  `expo-haptics`, `@react-native-async-storage/async-storage@1.23.1`,
  `react-native-safe-area-context@4.12.0`, `react-native-screens ~4.4.0`,
  `@expo/vector-icons ~14.0.4`, `expo-build-properties`, `expo-dev-client`.
  Dev: `quran-json`, `quran-meta`, `patch-package`, `typescript`.
- Prefer `expo-file-system`/AsyncStorage over any database. No backend, no
  accounts, no analytics — nothing leaves the device except prayer-time and
  audio requests.

## 2. THE core architectural decision: one global Quran cursor

This is the most important instruction in this document. Get it right and a
whole class of bugs never exists.

**Model the reciter's position as a single integer index into the entire
Quran**, not as a position within the currently-open surah.

- Build one flat array `words: string[]` of every normalized word in the Quran
  in order (~78k words), plus a parallel lookup
  `wordMeta: {surah, ayah, wordInAyah, page}[]` and reverse indexes
  (`pageStartWord[]`, `ayahStartWord[]`).
- The recitation session owns exactly one `globalCursor` into that array. It
  never belongs to a screen.
- The Read screen is a **pure view** of wherever the cursor currently is: it
  renders the mushaf page containing the cursor. Moving to another surah is
  *just the cursor changing value* — the page view follows it.

Consequences you must honour:

- **Never call `router.replace` / navigate / remount a screen because the
  reciter moved to a different surah.** The old design did, and it produced a
  cascade of failures: the microphone died mid-transition with no event, the
  recognizer's global listeners got wiped by the outgoing screen's cleanup, a
  "handoff/adopt" mechanism had to be invented to keep the mic alive, and the
  session still froze on the landing word. All of that disappears here.
- One `RecitationProvider` (React context) mounted **above** the screens owns
  the session: cursor, mistakes, timer, recognizer lifecycle. Screens
  subscribe. Unmounting a surah screen must not stop the session.
- Reciting continuously across the end of a surah into the next one must work
  with no special case — the cursor simply increments into the next surah's
  words.
- Crossing surah boundaries by *swiping* just moves the view; the cursor stays
  where the voice is. Show a small "return to my place" affordance when the
  viewed page and the cursor's page differ.

## 3. Bundled data (generated at build time)

Generator scripts under `scripts/`, output to `src/assets/`:

1. **`quran-data.json`** — display text per ayah + Madani **page** and **juz**.
   Text from `quran-json`; page/juz from `quran-meta` (`createHafs()` →
   `findPage()`, `findJuz()`). Store compact rows, not verbose objects:
   `[surah, name, translit, translation, type, [[ayahNo, globalNo, page, juz, text], ...]]`.
2. **`quran-words.json`** — the flat normalized word array + `wordMeta` +
   page/ayah offset tables from §2.
3. **`quran-search.json`** — an **inverted index**: normalized word → sorted
   array of global word positions. Drop the ~40 most frequent words (الله، من،
   في، الذين …) from the index to keep it small; they are useless as search
   anchors anyway. This makes verse lookup a couple of array intersections
   instead of a scan — the difference between "takes a while" and instant.

Validate generated page numbers against a printed mushaf for at least
Al-Fatiha, Al-Baqarah p.1–3, Yaseen, and An-Nas before building on them.

**Optional but a real upgrade:** if you can source per-word **line numbers**
for the Madani mushaf (e.g. QUL / quran.com word-layout data), use them to
render true 15-line pages. Otherwise justify text within the page and accept
approximate line breaks — but keep the page *boundaries* exact.

## 4. Recognition layer — write your own native module

`@react-native-voice/voice@3.2.4` is a dead end for this app: it is a
singleton, exposes no way to prefer on-device recognition, cannot run a
continuous session, and ships a legacy `com.android.support:appcompat-v7`
dependency that breaks the Android build with `checkDebugDuplicateClasses`
(fixable only via patch-package). Write a small **Expo native module** in
Kotlin around `android.speech.SpeechRecognizer` instead. You control the
lifecycle, which is where all the quality lives.

Implement these capabilities in priority order, **verifying each on a real
device** and falling back if unsupported:

1. **Continuous segmented session.** `RecognizerIntent.EXTRA_SEGMENTED_SESSION`
   (API 31+) keeps one recognition session alive across pauses and delivers
   repeated segment results instead of ending the utterance. If it works, it
   removes the restart dead-time that dominated the old implementation's
   latency. Verify; if the device ignores it, fall back to (2).
2. **On-device recognition.** `SpeechRecognizer.createOnDeviceSpeechRecognizer()`
   (API 33+), else `RecognizerIntent.EXTRA_PREFER_OFFLINE = true`. Lower
   latency, works without network, keeps recitation private. Prompt the user
   once to install the Arabic offline language pack if missing, and detect
   that state rather than failing silently.
3. **Relay fallback.** If neither works, keep two recognizer instances and
   start the next one *before* releasing the current, so there is always a
   live listener. Measure whether the device permits overlapping instances; if
   not, minimize the gap (target < 150ms) and mask it in the UI rather than
   pretending nothing was lost.

Whatever path works, the module must expose:

- `start(locale, opts)`, `stop()`, `cancel()`, `isAvailable()`,
  `supportsOnDevice()`.
- Events: `partial(alternatives: string[])`, `final(alternatives: string[])`,
  `rms(level: number)`, `error(code, message)`, `endOfSegment`.
- Up to **5 alternatives** on both partial and final results
  (`EXTRA_MAX_RESULTS: 5`, `EXTRA_PARTIAL_RESULTS: true`). Lower-ranked
  alternatives are frequently the correct one for Quranic Arabic — the engine
  in §5 uses all of them.
- Stretched silence windows so a breath never ends the session:
  complete/possibly-complete ≈ 6000ms, minimum length ≈ 30000ms.
- `LANGUAGE_MODEL_FREE_FORM`, locale `ar-SA` (allow overriding to `ar-EG`,
  `ar-MA` etc. in settings — recognizer quality varies by locale, let the user
  try).

JS-side session rules:

- Auto-restart while active; treat error codes 5, 6, 7, 8, 11 as transient and
  restart silently without surfacing anything.
- **Liveness watchdog driven by real audio, not guesses:** the module streams
  RMS. If RMS shows speech but no result has arrived for ~2.5s, the recognizer
  is dead — restart it. If RMS shows genuine silence, do nothing. (An earlier
  version restarted blindly and also went permanently deaf after screen
  transitions with no event at all; the watchdog is not optional.)
- After ~3 minutes of true silence, stop and show a gentle "still there?" —
  don't hold the mic forever.
- Handle interruptions properly: incoming call, headset connect/disconnect,
  Bluetooth mic, app backgrounded (`AppState`) → pause cleanly and offer
  one-tap resume at the same cursor. Request audio focus, and pause any
  Listen-tab playback when the mic starts.

## 5. Matching engine v2 (`src/engine/`)

Do **not** transcribe-then-compare. We know the expected text, so *align*:
match heard words against a window of expected words and advance the cursor.
Verifying "is the next word X?" is far easier than open transcription, which
is what makes a mediocre recognizer good enough.

### 5.1 Normalization

Strip tashkeel and Quranic annotation marks (U+0610–U+061A, U+064B–U+065F,
U+0670, U+06D6–U+06ED), fold أإآٱ→ا, ؤ→و, ئ→ي, drop ء, ة→ه, ى→ي, remove
non-Arabic characters, collapse the definite article's spacing variants.

### 5.2 Phonetic-weighted distance (this is what kills false mistakes)

Plain Levenshtein produced constant false "mistakes" because Arabic speech
recognizers systematically confuse phonetically close letters. Use a
**weighted** edit distance where substitutions *within* an equivalence class
cost **0.5** instead of 1:

```
{س ص ث}  {ت ط}  {د ض ذ ظ ز}  {ه ح خ}  {ك ق}  {ع ء ا}  {ج ز ژ}
{ب ف}  {ن م}  {و ؤ}  {ي ئ ى}  {ل ر}   (verify each against real output)
```

Also make **long-vowel presence free**: dropping or adding ا/و/ي inside a word
costs 0.25, because madd length is exactly what recognizers get wrong.

Thresholds stay tight — Quranic Arabic is full of near-minimal pairs:

- words with min length ≤ 2 must match **exactly** (من، في، ما);
- weighted distance ≤ 1.0 for maxLen ≤ 6;
- ≤ 2.0 for maxLen ≤ 9;
- ratio ≤ 0.28 beyond that.

**Mandatory regression test: الرحمن and الرحيم must never match each other.**
Loosening this broke Al-Fatiha in the previous build. Write it as a unit test
before you tune anything.

### 5.3 Two positions, never one

- `cursor` — furthest progress; **never decreases**; drives reveal in Hidden
  mode and the "recited" styling.
- `livePos` — where the reciter is *right now*; **may move backwards**; drives
  the current-word highlight.

This is what makes breath-restart work: pausing and resuming from earlier in
the verse must follow the voice back without un-revealing anything already
earned. Search backwards up to ~24 words from `cursor` for an unmatched heard
word of length ≥3 and re-anchor `livePos` there.

### 5.4 Alignment must be idempotent

`align(expected, startCursor, transcript, lookAhead)` is re-run from the same
`startCursor` every time a partial grows. Same input ⇒ same output. Never
accumulate state across partial events.

Look-ahead: **3 words when locked on, 8 when not** (fresh session, or just
after a jump). Require **≥3 words of forward progress** before declaring
"locked on", or 1–2-word fuzzy junk anchors the session in the wrong place.

### 5.5 Confidence-scored continuous localization (replaces "no-match → search")

Every partial result, compute two things:

1. **Local score** — how well the freshest heard words align at `livePos`.
2. **Global best** — using the inverted index (§3), the best-matching position
   anywhere in the Quran for the freshest 4–8 heard words. Intersecting two or
   three rare-word position lists is microseconds, so this runs on **every
   partial** at no meaningful cost.

If the global candidate beats the local score by a clear margin **on two
consecutive partials**, move the cursor there. That is the whole
verse-search feature — and it is *instant*, because it is not a threshold-
triggered special mode that has to wait for enough "unmatched surplus" to
accumulate.

Rules that must hold:

- Works **with or without** an opening بسم الله الرحمن الرحيم. Match on the
  words *after* the basmala when present (nearly every surah opens with it, so
  it identifies nothing), and never let the current surah's own basmala
  suppress a jump.
- Arriving mid-verse **credits what was already recited** — align the
  triggering transcript from the landing point and advance past it. Do not dump
  the reciter at the verse's first word and mark the rest as mistakes.
- A 3-word phrase may only anchor a jump if it is **unique** in the Quran;
  otherwise require 4+.
- Ties prefer the surah currently in view, then the nearest position to the
  current cursor.
- Ignore candidate jumps of ≤6 words (that's just normal progress).
- Brief cooldown (~1s) after a jump so the transcript that caused it cannot
  cause another.

### 5.6 Mistake policy (the user's #2 complaint was false mistakes)

A word may be flagged as missed **only** when all of these hold:

1. it was skipped in a **final** result, never a partial;
2. the flag survives in **≥2 of the 5 alternatives**;
3. the reciter has since moved **≥3 words past** it;
4. it is not inside already-recited territory being replayed;
5. a "grace" pass re-checks it against the whole session transcript — if the
   word appears anywhere plausible, it is not a mistake (recognizers emit
   words late).

Mistakes are **retractable automatically** (later heard word matches → remove)
and **manually** ("I said it right" → permanently dismissed, and remembered
per word so the same false positive never nags again).

Keep the flagged-word identity stable across re-renders (mistake list must not
flicker or reorder while reciting).

### 5.7 Performance rules

- Alignment runs on every partial: keep it O(heard × lookAhead), no full-text
  scans.
- Memo-compare page components by reference; clamp cursor/livePos to each
  page's word range so a recognized word re-renders **one** page, not all.
- Never allocate a new `Map`/`Set` per partial when nothing changed — return
  the previous object so memoized children skip re-rendering.
- Target: a spoken word reflected on screen in **under 300ms** from the
  recognizer emitting it. Measure it and report the number.

## 6. The Read experience — better than Tarteel

Tarteel's follow-along works but is busy: controls compete with the text,
mistakes are buried behind taps, mode switching is unclear, and there is no
sense of place in the mushaf. Fix all four.

### 6.1 Structure

- Surah screen has exactly **two** tabs: **Listen | Read**. No "Memorize" tab
  — memorization is a *mode* inside Read.
- **Read IS the recitation view**, not a plain reader with a mic bolted on.
- Two modes via one segmented control:
  - **Follow** — everything visible; recited words settle into full ink, the
    current word is marked.
  - **Hidden** — words are concealed and **revealed as you recite them**.
- **Pages, never a scroll.** Horizontal swipe between mushaf pages, RTL order
  (inverted horizontal `FlatList` + `getItemLayout`). Swiping past a surah's
  first page continues into the previous surah's last page and vice versa —
  the Quran is continuous, so the reader should be too.
- Auto page-turn when the live position crosses onto the next page, with a
  page-curl-ish transition (respect reduce-motion).

### 6.2 Hidden mode done right

Do **not** replace hidden words with blank boxes or blocks — that reflows the
line and destroys the mushaf look. Render each hidden word as a **ghost of its
own glyph shape** (same text, very low opacity, no letter detail — e.g. 8–10%
ink), so the page's geometry is identical whether hidden or revealed, and the
reciter still gets the rhythm of the line. Revealing = animating that word to
full ink (fast: ≤120ms, no bounce).

Add a **hint ladder** instead of a single Peek: first tap reveals the word's
first letter, second tap reveals the whole word. Partial hints are what
actually help memorization; full reveal is a last resort. Track which words
needed hints and surface them in the summary (§6.6).

### 6.3 Word states — calm, legible, non-desecrating

The mushaf should still look like a mushaf. No red text on the sacred text.

| State | Treatment |
|---|---|
| Upcoming | ink at 45% |
| Current | full ink + a gold **underline** that breathes with your voice (driven by real RMS), never a filled box |
| Recited | full ink, faint gold left-margin ribbon marking the recited span |
| Missed | full ink + a small **red dot beneath** the word (tappable) |
| Hint-used | full ink + dashed gold underline |

A thin **progress ribbon** along the page's inner edge shows how much of the
page is recited — a sense of place Tarteel doesn't give you.

### 6.4 One-thumb operation

Every control sits inside the bottom third, reachable with the thumb holding
the phone:

- Bottom bar: **stats column** (session timer, tiny inline reset, mistakes
  count as a button) · **hint button** (Hidden mode) · **large round mic
  button** that pulses with your actual voice level while listening.
- While listening, the header auto-hides after ~2s so the page is
  full-bleed; a tap anywhere brings it back. The text is the interface.
- A small fading pill shows the last thing heard — tap to expand into a live
  transcript panel for debugging your own recitation.
- **"Return to my place"** chip appears whenever the page you're viewing isn't
  the page your voice is on.

### 6.5 Mistakes review that actually teaches

A bottom sheet (not a new screen, not a modal that loses your place) listing
each mistake as a row:

- the **correct word** (large, Amiri Quran, gold-highlighted in its phrase
  context) and **what was heard** (smaller, red, muted) side by side;
- a **play button** for that word's correct recitation (from the ayah audio,
  if available);
- **"I said it right"** to dismiss (remembered forever);
- swipe to dismiss; long-press to mark "practise this".

Group by ayah, show a count per ayah, and let the user tap through to that
word on the page.

### 6.6 Session summary (a card Tarteel doesn't have)

On stop: words recited, verses covered, accuracy %, **longest clean run**,
words that needed hints, time, and a one-line "you got further than last time
in this surah". One tap to log it to the Tracker streak, one tap to practise
the shaky words.

### 6.7 Small things that add up

- **Keep the screen awake** during a session (`expo-keep-awake`); dim rather
  than sleep.
- **Haptics per completed ayah**, never per word (per-word buzzing is
  maddening). Light tick on a confirmed mistake. All of it toggleable.
- **Font-size control** (3 steps) that reflows and re-paginates correctly.
- **Night mushaf** theme: warm dark paper, not pure black.
- **Reduce-motion** and **high-contrast** respected.
- Start listening from **any word by tapping it** (long-press = "start here").
- **Ayah-range practice**: select from–to and loop it.
- Resume where you left off, per surah, across app restarts.
- Offline badge when prayer times/audio can't reach the network — never a
  scary error.
- First-run: a 3-step explainer ending in a live try on Al-Fatiha, so the
  first experience is success, not a permission dialog.
- Full VoiceOver/TalkBack labels; Arabic text direction correct everywhere.

## 7. Visual design system

- **Fonts:** *Amiri Quran* for ayah text (correct tashkeel/Quranic marks),
  *Amiri* + *Amiri Bold* for other Arabic, system sans for Latin UI. Load via
  `useFonts` in the root layout and render nothing until ready.
- **Palette:** primary `#1B4332`, primary-light `#2D6A4F`, accent gold
  `#C9A227`, accent-soft `#F3E7C3`, background `#F6F2E9`, paper `#FBF7EC`,
  paper-edge `#E7DDC8`, surface `#FFFFFF`, text `#20241F` / `#6F6B60`, border
  `#E5E0D3`, error `#B3261E` / soft `#F9E2E0`, success `#2D6A4F` / soft
  `#E4EFE7`. Provide the dark equivalents.
- Pages are **paper cards**: subtle warm gradient, a gold rule at the top, the
  page number in a small circle at the bottom, ornamental gold ayah markers
  between verses.
- Motion: fast and small. 120ms reveals, 200ms transitions, no springs on
  text. The only continuous animation is the mic pulse / voice underline.
- Spacing on an 8pt grid; generous line-height for Arabic (≥2.0) — cramped
  Quranic text is the most common mistake in these apps.

## 8. The rest of the app

- **Prayer tab** — today's times from device location (Aladhan API), next
  prayer countdown, tap to check off; cache the last successful response for
  offline display.
- **Quran tab** — searchable list of 114 surahs (Arabic name, transliteration,
  translation, verse count, Meccan/Medinan), plus continue-where-you-left-off
  and a juz/page jump.
- **Tracker tab** — daily streak, calendar heatmap, and recitation sessions
  feeding it automatically (§6.6). Persist with AsyncStorage.
- **Listen tab** — per-ayah audio playback (expo-av, `cdn.islamic.network`),
  with follow-along highlighting reusing the same page renderer, and a
  reciter picker.

## 9. Testing you must actually write

- Unit tests for normalization and the weighted distance, including the
  الرحمن/الرحيم regression and a table of real recognizer confusions.
- Alignment tests: idempotence over growing partials, breath-restart, late
  words healing, junk-anchor rejection, cross-surah jump crediting.
- A **replay harness**: feed recorded transcript sequences (partials + finals,
  5 alternatives each) through the engine and assert the resulting cursor path.
  Capture a few real sessions from the device and keep them as fixtures — this
  is the only way to iterate on matching quality without re-reciting each time.
- A debug overlay (dev builds only) showing heard alternatives, local vs
  global scores, cursor/livePos, and the jump decision — so accuracy problems
  are diagnosable instead of anecdotal.

## 10. Build and dev-environment traps (already paid for once)

- **Expo SDK 52's Metro ignores package `exports` maps.** If a dependency
  relies on one, import its real file paths and add a `.d.ts` shim. Keep
  `tsconfig.json` plain (`extends: expo/tsconfig.base`, `strict: true`);
  switching module resolution is not the fix.
- Verify bundling with `npx expo export --platform android` before rebuilding
  an APK — seconds instead of minutes to catch resolution errors.
- Compute all hooks **above** any early `return`, or React throws "Rendered
  more hooks than during the previous render".
- If you do end up using a library with legacy `com.android.support:*`
  dependencies, fix it with generated `patch-package` patches (`npx
  patch-package <pkg>` — the paths need the `node_modules/` prefix), wire
  `postinstall` **and** `eas-build-post-install`, and enable `enableJetifier`
  via `expo-build-properties`.
- Developing from a cloud container to a physical phone: use a **cloudflared
  quick tunnel** for Metro with `EXPO_PACKAGER_PROXY_URL`. ngrok refuses when
  an Expo token is set ("Cannot use ngrok with a robot user"), and Codespaces
  port forwarding returns 404 to the phone. One `scripts/dev.sh` should kill
  stragglers, open the tunnel, and start Metro.
- Never commit secrets. Access tokens live only in the shell environment.
- When a change doesn't seem to take effect, verify the device is running the
  code you think it is *before* debugging anything else — a stale checkout once
  cost ten failed builds here.

## 11. Working style

- Verify against real artifacts — run it, read the library source, inspect the
  bytes. Don't guess and don't report success you haven't observed.
- Error messages must name the actual fix. A generic message cost hours here.
- **Never assume which surah I recited** when judging a transcript; ask me.
- Focused commits explaining *why*.
- Tell me plainly when something doesn't work or when a requirement is a bad
  idea.

## 12. Acceptance tests (this is "done")

Test on a real device, reciting aloud:

1. Al-Fatiha in Follow mode, at natural speed: every word marks within ~300ms,
   zero false mistakes.
2. Al-Fatiha in Hidden mode: words reveal as recited; page geometry never
   shifts; hint ladder works.
3. Mid-verse breath: stop, breathe, resume from a few words earlier —
   `livePos` follows back, revealed words stay revealed, no mistakes logged.
4. Open Al-Fatiha, recite Al-Baqarah 2:6 **without** basmala: it lands on 2:6
   within ~1s **and keeps following you** through the rest of the verse — no
   screen flash, no freeze on the first word, mic never drops.
5. Same as 4 **with** basmala.
6. Recite continuously across the end of a surah into the next: no
   interruption of any kind.
7. Swipe from Al-Baqarah page 1 backwards into Al-Fatiha; "return to my place"
   appears and works.
8. Deliberately misread one word: it is flagged **once**, correctly, after you
   pass it — not while you're still on it — and "I said it right" removes it
   permanently.
9. Recite for 5 minutes straight: no deafness, no drift, no memory growth, no
   battery cliff; screen stays awake.
10. Kill the network mid-session: recitation tracking is unaffected.

Report each result explicitly. Any "mostly" is a fail — tell me what's wrong
instead of smoothing it over.

---END PROMPT---
