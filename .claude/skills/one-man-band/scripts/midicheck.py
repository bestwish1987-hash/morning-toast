#!/usr/bin/env python3
"""驗證 MIDI 檔結構是否正確，並印出每個音軌的摘要。用法：python3 midicheck.py song.mid"""
import sys, struct

def varlen(data, i):
    v = 0
    while True:
        b = data[i]; i += 1
        v = (v << 7) | (b & 0x7f)
        if not b & 0x80:
            return v, i

def main(path):
    data = open(path, 'rb').read()
    assert data[:4] == b'MThd', 'missing MThd'
    hlen, fmt, ntracks, tpq = struct.unpack('>IHHH', data[4:14])
    print(f'format={fmt} tracks={ntracks} ticks/quarter={tpq}')
    i = 14
    for t in range(ntracks):
        assert data[i:i+4] == b'MTrk', f'track {t}: missing MTrk at {i}'
        length = struct.unpack('>I', data[i+4:i+8])[0]
        end = i + 8 + length
        j = i + 8
        tick = 0; notes = 0; running = None; names = []; tempo = None; markers = 0; last_off = 0
        while j < end:
            delta, j = varlen(data, j); tick += delta
            status = data[j]
            if status == 0xFF:
                typ = data[j+1]; ln, j2 = varlen(data, j+2)
                body = data[j2:j2+ln]
                if typ == 0x03: names.append(body.decode('utf8', 'replace'))
                if typ == 0x51: tempo = int.from_bytes(body, 'big')
                if typ == 0x06: markers += 1
                if typ == 0x2F: assert j2 + ln == end, f'track {t}: end-of-track not at end'
                j = j2 + ln
            elif status in (0xF0, 0xF7):
                ln, j2 = varlen(data, j+1); j = j2 + ln
            else:
                if status & 0x80:
                    running = status; j += 1
                else:
                    status = running
                kind = status & 0xF0
                n = 1 if kind in (0xC0, 0xD0) else 2
                if kind == 0x90 and data[j+1] > 0: notes += 1
                if kind in (0x80, 0x90): last_off = tick
                j += n
        assert j == end, f'track {t}: parsed {j} != {end}'
        extra = f' tempo={60_000_000/tempo:.1f}bpm markers={markers}' if tempo else ''
        print(f'track {t}: {names[0] if names else ""!r} notes={notes} last_tick={last_off}{extra}')
        i = end
    assert i == len(data), 'trailing bytes'
    print('OK')

if __name__ == '__main__':
    main(sys.argv[1])
