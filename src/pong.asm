; PONG.COM - a tiny text-mode Pong for DOSPDF (8086, real mode, .COM).
; Player paddle = W/S, opponent = simple AI, ball paced by the BIOS timer,
; drawn straight to CGA text video memory (B800:0) so 8086tiny's VMEM driver
; renders it. ESC quits. First to 9 just keeps going,it's a toy.
;
; Build:  nasm -f bin pong.asm -o pong.com
;
; Written for DOSPDF. Public domain.

bits 16
org 0x100

%define ATTR  0x07          ; light grey on black
%define PADCH '#'
%define BALLCH 'O'
%define NETCH ':'
%define PADH  5             ; paddle height (rows)
%define LP    3             ; left paddle column
%define RP    76            ; right paddle column
%define SPEED 3             ; ball advances every SPEED timer ticks (~18.2 Hz)

start:
    mov ax, 0x0003
    int 0x10                ; 80x25 colour text mode (also clears)
    mov ah, 0x01            ; hide the hardware cursor
    mov cx, 0x2607
    int 0x10
    mov ax, 0xB800
    mov es, ax

    mov word [ballx], 40
    mov word [bally], 12
    mov word [bdx], 1
    mov word [bdy], 1
    mov word [lpad], 10
    mov word [rpad], 10
    mov byte [ls], 0
    mov byte [rs], 0

    mov ah, 0
    int 0x1a                ; CX:DX = tick count
    mov [lt], dx

mainloop:
    ;input
.k:
    mov ah, 1
    int 0x16                ; key waiting?
    jz .kd
    mov ah, 0
    int 0x16                ; AL = ASCII
    cmp al, 27
    je quit
    cmp al, 'w'
    je .lu
    cmp al, 'W'
    je .lu
    cmp al, 's'
    je .ld
    cmp al, 'S'
    je .ld
    jmp .k
.lu:
    cmp word [lpad], 1
    jle .k
    dec word [lpad]
    jmp .k
.ld:
    mov ax, [lpad]
    add ax, PADH
    cmp ax, 24
    jge .k
    inc word [lpad]
    jmp .k
.kd:
    mov ah, 0
    int 0x1a
    mov ax, dx
    sub ax, [lt]
    cmp ax, SPEED
    jb .draw
    mov [lt], dx
    call moveball
    call ai
.draw:
    call render
    jmp mainloop

quit:
    mov ax, 0x0003
    int 0x10
    mov ax, 0x4c00
    int 0x21

; ball physics
moveball:
    mov ax, [ballx]
    add ax, [bdx]
    mov [ballx], ax
    mov ax, [bally]
    add ax, [bdy]
    mov [bally], ax
    ; top / bottom walls
    cmp word [bally], 1
    jg .nt
    mov word [bally], 1
    neg word [bdy]
.nt:
    cmp word [bally], 23
    jl .nb
    mov word [bally], 23
    neg word [bdy]
.nb:
    ; left paddle / left-out
    cmp word [ballx], LP+1
    jg .right
    mov ax, [bally]
    sub ax, [lpad]
    js .lmiss
    cmp ax, PADH
    jge .lmiss
    mov word [ballx], LP+1
    mov word [bdx], 1
    ret
.lmiss:
    cmp word [ballx], 0
    jg .ret
    inc byte [rs]
    call resetball
    ret
.right:
    cmp word [ballx], RP-1
    jl .ret
    mov ax, [bally]
    sub ax, [rpad]
    js .rmiss
    cmp ax, PADH
    jge .rmiss
    mov word [ballx], RP-1
    mov word [bdx], -1
    ret
.rmiss:
    cmp word [ballx], 79
    jl .ret
    inc byte [ls]
    call resetball
.ret:
    ret

resetball:
    mov word [ballx], 40
    mov word [bally], 12
    ret

; OPP ball tracker
ai:
    mov ax, [rpad]
    add ax, 2               ; ~paddle centre
    cmp ax, [bally]
    je .e
    jl .d
    cmp word [rpad], 1
    jle .e
    dec word [rpad]
    ret
.d:
    mov ax, [rpad]
    add ax, PADH
    cmp ax, 24
    jge .e
    inc word [rpad]
.e:
    ret

; drawing
render:
    xor di, di
    mov ax, (ATTR<<8)|' '
    mov cx, 2000
    rep stosw               ; clear screen
    ; centre net
    mov cx, 40
    mov dx, 1
.net:
    mov al, NETCH
    call plot
    add dx, 2
    cmp dx, 24
    jl .net
    ; paddles
    mov cx, LP
    mov dx, [lpad]
    mov bp, PADH
    call vbar
    mov cx, RP
    mov dx, [rpad]
    mov bp, PADH
    call vbar
    ; ball
    mov cx, [ballx]
    mov dx, [bally]
    mov al, BALLCH
    call plot
    ; title
    mov si, title
    mov cx, 2
    xor dx, dx
    call puts
    ; scores top-right
    mov cx, 58
    xor dx, dx
    mov al, 'L'
    call plot
    inc cx
    mov al, ':'
    call plot
    inc cx
    mov al, [ls]
    add al, '0'
    call plot
    mov cx, 66
    mov al, 'R'
    call plot
    inc cx
    mov al, ':'
    call plot
    inc cx
    mov al, [rs]
    add al, '0'
    call plot
    ret

vbar:                       ; cx=col, dx=row, bp=count
    push dx
    push bp
.l:
    mov al, PADCH
    call plot
    inc dx
    dec bp
    jnz .l
    pop bp
    pop dx
    ret

puts:                       ; si->asciiz, cx=col, dx=row
    push cx
.l:
    mov al, [si]
    or al, al
    jz .d
    call plot
    inc si
    inc cx
    jmp .l
.d:
    pop cx
    ret

plot:                       ; al=char, cx=col, dx=row  -> B800:(row*80+col)*2
    push ax
    push cx
    push dx
    push di
    mov ah, ATTR
    push ax
    mov ax, dx
    mov dx, 80
    mul dx
    add ax, cx
    shl ax, 1
    mov di, ax
    pop ax
    stosw
    pop di
    pop dx
    pop cx
    pop ax
    ret

title db 'PONG   W/S = move   ESC = quit', 0

ballx dw 40
bally dw 12
bdx   dw 1
bdy   dw 1
lpad  dw 10
rpad  dw 10
lt    dw 0
ls    db 0
rs    db 0
