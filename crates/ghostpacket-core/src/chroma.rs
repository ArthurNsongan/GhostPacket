//! ChromaCrypt: a high-density color matrix for the screen → camera channel.
//!
//! One matrix carries one wide-fountain droplet (`CHROMA_CAPACITY` bytes).
//! ```text
//! 44 × 44 cells, 8 colors = the corners of the RGB cube (3 bits per cell:
//! index bits r g b, 0 = black … 7 = white).
//! - 4 finder patterns (7×7, QR-like 1:1:3:1:1, black/white) + 1-cell white
//!   separator in each corner: locate the matrix and give a homography;
//! - calibration strip: row 0, columns 8..32, each color three times, so the
//!   camera's white balance and the screen's gamut are learned per image;
//! - every other cell carries data, raster order.
//! Data = 3 Reed-Solomon codewords (207 bytes, 32 parity each, byte-interleaved):
//! up to 16 wrong bytes per codeword are corrected.
//! ```
//! Decoding (all here, bounded): luminance-free "dark" mask (max channel),
//! row scan for finder runs, vertical/horizontal cross-checks, clustering,
//! 4-point homography, 3×3-pixel sampling, nearest calibrated color, RS.
//! The matrix must be roughly upright (rotation < 45°).

use serde::Serialize;

use crate::error::GhostError;
use crate::fec;

pub const GRID: usize = 44;
const FINDER: usize = 7;
const ZONE: usize = FINDER + 1;
const CAL_ROW: usize = 0;
const CAL_COL: usize = ZONE;
const CAL_CELLS: usize = 24;
const CODEWORDS: usize = 3;
const PARITY: usize = 32;
/// Data cells: grid minus 4 finder zones minus the calibration strip.
pub const DATA_CELLS: usize = GRID * GRID - 4 * ZONE * ZONE - CAL_CELLS; // 1656
const CODEWORD_LEN: usize = DATA_CELLS * 3 / 8 / CODEWORDS; // 207
/// Payload bytes per matrix (one wide droplet).
pub const CHROMA_CAPACITY: usize = CODEWORDS * (CODEWORD_LEN - PARITY); // 525
pub const MAX_IMAGE_SIDE: usize = 4096;

/// Palette index → sRGB (bits r g b).
pub fn palette_rgb(index: u8) -> [u8; 3] {
    [
        if index & 0b100 != 0 { 255 } else { 0 },
        if index & 0b010 != 0 { 255 } else { 0 },
        if index & 0b001 != 0 { 255 } else { 0 },
    ]
}

const BLACK: u8 = 0;
const WHITE: u8 = 7;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Finder(u8),
    Calibration(u8),
    Data,
}

fn finder_cell(r: usize, c: usize) -> u8 {
    // r, c in 0..7 inside the finder; 7 = separator (white).
    if r == FINDER || c == FINDER {
        return WHITE;
    }
    let ring = r.min(c).min(FINDER - 1 - r).min(FINDER - 1 - c);
    if ring == 1 {
        WHITE
    } else {
        BLACK
    }
}

fn role(r: usize, c: usize) -> Role {
    let top = r < ZONE;
    let bottom = r >= GRID - ZONE;
    let left = c < ZONE;
    let right = c >= GRID - ZONE;
    // Local coordinates inside each corner zone, separator facing the centre.
    if top && left {
        return Role::Finder(finder_cell(r, c));
    }
    if top && right {
        return Role::Finder(finder_cell(r, GRID - 1 - c));
    }
    if bottom && left {
        return Role::Finder(finder_cell(GRID - 1 - r, c));
    }
    if bottom && right {
        return Role::Finder(finder_cell(GRID - 1 - r, GRID - 1 - c));
    }
    if r == CAL_ROW && (CAL_COL..CAL_COL + CAL_CELLS).contains(&c) {
        return Role::Calibration(((c - CAL_COL) % 8) as u8);
    }
    Role::Data
}

/// Byte stream position → (codeword, index): interleaving spreads a burst of
/// misread cells over the three codewords.
fn interleave(stream: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::with_capacity(CODEWORDS * CODEWORD_LEN);
    for i in 0..CODEWORD_LEN {
        for cw in stream {
            out.push(cw.get(i).copied().unwrap_or(0));
        }
    }
    out
}

fn deinterleave(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut cws: Vec<Vec<u8>> = (0..CODEWORDS).map(|_| Vec::with_capacity(CODEWORD_LEN)).collect();
    for (i, b) in bytes.iter().enumerate().take(CODEWORDS * CODEWORD_LEN) {
        if let Some(cw) = cws.get_mut(i % CODEWORDS) {
            cw.push(*b);
        }
    }
    cws
}

/// Cells (row-major, `GRID × GRID` palette indices) for `packet` (≤ capacity, zero-padded).
pub fn encode(packet: &[u8]) -> Result<Vec<u8>, GhostError> {
    if packet.len() > CHROMA_CAPACITY {
        return Err(GhostError::InvalidArgument { what: "chroma packet length" });
    }
    let mut padded = packet.to_vec();
    padded.resize(CHROMA_CAPACITY, 0);
    let data_len = CODEWORD_LEN - PARITY;
    let mut cws = Vec::with_capacity(CODEWORDS);
    for chunk in padded.chunks(data_len) {
        cws.push(fec::encode(chunk, PARITY)?);
    }
    let bytes = interleave(&cws);
    // Bits MSB first, 3 per data cell.
    let mut bits = Vec::with_capacity(bytes.len() * 8);
    for b in &bytes {
        for s in (0..8).rev() {
            bits.push((b >> s) & 1);
        }
    }
    let mut cells = Vec::with_capacity(GRID * GRID);
    let mut k = 0usize;
    for r in 0..GRID {
        for c in 0..GRID {
            cells.push(match role(r, c) {
                Role::Finder(v) | Role::Calibration(v) => v,
                Role::Data => {
                    let mut v = 0u8;
                    for _ in 0..3 {
                        v = (v << 1) | bits.get(k).copied().unwrap_or(0);
                        k += 1;
                    }
                    v
                }
            });
        }
    }
    Ok(cells)
}

// --- Decoder -------------------------------------------------------------------

struct Image<'a> {
    rgba: &'a [u8],
    w: usize,
    h: usize,
    dark_below: u8,
}

impl Image<'_> {
    fn px(&self, x: usize, y: usize) -> [u8; 3] {
        let i = (y * self.w + x) * 4;
        match self.rgba.get(i..i + 3) {
            Some(p) => [p[0], p[1], p[2]],
            None => [0, 0, 0],
        }
    }

    /// Black only: a dark pixel has *all* channels low (blue, red… are not dark).
    fn dark(&self, x: usize, y: usize) -> bool {
        let p = self.px(x, y);
        p[0].max(p[1]).max(p[2]) < self.dark_below
    }

    /// Mean color of a (2r+1)² patch around a sub-pixel point.
    fn sample(&self, x: f64, y: f64, r: i64) -> Option<[f64; 3]> {
        // A degenerate homography can yield NaN/∞ or huge coordinates.
        let limit = (self.w.max(self.h) as f64) * 2.0;
        if !x.is_finite() || !y.is_finite() || x.abs() > limit || y.abs() > limit {
            return None;
        }
        let (cx, cy) = (x.round() as i64, y.round() as i64);
        let mut acc = [0.0f64; 3];
        let mut n = 0.0;
        for dy in -r..=r {
            for dx in -r..=r {
                let (px, py) = (cx + dx, cy + dy);
                if px < 0 || py < 0 || px as usize >= self.w || py as usize >= self.h {
                    continue;
                }
                let p = self.px(px as usize, py as usize);
                for (a, v) in acc.iter_mut().zip(p.iter()) {
                    *a += *v as f64;
                }
                n += 1.0;
            }
        }
        if n == 0.0 {
            return None;
        }
        Some([acc[0] / n, acc[1] / n, acc[2] / n])
    }
}

/// 1:1:3:1:1 check with 50 % tolerance; returns the module size.
fn finder_ratio(runs: &[usize; 5]) -> Option<f64> {
    let total: usize = runs.iter().sum();
    if total < 7 {
        return None;
    }
    let m = total as f64 / 7.0;
    let tol = m * 0.5;
    let ok = runs.iter().enumerate().all(|(i, &r)| {
        let want = if i == 2 { 3.0 * m } else { m };
        let t = if i == 2 { 3.0 * tol } else { tol };
        (r as f64 - want).abs() <= t
    });
    ok.then_some(m)
}

/// Run lengths around (x, y) along a direction; returns the centre and module.
fn cross_check(img: &Image<'_>, x: usize, y: usize, vertical: bool, max_run: usize) -> Option<(f64, f64)> {
    let len = if vertical { img.h } else { img.w };
    let pos = if vertical { y } else { x };
    let at = |p: usize| if vertical { img.dark(x, p) } else { img.dark(p, y) };
    if !at(pos) {
        return None;
    }
    let mut runs = [0usize; 5];
    // Centre run (dark), then outward: light, dark on each side.
    let mut p = pos as i64;
    while p >= 0 && at(p as usize) && runs[2] <= max_run {
        runs[2] += 1;
        p -= 1;
    }
    while p >= 0 && !at(p as usize) && runs[1] <= max_run {
        runs[1] += 1;
        p -= 1;
    }
    while p >= 0 && at(p as usize) && runs[0] <= max_run {
        runs[0] += 1;
        p -= 1;
    }
    let mut q = pos + 1;
    while q < len && at(q) && runs[2] <= max_run {
        runs[2] += 1;
        q += 1;
    }
    while q < len && !at(q) && runs[3] <= max_run {
        runs[3] += 1;
        q += 1;
    }
    while q < len && at(q) && runs[4] <= max_run {
        runs[4] += 1;
        q += 1;
    }
    let m = finder_ratio(&runs)?;
    let end = q as f64 - runs[4] as f64 - runs[3] as f64;
    let centre = end - runs[2] as f64 / 2.0;
    Some((centre, m))
}

#[derive(Clone, Copy)]
struct Candidate {
    x: f64,
    y: f64,
    module: f64,
    hits: u32,
}

/// Upper bound on cross-checks per frame: a crafted stripe image cannot turn
/// one scan into hundreds of millions of pixel reads.
const MAX_CROSS_CHECKS: usize = 2000;

fn find_finders(img: &Image<'_>) -> Vec<Candidate> {
    let mut found: Vec<Candidate> = Vec::new();
    let step = (img.h / 360).max(1);
    let global_max_run = img.w.max(img.h) / 8;
    let mut budget = MAX_CROSS_CHECKS;
    let mut y = 0;
    while y < img.h && budget > 0 {
        let mut runs = [0usize; 5];
        let mut state = 0usize; // index in runs; even = dark, odd = light
        let mut x = 0;
        // Skip leading light pixels.
        while x < img.w && !img.dark(x, y) {
            x += 1;
        }
        while x < img.w {
            let d = img.dark(x, y);
            let want_dark = state.is_multiple_of(2);
            if d == want_dark {
                if let Some(r) = runs.get_mut(state) {
                    *r += 1;
                }
            } else if state < 4 {
                state += 1;
                if let Some(r) = runs.get_mut(state) {
                    *r = 1;
                }
            } else {
                // Five runs complete: test, then shift by two.
                if let Some(m0) = finder_ratio(&runs).filter(|_| budget > 0) {
                    budget -= 1;
                    // Vertical runs of a real finder match the horizontal module,
                    // so the walk is bounded by it rather than by the image size.
                    let max_run = ((m0 * 6.0) as usize).saturating_add(2).min(global_max_run.max(8));
                    let cx = x as f64 - runs[4] as f64 - runs[3] as f64 - runs[2] as f64 / 2.0;
                    if let Some((cy, mv)) = cross_check(img, cx as usize, y, true, max_run) {
                        if let Some((cx2, mh)) = cross_check(img, cx as usize, cy as usize, false, max_run) {
                            let m = (mv + mh) / 2.0;
                            if (mv - mh).abs() < m * 0.6 {
                                let near = found.iter().position(|c| (c.x - cx2).abs() < c.module * 3.0 && (c.y - cy).abs() < c.module * 3.0);
                                match near.and_then(|i| found.get_mut(i)) {
                                    Some(c) => {
                                        let n = c.hits as f64;
                                        c.x = (c.x * n + cx2) / (n + 1.0);
                                        c.y = (c.y * n + cy) / (n + 1.0);
                                        c.module = (c.module * n + m) / (n + 1.0);
                                        c.hits += 1;
                                    }
                                    None => {
                                        if found.len() < 64 {
                                            found.push(Candidate { x: cx2, y: cy, module: m, hits: 1 });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                runs = [runs[2], runs[3], runs[4], 1, 0];
                state = 3;
            }
            x += 1;
        }
        y += step;
    }
    found.sort_by_key(|c| std::cmp::Reverse(c.hits));
    found
}

/// Homography from 4 (cell space) → (image space) correspondences.
fn homography(src: &[(f64, f64); 4], dst: &[(f64, f64); 4]) -> Option<[f64; 9]> {
    let mut a = [[0.0f64; 9]; 8];
    for i in 0..4 {
        let (x, y) = src[i];
        let (u, v) = dst[i];
        a[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, u];
        a[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y, v];
    }
    for col in 0..8 {
        let pivot = (col..8).max_by(|&p, &q| a[p][col].abs().total_cmp(&a[q][col].abs()))?;
        if a[pivot][col].abs() < 1e-12 {
            return None;
        }
        a.swap(col, pivot);
        let pv = a[col][col];
        for v in a[col].iter_mut().skip(col) {
            *v /= pv;
        }
        let pivot_row = a[col];
        for (r, row) in a.iter_mut().enumerate() {
            let f = row[col];
            if r != col && f != 0.0 {
                for (x, p) in row.iter_mut().zip(pivot_row.iter()).skip(col) {
                    *x -= f * p;
                }
            }
        }
    }
    Some([a[0][8], a[1][8], a[2][8], a[3][8], a[4][8], a[5][8], a[6][8], a[7][8], 1.0])
}

fn project(h: &[f64; 9], x: f64, y: f64) -> (f64, f64) {
    let w = h[6] * x + h[7] * y + h[8];
    let w = if w.abs() < 1e-12 { 1e-12 } else { w };
    ((h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromaDecode {
    #[serde(skip)]
    pub packet: Vec<u8>,
    /// Bytes fixed by Reed-Solomon over the three codewords.
    pub corrected_bytes: usize,
    /// Matrix corners in image pixels (TL, TR, BR, BL), for the viewfinder overlay.
    pub corners: Vec<[f32; 2]>,
    pub module_px: f32,
}

/// Locates and reads one matrix in an RGBA image (`width × height × 4` bytes).
pub fn decode(rgba: &[u8], width: usize, height: usize) -> Result<ChromaDecode, GhostError> {
    if width < 32 || height < 32 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(rgba.len()) {
        return Err(GhostError::ChromaInvalidImage);
    }
    // Dark threshold from the image: midway between the 5th and 95th percentile of
    // the max channel (sampled on a coarse grid: O(1) memory).
    let mut hist = [0u32; 256];
    let stride = ((width * height) / 40_000).max(1);
    let mut i = 0usize;
    while i < width * height {
        let p = rgba.get(i * 4..i * 4 + 3).unwrap_or(&[0, 0, 0]);
        let m = p.iter().copied().max().unwrap_or(0) as usize;
        if let Some(h) = hist.get_mut(m) {
            *h += 1;
        }
        i += stride;
    }
    let total: u32 = hist.iter().sum();
    let pct = |q: f64| {
        let target = (total as f64 * q) as u32;
        let mut acc = 0u32;
        for (v, &n) in hist.iter().enumerate() {
            acc += n;
            if acc > target {
                return v as u8;
            }
        }
        255
    };
    let (lo, hi) = (pct(0.05), pct(0.95));
    if hi.saturating_sub(lo) < 40 {
        return Err(GhostError::ChromaNotFound);
    }
    let img = Image { rgba, w: width, h: height, dark_below: lo / 2 + hi / 2 };

    let found = find_finders(&img);
    if found.len() < 4 {
        return Err(GhostError::ChromaNotFound);
    }
    // The four strongest candidates of similar module size.
    let ref_m = found[0].module;
    let pts: Vec<Candidate> = found.into_iter().filter(|c| (c.module - ref_m).abs() < ref_m * 0.5).take(4).collect();
    if pts.len() < 4 {
        return Err(GhostError::ChromaNotFound);
    }
    let by = |f: &dyn Fn(&Candidate) -> f64, max: bool| -> Candidate {
        let mut best = pts[0];
        for c in &pts {
            if (max && f(c) > f(&best)) || (!max && f(c) < f(&best)) {
                best = *c;
            }
        }
        best
    };
    let tl = by(&|c| c.x + c.y, false);
    let br = by(&|c| c.x + c.y, true);
    let tr = by(&|c| c.x - c.y, true);
    let bl = by(&|c| c.x - c.y, false);
    let half = FINDER as f64 / 2.0;
    let far = GRID as f64 - half;
    let src = [(half, half), (far, half), (far, far), (half, far)];
    let dst = [(tl.x, tl.y), (tr.x, tr.y), (br.x, br.y), (bl.x, bl.y)];
    let h = homography(&src, &dst).ok_or(GhostError::ChromaNotFound)?;
    let module = (tl.module + tr.module + br.module + bl.module) / 4.0;
    let r = ((module / 4.0).floor() as i64).clamp(0, 3);

    // Calibrated palette: mean of the three samples of each color.
    let mut means = [[0.0f64; 3]; 8];
    let mut counts = [0.0f64; 8];
    for i in 0..CAL_CELLS {
        let c = CAL_COL + i;
        let (x, y) = project(&h, c as f64 + 0.5, CAL_ROW as f64 + 0.5);
        if let Some(p) = img.sample(x, y, r) {
            let k = i % 8;
            for j in 0..3 {
                means[k][j] += p[j];
            }
            counts[k] += 1.0;
        }
    }
    for (m, &n) in means.iter_mut().zip(counts.iter()) {
        if n == 0.0 {
            return Err(GhostError::ChromaNotFound);
        }
        for v in m.iter_mut() {
            *v /= n;
        }
    }
    // Black and white must be told apart, or the image is not a matrix.
    let contrast: f64 = (0..3).map(|j| means[7][j] - means[0][j]).sum();
    if contrast < 90.0 {
        return Err(GhostError::ChromaNotFound);
    }

    let mut bits = Vec::with_capacity(DATA_CELLS * 3);
    for row in 0..GRID {
        for col in 0..GRID {
            if role(row, col) != Role::Data {
                continue;
            }
            let (x, y) = project(&h, col as f64 + 0.5, row as f64 + 0.5);
            let v = match img.sample(x, y, r) {
                Some(p) => {
                    let mut best = (0u8, f64::MAX);
                    for (k, m) in means.iter().enumerate() {
                        let d = (p[0] - m[0]).powi(2) + (p[1] - m[1]).powi(2) + (p[2] - m[2]).powi(2);
                        if d < best.1 {
                            best = (k as u8, d);
                        }
                    }
                    best.0
                }
                None => 0,
            };
            bits.extend_from_slice(&[(v >> 2) & 1, (v >> 1) & 1, v & 1]);
        }
    }
    let mut bytes = Vec::with_capacity(bits.len() / 8);
    for chunk in bits.chunks(8) {
        if chunk.len() == 8 {
            bytes.push(chunk.iter().fold(0u8, |acc, b| (acc << 1) | b));
        }
    }
    let mut packet = Vec::with_capacity(CHROMA_CAPACITY);
    let mut corrected = 0;
    for cw in deinterleave(&bytes) {
        let (data, fixed) = fec::decode(&cw, PARITY).map_err(|_| GhostError::ChromaUncorrectable)?;
        corrected += fixed;
        packet.extend_from_slice(&data);
    }
    let corners = [(0.0, 0.0), (GRID as f64, 0.0), (GRID as f64, GRID as f64), (0.0, GRID as f64)]
        .iter()
        .map(|&(x, y)| {
            let (u, v) = project(&h, x, y);
            [u as f32, v as f32]
        })
        .collect();
    Ok(ChromaDecode { packet, corrected_bytes: corrected, corners, module_px: module as f32 })
}

/// Renders cells into an RGBA image (test helper and reference renderer):
/// `px` pixels per cell and a white quiet zone of `quiet` cells.
pub fn render(cells: &[u8], px: usize, quiet: usize) -> (Vec<u8>, usize) {
    let side = (GRID + 2 * quiet) * px;
    let mut out = vec![255u8; side * side * 4];
    for (i, &v) in cells.iter().enumerate().take(GRID * GRID) {
        let (r, c) = (i / GRID, i % GRID);
        let rgb = palette_rgb(v);
        for y in 0..px {
            for x in 0..px {
                let p = (((quiet + r) * px + y) * side + (quiet + c) * px + x) * 4;
                if let Some(slot) = out.get_mut(p..p + 3) {
                    slot.copy_from_slice(&rgb);
                }
            }
        }
    }
    (out, side)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet() -> Vec<u8> {
        (0..CHROMA_CAPACITY).map(|i| (i * 37 + 11) as u8).collect()
    }

    #[test]
    fn layout_constants() {
        assert_eq!(DATA_CELLS, 1656);
        assert_eq!(CODEWORD_LEN, 207);
        assert_eq!(CHROMA_CAPACITY, 525);
    }

    #[test]
    fn clean_render_roundtrips() {
        let cells = encode(&packet()).unwrap();
        let (rgba, side) = render(&cells, 6, 4);
        let d = decode(&rgba, side, side).unwrap();
        assert_eq!(d.packet, packet());
        assert_eq!(d.corrected_bytes, 0);
    }

    #[test]
    fn survives_offset_tint_and_noise() {
        let cells = encode(&packet()).unwrap();
        let (rgba, side) = render(&cells, 9, 4);
        // Place it off-centre in a larger gray frame with a warm white balance,
        // reduced contrast and pseudo-random sensor noise.
        let (w, h) = (side + 220, side + 140);
        let mut img = vec![90u8; w * h * 4];
        let mut seed: u32 = 7;
        for y in 0..side {
            for x in 0..side {
                let s = (y * side + x) * 4;
                let d = ((y + 60) * w + x + 150) * 4;
                for ch in 0..3 {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    let noise = (seed % 41) as i32 - 20;
                    let gain = [1.0, 0.85, 0.7][ch];
                    let v = 30.0 + rgba[s + ch] as f64 * 0.75 * gain + noise as f64;
                    img[d + ch] = v.clamp(0.0, 255.0) as u8;
                }
            }
        }
        let d = decode(&img, w, h).unwrap();
        assert_eq!(d.packet, packet());
    }

    #[test]
    fn small_perspective_tilt_is_corrected() {
        let cells = encode(&packet()).unwrap();
        let (rgba, side) = render(&cells, 8, 4);
        let (w, h) = (side + 120, side + 120);
        let mut img = vec![200u8; w * h * 4];
        // Inverse-map each output pixel through a keystone (top edge 8 % narrower).
        for y in 0..h {
            for x in 0..w {
                let fy = (y as f64 - 60.0) / side as f64;
                let shrink = 1.0 - 0.08 * (1.0 - fy);
                let cx = 60.0 + side as f64 / 2.0;
                let sx = ((x as f64 - cx) / shrink + side as f64 / 2.0).round();
                let sy = y as f64 - 60.0;
                if sx >= 0.0 && sy >= 0.0 && (sx as usize) < side && (sy as usize) < side {
                    let s = (sy as usize * side + sx as usize) * 4;
                    let d = (y * w + x) * 4;
                    img[d..d + 3].copy_from_slice(&rgba[s..s + 3]);
                }
            }
        }
        assert_eq!(decode(&img, w, h).unwrap().packet, packet());
    }

    #[test]
    fn noise_image_and_bad_buffers_are_refused() {
        let flat = vec![128u8; 200 * 200 * 4];
        assert_eq!(decode(&flat, 200, 200).unwrap_err(), GhostError::ChromaNotFound);
        assert_eq!(decode(&[0u8; 10], 200, 200).unwrap_err(), GhostError::ChromaInvalidImage);
        assert_eq!(decode(&[], 5000, 5000).unwrap_err(), GhostError::ChromaInvalidImage);
        assert!(encode(&vec![0u8; CHROMA_CAPACITY + 1]).is_err());
    }

    #[test]
    fn crafted_finder_stripes_are_bounded() {
        // Full-height 1:1:3:1:1 columns: every row matches the finder ratio and
        // every vertical cross-check would walk the whole column without bounds.
        let (w, h) = (4096usize, 2048usize);
        let pattern = [true, false, true, true, true, false, true, false];
        let mut img = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                if pattern[x % pattern.len()] {
                    let i = (y * w + x) * 4;
                    img[i..i + 3].copy_from_slice(&[0, 0, 0]);
                }
            }
        }
        let t = std::time::Instant::now();
        assert_eq!(decode(&img, w, h).unwrap_err(), GhostError::ChromaNotFound);
        assert!(t.elapsed().as_secs_f64() < 5.0, "scan took {:?}", t.elapsed());
    }

    #[test]
    fn non_finite_coordinates_are_not_sampled() {
        let img = vec![0u8; 64 * 64 * 4];
        let im = Image { rgba: &img, w: 64, h: 64, dark_below: 80 };
        assert!(im.sample(f64::NAN, 3.0, 1).is_none());
        assert!(im.sample(3.0, f64::INFINITY, 1).is_none());
        assert!(im.sample(1e300, 3.0, 1).is_none());
        assert!(im.sample(3.0, 3.0, 1).is_some());
    }
}
