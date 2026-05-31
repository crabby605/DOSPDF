# Credits

DOS-in-a-PDF builds on the work of others:

- **8086tiny** — the 8086 PC emulator at the core, by **Adrian Cable**.
  MIT licensed. <https://github.com/adriancable/8086tiny>
  `src/8086tiny.c` is a modified version (asm.js / PDF port — cooperative run
  loop and unaligned-access fixes). The original MIT notice is kept verbatim in
  `src/LICENSE.8086tiny` and in the file header. The BIOS (`src/bios/`) and the
  base FreeDOS floppy come from the 8086tiny distribution; the floppy shipped
  here (`disk/fd.img`) has been **modified** — `PONG.COM` was added and
  `AUTOEXEC.BAT` edited.

- **linuxpdf** by **ading2210** — which pioneered running an emulator inside a
  PDF via asm.js, and is the project this one's PDF layer is **directly derived
  from**. GPLv3. <https://github.com/ading2210/linuxpdf>
  `gen_pdf.py` and `web/glue.js` are derived from linuxpdf's `gen_pdf.py` and
  `pdflinux.js`. Its predecessor **doompdf** (same author) established the
  technique: <https://github.com/ading2210/doompdf>

- **FreeDOS** — the operating system that boots inside the PDF. <https://www.freedos.org/>
  MS-DOS is deliberately **not** used: it is copyrighted and cannot ship in a
  freely distributed file. FreeDOS is free software.

- **Emscripten 1.39.20-fastcomp** — the last Emscripten release able to target
  asm.js (`-s WASM=0`), which PDFium requires because it has no WebAssembly.

## Project-specific work

On top of the above, DOS-in-a-PDF adds:

- an **8086tiny port adapted for PDF execution** — a cooperative `vm_start()` /
  `virt_machine_run(n)` interface plus the asm.js unaligned-memory-access fix;
- an **80×25 DOS terminal renderer** that reconstructs the screen from the
  BIOS's ANSI/VT100 output (with CP437-to-ASCII mapping and a framed border);
- a **CGA-graphics-to-grayscale renderer** (reads the `0xB8000` bitmap and draws
  it as a grayscale density map — e.g. for `ALLEYCAT.EXE`);
- a **full on-screen keyboard** (letters/digits/symbols, Shift/Ctrl/Alt, F1–F12,
  arrows) using race-free direct keyboard-ring-buffer injection;
- a bundled **text-mode Pong** (`src/pong.asm`, public domain);
- **FreeDOS image integration**, **PDF packaging** (`gen_pdf.py`), **build
  tooling** (`build.sh`), and a **landing page** (`web/index.html`).

## License

DOS-in-a-PDF is licensed under the **GNU GPL v3** (see `LICENSE`) because it
incorporates GPLv3-licensed code derived from linuxpdf. Files under `src/` are
derived from 8086tiny and additionally retain their **MIT** license
(`src/LICENSE.8086tiny`). MIT is GPL-compatible, so the combined work is
distributable under the GPLv3.

Made by Vihaan P. — <https://github.com/crabby605/dospdf>
