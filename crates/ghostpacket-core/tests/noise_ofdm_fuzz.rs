//! Acoustic OFDM under white noise, room echo and clock drift between devices.

use ghostpacket_core::channel_sim::inject_awgn;
use ghostpacket_core::ofdm::{demodulate, modulate};

const FS: u32 = 48_000;

fn frame(len: usize, salt: usize) -> Vec<u8> {
    (0..len).map(|i| ((i * 131 + salt * 17) ^ (i >> 3)) as u8).collect()
}

/// Receiver clock off by `ppm`: resample by linear interpolation.
fn drift(x: &[f32], ppm: f64) -> Vec<f32> {
    let ratio = 1.0 + ppm * 1e-6;
    let n = (x.len() as f64 / ratio) as usize;
    (0..n)
        .map(|i| {
            let t = i as f64 * ratio;
            let k = t.floor() as usize;
            let f = (t - k as f64) as f32;
            let a = x.get(k).copied().unwrap_or(0.0);
            let b = x.get(k + 1).copied().unwrap_or(0.0);
            a * (1.0 - f) + b * f
        })
        .collect()
}

/// Two reflections inside the cyclic prefix (≈ 1 ms and 2.2 ms) plus a weak late one.
fn echo(x: &[f32]) -> Vec<f32> {
    let mut y = x.to_vec();
    for (delay, gain) in [(48usize, 0.45f32), (106, 0.25), (300, 0.06)] {
        for i in delay..y.len() {
            y[i] += gain * x[i - delay];
        }
    }
    y
}

fn with_silence(x: Vec<f32>) -> Vec<f32> {
    let mut out = vec![0.0; 9_000];
    out.extend(x);
    out.extend(std::iter::repeat_n(0.0, 4_000));
    out
}

#[test]
fn decodes_at_12_db_snr_and_above() {
    for (i, snr) in [12.0f32, 15.0, 20.0].iter().enumerate() {
        for trial in 0..4 {
            let f = frame(1500, i * 10 + trial);
            let noisy = inject_awgn(&with_silence(modulate(&f, FS).unwrap()), *snr, (i * 100 + trial) as u64);
            let r = demodulate(&noisy, FS).unwrap_or_else(|e| panic!("snr {snr} trial {trial}: {e}"));
            assert_eq!(r.frame, f, "snr {snr} trial {trial}");
        }
    }
}

#[test]
fn survives_room_echo_at_15_db() {
    for trial in 0..4 {
        let f = frame(2000, trial);
        let x = inject_awgn(&echo(&with_silence(modulate(&f, FS).unwrap())), 15.0, trial as u64 + 7);
        assert_eq!(demodulate(&x, FS).unwrap().frame, f, "trial {trial}");
    }
}

#[test]
fn tracks_clock_drift_between_devices() {
    // A 16 KB frame lasts ≈ 33 s: at 300 ppm the clock slips ≈ 480 samples,
    // far beyond the 128-sample cyclic prefix without tracking.
    for ppm in [-300.0f64, -100.0, 100.0, 300.0] {
        let f = frame(16 * 1024, ppm.abs() as usize);
        let x = inject_awgn(&drift(&echo(&with_silence(modulate(&f, FS).unwrap())), ppm), 18.0, ppm.abs() as u64);
        let r = demodulate(&x, FS).unwrap_or_else(|e| panic!("{ppm} ppm: {e}"));
        assert_eq!(r.frame, f, "{ppm} ppm");
        assert!(r.timing_drift_samples.abs() > 50.0, "tracker should have followed the slip ({ppm} ppm: {})", r.timing_drift_samples);
    }
}

#[test]
fn quiet_receiver_and_loud_clipping() {
    let f = frame(1200, 3);
    let pcm = with_silence(modulate(&f, FS).unwrap());
    // 30 dB quieter (far phone) and hard-clipped at 0.35 (cheap speaker).
    let quiet: Vec<f32> = pcm.iter().map(|x| x * 0.03).collect();
    assert_eq!(demodulate(&inject_awgn(&quiet, 18.0, 1), FS).unwrap().frame, f);
    let clipped: Vec<f32> = pcm.iter().map(|x| x.clamp(-0.35, 0.35)).collect();
    assert_eq!(demodulate(&clipped, FS).unwrap().frame, f);
}
