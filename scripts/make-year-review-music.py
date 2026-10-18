"""
Year in Review background music - an original, upbeat loop, composed in code so the app ships no
third-party audio. Writes assets/audio/year-review-loop.wav (mono, 22.05 kHz, 16-bit).

C - G - Am - F, twice: soft pad, bass, a plucked arpeggio, light drums; the second time round a
bell melody joins in. Notes that ring past the end wrap around to the start, so the loop is
seamless when the player repeats it.

    python scripts/make-year-review-music.py
"""

import os
import wave

import numpy as np

SR = 22050
BPM = 108
BEAT = 60 / BPM
BARS = 16
LENGTH = int(SR * BEAT * 4 * BARS)
rng = np.random.default_rng(7)

out = np.zeros(LENGTH)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def place(sig, start_s, gain):
    """Add `sig` at `start_s` seconds, wrapping round the end of the loop."""
    i = int(start_s * SR) % LENGTH
    n = len(sig)
    end = i + n
    if end <= LENGTH:
        out[i:end] += sig * gain
    else:
        k = LENGTH - i
        out[i:] += sig[:k] * gain
        out[: n - k] += sig[k:] * gain


def tone(freq, dur, harmonics=(1.0,), attack=0.01, decay=None, release=0.05):
    t = np.arange(int(dur * SR)) / SR
    sig = sum(a * np.sin(2 * np.pi * freq * (h + 1) * t) for h, a in enumerate(harmonics))
    env = np.minimum(1, t / attack)
    if decay:
        env *= np.exp(-t / decay)
    rel = np.clip((dur - t) / release, 0, 1)
    return sig * env * rel


# C, G, Am, F - (root, chord tones)
CHORDS = [(48, [60, 64, 67]), (43, [59, 62, 67]), (45, [60, 64, 69]), (41, [60, 65, 69])]
MELODY = [  # (beat within the 4-bar phrase, midi, beats long) - second half only
    (0, 76, 1), (1, 79, 1), (2, 81, 1.5), (3.5, 79, 0.5),
    (4, 74, 1), (5, 76, 1), (6, 79, 2),
    (8, 76, 1), (9, 72, 1), (10, 74, 1.5), (11.5, 76, 0.5),
    (12, 77, 1), (13, 76, 1), (14, 72, 2),
]

for bar in range(BARS):
    root, notes = CHORDS[bar % 4]
    t0 = bar * 4 * BEAT
    second_half = bar >= 8
    # Pad: the chord, gently swelling.
    for n in notes:
        for detune in (-0.12, 0.12):
            place(tone(midi(n - 12 + detune), 4 * BEAT + 0.3, (1, 0.25, 0.08), attack=0.5, release=0.6), t0, 0.035)
    # Bass: root on 1 and the "and" of 2.
    for b in (0, 1.5, 2, 3.5) if second_half else (0, 2):
        place(tone(midi(root - 12), BEAT * 0.9, (1, 0.3), attack=0.005, decay=0.35), t0 + b * BEAT, 0.33)
    # Arpeggio: eighth notes up and down the chord.
    arp = [notes[0], notes[1], notes[2], notes[1] + 12 if notes[1] + 12 < 84 else notes[1], notes[2], notes[1], notes[0] + 12, notes[1]]
    for k, n in enumerate(arp):
        place(tone(midi(n), BEAT * 0.6, (1, 0.5, 0.2), attack=0.003, decay=0.12), t0 + k * BEAT / 2, 0.09)
    # Drums: kick on 1 and 3, clap on 2 and 4, soft hats on the eighths.
    for b in range(4):
        t = np.arange(int(0.25 * SR)) / SR
        if b in (0, 2):
            kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-t / 0.03)) * t) * np.exp(-t / 0.12)
            place(kick, t0 + b * BEAT, 0.5)
        else:
            clap = rng.standard_normal(len(t)) * np.exp(-t / 0.05)
            place(np.convolve(clap, np.ones(4) / 4, "same"), t0 + b * BEAT, 0.07)
    for h in range(8):
        t = np.arange(int(0.05 * SR)) / SR
        hat = np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-t / 0.012)
        place(hat, t0 + h * BEAT / 2, 0.025 if h % 2 else 0.04)

# Bell melody over the second half.
for phrase in (8, 12):
    for beat, n, length in MELODY:
        place(tone(midi(n), length * BEAT + 0.4, (1, 0, 0.35, 0, 0.12), attack=0.004, decay=0.45), (phrase * 4 + beat) * BEAT, 0.12)

# Gentle low-pass, then normalise.
out = np.convolve(out, np.ones(3) / 3, "same")
out = out / np.max(np.abs(out)) * 0.8
pcm = (out * 32767).astype("<i2")

dest = os.path.join(os.path.dirname(__file__), "..", "assets", "audio", "year-review-loop.wav")
os.makedirs(os.path.dirname(dest), exist_ok=True)
with wave.open(dest, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"{dest}: {LENGTH / SR:.1f}s, {os.path.getsize(dest) / 1e6:.2f} MB")
