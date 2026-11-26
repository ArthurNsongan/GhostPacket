//! Acoustic OFDM modem ("Spectral Chord"): about 4 kbit/s over a speaker, the
//! fast acoustic path for GPKT v2 frames (up to `OFDM_MAX_FRAME` bytes).
//!
//! ```text
//! [chirp 1.2 → 7.2 kHz, 43 ms] [gap N/2] [reference symbol] [2 header symbols] [data symbols] [tail]
//! symbol = cyclic prefix (N/4 samples) + N = 512 samples (13.3 ms at 48 kHz)
//! 32 data subcarriers, one every 2 FFT bins from ≈ 1.5 kHz (≈ 1.5–7.4 kHz at 48 kHz)
//! differential QPSK in time on each subcarrier (no channel estimation needed:
//! the room's gain and phase per frequency cancel between consecutive symbols)
//! header: u32 BE frame length, Reed-Solomon (16, 4)
//! data: frame padded to whole RS(255, 223) codewords, byte-interleaved
//! ```
//! Sync: matched filter on the chirp (FFT overlap-save, normalised score).
//! Timing: the residual phase slope across subcarriers after each decision
//! measures the sampling-clock slip; the FFT window follows it, so ±300 ppm
//! between two devices keeps the window inside the cyclic prefix.

use std::f32::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use serde::Serialize;

use crate::error::GhostError;
use crate::fec;
use crate::fountain::Xorshift64Star;
use crate::fsk::MAX_SAMPLES;

pub const N: usize = 512;
pub const CP: usize = N / 4;
pub const SYMBOL: usize = N + CP;
pub const CARRIERS: usize = 32;
pub const BITS_PER_SYMBOL: usize = CARRIERS * 2;
const BYTES_PER_SYMBOL: usize = BITS_PER_SYMBOL / 8;
pub const FIRST_HZ: f32 = 1500.0;
pub const CHIRP_F0: f32 = 1200.0;
pub const CHIRP_F1: f32 = 7200.0;
pub const CHIRP_SECONDS: f32 = 0.0427;
const HEADER_DATA: usize = 4;
const HEADER_PARITY: usize = 12;
const HEADER_SYMBOLS: usize = (HEADER_DATA + HEADER_PARITY).div_ceil(BYTES_PER_SYMBOL);
const RS_DATA: usize = 223;
const RS_PARITY: usize = 32;
/// Largest frame the modem accepts (≈ 33 s of audio at 48 kHz, under MAX_SAMPLES).
pub const OFDM_MAX_FRAME: usize = 16 * 1024;
pub const MIN_SAMPLE_RATE: u32 = 16_000;
pub const MAX_SAMPLE_RATE: u32 = 48_000;
pub const AMPLITUDE: f32 = 0.7;
/// Minimum normalised chirp correlation to accept a preamble.
pub const PREAMBLE_THRESHOLD: f32 = 0.4;
/// Smoothing of the measured clock-slip rate (samples per symbol).
const RATE_SMOOTHING: f32 = 0.15;

/// Gray mapping of 2 bits to a phase step in quarter turns.
const GRAY: [u8; 4] = [0, 1, 3, 2];

struct Geometry {
    bins: [usize; CARRIERS],
    chirp: Vec<f32>,
}

fn geometry(sample_rate: u32) -> Result<Geometry, GhostError> {
    if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
        return Err(GhostError::InvalidSampleRate { rate: sample_rate });
    }
    let fs = sample_rate as f32;
    let first = (FIRST_HZ * N as f32 / fs).round() as usize;
    let mut bins = [0usize; CARRIERS];
    for (i, b) in bins.iter_mut().enumerate() {
        *b = first + 2 * i;
    }
    let len = (CHIRP_SECONDS * fs).round() as usize;
    let t_total = len as f32 / fs;
    let chirp = (0..len)
        .map(|i| {
            let t = i as f32 / fs;
            let phase = 2.0 * PI * (CHIRP_F0 * t + (CHIRP_F1 - CHIRP_F0) * t * t / (2.0 * t_total));
            // Tukey taper on 10 % at each end.
            let edge = (len / 10).max(1);
            let w = if i < edge {
                0.5 - 0.5 * (PI * i as f32 / edge as f32).cos()
            } else if i + edge > len {
                0.5 - 0.5 * (PI * (len - i) as f32 / edge as f32).cos()
            } else {
                1.0
            };
            w * phase.sin()
        })
        .collect();
    Ok(Geometry { bins, chirp })
}

fn codewords(frame_len: usize) -> usize {
    frame_len.div_ceil(RS_DATA)
}

fn data_symbols(frame_len: usize) -> usize {
    (codewords(frame_len) * (RS_DATA + RS_PARITY) * 8).div_ceil(BITS_PER_SYMBOL)
}

fn burst_samples(frame_len: usize, sample_rate: u32) -> usize {
    let chirp = (CHIRP_SECONDS * sample_rate as f32).round() as usize;
    chirp + N / 2 + (1 + HEADER_SYMBOLS + data_symbols(frame_len)) * SYMBOL + N / 4
}

/// Burst duration in seconds.
pub fn burst_seconds(frame_len: usize, sample_rate: u32) -> f64 {
    burst_samples(frame_len.min(OFDM_MAX_FRAME), sample_rate) as f64 / sample_rate.max(1) as f64
}

/// Known quarter-turn phases of the reference symbol.
fn reference_phases() -> [u8; CARRIERS] {
    let mut rng = Xorshift64Star::new(0x4F46_444D);
    let mut out = [0u8; CARRIERS];
    for p in out.iter_mut() {
        *p = rng.next_below(4) as u8;
    }
    out
}

fn quarter(q: u8) -> Complex<f32> {
    match q & 3 {
        0 => Complex::new(1.0, 0.0),
        1 => Complex::new(0.0, 1.0),
        2 => Complex::new(-1.0, 0.0),
        _ => Complex::new(0.0, -1.0),
    }
}

fn interleave(cws: &[Vec<u8>]) -> Vec<u8> {
    let len = cws.first().map(|c| c.len()).unwrap_or(0);
    let mut out = Vec::with_capacity(len * cws.len());
    for i in 0..len {
        for cw in cws {
            out.push(cw.get(i).copied().unwrap_or(0));
        }
    }
    out
}

fn to_dibits(bytes: &[u8], out: &mut Vec<u8>) {
    for b in bytes {
        for s in [6u32, 4, 2, 0] {
            out.push((b >> s) & 3);
        }
    }
}

struct Synth {
    ifft: Arc<dyn Fft<f32>>,
    buf: Vec<Complex<f32>>,
}

impl Synth {
    fn symbol(&mut self, bins: &[usize; CARRIERS], phases: &[u8; CARRIERS], out: &mut Vec<f32>) {
        for c in self.buf.iter_mut() {
            *c = Complex::new(0.0, 0.0);
        }
        for (b, &q) in bins.iter().zip(phases.iter()) {
            if let Some(slot) = self.buf.get_mut(*b) {
                *slot = quarter(q);
            }
            // Hermitian mirror: real time signal.
            if let Some(slot) = self.buf.get_mut(N - *b) {
                *slot = quarter(q).conj();
            }
        }
        self.ifft.process(&mut self.buf);
        let body: Vec<f32> = self.buf.iter().map(|c| c.re / N as f32).collect();
        out.extend_from_slice(body.get(N - CP..).unwrap_or(&[]));
        out.extend_from_slice(&body);
    }
}

/// PCM burst (mono f32, peak `AMPLITUDE`) for `frame`.
pub fn modulate(frame: &[u8], sample_rate: u32) -> Result<Vec<f32>, GhostError> {
    if frame.is_empty() || frame.len() > OFDM_MAX_FRAME {
        return Err(GhostError::OfdmInvalidLength { len: frame.len() });
    }
    let g = geometry(sample_rate)?;
    let total = burst_samples(frame.len(), sample_rate);
    if total > MAX_SAMPLES {
        return Err(GhostError::TooManySamples { len: total });
    }

    // Coded bytes: header symbols, then interleaved data codewords.
    let len32 = u32::try_from(frame.len()).map_err(|_| GhostError::OfdmInvalidLength { len: frame.len() })?;
    let header = fec::encode(&len32.to_be_bytes(), HEADER_PARITY)?;
    let mut cws = Vec::with_capacity(codewords(frame.len()));
    for chunk in frame.chunks(RS_DATA) {
        let mut c = chunk.to_vec();
        c.resize(RS_DATA, 0);
        cws.push(fec::encode(&c, RS_PARITY)?);
    }
    let mut header_dibits = Vec::new();
    to_dibits(&header, &mut header_dibits);
    header_dibits.resize(HEADER_SYMBOLS * CARRIERS, 0);
    let mut data_dibits = Vec::new();
    to_dibits(&interleave(&cws), &mut data_dibits);
    data_dibits.resize(data_symbols(frame.len()) * CARRIERS, 0);

    let mut planner = FftPlanner::<f32>::new();
    let mut synth = Synth { ifft: planner.plan_fft_inverse(N), buf: vec![Complex::new(0.0, 0.0); N] };
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&g.chirp);
    out.extend(std::iter::repeat_n(0.0, N / 2));
    let mut phases = reference_phases();
    synth.symbol(&g.bins, &phases, &mut out);
    for chunk in header_dibits.chunks(CARRIERS).chain(data_dibits.chunks(CARRIERS)) {
        for (p, d) in phases.iter_mut().zip(chunk.iter()) {
            *p = (*p + GRAY.get(*d as usize).copied().unwrap_or(0)) & 3;
        }
        synth.symbol(&g.bins, &phases, &mut out);
    }
    out.extend(std::iter::repeat_n(0.0, N / 4));

    // One gain for the whole burst: OFDM peaks are spiky, the chirp is not.
    let body_peak = out.iter().skip(g.chirp.len()).fold(0.0f32, |m, x| m.max(x.abs()));
    let chirp_peak = g.chirp.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let body_gain = if body_peak > 0.0 { AMPLITUDE / body_peak } else { 1.0 };
    let chirp_gain = if chirp_peak > 0.0 { AMPLITUDE / chirp_peak } else { 1.0 };
    let chirp_len = g.chirp.len();
    for (i, x) in out.iter_mut().enumerate() {
        *x *= if i < chirp_len { chirp_gain } else { body_gain };
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfdmDecodeResult {
    #[serde(skip)]
    pub frame: Vec<u8>,
    pub frame_len: usize,
    /// Sample index where the chirp starts.
    pub sync_offset: usize,
    pub preamble_score: f32,
    /// Mean decision margin in dB (distance to the nearest QPSK boundary).
    pub mean_symbol_snr_db: f32,
    pub corrected_bytes: usize,
    pub symbols: usize,
    /// Accumulated sampling-clock slip followed by the tracker, in samples.
    pub timing_drift_samples: f32,
    pub end_offset: usize,
}

/// Matched filter on the chirp: (start sample, normalised score).
fn find_chirp(samples: &[f32], chirp: &[f32]) -> Option<(usize, f32)> {
    let m = chirp.len();
    if m == 0 || samples.len() < m {
        return None;
    }
    let l = (4 * m).next_power_of_two();
    let step = l - m + 1;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(l);
    let ifft = planner.plan_fft_inverse(l);
    let mut h: Vec<Complex<f32>> = (0..l).map(|i| Complex::new(if i < m { chirp.get(m - 1 - i).copied().unwrap_or(0.0) } else { 0.0 }, 0.0)).collect();
    fft.process(&mut h);
    let ec: f64 = chirp.iter().map(|x| (*x as f64).powi(2)).sum();

    let positions = samples.len() - m + 1;
    let mut energy: f64 = samples.get(..m).unwrap_or(&[]).iter().map(|x| (*x as f64).powi(2)).sum();
    let mut best = (0usize, f32::MIN);
    let mut buf = vec![Complex::new(0.0f32, 0.0f32); l];
    let mut n = 0usize;
    let mut block = 0usize;
    while block < positions {
        for (i, slot) in buf.iter_mut().enumerate() {
            *slot = Complex::new(samples.get(block + i).copied().unwrap_or(0.0), 0.0);
        }
        fft.process(&mut buf);
        for (b, hv) in buf.iter_mut().zip(h.iter()) {
            *b *= hv;
        }
        ifft.process(&mut buf);
        for j in 0..step {
            let pos = block + j;
            if pos >= positions {
                break;
            }
            // Running window energy, recomputed exactly now and then (no float drift).
            if pos != n {
                break;
            }
            if pos.is_multiple_of(8192) && pos > 0 {
                energy = samples.get(pos..pos + m).unwrap_or(&[]).iter().map(|x| (*x as f64).powi(2)).sum();
            }
            let corr = buf.get(j + m - 1).map(|c| c.re / l as f32).unwrap_or(0.0) as f64;
            let score = if energy > 1e-12 { (corr / (energy * ec).sqrt()) as f32 } else { 0.0 };
            if score > best.1 {
                best = (pos, score);
            }
            let out_x = samples.get(pos).copied().unwrap_or(0.0) as f64;
            let in_x = samples.get(pos + m).copied().unwrap_or(0.0) as f64;
            energy = (energy - out_x * out_x + in_x * in_x).max(0.0);
            n += 1;
        }
        block += step;
    }
    Some(best)
}

struct Demod<'a> {
    samples: &'a [f32],
    bins: [usize; CARRIERS],
    fft: Arc<dyn Fft<f32>>,
    buf: Vec<Complex<f32>>,
    prev: [Complex<f32>; CARRIERS],
    /// Start of symbol 0 (the reference symbol), in samples.
    base: usize,
    next: usize,
    shift: i64,
    slip: f32,
    /// Smoothed slip rate in samples per symbol (sampling-clock offset × SYMBOL).
    rate: f32,
    drift_total: f32,
    margin_sum: f32,
    count: usize,
    end: usize,
}

impl Demod<'_> {
    fn spectrum(&mut self, symbol: usize) -> Result<[Complex<f32>; CARRIERS], GhostError> {
        let start = (self.base + symbol * SYMBOL + CP / 2) as i64 + self.shift;
        if start < 0 {
            return Err(GhostError::OfdmIncomplete { sync_offset: self.base });
        }
        let start = start as usize;
        let window = self.samples.get(start..start + N).ok_or(GhostError::OfdmIncomplete { sync_offset: self.base })?;
        for (slot, x) in self.buf.iter_mut().zip(window.iter()) {
            *slot = Complex::new(*x, 0.0);
        }
        self.fft.process(&mut self.buf);
        self.end = start + N;
        let mut out = [Complex::new(0.0, 0.0); CARRIERS];
        for (o, b) in out.iter_mut().zip(self.bins.iter()) {
            *o = self.buf.get(*b).copied().unwrap_or_default();
        }
        Ok(out)
    }

    fn reference(&mut self) -> Result<(), GhostError> {
        self.prev = self.spectrum(0)?;
        self.next = 1;
        Ok(())
    }

    /// Decodes the next symbol into 32 dibits and updates the timing tracker.
    fn read_symbol(&mut self, out: &mut Vec<u8>) -> Result<(), GhostError> {
        let cur = self.spectrum(self.next)?;
        self.next += 1;
        let mut residual = [0.0f32; CARRIERS];
        for i in 0..CARRIERS {
            let (c, p) = (cur[i], self.prev[i]);
            let d = c * p.conj();
            let angle = d.im.atan2(d.re);
            let q = ((angle / (PI / 2.0)).round() as i32).rem_euclid(4) as u8;
            let dibit = GRAY.iter().position(|&g| g == q).unwrap_or(0) as u8;
            out.push(dibit);
            let mut r = angle - q as f32 * PI / 2.0;
            if r > PI {
                r -= 2.0 * PI;
            }
            if r < -PI {
                r += 2.0 * PI;
            }
            residual[i] = r;
            self.margin_sum += (PI / 4.0 - r.abs()).max(1e-3) / (PI / 4.0);
            self.count += 1;
        }
        // Least-squares slope of the residual phase against the bin index.
        let ks: Vec<f32> = self.bins.iter().map(|&b| b as f32).collect();
        let mk = ks.iter().sum::<f32>() / CARRIERS as f32;
        let mr = residual.iter().sum::<f32>() / CARRIERS as f32;
        let (mut num, mut den) = (0.0f32, 0.0f32);
        for (k, r) in ks.iter().zip(residual.iter()) {
            num += (k - mk) * (r - mr);
            den += (k - mk) * (k - mk);
        }
        let slope = if den > 0.0 { num / den } else { 0.0 };
        // Consecutive symbols differ by the slip *rate*: a phase slope −2πδ/N means
        // the signal arrives δ samples later per symbol. Integrate the smoothed rate.
        let delta = -slope * N as f32 / (2.0 * PI);
        self.rate += RATE_SMOOTHING * (delta - self.rate);
        self.slip += self.rate;
        self.prev = cur;
        if self.slip.abs() >= 1.0 {
            let step = self.slip.round();
            self.slip -= step;
            self.shift += step as i64;
            self.drift_total += step;
            // Keep the differential reference consistent with the moved window.
            for (p, k) in self.prev.iter_mut().zip(self.bins.iter()) {
                let phi = 2.0 * PI * *k as f32 * step / N as f32;
                *p *= Complex::new(phi.cos(), phi.sin());
            }
        }
        Ok(())
    }

    fn read_bytes(&mut self, symbols: usize) -> Result<Vec<u8>, GhostError> {
        let mut dibits = Vec::with_capacity(symbols * CARRIERS);
        for _ in 0..symbols {
            self.read_symbol(&mut dibits)?;
        }
        Ok(dibits.chunks(4).map(|c| c.iter().fold(0u8, |acc, d| (acc << 2) | (d & 3))).collect())
    }
}

/// Locates and decodes one OFDM burst.
pub fn demodulate(samples: &[f32], sample_rate: u32) -> Result<OfdmDecodeResult, GhostError> {
    if samples.len() > MAX_SAMPLES {
        return Err(GhostError::TooManySamples { len: samples.len() });
    }
    let g = geometry(sample_rate)?;
    let (t0, score) = find_chirp(samples, &g.chirp).ok_or(GhostError::OfdmNoPreamble)?;
    if score < PREAMBLE_THRESHOLD {
        return Err(GhostError::OfdmNoPreamble);
    }
    let mut planner = FftPlanner::<f32>::new();
    let mut d = Demod {
        samples,
        bins: g.bins,
        fft: planner.plan_fft_forward(N),
        buf: vec![Complex::new(0.0, 0.0); N],
        prev: [Complex::new(0.0, 0.0); CARRIERS],
        base: t0 + g.chirp.len() + N / 2,
        next: 0,
        shift: 0,
        slip: 0.0,
        rate: 0.0,
        drift_total: 0.0,
        margin_sum: 0.0,
        count: 0,
        end: 0,
    };
    let incomplete = |e: GhostError| match e {
        GhostError::OfdmIncomplete { .. } => GhostError::OfdmIncomplete { sync_offset: t0 },
        other => other,
    };
    d.reference().map_err(incomplete)?;
    let header = d.read_bytes(HEADER_SYMBOLS).map_err(incomplete)?;
    let (len_bytes, mut corrected) = fec::decode(header.get(..HEADER_DATA + HEADER_PARITY).unwrap_or(&[]), HEADER_PARITY)?;
    let len = match len_bytes.as_slice() {
        [a, b, c, e] => u32::from_be_bytes([*a, *b, *c, *e]) as usize,
        _ => return Err(GhostError::FecUncorrectable),
    };
    if len == 0 || len > OFDM_MAX_FRAME {
        return Err(GhostError::OfdmInvalidLength { len });
    }
    let n_cw = codewords(len);
    let coded = d.read_bytes(data_symbols(len)).map_err(incomplete)?;
    let mut cws: Vec<Vec<u8>> = (0..n_cw).map(|_| Vec::with_capacity(RS_DATA + RS_PARITY)).collect();
    for (i, b) in coded.iter().enumerate().take(n_cw * (RS_DATA + RS_PARITY)) {
        if let Some(cw) = cws.get_mut(i % n_cw) {
            cw.push(*b);
        }
    }
    let mut frame = Vec::with_capacity(n_cw * RS_DATA);
    for cw in &cws {
        let (data, fixed) = fec::decode(cw, RS_PARITY)?;
        corrected += fixed;
        frame.extend_from_slice(&data);
    }
    frame.truncate(len);
    let margin = d.margin_sum / d.count.max(1) as f32;
    Ok(OfdmDecodeResult {
        frame_len: frame.len(),
        frame,
        sync_offset: t0,
        preamble_score: score,
        mean_symbol_snr_db: 20.0 * margin.max(1e-3).log10() + 20.0,
        corrected_bytes: corrected,
        symbols: d.next,
        timing_drift_samples: d.drift_total + d.slip,
        end_offset: d.end,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 37 + 11) as u8).collect()
    }

    #[test]
    fn clean_roundtrip_48k_and_rate() {
        let f = frame(2048);
        let pcm = modulate(&f, 48_000).unwrap();
        let mut padded = vec![0.0f32; 7_777];
        padded.extend_from_slice(&pcm);
        let r = demodulate(&padded, 48_000).unwrap();
        assert_eq!(r.frame, f);
        assert_eq!(r.corrected_bytes, 0);
        assert!((r.sync_offset as i64 - 7_777).abs() <= 2, "{}", r.sync_offset);
        // ≈ 4 kbit/s of payload: 2 KB in ≈ 4.4 s.
        let secs = burst_seconds(2048, 48_000);
        assert!(secs < 5.0, "{secs}");
    }

    #[test]
    fn roundtrip_44k1() {
        let f = frame(700);
        let pcm = modulate(&f, 44_100).unwrap();
        assert_eq!(demodulate(&pcm, 44_100).unwrap().frame, f);
    }

    #[test]
    fn silence_and_truncation() {
        assert_eq!(demodulate(&vec![0.0; 48_000], 48_000).unwrap_err(), GhostError::OfdmNoPreamble);
        let pcm = modulate(&frame(1000), 48_000).unwrap();
        let cut = &pcm[..pcm.len() / 2];
        assert!(matches!(demodulate(cut, 48_000).unwrap_err(), GhostError::OfdmIncomplete { .. }));
        assert!(modulate(&frame(OFDM_MAX_FRAME + 1), 48_000).is_err());
        assert!(modulate(&frame(10), 96_000).is_err());
    }
}
