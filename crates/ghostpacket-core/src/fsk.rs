//! Acoustic modem: continuous-phase 4-FSK (2 bits/symbol) with a Barker-13
//! sync preamble, Goertzel symbol detection and Reed-Solomon protection.
//!
//! Burst layout (symbol index):
//! ```text
//! [lead 1 @1200 Hz, ramp-in] [Barker-13: +1=3200 Hz, -1=1200 Hz] [guard 3 @1200 Hz]
//! [header 24 sym = RS(6,2) of u16 BE frame length]
//! [data: frame split in chunks of <=239 B, each + 16 RS parity bytes]
//! [tail 1 @1200 Hz, ramp-out]
//! ```
//! Ultrasonic Whisper (V3) is the same modem moved to 17.6–19.6 kHz with 5 ms
//! symbols (400 bit/s), for short frames (≤ 256 B) such as an identity card.
//!
//! Analysis windows are centred in each symbol. Their length (5 ms / 12.5 ms, 2.5 ms ultrasonic)
//! makes the 400 Hz tone spacing an integer number of cycles, so the four
//! data tones are orthogonal for the Goertzel detector.

use std::f64::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use serde::Serialize;

use crate::error::GhostError;
use crate::fec;
use crate::protocol::MAX_FRAME_SIZE;

pub const DATA_FREQS: [f32; 4] = [1600.0, 2000.0, 2400.0, 2800.0];
pub const SYNC_LOW_HZ: f32 = 1200.0;
pub const SYNC_HIGH_HZ: f32 = 3200.0;
pub const BARKER13: [i8; 13] = [1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1];
pub const GUARD_SYMBOLS: usize = 3;
pub const HEADER_BYTES: usize = 2;
pub const HEADER_PARITY: usize = 4;
pub const DATA_PARITY: usize = 16;
pub const DATA_CHUNK: usize = fec::MAX_CODEWORD - DATA_PARITY; // 239
pub const MAX_SAMPLES: usize = 48_000 * 40;
pub const MIN_SAMPLE_RATE: u32 = 8_000;
pub const MAX_SAMPLE_RATE: u32 = 192_000;
pub const AMPLITUDE: f32 = 0.7;
/// Minimum normalised Barker correlation (range -1..1) to accept a preamble.
pub const PREAMBLE_THRESHOLD: f32 = 0.55;

/// Ultrasonic Whisper band: 400 Hz spacing, orthogonal over the 2.5 ms window.
pub const ULTRA_DATA_FREQS: [f32; 4] = [18_000.0, 18_400.0, 18_800.0, 19_200.0];
pub const ULTRA_SYNC_LOW_HZ: f32 = 17_600.0;
pub const ULTRA_SYNC_HIGH_HZ: f32 = 19_600.0;
/// The 19.6 kHz tone aliases below 39.2 kHz; 44.1 kHz keeps a margin and is the
/// lowest common rate of sound hardware that can still play it.
pub const ULTRASONIC_MIN_SAMPLE_RATE: u32 = 44_100;
/// Identity cards and pairing tokens only: a 256-byte frame lasts ≈ 6 s.
pub const ULTRASONIC_MAX_FRAME: usize = 256;

/// Tone plan of a mode.
struct Band {
    data: [f32; 4],
    low: f32,
    high: f32,
}

/// Gray mapping: 2-bit value -> tone index, and its inverse (same table).
const GRAY: [usize; 4] = [0, 1, 3, 2];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FskMode {
    /// 15 ms symbols, 133 bit/s: real speaker -> microphone.
    Robust,
    /// 6 ms symbols, 333 bit/s: judge demo loopback.
    Fast,
    /// 5 ms symbols at 17.6–19.6 kHz, 400 bit/s: near-silent short frames.
    Ultrasonic,
}

impl FskMode {
    pub fn from_code(code: u8) -> Result<Self, GhostError> {
        match code {
            0 => Ok(FskMode::Robust),
            1 => Ok(FskMode::Fast),
            2 => Ok(FskMode::Ultrasonic),
            _ => Err(GhostError::InvalidArgument { what: "fsk mode" }),
        }
    }

    pub fn symbol_seconds(self) -> f64 {
        match self {
            FskMode::Robust => 0.015,
            FskMode::Fast => 0.006,
            FskMode::Ultrasonic => 0.005,
        }
    }

    pub fn window_seconds(self) -> f64 {
        match self {
            FskMode::Robust => 0.0125,
            FskMode::Fast => 0.005,
            FskMode::Ultrasonic => 0.0025,
        }
    }

    fn band(self) -> Band {
        match self {
            FskMode::Ultrasonic => Band { data: ULTRA_DATA_FREQS, low: ULTRA_SYNC_LOW_HZ, high: ULTRA_SYNC_HIGH_HZ },
            _ => Band { data: DATA_FREQS, low: SYNC_LOW_HZ, high: SYNC_HIGH_HZ },
        }
    }

    /// Largest frame the mode carries.
    pub fn max_frame(self) -> usize {
        match self {
            FskMode::Ultrasonic => ULTRASONIC_MAX_FRAME,
            _ => MAX_FRAME_SIZE,
        }
    }
}

struct Timing {
    ns: f64,
    nw: usize,
    margin: usize,
}

fn timing(sample_rate: u32, mode: FskMode) -> Result<Timing, GhostError> {
    let min = if mode == FskMode::Ultrasonic { ULTRASONIC_MIN_SAMPLE_RATE } else { MIN_SAMPLE_RATE };
    if !(min..=MAX_SAMPLE_RATE).contains(&sample_rate) {
        return Err(GhostError::InvalidSampleRate { rate: sample_rate });
    }
    let fs = sample_rate as f64;
    let ns = mode.symbol_seconds() * fs;
    let nw = (mode.window_seconds() * fs).round() as usize;
    let margin = ((ns - nw as f64) / 2.0).round().max(0.0) as usize;
    Ok(Timing { ns, nw, margin })
}

/// Splits the frame length into RS chunk sizes.
fn chunk_sizes(len: usize) -> Vec<usize> {
    let mut sizes = Vec::new();
    let mut remaining = len;
    while remaining > 0 {
        let c = remaining.min(DATA_CHUNK);
        sizes.push(c);
        remaining -= c;
    }
    sizes
}

fn coded_len(frame_len: usize) -> usize {
    HEADER_BYTES + HEADER_PARITY + frame_len + chunk_sizes(frame_len).len() * DATA_PARITY
}

fn total_symbols(frame_len: usize) -> usize {
    1 + BARKER13.len() + GUARD_SYMBOLS + coded_len(frame_len) * 4 + 1
}

/// Burst duration in seconds for a frame of `frame_len` bytes.
pub fn burst_seconds(frame_len: usize, mode: FskMode) -> f64 {
    total_symbols(frame_len) as f64 * mode.symbol_seconds()
}

fn bytes_to_tones(bytes: &[u8], out: &mut Vec<usize>) {
    for &b in bytes {
        for shift in [6u32, 4, 2, 0] {
            let v = ((b >> shift) & 0b11) as usize;
            out.push(GRAY.get(v).copied().unwrap_or(0));
        }
    }
}

/// Generates the PCM burst (mono f32, -1..1) for `frame`.
pub fn modulate(frame: &[u8], sample_rate: u32, mode: FskMode) -> Result<Vec<f32>, GhostError> {
    if frame.is_empty() || frame.len() > mode.max_frame() {
        return Err(GhostError::FskInvalidLength { len: frame.len() });
    }
    let t = timing(sample_rate, mode)?;
    let band = mode.band();
    let total = total_symbols(frame.len());
    let total_samples = (total as f64 * t.ns).round() as usize;
    if total_samples > MAX_SAMPLES {
        return Err(GhostError::TooManySamples { len: total_samples });
    }

    // Symbol plan as frequencies.
    let mut freqs: Vec<f32> = Vec::with_capacity(total);
    freqs.push(band.low);
    for &chip in BARKER13.iter() {
        freqs.push(if chip > 0 { band.high } else { band.low });
    }
    freqs.extend(std::iter::repeat_n(band.low, GUARD_SYMBOLS));
    let len_u16 = u16::try_from(frame.len()).map_err(|_| GhostError::FskInvalidLength {
        len: frame.len(),
    })?;
    let header = fec::encode(&len_u16.to_be_bytes(), HEADER_PARITY)?;
    let mut tones = Vec::with_capacity(coded_len(frame.len()) * 4);
    bytes_to_tones(&header, &mut tones);
    let mut offset = 0usize;
    for size in chunk_sizes(frame.len()) {
        let chunk = frame
            .get(offset..offset + size)
            .ok_or(GhostError::FskInvalidLength { len: frame.len() })?;
        let cw = fec::encode(chunk, DATA_PARITY)?;
        bytes_to_tones(&cw, &mut tones);
        offset += size;
    }
    for tone in tones {
        freqs.push(band.data.get(tone).copied().unwrap_or(band.data[0]));
    }
    freqs.push(band.low);

    // Continuous-phase synthesis with raised-cosine ramps on lead/tail symbols.
    let fs = sample_rate as f64;
    let mut out = Vec::with_capacity(total_samples);
    let mut phase = 0.0f64;
    let first_end = t.ns.round() as usize;
    let last_start = ((total - 1) as f64 * t.ns).round() as usize;
    for (k, &f) in freqs.iter().enumerate() {
        let start = (k as f64 * t.ns).round() as usize;
        let end = ((k + 1) as f64 * t.ns).round() as usize;
        let step = 2.0 * PI * f as f64 / fs;
        for s in start..end {
            phase += step;
            if phase > 2.0 * PI {
                phase -= 2.0 * PI;
            }
            let env = if s < first_end {
                0.5 - 0.5 * (PI * s as f64 / first_end.max(1) as f64).cos()
            } else if s >= last_start {
                let span = (total_samples - last_start).max(1) as f64;
                0.5 + 0.5 * (PI * (s - last_start) as f64 / span).cos()
            } else {
                1.0
            };
            out.push((AMPLITUDE as f64 * env * phase.sin()) as f32);
        }
    }
    Ok(out)
}

/// Goertzel detector for a fixed set of frequencies.
struct Goertzel {
    coeffs: Vec<f32>,
}

impl Goertzel {
    fn new(freqs: &[f32], sample_rate: u32) -> Self {
        let fs = sample_rate as f32;
        Goertzel {
            coeffs: freqs
                .iter()
                .map(|f| 2.0 * (2.0 * std::f32::consts::PI * f / fs).cos())
                .collect(),
        }
    }

    /// Power of each frequency over `window`.
    fn powers(&self, window: &[f32], out: &mut [f32]) {
        for (slot, &c) in out.iter_mut().zip(self.coeffs.iter()) {
            *slot = goertzel_power(window, c);
        }
    }

    /// Power of frequency number `idx` over `window`.
    fn power(&self, window: &[f32], idx: usize) -> Option<f32> {
        self.coeffs.get(idx).map(|&c| goertzel_power(window, c))
    }
}

fn goertzel_power(window: &[f32], c: f32) -> f32 {
    let mut s1 = 0.0f32;
    let mut s2 = 0.0f32;
    for &x in window {
        let s = x + c * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    (s1 * s1 + s2 * s2 - c * s1 * s2).max(0.0)
}

impl Goertzel {
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FskDecodeResult {
    #[serde(skip)]
    pub frame: Vec<u8>,
    pub frame_len: usize,
    /// Sample index where the Barker preamble starts.
    pub sync_offset: usize,
    pub preamble_score: f32,
    pub mean_symbol_snr_db: f32,
    pub min_symbol_snr_db: f32,
    pub corrected_bytes: usize,
    pub symbols: usize,
    /// Sample index just after the last data symbol.
    pub end_offset: usize,
}

/// Sync tone contrast in -1..1 for the window starting at `start`.
fn sync_ratio(samples: &[f32], start: usize, nw: usize, g: &Goertzel, buf: &mut [f32; 2]) -> f32 {
    match samples.get(start..start + nw) {
        Some(w) => {
            g.powers(w, buf);
            let (lo, hi) = (buf[0], buf[1]);
            (hi - lo) / (hi + lo + 1e-9)
        }
        None => 0.0,
    }
}

fn barker_score(samples: &[f32], w: usize, t: &Timing, g: &Goertzel, buf: &mut [f32; 2]) -> f32 {
    let mut acc = 0.0f32;
    for (k, &chip) in BARKER13.iter().enumerate() {
        let x = w + (k as f64 * t.ns).round() as usize;
        acc += chip as f32 * sync_ratio(samples, x, t.nw, g, buf);
    }
    acc / BARKER13.len() as f32
}

/// Finds the preamble and returns `(t0, score)` where `t0` is the sample index
/// of the first Barker symbol.
fn find_preamble(samples: &[f32], sample_rate: u32, t: &Timing, band: &Band) -> Result<(usize, f32), GhostError> {
    let g = Goertzel::new(&[band.low, band.high], sample_rate);
    let mut buf = [0.0f32; 2];
    let needed = ((BARKER13.len() + GUARD_SYMBOLS + 24) as f64 * t.ns).ceil() as usize;
    if samples.len() < needed + t.nw {
        return Err(GhostError::FskTooShort);
    }
    let last_w = samples.len() - needed;

    // Coarse pass: ratio on a grid of `step` samples, correlated by lookup.
    let step = ((t.ns / 8.0).floor() as usize).max(1);
    let grid_len = last_w / step + 1;
    let ratio_len = (samples.len().saturating_sub(t.nw)) / step + 1;
    let mut ratios = Vec::with_capacity(ratio_len);
    for i in 0..ratio_len {
        ratios.push(sync_ratio(samples, i * step, t.nw, &g, &mut buf));
    }
    let mut best_idx = 0usize;
    let mut best = f32::MIN;
    for i in 0..grid_len {
        let mut acc = 0.0f32;
        for (k, &chip) in BARKER13.iter().enumerate() {
            let j = i + (k as f64 * t.ns / step as f64).round() as usize;
            acc += chip as f32 * ratios.get(j).copied().unwrap_or(0.0);
        }
        let score = acc / BARKER13.len() as f32;
        if score > best {
            best = score;
            best_idx = i;
        }
    }
    if best < PREAMBLE_THRESHOLD * 0.8 {
        return Err(GhostError::FskNoPreamble);
    }

    // Fine pass: 1-sample resolution, then centre of the score plateau.
    let radius = (t.ns / 3.0).ceil() as usize;
    let centre = best_idx * step;
    let lo = centre.saturating_sub(radius);
    let hi = (centre + radius).min(last_w);
    let mut scores = Vec::with_capacity(hi - lo + 1);
    for w in lo..=hi {
        scores.push(barker_score(samples, w, t, &g, &mut buf));
    }
    let (arg, peak) = scores
        .iter()
        .copied()
        .enumerate()
        .fold((0usize, f32::MIN), |acc, (i, s)| if s > acc.1 { (i, s) } else { acc });
    if peak < PREAMBLE_THRESHOLD {
        return Err(GhostError::FskNoPreamble);
    }
    let tol = 0.03f32.max(peak * 0.03);
    let mut left = arg;
    while left > 0 && scores.get(left - 1).copied().unwrap_or(f32::MIN) >= peak - tol {
        left -= 1;
    }
    let mut right = arg;
    while scores.get(right + 1).copied().unwrap_or(f32::MIN) >= peak - tol {
        right += 1;
    }
    let w_best = lo + (left + right) / 2;
    let t0 = w_best.saturating_sub(t.margin);
    Ok((t0, peak))
}

/// Loop gain of the early-late symbol timing tracker.
const TIMING_GAIN: f64 = 0.35;

struct SymbolReader<'a> {
    samples: &'a [f32],
    t: Timing,
    t0: usize,
    g: Goertzel,
    next: usize,
    /// Accumulated timing correction in samples (clock drift between devices).
    offset: f64,
    snr_sum: f32,
    snr_min: f32,
    count: usize,
    end: usize,
}

impl<'a> SymbolReader<'a> {
    /// Power of tone `tone` over the analysis window starting at `start`.
    fn tone_power(&self, start: usize, tone: usize) -> Option<f32> {
        let window = self.samples.get(start..start.checked_add(self.t.nw)?)?;
        self.g.power(window, tone)
    }

    fn read_byte(&mut self) -> Result<u8, GhostError> {
        let mut byte = 0u8;
        for _ in 0..4 {
            let nominal = self.t0 as f64 + self.next as f64 * self.t.ns + self.offset;
            let start = (nominal.round().max(0.0) as usize).saturating_add(self.t.margin);
            let window = self
                .samples
                .get(start..start + self.t.nw)
                .ok_or(GhostError::FskTooShort)?;
            let mut p = [0.0f32; 4];
            self.g.powers(window, &mut p);
            let (mut best, mut best_p) = (0usize, f32::MIN);
            for (i, &v) in p.iter().enumerate() {
                if v > best_p {
                    best = i;
                    best_p = v;
                }
            }

            // Early-late gate: shift the window by the full margin each way.
            // If symbols arrive later than predicted, the early window reaches
            // into the previous symbol and loses power (and vice versa).
            let m = self.t.margin;
            if m > 0 {
                let early = start.checked_sub(m).and_then(|s| self.tone_power(s, best));
                let late = self.tone_power(start + m, best);
                if let (Some(e), Some(l)) = (early, late) {
                    let sum = e + l;
                    if sum > 1e-9 {
                        let err = ((l - e) / sum) as f64;
                        self.offset += TIMING_GAIN * err * m as f64;
                    }
                }
            }
            let others = (p.iter().sum::<f32>() - best_p) / 3.0;
            let snr = 10.0 * ((best_p + 1e-12) / (others + 1e-12)).log10();
            self.snr_sum += snr;
            self.snr_min = self.snr_min.min(snr);
            self.count += 1;
            let bits = GRAY.get(best).copied().unwrap_or(0) as u8;
            byte = (byte << 2) | bits;
            self.next += 1;
            self.end = start + self.t.nw;
        }
        Ok(byte)
    }

    fn read_bytes(&mut self, n: usize) -> Result<Vec<u8>, GhostError> {
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            out.push(self.read_byte()?);
        }
        Ok(out)
    }
}

/// Locates and decodes one burst in `samples`.
pub fn demodulate(samples: &[f32], sample_rate: u32, mode: FskMode) -> Result<FskDecodeResult, GhostError> {
    if samples.len() > MAX_SAMPLES {
        return Err(GhostError::TooManySamples { len: samples.len() });
    }
    let t = timing(sample_rate, mode)?;
    let (t0, score) = find_preamble(samples, sample_rate, &t, &mode.band())?;
    decode_from(samples, sample_rate, t, t0, score, mode).map_err(|e| match e {
        GhostError::FskTooShort => GhostError::FskIncomplete { sync_offset: t0 },
        other => other,
    })
}

fn decode_from(
    samples: &[f32],
    sample_rate: u32,
    t: Timing,
    t0: usize,
    score: f32,
    mode: FskMode,
) -> Result<FskDecodeResult, GhostError> {

    let mut reader = SymbolReader {
        samples,
        t,
        t0,
        g: Goertzel::new(&mode.band().data, sample_rate),
        next: BARKER13.len() + GUARD_SYMBOLS,
        offset: 0.0,
        snr_sum: 0.0,
        snr_min: f32::MAX,
        count: 0,
        end: 0,
    };

    let header_cw = reader.read_bytes(HEADER_BYTES + HEADER_PARITY)?;
    let (header, mut corrected) = fec::decode(&header_cw, HEADER_PARITY)?;
    let len = match header.as_slice() {
        [hi, lo] => u16::from_be_bytes([*hi, *lo]) as usize,
        _ => return Err(GhostError::FecUncorrectable),
    };
    if len == 0 || len > mode.max_frame() {
        return Err(GhostError::FskInvalidLength { len });
    }

    let mut frame = Vec::with_capacity(len);
    for size in chunk_sizes(len) {
        let cw = reader.read_bytes(size + DATA_PARITY)?;
        let (data, fixed) = fec::decode(&cw, DATA_PARITY)?;
        corrected += fixed;
        frame.extend_from_slice(&data);
    }

    let count = reader.count.max(1);
    Ok(FskDecodeResult {
        frame_len: frame.len(),
        frame,
        sync_offset: t0,
        preamble_score: score,
        mean_symbol_snr_db: reader.snr_sum / count as f32,
        min_symbol_snr_db: if reader.snr_min == f32::MAX { 0.0 } else { reader.snr_min },
        corrected_bytes: corrected,
        symbols: reader.count,
        end_offset: reader.end,
    })
}

/// Hann-windowed magnitude spectrum (dB) for the spectrogram.
pub struct SpectrumAnalyzer {
    size: usize,
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    buffer: Vec<Complex<f32>>,
}

impl SpectrumAnalyzer {
    pub fn new(size: usize) -> Result<Self, GhostError> {
        if !(64..=8192).contains(&size) || !size.is_power_of_two() {
            return Err(GhostError::InvalidArgument { what: "fft size" });
        }
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(size);
        let window = (0..size)
            .map(|i| {
                let x = 2.0 * std::f32::consts::PI * i as f32 / (size - 1) as f32;
                0.5 - 0.5 * x.cos()
            })
            .collect();
        Ok(SpectrumAnalyzer {
            size,
            fft,
            window,
            buffer: vec![Complex::new(0.0, 0.0); size],
        })
    }

    /// Uses the last `size` samples (zero-padded at the front if shorter) and
    /// returns `size / 2` magnitudes in dBFS.
    pub fn compute(&mut self, samples: &[f32]) -> Vec<f32> {
        let start = samples.len().saturating_sub(self.size);
        let tail = samples.get(start..).unwrap_or(&[]);
        let pad = self.size - tail.len();
        for (i, slot) in self.buffer.iter_mut().enumerate() {
            let x = if i < pad {
                0.0
            } else {
                tail.get(i - pad).copied().unwrap_or(0.0)
            };
            let w = self.window.get(i).copied().unwrap_or(0.0);
            *slot = Complex::new(x * w, 0.0);
        }
        self.fft.process(&mut self.buffer);
        let norm = 2.0 / (self.size as f32 * 0.5);
        self.buffer
            .iter()
            .take(self.size / 2)
            .map(|c| 20.0 * (c.norm() * norm + 1e-9).log10())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_frame(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 37 + 11) as u8).collect()
    }

    #[test]
    fn clean_roundtrip_fast_48k() {
        let frame = sample_frame(220);
        let pcm = modulate(&frame, 48_000, FskMode::Fast).unwrap();
        let res = demodulate(&pcm, 48_000, FskMode::Fast).unwrap();
        assert_eq!(res.frame, frame);
        assert_eq!(res.corrected_bytes, 0);
        assert!(res.preamble_score > 0.9);
    }

    #[test]
    fn roundtrip_with_offset_and_44k1() {
        let frame = sample_frame(300);
        let pcm = modulate(&frame, 44_100, FskMode::Robust).unwrap();
        let mut padded = vec![0.0f32; 12_345];
        padded.extend_from_slice(&pcm);
        padded.extend(std::iter::repeat_n(0.0, 5_000));
        let res = demodulate(&padded, 44_100, FskMode::Robust).unwrap();
        assert_eq!(res.frame, frame);
        assert!((res.sync_offset as i64 - (12_345 + 662) as i64).abs() < 40);
    }

    #[test]
    fn silence_has_no_preamble() {
        let silence = vec![0.0f32; 48_000];
        assert_eq!(
            demodulate(&silence, 48_000, FskMode::Fast).unwrap_err(),
            GhostError::FskNoPreamble
        );
    }

    #[test]
    fn spectrum_peaks_at_tone() {
        let fs = 48_000.0f32;
        let tone: Vec<f32> = (0..2048)
            .map(|i| (2.0 * std::f32::consts::PI * 2400.0 * i as f32 / fs).sin())
            .collect();
        let mut sa = SpectrumAnalyzer::new(1024).unwrap();
        let mag = sa.compute(&tone);
        let peak = mag
            .iter()
            .enumerate()
            .fold((0, f32::MIN), |a, (i, &m)| if m > a.1 { (i, m) } else { a })
            .0;
        let hz = peak as f32 * fs / 1024.0;
        assert!((hz - 2400.0).abs() < 50.0, "peak at {hz} Hz");
    }

    #[test]
    fn ultrasonic_roundtrip_in_noise_at_48k_and_44k1() {
        let frame = sample_frame(180);
        for (fs, seed) in [(48_000u32, 7u64), (44_100, 8)] {
            let pcm = modulate(&frame, fs, FskMode::Ultrasonic).unwrap();
            let mut padded = vec![0.0f32; 7_000];
            padded.extend_from_slice(&pcm);
            padded.extend(std::iter::repeat_n(0.0, 3_000));
            let noisy = crate::channel_sim::inject_awgn(&padded, 10.0, seed);
            let res = demodulate(&noisy, fs, FskMode::Ultrasonic).unwrap();
            assert_eq!(res.frame, frame, "{fs} Hz");
        }
        // 400 bit/s: a 180-byte frame lasts under 5 s.
        assert!(burst_seconds(180, FskMode::Ultrasonic) < 5.0);
    }

    #[test]
    fn ultrasonic_burst_stays_above_17khz() {
        let pcm = modulate(&sample_frame(120), 48_000, FskMode::Ultrasonic).unwrap();
        let mut sa = SpectrumAnalyzer::new(1024).unwrap();
        // Skip the ramped lead symbol; compare audible and ultrasonic energy.
        let (mut audible, mut ultra) = (0.0f64, 0.0f64);
        for chunk in pcm[480..].chunks_exact(1024).take(40) {
            let mag = sa.compute(chunk);
            for (i, &db) in mag.iter().enumerate() {
                let hz = i as f32 * 48_000.0 / 1024.0;
                let p = 10f64.powf(db as f64 / 10.0);
                if hz < 16_000.0 {
                    audible += p;
                } else {
                    ultra += p;
                }
            }
        }
        let ratio_db = 10.0 * (audible / ultra).log10();
        assert!(ratio_db < -30.0, "audible band only {ratio_db:.1} dB below the signal");
    }

    #[test]
    fn ultrasonic_refuses_low_rates_and_long_frames() {
        assert_eq!(modulate(&sample_frame(10), 32_000, FskMode::Ultrasonic).unwrap_err(), GhostError::InvalidSampleRate { rate: 32_000 });
        assert!(matches!(modulate(&sample_frame(ULTRASONIC_MAX_FRAME + 1), 48_000, FskMode::Ultrasonic).unwrap_err(), GhostError::FskInvalidLength { .. }));
        assert!(modulate(&sample_frame(ULTRASONIC_MAX_FRAME), 48_000, FskMode::Ultrasonic).is_ok());
    }
}
