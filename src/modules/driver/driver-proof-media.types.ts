export type DriverProofMediaSource = 'camera' | 'library';

export type StoreDriverProofMediaInput = {
  contentType: string;
  deliveryStopId: string;
  driverId: string;
  fileBytes: Buffer;
  filename: string;
  routePlanId: string;
  shopDomain: string;
  source: DriverProofMediaSource;
};

export type StoreDriverProofMediaResult = {
  contentType: string;
  kind: 'photo';
  mediaId: string;
  sha256: string;
  sizeBytes: number;
  source: DriverProofMediaSource;
  storageKey: string;
  uploadedAt: string;
};

export type DriverProofMediaScanInput = {
  contentType: string;
  fileBytes: Buffer;
  sha256: string;
  storageKey: string;
};

export type DriverProofMediaScanResult =
  | { status: 'clean' }
  | { reason: string; status: 'rejected' };

export type DriverProofMediaScanner = {
  scanProofMedia(input: DriverProofMediaScanInput): Promise<DriverProofMediaScanResult>;
};

export type DriverProofMediaServiceContract = {
  storeProofMedia(input: StoreDriverProofMediaInput): Promise<StoreDriverProofMediaResult>;
};

export class DriverProofMediaScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverProofMediaScopeError';
  }
}

export class DriverProofMediaScanRejectedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Proof media rejected by malware scan: ${reason}`);
    this.name = 'DriverProofMediaScanRejectedError';
    this.reason = reason;
  }
}
