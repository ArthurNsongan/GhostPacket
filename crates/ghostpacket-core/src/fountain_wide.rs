//! Wide Luby Transform fountain for GPKT v2 frames (up to 131 150 bytes), carried
//! by ChromaCrypt color matrices (one droplet per displayed matrix).
//!
//! Droplet wire format (big-endian):
//! ```text
//! [Magic "GW" 2][Session 2][K 2][BlockSize 2][TotalLen 4][Seed 4][XOR data BlockSize][CRC32 4]
//! ```
//! Degrees follow an integer-only ideal soliton (bit-exact on every platform)
//! with extra degree-1/2 mass to start the peeling cascade. When peeling stalls
//! with at least K equations, Gauss-Jordan elimination over GF(2) finishes.
//! Memory is bounded: K ≤ 512, block ≤ 1024 bytes, ≤ 2·K pending equations.
//!
//! Chimera Turbo (V3) also sends droplets of the same encoder over sound: a
//! *bundle* is several whole droplets back to back in one OFDM burst, each
//! keeping its own CRC32, so the one decoder takes droplets from both channels.

use serde::Serialize;

use crate::error::GhostError;
use crate::fountain::Xorshift64Star;
use crate::protocol::MAX_ANY_FRAME_SIZE;

pub const WIDE_MAGIC: [u8; 2] = *b"GW";
pub const WIDE_HEADER_LEN: usize = 16;
pub const WIDE_OVERHEAD: usize = WIDE_HEADER_LEN + 4;
pub const WIDE_MIN_BLOCK: usize = 64;
pub const WIDE_MAX_BLOCK: usize = 1024;
pub const WIDE_MAX_K: usize = 512;
/// Largest bundle: one OFDM frame.
pub const MAX_BUNDLE_BYTES: usize = 16 * 1024;
/// Seeds of the acoustic lane start here, disjoint from the matrix seeds.
pub const SOUND_SEED_BASE: u32 = 0x8000_0000;

/// Densest droplet: keeps XOR work per droplet bounded.
pub const WIDE_MAX_DEGREE: usize = 48;

const WORDS: usize = WIDE_MAX_K / 64;

/// Fixed-size bitset over at most 512 source blocks.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
struct Mask([u64; WORDS]);

impl Mask {
    fn set(&mut self, i: usize) {
        if let Some(w) = self.0.get_mut(i / 64) {
            *w |= 1u64 << (i % 64);
        }
    }
    fn clear(&mut self, i: usize) {
        if let Some(w) = self.0.get_mut(i / 64) {
            *w &= !(1u64 << (i % 64));
        }
    }
    fn has(&self, i: usize) -> bool {
        self.0.get(i / 64).is_some_and(|w| w & (1u64 << (i % 64)) != 0)
    }
    fn count(&self) -> u32 {
        self.0.iter().map(|w| w.count_ones()).sum()
    }
    fn first(&self) -> Option<usize> {
        self.0.iter().enumerate().find(|(_, w)| **w != 0).map(|(i, w)| i * 64 + w.trailing_zeros() as usize)
    }
    fn xor(&mut self, other: &Mask) {
        for (a, b) in self.0.iter_mut().zip(other.0.iter()) {
            *a ^= *b;
        }
    }
    fn is_empty(&self) -> bool {
        self.0.iter().all(|w| *w == 0)
    }
}

/// Integer-only degree sampler: 5 % d=1 and 10 % d=2 start the peeling
/// cascade; the other 85 % are dense (uniform in 3..=clamp(K/3, 3, 48)), so
/// Gauss-Jordan elimination reaches full rank a few droplets after K, as in
/// the v1 fountain. The ideal soliton is too sparse at these K (1.6×K measured).
fn sample_degree(rng: &mut Xorshift64Star, k: usize) -> usize {
    let r = rng.next_below(100);
    let d = if r < 5 {
        1
    } else if r < 15 {
        2
    } else {
        let hi = (k / 3).clamp(3, WIDE_MAX_DEGREE);
        3 + rng.next_below((hi - 3 + 1) as u64) as usize
    };
    d.clamp(1, k.clamp(1, WIDE_MAX_DEGREE))
}

fn droplet_mask(seed: u32, session: u16, k: usize) -> Mask {
    let mut mask = Mask::default();
    if k == 0 || k > WIDE_MAX_K {
        return mask;
    }
    let mut rng = Xorshift64Star::new(0x5749_4445_0000_0000 ^ ((session as u64) << 32) ^ seed as u64);
    let d = sample_degree(&mut rng, k);
    while (mask.count() as usize) < d {
        mask.set(rng.next_below(k as u64) as usize);
    }
    mask
}

fn xor_into(dst: &mut [u8], src: &[u8]) {
    for (d, s) in dst.iter_mut().zip(src.iter()) {
        *d ^= *s;
    }
}

pub struct WideEncoder {
    blocks: Vec<Vec<u8>>,
    k: usize,
    block_size: usize,
    total_len: usize,
    session: u16,
}

impl WideEncoder {
    pub fn new(frame: &[u8], session: u16, block_size: usize) -> Result<Self, GhostError> {
        if frame.is_empty() || frame.len() > MAX_ANY_FRAME_SIZE || !(WIDE_MIN_BLOCK..=WIDE_MAX_BLOCK).contains(&block_size) {
            return Err(GhostError::FountainInvalidParams);
        }
        let k = frame.len().div_ceil(block_size);
        if k == 0 || k > WIDE_MAX_K {
            return Err(GhostError::FountainInvalidParams);
        }
        let blocks = frame
            .chunks(block_size)
            .map(|c| {
                let mut b = c.to_vec();
                b.resize(block_size, 0);
                b
            })
            .collect();
        Ok(WideEncoder { blocks, k, block_size, total_len: frame.len(), session })
    }

    pub fn k(&self) -> usize {
        self.k
    }

    pub fn droplet_len(&self) -> usize {
        WIDE_OVERHEAD + self.block_size
    }

    pub fn droplet(&self, seed: u32) -> Vec<u8> {
        let mask = droplet_mask(seed, self.session, self.k);
        let mut data = vec![0u8; self.block_size];
        for (i, block) in self.blocks.iter().enumerate() {
            if mask.has(i) {
                xor_into(&mut data, block);
            }
        }
        let mut out = Vec::with_capacity(self.droplet_len());
        out.extend_from_slice(&WIDE_MAGIC);
        out.extend_from_slice(&self.session.to_be_bytes());
        out.extend_from_slice(&(self.k as u16).to_be_bytes());
        out.extend_from_slice(&(self.block_size as u16).to_be_bytes());
        out.extend_from_slice(&(self.total_len as u32).to_be_bytes());
        out.extend_from_slice(&seed.to_be_bytes());
        out.extend_from_slice(&data);
        let crc = crc32fast::hash(&out);
        out.extend_from_slice(&crc.to_be_bytes());
        out
    }

    /// Droplets `first, first+1, …` back to back, as many as fit in `max_bytes`
    /// (at most `count`, at least one).
    pub fn bundle(&self, first: u32, count: u32, max_bytes: usize) -> Vec<u8> {
        let per = self.droplet_len().max(1);
        let fit = (max_bytes.min(MAX_BUNDLE_BYTES) / per).max(1);
        let n = (count as usize).clamp(1, fit);
        let mut out = Vec::with_capacity(n * per);
        for i in 0..n as u32 {
            out.extend_from_slice(&self.droplet(first.wrapping_add(i)));
        }
        out
    }
}

/// Splits a bundle into droplets. The length of each comes from its own header;
/// nothing is copied, and a bundle larger than one OFDM frame is refused.
pub fn split_bundle(bytes: &[u8]) -> Result<Vec<&[u8]>, GhostError> {
    if bytes.is_empty() || bytes.len() > MAX_BUNDLE_BYTES {
        return Err(GhostError::DropletInvalid);
    }
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < bytes.len() {
        let head = bytes.get(at..at + 8).ok_or(GhostError::DropletInvalid)?;
        if head.get(0..2) != Some(&WIDE_MAGIC[..]) {
            return Err(GhostError::DropletInvalid);
        }
        let block = match (head.get(6), head.get(7)) {
            (Some(&hi), Some(&lo)) => u16::from_be_bytes([hi, lo]) as usize,
            _ => return Err(GhostError::DropletInvalid),
        };
        if !(WIDE_MIN_BLOCK..=WIDE_MAX_BLOCK).contains(&block) {
            return Err(GhostError::DropletInvalid);
        }
        let end = at.checked_add(WIDE_OVERHEAD + block).ok_or(GhostError::DropletInvalid)?;
        out.push(bytes.get(at..end).ok_or(GhostError::DropletInvalid)?);
        at = end;
    }
    Ok(out)
}

/// Outcome of a bundle: the last useful step and how many droplets were taken.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleStep {
    pub accepted: u32,
    pub rejected: u32,
    pub step: Option<WideStep>,
}

/// Block size that fills a transport packet of `capacity` bytes.
pub fn block_size_for(capacity: usize) -> usize {
    capacity.saturating_sub(WIDE_OVERHEAD).clamp(WIDE_MIN_BLOCK, WIDE_MAX_BLOCK)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Params {
    session: u16,
    k: usize,
    block_size: usize,
    total_len: usize,
}

struct Equation {
    mask: Mask,
    data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WideStep {
    pub seed: u32,
    pub degree: u32,
    pub duplicate: bool,
    pub newly_resolved: Vec<u32>,
    pub cascade_depth: u32,
    pub solved_by_elimination: bool,
    pub resolved_count: u32,
    pub total_k: u32,
    pub pending: u32,
    pub droplets_received: u32,
    pub total_len: u32,
    pub complete: bool,
}

#[derive(Default)]
pub struct WideDecoder {
    params: Option<Params>,
    decoded: Vec<Option<Vec<u8>>>,
    pending: Vec<Equation>,
    seen: Vec<u32>,
    received: u32,
    next_elimination_at: u32,
    failed_eliminations: u32,
    session_mismatches: u32,
}

/// Consecutive droplets of another session after which an unfinished decoder
/// follows the new broadcast instead of staying locked on a stale one.
pub const SESSION_SWITCH_AFTER: u32 = 8;

fn parse(bytes: &[u8]) -> Result<(Params, u32, Vec<u8>), GhostError> {
    if bytes.len() < WIDE_OVERHEAD + WIDE_MIN_BLOCK || bytes.len() > WIDE_OVERHEAD + WIDE_MAX_BLOCK {
        return Err(GhostError::DropletInvalid);
    }
    if bytes.get(0..2) != Some(&WIDE_MAGIC[..]) {
        return Err(GhostError::DropletInvalid);
    }
    let body_end = bytes.len() - 4;
    let body = bytes.get(..body_end).ok_or(GhostError::DropletInvalid)?;
    let stored: [u8; 4] = bytes.get(body_end..).and_then(|s| s.try_into().ok()).ok_or(GhostError::DropletInvalid)?;
    if crc32fast::hash(body) != u32::from_be_bytes(stored) {
        return Err(GhostError::DropletCrcMismatch);
    }
    let u16_at = |i: usize| -> Result<u16, GhostError> {
        Ok(u16::from_be_bytes([*bytes.get(i).ok_or(GhostError::DropletInvalid)?, *bytes.get(i + 1).ok_or(GhostError::DropletInvalid)?]))
    };
    let u32_at = |i: usize| -> Result<u32, GhostError> {
        let b: [u8; 4] = bytes.get(i..i + 4).and_then(|s| s.try_into().ok()).ok_or(GhostError::DropletInvalid)?;
        Ok(u32::from_be_bytes(b))
    };
    let session = u16_at(2)?;
    let k = u16_at(4)? as usize;
    let block_size = u16_at(6)? as usize;
    let total_len = u32_at(8)? as usize;
    let seed = u32_at(12)?;
    if !(WIDE_MIN_BLOCK..=WIDE_MAX_BLOCK).contains(&block_size)
        || bytes.len() != WIDE_OVERHEAD + block_size
        || total_len == 0
        || total_len > MAX_ANY_FRAME_SIZE
        || k == 0
        || k > WIDE_MAX_K
        || k != total_len.div_ceil(block_size)
    {
        return Err(GhostError::DropletInvalid);
    }
    let data = bytes.get(WIDE_HEADER_LEN..body_end).ok_or(GhostError::DropletInvalid)?.to_vec();
    Ok((Params { session, k, block_size, total_len }, seed, data))
}

impl WideDecoder {
    pub fn new() -> Self {
        WideDecoder::default()
    }

    pub fn reset(&mut self) {
        *self = WideDecoder::default();
    }

    pub fn is_complete(&self) -> bool {
        self.params.is_some() && self.decoded.iter().all(|b| b.is_some())
    }

    fn resolved(&self) -> usize {
        self.decoded.iter().filter(|b| b.is_some()).count()
    }

    /// Indices of the blocks decoded so far (for progressive image reveal).
    pub fn decoded_map(&self) -> Vec<bool> {
        self.decoded.iter().map(|b| b.is_some()).collect()
    }

    /// Bytes recovered so far; unknown blocks are zero. Lets the UI materialize
    /// an image progressively. Never used for verification.
    pub fn partial(&self) -> Vec<u8> {
        let Some(p) = self.params else { return Vec::new() };
        let mut out = Vec::with_capacity(p.k * p.block_size);
        for b in &self.decoded {
            match b {
                Some(d) => out.extend_from_slice(d),
                None => out.extend(std::iter::repeat_n(0u8, p.block_size)),
            }
        }
        out.truncate(p.total_len);
        out
    }

    pub fn frame(&self) -> Result<Vec<u8>, GhostError> {
        let p = self.params.ok_or(GhostError::FountainIncomplete)?;
        let mut out = Vec::with_capacity(p.k * p.block_size);
        for b in &self.decoded {
            out.extend_from_slice(b.as_ref().ok_or(GhostError::FountainIncomplete)?);
        }
        out.truncate(p.total_len);
        Ok(out)
    }

    fn reduce(&self, eq: &mut Equation) {
        for (i, b) in self.decoded.iter().enumerate() {
            if let Some(d) = b {
                if eq.mask.has(i) {
                    xor_into(&mut eq.data, d);
                    eq.mask.clear(i);
                }
            }
        }
    }

    pub fn ingest(&mut self, bytes: &[u8]) -> Result<WideStep, GhostError> {
        let (params, seed, data) = parse(bytes)?;
        match self.params {
            None => {
                self.params = Some(params);
                self.decoded = vec![None; params.k];
            }
            Some(p) if p != params => {
                self.session_mismatches = self.session_mismatches.saturating_add(1);
                if self.is_complete() || self.session_mismatches < SESSION_SWITCH_AFTER {
                    return Err(GhostError::DropletSessionMismatch);
                }
                // The emitter moved on: start over on the new session.
                self.reset();
                self.params = Some(params);
                self.decoded = vec![None; params.k];
            }
            Some(_) => self.session_mismatches = 0,
        }
        let k = params.k;
        let mask = droplet_mask(seed, params.session, k);
        let degree = mask.count();
        let duplicate = self.seen.contains(&seed);
        let mut newly = Vec::new();
        let mut depth = 0;
        let mut by_elimination = false;
        if !duplicate && !self.is_complete() {
            if self.seen.len() >= 8 * WIDE_MAX_K {
                self.seen.remove(0);
            }
            self.seen.push(seed);
            self.received = self.received.saturating_add(1);
            let mut eq = Equation { mask, data };
            self.reduce(&mut eq);
            if eq.mask.count() == 1 {
                depth = self.cascade(eq, &mut newly);
            } else if !eq.mask.is_empty() {
                if self.pending.len() >= 2 * k {
                    self.pending.remove(0);
                }
                self.pending.push(eq);
            }
            // Elimination is O(K²·B): only when peeling stalls, and not on every droplet.
            let unknown = k - self.resolved();
            let step = (k as u32 / 16).max(1);
            if unknown > 0 && self.pending.len() >= unknown && self.received >= self.next_elimination_at.max(step) {
                by_elimination = self.eliminate(&mut newly);
                // Back off after a rank-deficient attempt (interval doubled, capped at ×2
                // so a genuine transfer completes at most K/8 droplets late).
                self.failed_eliminations = if by_elimination { 0 } else { self.failed_eliminations.saturating_add(1).min(1) };
                self.next_elimination_at = self.received.saturating_add(step.saturating_mul(1 << self.failed_eliminations));
            }
        }
        Ok(WideStep {
            seed,
            degree,
            duplicate,
            newly_resolved: newly,
            cascade_depth: depth,
            solved_by_elimination: by_elimination,
            resolved_count: self.resolved() as u32,
            total_k: k as u32,
            pending: self.pending.len() as u32,
            droplets_received: self.received,
            total_len: params.total_len as u32,
            complete: self.is_complete(),
        })
    }

    /// Ingests every droplet of a bundle (bad ones are counted, not fatal).
    pub fn ingest_bundle(&mut self, bytes: &[u8]) -> Result<BundleStep, GhostError> {
        let parts = split_bundle(bytes)?;
        // A real bundle comes from one encoder: same session, K, block size and length.
        let head = |p: &[u8]| p.get(2..12).map(<[u8]>::to_vec);
        let first = parts.first().and_then(|p| head(p)).ok_or(GhostError::DropletInvalid)?;
        if parts.iter().any(|p| head(p).as_deref() != Some(first.as_slice())) {
            return Err(GhostError::DropletInvalid);
        }
        let mut out = BundleStep { accepted: 0, rejected: 0, step: None };
        let mut newly: Vec<u32> = Vec::new();
        let total = parts.len() as u32;
        for part in parts {
            match self.ingest(part) {
                Ok(step) => {
                    out.accepted += 1;
                    newly.extend_from_slice(&step.newly_resolved);
                    out.step = Some(step);
                }
                // A foreign bundle counts once towards a session switch, whatever its size.
                Err(GhostError::DropletSessionMismatch) => {
                    out.rejected = total.saturating_sub(out.accepted);
                    break;
                }
                Err(_) => out.rejected += 1,
            }
        }
        // Report every block the bundle resolved, not only the last droplet's.
        if let Some(s) = out.step.as_mut() {
            s.newly_resolved = newly;
        }
        Ok(out)
    }

    fn cascade(&mut self, first: Equation, newly: &mut Vec<u32>) -> u32 {
        let mut queue = vec![(first, 0u32)];
        let mut max_depth = 0;
        while let Some((eq, depth)) = queue.pop() {
            let Some(idx) = eq.mask.first() else { continue };
            match self.decoded.get_mut(idx) {
                Some(slot @ None) => *slot = Some(eq.data),
                _ => continue,
            }
            newly.push(idx as u32);
            max_depth = max_depth.max(depth);
            let block = match self.decoded.get(idx) {
                Some(Some(b)) => b.clone(),
                _ => continue,
            };
            let mut i = 0;
            while i < self.pending.len() {
                let done = match self.pending.get_mut(i) {
                    Some(p) if p.mask.has(idx) => {
                        xor_into(&mut p.data, &block);
                        p.mask.clear(idx);
                        p.mask.count() <= 1
                    }
                    _ => false,
                };
                if done {
                    let p = self.pending.swap_remove(i);
                    if !p.mask.is_empty() {
                        queue.push((p, depth + 1));
                    }
                } else {
                    i += 1;
                }
            }
        }
        max_depth
    }

    fn eliminate(&mut self, newly: &mut Vec<u32>) -> bool {
        let unknown: Vec<usize> = (0..self.decoded.len()).filter(|&i| self.decoded.get(i).is_some_and(|b| b.is_none())).collect();
        let mut rows: Vec<Equation> = self.pending.iter().map(|e| Equation { mask: e.mask, data: e.data.clone() }).collect();
        for r in rows.iter_mut() {
            self.reduce(r);
        }
        let mut rank = 0usize;
        for &col in &unknown {
            let Some(p) = (rank..rows.len()).find(|&r| rows.get(r).is_some_and(|e| e.mask.has(col))) else {
                return false;
            };
            rows.swap(rank, p);
            let (pm, pd) = match rows.get(rank) {
                Some(e) => (e.mask, e.data.clone()),
                None => return false,
            };
            for (r, row) in rows.iter_mut().enumerate() {
                if r != rank && row.mask.has(col) {
                    row.mask.xor(&pm);
                    xor_into(&mut row.data, &pd);
                }
            }
            rank += 1;
        }
        for row in rows.into_iter().take(rank) {
            if row.mask.count() != 1 {
                return false;
            }
            if let Some(idx) = row.mask.first() {
                if let Some(slot @ None) = self.decoded.get_mut(idx) {
                    *slot = Some(row.data);
                    newly.push(idx as u32);
                }
            }
        }
        self.pending.clear();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 31 + 7) as u8).collect()
    }

    fn run(len: usize, block: usize, loss_every: u32) -> (Vec<u8>, u32, usize) {
        let f = frame(len);
        let enc = WideEncoder::new(&f, 0x1234, block).unwrap();
        let mut dec = WideDecoder::new();
        let mut shown = 0;
        for seed in 0..(enc.k() as u32 * 6) {
            shown += 1;
            if loss_every > 0 && seed % loss_every == 0 {
                continue;
            }
            if dec.ingest(&enc.droplet(seed)).unwrap().complete {
                break;
            }
        }
        (dec.frame().unwrap_or_default(), shown, enc.k())
    }

    #[test]
    fn reconstructs_a_16k_frame_with_loss() {
        // One droplet in three lost: received ≈ shown × 2/3 must stay close to K.
        let (out, shown, k) = run(16 * 1024 + 78, 556, 3);
        assert_eq!(out, frame(16 * 1024 + 78));
        let received = shown as usize * 2 / 3;
        assert!(received <= k + 8, "needed {received} droplets for K = {k}");
    }

    #[test]
    fn overhead_over_many_sessions() {
        // Mean received / K over 40 sessions at 30 % loss, 16 KB and 64 KB frames.
        for (len, block) in [(16_462usize, 556usize), (65_614, 556)] {
            let f = frame(len);
            let mut total = 0usize;
            let mut k = 0;
            for session in 0..40u16 {
                let enc = WideEncoder::new(&f, session, block).unwrap();
                k = enc.k();
                let mut dec = WideDecoder::new();
                let mut received = 0;
                for seed in 0..(k as u32 * 6) {
                    if crate::channel_sim::is_dropped(session as u64, seed as u64, 30.0) {
                        continue;
                    }
                    received += 1;
                    if dec.ingest(&enc.droplet(seed)).unwrap().complete {
                        break;
                    }
                }
                assert_eq!(dec.frame().unwrap(), f, "session {session}");
                total += received;
            }
            let mean = total as f64 / 40.0 / k as f64;
            assert!(mean < 1.15, "mean overhead {mean:.3} for K = {k}");
        }
    }

    #[test]
    fn reconstructs_the_largest_v2_frame() {
        let (out, _, k) = run(MAX_ANY_FRAME_SIZE, 1024, 0);
        assert!(k <= WIDE_MAX_K);
        assert_eq!(out.len(), MAX_ANY_FRAME_SIZE);
    }

    #[test]
    fn degrees_are_bounded_and_deterministic() {
        for k in [1usize, 2, 30, 200, 512] {
            for seed in 0..200 {
                let m = droplet_mask(seed, 7, k);
                assert!((1..=WIDE_MAX_DEGREE.min(k)).contains(&(m.count() as usize)));
                assert!(m == droplet_mask(seed, 7, k));
            }
        }
    }

    #[test]
    fn rejects_corrupt_foreign_and_hostile_droplets() {
        let enc = WideEncoder::new(&frame(5000), 1, 500).unwrap();
        let mut d = enc.droplet(1);
        d[30] ^= 1;
        let mut dec = WideDecoder::new();
        assert_eq!(dec.ingest(&d).unwrap_err(), GhostError::DropletCrcMismatch);
        dec.ingest(&enc.droplet(2)).unwrap();
        let other = WideEncoder::new(&frame(5000), 2, 500).unwrap();
        assert_eq!(dec.ingest(&other.droplet(2)).unwrap_err(), GhostError::DropletSessionMismatch);
        // Declared K inconsistent with the length, re-signed with a valid CRC.
        let mut h = enc.droplet(3);
        h[4..6].copy_from_slice(&600u16.to_be_bytes());
        let end = h.len() - 4;
        let crc = crc32fast::hash(&h[..end]);
        h[end..].copy_from_slice(&crc.to_be_bytes());
        assert_eq!(WideDecoder::new().ingest(&h).unwrap_err(), GhostError::DropletInvalid);
    }

    #[test]
    fn chimera_lanes_feed_one_decoder() {
        // Light lane: matrices 0..; sound lane: bundles of 2 droplets from SOUND_SEED_BASE.
        let f = frame(12_000);
        let enc = WideEncoder::new(&f, 9, 505).unwrap();
        let mut dec = WideDecoder::new();
        let (mut light, mut sound) = (0u32, 0u32);
        let mut done = false;
        for round in 0..200u32 {
            // The camera is covered for the first 6 rounds: only sound gets through.
            if round >= 6 && !crate::channel_sim::is_dropped(3, round as u64, 30.0) {
                light += 1;
                done = dec.ingest(&enc.droplet(round)).unwrap().complete;
            }
            if !done && round % 3 == 0 {
                let b = enc.bundle(SOUND_SEED_BASE + sound, 2, MAX_BUNDLE_BYTES);
                assert_eq!(b.len(), 2 * enc.droplet_len());
                let out = dec.ingest_bundle(&b).unwrap();
                assert_eq!((out.accepted, out.rejected), (2, 0));
                sound += 2;
                done = out.step.is_some_and(|s| s.complete);
            }
            if done {
                break;
            }
        }
        assert!(done && light > 0 && sound > 0, "light {light}, sound {sound}");
        assert_eq!(dec.frame().unwrap(), f);
    }

    #[test]
    fn hostile_bundles_are_refused() {
        let enc = WideEncoder::new(&frame(3000), 1, 505).unwrap();
        let b = enc.bundle(0, 3, MAX_BUNDLE_BYTES);
        assert_eq!(split_bundle(&b).unwrap().len(), 3);
        assert_eq!(split_bundle(&b[..b.len() - 1]).unwrap_err(), GhostError::DropletInvalid);
        assert_eq!(split_bundle(&[]).unwrap_err(), GhostError::DropletInvalid);
        assert_eq!(split_bundle(&vec![0u8; MAX_BUNDLE_BYTES + 1]).unwrap_err(), GhostError::DropletInvalid);
        // Bundles never exceed the byte budget, and always hold one droplet.
        assert_eq!(enc.bundle(0, 100, 1200).len(), 2 * enc.droplet_len());
        assert_eq!(enc.bundle(0, 0, 10).len(), enc.droplet_len());
        // A corrupted droplet is counted, the others still count.
        let mut bad = b.clone();
        bad[30] ^= 0xff;
        let out = WideDecoder::new().ingest_bundle(&bad).unwrap();
        assert_eq!((out.accepted, out.rejected), (2, 1));
        // Droplets of two encoders in one bundle: not a real bundle.
        let other = WideEncoder::new(&frame(3000), 2, 505).unwrap();
        let mut mixed = enc.droplet(0);
        mixed.extend_from_slice(&other.droplet(0));
        assert_eq!(WideDecoder::new().ingest_bundle(&mixed).unwrap_err(), GhostError::DropletInvalid);
    }

    #[test]
    fn one_foreign_bundle_cannot_reset_a_transfer() {
        let mine = WideEncoder::new(&frame(5000), 1, 505).unwrap();
        let foreign = WideEncoder::new(&frame(5000), 7, 505).unwrap();
        let mut dec = WideDecoder::new();
        dec.ingest(&mine.droplet(0)).unwrap();
        // 20 crafted droplets of another session in one burst count as one mismatch.
        for _ in 0..SESSION_SWITCH_AFTER - 1 {
            let out = dec.ingest_bundle(&foreign.bundle(SOUND_SEED_BASE, 20, MAX_BUNDLE_BYTES)).unwrap();
            assert_eq!((out.accepted, out.rejected), (0, 20));
        }
        // Still on the first session: its droplets keep counting.
        assert!(dec.ingest(&mine.droplet(1)).is_ok());
    }

    #[test]
    fn follows_a_new_session_instead_of_locking_in() {
        let old = WideEncoder::new(&frame(5000), 1, 500).unwrap();
        let new = WideEncoder::new(&frame(3000), 2, 500).unwrap();
        let mut dec = WideDecoder::new();
        dec.ingest(&old.droplet(0)).unwrap();
        // A few stray droplets of another session are rejected…
        for seed in 0..SESSION_SWITCH_AFTER - 1 {
            assert_eq!(dec.ingest(&new.droplet(seed)).unwrap_err(), GhostError::DropletSessionMismatch);
        }
        // …a matching droplet clears the count…
        dec.ingest(&old.droplet(1)).unwrap();
        assert_eq!(dec.ingest(&new.droplet(0)).unwrap_err(), GhostError::DropletSessionMismatch);
        // …and a sustained new broadcast is adopted and decoded.
        for seed in 1..SESSION_SWITCH_AFTER - 1 {
            assert!(dec.ingest(&new.droplet(seed)).is_err());
        }
        let mut seed = SESSION_SWITCH_AFTER;
        while !dec.ingest(&new.droplet(seed)).unwrap().complete {
            seed += 1;
            assert!(seed < 200);
        }
        assert_eq!(dec.frame().unwrap(), frame(3000));
        // A completed decoder keeps its frame.
        assert!(dec.ingest(&old.droplet(5)).is_err());
        assert_eq!(dec.frame().unwrap(), frame(3000));
    }
}
