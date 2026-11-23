;; Time-series helpers operating on f64 values in linear memory.
;;
;; All values are IEEE-754 f64 in little-endian byte order, 8 bytes per value.
;; The memory is exported so JavaScript can write inputs and read outputs.

(module
  ;; 2 pages initial (128 KiB), up to 16 pages (1 MiB).
  (memory (export "memory") 2 16)

  ;; Sums `len` f64 values starting at byte offset `ptr`.
  ;; Returns 0 when `len` is 0.
  (func $sum (export "sum")
    (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $addr i32)
    (local $acc f64)

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

  ;; Writes `len - window + 1` sliding-window averages as f64 values at
  ;; `outPtr` and returns the number of results written.
  ;; Returns 0 when `window <= 0` or `window > len`.
  (func $moving_average (export "moving_average")
    (param $ptr i32) (param $len i32) (param $window i32)
    (param $outPtr i32) (result i32)
    (local $i i32)
    (local $count i32)
    (local $outAddr i32)
    (local $winF64 f64)

    (if (i32.le_s (local.get $window) (i32.const 0))
      (then (return (i32.const 0)))
    )
    (if (i32.gt_s (local.get $window) (local.get $len))
      (then (return (i32.const 0)))
    )

    (local.set $count
      (i32.add (i32.sub (local.get $len) (local.get $window)) (i32.const 1)))
    (local.set $i (i32.const 0))
    (local.set $outAddr (local.get $outPtr))
    (local.set $winF64 (f64.convert_i32_s (local.get $window)))

    (block $done
      (loop $loop
        (br_if $done (i32.ge_s (local.get $i) (local.get $count)))
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
