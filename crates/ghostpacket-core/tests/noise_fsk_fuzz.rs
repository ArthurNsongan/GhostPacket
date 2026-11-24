//! Acoustic channel fuzzing: white noise from 20 dB down to 6 dB SNR, random
//! leading silence, microphone gain changes and two sample rates.
//!
//! Target: 100 % decoding at SNR >= 10 dB, and >= 95 % at 6-8 dB.

mod common;

use common::*;
use ghostpacket_core::channel_sim::inject_awgn;
use ghostpacket_core::error::GhostError;
use ghostpacket_core::fountain::Xorshift64Star;
use ghostpacket_core::fsk::{demodulate, modulate, FskMode};
use ghostpacket_core::protocol::decode_and_verify_frame;

const SEEDS_PER_POINT: u64 = 8;

/// Silence + burst + silence, scaled by a random gain, then noise.
fn channel(pcm: &[f32], snr_db: f32, seed: u64, sample_rate: u32) -> (Vec<f32>, usize) {
    let mut rng = Xorshift64Star::new(seed ^ 0xA11CE);
    let lead = (rng.next_below(sample_rate as u64 / 2)) as usize; // 0-500 ms
    let gain = 0.25 + 0.75 * rng.next_unit() as f32;
    let mut s = vec![0.0f32; lead];
    s.extend(pcm.iter().map(|x| x * gain));
    s.extend(std::iter::repeat_n(0.0, sample_rate as usize / 10));
    // SNR is defined against the tone power of the burst (0.7² / 2 · gain²):
    // noise generated on silence uses that reference, then follows the gain.
    let noise = inject_awgn(&vec![0.0f32; s.len()], snr_db, seed);
    let out = s
        .iter()
        .zip(noise.iter())
        .map(|(&clean, &n)| clean + n * gain)
        .collect();
    (out, lead)
}

fn run(mode: FskMode, sample_rate: u32, snrs: &[f32], min_success: f64) {
    for (name, draft) in presets() {
        let frame = encode(draft).bytes;
        let pcm = modulate(&frame, sample_rate, mode).unwrap();
        for &snr in snrs {
            let mut ok = 0u64;
            let mut corrected = 0usize;
            for seed in 0..SEEDS_PER_POINT {
                let (rx, _) = channel(&pcm, snr, seed * 7919 + snr as u64, sample_rate);
                match demodulate(&rx, sample_rate, mode) {
                    Ok(res) if res.frame == frame => {
                        decode_and_verify_frame(&res.frame, &[]).expect("verified");
                        corrected += res.corrected_bytes;
                        ok += 1;
                    }
                    Ok(_) => {}
                    Err(_) => {}
                }
            }
            let rate = ok as f64 / SEEDS_PER_POINT as f64;
            println!(
                "{mode:?} {sample_rate} Hz {name:<12} SNR {snr:>5.1} dB: {ok}/{SEEDS_PER_POINT} ok, {corrected} RS bytes fixed"
            );
            assert!(
                rate >= min_success,
                "{name} at {snr} dB: success {rate:.2} < {min_success}"
            );
        }
    }
}

#[test]
fn fast_mode_is_error_free_down_to_10_db() {
    run(FskMode::Fast, 48_000, &[20.0, 15.0, 12.0, 10.0], 1.0);
}

#[test]
fn fast_mode_survives_6_to_8_db() {
    run(FskMode::Fast, 48_000, &[8.0, 6.0], 0.95);
}

#[test]
fn robust_mode_at_44k1_is_error_free_down_to_10_db() {
    run(FskMode::Robust, 44_100, &[15.0, 10.0], 1.0);
}

#[test]
fn pure_noise_never_yields_a_frame() {
    for seed in 0..10u64 {
        let silence = vec![0.0f32; 48_000 * 2];
        let noise = inject_awgn(&silence, 0.0, seed);
        let res = demodulate(&noise, 48_000, FskMode::Fast);
        assert!(
            matches!(res, Err(GhostError::FskNoPreamble) | Err(GhostError::FecUncorrectable)),
            "seed {seed}: {res:?}"
        );
    }
}

#[test]
fn truncated_burst_reports_too_short() {
    let frame = encode(tontine()).bytes;
    let pcm = modulate(&frame, 48_000, FskMode::Fast).unwrap();
    let cut = &pcm[..pcm.len() / 2];
    match demodulate(cut, 48_000, FskMode::Fast).unwrap_err() {
        GhostError::FskIncomplete { sync_offset } => {
            // Lead symbol is 6 ms = 288 samples at 48 kHz.
            assert!((sync_offset as i64 - 288).abs() < 30, "sync {sync_offset}");
        }
        other => panic!("expected FSK_INCOMPLETE, got {other:?}"),
    }
    assert_eq!(
        demodulate(&pcm[..2_000], 48_000, FskMode::Fast).unwrap_err(),
        GhostError::FskTooShort
    );
}

/// Receiver clock off by `ppm` (linear resampling), as between a PC and a phone.
fn clock_drift(x: &[f32], ppm: f64) -> Vec<f32> {
    let r = 1.0 + ppm * 1e-6;
    let n = (x.len() as f64 / r) as usize;
    (0..n)
        .map(|i| {
            let t = i as f64 * r;
            let k = t as usize;
            let f = (t - k as f64) as f32;
            x.get(k).copied().unwrap_or(0.0) * (1.0 - f) + x.get(k + 1).copied().unwrap_or(0.0) * f
        })
        .collect()
}

/// Two room reflections `(delay ms, gain)`.
fn room_echo(x: &[f32], fs: u32, reflections: [(f32, f32); 2]) -> Vec<f32> {
    let taps: Vec<(usize, f32)> = reflections
        .iter()
        .map(|&(ms, g)| ((ms * fs as f32 / 1000.0) as usize, g))
        .collect();
    (0..x.len())
        .map(|i| x[i] + taps.iter().filter(|(d, _)| i >= *d).map(|(d, g)| g * x[i - d]).sum::<f32>())
        .collect()
}

#[test]
fn survives_clock_drift_and_room_echo() {
    let rooms: [(&str, [(f32, f32); 2]); 3] = [
        ("dry", [(0.0, 0.0), (0.0, 0.0)]),
        ("room", [(3.0, 0.5), (9.0, 0.3)]),
        ("hall", [(7.0, 0.6), (20.0, 0.4)]),
    ];
    for (mode, fs) in [(FskMode::Robust, 48_000u32), (FskMode::Robust, 44_100), (FskMode::Fast, 48_000)] {
        let frame = encode(prescription()).bytes;
        let pcm = modulate(&frame, fs, mode).unwrap();
        for ppm in [-300.0, -100.0, 0.0, 100.0, 300.0] {
            for (label, refl) in rooms {
                let mut s = vec![0.0f32; 4_000];
                s.extend(clock_drift(&pcm, ppm));
                s.extend(vec![0.0; 4_000]);
                let s = room_echo(&s, fs, refl);
                let noise = inject_awgn(&vec![0.0; s.len()], 12.0, 3);
                let rx: Vec<f32> = s.iter().zip(&noise).map(|(a, b)| a + b).collect();
                let res = demodulate(&rx, fs, mode);
                assert!(
                    matches!(&res, Ok(r) if r.frame == frame),
                    "{mode:?} {fs} Hz {ppm} ppm {label}: {:?}",
                    res.map(|r| r.corrected_bytes)
                );
            }
        }
    }
}
