import wave, struct, math

SR = 44100

def write_wav(path, samples):
    with wave.open(path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b''.join(struct.pack('<h', max(-32767, min(32767, int(s * 32767)))) for s in samples)
        w.writeframes(frames)

def gate_env(n, total):
    # 快速淡入(1ms)+指数淡出，模拟机械咔哒
    attack = int(0.001 * SR)
    out = []
    for i in range(total):
        if i < attack:
            a = i / attack
        else:
            a = 1.0
        decay = math.exp(-(i) / (total * 0.35))
        out.append(a * decay)
    return out

def gen_tick():
    dur = 0.012  # 12ms 极短咔哒
    n = int(dur * SR)
    env = gate_env(0, n)
    sig = [env[i] * math.sin(2 * math.pi * 2000 * i / SR) for i in range(n)]
    return sig

def gen_snap():
    dur = 0.05  # 50ms 闭锁重音
    n = int(dur * SR)
    env = gate_env(0, n)
    sig = []
    for i in range(n):
        # 低频"咔嗒"主体 + 一点高频敲击瞬态
        body = 0.75 * math.sin(2 * math.pi * 170 * i / SR)
        click = 0.25 * math.sin(2 * math.pi * 1200 * i / SR)
        sig.append(env[i] * (body + click))
    return sig

write_wav('assets/audio/tick.wav', gen_tick())
write_wav('assets/audio/snap.wav', gen_snap())
print('OK: tick.wav / snap.wav generated')
