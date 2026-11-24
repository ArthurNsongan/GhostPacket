//! Reed-Solomon over GF(256), primitive polynomial 0x11D, generator α = 2,
//! first consecutive root α^0. Systematic encoding: `data || parity`.
//!
//! A codeword of `n <= 255` bytes with `nsym` parity bytes corrects up to
//! `nsym / 2` byte errors. Polynomials are stored highest degree first.

use crate::error::GhostError;

pub const MAX_CODEWORD: usize = 255;

const fn build_tables() -> ([u8; 512], [u8; 256]) {
    let mut exp = [0u8; 512];
    let mut log = [0u8; 256];
    let mut x: u16 = 1;
    let mut i = 0;
    while i < 255 {
        exp[i] = x as u8;
        log[x as usize] = i as u8;
        x <<= 1;
        if x & 0x100 != 0 {
            x ^= 0x11D;
        }
        i += 1;
    }
    while i < 512 {
        exp[i] = exp[i - 255];
        i += 1;
    }
    (exp, log)
}

const TABLES: ([u8; 512], [u8; 256]) = build_tables();
const EXP: [u8; 512] = TABLES.0;
const LOG: [u8; 256] = TABLES.1;

#[inline]
fn exp(i: usize) -> u8 {
    EXP.get(i % 255).copied().unwrap_or(0)
}

#[inline]
fn log(x: u8) -> usize {
    LOG.get(x as usize).copied().unwrap_or(0) as usize
}

#[inline]
fn mul(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 {
        0
    } else {
        exp(log(a) + log(b))
    }
}

#[inline]
fn div(a: u8, b: u8) -> Option<u8> {
    if b == 0 {
        None
    } else if a == 0 {
        Some(0)
    } else {
        Some(exp(log(a) + 255 - log(b)))
    }
}

#[inline]
fn inv(a: u8) -> Option<u8> {
    div(1, a)
}

/// α^power (power may be any non-negative integer).
#[inline]
fn alpha_pow(power: usize) -> u8 {
    exp(power % 255)
}

fn poly_scale(p: &[u8], x: u8) -> Vec<u8> {
    p.iter().map(|&c| mul(c, x)).collect()
}

fn poly_add(p: &[u8], q: &[u8]) -> Vec<u8> {
    let len = p.len().max(q.len());
    let mut r = vec![0u8; len];
    for (slot, &c) in r.iter_mut().skip(len - p.len()).zip(p.iter()) {
        *slot = c;
    }
    for (slot, &c) in r.iter_mut().skip(len - q.len()).zip(q.iter()) {
        *slot ^= c;
    }
    r
}

fn poly_mul(p: &[u8], q: &[u8]) -> Vec<u8> {
    if p.is_empty() || q.is_empty() {
        return Vec::new();
    }
    let mut r = vec![0u8; p.len() + q.len() - 1];
    for (i, &a) in p.iter().enumerate() {
        if a == 0 {
            continue;
        }
        for (j, &b) in q.iter().enumerate() {
            if let Some(slot) = r.get_mut(i + j) {
                *slot ^= mul(a, b);
            }
        }
    }
    r
}

fn poly_eval(p: &[u8], x: u8) -> u8 {
    let mut iter = p.iter();
    let mut y = match iter.next() {
        Some(&c) => c,
        None => return 0,
    };
    for &c in iter {
        y = mul(y, x) ^ c;
    }
    y
}

/// Remainder of `dividend / divisor` for a monic divisor.
fn poly_rem(dividend: &[u8], divisor: &[u8]) -> Vec<u8> {
    let dlen = divisor.len();
    if dlen == 0 || dividend.len() < dlen {
        return dividend.to_vec();
    }
    let mut out = dividend.to_vec();
    for i in 0..(dividend.len() - (dlen - 1)) {
        let coef = out.get(i).copied().unwrap_or(0);
        if coef == 0 {
            continue;
        }
        for (j, &d) in divisor.iter().enumerate().skip(1) {
            if d != 0 {
                if let Some(slot) = out.get_mut(i + j) {
                    *slot ^= mul(d, coef);
                }
            }
        }
    }
    out.split_off(out.len() - (dlen - 1))
}

fn generator_poly(nsym: usize) -> Vec<u8> {
    let mut g = vec![1u8];
    for i in 0..nsym {
        g = poly_mul(&g, &[1, alpha_pow(i)]);
    }
    g
}

/// Returns `data || parity` (`nsym` parity bytes).
pub fn encode(data: &[u8], nsym: usize) -> Result<Vec<u8>, GhostError> {
    if nsym == 0 || data.is_empty() || data.len() + nsym > MAX_CODEWORD {
        return Err(GhostError::InvalidArgument {
            what: "reed-solomon block size",
        });
    }
    let gen = generator_poly(nsym);
    let mut out = data.to_vec();
    out.resize(data.len() + nsym, 0);
    for i in 0..data.len() {
        let coef = out.get(i).copied().unwrap_or(0);
        if coef == 0 {
            continue;
        }
        for (j, &g) in gen.iter().enumerate().skip(1) {
            if let Some(slot) = out.get_mut(i + j) {
                *slot ^= mul(g, coef);
            }
        }
    }
    // Restore the systematic data part.
    for (slot, &d) in out.iter_mut().zip(data.iter()) {
        *slot = d;
    }
    Ok(out)
}

fn syndromes(codeword: &[u8], nsym: usize) -> Vec<u8> {
    (0..nsym).map(|i| poly_eval(codeword, alpha_pow(i))).collect()
}

/// Berlekamp–Massey. `synd` is the plain syndrome list S0..S(nsym-1).
fn error_locator(synd: &[u8], nsym: usize) -> Result<Vec<u8>, GhostError> {
    let mut err_loc = vec![1u8];
    let mut old_loc = vec![1u8];
    for k in 0..nsym {
        let mut delta = synd.get(k).copied().unwrap_or(0);
        for j in 1..err_loc.len() {
            let coef = err_loc
                .get(err_loc.len() - 1 - j)
                .copied()
                .unwrap_or(0);
            let s = if k >= j {
                synd.get(k - j).copied().unwrap_or(0)
            } else {
                0
            };
            delta ^= mul(coef, s);
        }
        old_loc.push(0);
        if delta != 0 {
            if old_loc.len() > err_loc.len() {
                let new_loc = poly_scale(&old_loc, delta);
                let inv_delta = inv(delta).ok_or(GhostError::FecUncorrectable)?;
                old_loc = poly_scale(&err_loc, inv_delta);
                err_loc = new_loc;
            }
            err_loc = poly_add(&err_loc, &poly_scale(&old_loc, delta));
        }
    }
    while err_loc.first() == Some(&0) {
        err_loc.remove(0);
    }
    let errs = err_loc.len().saturating_sub(1);
    if errs * 2 > nsym {
        return Err(GhostError::FecUncorrectable);
    }
    Ok(err_loc)
}

/// Chien search: positions (index into the codeword) where errors occurred.
fn find_errors(err_loc_rev: &[u8], n: usize) -> Result<Vec<usize>, GhostError> {
    let errs = err_loc_rev.len().saturating_sub(1);
    let mut pos = Vec::with_capacity(errs);
    for i in 0..n {
        if poly_eval(err_loc_rev, alpha_pow(i)) == 0 {
            pos.push(n - 1 - i);
        }
    }
    if pos.len() != errs {
        return Err(GhostError::FecUncorrectable);
    }
    Ok(pos)
}

/// Forney algorithm: computes and applies error magnitudes.
fn correct_errata(codeword: &mut [u8], synd: &[u8], err_pos: &[usize]) -> Result<(), GhostError> {
    let n = codeword.len();
    let coef_pos: Vec<usize> = err_pos.iter().map(|&p| n - 1 - p).collect();

    // Errata locator Λ(x) = Π (1 + X_i x) using coefficient positions.
    let mut e_loc = vec![1u8];
    for &c in &coef_pos {
        e_loc = poly_mul(&e_loc, &poly_add(&[1], &[alpha_pow(c), 0]));
    }

    // Error evaluator Ω(x) = S(x) Λ(x) mod x^(ν+1), with S in reversed order
    // and a leading zero term (matches the classic formulation).
    let mut synd_padded = Vec::with_capacity(synd.len() + 1);
    synd_padded.push(0u8);
    synd_padded.extend_from_slice(synd);
    let synd_rev: Vec<u8> = synd_padded.iter().rev().copied().collect();
    let nu = e_loc.len().saturating_sub(1);
    let mut modulus = vec![0u8; nu + 2];
    if let Some(first) = modulus.first_mut() {
        *first = 1;
    }
    let mut err_eval = poly_rem(&poly_mul(&synd_rev, &e_loc), &modulus);
    err_eval.reverse();

    let x: Vec<u8> = coef_pos.iter().map(|&c| alpha_pow(c)).collect();
    for (i, &xi) in x.iter().enumerate() {
        let xi_inv = inv(xi).ok_or(GhostError::FecUncorrectable)?;
        let mut loc_prime = 1u8;
        for (j, &xj) in x.iter().enumerate() {
            if j != i {
                loc_prime = mul(loc_prime, 1 ^ mul(xi_inv, xj));
            }
        }
        let err_eval_rev: Vec<u8> = err_eval.iter().rev().copied().collect();
        let y = mul(xi, poly_eval(&err_eval_rev, xi_inv));
        let magnitude = div(y, loc_prime).ok_or(GhostError::FecUncorrectable)?;
        let p = err_pos.get(i).copied().ok_or(GhostError::FecUncorrectable)?;
        let slot = codeword.get_mut(p).ok_or(GhostError::FecUncorrectable)?;
        *slot ^= magnitude;
    }
    Ok(())
}

/// Corrects `codeword` in place and returns `(data, corrected_byte_count)`.
pub fn decode(codeword: &[u8], nsym: usize) -> Result<(Vec<u8>, usize), GhostError> {
    let n = codeword.len();
    if nsym == 0 || n <= nsym || n > MAX_CODEWORD {
        return Err(GhostError::InvalidArgument {
            what: "reed-solomon block size",
        });
    }
    let mut msg = codeword.to_vec();
    let synd = syndromes(&msg, nsym);
    if synd.iter().all(|&s| s == 0) {
        msg.truncate(n - nsym);
        return Ok((msg, 0));
    }
    let err_loc = error_locator(&synd, nsym)?;
    let err_loc_rev: Vec<u8> = err_loc.iter().rev().copied().collect();
    let err_pos = find_errors(&err_loc_rev, n)?;
    correct_errata(&mut msg, &synd, &err_pos)?;
    if syndromes(&msg, nsym).iter().any(|&s| s != 0) {
        return Err(GhostError::FecUncorrectable);
    }
    let corrected = err_pos.len();
    msg.truncate(n - nsym);
    Ok((msg, corrected))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_without_errors() {
        let data: Vec<u8> = (0..200u8).collect();
        let cw = encode(&data, 16).unwrap();
        assert_eq!(cw.len(), 216);
        let (out, fixed) = decode(&cw, 16).unwrap();
        assert_eq!(out, data);
        assert_eq!(fixed, 0);
    }

    #[test]
    fn corrects_up_to_t_errors() {
        let data: Vec<u8> = (0..239u32).map(|i| (i * 7 + 3) as u8).collect();
        let cw = encode(&data, 16).unwrap();
        for errors in 1..=8usize {
            let mut bad = cw.clone();
            for e in 0..errors {
                let p = (e * 31 + 5) % bad.len();
                bad[p] ^= 0xA5 ^ (e as u8);
            }
            let (out, fixed) = decode(&bad, 16).unwrap();
            assert_eq!(out, data, "errors = {errors}");
            assert_eq!(fixed, errors);
        }
    }

    #[test]
    fn rejects_too_many_errors() {
        let data = vec![0x42u8; 100];
        let cw = encode(&data, 4).unwrap();
        let mut bad = cw.clone();
        for p in [0usize, 10, 20, 30, 40] {
            bad[p] ^= 0xFF;
        }
        match decode(&bad, 4) {
            Ok((out, _)) => assert_ne!(out, data),
            Err(e) => assert_eq!(e, GhostError::FecUncorrectable),
        }
    }

    #[test]
    fn short_header_block() {
        let data = [0x01u8, 0x14];
        let cw = encode(&data, 4).unwrap();
        let mut bad = cw.clone();
        bad[0] ^= 0x80;
        bad[3] ^= 0x01;
        let (out, _) = decode(&bad, 4).unwrap();
        assert_eq!(out, data);
    }
}
