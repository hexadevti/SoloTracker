# SoloTracker

An Electron YouTube player built for practicing guitar solos.

## Running

```bash
npm install
npm start
```

To build a portable Windows executable (a single `.exe` that runs without installing):

```bash
npm run dist          # → release/SoloTracker-<version>-portable.exe
```

The executable isn't code-signed, so Windows SmartScreen warns on the first run (**More info → Run anyway**). User data stays in `%APPDATA%/solotracker`, so the `.exe` can be moved or replaced freely.

Paste a YouTube link (or just the video ID) and click **Open**. You can also paste with `Ctrl+V` anywhere, or drag the link onto the window.

## Projects and sections

Each song is a **project**: a YouTube video with its practice sections.

- **Opening** a link reopens that video's project if it already exists. If not, a new one is created, named after the video title.
- The **Library** (`Ctrl+O`) lists all projects and has a search box. From it you can:
  - open, rename, export or delete a project;
  - create a **new project** with a name of your own (you can have several projects for the same video);
  - **import** `.solotracker.json` files.
- The project name can be edited right at the top. Everything is saved automatically ("Saved ✓").
- On startup, the app reopens the last project.

**Creating a section:** press `N`. Then press `Enter` at the start of the section and `Enter` again at the end. The section is saved with the current speed and starts looping right away. `Esc` cancels.

- Changing the speed (`=`/`-`, `↑`/`↓`, the slider or the presets) while a section is selected saves the new speed in it. The exception is when the speed trainer is on, since it changes the speed by itself.
- Each section has a ✎ button (rename; double-click also works) and a ✕ button (delete).
- A/B adjustments (the `A`/`B` keys, the −/+ buttons, the timeline handles) made while a section is selected are saved in it.
- Use the `1`–`9` and `0` (section 10) keys to jump between sections.
- Dragging the position outside the section, on the timeline or over the video, releases the loop: the section is deselected and the video plays freely. To loop again, click the section or type its number. If you drag back inside the section before letting go, the loop continues. The arrow keys, the mouse wheel and the ⟲ ⟳ buttons also release the loop when they go past the end of the section.
- On the main timeline, the other saved sections show up as numbered gray blocks. Click one to jump to it, or drag from it to seek as usual.

## Online and offline

Each project plays in one of two modes. The button next to the project name shows the current mode and switches between them:

- **🌐 Online**: plays through the YouTube embed.
- **💾 Offline**: plays the video downloaded to your computer, without accessing YouTube. Loops and seeks make no requests, which avoids being blocked for too many requests.

The first time you switch a project to offline, the video is downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp). The button shows the progress, and clicking it again cancels. After the download, the button switches instantly, keeping the position and the loop.

- The app uses the `yt-dlp` on your PATH, if there is one (`winget install yt-dlp.yt-dlp`). If not, it downloads the official executable to `%APPDATA%/solotracker/bin` and updates it every 7 days.
- **Quality:** with [ffmpeg](https://ffmpeg.org) on your PATH (`winget install Gyan.FFmpeg`), it downloads up to 1080p. Without it, YouTube only offers a single 360p file.
- Videos are stored in `%APPDATA%/solotracker/videos`. Projects for the same video share the file.
- In the Library, **🗑 video** deletes the downloaded file, and the project goes back to online mode. Deleting the last project of a video also deletes the file.
- If YouTube asks you to confirm you're not a robot during the download, wait a while and try again.

## Separating the guitar (offline only)

In offline mode, a **🎸 Separate guitar** button appears. It separates the guitar track from the rest of the song with [Demucs](https://github.com/facebookresearch/demucs) (the `htdemucs_6s` model). After that, the button becomes **🎸 Guitar: ON/OFF**, and the `G` key turns the guitar on and off. The choice is saved per project.

- Separation runs on the CPU and takes a few minutes per song. The button shows the progress, and clicking it cancels.
- **First time:** the app creates a Python environment in `%APPDATA%/solotracker/stems-env` and installs PyTorch (CPU), Demucs and PyAV, about 1 GB. It also downloads the model (~80 MB). **Python 3.9 to 3.12** must be installed.
- The tracks are stored in `%APPDATA%/solotracker/stems/<videoId>/` (`guitar.flac` and `backing.flac`). Deleting the downloaded video also deletes the tracks.
- With the tracks, the video plays muted and the sound comes from the two tracks, kept in sync with the video (play, seek, loop and speed with pitch preserved).
- Separation is done by AI and isn't perfect: in dense mixes, some guitar leaks into the backing track, and vice versa.

## Features

- **Precise A-B loop**: checked on every frame inside the player, with a repetition counter.
- **Loop zoom**: a second timeline shows only the section, with draggable A/B handles for fine adjustment.
- **Speed from 25% to 150%** in 1% steps, keeping the pitch.
- **Dragging over the video** (mouse or finger) seeks forward and back. The sensitivity is configurable.
- **Arrow keys** seek back/forward with a configurable step (normal, big with `Shift`, fine with `Ctrl`).
- **Speed trainer**: raises the speed every N repetitions until the goal.
- **Pause between repetitions** and **pre-roll** before A.
- Resumes where you left off (position, loop and speed per project).
- **Portuguese and English**: follows the system/browser language (pt → Portuguese, anything else → English). To change it, use **Settings → Idioma / Language**; the choice is saved.

### Languages (for developers)

The UI texts live in `src/renderer/i18n.js`, shared by the desktop app and the web version. Portuguese is the source text: in code, use `tr('Texto em português', { var })` and add the translation to the `EN` object under the same key. The static texts in `index.html` are translated when the page opens, by exact text match. Messages with variable parts coming from `main.js`, `preload.js` or `separate.py` go in `PATTERNS`. Untranslated text is shown in Portuguese.

In the desktop app, the chosen language is stored in the data file (`settings.lang`), because the local server port, and with it the `localStorage`, changes on every launch. In the web version it is stored in the browser.

Data is stored in `%APPDATA%/solotracker/solotracker-data.json`. Data in the old format (sections per video) is converted to projects automatically.

## How it works

- The UI is served by a local HTTP server at `http://localhost:<port>`. The YouTube embed requires a valid referrer: with `file://` or `127.0.0.1` it shows "video unavailable".
- In offline mode, the iframe loads `player.html`, a `<video>` that plays `/media/<videoId>`. The local server serves the file with `Range` support (needed for seeking). The same preload bridge controls this player.
- `preload.js` also runs inside the YouTube iframe (`nodeIntegrationInSubFrames`). There it controls the `<video>` directly (speed, seek, loop) and sends the status to the UI via IPC.

## Notes

- Videos whose owner disabled embedding don't play. The app shows the message and a button to open the video on YouTube.
- If `npm start` only opens a Node process with no window, check whether the `ELECTRON_RUN_AS_NODE` variable is set in your terminal and remove it.
- With Node 26, Electron's `postinstall` may finish without extracting the binary (error "Electron failed to install correctly"). In that case, extract the zip from `%LOCALAPPDATA%\electron\Cache\...` into `node_modules/electron/dist` and create `node_modules/electron/path.txt` containing `electron.exe`.

## Web version (phone and desktop, no server on your PC)

A static browser version, ready for Cloudflare Pages. The same page detects the device:

- **Phone** (touch screen with the shorter side under 768px): a layout for **landscape** use. The video takes the left side and the timeline sits below it. The sidebar has tabs (Controls / Sections / Trainer / Settings). There is a full-screen button, and the screen stays on while you practice.
- **Desktop** (and tablets): the same layout as the Electron app.
- To force a layout, use **Settings → Layout** or open the page with `?layout=mobile`, `?layout=desktop` or `?layout=auto`.

```bash
npm run build:web     # builds dist-web/
npm run serve:web     # builds and serves at http://localhost:8788 (prints the address for a phone on the same Wi-Fi)
```

### What works on the web

| Feature | YouTube | File on the device (📂 File) |
|---|---|---|
| Projects, sections, speed trainer, export/import | ✅ | ✅ |
| A-B loop, pause between repetitions, drag over the video | ✅ (~0.1–0.3 s precision) | ✅ (precise) |
| Speed | only the ones YouTube offers (0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2) | any, 25–150%, pitch preserved |
| No internet | ❌ | ✅ (after the first visit) |

- **File on the device** is the web's "offline" mode. Choose a video or song (mp4, m4a, mp3, wav…). The file is stored in the browser (IndexedDB) and is never sent to any server. You can also attach a file to a YouTube project with the mode button (▶ YouTube / 📂 File).
- **Not available on the web:** downloading YouTube videos (yt-dlp) and separating the guitar (Demucs). Both need the desktop app.
- **YouTube limits in the browser:** speeds are rounded (the app tells you which one was used). Each loop pass is a seek request, so precision is lower. While paused, YouTube may show its own interface over the video.
- **Phone:** the first play of each YouTube video needs a tap **on the video itself**. On iPhone, volume is controlled only by the device buttons (the app's control can only mute). iPhone also has no full screen for websites: use **Share → Add to Home Screen** and open the app from the icon.
- Data is stored in each device's browser. To move projects from the PC to the phone, use **Export** / **Import**. The media file has to be chosen again on the other device.

### Publishing to Cloudflare Pages

From the terminal (asks you to log in to Cloudflare the first time):

```bash
npm run deploy:web    # = build + npx wrangler pages deploy dist-web --project-name solotracker
```

Or from the dashboard, connected to a Git repository:

- Build command: `npm run build:web`
- Build output directory: `dist-web`
- Environment variable: `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (skips downloading Electron during the build)

The `web/_headers` file sets the CSP (allowing the YouTube API and `blob:` files) and the `Referrer-Policy` the YouTube embed requires. The web files live in `web/`. `app.js`, `timeline.js` and `styles.css` are the same as in the Electron app.
