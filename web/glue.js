// DOSPDF glue — adapted from ading2210/linuxpdf (pdflinux.js, GPLv3).
// Drives 8086tiny's cooperative vm_start()/virt_machine_run(N) interface inside
// a PDF's JavaScript engine (PDFium).
//
// 8086tiny's BIOS keeps no renderable text buffer; its INT 10h handler (and a
// VMEM driver that scans direct video-memory writes) emit an ANSI/VT100 byte
// stream, one char at a time, through the PUTCHAR hook (write(1,..)). We capture
// that raw, unbuffered stream via Module.stdout and reconstruct an 80x25 screen
// with a small terminal emulator, including SGR colors.
//
// Two render modes, chosen at runtime by which fields the PDF exposes:
//   - "row_N"  (25 fields)        -> fast monochrome text  (dos.pdf)
//   - "cell_R_C" (80x25 fields)   -> per-cell color text    (gen_pdf.py --color)
// NOTE: the color path is correct but does not show color in Chromium today:
// PDFium ignores field.textColor/fillColor set at runtime (it rebuilds the
// appearance from the static /DA). The SGR parsing still runs so color escape
// codes are consumed cleanly rather than printed as garbage.

var Module = {};
var timeout_callbacks = {};
var performance = { now() { return Date.now(); } };

function set_timeout_callback(id) { timeout_callbacks[id](); delete timeout_callbacks[id]; }
function set_interval_callback(id) { timeout_callbacks[id](); }
function safe_script(js) { return `try {${js}} catch (e) {app.alert(e.stack || e)}`; }
function set_timeout(cb, t) { var id = Math.random() + ""; timeout_callbacks[id] = cb; app.setTimeOut(safe_script(`set_timeout_callback(${id})`), t); }
function set_interval(cb, t) { var id = Math.random() + ""; timeout_callbacks[id] = cb; app.setInterval(safe_script(`set_interval_callback(${id})`), t); }

// 80x25 ANSI
// Each cell is packed into an int: char | fg<<8 | bg<<16   (fg 0-15, bg 0-7).
var TERM_COLS = 80, TERM_ROWS = 25;
var DEF_FG = 7, DEF_BG = 0;
function PACK(ch, fg, bg) { return (ch & 0xff) | (fg << 8) | (bg << 16); }
function CH(cell) { return cell & 0xff; }
function FG(cell) { return (cell >> 8) & 0xf; }
function BG(cell) { return (cell >> 16) & 0x7; }
var BLANK = PACK(32, DEF_FG, DEF_BG);

// 16-color CGA/ANSI palette as PDF color arrays (0..1 components).
var PAL = [
  [0, 0, 0], [.67, 0, 0], [0, .67, 0], [.67, .33, 0], [0, 0, .67], [.67, 0, .67], [0, .67, .67], [.75, .75, .75],
  [.5, .5, .5], [1, .33, .33], [.33, 1, .33], [1, 1, .33], [.4, .4, 1], [1, .4, 1], [.33, 1, 1], [1, 1, 1]
];

var term_grid = [];
var term_cx = 0, term_cy = 0, term_top = 0, term_bot = 24;
var term_state = 0, term_params = "", term_cursor_visible = true, term_dirty = true;
var cur_fg = DEF_FG, cur_bg = DEF_BG, cur_bright = 0;

function blank_row() { var a = new Array(TERM_COLS); for (var i = 0; i < TERM_COLS; i++) a[i] = BLANK; return a; }
function cur_blank() { return PACK(32, DEF_FG, cur_bg); }
function blank_row_cur() { var a = new Array(TERM_COLS), v = cur_blank(); for (var i = 0; i < TERM_COLS; i++) a[i] = v; return a; }
function term_init() {
  term_grid = [];
  for (var r = 0; r < TERM_ROWS; r++) term_grid.push(blank_row());
  term_cx = term_cy = 0; term_top = 0; term_bot = 24;
  term_state = 0; term_params = ""; cur_fg = DEF_FG; cur_bg = DEF_BG; cur_bright = 0;
  term_dirty = true;
}
function term_scroll_up(n) {
  for (var k = 0; k < n; k++) {
    for (var r = term_top; r < term_bot; r++) term_grid[r] = term_grid[r + 1];
    term_grid[term_bot] = blank_row_cur();
  }
}
function term_scroll_down(n) {
  for (var k = 0; k < n; k++) {
    for (var r = term_bot; r > term_top; r--) term_grid[r] = term_grid[r - 1];
    term_grid[term_top] = blank_row_cur();
  }
}
function term_newline() { term_cy++; if (term_cy > term_bot) { term_cy = term_bot; term_scroll_up(1); } }

function sgr(ps) {
  if (ps.length === 0) ps = [0];
  for (var i = 0; i < ps.length; i++) {
    var p = ps[i]; if (p === null || isNaN(p)) p = 0;
    if (p === 0) { cur_fg = DEF_FG; cur_bg = DEF_BG; cur_bright = 0; }
    else if (p === 1) { cur_bright = 1; cur_fg |= 8; }
    else if (p === 22) { cur_bright = 0; cur_fg &= 7; }
    else if (p >= 30 && p <= 37) { cur_fg = (p - 30) | (cur_bright ? 8 : 0); }
    else if (p === 39) { cur_fg = DEF_FG; }
    else if (p >= 40 && p <= 47) { cur_bg = p - 40; }
    else if (p === 49) { cur_bg = DEF_BG; }
    else if (p >= 90 && p <= 97) { cur_fg = (p - 90) | 8; }
    else if (p >= 100 && p <= 107) { cur_bg = p - 100; }
  }
}

function term_csi(cmd, ps) {
  function P(i, def) { var v = ps[i]; return (v === undefined || v === null || isNaN(v)) ? def : v; }
  switch (cmd) {
    case "H": case "f":
      term_cy = Math.max(0, Math.min(TERM_ROWS - 1, P(0, 1) - 1));
      term_cx = Math.max(0, Math.min(TERM_COLS - 1, P(1, 1) - 1)); break;
    case "A": term_cy = Math.max(term_top, term_cy - P(0, 1)); break;
    case "B": term_cy = Math.min(term_bot, term_cy + P(0, 1)); break;
    case "C": term_cx = Math.min(TERM_COLS - 1, term_cx + P(0, 1)); break;
    case "D":
      if (ps.length === 0 || ps[0] === null) term_scroll_down(1);
      else term_cx = Math.max(0, term_cx - P(0, 1)); break;
    case "G": term_cx = Math.max(0, Math.min(TERM_COLS - 1, P(0, 1) - 1)); break;
    case "J": {
      var m = P(0, 0);
      if (m === 2 || m === 3) { for (var r = 0; r < TERM_ROWS; r++) term_grid[r] = blank_row_cur(); }
      else if (m === 0) {
        for (var x = term_cx; x < TERM_COLS; x++) term_grid[term_cy][x] = cur_blank();
        for (var r2 = term_cy + 1; r2 < TERM_ROWS; r2++) term_grid[r2] = blank_row_cur();
      } else if (m === 1) {
        for (var r3 = 0; r3 < term_cy; r3++) term_grid[r3] = blank_row_cur();
        for (var x2 = 0; x2 <= term_cx; x2++) term_grid[term_cy][x2] = cur_blank();
      }
      break;
    }
    case "K": {
      var mk = P(0, 0), v = cur_blank();
      if (mk === 0) { for (var x = term_cx; x < TERM_COLS; x++) term_grid[term_cy][x] = v; }
      else if (mk === 1) { for (var x = 0; x <= term_cx; x++) term_grid[term_cy][x] = v; }
      else { term_grid[term_cy] = blank_row_cur(); }
      break;
    }
    case "r":
      if (ps.length === 0 || ps[0] === null) { term_top = 0; term_bot = TERM_ROWS - 1; }
      else { term_top = Math.max(0, P(0, 1) - 1); term_bot = Math.min(TERM_ROWS - 1, P(1, TERM_ROWS) - 1); }
      break;
    case "S": term_scroll_up(P(0, 1)); break;
    case "M": term_scroll_up(P(0, 1)); break;
    case "T": term_scroll_down(P(0, 1)); break;
    case "m": sgr(ps); break;
    case "h": case "l": break;
    default: break;
  }
}

function term_putc(c) {
  c &= 0xff;   // stdout bytes arrive signed; high-ASCII (e.g. box-drawing 0xC4) would
               // otherwise look like a control char (<0x20) and get dropped.
  if (term_state === 0) {
    if (c === 0x1B) { term_state = 1; return; }
    if (c === 0x0D) { term_cx = 0; term_dirty = true; return; }
    if (c === 0x0A) { term_newline(); term_dirty = true; return; }
    if (c === 0x08) { if (term_cx > 0) term_cx--; term_dirty = true; return; }
    if (c === 0x09) { term_cx = (term_cx + 8) & ~7; if (term_cx >= TERM_COLS) term_cx = TERM_COLS - 1; return; }
    if (c === 0x07 || c < 0x20) return;
    if (term_cx >= TERM_COLS) { term_cx = 0; term_newline(); }
    term_grid[term_cy][term_cx] = PACK(c, cur_fg, cur_bg);
    term_cx++; term_dirty = true; return;
  }
  if (term_state === 1) { if (c === 0x5B) { term_state = 2; term_params = ""; } else term_state = 0; return; }
  if (term_state === 2) {
    if (c >= 0x30 && c <= 0x3F) { term_params += String.fromCharCode(c); return; }
    if (c >= 0x20 && c <= 0x2F) return;
    var clean = term_params.replace(/[^0-9;]/g, "");
    var ps = clean.length ? clean.split(";").map(function (s) { return s === "" ? null : parseInt(s, 10); }) : [];
    term_csi(String.fromCharCode(c), ps);
    term_state = 0; term_params = ""; term_dirty = true; return;
  }
}

// CP437 high-ASCII -> ASCII approximations. The PDF's Courier has no box-drawing
// glyphs, so map the common ones (used by tree, editors, TUIs) to | - + # = so
// they read as ASCII art instead of blanks.
var CP437 = {
  0xB0: 35, 0xB1: 35, 0xB2: 35, 0xDB: 35, 0xDC: 35, 0xDD: 35, 0xDE: 35, 0xDF: 35, 0xFE: 35, // blocks/shades -> #
  0xB3: 124, 0xBA: 124,                                                                      // vertical -> |
  0xC4: 45, 0xCD: 45,                                                                        // horizontal -> -  (= for double)
  0xDA: 43, 0xBF: 43, 0xC0: 43, 0xD9: 43, 0xC3: 43, 0xB4: 43, 0xC2: 43, 0xC1: 43, 0xC5: 43,  // single junctions -> +
  0xC9: 43, 0xBB: 43, 0xC8: 43, 0xBC: 43, 0xCC: 43, 0xB9: 43, 0xCB: 43, 0xCA: 43, 0xCE: 43,  // double junctions -> +
  0x10: 62, 0x11: 60, 0x1A: 62, 0x1B: 60                                                     // arrows -> > <
};
function glyph(ch) {
  if (ch >= 32 && ch < 127) return ch;
  if (CP437[ch] !== undefined) return CP437[ch];
  return 32;
}

// rendering
var render_mode = null;     // "mono" | "color", decided on first render
var _rowf = [], _last_row = [];
var _cellf = [], _last_cell = [];

function detect_mode() {
  if (render_mode) return;
  render_mode = globalThis.getField("cell_0_0") ? "color" : "mono";
}
function render_mono() {
  for (var r = 0; r < TERM_ROWS; r++) {
    var row = term_grid[r], s = "";
    for (var c = 0; c < TERM_COLS; c++) {
      var ch = glyph(CH(row[c]));
      if (term_cursor_visible && r === term_cy && c === term_cx && ch === 32) ch = 95; // cursor as '_'
      s += String.fromCharCode(ch);
    }
    if (_last_row[r] !== s) {
      _last_row[r] = s;
      if (_rowf[r] === undefined) _rowf[r] = globalThis.getField("row_" + r);
      if (_rowf[r]) _rowf[r].value = s;
    }
  }
}
function render_color() {
  for (var r = 0; r < TERM_ROWS; r++) {
    var row = term_grid[r], base = r * TERM_COLS;
    for (var c = 0; c < TERM_COLS; c++) {
      var cell = row[c];
      if (_last_cell[base + c] === cell) continue;
      _last_cell[base + c] = cell;
      var f = _cellf[base + c];
      if (f === undefined) { f = _cellf[base + c] = globalThis.getField("cell_" + r + "_" + c); }
      if (!f) continue;
      f.textColor = ["RGB"].concat(PAL[FG(cell)]);
      f.fillColor = ["RGB"].concat(PAL[BG(cell)]);
      f.value = String.fromCharCode(glyph(CH(cell)));
    }
  }
}
function term_render() {
  if (!term_dirty) return;
  term_dirty = false;
  detect_mode();
  if (render_mode === "color") render_color(); else render_mono();
}

// We write keystrokes straight into the BIOS keyboard ring buffer (0040:001A
// head, 0040:001C tail, 0040:001E..003D data; each entry = [ascii, scancode]).
// This happens between machine ticks while the CPU is paused, so there is no
// interrupt and no race with DOS's CON handling (the earlier pc_interrupt(7)
// approach intermittently triggered "Error reading from device CON").
var KB_BASE = 0x400;            // BIOS data segment 0x40
var KB_HEAD = 0x1A, KB_TAIL = 0x1C, KB_START = 0x1E, KB_END = 0x3E;

// ascii -> PC scancode (high byte). DOS line input only needs the ascii; the
// scancode mostly matters for full-screen apps, so unknown chars get 0.
var SC = {};
(function () {
  var rows = [
    ["`1234567890-=", [0x29, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D]],
    ["qwertyuiop[]\\", [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x2B]],
    ["asdfghjkl;'", [0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28]],
    ["zxcvbnm,./", [0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35]]
  ];
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i][0], a = rows[i][1];
    for (var j = 0; j < s.length; j++) { SC[s.charCodeAt(j)] = a[j]; SC[s.toUpperCase().charCodeAt(j)] = a[j]; }
  }
  SC[32] = 0x39;
})();
function sc_for(ascii) { return SC[ascii] || 0; }

// name -> [scancode, ascii]. ascii 0 marks an extended key (F-keys, arrows, ...).
var KBD_SPECIAL = {
  "Enter": [0x1C, 0x0D], "Backspace": [0x0E, 0x08], "Space": [0x39, 0x20], "Esc": [0x01, 0x1B], "Tab": [0x0F, 0x09],
  "F1": [0x3B, 0], "F2": [0x3C, 0], "F3": [0x3D, 0], "F4": [0x3E, 0], "F5": [0x3F, 0], "F6": [0x40, 0],
  "F7": [0x41, 0], "F8": [0x42, 0], "F9": [0x43, 0], "F10": [0x44, 0], "F11": [0x85, 0], "F12": [0x86, 0],
  "Up": [0x48, 0], "Down": [0x50, 0], "Left": [0x4B, 0], "Right": [0x4D, 0],
  "Home": [0x47, 0], "End": [0x4F, 0], "PgUp": [0x49, 0], "PgDn": [0x51, 0], "Ins": [0x52, 0], "Del": [0x53, 0]
};

var kbd_queue = [];
function kbd_enq(sc, ascii) { if (kbd_queue.length < 256) kbd_queue.push(((sc & 0xff) << 8) | (ascii & 0xff)); }

// One-shot Shift/Ctrl/Alt from the on-screen modifier keys (apply to next char).
var mod_shift = false, mod_ctrl = false, mod_alt = false;
var SHIFT_MAP = {
  0x31: 0x21, 0x32: 0x40, 0x33: 0x23, 0x34: 0x24, 0x35: 0x25, 0x36: 0x5E, 0x37: 0x26, 0x38: 0x2A, 0x39: 0x28, 0x30: 0x29,
  0x2D: 0x5F, 0x3D: 0x2B, 0x5B: 0x7B, 0x5D: 0x7D, 0x5C: 0x7C, 0x3B: 0x3A, 0x27: 0x22, 0x60: 0x7E, 0x2C: 0x3C, 0x2E: 0x3E, 0x2F: 0x3F
};
function kbd_mod(which) {
  if (which === "Shift") mod_shift = !mod_shift;
  else if (which === "Ctrl") mod_ctrl = !mod_ctrl;
  else if (which === "Alt") mod_alt = !mod_alt;
}
function kbd_send(ascii) {                                            // on-screen character keys
  var sc = sc_for(ascii);                                            // scancode = physical key
  if (mod_ctrl) { ascii = ascii & 0x1F; }                            // Ctrl+letter -> ^x
  else if (mod_alt) { ascii = 0; }                                   // Alt+key -> extended (scancode, 0)
  else if (mod_shift) {
    if (ascii >= 0x61 && ascii <= 0x7A) ascii -= 0x20;               // a-z -> A-Z
    else if (SHIFT_MAP[ascii] !== undefined) ascii = SHIFT_MAP[ascii];
  }
  mod_shift = mod_ctrl = mod_alt = false;                            // one-shot
  kbd_enq(sc, ascii);
}
function kbd_key(name) { var k = KBD_SPECIAL[name]; if (k) kbd_enq(k[0], k[1]); }
function key_pressed(change) {                                        // typing in the input box
  if (!change) return;
  for (var i = 0; i < change.length; i++) { var c = change.charCodeAt(i); if (c >= 32 && c < 127) kbd_enq(sc_for(c), c); }
}

// Push one [ascii, scancode] entry into the ring buffer (CPU is paused here).
function kbd_buf_push(scancode, ascii) {
  if (!HEAP) return false;
  var b = MEMBASE + KB_BASE;
  var head = HEAP[b + KB_HEAD] | (HEAP[b + KB_HEAD + 1] << 8);
  var tail = HEAP[b + KB_TAIL] | (HEAP[b + KB_TAIL + 1] << 8);
  var next = tail + 2; if (next >= KB_END) next = KB_START;
  if (next === head) return false;                                    // buffer full
  HEAP[b + tail] = ascii & 0xff;
  HEAP[b + tail + 1] = scancode & 0xff;
  HEAP[b + KB_TAIL] = next & 0xff;
  HEAP[b + KB_TAIL + 1] = (next >> 8) & 0xff;
  return true;
}
function kbd_pump() {
  if (kbd_queue.length === 0) return;
  var e = kbd_queue[0];
  if (kbd_buf_push((e >> 8) & 0xff, e & 0xff)) kbd_queue.shift();
}

// Show/hide the on-screen keyboard (fields kb_0, kb_1, ...). field.display IS honored by PDFium.
var kb_hidden = false;
function kbd_toggle() {
  kb_hidden = !kb_hidden;
  for (var i = 0; ; i++) {
    var f = globalThis.getField("kb_" + i);
    if (!f) break;
    try { f.display = kb_hidden ? display.hidden : display.visible; } catch (e) {}
  }
}

// driver
Module.stdout = function (c) { if (c !== null && c !== 0) term_putc(c); };
Module.stderr = function (c) {};
Module.print = function (msg) { for (var i = 0; i < msg.length; i++) term_putc(msg.charCodeAt(i)); term_putc(10); };
Module.printErr = function (msg) {};

// ---- CGA 320x200 graphics -> grayscale ASCII (games like Alley Cat) ----
// PDFium can't show pixels or color, so when the guest switches to CGA graphics
// (BIOS video mode 4 or 5) we read the bitmap at 0xB8000 and paint a grayscale
// density map into the same 25 row fields. 320x200 maps to 80x25 (a 4x8-pixel
// block per character). Mode 4/5 layout: even scanlines at offset 0, odd at
// 0x2000; 80 bytes/line; 2 bits/pixel, leftmost pixel in the high bits.
var MEMBASE = 0, HEAP = null, last_vmode = 3;
var CGA_RAMP = " .:-=+*xX#@";
function render_cga() {
  var base = MEMBASE + 0xB8000;
  for (var ty = 0; ty < TERM_ROWS; ty++) {
    var s = "";
    for (var tx = 0; tx < TERM_COLS; tx++) {
      var sum = 0;                                  // average all 32 pixel intensities (0-3)
      for (var py = 0; py < 8; py++) {
        var y = ty * 8 + py;
        var lineBase = ((y & 1) ? 0x2000 : 0) + (y >> 1) * 80;
        var b = HEAP[base + lineBase + tx];         // a cell's 4 horizontal pixels are one byte
        sum += ((b >> 6) & 3) + ((b >> 4) & 3) + ((b >> 2) & 3) + (b & 3);
      }
      s += CGA_RAMP[(sum * (CGA_RAMP.length - 1) / 96) | 0];   // 32 samples x max 3 = 96
    }
    if (_last_row[ty] !== s) {
      _last_row[ty] = s;
      if (_rowf[ty] === undefined) _rowf[ty] = globalThis.getField("row_" + ty);
      if (_rowf[ty]) _rowf[ty].value = s;
    }
  }
}

var STEPS_PER_TICK = 400000;
var total_instrs = 0, last_updated = null;
function machine_tick() {
  kbd_pump();
  total_instrs += Module.ccall("virt_machine_run", "number", ["number"], [STEPS_PER_TICK]);
  var vmode = HEAP ? HEAP[MEMBASE + 0x449] : 3;     // BIOS video mode (0040:0049)
  if (vmode !== last_vmode) { _last_row = []; last_vmode = vmode; }  // mode switch -> full redraw
  if (vmode === 4 || vmode === 5) render_cga();
  else term_render();
  var now = Date.now(), dt = now - last_updated;
  if (dt > 1000) {
    var f = globalThis.getField("speed_indicator");
    if (f) f.value = "Speed: " + Math.round(total_instrs / (dt / 1000) / 1000) + " kIPS";
    total_instrs = 0; last_updated = now;
  }
}
function start_machine_interval() { last_updated = Date.now(); set_interval(machine_tick, 1); }
function start() {
  term_init();
  term_render();
  Module.ccall("vm_start", "number", [], []);
  MEMBASE = Module.ccall("get_mem_ptr", "number", [], []);
  HEAP = Module.HEAPU8;
  start_machine_interval();
  set_interval(function () { var f = globalThis.getField("key_input"); if (f) f.value = ""; }, 2000);
}

set_timeout(start, 100);
