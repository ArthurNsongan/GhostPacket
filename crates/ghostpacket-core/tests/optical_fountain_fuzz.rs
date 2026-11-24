//! Optical channel fuzzing: 100 deterministic seeds per loss rate, receiver
//! joining mid-stream, one-way channel (no feedback).
//!
//! Target: 100 % reconstruction at 30 % and 40 % loss, and at 50 % loss,
//! within a bounded number of displayed QR frames.

mod common;

use common::*;
use ghostpacket_core::channel_sim::is_dropped;
use ghostpacket_core::fountain::{FountainDecoder, FountainEncoder, DEFAULT_BLOCK_SIZE};
use ghostpacket_core::protocol::decode_and_verify_frame;

const SEEDS: u64 = 100;

struct Outcome {
    emitted: usize,
    received: usize,
}

fn transmit(frame: &[u8], loss_pct: f32, seed: u64, max_emitted: usize) -> Option<Outcome> {
    let enc = FountainEncoder::new(frame, (seed as u16) ^ 0x5A5A, DEFAULT_BLOCK_SIZE).unwrap();
    let mut dec = FountainDecoder::new();
    let start = (seed * 7) as u32; // receiver joins mid-stream
    let mut received = 0usize;
    for i in 0..max_emitted {
        if is_dropped(seed, i as u64, loss_pct) {
            continue;
        }
        received += 1;
        let step = dec.ingest(&enc.droplet(start + i as u32)).unwrap();
        if step.complete {
            let out = dec.frame().unwrap();
            assert_eq!(out, frame, "seed {seed}: wrong reconstruction");
            decode_and_verify_frame(&out, &[]).expect("reconstructed frame verifies");
            return Some(Outcome {
                emitted: i + 1,
                received,
            });
        }
    }
    None
}

fn run(loss_pct: f32, max_emitted_factor: usize) {
    for (name, draft) in presets() {
        let frame = encode(draft).bytes;
        let k = frame.len().div_ceil(DEFAULT_BLOCK_SIZE);
        let max_emitted = k * max_emitted_factor;
        let mut emitted = Vec::new();
        let mut received = Vec::new();
        for seed in 0..SEEDS {
            match transmit(&frame, loss_pct, seed, max_emitted) {
                Some(o) => {
                    emitted.push(o.emitted);
                    received.push(o.received);
                }
                None => panic!("{name}: seed {seed} incomplete after {max_emitted} QR frames at {loss_pct}% loss"),
            }
        }
        let avg = |v: &[usize]| v.iter().sum::<usize>() as f64 / v.len() as f64;
        let worst = emitted.iter().copied().max().unwrap_or(0);
        println!(
            "{name:<12} K={k:>2} loss {loss_pct:>4.0}%: avg received {:.1} ({:.2}K), avg shown {:.1}, worst shown {worst} ({:.1} s @10 FPS)",
            avg(&received),
            avg(&received) / k as f64,
            avg(&emitted),
            worst as f64 / 10.0
        );
    }
}

#[test]
fn reconstructs_with_30_percent_loss() {
    run(30.0, 4);
}

#[test]
fn reconstructs_with_40_percent_loss() {
    run(40.0, 5);
}

#[test]
fn reconstructs_with_50_percent_loss() {
    run(50.0, 6);
}
