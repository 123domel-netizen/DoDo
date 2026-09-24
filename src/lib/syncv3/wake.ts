type WakeFn = () => void;

let wakeImpl: WakeFn = () => {};

export function registerSyncV3Wake(fn: WakeFn) {
  wakeImpl = fn;
}

export function wakeSyncV3Worker() {
  wakeImpl();
}
