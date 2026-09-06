// Type definitions for EverArk core (src/everark-core.mjs).
/// <reference types="node" />

export type State = null | boolean | number | string | State[] | { [k: string]: State };

export interface Shard { x: number; blk: number; bytes: Buffer; }

export interface Manifest {
  epoch: number;
  root: string;            // hex sha256 of the canonical plaintext
  cipher_hash: string;     // hex sha256 of the ciphertext
  k: number;
  n: number;
  blk: number;             // shard block length in bytes
  shard_digests: string[]; // hex H(x ‖ shard bytes), length n
  shard_x: number[];       // shard x-coordinates 1..n, length n
  manifest_hash: string;   // hex; binds every field above, equals the anchor's manifest hash
}

export interface CheckpointResult { anchor: Buffer; manifest: Manifest; shards: Shard[]; }

/** sha256 (Buffer). */
export function H(b: Buffer | string): Buffer;
/** hex-encode. */
export function hx(b: Buffer | Uint8Array): string;

/** Current anchor wire version (1). */
export const CURRENT_ANCHOR_VERSION: number;

/** Strict canonical serialization; throws FAIL-CLOSED on any value JSON can't round-trip losslessly. */
export function canon(state: State): Buffer;
/** sha256 of the canonical form. */
export function stateRoot(state: State): Buffer;
/** EverArk-equality: same canonical form (key order normalized). Use instead of JSON.stringify compare. */
export function equalsState(a: State, b: State): boolean;

/** Reed-Solomon (GF(256), MDS): encode into n shards, any k reconstruct. */
export function rsEncode(data: Buffer, k: number, n: number): Shard[];
/** Decode from >= k shards. */
export function rsDecode(shards: Array<{ x: number; bytes: Buffer }>, k: number): Buffer;

/** aes-256-gcm; returns iv|tag|ct. secret must be 32 bytes. */
export function encryptState(bytes: Buffer, secret: Buffer | string): Buffer;
export function decryptState(cipher: Buffer, secret: Buffer | string): Buffer;

/** Checkpoint a state to an anchor + manifest + shards. version 1 (default) = 75-byte anchor; 0 = legacy 74. */
export function checkpoint(
  state: State, secret: Buffer | string, k: number, n: number, epoch?: number,
  opts?: { version?: 0 | 1 },
): CheckpointResult;

/** Fail-closed resurrection: returns the true state committed by the anchor, or throws. */
export function resurrect(
  anchor: Buffer, manifest: Manifest, availableShards: Array<{ x: number; bytes: Buffer }>, secret: Buffer | string,
): State;
