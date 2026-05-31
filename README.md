# DOS-in-a-PDF

FreeDOS running inside a single PDF file. The whole machine — an Intel 8086, its
BIOS, and a FreeDOS floppy — is emulated in JavaScript that runs inside the PDF
viewer's own scripting engine. No server, no plugins, no WebAssembly: just a PDF.

**Inspired by [Linux in a PDF](https://github.com/ading2210/linuxpdf).** It's the
x86/DOS entry in that lineage: where linuxpdf boots RISC-V Linux, this boots
FreeDOS on a tiny 8086, and adds a full on-screen keyboard and a grayscale
renderer for CGA graphics programs.

> ⚠ Works only in **Chromium-based PDF viewers** (Chrome, Edge, Brave). Firefox
> and Adobe Acrobat implement the PDF JavaScript API differently.

The build output is **`out/DOS-in-a.pdf`** — open it in Chrome. Made by Vihaan P.;
source at **<https://github.com/crabby605/dospdf>**.

## What works

- Boots FreeDOS to the `A:\>` prompt (~10–15 s; the PDF engine has no JIT).
- A framed **80×25 text screen** — scrolling, cursor — reconstructed from the
  BIOS's ANSI output.
- A **full on-screen keyboard**: every letter, digit and symbol, plus **Esc,
  F1–F12, arrows, Tab, Enter, Backspace, Space**, and one-shot **Shift / Ctrl /
  Alt** modifiers — with a Show/Hide toggle. You can also type into the input
  box; the on-screen keys are the dependable path if the box ever misbehaves.
- Runs DOS commands and text programs: `dir`, `type`, `mem`, `ver`, `tree`, …
- Runs a bundled text-mode game, **Pong** (`pong`): W/S move your paddle, an AI
  plays the other side, Esc quits.
- Renders **CGA graphics programs as grayscale ASCII**. The disk includes the
  1984 CGA game `ALLEYCAT.EXE` (`alleycat`) — when it flips to graphics mode the
  video memory is drawn as a grayscale density map into the same screen.

## How it works

PDF files can carry JavaScript, and Chromium's PDF engine (PDFium) runs it — but
with the JIT **disabled** and **no WebAssembly**. So the emulator is compiled to
**asm.js** with the last fastcomp Emscripten (`1.39.20`, `-s WASM=0`).

The core is [8086tiny](https://github.com/adriancable/8086tiny) (Adrian Cable), a
~760-line 8086. Two changes make it cooperate with the PDF event loop instead of
spinning in an infinite C loop: `vm_start()` sets up and returns, and
`virt_machine_run(n)` runs `n` instructions and returns. A `setInterval` inside
the PDF drives it.

- **Text output.** 8086tiny's BIOS keeps no framebuffer — it emits an ANSI/VT100
  byte stream for everything it draws. `web/glue.js` is a small ANSI terminal
  that turns that stream into an 80×25 grid and paints it into 25 Courier form
  fields (so columns line up), mapping CP437 box-drawing characters to ASCII.
- **CGA graphics.** When a program switches to CGA graphics (BIOS video mode
  4/5), the glue reads the 320×200 bitmap at `0xB8000`, decodes its 2-bit
  pixels, and draws a grayscale density map into the same rows.
- **Keyboard.** Keystrokes are written **directly into the BIOS keyboard ring
  buffer** (`0040:001A`) while the CPU is paused between ticks — no interrupt,
  no race. (An earlier interrupt-based approach intermittently tripped a DOS
  "error reading from device CON".)

One subtle low-level fix: asm.js's typed-array heap views silently drop the low
address bit on unaligned 16-bit reads (`*(short*)p` → `HEAP16[p>>1]`), which
breaks the misaligned pointer casts that x86 code relies on. The port forces
byte-wise access through `__attribute__((aligned(1)))` typedefs.

## Performance

It runs at roughly 1 MIPS under PDFium — slower than linuxpdf's RISC-V machine,
for two reasons. 8086tiny is written for minimal *size*, not speed (it re-decodes
each instruction through table indirection). And the unaligned-access fix above
makes every memory access compile to byte-by-byte loads instead of a single
read — a tax a naturally-aligned RISC-V core never pays, and one that 8086tiny,
which touches memory constantly, pays on nearly every instruction.

## Build

Linux x86-64 only (fastcomp Emscripten has no Apple-silicon build). Via Docker:

```bash
docker run -it -v "$PWD":/work ubuntu:22.04 bash
# inside the container:
apt-get update && apt-get install -y python3 python3-pip git nasm mtools
pip3 install pdfrw
git clone https://github.com/emscripten-core/emsdk /opt/emsdk
/opt/emsdk/emsdk install 1.39.20-fastcomp
/opt/emsdk/emsdk activate 1.39.20-fastcomp
source /opt/emsdk/emsdk_env.sh
cd /work && ./build.sh
```

Output is `out/DOS-in-a.pdf` plus `out/index.html` — a landing page that checks
the browser and links to the PDF. Serve it with `cd out && python3 -m http.server`,
or just open the PDF directly in Chrome.

## Layout

```
build.sh          one-shot build (Pong → emcc → assemble → PDF)
gen_pdf.py        PDF generator: 80×25 screen, border, on-screen keyboard  [GPLv3]
web/glue.js       ANSI terminal + CGA renderer + keyboard + driver         [GPLv3]
src/8086tiny.c    8086 emulator, asm.js/PDF port                           [MIT]
src/bios/         8086tiny BIOS (binary + asm source)                      [MIT]
src/pong.asm      text-mode Pong (→ PONG.COM, baked into the floppy)       [public domain]
disk/fd.img       FreeDOS boot floppy (+ PONG.COM)                         [FreeDOS]
out/DOS-in-a.pdf  the deliverable
```

## Limitations

- **8086 only.** No 286/386+, no protected mode, 640 KB RAM — so no DOOM (it
  needs a 386 and ~4 MB) and no other 386 software.
- **Monochrome.** Text and CGA graphics are both grayscale. PDFium regenerates
  form-field appearances from their static definition and ignores per-field
  text/fill colors set at runtime, so live color isn't possible — the same
  limitation that keeps DoomPDF and LinuxPDF monochrome. CGA graphics are mapped
  to a grayscale ramp instead.
- CGA graphics are shown at the 80×25 character grid (one cell per 4×8 pixels)
  and refresh a few times a second under PDFium's JIT-less engine.

## Credits & license

This project is licensed under the **GNU GPL v3** (see `LICENSE`) because it
incorporates GPLv3-licensed code derived from linuxpdf. Files under `src/` are
derived from 8086tiny and keep their original **MIT** notice; MIT is
GPL-compatible, so the combined work ships under the GPLv3. Full attribution is
in **[CREDITS.md](CREDITS.md)**:

- **8086tiny** — the 8086 emulator at the core — by Adrian Cable (MIT).
- **[linuxpdf](https://github.com/ading2210/linuxpdf)** — the project this PDF
  layer is directly derived from — and its predecessor
  **[doompdf](https://github.com/ading2210/doompdf)**, by ading2210 (GPLv3).
- **FreeDOS** — the operating system that boots inside the PDF. (MS-DOS is not
  used; it is copyrighted and cannot ship in a freely distributed file.)
- **Emscripten 1.39.20-fastcomp** — the last Emscripten able to target asm.js.
