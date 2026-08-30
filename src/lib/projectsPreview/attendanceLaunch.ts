export type AttendanceLaunchIntent = {
  workDate: string;
  action: "add";
};

let pending: AttendanceLaunchIntent | null = null;

export function setAttendanceLaunchIntent(intent: AttendanceLaunchIntent | null) {
  pending = intent;
}

export function consumeAttendanceLaunchIntent(): AttendanceLaunchIntent | null {
  const value = pending;
  pending = null;
  return value;
}
