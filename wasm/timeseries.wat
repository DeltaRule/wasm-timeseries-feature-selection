;; Time-series helpers for JavaScript consumers. No host imports.
;;
;; MEMORY ABI
;;   - One exported memory: 2 pages initial (128 KiB), 16 pages maximum.
;;   - Every number is an IEEE-754 f64: 8 bytes, little-endian.
;;   - `ptr` and `outPtr` parameters are BYTE offsets, not element indices.
;;     Input element i lives at ptr + 8*i; output element i at outPtr + 8*i.
;;   - Suggested layout: input series at byte 0, output at byte 1024.
;;     That leaves 128 f64 slots before the output region; callers must keep
;;     the regions non-overlapping and reserve count * 8 bytes for results.
;;
;; EXPORTS
;;   sum(ptr: i32, len: i32) -> f64
;;     Sum of `len` f64 values starting at `ptr`; 0.0 when len <= 0.
;;     Writes nothing: the result is returned as a scalar f64.
;;   moving_average(ptr: i32, len: i32, window: i32, outPtr: i32) -> i32
;;     Writes `len - window + 1` sliding-window averages at `outPtr` and
;;     returns that count. Result i is the mean of inputs i..i+window-1.
;;     Returns 0 and writes nothing when window < 1 or window > len.

(module
  (memory (export "memory") 2 16)

  (func $sum (export "sum")
    (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $addr i32)
    (local $acc f64)

    (if (i32.le_s (local.get $len) (i32.const 0))
      (then (return (f64.const 0))))

    (local.set $i (i32.const 0))
    (local.set $addr (local.get $ptr))
    (local.set $acc (f64.const 0))

    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $acc
          (f64.add (local.get $acc) (f64.load (local.get $addr))))
        (local.set $addr (i32.add (local.get $addr) (i32.const 8)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (local.get $acc)
  )

  (func $moving_average (export "moving_average")
    (param $ptr i32) (param $len i32) (param $window i32) (param $outPtr i32)
    (result i32)
    (local $i i32)
    (local $count i32)
    (local $outAddr i32)
    (local $winF64 f64)

    (if (i32.le_s (local.get $window) (i32.const 0))
      (then (return (i32.const 0))))
    (if (i32.gt_s (local.get $window) (local.get $len))
      (then (return (i32.const 0))))

    (local.set $count
      (i32.add (i32.sub (local.get $len) (local.get $window)) (i32.const 1)))
    (local.set $i (i32.const 0))
    (local.set $outAddr (local.get $outPtr))
    (local.set $winF64 (f64.convert_i32_s (local.get $window)))

    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
        (f64.store
          (local.get $outAddr)
          (f64.div
            (call $sum
              (i32.add
                (local.get $ptr)
                (i32.mul (local.get $i) (i32.const 8)))
              (local.get $window))
            (local.get $winF64)
          )
        )
        (local.set $outAddr (i32.add (local.get $outAddr) (i32.const 8)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (local.get $count)
  )
)
