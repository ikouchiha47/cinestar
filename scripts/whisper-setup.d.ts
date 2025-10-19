export interface WhisperSetupResult {
  success: boolean;
  model?: string;
  modelPath?: string;
  cuda?: boolean;
  whisperCppPath?: string;
  error?: string;
}

export function downloadAndBuildWhisper(
  modelName?: string, 
  useCuda?: boolean | null
): Promise<WhisperSetupResult>;
