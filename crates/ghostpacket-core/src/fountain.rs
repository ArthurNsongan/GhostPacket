//! Luby Transform fountain code for the optical (animated QR) channel.
//!
//! Droplet wire format (big-endian):
//! ```text
//! [Magic "GQ" 2B][Session 2B][K 1B][BlockSize 1B][TotalLen 2B][Seed 4B][XOR data BlockSize B][CRC16 2B]
//! ```
//! With `BlockSize = 16` a droplet is 30 bytes (60 uppercase hex characters,
//! QR version 3-M in alphanumeric mode).
//!
//! The receiver runs a peeling (belief propagation) decoder and shows each
//! cascade. When peeling stalls with at least K equations, it falls back to
//! Gauss-Jordan elimination over GF(2) on the pending droplets.

use serde::Serialize;

use crate::error::GhostError;
use crate::protocol::MAX_FRAME_SIZE;

pub const DROPLET_MAGIC: [u8; 2] = *b"GQ";
pub const DROPLET_HEADER_LEN: usize = 12;
pub const DROPLET_OVERHEAD: usize = DROPLET_HEADER_LEN + 2;
pub const DEFAULT_BLOCK_SIZE: usize = 16;
pub const MIN_BLOCK_SIZE: usize = 8;
pub const MAX_BLOCK_SIZE: usize = 64;
pub const MAX_K: usize = 64;
pub const MAX_PENDING_DROPLETS: usize = 256;
pub const MAX_SEEN_SEEDS: usize = 4096;

// --- Deterministic PRNG ------------------------------------------------------

fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// `xorshift64*`, seeded through splitmix64. Shared with `channel_sim`.
#[derive(Debug, Clone)]
pub struct Xorshift64Star {
    state: u64,
}

impl Xorshift64Star {
    pub fn new(seed: u64) -> Self {
        let s = splitmix64(seed);
        Xorshift64Star {
            state: if s == 0 { 0x2545_F491_4F6C_DD1D } else { s },
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform integer in `0..n` for `0 < n <= 2^32` (returns 0 otherwise).
    /// Uses the high 32 bits: the low bits of xorshift64* are weak.
    pub fn next_below(&mut self, n: u64) -> u64 {
        if n == 0 || n > (1u64 << 32) {
            return 0;
        }
        ((self.next_u64() >> 32) * n) >> 32
    }

    /// Uniform float in the open-closed interval (0, 1].
    pub fn next_unit(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64 + 1.0) / (1u64 << 53) as f64
    }
}

/// Degree distribution tuned for small K (Robust Soliton-like):
/// 20 % d=1, 35 % d=2, 20 % d=3 feed the peeling cascade; the last 25 % is a
/// dense "spike" with d in max(4, K/3)..=max(4, K/2). Dense droplets cover
/// blocks that sparse droplets missed (coupon-collector effect at small K),
/// so Gauss-Jordan elimination finishes close to K received droplets.
fn sample_degree(rng: &mut Xorshift64Star, k: usize) -> usize {
    let r = rng.next_below(100);
    let d = if r < 20 {
        1
    } else if r < 55 {
        2
    } else if r < 75 {
        3
    } else {
        let lo = (k / 3).max(4);
        let hi = (k / 2).max(lo);
        lo + rng.next_below((hi - lo + 1) as u64) as usize
    };
    d.clamp(1, k.max(1))
}

/// Source-block set of a droplet, as a bitmask over `k <= 64` blocks.
pub fn droplet_mask(seed: u32, session: u16, k: usize) -> u64 {
    if k == 0 || k > MAX_K {
        return 0;
    }
    let mut rng = Xorshift64Star::new(((session as u64) << 32) | seed as u64);
    let d = sample_degree(&mut rng, k);
    let mut mask = 0u64;
    while (mask.count_ones() as usize) < d {
        let idx = rng.next_below(k as u64);
        mask |= 1u64 << idx;
    }
    mask
}

/// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF).
pub fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

fn xor_into(dst: &mut [u8], src: &[u8]) {
    for (d, s) in dst.iter_mut().zip(src.iter()) {
        *d ^= *s;
    }
}

fn block_count(total_len: usize, block_size: usize) -> usize {
    if block_size == 0 {
        0
    } else {
        total_len.div_ceil(block_size)
    }
}

// --- Encoder -----------------------------------------------------------------

pub struct FountainEncoder {
    blocks: Vec<Vec<u8>>,
    k: usize,
    block_size: usize,
    total_len: usize,
    session: u16,
    next_seed: u32,
}

impl FountainEncoder {
    pub fn new(frame: &[u8], session: u16, block_size: usize) -> Result<Self, GhostError> {
        if frame.is_empty()
            || frame.len() > MAX_FRAME_SIZE
            || !(MIN_BLOCK_SIZE..=MAX_BLOCK_SIZE).contains(&block_size)
        {
            return Err(GhostError::FountainInvalidParams);
        }
        let k = block_count(frame.len(), block_size);
        if k == 0 || k > MAX_K {
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
        Ok(FountainEncoder {
            blocks,
            k,
            block_size,
            total_len: frame.len(),
            session,
            next_seed: 0,
        })
    }

    pub fn k(&self) -> usize {
        self.k
    }

    pub fn droplet_len(&self) -> usize {
        DROPLET_OVERHEAD + self.block_size
    }

    /// Droplet for an explicit seed (deterministic).
    pub fn droplet(&self, seed: u32) -> Vec<u8> {
        let mask = droplet_mask(seed, self.session, self.k);
        let mut data = vec![0u8; self.block_size];
        for (i, block) in self.blocks.iter().enumerate() {
            if mask & (1u64 << i) != 0 {
                xor_into(&mut data, block);
            }
        }
        let mut out = Vec::with_capacity(self.droplet_len());
        out.extend_from_slice(&DROPLET_MAGIC);
        out.extend_from_slice(&self.session.to_be_bytes());
        out.push(self.k as u8);
        out.push(self.block_size as u8);
        out.extend_from_slice(&(self.total_len as u16).to_be_bytes());
        out.extend_from_slice(&seed.to_be_bytes());
        out.extend_from_slice(&data);
        let crc = crc16(&out);
        out.extend_from_slice(&crc.to_be_bytes());
        out
    }

    pub fn next_droplet(&mut self) -> Vec<u8> {
        let seed = self.next_seed;
        self.next_seed = self.next_seed.wrapping_add(1);
        self.droplet(seed)
    }
}

// --- Decoder -----------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Params {
    session: u16,
    k: usize,
    block_size: usize,
    total_len: usize,
}

struct Equation {
    mask: u64,
    data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropletStep {
    pub seed: u32,
    pub degree: u32,
    pub duplicate: bool,
    /// Blocks resolved by this droplet (directly or by cascade).
    pub newly_resolved: Vec<u32>,
    /// Longest chain of cascaded resolutions triggered by this droplet.
    pub cascade_depth: u32,
    /// True if Gauss-Jordan elimination finished the decoding.
    pub solved_by_elimination: bool,
    pub decoded: Vec<bool>,
    pub resolved_count: u32,
    pub total_k: u32,
    pub pending: u32,
    pub droplets_received: u32,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderStats {
    pub session: Option<u16>,
    pub total_k: u32,
    pub resolved_count: u32,
    pub droplets_received: u32,
    pub duplicates: u32,
    pub cascade_events: u32,
    pub complete: bool,
}

#[derive(Default)]
pub struct FountainDecoder {
    params: Option<Params>,
    decoded: Vec<Option<Vec<u8>>>,
    pending: Vec<Equation>,
    seen: Vec<u32>,
    received: u32,
    duplicates: u32,
    cascade_events: u32,
}

struct ParsedDroplet {
    params: Params,
    seed: u32,
    data: Vec<u8>,
}

fn parse_droplet(bytes: &[u8]) -> Result<ParsedDroplet, GhostError> {
    if bytes.len() < DROPLET_OVERHEAD + MIN_BLOCK_SIZE
        || bytes.len() > DROPLET_OVERHEAD + MAX_BLOCK_SIZE
    {
        return Err(GhostError::DropletInvalid);
    }
    let get = |i: usize| bytes.get(i).copied().ok_or(GhostError::DropletInvalid);
    if bytes.get(0..2) != Some(&DROPLET_MAGIC[..]) {
        return Err(GhostError::DropletInvalid);
    }
    let body_end = bytes.len() - 2;
    let stored = u16::from_be_bytes([get(body_end)?, get(body_end + 1)?]);
    let body = bytes.get(..body_end).ok_or(GhostError::DropletInvalid)?;
    if crc16(body) != stored {
        return Err(GhostError::DropletCrcMismatch);
    }
    let session = u16::from_be_bytes([get(2)?, get(3)?]);
    let k = get(4)? as usize;
    let block_size = get(5)? as usize;
    let total_len = u16::from_be_bytes([get(6)?, get(7)?]) as usize;
    let seed = u32::from_be_bytes([get(8)?, get(9)?, get(10)?, get(11)?]);
    if !(MIN_BLOCK_SIZE..=MAX_BLOCK_SIZE).contains(&block_size)
        || bytes.len() != DROPLET_OVERHEAD + block_size
        || total_len == 0
        || total_len > MAX_FRAME_SIZE
        || k == 0
        || k > MAX_K
        || k != block_count(total_len, block_size)
    {
        return Err(GhostError::DropletInvalid);
    }
    let data = bytes
        .get(DROPLET_HEADER_LEN..body_end)
        .ok_or(GhostError::DropletInvalid)?
        .to_vec();
    Ok(ParsedDroplet {
        params: Params {
            session,
            k,
            block_size,
            total_len,
        },
        seed,
        data,
    })
}

impl FountainDecoder {
    pub fn new() -> Self {
        FountainDecoder::default()
    }

    pub fn reset(&mut self) {
        *self = FountainDecoder::default();
    }

    pub fn is_complete(&self) -> bool {
        self.params.is_some() && self.decoded.iter().all(|b| b.is_some())
    }

    fn resolved_count(&self) -> usize {
        self.decoded.iter().filter(|b| b.is_some()).count()
    }

    pub fn stats(&self) -> DecoderStats {
        DecoderStats {
            session: self.params.map(|p| p.session),
            total_k: self.params.map(|p| p.k as u32).unwrap_or(0),
            resolved_count: self.resolved_count() as u32,
            droplets_received: self.received,
            duplicates: self.duplicates,
            cascade_events: self.cascade_events,
            complete: self.is_complete(),
        }
    }

    /// Reconstructed frame once every block is known.
    pub fn frame(&self) -> Result<Vec<u8>, GhostError> {
        let params = self.params.ok_or(GhostError::FountainIncomplete)?;
        let mut out = Vec::with_capacity(params.k * params.block_size);
        for block in &self.decoded {
            match block {
                Some(b) => out.extend_from_slice(b),
                None => return Err(GhostError::FountainIncomplete),
            }
        }
        out.truncate(params.total_len);
        Ok(out)
    }

    fn reduce(&self, eq: &mut Equation) {
        for (i, block) in self.decoded.iter().enumerate() {
            let bit = 1u64 << i;
            if eq.mask & bit != 0 {
                if let Some(b) = block {
                    xor_into(&mut eq.data, b);
                    eq.mask &= !bit;
                }
            }
        }
    }

    /// Feeds one droplet. Invalid droplets return an error and leave the
    /// decoder untouched.
    pub fn ingest(&mut self, bytes: &[u8]) -> Result<DropletStep, GhostError> {
        let parsed = parse_droplet(bytes)?;
        match self.params {
            None => {
                self.params = Some(parsed.params);
                self.decoded = vec![None; parsed.params.k];
            }
            Some(p) if p != parsed.params => return Err(GhostError::DropletSessionMismatch),
            Some(_) => {}
        }
        let k = parsed.params.k;
        let mask = droplet_mask(parsed.seed, parsed.params.session, k);
        let degree = mask.count_ones();

        let duplicate = self.seen.contains(&parsed.seed);
        let mut newly = Vec::new();
        let mut depth = 0u32;
        let mut by_elimination = false;

        if duplicate {
            self.duplicates = self.duplicates.saturating_add(1);
        } else {
            if self.seen.len() >= MAX_SEEN_SEEDS {
                self.seen.remove(0);
            }
            self.seen.push(parsed.seed);
            self.received = self.received.saturating_add(1);

            let mut eq = Equation {
                mask,
                data: parsed.data,
            };
            self.reduce(&mut eq);
            if eq.mask.count_ones() == 1 {
                depth = self.resolve_and_cascade(eq, &mut newly);
            } else if eq.mask != 0 && !self.is_complete() {
                if self.pending.len() >= MAX_PENDING_DROPLETS {
                    self.pending.remove(0);
                }
                self.pending.push(eq);
            }
            if !self.is_complete() && self.resolved_count() + self.pending.len() >= k {
                by_elimination = self.try_elimination(&mut newly);
            }
        }

        Ok(DropletStep {
            seed: parsed.seed,
            degree,
            duplicate,
            newly_resolved: newly,
            cascade_depth: depth,
            solved_by_elimination: by_elimination,
            decoded: self.decoded.iter().map(|b| b.is_some()).collect(),
            resolved_count: self.resolved_count() as u32,
            total_k: k as u32,
            pending: self.pending.len() as u32,
            droplets_received: self.received,
            complete: self.is_complete(),
        })
    }

    /// Stores a degree-1 equation, then propagates through pending droplets.
    /// Returns the cascade depth.
    fn resolve_and_cascade(&mut self, first: Equation, newly: &mut Vec<u32>) -> u32 {
        let mut queue: Vec<(Equation, u32)> = vec![(first, 0)];
        let mut max_depth = 0u32;
        while let Some((eq, depth)) = queue.pop() {
            let idx = eq.mask.trailing_zeros() as usize;
            match self.decoded.get_mut(idx) {
                Some(slot @ None) => *slot = Some(eq.data),
                _ => continue,
            }
            newly.push(idx as u32);
            if depth > 0 {
                self.cascade_events = self.cascade_events.saturating_add(1);
            }
            max_depth = max_depth.max(depth);

            let bit = 1u64 << idx;
            let block = match self.decoded.get(idx) {
                Some(Some(b)) => b.clone(),
                _ => continue,
            };
            let mut i = 0;
            while i < self.pending.len() {
                let resolved_one = match self.pending.get_mut(i) {
                    Some(p) if p.mask & bit != 0 => {
                        xor_into(&mut p.data, &block);
                        p.mask &= !bit;
                        p.mask.count_ones() <= 1
                    }
                    _ => false,
                };
                if resolved_one {
                    let p = self.pending.swap_remove(i);
                    if p.mask != 0 {
                        queue.push((p, depth + 1));
                    }
                } else {
                    i += 1;
                }
            }
        }
        max_depth
    }

    /// Gauss-Jordan elimination over GF(2) on pending equations.
    fn try_elimination(&mut self, newly: &mut Vec<u32>) -> bool {
        let unknown: Vec<usize> = self
            .decoded
            .iter()
            .enumerate()
            .filter(|(_, b)| b.is_none())
            .map(|(i, _)| i)
            .collect();
        if unknown.is_empty() || self.pending.len() < unknown.len() {
            return false;
        }
        let mut rows: Vec<Equation> = self
            .pending
            .iter()
            .map(|e| Equation {
                mask: e.mask,
                data: e.data.clone(),
            })
            .collect();
        for r in rows.iter_mut() {
            self.reduce(r);
        }
        let mut rank = 0usize;
        for &col in &unknown {
            let bit = 1u64 << col;
            let pivot = (rank..rows.len()).find(|&r| rows.get(r).map(|e| e.mask & bit != 0).unwrap_or(false));
            let Some(p) = pivot else {
                return false;
            };
            rows.swap(rank, p);
            let (pivot_mask, pivot_data) = match rows.get(rank) {
                Some(e) => (e.mask, e.data.clone()),
                None => return false,
            };
            for (r, row) in rows.iter_mut().enumerate() {
                if r != rank && row.mask & bit != 0 {
                    row.mask ^= pivot_mask;
                    xor_into(&mut row.data, &pivot_data);
                }
            }
            rank += 1;
        }
        for row in rows.into_iter().take(rank) {
            if row.mask.count_ones() != 1 {
                return false;
            }
            let idx = row.mask.trailing_zeros() as usize;
            if let Some(slot @ None) = self.decoded.get_mut(idx) {
                *slot = Some(row.data);
                newly.push(idx as u32);
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
        (0..len).map(|i| (i * 13 + 7) as u8).collect()
    }

    #[test]
    fn droplet_is_30_bytes_for_block_16() {
        let enc = FountainEncoder::new(&frame(256), 0xBEEF, 16).unwrap();
        assert_eq!(enc.k(), 16);
        assert_eq!(enc.droplet(0).len(), 30);
    }

    #[test]
    fn lossless_stream_reconstructs() {
        let f = frame(276);
        let mut enc = FountainEncoder::new(&f, 7, 16).unwrap();
        let mut dec = FountainDecoder::new();
        for _ in 0..200 {
            let step = dec.ingest(&enc.next_droplet()).unwrap();
            if step.complete {
                break;
            }
        }
        assert_eq!(dec.frame().unwrap(), f);
    }

    #[test]
    fn rejects_corrupted_droplet() {
        let enc = FountainEncoder::new(&frame(100), 1, 16).unwrap();
        let mut d = enc.droplet(3);
        d[14] ^= 0x01;
        let mut dec = FountainDecoder::new();
        assert_eq!(dec.ingest(&d).unwrap_err(), GhostError::DropletCrcMismatch);
    }

    #[test]
    fn rejects_other_session() {
        let a = FountainEncoder::new(&frame(100), 1, 16).unwrap();
        let b = FountainEncoder::new(&frame(100), 2, 16).unwrap();
        let mut dec = FountainDecoder::new();
        dec.ingest(&a.droplet(0)).unwrap();
        assert_eq!(
            dec.ingest(&b.droplet(0)).unwrap_err(),
            GhostError::DropletSessionMismatch
        );
    }

    #[test]
    fn duplicates_are_ignored() {
        let enc = FountainEncoder::new(&frame(100), 1, 16).unwrap();
        let mut dec = FountainDecoder::new();
        dec.ingest(&enc.droplet(5)).unwrap();
        let step = dec.ingest(&enc.droplet(5)).unwrap();
        assert!(step.duplicate);
        assert_eq!(step.droplets_received, 1);
    }
}
