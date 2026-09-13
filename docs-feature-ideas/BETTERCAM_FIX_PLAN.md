# BetterCam Integration Fix Plan

## Issues Identified

### Issue 1: Retry Logic When BetterCam Returns None
**Location:** `_BetterCamCaptureBackend.capture_bgra()` (lines 1838-1848)
- **Problem:** When `bettercam.grab()` returns `None`, the code retries up to 3 times with delays
- **User Requirement:** Should crash immediately, not retry
- **Impact:** Hides failures and delays error detection

### Issue 2: Inefficient Multiple Full Frame Captures
**Location:** Multiple locations calling `capture_bgra()` individually
- **Problem:** Each ROI/zone capture calls `capture_bgra()`, which:
  1. Grabs the full frame
  2. Crops to the requested region
  3. Returns the cropped bytes
  
  This means if we have 5 ROIs, we grab the full frame 5 times per tick!
- **User Requirement:** 
  - Change signature to accept list of all zones
  - Take 1 full screenshot
  - Extract all zones from that screenshot
  - Return whole list of results
- **Impact:** Performance degradation, especially with multiple detectors

## Current Architecture

### Capture Backend Interface
- `get_frame_size() -> Tuple[int, int]` - Get full frame dimensions
- `capture_bgra(left, top, width, height) -> bytes` - Capture single ROI

### Current Usage Patterns

#### In `_run_loop()`:
1. **Redness ROIs** (lines 993-1076): One `capture_bgra()` call per ROI in loop
2. **Health Bars** (lines 1078-1207): One `capture_bgra()` call per health bar in loop  
3. **Health Numbers** (lines 1209-1354): One `capture_bgra()` call per health number in loop

#### In `test_profile_once()`:
1. **Redness ROIs** (lines 646-675): One `capture_bgra()` call per ROI
2. **Health Bars** (lines 677-718): One `capture_bgra()` call per health bar
3. **Health Numbers** (lines 720-764): One `capture_bgra()` call per health number

## Proposed Solution

### Phase 1: Remove Retry Logic

#### 1.1 Remove retry in `capture_bgra()` (lines 1838-1848)
- Remove the `for attempt in range(3)` loop
- Call `self._cap.grab()` once
- If `None`, immediately raise `RuntimeError("bettercam grab returned None")`
- Remove the `time.sleep(0.05)` delay

#### 1.2 Consider initialization retry (lines 1810-1819)
- This is in `_ensure()` during initialization
- **Decision needed:** Keep retry for initialization (seems reasonable) or remove it too?
- **Recommendation:** Keep initialization retry but document it's only for startup

### Phase 2: Add Batch Capture Method

#### 2.1 Add new method to `_BetterCamCaptureBackend`
```python
def capture_multiple_bgra(self, regions: List[Tuple[int, int, int, int]]) -> List[bytes]:
    """
    Capture multiple regions from a single full frame grab.
    
    Args:
        regions: List of (left, top, width, height) tuples
        
    Returns:
        List of BGRA byte arrays, one per region (same order as input)
        
    Raises:
        RuntimeError: If bettercam.grab() returns None
    """
```

**Implementation:**
1. `_ensure()` if needed
2. Call `self._cap.grab()` **once** (no retry - crash if None)
3. For each region in `regions`:
   - Extract crop: `frame[top:top+height, left:left+width]`
   - Convert to bytes: `cropped.tobytes(order="C")`
   - Append to results list
4. Return list of bytes

#### 2.2 Keep `capture_bgra()` for backward compatibility
- Can be implemented as a wrapper: `return self.capture_multiple_bgra([(left, top, width, height)])[0]`
- Or keep separate implementation for single ROI (simpler, less overhead)

### Phase 3: Refactor `_run_loop()` to Use Batch Capture

#### 3.1 Collect all ROIs at start of loop iteration
```python
# Collect all regions to capture
all_regions: List[Tuple[str, str, int, int, int, int]] = []
# Format: (detector_type, name, left, top, width, height)

# Redness ROIs
if profile.redness_detector is not None:
    for roi in profile.redness_rois:
        left, top, w, h = normalized_rect_to_pixels(roi.rect, frame_w, frame_h)
        all_regions.append(("redness", roi.name, left, top, w, h))

# Health bars
for hb in profile.health_bars:
    left, top, w, h = normalized_rect_to_pixels(hb.rect, frame_w, frame_h)
    all_regions.append(("health_bar", hb.name, left, top, w, h))

# Health numbers
for hn in profile.health_numbers:
    if hn.templates is not None:
        left, top, w, h = normalized_rect_to_pixels(hn.rect, frame_w, frame_h)
        all_regions.append(("health_number", hn.name, left, top, w, h))
```

#### 3.2 Single batch capture call
```python
if all_regions:
    try:
        regions_only = [(l, t, w, h) for _, _, l, t, w, h in all_regions]
        captured_data = capture.capture_multiple_bgra(regions_only)
    except Exception as e:
        logger.error(f"Batch capture failed: {e}")
        continue  # Skip this tick
```

#### 3.3 Process results
- Iterate through `all_regions` and `captured_data` together
- Process each detector type with its corresponding captured bytes
- Keep existing logic for scoring, thresholds, cooldowns, etc.

### Phase 4: Refactor `test_profile_once()` to Use Batch Capture

#### 4.1 Similar pattern to `_run_loop()`
- Collect all regions first
- Single batch capture
- Process results

### Phase 5: Update `_MSSCaptureBackend` (if needed)

#### 5.1 Check if MSS supports batch capture
- MSS might support region parameter in `grab()`
- If so, can optimize similarly
- If not, implement same pattern (grab full, crop multiple)

## Implementation Order

1. **Phase 1.1** - Remove retry logic (quick fix, low risk)
2. **Phase 2.1** - Add `capture_multiple_bgra()` method (new functionality)
3. **Phase 2.2** - Keep `capture_bgra()` working (backward compatibility)
4. **Phase 3** - Refactor `_run_loop()` (main performance improvement)
5. **Phase 4** - Refactor `test_profile_once()` (consistency)
6. **Phase 5** - Update MSS backend if needed (optional optimization)

## Testing Considerations

1. **Error handling:** Verify that `None` from `grab()` immediately raises
2. **Performance:** Measure improvement with multiple ROIs (should be ~N times faster for N ROIs)
3. **Correctness:** Verify extracted regions match individual captures
4. **Edge cases:** Empty regions list, invalid coordinates, frame size changes

## Risk Assessment

- **Low Risk:** Phase 1 (removing retry) - straightforward
- **Medium Risk:** Phase 2 (new method) - needs careful testing
- **High Risk:** Phase 3 & 4 (refactoring loops) - complex logic changes, needs thorough testing

## Backward Compatibility

- Keep `capture_bgra()` method for any external callers
- Internal refactoring doesn't break external API
