export function compileTimeseries(wabt, source) {
  const module = wabt.parseWat("timeseries.wat", source);
  try {
    module.resolveNames();
    module.validate();
    const { buffer } = module.toBinary({ write_debug_names: true });
    return Buffer.from(buffer);
  } finally {
    module.destroy();
  }
}
