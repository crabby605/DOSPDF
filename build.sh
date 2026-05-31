#!/bin/bash
# DOSPDF build script.
#
# Requires Linux x86-64 + Emscripten 1.39.20-fastcomp (the last Emscripten that
# can target asm.js; PDFium has no WebAssembly). Activate it first, e.g.:
#
#   git clone https://github.com/emscripten-core/emsdk
#   ./emsdk/emsdk install 1.39.20-fastcomp
#   ./emsdk/emsdk activate 1.39.20-fastcomp
#   source ./emsdk/emsdk_env.sh
#   pip3 install pdfrw
#
# Then: ./build.sh   ->   out/dos.pdf
set -e
cd "$(dirname "$0")"
mkdir -p out

# 0) (Re)build the bundled Pong from source and inject it into the floppy, if the
#    tools are present. The image already ships with PONG.COM, so this only
#    matters when you edit src/pong.asm.
if command -v nasm >/dev/null 2>&1 && command -v mcopy >/dev/null 2>&1; then
  nasm -f bin src/pong.asm -o /tmp/pong.com && mcopy -i disk/fd.img -o /tmp/pong.com ::PONG.COM && echo "rebuilt PONG.COM"
fi

# 1) Compile the 8086tiny port to asm.js (NOT wasm). The BIOS and FreeDOS floppy
#    are embedded into the module under the exact names vm_start() opens.
emcc src/8086tiny.c -DNO_GRAPHICS -O3 -fsigned-char -fno-strict-aliasing -std=c99 \
  -s WASM=0 -s SINGLE_FILE=1 -s NO_EXIT_RUNTIME=1 --memory-init-file 0 \
  -s "EXPORTED_FUNCTIONS=['_main','_vm_start','_virt_machine_run','_get_mem_ptr','_get_ip','_get_inst_counter','_kbd_inject']" \
  -s "EXTRA_EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString']" \
  --embed-file src/bios/bios@bios \
  --embed-file disk/fd.img@fd.img \
  -o out/8086tiny.js

# 2) Prepend the JS glue (ANSI terminal + machine driver) to the emulator.
cat web/glue.js out/8086tiny.js > out/compiled.js

# 3) Wrap it into a PDF (25 row fields, monochrome).
#    NOTE: `gen_pdf.py --color` builds an 80x25 per-cell variant and the glue
#    fully decodes ANSI SGR colors, BUT Chromium's PDFium regenerates field
#    appearances from the static /DA and ignores runtime textColor/fillColor —
#    so the color build renders monochrome too (verified). This is the same
#    limitation that keeps DoomPDF/LinuxPDF monochrome, so we don't ship it.
python3 gen_pdf.py out/compiled.js out/DOS-in-a.pdf

# 4) Landing page (browser check + link) to serve alongside the PDF.
cp web/index.html out/index.html

echo "Built out/DOS-in-a.pdf and out/index.html  (serve out/ to use the landing page)"
