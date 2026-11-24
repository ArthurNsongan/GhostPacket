//! Deterministic channel impairments for the demo and the fuzz tests.

use crate::error::GhostError;
use crate::fountain::Xorshift64Star;
use crate::fsk::AMPLITUDE;

/// Adds white Gaussian noise so that signal power / noise power = `snr_db`.
/// Signal power is measured on the input; silence uses the modem's tone power.
pub fn inject_awgn(samples: &[f32], snr_db: f32, seed: u64) -> Vec<f32> {
    let n = samples.len().max(1) as f64;
    let measured: f64 = samples.iter().map(|&x| (x as f64) * (x as f64)).sum::<f64>() / n;
    let reference = (AMPLITUDE as f64) * (AMPLITUDE as f64) / 2.0;
    let power = if measured > 1e-12 { measured } else { reference };
    let sigma = (power / 10f64.powf(snr_db as f64 / 10.0)).sqrt();

    let mut rng = Xorshift64Star::new(seed);
    let mut out = Vec::with_capacity(samples.len());
    let mut spare: Option<f64> = None;
    for &x in samples {
        let g = match spare.take() {
            Some(v) => v,
            None => {
                // Box-Muller: two independent normals per pair of uniforms.
                let u1 = rng.next_unit();
                let u2 = rng.next_unit();
                let r = (-2.0 * u1.ln()).sqrt();
                let theta = 2.0 * std::f64::consts::PI * u2;
                spare = Some(r * theta.sin());
                r * theta.cos()
            }
        };
        out.push((x as f64 + sigma * g) as f32);
    }
    out
}

/// Deterministic optical loss: true if droplet `index` is lost at `drop_pct`.
pub fn is_dropped(seed: u64, index: u64, drop_pct: f32) -> bool {
    if drop_pct <= 0.0 {
        return false;
    }
    if drop_pct >= 100.0 {
        return true;
    }
    let mut rng = Xorshift64Star::new(seed ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    (rng.next_unit() * 100.0) <= drop_pct as f64
}

/// Returns a copy of `frame` with one bit inverted.
pub fn flip_bit(frame: &[u8], byte_idx: usize, bit_idx: u8) -> Result<Vec<u8>, GhostError> {
    if bit_idx > 7 {
        return Err(GhostError::InvalidArgument { what: "bit index" });
    }
    let mut out = frame.to_vec();
    let b = out
        .get_mut(byte_idx)
        .ok_or(GhostError::InvalidArgument { what: "byte index" })?;
    *b ^= 1 << bit_idx;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn awgn_matches_requested_snr() {
        let fs = 48_000.0f32;
        let tone: Vec<f32> = (0..48_000)
            .map(|i| 0.7 * (2.0 * std::f32::consts::PI * 2000.0 * i as f32 / fs).sin())
            .collect();
        let noisy = inject_awgn(&tone, 10.0, 42);
        let noise_power: f64 = tone
            .iter()
            .zip(noisy.iter())
            .map(|(a, b)| ((b - a) as f64).powi(2))
            .sum::<f64>()
            / tone.len() as f64;
        let snr = 10.0 * (0.245 / noise_power).log10();
        assert!((snr - 10.0).abs() < 0.3, "snr = {snr}");
    }

    #[test]
    fn awgn_is_deterministic() {
        let x = vec![0.1f32; 1000];
        assert_eq!(inject_awgn(&x, 6.0, 9), inject_awgn(&x, 6.0, 9));
    }

    #[test]
    fn drop_rate_is_close_to_target() {
        let lost = (0..10_000).filter(|&i| is_dropped(1, i, 30.0)).count();
        assert!((2_800..=3_200).contains(&lost), "lost = {lost}");
    }
}
