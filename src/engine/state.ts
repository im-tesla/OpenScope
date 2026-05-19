export type AppMode = 'idle' | 'sweeping' | 'focusing' | 'jogging' | 'error';

export interface AppState {
  mode: AppMode;
  serialConnected: boolean;
  cameraReady: boolean;
  position: number;
  focusScore: number;
  sweepIndex: number;
  sweepTotal: number;
  errorMessage: string | null;
}

export interface FocusPoint {
  position: number;
  score: number;
}

export interface SweepParams {
  range: number;
  stepInterval: number;
}

export interface MotorParams {
  speed: number;
  acceleration: number;
  pulseWidth: number;
  holdTime: number;
}

export const defaultSweep: SweepParams = {
  range: 1000,
  stepInterval: 50,
};

export const defaultMotor: MotorParams = {
  speed: 3000,
  acceleration: 8000,
  pulseWidth: 3,
  holdTime: 0,
};
