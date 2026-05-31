#!/usr/bin/env python3
# DOSPDF page generator. Structure/approach adapted from ading2210/linuxpdf
# (gen_pdf.py, GPLv3), but laid out as a true 80x25 monospace text screen:
# 25 read-only text fields (row_0..row_24) filled from the JS ANSI terminal,
# plus a typing box and on-screen control keys that feed kbd_inject.
import sys
from pdfrw import PdfWriter, PdfDict, PdfArray, PdfName
from pdfrw.objects.pdfstring import PdfString

COLS = 80
ROWS = 25
FONT_SIZE = 11
CHAR_W = FONT_SIZE * 0.6        # Courier advance width
ROW_H = 13
MARGIN = 16
TITLE_H = 34
INPUT_H = 64

SCREEN_W = COLS * CHAR_W                                   # 528
PAGE_W = int(SCREEN_W + 2 * MARGIN)                        # 560
PAGE_H = int(ROWS * ROW_H + 2 * MARGIN + TITLE_H + INPUT_H)

DA = "/Courier %d Tf 0 g" % FONT_SIZE


def script(js):
    return PdfDict(S=PdfName.JavaScript, JS="try {" + js + "} catch (e) {app.alert(e.stack || e)}")


def create_page(width, height):
    page = PdfDict()
    page.Type = PdfName.Page
    page.MediaBox = PdfArray([0, 0, width, height])
    page.Resources = PdfDict()
    page.Resources.Font = PdfDict()
    page.Resources.Font.F1 = PdfDict()
    page.Resources.Font.F1.Type = PdfName.Font
    page.Resources.Font.F1.Subtype = PdfName.Type1
    page.Resources.Font.F1.BaseFont = PdfName.Courier
    return page


def create_text(x, y, size, txt):
    return f"""
    BT
    /F1 {size} Tf
    {x} {y} Td ({txt}) Tj
    ET
    """


def create_field(name, x, y, width, height, value="", readonly=True):
    a = PdfDict()
    a.Type = PdfName.Annot
    a.Subtype = PdfName.Widget
    a.FT = PdfName.Tx
    a.Ff = 1 if readonly else 0     # bit 1 = ReadOnly (JS may still set .value)
    a.Rect = PdfArray([x, y, x + width, y + height])
    a.T = PdfString.encode(name)
    a.V = PdfString.encode(value)
    a.DA = PdfString.encode(DA)
    a.BS = PdfDict()
    a.BS.W = 0
    a.MK = PdfDict()
    a.MK.BG = PdfArray([1, 1, 1])   # white cell background
    return a


def create_button(name, x, y, width, height, caption, js):
    b = PdfDict()
    b.Type = PdfName.Annot
    b.Subtype = PdfName.Widget
    b.FT = PdfName.Btn
    b.Ff = 65536                    # pushbutton
    b.Rect = PdfArray([x, y, x + width, y + height])
    b.T = PdfString.encode(name)
    b.BS = PdfDict()
    b.BS.W = 1
    b.MK = PdfDict()
    b.MK.BG = PdfArray([0.85, 0.85, 0.85])
    b.MK.CA = PdfString.encode(caption)
    b.AA = PdfDict()
    b.AA.D = script(js)
    return b


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    color = "--color" in sys.argv     # per-cell 16-color screen (experimental, ~2000 fields)
    with open(args[0]) as f:
        js = f.read()

    page = create_page(PAGE_W, PAGE_H)
    page.AA = PdfDict()
    page.AA.O = script(js)

    fields = []
    top = PAGE_H - TITLE_H
    if color:
        # one field per character cell (80x25). White-on-black to start; the glue
        # sets per-cell textColor/fillColor at runtime from the ANSI SGR stream.
        da_cell = "/Courier %d Tf 1 g" % FONT_SIZE
        for r in range(ROWS):
            y = top - (r + 1) * ROW_H
            for c in range(COLS):
                cell = create_field("cell_%d_%d" % (r, c), MARGIN + c * CHAR_W, y, CHAR_W, ROW_H)
                cell.DA = PdfString.encode(da_cell)
                cell.MK.BG = PdfArray([0, 0, 0])
                fields.append(cell)
    else:
        for r in range(ROWS):
            y = top - (r + 1) * ROW_H
            fields.append(create_field("row_%d" % r, MARGIN, y, SCREEN_W, ROW_H))

    fields.append(create_field("speed_indicator", PAGE_W - 120, PAGE_H - 16, 110, 12,
                               "Loading...", readonly=True))

    ki = create_field("key_input", MARGIN, 48, 230, 18, "", readonly=False)
    ki.AA = PdfDict()
    ki.AA.K = script("key_pressed(event.change)")
    fields.append(ki)

    bx = 254
    for cap, name, w in [("Enter", "Enter", 60), ("Backspace", "Backspace", 92),
                         ("Space", "Space", 60), ("Esc", "Esc", 34), ("Tab", "Tab", 34)]:
        fields.append(create_button("btn_" + name, bx, 48, w, 18, cap, "kbd_key('%s')" % name))
        bx += w + 6

    parts = []
    if color:
        # black backdrop behind the cell grid so inter-cell gaps read as black
        sx, sy, sw, sh = MARGIN, top - ROWS * ROW_H, SCREEN_W, ROWS * ROW_H
        parts.append("q 0 0 0 rg %d %d %d %d re f Q" % (sx, sy, sw, sh))
    page.Contents = PdfDict()
    page.Contents.stream = "\n".join(parts + [
        create_text(MARGIN, PAGE_H - 24, 18, "DOSPDF"),
        create_text(MARGIN + 92, PAGE_H - 21, 9, "FreeDOS in a PDF - inspired by Linux in a PDF"),
        create_text(MARGIN, 74, 8, "Click the box and type to send keys; use the buttons for Enter / Backspace / Tab / Esc."),
        create_text(MARGIN, 22, 7, "8086tiny by Adrian Cable MIT - PDF technique from linuxpdf/doompdf by ading2210 GPLv3 - FreeDOS"),
        create_text(MARGIN, 10, 8, "Note: runs only in Chromium-based PDF viewers - Chrome, Edge, Brave."),
    ])

    page.Annots = PdfArray(fields)

    writer = PdfWriter()
    writer.addpage(page)

    courier = PdfDict(Type=PdfName.Font, Subtype=PdfName.Type1, BaseFont=PdfName.Courier)
    courier.indirect = True
    acro = PdfDict()
    acro.Fields = PdfArray(fields)
    acro.DA = PdfString.encode(DA)
    acro.DR = PdfDict(Font=PdfDict(Courier=courier))
    acro.NeedAppearances = True
    acro.indirect = True
    writer.trailer.Root.AcroForm = acro

    writer.write(args[1])
    print("wrote %s  (%dx%d pt, %s, %d fields)" %
          (args[1], PAGE_W, PAGE_H, "color cells" if color else "mono rows", len(fields)))
