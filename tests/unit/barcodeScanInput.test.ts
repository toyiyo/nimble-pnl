import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseScannedBarcode,
  SCAN_FORMAT,
  SCAN_IDLE_MS,
  MIN_TIMEOUT_BARCODE_LENGTH,
  createScanAssembler,
} from '@/lib/barcodeScanInput';

describe('parseScannedBarcode', () => {
  it('strips the @@ prefix and returns the code', () => {
    expect(parseScannedBarcode('@@012345678905', 1)).toBe('012345678905');
  });

  it('strips the ]Q prefix', () => {
    expect(parseScannedBarcode(']Q012345678905', 1)).toBe('012345678905');
  });

  it('trims surrounding whitespace', () => {
    expect(parseScannedBarcode('  012345  ', 1)).toBe('012345');
  });

  it('returns null when shorter than minLength', () => {
    expect(parseScannedBarcode('ab', 3)).toBeNull();
  });

  it('returns the code at exactly minLength', () => {
    expect(parseScannedBarcode('abc', 3)).toBe('abc');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(parseScannedBarcode('   ', 1)).toBeNull();
  });

  it('exposes stable constants', () => {
    expect(SCAN_FORMAT).toBe('KeyboardHID');
    expect(SCAN_IDLE_MS).toBeGreaterThan(0);
    expect(MIN_TIMEOUT_BARCODE_LENGTH).toBeGreaterThanOrEqual(2);
  });
});

describe('createScanAssembler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeAssembler(extra?: { onReject?: () => void }) {
    const onScan = vi.fn();
    const assembler = createScanAssembler({
      onScan,
      onReject: extra?.onReject,
      schedule: (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
      clearScheduled: (id) => window.clearTimeout(id),
    });
    return { onScan, assembler };
  }

  it('iOS path: enter() emits the buffered value once and cancels the idle timer', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    assembler.enter();
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', SCAN_FORMAT);
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('Android path: idle timeout emits once when Enter never arrives', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    expect(onScan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', SCAN_FORMAT);
  });

  it('re-arms the idle window on each feed (no premature flush)', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012');
    vi.advanceTimersByTime(SCAN_IDLE_MS - 10);
    assembler.feed('012345');
    vi.advanceTimersByTime(SCAN_IDLE_MS - 10);
    expect(onScan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onScan).toHaveBeenCalledWith('012345', SCAN_FORMAT);
  });

  it('rejects a stray short buffer on idle timeout but emits it on explicit enter()', () => {
    const a = makeAssembler();
    a.assembler.feed('a');
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(a.onScan).not.toHaveBeenCalled();

    const b = makeAssembler();
    b.assembler.feed('a');
    b.assembler.enter();
    expect(b.onScan).toHaveBeenCalledWith('a', SCAN_FORMAT);
  });

  it('calls onReject when idle timeout fires with a too-short buffer', () => {
    const onReject = vi.fn();
    const { onScan, assembler } = makeAssembler({ onReject });
    // Feed a 1-char buffer — below MIN_TIMEOUT_BARCODE_LENGTH (3).
    assembler.feed('x');
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(onScan).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onReject when enter() is called on an empty buffer', () => {
    // Regression: onReject is idle-timeout only; explicit Enter with no buffer must NOT reject.
    const onReject = vi.fn();
    const { onScan, assembler } = makeAssembler({ onReject });
    assembler.enter();
    expect(onScan).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('does NOT call onReject when idle timeout emits a valid barcode', () => {
    const onReject = vi.fn();
    const { onScan, assembler } = makeAssembler({ onReject });
    assembler.feed('012345678905');
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('suppresses idle flush while composing, then emits after compositionend', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.setComposing(true);
    assembler.feed('012345678905');
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).not.toHaveBeenCalled();
    assembler.setComposing(false);
    vi.advanceTimersByTime(SCAN_IDLE_MS);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('012345678905', SCAN_FORMAT);
  });

  it('does not emit after dispose() (no post-stop timer)', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    assembler.dispose();
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not double-emit the same buffer (enter then idle)', () => {
    const { onScan, assembler } = makeAssembler();
    assembler.feed('012345678905');
    assembler.enter();
    vi.advanceTimersByTime(SCAN_IDLE_MS * 2);
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});
