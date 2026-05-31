# DOS-in-a-PDF

This is FreeDOS running inside a PDF.

Open it in Chrome and you'll get a tiny DOS machine with an 8086 CPU, BIOS and FreeDOS floppy disk, all emulated in JavaScript running inside the PDF viewer. No installs, no server, just a PDF.

Why? Because it's funny and I could do it. The idea popped into my head on the way back home. RISC-V Linux in a PDF had already been done, so I wanted to see if I could get x86 DOS running instead and it somehow worked.

It's inspired by ading2210's Linux PDF project, except this runs FreeDOS.

**Try it:** https://crabby605.github.io/DOSPDF/

> Chromium-based browsers only. Firefox and Acrobat won't work.

## Features

* Boots FreeDOS inside a PDF
* Text-mode DOS applications
* On-screen keyboard (sometimes the keyboard breaks and you'll need to refresh the page)
* CGA graphics rendered in grayscale (it looks terrible)
* Includes Alley Cat and a small Pong clone I wrote in assembly

## Building

The required Emscripten toolchain (`1.39.20-fastcomp`) only works reliably on Linux (x86-64). I developed this on macOS (AArch64), so all builds are done through Docker.

```bash
docker run -it -v "$PWD":/work ubuntu:22.04 bash

apt-get update && apt-get install -y python3 python3-pip git nasm mtools
pip3 install pdfrw

git clone https://github.com/emscripten-core/emsdk /opt/emsdk
/opt/emsdk/emsdk install 1.39.20-fastcomp
/opt/emsdk/emsdk activate 1.39.20-fastcomp
source /opt/emsdk/emsdk_env.sh

cd /work
./build.sh
```

Output:

```text
out/DOS-in-a.pdf
out/index.html
```

## Credits

* 8086tiny by Adrian Cable (MIT)
* Linux PDF and Doom PDF by ading2210 (GPLv3)
* FreeDOS
* Emscripten 1.39.20-fastcomp

DOS-in-a-PDF is GPLv3. See `CREDITS.md` for details.

---

Made by Vihaan P.
